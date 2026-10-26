import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { islandGraphFromProfile, loadIslandGraph } from '../content/island.ts';
import { actionContentForMapGraph, loadSimulationActionContent } from '../content/actions.ts';
import { createInitialWorld, syncWorldNodeMetadataFromGraph, syncWorldNodeNotices } from '../engine/world.ts';
import { SimulationRunner } from '../ai/simulation-runner.ts';
import { DeathSummaryService } from '../ai/death-summary.ts';
import type { SimulationActionContent } from '../engine/simulation.ts';
import type { CsvRow } from '../content/csv.ts';
import type { JsonValue, WorldState } from '../domain/model.ts';
import type { MapProfile, MapProfileContent } from '../persistence/sqlite-store.ts';
import { ModelSettingsStore, ProcessModelSecrets, isModelSlotReady, type ModelSlotInput } from '../ai/model-settings.ts';
import { bindUnstartedInitialResidents, modelAssignmentsBySlot } from '../ai/model-binding.ts';
import { renderObserverMarkup, type ObserverSelection } from './observer.ts';
import { SQLiteObserverPort, type ObserverLifecyclePort, type ObserverRuntimeConfig } from './observer-adapter.ts';
import type { ModelSettingsView } from './observer.ts';
import { editorBasePath, editorMarkup, editorUiKitMarkup, readEditorData, readResidentCountSetting, saveEditorData, saveEditorDocumentChanges, validateData, writeResidentCountSetting } from './editor.ts';
import { renderUiIcon } from './icons.ts';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

function editorMapContent(data: Awaited<ReturnType<typeof readEditorData>>): MapProfileContent {
  return {
    nodes: data.nodes as unknown as readonly JsonValue[],
    edges: data.edges as unknown as readonly JsonValue[],
    nodeNotices: data.notices as unknown as readonly JsonValue[],
  };
}

function profileRows(rows: readonly JsonValue[]): CsvRow[] {
  return rows.map((value) => {
    if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('地圖存檔資料列格式不正確。');
    return Object.fromEntries(Object.entries(value).map(([key, cell]) => {
      if (cell === null || typeof cell === 'object') throw new Error('地圖存檔欄位必須是文字或數字。');
      return [key, String(cell)];
    }));
  });
}

function graphFromMapProfile(base: Awaited<ReturnType<typeof loadIslandGraph>>, profile: MapProfile) {
  return islandGraphFromProfile(base, profileRows(profile.nodes), profileRows(profile.edges));
}

function graphFromWorldState(base: Awaited<ReturnType<typeof loadIslandGraph>>, state: WorldState, fallback: Awaited<ReturnType<typeof loadIslandGraph>>) {
  const fallbackNodes = new Map(fallback.nodes.map((node) => [node.id, node]));
  const nodes = Object.values(state.nodes).map((node) => {
    const source = fallbackNodes.get(node.id);
    return {
      id: node.id, label: node.label, labelStatus: node.labelStatus, visualType: node.visualType,
      surfaceTerrain: node.surfaceTerrain ?? null, isStartingLocation: node.isStartingLocation ?? false,
      daySurfaceEntryEventsEnabled: node.daySurfaceEntryEventsEnabled ?? true,
      regionDescription: node.regionDescription ?? source?.regionDescription ?? '',
      approximateImagePosition: node.mapPosition ?? source?.approximateImagePosition ?? { x: null, y: null },
    };
  });
  const edges = nodes.flatMap((node) => (state.nodes[node.id]?.neighbors ?? []).filter((neighbor) => node.id < neighbor).map((neighbor) => ({
    source: node.id, target: neighbor, kind: 'snapshot', evidence: 'world-snapshot',
  })));
  return { ...base, nodes, edges, validation: { connected: base.validation.connected, islandNodeCount: nodes.length } };
}

export const observerClientScript = `
const root = document.querySelector('#app');
const dataStateIcons = ${JSON.stringify({ ready: renderUiIcon('check'), loading: renderUiIcon('refresh'), error: renderUiIcon('alert') })};
const initialUrlState = new URLSearchParams(window.location.search);
let nodeId = initialUrlState.get('nodeId') || undefined;
let residentId = initialUrlState.get('residentId') || undefined;
let eventResidentId = initialUrlState.get('eventResidentId') || undefined;
const initialEventPage = Number(initialUrlState.get('eventPage'));
let eventPage = Number.isSafeInteger(initialEventPage) && initialEventPage > 0 ? initialEventPage : 1;
let activeTab = root.querySelector('.observer-shell')?.dataset.activeTab || 'world';
let mapView = root.querySelector('.observer-shell')?.dataset.mapView || 'surface';
let dungeonFloor = Number(root.querySelector('.observer-shell')?.dataset.dungeonFloor) || 1;
let dungeonCellId = root.querySelector('.observer-shell')?.dataset.dungeonCell || undefined;
let deathSummarySearch = '';
let deathSummarySort = 'newest';
let activeModelSlot = 1;
const formDrafts = new Map();
const loadedModelLists = new Map();
const pendingSelectValues = new Map();
const workspaceTabSelections = new Map();
let setupRefreshInFlight = false;
let setupRefreshPending = false;
let pendingSetupAssignments = 0;
let backgroundRefreshPending = false;
let intentRefreshInFlight = false;
let lifecycleBusy = false;
let refreshSequence = 0;
let historyPageAnchor = null;
function syncObserverUrl() {
  const url = new URL(window.location.href);
  const set = (key, value) => value === undefined || value === null || value === '' ? url.searchParams.delete(key) : url.searchParams.set(key, String(value));
  set('nodeId', nodeId);
  set('residentId', residentId);
  set('eventResidentId', eventResidentId);
  set('eventPage', eventPage > 1 ? eventPage : '');
  set('activeTab', activeTab);
  set('mapView', mapView);
  set('dungeonFloor', dungeonFloor);
  set('dungeonCellId', dungeonCellId);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
function setDataState(state, message) {
  const element = root.querySelector('[data-data-state]');
  if (!element) return;
  element.dataset.dataState = state;
  const icon = element.querySelector('[data-data-state-icon]');
  if (icon) icon.innerHTML = dataStateIcons[state] || dataStateIcons.error;
  const label = element.querySelector('[data-data-state-label]');
  if (label) label.textContent = message;
}
function applyDeathSummaryControls() {
  const search = root.querySelector('[data-death-summary-search]');
  const sort = root.querySelector('[data-death-summary-sort]');
  const entries = root.querySelector('[data-death-summary-entries]');
  if (!search || !sort || !entries) return;
  search.value = deathSummarySearch;
  sort.value = deathSummarySort;
  const query = deathSummarySearch.trim().toLocaleLowerCase();
  const rows = [...entries.querySelectorAll('[data-death-summary-id]')];
  const statusOrder = { failed: 0, pending: 1, running: 2, complete: 3 };
  const compareName = (left, right) => (left.dataset.summaryName || '').localeCompare(right.dataset.summaryName || '', 'zh-Hant')
    || (left.dataset.summaryResidentId || '').localeCompare(right.dataset.summaryResidentId || '', undefined, { numeric: true });
  const compareUpdatedAt = (left, right) => (left.dataset.summaryUpdatedAt || '').localeCompare(right.dataset.summaryUpdatedAt || '');
  rows.sort((left, right) => {
    if (deathSummarySort === 'oldest') return compareUpdatedAt(left, right);
    if (deathSummarySort === 'name') return compareName(left, right);
    if (deathSummarySort === 'resident-id') return (left.dataset.summaryResidentId || '').localeCompare(right.dataset.summaryResidentId || '', undefined, { numeric: true }) || compareName(left, right);
    if (deathSummarySort === 'status') return (statusOrder[left.dataset.summaryStatus] ?? 99) - (statusOrder[right.dataset.summaryStatus] ?? 99) || compareName(left, right);
    return compareUpdatedAt(right, left);
  });
  let visible = 0;
  for (const row of rows) {
    const text = ((row.dataset.summaryName || '') + ' ' + (row.dataset.summaryResidentId || '')).toLocaleLowerCase();
    row.hidden = !text.includes(query);
    if (!row.hidden) visible += 1;
    entries.append(row);
  }
  const empty = root.querySelector('[data-death-summary-empty]');
  if (empty) {
    empty.hidden = visible !== 0;
    empty.textContent = rows.length ? '沒有符合搜尋條件的死亡總結' : '尚無死亡居民總結';
  }
}
function captureDrafts() {
  const slotSelect = root.querySelector('[data-slot-select]');
  if (slotSelect) activeModelSlot = Number(slotSelect.value) || activeModelSlot;
  for (const form of root.querySelectorAll('form[data-model-settings]')) {
    const slot = form.dataset.slotId;
    const fallbackValues = [...form.querySelectorAll('input[name="fallbackModels"]:checked')].map((field) => field.value);
    formDrafts.set(slot + ':fallbackModels', fallbackValues.join(','));
    for (const field of form.querySelectorAll('input[name],select[name]')) {
      if (field.name === 'fallbackModels') continue;
      const value = field instanceof HTMLSelectElement && field.multiple
        ? [...field.selectedOptions].map((option) => option.value).join(',')
        : field.type === 'checkbox' ? String(field.checked) : field.value;
      formDrafts.set(slot + ':' + field.name, value);
    }
  }
}
function restoreDrafts() {
  const slotSelect = root.querySelector('[data-slot-select]');
  if (slotSelect) slotSelect.value = String(activeModelSlot);
  for (const form of root.querySelectorAll('form[data-model-settings]')) {
    form.hidden = Number(form.dataset.slotId) !== activeModelSlot;
    const slot = form.dataset.slotId;
    const fallbackValue = formDrafts.get(slot + ':fallbackModels');
    if (fallbackValue !== undefined) {
      const selected = new Set(fallbackValue.split(',').filter(Boolean));
      for (const field of form.querySelectorAll('input[name="fallbackModels"]')) field.checked = selected.has(field.value);
    }
    for (const field of form.querySelectorAll('input[name],select[name]')) {
      if (field.name === 'fallbackModels') continue;
      const value = formDrafts.get(slot + ':' + field.name);
      if (value !== undefined) {
        if (field.type === 'checkbox') field.checked = value === 'true';
        else if (field instanceof HTMLSelectElement && field.multiple) {
          const selected = new Set(value.split(',').filter(Boolean));
          for (const option of field.options) option.selected = selected.has(option.value);
        }
        else field.value = value;
      }
    }
    const cachedModels = loadedModelLists.get(slot);
    if (cachedModels) {
      const modelSelect = form.querySelector('[data-model-select]');
      const selectedModel = formDrafts.get(slot + ':model') || modelSelect.value;
      applyLoadedModelList(form, cachedModels, selectedModel, form.querySelector('[name="baseUrl"]').value.trim() !== cachedModels.baseUrl);
    }
  }
}
function syncSetupAssignmentPendingState() {
  const hasReadySlot = (select) => [...select.options].some((option) => option.value && !option.disabled);
  for (const select of root.querySelectorAll('select[data-setup-model]')) {
    select.disabled = pendingSetupAssignments > 0 || !hasReadySlot(select);
  }
  const startButton = root.querySelector('[data-lifecycle="start"]');
  if (startButton) startButton.disabled = pendingSetupAssignments > 0;
}
function selectStateKey(select) {
  if (select.id) return 'id:' + select.id;
  if (select.dataset.setupResidentCount !== undefined) return 'setup-resident-count';
  if (select.dataset.setupModel !== undefined) return 'setup-model:' + select.dataset.setupModel;
  if (select.dataset.residentModel !== undefined) return 'resident-model:' + select.dataset.residentModel;
  if (select.dataset.saveSelect !== undefined) return 'save-select';
  if (select.dataset.slotSelect !== undefined) return 'slot-select';
  if (select.dataset.mapView !== undefined) return 'map-view';
  if (select.dataset.dungeonFloor !== undefined) return 'dungeon-floor';
  if (select.dataset.control) return 'control:' + select.dataset.control;
  const form = select.closest('form[data-model-settings]');
  return form && select.name ? 'slot:' + form.dataset.slotId + ':' + select.name : '';
}
function rememberPendingSelect(select) {
  const key = selectStateKey(select);
  if (!key) return;
  pendingSelectValues.set(key, select.multiple
    ? [...select.selectedOptions].map((option) => option.value)
    : select.value);
}
function clearPendingSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  const key = selectStateKey(select);
  if (key) pendingSelectValues.delete(key);
}
function clearPendingSelects(form) {
  for (const select of form.querySelectorAll('select')) clearPendingSelect(select);
}
function restorePendingSelects() {
  for (const select of root.querySelectorAll('select')) {
    const key = selectStateKey(select);
    if (!key || !pendingSelectValues.has(key)) continue;
    const value = pendingSelectValues.get(key);
    if (select.multiple && Array.isArray(value)) {
      const validValues = new Set([...select.options].filter((option) => !option.disabled).map((option) => option.value));
      const selected = value.filter((item) => validValues.has(item));
      for (const option of select.options) option.selected = selected.includes(option.value);
      if (selected.length !== value.length) pendingSelectValues.delete(key);
    } else if ([...select.options].some((option) => option.value === value && !option.disabled)) {
      select.value = value;
    } else {
      pendingSelectValues.delete(key);
    }
  }
}
function hasFocusedEditingControl() {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && root.contains(focused)
    && focused.matches('input:not([type="hidden"]), textarea, select, [contenteditable="true"]');
}
function scrollGroupKey(element) {
  const classes = typeof element.className === 'string' ? element.className.trim().replace(/\\s+/g, '.') : '';
  return element.tagName + ':' + classes + ':' + (element.getAttribute('role') || '');
}
function scrollContainers() {
  return [...root.querySelectorAll('*')].filter((element) =>
    element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
}
function captureDeathSummaryAnchor() {
  const panel = root.querySelector('#panel-death-summaries');
  if (!panel) return null;
  const panelScrolls = panel.scrollHeight > panel.clientHeight + 1;
  const scrollTop = panelScrolls ? panel.scrollTop : window.scrollY;
  if (scrollTop <= 1) return null;
  const panelRect = panel.getBoundingClientRect();
  const entry = [...panel.querySelectorAll('[data-death-summary-id]')].find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.bottom > panelRect.top && rect.top < panelRect.bottom;
  });
  if (!entry) return null;
  const rect = entry.getBoundingClientRect();
  return { summaryId: entry.dataset.deathSummaryId, panelScrolls, top: panelScrolls ? rect.top - panelRect.top : rect.top };
}
function restoreDeathSummaryAnchor(anchor) {
  if (!anchor) return;
  const panel = root.querySelector('#panel-death-summaries');
  const entry = [...(panel?.querySelectorAll('[data-death-summary-id]') ?? [])]
    .find((candidate) => candidate.dataset.deathSummaryId === anchor.summaryId);
  if (!panel || !entry) return;
  const currentTop = entry.getBoundingClientRect().top - (anchor.panelScrolls ? panel.getBoundingClientRect().top : 0);
  const delta = currentTop - anchor.top;
  if (anchor.panelScrolls) panel.scrollTop += delta;
  else window.scrollTo(window.scrollX, window.scrollY + delta);
}
function captureTransientUiState() {
  const occurrences = new Map();
  const scroll = scrollContainers().map((element) => {
    if (element.id) return { key: 'id:' + element.id, top: element.scrollTop, left: element.scrollLeft };
    const group = scrollGroupKey(element);
    const occurrence = occurrences.get(group) || 0;
    occurrences.set(group, occurrence + 1);
    return { key: group + ':' + occurrence, top: element.scrollTop, left: element.scrollLeft };
  });
  const details = [...root.querySelectorAll('details')].map((element, index) => ({
    key: element.dataset.deathSummaryId ? 'death-summary:' + element.dataset.deathSummaryId : element.id ? 'id:' + element.id : (element.className || 'details') + ':' + index,
    open: element.open,
  }));
  const pager = root.querySelector('[data-history-pager]');
  const visibleEvent = pager?.closest('.timeline-panel')?.querySelector('[data-history-page]:not([hidden])');
  const time = visibleEvent?.querySelector('time')?.textContent?.trim() || '';
  const description = visibleEvent?.querySelector('p')?.textContent?.trim() || '';
  const location = visibleEvent?.querySelector('span')?.textContent?.trim() || '';
  return {
    scroll,
    details,
    residentSearch: root.querySelector('[data-resident-search]')?.value || '',
    residentSearchFocused: document.activeElement === root.querySelector('[data-resident-search]'),
    deathSummaryAnchor: captureDeathSummaryAnchor(),
    page: Number(pager?.dataset.page) || 1,
    eventAnchor: time || description || location ? time + '\\u0000' + description + '\\u0000' + location : null,
    windowX: window.scrollX,
    windowY: window.scrollY,
  };
}
function restoreWorkspaceTabs() {
  for (const tablist of root.querySelectorAll('[role="tablist"]')) {
    const remembered = workspaceTabSelections.get(tablist.id);
    const buttons = [...tablist.querySelectorAll('[role="tab"]')];
    const selected = buttons.find((button) => button.dataset.tab === remembered)
      || buttons.find((button) => button.getAttribute('aria-selected') === 'true')
      || buttons[0];
    if (selected) activateTab(selected);
  }
}
function restoreHistoryPage(state) {
  const pager = root.querySelector('[data-history-pager]');
  const panel = pager?.closest('.timeline-panel');
  if (!pager || !panel) return;
  const pages = Number(pager.dataset.pages) || 1;
  let page = Math.max(1, Math.min(pages, state.page));
  if (state.eventAnchor) {
    const row = [...panel.querySelectorAll('[data-history-page]')].find((candidate) => {
      const time = candidate.querySelector('time')?.textContent?.trim() || '';
      const description = candidate.querySelector('p')?.textContent?.trim() || '';
      const location = candidate.querySelector('span')?.textContent?.trim() || '';
      return time + '\\u0000' + description + '\\u0000' + location === state.eventAnchor;
    });
    if (row) page = Number(row.dataset.historyPage) || page;
  }
  pager.dataset.page = String(page);
  for (const row of panel.querySelectorAll('[data-history-page]')) row.hidden = Number(row.dataset.historyPage) !== page;
  const status = pager.querySelector('[data-history-page-status]');
  if (status) status.textContent = '第 ' + page + ' 頁，共 ' + pages + ' 頁 · ' + pager.dataset.total + ' 筆事件';
  const previous = pager.querySelector('[data-history-page-step="previous"]');
  const next = pager.querySelector('[data-history-page-step="next"]');
  if (previous) previous.disabled = page === 1;
  if (next) next.disabled = page === pages;
}
function restoreTransientUiState(state) {
  restoreWorkspaceTabs();
  restoreHistoryPage(state);
  const residentSearch = root.querySelector('[data-resident-search]');
  if (residentSearch) {
    residentSearch.value = state.residentSearch;
    applyResidentSearch(residentSearch);
  }
  for (const saved of state.details) {
    const details = [...root.querySelectorAll('details')];
    const element = saved.key.startsWith('id:')
      ? document.getElementById(saved.key.slice(3))
      : saved.key.startsWith('death-summary:')
        ? details.find((candidate) => candidate.dataset.deathSummaryId === saved.key.slice('death-summary:'.length))
      : details.find((candidate, index) => (candidate.className || 'details') + ':' + index === saved.key);
    if (element instanceof HTMLDetailsElement && root.contains(element)) element.open = saved.open;
  }
  const occurrences = new Map();
  for (const element of scrollContainers()) {
    let key;
    if (element.id) key = 'id:' + element.id;
    else {
      const group = scrollGroupKey(element);
      const occurrence = occurrences.get(group) || 0;
      occurrences.set(group, occurrence + 1);
      key = group + ':' + occurrence;
    }
    const saved = state.scroll.find((entry) => entry.key === key);
    if (saved) { element.scrollTop = saved.top; element.scrollLeft = saved.left; }
  }
  restorePendingSelects();
  window.scrollTo(state.windowX, state.windowY);
  restoreDeathSummaryAnchor(state.deathSummaryAnchor);
  if (state.residentSearchFocused && residentSearch) {
    residentSearch.focus({ preventScroll: true });
    residentSearch.setSelectionRange(residentSearch.value.length, residentSearch.value.length);
  }
}
function applyResidentSearch(input) {
  const query = input.value.trim().toLocaleLowerCase();
  const items = [...root.querySelectorAll('[data-resident-search-item]')];
  let visibleCount = 0;
  for (const item of items) {
    const matches = (item.dataset.searchText || '').toLocaleLowerCase().includes(query);
    item.hidden = !matches;
    if (matches) visibleCount += 1;
  }
  const count = root.querySelector('[data-resident-search-count]');
  if (count) count.textContent = query ? visibleCount + ' / ' + items.length + ' 位' : items.length + ' 位';
  const empty = root.querySelector('[data-resident-search-empty]');
  if (empty) empty.hidden = !items.length || visibleCount > 0;
}
function applyLoadedModelList(form, cached, selectedModel, staleEndpoint = false) {
  const select = form.querySelector('[data-model-select]');
  const fingerprint = JSON.stringify({ baseUrl: cached.baseUrl, staleEndpoint, models: cached.models });
  if (select.dataset.modelListFingerprint === fingerprint) {
    select.value = cached.models.some((model) => model.id === selectedModel) ? selectedModel : '';
    updateModelPricing(form);
    return;
  }
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = staleEndpoint ? '上次成功清單；API URL 已變更，請重新載入' : '請選取模型';
  select.append(placeholder);
  for (const model of cached.models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.dataset.inputPrice = model.inputUsdPerMillion === null ? '' : String(model.inputUsdPerMillion);
    option.dataset.outputPrice = model.outputUsdPerMillion === null ? '' : String(model.outputUsdPerMillion);
    option.textContent = model.inputUsdPerMillion !== null && model.outputUsdPerMillion !== null
      ? model.id + ' · 輸入 $' + Number(model.inputUsdPerMillion).toPrecision(4) + ' / 輸出 $' + Number(model.outputUsdPerMillion).toPrecision(4) + ' 每百萬 token'
      : model.id + ' · 費率未提供';
    select.append(option);
  }
  select.value = cached.models.some((model) => model.id === selectedModel) ? selectedModel : '';
  form.dataset.loadedModels = JSON.stringify(cached.models);
  form.dataset.modelListBaseUrl = cached.baseUrl;
  select.dataset.modelListFingerprint = fingerprint;
  updateModelPricing(form);
}
async function refreshSetupResidentCount() {
  if (!root.querySelector('[data-setup-target-count]')) return;
  if (setupRefreshInFlight) {
    setupRefreshPending = true;
    return;
  }
  setupRefreshInFlight = true;
  try {
    do {
      setupRefreshPending = false;
      const response = await fetch('/api/setup', { cache: 'no-store' });
      if (!response.ok) continue;
      const setup = await response.json();
      const target = root.querySelector('[data-setup-target-count]');
      if (target && setup.status !== 'in-progress' && Number(target.dataset.setupTargetCount) !== Number(setup.residentCount)) await refresh({ background: true });
    } while (setupRefreshPending && root.querySelector('[data-setup-target-count]'));
  } catch { /* Keep the current setup view when synchronization is temporarily unavailable. */ }
  finally { setupRefreshInFlight = false; }
}
let setupChannel;
try {
  setupChannel = new BroadcastChannel('island-sim-setup');
  setupChannel.addEventListener('message', (event) => { if (event.data?.type === 'resident-count-updated') void refreshSetupResidentCount(); });
} catch { /* The focus and visibility fallbacks below still synchronize setup state. */ }
window.addEventListener('storage', (event) => { if (event.key === 'island-sim:resident-count-updated') void refreshSetupResidentCount(); });
window.addEventListener('focus', () => void refreshSetupResidentCount());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshSetupResidentCount(); });
window.setInterval(() => { void refreshSetupResidentCount(); }, 2500);
root.addEventListener('focusout', (event) => {
  if (!(event.target instanceof HTMLElement) || !event.target.matches('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')) return;
  window.setTimeout(() => {
    if (!backgroundRefreshPending || hasFocusedEditingControl()) return;
    backgroundRefreshPending = false;
    void refresh({ background: true });
  }, 0);
});
root.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.matches('[data-resident-search]')) applyResidentSearch(event.target);
});
function activateTab(button) {
  const tablist = button.closest('[role="tablist"]');
  if (!tablist) return;
  const tab = button.dataset.tab;
  workspaceTabSelections.set(tablist.id, tab);
  if (tablist.id === 'observer-tabs') {
    activeTab = tab;
    const shell = root.querySelector('.observer-shell');
    if (shell) shell.dataset.activeTab = tab;
    syncObserverUrl();
  }
  for (const candidate of tablist.querySelectorAll('[role="tab"]')) {
    const selected = candidate === button;
    candidate.setAttribute('aria-selected', String(selected));
    candidate.tabIndex = selected ? 0 : -1;
  }
  for (const panel of root.querySelectorAll('[role="tabpanel"][data-tablist="' + tablist.id + '"]')) {
    panel.hidden = tablist.dataset.responsiveTabs === 'mobile'
      ? window.matchMedia('(max-width: 760px)').matches && panel.id !== button.getAttribute('aria-controls')
      : panel.id !== button.getAttribute('aria-controls');
  }
}
function syncResponsiveTabPanels() {
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  for (const tablist of root.querySelectorAll('[role="tablist"][data-responsive-tabs="mobile"]')) {
    const selected = tablist.querySelector('[role="tab"][aria-selected="true"]');
    for (const panel of root.querySelectorAll('[role="tabpanel"][data-tablist="' + tablist.id + '"]')) {
      panel.hidden = narrow && selected?.getAttribute('aria-controls') !== panel.id;
    }
  }
}
function bindTabButtons() {
  for (const tablist of root.querySelectorAll('[role="tablist"]')) {
    if (workspaceTabSelections.has(tablist.id)) continue;
    const selected = tablist.querySelector('[role="tab"][aria-selected="true"]');
    if (selected?.dataset.tab) workspaceTabSelections.set(tablist.id, selected.dataset.tab);
  }
  for (const button of root.querySelectorAll('[role="tablist"] [role="tab"]')) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab(button);
    });
  }
  syncResponsiveTabPanels();
}
window.addEventListener('resize', syncResponsiveTabPanels);
function showControlFeedback(message) {
  const feedback = root.querySelector('[data-control-feedback]');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.hidden = !message;
}
async function refresh(options = {}) {
  if (options.background && lifecycleBusy) return;
  if (options.background && hasFocusedEditingControl()) {
    backgroundRefreshPending = true;
    return;
  }
  if (!options.background) backgroundRefreshPending = false;
  syncObserverUrl();
  const requestSequence = ++refreshSequence;
  const requestState = JSON.stringify({ nodeId, residentId, eventResidentId, eventPage, activeTab, mapView, dungeonFloor, dungeonCellId });
  captureDrafts();
  setDataState('loading', '正在同步觀察資料');
  const params = new URLSearchParams();
  if (nodeId) params.set('nodeId', nodeId);
  if (residentId) params.set('residentId', residentId);
  if (eventResidentId) params.set('eventResidentId', eventResidentId);
  params.set('eventPage', String(eventPage));
  params.set('activeTab', activeTab);
  params.set('mapView', mapView);
  params.set('dungeonFloor', String(dungeonFloor));
  if (dungeonCellId) params.set('dungeonCellId', dungeonCellId);
  try {
    const response = await fetch('/api/observer?' + params.toString());
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '觀察資料讀取失敗');
    if (typeof result.markup !== 'string') throw new Error('觀察資料格式不正確');
    if (requestSequence !== refreshSequence) return;
    if (JSON.stringify({ nodeId, residentId, eventResidentId, eventPage, activeTab, mapView, dungeonFloor, dungeonCellId }) !== requestState) {
      if (options.background) backgroundRefreshPending = true;
      return;
    }
    if (options.background && hasFocusedEditingControl()) {
      backgroundRefreshPending = true;
      setDataState('ready', '資料同步正常');
      return;
    }
    const transientUiState = captureTransientUiState();
    if (options.resetHistoryPage) { transientUiState.page = 1; transientUiState.eventAnchor = null; }
    captureDrafts();
    root.innerHTML = result.markup;
    applyDeathSummaryControls();
    bindTabButtons();
    restoreDrafts();
    restoreTransientUiState(transientUiState);
    syncSetupAssignmentPendingState();
    backgroundRefreshPending = false;
    setDataState('ready', '資料同步正常');
  } catch (error) {
    setDataState('error', '資料讀取失敗：' + (error instanceof Error ? error.message : '連線中斷'));
  }
}
bindTabButtons();
function selectedResidentForIntentRefresh() {
  return residentId || root.querySelector('.resident-chip.is-selected[data-resident-id]')?.dataset.residentId || '';
}
async function refreshSelectedResidentIntents() {
  if (document.hidden || lifecycleBusy || activeTab !== 'residents' || intentRefreshInFlight) return;
  const id = selectedResidentForIntentRefresh();
  if (!id || !root.querySelector('.observer-intent')) return;
  intentRefreshInFlight = true;
  try {
    const response = await fetch('/api/resident-intents?residentId=' + encodeURIComponent(id), { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || selectedResidentForIntentRefresh() !== id) return;
    const card = root.querySelector('.observer-intent');
    const label = card?.querySelector('dt');
    const value = card?.querySelector('dd');
    if (!label || !value) return;
    const previousList = value.querySelector<HTMLOListElement>('.observer-intent-records');
    const previousScrollTop = previousList?.scrollTop ?? 0;
    const previousScrollHeight = previousList?.scrollHeight ?? 0;
    const intents = Array.isArray(result.intents) ? result.intents.filter((intent) => typeof intent === 'string' || (intent !== null && typeof intent === 'object' && typeof intent.intent === 'string')) : [];
    const total = Number.isSafeInteger(result.total) && result.total >= intents.length ? result.total : intents.length;
    label.textContent = '觀察資訊 · 居民 AI 意圖（最近 ' + intents.length + ' 則，共 ' + total + ' 則）';
    value.replaceChildren();
    if (intents.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'empty-state';
      empty.textContent = '目前尚無意圖紀錄。';
      value.append(empty);
    } else {
      const list = document.createElement('ol');
      list.className = 'observer-intent-records';
      list.tabIndex = 0;
      list.setAttribute('aria-label', '最近居民意圖紀錄');
      for (const intent of intents) {
        const row = document.createElement('li');
        if (typeof intent === 'string') {
          row.textContent = intent;
        } else {
          const when = document.createElement('span');
          when.textContent = '第 ' + intent.day + ' 日 · ' + intent.timeT + 'T' + (intent.nodeId ? ' · ' + (intent.nodeLabel || 'Node ' + intent.nodeId) : '');
          const description = document.createElement('p');
          description.textContent = intent.description;
          const text = document.createElement('small');
          text.textContent = '意圖：' + intent.intent;
          row.append(when, description, text);
        }
        list.append(row);
      }
      value.append(list);
      if (previousScrollTop > 0) {
        list.scrollTop = previousScrollTop + Math.max(0, list.scrollHeight - previousScrollHeight);
      }
    }
  } catch { /* Intent refresh is supplementary; keep the existing observer view on transient errors. */ }
  finally { intentRefreshInFlight = false; }
}
setInterval(() => { void refreshSelectedResidentIntents(); }, 1000);
function renderOpenRouterAccount(container, account) {
  if (!container) return;
  container.replaceChildren();
  const credits = account.credits;
  const balance = document.createElement('p');
  balance.textContent = 'OpenRouter API 實際回傳：總額 US$' + Number(credits.totalCredits).toFixed(4) + '；累計使用 US$' + Number(credits.totalUsage).toFixed(4) + '。';
  container.append(balance);
  const title = document.createElement('h3'); title.textContent = '各推理 key 使用量'; container.append(title);
  const list = document.createElement('ul');
  for (const item of account.keys || []) {
    const row = document.createElement('li');
    row.textContent = item.name + ' · ' + (item.usage === null ? 'API 未提供使用額' : 'API 實際使用 US$' + Number(item.usage).toFixed(4)) + (item.disabled ? ' · 已停用' : '');
    list.append(row);
  }
  if (!list.childElementCount) { const empty = document.createElement('li'); empty.textContent = 'API 未回傳 key 使用量項目。'; list.append(empty); }
  container.append(list);
}
root.addEventListener('click', async (event) => {
  const saveManagement = event.target.closest('[data-save-management-key]');
  const refreshAccount = event.target.closest('[data-refresh-openrouter-account]');
  const createSlotKey = event.target.closest('[data-create-openrouter-key]');
  if (!saveManagement && !refreshAccount && !createSlotKey) return;
  const form = event.target.closest('form[data-model-settings]');
  const management = event.target.closest('[data-openrouter-management]');
  const feedback = management?.querySelector('[data-openrouter-account-feedback]');
  const summary = management?.querySelector('[data-openrouter-account-summary]');
  const button = saveManagement || refreshAccount || createSlotKey;
  button.disabled = true;
  try {
    if (createSlotKey) {
      const slotForm = createSlotKey.closest('form[data-model-settings]');
      const response = await fetch('/api/settings/openrouter/keys/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotId: Number(createSlotKey.dataset.createOpenrouterKey) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '槽位推理 key 建立失敗。');
      createSlotKey.textContent = '槽位推理 key 已建立';
      const slotStatus = slotForm.querySelector('[data-openrouter-slot-status]');
      if (slotStatus) slotStatus.textContent = '已建立 ' + result.name + '；key 已保存至模型設定資料庫；頁面不會接收明文。';
      return;
    }
    if (saveManagement) {
      const keyInput = management.querySelector('[data-management-key]');
      const key = keyInput.value;
      const response = await fetch('/api/settings/openrouter/management-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Management key 驗證失敗。');
      keyInput.value = '';
      renderOpenRouterAccount(summary, result);
      feedback.textContent = 'Management key 已在伺服器記憶體驗證並暫存；頁面未接收任何 key 明文。';
      const billing = form.querySelector('[data-provider-billing-status]');
      if (billing) billing.textContent = 'OpenRouter 實際帳務已載入；金額來自 Management API 回應。';
      return;
    }
    const response = await fetch('/api/settings/openrouter/account', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'OpenRouter 帳務未取得。');
    renderOpenRouterAccount(summary, result);
    feedback.textContent = '已更新 OpenRouter 實際帳務與 key 使用量。';
  } catch (error) {
    if (feedback) feedback.textContent = error instanceof Error ? error.message : '管理資料未取得。';
    if (createSlotKey) {
      const slotStatus = form?.querySelector('[data-openrouter-slot-status]');
      if (slotStatus) slotStatus.textContent = error instanceof Error ? error.message : '推理 key 建立失敗。';
    }
  } finally { button.disabled = false; }
});
root.addEventListener('click', async (event) => {
  const addModelSlotButton = event.target.closest('[data-create-model-slot]');
  if (addModelSlotButton) {
    addModelSlotButton.disabled = true;
    try {
      const response = await fetch('/api/settings/slot/create', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法新增模型卡。');
      captureDrafts();
      activeModelSlot = result.slotId;
      await refresh();
    } catch (error) {
      const status = root.querySelector('.model-settings-panel > .settings-status');
      if (status) status.textContent = error instanceof Error ? error.message : '無法新增模型卡。';
    } finally { if (addModelSlotButton.isConnected) addModelSlotButton.disabled = false; }
    return;
  }
  const setupModelSettingsButton = event.target.closest('[data-setup-open-model-settings]');
  if (setupModelSettingsButton) {
    const heading = root.querySelector('#model-settings-title');
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    heading?.focus({ preventScroll: true });
    return;
  }
  const setupCountButton = event.target.closest('[data-setup-resident-count-save]');
  if (setupCountButton) {
    const countSelect = root.querySelector('[data-setup-resident-count]');
    const feedback = root.querySelector('[data-setup-resident-count-feedback]');
    setupCountButton.disabled = true;
    if (feedback) feedback.textContent = '正在儲存…';
    try {
      const response = await fetch('/api/setup/resident-count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ residentCount: Number(countSelect?.value) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '居民人數未儲存。');
      clearPendingSelect(countSelect);
      const message = { type: 'resident-count-updated', at: Date.now() };
      try { const channel = new BroadcastChannel('island-sim-setup'); channel.postMessage(message); channel.close(); } catch {}
      try { localStorage.setItem('island-sim:resident-count-updated', String(message.at)); } catch {}
      await refresh();
      const nextFeedback = root.querySelector('[data-setup-resident-count-feedback]');
      if (nextFeedback) nextFeedback.textContent = '已儲存 ' + result.residentCount + ' 人；只套用於下一局。';
    } catch (error) {
      if (feedback) feedback.textContent = error instanceof Error ? error.message : '居民人數未儲存。';
    } finally {
      if (setupCountButton.isConnected) setupCountButton.disabled = false;
    }
    return;
  }
  const pageButton = event.target.closest('[data-history-page-step]');
  if (pageButton) {
    const pager = pageButton.closest('[data-history-pager]');
    const page = Number(pager.dataset.page) || 1;
    const pages = Number(pager.dataset.pages) || 1;
    const nextPage = Math.max(1, Math.min(pages, page + (pageButton.dataset.historyPageStep === 'next' ? 1 : -1)));
    eventPage = nextPage;
    syncObserverUrl();
    pager.dataset.page = String(nextPage);
    for (const row of pager.closest('.timeline-panel').querySelectorAll('[data-history-page]')) row.hidden = Number(row.dataset.historyPage) !== nextPage;
    pager.querySelector('[data-history-page-status]').textContent = '第 ' + nextPage + ' 頁，共 ' + pages + ' 頁 · ' + pager.dataset.total + ' 筆事件';
    pager.querySelector('[data-history-page-step="previous"]').disabled = nextPage === 1;
    pager.querySelector('[data-history-page-step="next"]').disabled = nextPage === pages;
    return;
  }
  const target = event.target.closest('[data-node-id], [data-dungeon-cell], [data-resident-id], [data-control], [data-lifecycle]');
  if (!target) return;
  if (target.dataset.lifecycle) {
    if (lifecycleBusy) return;
    lifecycleBusy = true;
    const kind = target.dataset.lifecycle;
    const feedback = root.querySelector('[data-lifecycle-feedback]');
    const payload = kind === 'start'
      ? { kind, name: root.querySelector('[data-session-name]')?.value, mapId: root.querySelector('[data-setup-map-profile]')?.value }
      : kind === 'save'
        ? { kind, name: root.querySelector('[data-save-name]')?.value }
        : kind === 'load'
          ? { kind, saveId: root.querySelector('[data-save-select]')?.value }
          : { kind };
    target.disabled = true;
    if (feedback) feedback.textContent = '正在處理…';
    try {
      const response = await fetch('/api/lifecycle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '遊戲局操作未完成。');
    if (kind === 'load') clearPendingSelect(root.querySelector('[data-save-select]'));
    await refresh();
      const nextFeedback = root.querySelector('[data-lifecycle-feedback]');
      if (nextFeedback) nextFeedback.textContent = kind === 'save' ? '存檔完成。' : kind === 'load' ? '存檔已載入，模擬已自動恢復。' : kind === 'end' ? '當局已結束並封存。' : '新局已建立，可以恢復模擬。';
    } catch (error) {
      const nextFeedback = root.querySelector('[data-lifecycle-feedback]');
      if (nextFeedback) nextFeedback.textContent = error instanceof Error ? error.message : '遊戲局操作未完成。';
    } finally {
      lifecycleBusy = false;
      if (target.isConnected) target.disabled = false;
    }
    return;
  }
  if (target.dataset.nodeId) { nodeId = target.dataset.nodeId; dungeonCellId = undefined; mapView = 'surface'; residentId = undefined; activeTab = 'world'; await refresh(); return; }
  if (target.dataset.dungeonCell) { dungeonCellId = target.dataset.dungeonCell; nodeId = undefined; mapView = 'dungeon'; activeTab = 'world'; await refresh(); return; }
  if (target.dataset.residentId) { residentId = target.dataset.residentId; nodeId = undefined; activeTab = 'residents'; await refresh(); return; }
  const action = target.dataset.control;
  if (action === 'pause' || action === 'resume') {
    showControlFeedback('');
    const response = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: action }) });
    const errorMessage = response.ok ? '' : (await response.json()).error || '控制要求未完成';
    await refresh();
    if (errorMessage) showControlFeedback(errorMessage);
  }
});
root.addEventListener('keydown', (event) => {
  const svgAction = event.target.closest('rect[data-dungeon-cell], g[data-resident-id], g[data-node-id]');
  if ((event.key === 'Enter' || event.key === ' ') && svgAction) {
    event.preventDefault();
    svgAction.click();
  }
});
root.addEventListener('change', async (event) => {
  if (event.target instanceof HTMLSelectElement) rememberPendingSelect(event.target);
  const eventResidentFilter = event.target.closest('select[data-event-resident-filter]');
  if (eventResidentFilter) {
    eventResidentId = eventResidentFilter.value || undefined;
    eventPage = 1;
    activeTab = 'history';
    clearPendingSelect(eventResidentFilter);
    syncObserverUrl();
    await refresh({ resetHistoryPage: true });
    return;
  }
  const setupMapSelect = event.target.closest('select[data-setup-map-profile]');
  if (setupMapSelect) {
    setupMapSelect.disabled = true;
    const feedback = root.querySelector('[data-setup-map-feedback]');
    try {
      const response = await fetch('/api/setup/map-profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapId: setupMapSelect.value }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '地圖選擇未保存。');
      if (feedback) feedback.textContent = '已選擇此地圖作為下一局地圖。';
      setupMapSelect.disabled = false;
    } catch (error) {
      if (feedback) feedback.textContent = error instanceof Error ? error.message : '地圖選擇未保存。';
      setupMapSelect.disabled = false;
    }
    return;
  }
  const setupModelSelect = event.target.closest('select[data-setup-model]');
  if (setupModelSelect) {
    pendingSetupAssignments += 1;
    setupModelSelect.disabled = true;
    syncSetupAssignmentPendingState();
    try {
      const response = await fetch('/api/setup/model-assignment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ residentIndex: Number(setupModelSelect.dataset.setupModel), templateSlot: Number(setupModelSelect.value) }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '模型卡分配未完成。');
      clearPendingSelect(setupModelSelect);
      await refresh();
      const feedback = root.querySelector('[data-setup-model-feedback]');
      if (feedback) feedback.textContent = '本局初始分配已保存；同一張卡可以重複使用。';
    } catch (error) {
      const feedback = root.querySelector('[data-setup-model-feedback]');
      if (feedback) feedback.textContent = error instanceof Error ? error.message : '模型卡分配未完成。';
    } finally {
      pendingSetupAssignments = Math.max(0, pendingSetupAssignments - 1);
      if (setupModelSelect.isConnected) setupModelSelect.disabled = false;
      syncSetupAssignmentPendingState();
    }
    return;
  }
  const residentModelSelect = event.target.closest('select[data-resident-model]');
  if (residentModelSelect) {
    residentModelSelect.disabled = true;
    try {
      const response = await fetch('/api/session/model-assignment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: residentModelSelect.dataset.residentModel, slotId: Number(residentModelSelect.value) }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '模型卡分配未完成。');
      clearPendingSelect(residentModelSelect);
      await refresh();
      const feedback = root.querySelector('[data-session-model-feedback]');
      if (feedback) feedback.textContent = '已套用到當前局；模板未變更。';
    } catch (error) {
      const feedback = root.querySelector('[data-session-model-feedback]');
      if (feedback) feedback.textContent = error instanceof Error ? error.message : '模型卡分配未完成。';
      residentModelSelect.disabled = false;
    }
    return;
  }
  const modelSelect = event.target.closest('select[data-model-select]');
  if (modelSelect) {
    updateModelPricing(modelSelect.closest('form[data-model-settings]'));
    return;
  }
  const mapViewSelect = event.target.closest('select[data-map-view]');
  if (mapViewSelect) {
    mapView = mapViewSelect.value === 'dungeon' ? 'dungeon' : 'surface';
    clearPendingSelect(mapViewSelect);
    nodeId = undefined;
    dungeonCellId = undefined;
    activeTab = 'world';
    await refresh();
    return;
  }
  const dungeonFloorSelect = event.target.closest('select[data-dungeon-floor]');
  if (dungeonFloorSelect) {
    const nextFloor = Number(dungeonFloorSelect.value);
    if ([1, 2, 3].includes(nextFloor)) dungeonFloor = nextFloor;
    clearPendingSelect(dungeonFloorSelect);
    dungeonCellId = undefined;
    await refresh();
    return;
  }
  const slotSelect = event.target.closest('select[data-slot-select]');
  if (slotSelect) {
    activeModelSlot = Number(slotSelect.value) || 1;
    clearPendingSelect(slotSelect);
    for (const form of root.querySelectorAll('form[data-model-settings]')) form.hidden = Number(form.dataset.slotId) !== activeModelSlot;
    return;
  }
});
root.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  const buttons = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  let index = buttons.indexOf(tab);
  if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
  else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = buttons.length - 1;
  else return;
  event.preventDefault();
  const next = buttons[index];
  next.focus();
  activateTab(next);
});
function clearModelError(form) {
  const message = form.querySelector('[data-model-form-error]');
  message.hidden = true;
  message.textContent = '';
  for (const field of form.querySelectorAll('[aria-invalid="true"]')) {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }
  for (const hint of form.querySelectorAll('[data-model-field-error]')) hint.remove();
}
function showModelError(form, text) {
  clearModelError(form);
  const message = form.querySelector('[data-model-form-error]');
  message.textContent = text;
  message.hidden = false;
  const match = text.match(/設定欄位 ([A-Za-z][A-Za-z0-9]*)/);
  let fieldName = match?.[1];
  if (!fieldName && /Base URL|HTTPS|URL/.test(text)) fieldName = 'baseUrl';
  else if (!fieldName && /輸入價格/.test(text)) fieldName = 'inputUsdPerMillion';
  else if (!fieldName && /輸出價格/.test(text)) fieldName = 'outputUsdPerMillion';
  else if (!fieldName && /輸入 token/.test(text)) fieldName = 'maxInputTokens';
  else if (!fieldName && /上下文字元上限/.test(text)) fieldName = 'maxContextCharacters';
  else if (!fieldName && /風格描述/.test(text)) fieldName = 'styleDescription';
  else if (!fieldName && /備援模型/.test(text)) fieldName = 'fallbackModels';
  else if (!fieldName && /API 金鑰/.test(text)) fieldName = 'apiKey';
  else if (!fieldName && (text.includes('主模型') || text.includes('provider/model'))) fieldName = 'model';
  if (!fieldName) return;
  const field = form.querySelector('[name="' + fieldName + '"]');
  const label = field?.closest('label');
  if (!field || !label) return;
  const panel = field.closest('[role="tabpanel"][data-tablist]');
  if (panel) {
    const sectionTab = form.querySelector('[role="tab"][aria-controls="' + panel.id + '"]');
    if (sectionTab) activateTab(sectionTab);
  }
  const hint = document.createElement('span');
  hint.className = 'field-error';
  hint.dataset.modelFieldError = 'true';
  hint.id = 'model-slot-' + form.dataset.slotId + '-' + fieldName + '-error';
  hint.textContent = text;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', hint.id);
  label.append(hint);
  const disclosure = label.closest('details');
  if (disclosure) disclosure.open = true;
}
function setModelFeedback(form, state, text) {
  const feedback = form.querySelector('[data-model-form-feedback]');
  if (!feedback) return;
  feedback.dataset.state = state;
  feedback.textContent = text;
}
function updateModelPricing(form) {
  if (!form) return;
  const select = form.querySelector('[data-model-select]');
  const option = select?.selectedOptions[0];
  const inputPrice = option?.dataset.inputPrice || '';
  const outputPrice = option?.dataset.outputPrice || '';
  const inputField = form.querySelector('[name="inputUsdPerMillion"]');
  const outputField = form.querySelector('[name="outputUsdPerMillion"]');
  const display = form.querySelector('[data-provider-cost-status]');
  inputField.value = inputPrice;
  outputField.value = outputPrice;
  if (inputPrice && outputPrice) {
    display.textContent = 'API 回傳費率：輸入 US$' + Number(inputPrice).toPrecision(6) + '／百萬 token；輸出 US$' + Number(outputPrice).toPrecision(6) + '／百萬 token。';
    form.dataset.pricingVerified = 'true';
  } else {
    display.textContent = 'API 未提供可驗證費率；此模型仍可使用，該次費用會標記為未知。';
    form.dataset.pricingVerified = 'false';
  }
}
root.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-load-model-list]');
  if (!button) return;
  const form = button.closest('form[data-model-settings]');
  const feedback = form.querySelector('[data-model-list-feedback]');
  const billing = form.querySelector('[data-provider-billing-status]');
  const select = form.querySelector('[data-model-select]');
  const previousModel = select.value;
  button.disabled = true;
  feedback.textContent = '正在向供應商讀取模型清單…';
  billing.textContent = '正在查詢供應商帳務介面…';
  try {
    const response = await fetch('/api/settings/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      slotId: Number(form.dataset.slotId), baseUrl: form.querySelector('[name="baseUrl"]').value,
      apiKey: form.querySelector('[name="apiKey"]').value,
    }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '無法讀取模型清單。');
    const models = Array.isArray(result.models) ? result.models : [];
    const cachedModels = { baseUrl: form.querySelector('[name="baseUrl"]').value.trim(), models };
    loadedModelLists.set(form.dataset.slotId, cachedModels);
    select.replaceChildren();
    const priorExists = models.some((model) => model.id === previousModel);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = !models.length ? '供應商未回傳模型' : previousModel && !priorExists ? '原模型不在最新清單中，請重新選擇' : '請選取模型';
    select.append(placeholder);
    if (!models.length) {
      select.value = '';
    } else {
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.dataset.inputPrice = model.inputUsdPerMillion === null ? '' : String(model.inputUsdPerMillion);
        option.dataset.outputPrice = model.outputUsdPerMillion === null ? '' : String(model.outputUsdPerMillion);
        option.textContent = model.inputUsdPerMillion !== null && model.outputUsdPerMillion !== null
          ? model.id + ' · 輸入 $' + Number(model.inputUsdPerMillion).toPrecision(4) + ' / 輸出 $' + Number(model.outputUsdPerMillion).toPrecision(4) + ' 每百萬 token'
          : model.id + ' · 費率未提供';
        select.append(option);
      }
      select.value = priorExists ? previousModel : '';
    }
    feedback.textContent = models.length ? '已載入 ' + models.length + ' 個模型，可用上方搜尋篩選。' : '模型清單是空的；請確認供應商端點。';
    form.dataset.loadedModels = JSON.stringify(models);
    form.dataset.modelListBaseUrl = cachedModels.baseUrl;
    const credits = result.credits;
    if (credits?.status === 'available') {
      billing.textContent = 'OpenRouter 實際帳務：總額 US$' + Number(credits.totalCredits).toFixed(4) + '；累計使用 US$' + Number(credits.totalUsage).toFixed(4) + '；剩餘 US$' + Number(credits.remaining).toFixed(4) + '。';
    } else if (credits?.status === 'management-key-required') {
      billing.textContent = 'OpenRouter 帳務查詢需要 Management key；目前金鑰沒有此權限，不顯示餘額或累計使用額。';
    } else {
      billing.textContent = '此供應商未提供可驗證的帳務資料；實際金額未提供。';
    }
    updateModelPricing(form);
  } catch (error) {
    const cached = loadedModelLists.get(form.dataset.slotId);
    feedback.textContent = (error instanceof Error ? error.message : '模型清單讀取失敗。') + (cached ? '；保留上次成功載入的模型清單與選取。' : '');
    if (!cached) billing.textContent = '帳務資訊未提供。';
    updateModelPricing(form);
  } finally {
    button.disabled = false;
  }
});
root.addEventListener('input', (event) => {
  const summarySearch = event.target.closest('[data-death-summary-search]');
  if (summarySearch) {
    deathSummarySearch = summarySearch.value;
    applyDeathSummaryControls();
    return;
  }
  const fallbackSearch = event.target.closest('[data-fallback-search]');
  if (fallbackSearch) {
    const form = fallbackSearch.closest('form[data-model-settings]');
    const query = fallbackSearch.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const option of form.querySelectorAll('.fallback-option')) {
      const matches = option.textContent.toLocaleLowerCase().includes(query);
      option.hidden = !matches;
      if (matches) visible += 1;
    }
    const empty = form.querySelector('[data-fallback-empty]');
    if (empty) empty.hidden = visible !== 0;
    return;
  }
  const search = event.target.closest('[data-model-search]');
  if (!search) return;
  const form = search.closest('form[data-model-settings]');
  const select = form.querySelector('[data-model-select]');
  const query = search.value.trim().toLowerCase();
  for (const option of [...select.options]) {
    if (!option.value) continue;
    option.hidden = !option.value.toLowerCase().includes(query);
  }
  updateModelPricing(form);
});
root.addEventListener('change', (event) => {
  const summarySort = event.target.closest('[data-death-summary-sort]');
  if (!summarySort) return;
  deathSummarySort = summarySort.value;
  applyDeathSummaryControls();
});
root.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-model-settings]');
  if (!form) return;
  event.preventDefault();
  clearModelError(form);
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setModelFeedback(form, 'loading', '正在驗證並儲存設定…');
  const fields = new FormData(form);
  const slotId = Number(form.dataset.slotId);
  const payload = {
    slotId,
    provider: String(fields.get('provider') || ''),
    baseUrl: String(fields.get('baseUrl') || ''),
    model: String(fields.get('model') || ''),
    styleDescription: String(fields.get('styleDescription') || ''),
    maxContextCharacters: String(fields.get('maxContextCharacters') || ''),
    apiKey: String(fields.get('apiKey') || ''),
    clearApiKey: fields.get('clearApiKey') === 'true',
    inputUsdPerMillion: String(fields.get('inputUsdPerMillion') || ''),
    outputUsdPerMillion: String(fields.get('outputUsdPerMillion') || ''),
    fallbackModels: fields.getAll('fallbackModels').map(String).join(', '),
  };
  try {
    const response = await fetch('/api/settings/slot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) {
      showModelError(form, result.error || '設定未儲存，請檢查欄位後重試。');
      setModelFeedback(form, 'error', '設定未儲存');
      return;
    }
    form.querySelector('input[name="apiKey"]').value = '';
    form.querySelector('input[name="clearApiKey"]').checked = false;
    clearPendingSelects(form);
    captureDrafts();
    await refresh();
    const refreshedForm = root.querySelector('form[data-model-settings][data-slot-id="' + slotId + '"]');
    if (refreshedForm) setModelFeedback(refreshedForm, 'success', result.ready
      ? '設定已儲存；API 金鑰已本機持久保存。'
      : '欄位已儲存；必要設定尚未齊全，因此不會呼叫模型。');
  } catch (error) {
    showModelError(form, error instanceof Error ? error.message : '連線失敗，設定未儲存。');
    setModelFeedback(form, 'error', '設定未儲存');
  } finally {
    if (submitButton.isConnected) submitButton.disabled = false;
  }
});
root.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-summarizer-settings]');
  if (!form) return;
  event.preventDefault();
  const feedback = form.querySelector('[data-summarizer-feedback]');
  const fields = new FormData(form);
  feedback.textContent = '正在儲存死亡總結者設定…';
  try {
  const response = await fetch('/api/settings/summarizer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelSlotId: fields.get('modelSlotId') || null, prompt: fields.get('prompt') || '' }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '死亡總結者設定未儲存。');
    feedback.textContent = result.ready ? '已儲存；摘要會使用此模型卡的設定與金鑰。' : '已儲存選擇；模型卡尚未完成設定或保存金鑰。';
    captureDrafts();
    await refresh();
  } catch (error) { feedback.textContent = error instanceof Error ? error.message : '死亡總結者設定未儲存。'; }
});
root.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-retry-death-summary]');
  if (!button) return;
  const details = button.closest('details');
  const status = details?.querySelector('[data-death-summary-retry-status]');
  button.disabled = true;
  if (status) status.textContent = '正在排入重試…';
  try {
    const response = await fetch('/api/death-summaries/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ residentId: button.dataset.retryDeathSummary, summaryId: button.dataset.summaryId, sessionId: button.dataset.sessionId, sourceSaveId: button.dataset.sourceSaveId || null, loadInstanceId: button.dataset.loadInstanceId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '無法重試此居民總結。');
    if (status) status.textContent = '已排入重試，正在使用目前的死亡總結模型卡。';
    await refresh();
  } catch (error) {
    button.disabled = false;
    if (status) status.textContent = error instanceof Error ? error.message : '無法重試此居民總結。';
  }
});
setInterval(() => {
  if (!document.hidden && activeTab !== 'settings') void refresh({ background: true });
}, 2000);
`;

export function createObserverServer(
  store: SQLiteWorldStore,
  config: ObserverRuntimeConfig & { readonly editorRoot?: string } = {},
  modelSettings?: ModelSettingsStore,
  secrets = new ProcessModelSecrets(),
  deathSummaryService?: DeathSummaryService,
) {
  const port = new SQLiteObserverPort(store, config);
  const openRouterManagement = new ProcessOpenRouterManagement();
  return createServer(async (request, response) => {
    try {
      await handleRequest(request, response, port, store, modelSettings, secrets, openRouterManagement, config.lifecycle, deathSummaryService, config.editorRoot);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : '伺服器錯誤' });
    }
  });
}

export async function startObserverServer(): Promise<void> {
  const host = process.env.ISLAND_HOST ?? '127.0.0.1';
  const port = Number(process.env.ISLAND_PORT ?? '4173');
  const databasePath = resolve(process.env.ISLAND_DB_PATH ?? './data/island.sqlite');
  await mkdir(dirname(databasePath), { recursive: true });
  const store = SQLiteWorldStore.open(databasePath);
  const modelSettings = ModelSettingsStore.open(resolve(process.env.ISLAND_SETTINGS_DB_PATH ?? './data/model-settings.sqlite'));
  const baseGraph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  const baseActionContent: SimulationActionContent = await loadSimulationActionContent(new URL('../../references/tables/', import.meta.url));
  const editorData = await readEditorData(resolve(moduleDirectory, '../..'));
  const defaultProfile = store.ensureDefaultMapProfile(editorMapContent(editorData));
  const monumentValleyDefaultDocuments = (baseActionContent.readableDocuments ?? [])
    .filter((row) => row.pool_type === 'monument-valley' && (row.text ?? '').trim().length > 0)
    .flatMap((row) => row.document_id ? [{ id: row.document_id, text: row.text ?? '' }] : []);
  const contentVersion = await sourceVersion();
  const secrets = new ProcessModelSecrets(modelSettings);
  const initialAssignments = modelAssignmentsBySlot(modelSettings.readSlots(), secrets);
  let configuredResidentCount = await readResidentCountSetting(resolve(moduleDirectory, '../..'));
  const existingWorld = store.readSnapshot();
  let selectedSetupMapId = existingWorld?.mapId && store.readMapProfile(existingWorld.mapId) ? existingWorld.mapId : defaultProfile.mapId;
  const activeProfile = store.readMapProfile(selectedSetupMapId) ?? defaultProfile;
  let graph = graphFromMapProfile(baseGraph, activeProfile);
  let actionContent: SimulationActionContent = actionContentForMapGraph(baseActionContent, graph, profileRows(activeProfile.nodeNotices));
  if (!existingWorld) {
    const world = createInitialWorld(graph, { seed: process.env.ISLAND_SEED ?? randomUUID(), contentVersion, residentCount: configuredResidentCount, modelAssignmentsBySlot: initialAssignments, monumentValleyDefaultDocuments, mapId: activeProfile.mapId });
    try {
      store.commit(0, syncWorldNodeNotices(world, actionContent.nodeNotices ?? []), []);
    } catch (error) {
      if (!store.readSnapshot()) throw error;
    }
  } else {
    if (existingWorld.sequence === 0) {
      const syncedMetadata = syncWorldNodeMetadataFromGraph(existingWorld, graph).state;
      const syncedWorld = syncWorldNodeNotices(syncedMetadata, actionContent.nodeNotices ?? []);
      if (syncedWorld !== existingWorld) store.commit(existingWorld.sequence, syncedWorld, []);
    } else {
      graph = graphFromWorldState(baseGraph, existingWorld, graph);
    }
  }
  actionContent = actionContentForMapGraph(baseActionContent, graph, profileRows(activeProfile.nodeNotices));
  const runner = new SimulationRunner({ store, settings: modelSettings, secrets, graph, actionContent });
  const deathSummaries = new DeathSummaryService(store, modelSettings, secrets);
  const deathSummaryTimer = setInterval(() => {
    void deathSummaries.processPending().catch((error: unknown) => {
      process.stderr.write(`死亡居民總結排程錯誤：${error instanceof Error ? error.message : '未知錯誤'}\n`);
    });
  }, 1500);
  store.ensureWorldSession(configuredResidentCount);
  const lifecycle: ObserverLifecyclePort = {
    read: () => {
      const session = store.readCurrentWorldSession();
      if (!session) return null;
      return { status: session.status, sessionId: session.sessionId, loadedSaveId: session.loadedSaveId, loadInstanceId: session.loadInstanceId, sessionName: session.name, residentCount: session.residentCount, nextResidentCount: configuredResidentCount, residentTemplateSlots: store.readSetupModelAssignments(configuredResidentCount), mapId: store.readSnapshot()?.mapId ?? defaultProfile.mapId, setupMapId: selectedSetupMapId, mapProfiles: store.listMapProfiles().map(({ mapId, name }) => ({ mapId, name })),
        saves: store.listWorldSessionSaves().map(({ saveId, sessionName, name, savedAt, sequence }) => ({ saveId, sessionName, name, savedAt, sequence })) };
    },
    setNextResidentCount: (residentCount) => { configuredResidentCount = residentCount; },
    setSetupMapId: (mapId) => { if (!store.readMapProfile(mapId)) throw new Error('找不到指定地圖存檔。'); selectedSetupMapId = mapId; },
    startNew: async (name, mapId) => {
      const current = store.readCurrentWorldSession();
      if (current?.status === 'in-progress') throw new Error('請先結束目前遊戲，再開始新局。');
      const selectedProfile = store.readMapProfile(mapId ?? selectedSetupMapId);
      if (!selectedProfile) throw new Error('找不到指定地圖存檔，請重新選擇。');
      graph = graphFromMapProfile(baseGraph, selectedProfile);
      actionContent = actionContentForMapGraph(baseActionContent, graph, profileRows(selectedProfile.nodeNotices));
      await runner.pauseAndWait();
      runner.setMapContent(graph, actionContent);
      configuredResidentCount = await readResidentCountSetting(resolve(moduleDirectory, '../..'));
      const residentCount = configuredResidentCount;
      const cardBindings = modelAssignmentsBySlot(modelSettings.readSlots(), secrets);
      const selectedCards = store.readSetupModelAssignments(residentCount);
      const missingResidents: number[] = [];
      const assignments = Object.fromEntries(Array.from({ length: residentCount }, (_, index) => {
        const residentIndex = index + 1;
        const templateSlot = selectedCards[residentIndex];
        const binding = templateSlot === undefined ? null : cardBindings[templateSlot] ?? null;
        if (!binding) missingResidents.push(residentIndex);
        return [residentIndex, binding];
      }));
      if (missingResidents.length > 0) {
        throw new Error(`無法開始新局：居民 ${missingResidents.join('、')} 尚未分配有效模型卡。請先完成模型卡設定並為每位居民選卡；同一張有效卡可以重複使用。`);
      }
      const initial = syncWorldNodeNotices(createInitialWorld(graph, { seed: randomUUID(), contentVersion, residentCount, modelAssignmentsBySlot: assignments, modelSlotIdsByResident: selectedCards, monumentValleyDefaultDocuments, mapId: selectedProfile.mapId }), actionContent.nodeNotices ?? []);
      store.startNewWorldSession(name ?? `輪迴島 ${new Date().toLocaleString('zh-TW')}`, residentCount, initial, selectedCards);
      runner.pause();
    },
    save: async (name) => { await runner.pauseAndWait(); store.saveCurrentWorldSession(name); },
    end: async () => { await runner.stopAndWaitForEnd(); store.endCurrentWorldSession(); },
    load: async (saveId) => {
      await runner.pauseAndWait();
      store.loadWorldSessionSave(saveId);
      const loaded = store.readSnapshot();
      const loadedProfile = loaded ? store.readMapProfile(loaded.mapId ?? 'default-map') : null;
      const resolvedProfile = loadedProfile ?? defaultProfile;
      const fallbackGraph = graphFromMapProfile(baseGraph, resolvedProfile);
      graph = loaded ? graphFromWorldState(baseGraph, loaded, fallbackGraph) : fallbackGraph;
      actionContent = actionContentForMapGraph(baseActionContent, graph, profileRows(resolvedProfile.nodeNotices));
      runner.setMapContent(graph, actionContent);
      runner.resume();
    },
  };
  const server = createObserverServer(store, {
    sourceGraph: graph,
    ...(actionContent.surfaceEntryEvents ? { surfaceEntryEvents: actionContent.surfaceEntryEvents } : {}),
    control: runner,
    lifecycle,
  }, modelSettings, secrets, deathSummaries);
  server.listen(port, host, () => process.stdout.write(`觀察台：http://${host}:${port}（資料庫：${databasePath}）\n`));
  const close = (): void => { clearInterval(deathSummaryTimer); server.close(); store.close(); modelSettings.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

async function sourceVersion(): Promise<string> {
  const root = resolve(moduleDirectory, '../..');
  const inputs = await Promise.all([
    readFile(resolve(root, 'references/SOURCE_INDEX.md')),
    readFile(resolve(root, 'references/tables/island_nodes.csv')),
    readFile(resolve(root, 'references/tables/island_edges.csv')),
    readFile(resolve(root, 'references/tables/readable_documents.csv')),
    readFile(resolve(root, 'references/tables/readable_document_pools.csv')),
    readFile(resolve(root, 'references/tables/node_notices.csv')),
  ]);
  return `sha256:${createHash('sha256').update(Buffer.concat(inputs)).digest('hex')}`;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  port: SQLiteObserverPort,
  store?: SQLiteWorldStore,
  modelSettings?: ModelSettingsStore,
  secrets = new ProcessModelSecrets(),
  openRouterManagement = new ProcessOpenRouterManagement(),
  lifecycle?: ObserverLifecyclePort,
  deathSummaryService?: DeathSummaryService,
  editorRootPath?: string,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const editorPrefix = `${editorBasePath().replace(/\/$/, '')}/editor`;
  if (request.method === 'GET' && url.pathname === `${editorPrefix}/ui-kit`) {
    sendHtml(response, editorUiKitMarkup(editorBasePath()));
    return;
  }
  if (request.method === 'GET' && (url.pathname === editorPrefix || url.pathname === `${editorPrefix}/`)) {
    sendHtml(response, editorMarkup(editorBasePath()));
    return;
  }
  if (url.pathname === `${editorPrefix}/api/editor/saves`) {
    if (!store) { sendJson(response, 503, { error: '存檔管理尚未連接。' }); return; }
    if (request.method === 'GET') {
      sendJson(response, 200, { saves: store.listWorldSessionSaves() });
      return;
    }
    if (request.method === 'DELETE') {
      try {
        const body = await readJsonBody(request);
        if (typeof body.saveId !== 'string') throw new Error('請指定存檔 ID。');
        store.deleteWorldSessionSave(body.saveId);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 409, { error: error instanceof Error ? error.message : '存檔未刪除。' });
      }
      return;
    }
  }
  if (url.pathname === `${editorPrefix}/api/editor/resident-count` && store) {
    const root = resolve(moduleDirectory, '../..');
    const snapshot = store.readSnapshot();
    if (request.method === 'GET') {
      const residentCount = await readResidentCountSetting(root);
      const currentResidentCount = snapshot ? Object.values(snapshot.actors).filter((actor) => actor.actorType === 'resident' && actor.alive).length : null;
      sendJson(response, 200, { residentCount, currentResidentCount, worldExists: snapshot !== null });
      return;
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      const residentCount = Number(body.residentCount);
      try {
        await writeResidentCountSetting(root, residentCount);
        if (store.readCurrentWorldSession()?.status === 'setup') store.setSetupResidentCount(residentCount);
        lifecycle?.setNextResidentCount?.(residentCount);
        sendJson(response, 200, { residentCount, currentResidentCount: snapshot ? Object.values(snapshot.actors).filter((actor) => actor.actorType === 'resident' && actor.alive).length : null, worldExists: snapshot !== null });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : '居民人數設定未儲存。' });
      }
      return;
    }
  }
  if (request.method === 'GET' && url.pathname === `${editorPrefix}/api/editor/data`) {
    const editorRoot = editorRootPath ?? resolve(moduleDirectory, '../..');
    const baseData = await readEditorData(editorRoot);
    if (!store) { sendJson(response, 200, baseData); return; }
    const defaultProfile = store.ensureDefaultMapProfile(editorMapContent(baseData));
    const requestedMapId = url.searchParams.get('mapId') || 'default-map';
    const profile = store.readMapProfile(requestedMapId) ?? defaultProfile;
    sendJson(response, 200, {
      ...baseData,
      nodes: profileRows(profile.nodes), edges: profileRows(profile.edges), notices: profileRows(profile.nodeNotices),
      mapId: profile.mapId, mapName: profile.name, mapProfiles: store.listMapProfiles().map(({ mapId, name }) => ({ mapId, name })),
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === `${editorPrefix}/api/editor/save`) {
    const body = await readEditorJson(request);
    try {
      if (store) {
        const mapData = body as Awaited<ReturnType<typeof readEditorData>> & {
          mapId?: string;
          mapName?: string;
          documentChanges?: { upsert?: Record<string, string>[]; deleteIds?: string[] };
        };
        const errors = validateData(mapData);
        if (errors.length) throw new Error(errors.join('\n'));
        const content = editorMapContent(mapData);
        const priorProfile = mapData.mapId ? store.readMapProfile(mapData.mapId) : null;
        if (mapData.mapId && !priorProfile) throw new Error('找不到指定地圖存檔。');
        const documentChanges = mapData.documentChanges ?? { upsert: [], deleteIds: [] };
        if (!Array.isArray(documentChanges.upsert) || !Array.isArray(documentChanges.deleteIds)) {
          throw new Error('文本卡變更格式不正確，地圖尚未儲存。');
        }
        const editorRoot = editorRootPath ?? resolve(moduleDirectory, '../..');
        const backup = await saveEditorDocumentChanges(editorRoot, {
          upsert: documentChanges.upsert,
          deleteIds: documentChanges.deleteIds,
        });
        let profile: MapProfile;
        try {
          if (priorProfile) await writeFile(resolve(backup, 'map-profile.json'), JSON.stringify(priorProfile, null, 2), 'utf8');
          profile = mapData.mapId
            ? store.updateMapProfile(mapData.mapId, mapData.mapName || '未命名地圖', content)
            : store.createMapProfile(mapData.mapName || '新地圖', content);
        } catch (error) {
          try {
            await copyFile(resolve(backup, 'readable_documents.csv'), resolve(editorRoot, 'references/tables/readable_documents.csv'));
          } catch (restoreError) {
            const failure = error instanceof Error ? error.message : String(error);
            const recovery = restoreError instanceof Error ? restoreError.message : String(restoreError);
            throw new Error(`地圖存檔更新失敗；共享文本復原也失敗，備份保留於 ${backup}。更新錯誤：${failure}；復原錯誤：${recovery}`);
          }
          throw error;
        }
        sendJson(response, 200, { saved: true, mapId: profile.mapId, mapName: profile.name, backup });
      } else {
        const editorData = body as Parameters<typeof saveEditorData>[1];
        const backup = await saveEditorData(editorRootPath ?? resolve(moduleDirectory, '../..'), {
          ...editorData,
          documentChanges: editorData.documentChanges ?? { upsert: [], deleteIds: [] },
        });
        sendJson(response, 200, { saved: true, backup });
      }
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : '資料驗證失敗' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/') {
    const snapshot = await port.readSnapshot();
    const settings = await readSettingsView(modelSettings, secrets, store?.readLatestAiFormatError() ?? null);
    sendHtml(response, `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>輪迴島觀察台</title><link rel="stylesheet" href="/observer.css"></head><body><div id="app">${renderObserverMarkup(snapshot, selectionFromUrl(url), settings)}</div><script src="/observer-client.js" defer></script></body></html>`);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/observer.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
    response.end(await readFile(resolve(moduleDirectory, 'observer.css')));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/observer-client.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(observerClientScript);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/resident-intents') {
    if (!store) { sendJson(response, 503, { error: '居民意圖資料目前無法讀取。' }); return; }
    const residentId = url.searchParams.get('residentId')?.trim();
    const snapshot = await port.readSnapshot();
    const resident = residentId ? snapshot.residents.find((candidate) => candidate.id === residentId) : undefined;
    if (!residentId || !resident) {
      sendJson(response, 404, { error: '找不到這位居民。' });
      return;
    }
    const intents = resident.intents ?? [];
    sendJson(response, 200, { intents: intents.slice(-20).reverse(), total: intents.length });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/observer') {
    const snapshot = await port.readSnapshot();
    const settings = await readSettingsView(modelSettings, secrets, store?.readLatestAiFormatError() ?? null);
    sendJson(response, 200, { markup: renderObserverMarkup(snapshot, selectionFromUrl(url), settings) });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/setup') {
    const setup = lifecycle?.read();
    if (!setup) { sendJson(response, 503, { error: '新局設定尚未連接。' }); return; }
    sendJson(response, 200, { status: setup.status, residentCount: setup.nextResidentCount ?? setup.residentCount, setupMapId: setup.setupMapId, mapProfiles: setup.mapProfiles });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/setup/map-profile') {
    if (!store || !lifecycle) { sendJson(response, 503, { error: '新局地圖選擇尚未連接。' }); return; }
    if (store.readCurrentWorldSession()?.status !== 'setup') { sendJson(response, 409, { error: '只能在新局開始前選擇地圖。' }); return; }
    const body = await readJsonBody(request);
    try {
      if (typeof body.mapId !== 'string') throw new Error('請指定地圖存檔。');
      lifecycle.setSetupMapId?.(body.mapId);
      sendJson(response, 200, { mapId: body.mapId });
    } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : '地圖選擇未保存。' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/setup/resident-count') {
    if (!store || !lifecycle) { sendJson(response, 503, { error: '新局人數設定尚未連接。' }); return; }
    const body = await readJsonBody(request);
    const residentCount = Number(body.residentCount);
    try {
      const root = resolve(moduleDirectory, '../..');
      await writeResidentCountSetting(root, residentCount);
      if (store.readCurrentWorldSession()?.status === 'setup') store.setSetupResidentCount(residentCount);
      lifecycle.setNextResidentCount?.(residentCount);
      sendJson(response, 200, { residentCount });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : '居民人數未儲存。' });
    }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/lifecycle') {
    if (!lifecycle) { sendJson(response, 503, { error: '遊戲局控制尚未連接。' }); return; }
    const body = await readJsonBody(request);
    try {
      if (body.kind === 'start') await lifecycle.startNew(typeof body.name === 'string' ? body.name : undefined, typeof body.mapId === 'string' ? body.mapId : undefined);
      else if (body.kind === 'save' && typeof body.name === 'string') await lifecycle.save(body.name);
      else if (body.kind === 'end') await lifecycle.end();
      else if (body.kind === 'load' && typeof body.saveId === 'string') await lifecycle.load(body.saveId);
      else { sendJson(response, 400, { error: '遊戲局操作格式不正確。' }); return; }
      sendJson(response, 200, { ok: true, lifecycle: lifecycle.read() });
    } catch (error) { sendJson(response, 409, { error: error instanceof Error ? error.message : '遊戲局操作未完成。' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/setup/model-assignment') {
    if (!store || !modelSettings) { sendJson(response, 503, { error: '新局模型卡設定尚未連接。' }); return; }
    const sessionStatus = store.readCurrentWorldSession()?.status;
    if (sessionStatus !== 'setup' && sessionStatus !== 'ended') { sendJson(response, 409, { error: '目前遊戲進行中，無法安排下一局的模型卡。' }); return; }
    const body = await readJsonBody(request);
    const residentIndex = Number(body.residentIndex);
    const templateSlot = Number(body.templateSlot);
    const template = modelSettings.readSlots().find((slot) => slot.slotId === templateSlot);
    if (!template || !isModelSlotReady(template, secrets.has(template.credentialRef))) { sendJson(response, 400, { error: '請先完成模型卡的供應商、API Base URL、模型與金鑰設定，再分配給居民。' }); return; }
    try {
      const residentCount = await readResidentCountSetting(resolve(moduleDirectory, '../..'));
      store.setSetupModelAssignment(residentIndex, templateSlot, residentCount);
      sendJson(response, 200, { saved: true });
    } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : '模型卡分配未完成。' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/session/model-assignment') {
    if (!store || !modelSettings) { sendJson(response, 503, { error: '本局模型卡資料尚未連接。' }); return; }
    if (store.readCurrentWorldSession()?.status !== 'in-progress') { sendJson(response, 409, { error: '只有進行中的遊戲可以調整本局模型卡。' }); return; }
    const body = await readJsonBody(request);
    const actorId = typeof body.actorId === 'string' ? body.actorId : '';
    const slotId = Number(body.slotId);
    const snapshot = store.readSnapshot();
    const actor = snapshot?.actors[actorId];
    const binding = modelAssignmentsBySlot(modelSettings.readSlots(), secrets)[slotId];
    if (!snapshot || !actor || actor.actorType !== 'resident' || !Number.isInteger(slotId) || !binding?.provider || !binding.model) {
      sendJson(response, 400, { error: '請選擇有效居民與已設定的模型卡。' }); return;
    }
    const updatedActor = { ...actor, modelSlotId: slotId, modelAssignment: binding, modelId: `${binding.provider}/${binding.model}`, modelSizeB: binding.modelSizeB ?? null, sizeAtLeast8BConfirmed: binding.sizeAtLeast8BConfirmed ?? false, styleDescription: binding.styleDescription ?? null };
    store.commit(snapshot.sequence, { ...snapshot, actors: { ...snapshot.actors, [actorId]: updatedActor } }, []);
    sendJson(response, 200, { saved: true });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/slot') {
    if (!store || !modelSettings) { sendJson(response, 503, { error: '模型設定儲存尚未連接。' }); return; }
    if (store.readCurrentWorldSession()?.status === 'in-progress') { sendJson(response, 409, { error: '遊戲中編輯只能調整本局居民卡片分配；模板內容請在開始新局前修改。' }); return; }
    const body = await readJsonBody(request);
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.length > 0 ? body.apiKey : undefined;
    if (apiKey && apiKey.length > 4096) throw new Error('API 金鑰長度超出限制。');
    const previous = Number.isInteger(body.slotId)
      ? modelSettings.readSlots().find((candidate) => candidate.slotId === body.slotId)
      : undefined;
    const slot = parseModelSlot(body, previous?.maxContextCharacters ?? 8000);
    const saved = modelSettings.saveSlot(slot);
    if (apiKey !== undefined) {
      secrets.set(saved.credentialRef, apiKey);
      if (previous && previous.credentialRef !== saved.credentialRef) secrets.set(previous.credentialRef, undefined, true);
    }
    else if (body.clearApiKey === true) secrets.set(saved.credentialRef, undefined, true);
    else if (previous && previous.credentialRef !== saved.credentialRef
      && previous.provider === saved.provider && previous.baseUrl === saved.baseUrl) {
      if (!secrets.copy(previous.credentialRef, saved.credentialRef)) secrets.set(previous.credentialRef, undefined, true);
    } else if (previous && previous.credentialRef !== saved.credentialRef) {
      secrets.set(previous.credentialRef, undefined, true);
    }
    if (previous && previous.credentialRef !== saved.credentialRef) secrets.set(previous.credentialRef, undefined, true);
    const assignments = modelAssignmentsBySlot(modelSettings.readSlots(), secrets);
    const currentState = store.readSnapshot();
    if (currentState) {
      const boundState = bindUnstartedInitialResidents(currentState, assignments);
      if (boundState !== currentState) store.commit(currentState.sequence, boundState, []);
    }
    sendJson(response, 200, { saved: true, ready: isModelSlotReady(saved, secrets.has(saved.credentialRef)), apiKeyConfigured: secrets.has(saved.credentialRef) });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/slot/create') {
    if (!store || !modelSettings) { sendJson(response, 503, { error: '模型設定儲存尚未連接。' }); return; }
    if (store.readCurrentWorldSession()?.status === 'in-progress') { sendJson(response, 409, { error: '遊戲中不可新增模型卡；請先結束本局。' }); return; }
    const slot = modelSettings.createSlot();
    sendJson(response, 200, { slotId: slot.slotId });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/summarizer') {
    if (!modelSettings) { sendJson(response, 503, { error: '總結者模型卡儲存尚未連接。' }); return; }
    const body = await readJsonBody(request);
    const text = (key: string): string | null => typeof body[key] === 'string' && String(body[key]).trim() ? String(body[key]).trim() : null;
    const modelSlotId = body.modelSlotId === null || body.modelSlotId === '' ? null : Number(body.modelSlotId);
    if (modelSlotId !== null && !Number.isSafeInteger(modelSlotId)) { sendJson(response, 400, { error: '請選擇有效的模型卡。' }); return; }
    const saved = modelSettings.saveSummarizer({ modelSlotId, prompt: String(body.prompt ?? '').trim() });
    const slot = modelSettings.readSlots().find(({ slotId }) => slotId === saved.modelSlotId);
    const ready = Boolean(slot && isModelSlotReady(slot, secrets.has(slot.credentialRef)));
    sendJson(response, 200, { saved: true, ready, apiKeyConfigured: Boolean(slot && secrets.has(slot.credentialRef)) });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/death-summaries/retry') {
    if (!deathSummaryService) { sendJson(response, 503, { error: '死亡總結服務尚未連接。' }); return; }
    const body = await readJsonBody(request);
    const residentId = typeof body.residentId === 'string' ? body.residentId.trim() : '';
    const summaryId = typeof body.summaryId === 'string' ? body.summaryId.trim() : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const sourceSaveId = typeof body.sourceSaveId === 'string' && body.sourceSaveId.trim() ? body.sourceSaveId.trim() : body.sourceSaveId === null ? null : undefined;
    const loadInstanceId = typeof body.loadInstanceId === 'string' ? body.loadInstanceId.trim() : null;
    if (!residentId || residentId.length > 120 || !summaryId || summaryId.length > 240 || !sessionId || sessionId.length > 120 || sourceSaveId === undefined || (sourceSaveId !== null && sourceSaveId.length > 120) || !loadInstanceId || loadInstanceId.length > 120) { sendJson(response, 400, { error: '請指定有效的存檔摘要與居民。' }); return; }
    const result = deathSummaryService.retryFailedSummary({ summaryId, sessionId, sourceSaveId, loadInstanceId, residentId });
    if (result.status === 'pending') {
      sendJson(response, 202, { status: 'pending', message: '已排入此居民的死亡總結重試。' });
      void deathSummaryService.processPending().catch((error: unknown) => {
        process.stderr.write(`死亡居民總結重試錯誤：${error instanceof Error ? error.message : '未知錯誤'}\n`);
      });
      return;
    }
    if (result.status === 'missing') { sendJson(response, 404, { status: 'missing', error: '找不到此存檔中該居民的死亡總結。' }); return; }
    if (result.status === 'stale-session') { sendJson(response, 409, { status: result.status, error: '此摘要屬於其他存檔；請切換至該存檔後再操作。' }); return; }
    if (result.status === 'ambiguous-save') { sendJson(response, 409, { status: result.status, error: '此摘要沒有來源存檔 ID，無法確認它屬於目前載入的存檔，因此拒絕重試。' }); return; }
    if (result.status === 'not-dead') { sendJson(response, 409, { status: result.status, error: '居民目前仍存活，沒有可重試的死亡總結。' }); return; }
    if (result.status === 'stale-save') { sendJson(response, 409, { status: result.status, error: '此摘要屬於另一個存檔；請載入其來源存檔後再操作。' }); return; }
    if (result.status === 'stale-branch') { sendJson(response, 409, { status: result.status, error: '此摘要屬於同一存檔的另一載入分支；為避免使用錯誤事件紀錄，拒絕重試。' }); return; }
    const labels = { pending: '等待處理', running: '生成中', complete: '已完成', failed: '失敗' } as const;
    sendJson(response, 409, { status: result.status, error: `此總結目前為「${labels[result.status]}」；只有失敗項目可以重試。` });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/models') {
    if (!modelSettings) { sendJson(response, 503, { error: '模型設定尚未連接。' }); return; }
    const body = await readJsonBody(request);
    const slotId = Number(body.slotId);
    const slot = modelSettings.readSlots().find((candidate) => candidate.slotId === slotId);
    if (!slot) { sendJson(response, 400, { error: '請先選擇有效的模型槽位。' }); return; }
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.length > 0
      ? body.apiKey
      : secrets.getForCredential(slot.credentialRef);
    if (!apiKey) { sendJson(response, 400, { error: '請先輸入 API 金鑰，或先儲存已設定的金鑰。' }); return; }
    try {
      const baseUrl = String(body.baseUrl ?? slot.baseUrl ?? '');
      const models = await fetchCompatibleModels(baseUrl, apiKey);
      sendJson(response, 200, { models });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : '無法載入模型清單。' });
    }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/openrouter/management-key') {
    const body = await readJsonBody(request);
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key || key.length > 4096) { sendJson(response, 400, { error: '請輸入有效的 OpenRouter Management key。' }); return; }
    try {
      const account = await fetchOpenRouterAccount(key);
      openRouterManagement.setKey(key);
      sendJson(response, 200, { saved: true, ...account });
    } catch (error) {
      sendJson(response, 403, { error: error instanceof Error ? error.message : '無法驗證 Management key。' });
    }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/openrouter/account') {
    const key = openRouterManagement.getKey();
    if (!key) { sendJson(response, 400, { error: '請先在本次執行中設定 Management key。' }); return; }
    try { sendJson(response, 200, await fetchOpenRouterAccount(key)); }
    catch (error) { sendJson(response, 502, { error: error instanceof Error ? error.message : 'OpenRouter 帳務資料未取得。' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/openrouter/keys/create') {
    if (!modelSettings) { sendJson(response, 503, { error: '模型設定尚未連接。' }); return; }
    const body = await readJsonBody(request);
    const slotId = Number(body.slotId);
    const slot = modelSettings.readSlots().find((candidate) => candidate.slotId === slotId);
    if (!slot || !isOpenRouterUrl(slot.baseUrl ?? '')) { sendJson(response, 400, { error: '請先將此槽位設定為 OpenRouter。' }); return; }
    if (secrets.has(slot.credentialRef)) { sendJson(response, 409, { error: '此槽位已有已保存金鑰；為避免重複建立，請先清除或使用現有金鑰。' }); return; }
    const managementKey = openRouterManagement.getKey();
    if (!managementKey) { sendJson(response, 400, { error: '請先在本次執行中設定 Management key。' }); return; }
    try {
      sendJson(response, 200, await createAndStoreOpenRouterSlotKey(slotId, slot.credentialRef, managementKey, secrets, openRouterManagement));
    } catch (error) { sendJson(response, 502, { error: error instanceof Error ? error.message : 'OpenRouter key 未建立。' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/control') {
    const body = await readJsonBody(request);
    if (body.kind === 'pause' || body.kind === 'resume') {
      await port.requestControl({ kind: body.kind });
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 400, { error: '控制要求格式不正確。' });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('找不到頁面');
}

export type CompatibleModel = {
  readonly id: string;
  readonly inputUsdPerMillion: number | null;
  readonly outputUsdPerMillion: number | null;
};

export async function fetchCompatibleModels(baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<readonly CompatibleModel[]> {
  if (!baseUrl.trim() || !apiKey || apiKey.length > 4096) throw new Error('請提供有效的 API Base URL 與金鑰。');
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw new Error('API Base URL 格式不正確。'); }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('遠端 API Base URL 必須使用 HTTPS。');
  }
  if (base.username || base.password || base.search || base.hash) throw new Error('API Base URL 不可包含帳密、查詢字串或片段。');
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  const endpoint = new URL('models', base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`模型清單請求失敗（HTTP ${response.status}）。`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('模型服務回傳的內容不是有效 JSON。'); }
    if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
      throw new Error('模型服務回傳格式不支援；預期為 OpenAI-compatible data 清單。');
    }
    const uniqueModels = new Map<string, CompatibleModel>();
    for (const entry of (payload as { data: unknown[] }).data) {
      if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'string') continue;
      const id = (entry as { id: string }).id.trim();
      if (!id || uniqueModels.has(id)) continue;
      const pricing = (entry as { pricing?: { prompt?: unknown; completion?: unknown } }).pricing;
      const perMillion = (value: unknown): number | null => {
        const perToken = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
        return Number.isFinite(perToken) && perToken >= 0 ? perToken * 1_000_000 : null;
      };
      uniqueModels.set(id, {
        id,
        inputUsdPerMillion: isOpenRouterUrl(baseUrl) ? perMillion(pricing?.prompt) : null,
        outputUsdPerMillion: isOpenRouterUrl(baseUrl) ? perMillion(pricing?.completion) : null,
      });
      if (uniqueModels.size >= 500) break;
    }
    return [...uniqueModels.values()];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('模型清單請求逾時（10 秒）。');
    if (error instanceof Error) throw error;
    throw new Error('無法連線到模型服務。');
  } finally {
    clearTimeout(timeout);
  }
}

function isOpenRouterUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'openrouter.ai';
  } catch { return false; }
}

type OpenRouterKeySummary = {
  readonly hash: string;
  readonly name: string;
  readonly usage: number | null;
  readonly disabled: boolean;
};

export class ProcessOpenRouterManagement {
  private managementKey: string | undefined;
  private readonly slotKeys = new Map<number, string>();

  setKey(key: string): void { this.managementKey = key; }
  getKey(): string | undefined { return this.managementKey; }
  rememberSlotKey(slotId: number, hash: string): void { this.slotKeys.set(slotId, hash); }
  getSlotKeyHash(slotId: number): string | undefined { return this.slotKeys.get(slotId); }
  clear(): void { this.managementKey = undefined; this.slotKeys.clear(); }
}

function openRouterApiUrl(path: string): URL {
  return new URL(`https://openrouter.ai/api/v1/${path.replace(/^\/+/, '')}`);
}

async function openRouterManagementRequest(path: string, managementKey: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!managementKey || managementKey.length > 4096) throw new Error('Management key 未提供。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(openRouterApiUrl(path), {
      ...init,
      headers: { accept: 'application/json', authorization: `Bearer ${managementKey}`, ...init.headers },
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('OpenRouter 管理 API 請求逾時。');
    throw new Error('OpenRouter 管理 API 連線失敗。');
  } finally { clearTimeout(timeout); }
}

async function parseOpenRouterData(response: Response, label: string): Promise<unknown> {
  if (response.status === 403 || response.status === 401) throw new Error('Management key 權限不足或無效；未取得帳務資料。');
  if (!response.ok) throw new Error(`${label}未取得（HTTP ${response.status}）。`);
  try { return await response.json(); } catch { throw new Error(`${label}回傳格式無法讀取。`); }
}

export async function fetchOpenRouterAccount(managementKey: string, fetcher: typeof fetch = fetch): Promise<{
  readonly credits: { readonly totalCredits: number; readonly totalUsage: number };
  readonly keys: readonly OpenRouterKeySummary[];
}> {
  const [creditsResponse, keysResponse] = await Promise.all([
    openRouterManagementRequest('credits', managementKey, {}, fetcher),
    openRouterManagementRequest('keys', managementKey, {}, fetcher),
  ]);
  const [creditsPayload, keysPayload] = await Promise.all([
    parseOpenRouterData(creditsResponse, '帳務資料'), parseOpenRouterData(keysResponse, 'Key 清單'),
  ]);
  const creditsData = typeof creditsPayload === 'object' && creditsPayload !== null
    ? (creditsPayload as { data?: unknown }).data : undefined;
  const keyData = typeof keysPayload === 'object' && keysPayload !== null
    ? (keysPayload as { data?: unknown }).data : undefined;
  if (typeof creditsData !== 'object' || creditsData === null || !Array.isArray(keyData)) throw new Error('OpenRouter 管理 API 回傳格式不支援。');
  const totalCredits = Number((creditsData as { total_credits?: unknown }).total_credits);
  const totalUsage = Number((creditsData as { total_usage?: unknown }).total_usage);
  if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) throw new Error('OpenRouter 未回傳有效的實際帳務金額。');
  const keys: OpenRouterKeySummary[] = [];
  for (const item of keyData) {
    if (typeof item !== 'object' || item === null) continue;
    const value = item as { hash?: unknown; name?: unknown; usage?: unknown; disabled?: unknown };
    if (typeof value.hash !== 'string' || typeof value.name !== 'string') continue;
    const usageValue = value.usage === null || value.usage === undefined ? NaN : Number(value.usage);
    keys.push({
      hash: value.hash,
      name: value.name,
      usage: Number.isFinite(usageValue) && usageValue >= 0 ? usageValue : null,
      disabled: value.disabled === true,
    });
  }
  return { credits: { totalCredits, totalUsage }, keys };
}

export async function createOpenRouterInferenceKey(managementKey: string, name: string, fetcher: typeof fetch = fetch): Promise<{
  readonly secret: string;
  readonly hash: string;
  readonly name: string;
}> {
  if (!name.trim() || name.length > 100) throw new Error('槽位 key 名稱無效。');
  const response = await openRouterManagementRequest('keys', managementKey, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  }, fetcher);
  const payload = await parseOpenRouterData(response, '新推理 key');
  if (typeof payload !== 'object' || payload === null) throw new Error('OpenRouter 未回傳可用的推理 key。');
  const result = payload as { key?: unknown; data?: { hash?: unknown; name?: unknown } };
  if (typeof result.key !== 'string' || typeof result.data?.hash !== 'string') throw new Error('OpenRouter 未回傳一次性 key 或 key ID。');
  return { secret: result.key, hash: result.data.hash, name: typeof result.data.name === 'string' ? result.data.name : name.trim() };
}

export async function createAndStoreOpenRouterSlotKey(
  slotId: number,
  credentialRef: string,
  managementKey: string,
  secrets: ProcessModelSecrets,
  management: ProcessOpenRouterManagement,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly created: true; readonly slotId: number; readonly keyConfigured: true; readonly name: string; readonly hash: string }> {
  if (!Number.isSafeInteger(slotId) || slotId < 1) throw new Error('模型槽位必須是正整數。');
  if (secrets.has(credentialRef) || management.getSlotKeyHash(slotId)) throw new Error('此槽位已有已保存金鑰，避免重複建立。');
  const created = await createOpenRouterInferenceKey(managementKey, `IslandSim resident slot ${slotId}`, fetcher);
  secrets.set(credentialRef, created.secret);
      management.rememberSlotKey(slotId, created.hash);
  return { created: true, slotId, keyConfigured: true, name: created.name, hash: created.hash };
}

async function readSettingsView(modelSettings?: ModelSettingsStore, secrets = new ProcessModelSecrets(), latestAiFormatError: ReturnType<SQLiteWorldStore['readLatestAiFormatError']> = null): Promise<ModelSettingsView> {
  const slots = modelSettings?.readSlots() ?? [];
  const summary = modelSettings?.readSummarizer();
  return {
    slots: slots.map(({ credentialRef, maxOutputTokens: _maxOutputTokens, modelSizeB: _modelSizeB, sizeAtLeast8BConfirmed: _sizeAtLeast8BConfirmed, ...slot }) => ({ ...slot, apiKeyConfigured: Boolean(credentialRef && secrets.has(credentialRef)) })),
    latestAiFormatError,
    ...(modelSettings && summary ? { summarizer: { modelSlotId: summary.modelSlotId, prompt: summary.prompt }, deathSummaries: modelSettings.listDeathSummaries() } : {}),
  };
}

function parseModelSlot(body: Record<string, unknown>, defaultMaxContextCharacters = 8000): ModelSlotInput {
  const text = (key: string): string | null => {
    const value = body[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };
  const number = (key: string, integer: boolean): number | null => {
    const value = text(key);
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed))) throw new Error(`設定欄位 ${key} 格式錯誤。`);
    return parsed;
  };
  if (!Number.isInteger(body.slotId)) throw new Error('模型槽位編號格式錯誤。');
  const fallbackModels = (text('fallbackModels') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  return {
    slotId: body.slotId as number,
    provider: text('provider'),
    baseUrl: text('baseUrl'),
    model: text('model'),
    fallbackModels,
    inputUsdPerMillion: number('inputUsdPerMillion', false),
    outputUsdPerMillion: number('outputUsdPerMillion', false),
    maxInputTokens: body.maxInputTokens === undefined ? 8000 : number('maxInputTokens', true),
    maxContextCharacters: body.maxContextCharacters === undefined ? defaultMaxContextCharacters : number('maxContextCharacters', true) ?? 8000,
    modelSizeB: null,
    sizeAtLeast8BConfirmed: false,
    styleDescription: text('styleDescription'),
  };
}

function selectionFromUrl(url: URL): ObserverSelection {
  const residentId = url.searchParams.get('residentId');
  const eventResidentId = url.searchParams.get('eventResidentId')?.trim();
  const eventPageValue = Number(url.searchParams.get('eventPage'));
  const eventSelection = {
    ...(eventResidentId ? { eventResidentId } : {}),
    ...(Number.isSafeInteger(eventPageValue) && eventPageValue > 0 ? { eventPage: eventPageValue } : {}),
  };
  const activeTabValue = url.searchParams.get('activeTab');
  const activeTab = activeTabValue === 'world' || activeTabValue === 'residents' || activeTabValue === 'history' || activeTabValue === 'settings' || activeTabValue === 'death-summaries' || activeTabValue === 'format-errors' ? activeTabValue : undefined;
  const mapView: ObserverSelection['mapView'] = url.searchParams.get('mapView') === 'dungeon' ? 'dungeon' : 'surface';
  const floorValue = Number(url.searchParams.get('dungeonFloor'));
  const dungeonFloor = [1, 2, 3].includes(floorValue) ? floorValue : undefined;
  const dungeonCellId = url.searchParams.get('dungeonCellId');
  const mapSelection = {
    mapView,
    ...(dungeonFloor === undefined ? {} : { dungeonFloor }),
    ...(dungeonCellId && ['S', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'E'].includes(dungeonCellId) ? { dungeonCellId } : {}),
  };
  if (residentId) return { residentId, ...eventSelection, ...mapSelection, ...(activeTab ? { activeTab } : {}) };
  const nodeId = url.searchParams.get('nodeId');
  return { ...(nodeId ? { nodeId } : {}), ...eventSelection, ...mapSelection, ...(activeTab ? { activeTab } : {}) };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 4096) throw new Error('控制要求過大。');
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('控制要求必須是 JSON 物件。');
  return parsed as Record<string, unknown>;
}

async function readEditorJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 5_000_000) throw new Error('編輯資料過大。');
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('編輯資料必須是 JSON 物件。');
  return parsed as Record<string, unknown>;
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startObserverServer();
