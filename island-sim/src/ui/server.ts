import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { loadIslandGraph } from '../content/island.ts';
import { loadSimulationActionContent } from '../content/actions.ts';
import { createInitialWorld } from '../engine/world.ts';
import { SimulationRunner } from '../ai/simulation-runner.ts';
import type { SimulationActionContent } from '../engine/simulation.ts';
import { ModelSettingsStore, ProcessModelSecrets, isModelSlotReady, type ModelSlotInput } from '../ai/model-settings.ts';
import { bindUnstartedInitialResidents, modelAssignmentsBySlot } from '../ai/model-binding.ts';
import { renderObserverMarkup, type ObserverSelection } from './observer.ts';
import { SQLiteObserverPort, type ObserverRuntimeConfig } from './observer-adapter.ts';
import type { ModelSettingsView } from './observer.ts';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const clientScript = `
const root = document.querySelector('#app');
let nodeId; let residentId;
let activeTab = root.querySelector('.observer-shell')?.dataset.activeTab || 'world';
let activeModelSlot = 1;
const formDrafts = new Map();
function captureDrafts() {
  const slotSelect = root.querySelector('[data-slot-select]');
  if (slotSelect) activeModelSlot = Number(slotSelect.value) || activeModelSlot;
  for (const form of root.querySelectorAll('form[data-model-settings]')) {
    const slot = form.dataset.slotId;
    for (const field of form.querySelectorAll('input[name]')) {
      formDrafts.set(slot + ':' + field.name, field.type === 'checkbox' ? String(field.checked) : field.value);
    }
  }
}
function restoreDrafts() {
  const slotSelect = root.querySelector('[data-slot-select]');
  if (slotSelect) slotSelect.value = String(activeModelSlot);
  for (const form of root.querySelectorAll('form[data-model-settings]')) {
    form.hidden = Number(form.dataset.slotId) !== activeModelSlot;
    const slot = form.dataset.slotId;
    for (const field of form.querySelectorAll('input[name]')) {
      const value = formDrafts.get(slot + ':' + field.name);
      if (value !== undefined) {
        if (field.type === 'checkbox') field.checked = value === 'true';
        else field.value = value;
      }
    }
  }
}
function activateTab(tab) {
  activeTab = tab;
  for (const button of root.querySelectorAll('[role="tab"]')) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const panel of root.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.id !== 'panel-' + tab;
}
async function refresh() {
  captureDrafts();
  const params = new URLSearchParams();
  if (nodeId) params.set('nodeId', nodeId);
  if (residentId) params.set('residentId', residentId);
  params.set('activeTab', activeTab);
  const response = await fetch('/api/observer?' + params.toString());
  if (!response.ok) return;
  root.innerHTML = (await response.json()).markup;
  restoreDrafts();
}
root.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-tab], [data-node-id], [data-resident-id], [data-control]');
  if (!target) return;
  if (target.dataset.tab) { activateTab(target.dataset.tab); return; }
  if (target.dataset.nodeId) { nodeId = target.dataset.nodeId; residentId = undefined; activeTab = 'world'; await refresh(); return; }
  if (target.dataset.residentId) { residentId = target.dataset.residentId; nodeId = undefined; activeTab = 'residents'; await refresh(); return; }
  const action = target.dataset.control;
  if (action === 'pause' || action === 'resume') {
    const response = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: action }) });
    if (!response.ok) alert((await response.json()).error || '控制要求未完成');
    await refresh();
  }
});
root.addEventListener('change', async (event) => {
  const slotSelect = event.target.closest('select[data-slot-select]');
  if (slotSelect) {
    activeModelSlot = Number(slotSelect.value) || 1;
    for (const form of root.querySelectorAll('form[data-model-settings]')) form.hidden = Number(form.dataset.slotId) !== activeModelSlot;
    return;
  }
  const select = event.target.closest('select[data-control="speed"]');
  if (!select) return;
  const response = await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'speed', speedId: select.value }) });
  if (!response.ok) alert((await response.json()).error || '調速要求未完成');
  await refresh();
});
root.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  const buttons = [...root.querySelectorAll('[role="tab"]')];
  let index = buttons.indexOf(tab);
  if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
  else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = buttons.length - 1;
  else return;
  event.preventDefault();
  const next = buttons[index];
  next.focus();
  activateTab(next.dataset.tab);
});
root.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-model-settings]');
  if (!form) return;
  event.preventDefault();
  const fields = new FormData(form);
  const slotId = Number(form.dataset.slotId);
  const payload = {
    slotId,
    provider: String(fields.get('provider') || ''),
    baseUrl: String(fields.get('baseUrl') || ''),
    model: String(fields.get('model') || ''),
    modelSizeB: String(fields.get('modelSizeB') || ''),
    sizeAtLeast8BConfirmed: fields.get('sizeAtLeast8BConfirmed') === 'true',
    styleDescription: String(fields.get('styleDescription') || ''),
    apiKey: String(fields.get('apiKey') || ''),
    clearApiKey: fields.get('clearApiKey') === 'true',
    inputUsdPerMillion: String(fields.get('inputUsdPerMillion') || ''),
    outputUsdPerMillion: String(fields.get('outputUsdPerMillion') || ''),
    maxInputTokens: String(fields.get('maxInputTokens') || ''),
    maxOutputTokens: String(fields.get('maxOutputTokens') || ''),
    fallbackModels: String(fields.get('fallbackModels') || ''),
  };
  const response = await fetch('/api/settings/slot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) alert(result.error || '設定未儲存');
  else {
    form.querySelector('input[name="apiKey"]').value = '';
    form.querySelector('input[name="clearApiKey"]').checked = false;
    captureDrafts();
    alert(result.ready ? '設定已儲存；模型呼叫僅在執行器恢復後發生。API 金鑰只留在本次執行。' : '欄位已儲存；必要設定或金鑰尚未齊全，因此不會呼叫模型。');
    await refresh();
  }
});
setInterval(() => void refresh(), 5000);
`;

export function createObserverServer(
  store: SQLiteWorldStore,
  config: ObserverRuntimeConfig = { speedOptions: [] },
  modelSettings?: ModelSettingsStore,
  secrets = new ProcessModelSecrets(),
) {
  const port = new SQLiteObserverPort(store, config);
  return createServer(async (request, response) => {
    try {
      await handleRequest(request, response, port, store, modelSettings, secrets);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : '伺服器錯誤' });
    }
  });
}

export async function startObserverServer(): Promise<void> {
  const databasePath = resolve(process.env.ISLAND_DB_PATH ?? './data/island.sqlite');
  await mkdir(dirname(databasePath), { recursive: true });
  const store = SQLiteWorldStore.open(databasePath);
  const modelSettings = ModelSettingsStore.open(resolve(process.env.ISLAND_SETTINGS_DB_PATH ?? './data/model-settings.sqlite'));
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  const actionContent: SimulationActionContent = await loadSimulationActionContent(new URL('../../references/tables/', import.meta.url));
  const contentVersion = await sourceVersion();
  const initialAssignments = modelAssignmentsBySlot(modelSettings.readSlots(), new ProcessModelSecrets());
  if (!store.readSnapshot()) {
    const world = createInitialWorld(graph, { seed: process.env.ISLAND_SEED ?? randomUUID(), contentVersion, modelAssignmentsBySlot: initialAssignments });
    try {
      store.commit(0, world, []);
    } catch (error) {
      if (!store.readSnapshot()) throw error;
    }
  }
  const secrets = new ProcessModelSecrets();
  const runner = new SimulationRunner({ store, settings: modelSettings, secrets, graph, actionContent });
  const server = createObserverServer(store, {
    speedOptions: [
      { id: 'half', label: '0.5 倍', multiplier: 0.5 },
      { id: 'normal', label: '1 倍', multiplier: 1 },
    ],
    sourceGraph: graph,
    control: runner,
  }, modelSettings, secrets);
  const host = process.env.ISLAND_HOST ?? '127.0.0.1';
  const port = Number(process.env.ISLAND_PORT ?? '4173');
  server.listen(port, host, () => process.stdout.write(`觀察台：http://${host}:${port}（資料庫：${databasePath}）\n`));
  const close = (): void => { server.close(); store.close(); modelSettings.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

async function sourceVersion(): Promise<string> {
  const root = resolve(moduleDirectory, '../..');
  const inputs = await Promise.all([
    readFile(resolve(root, 'references/SOURCE_INDEX.md')),
    readFile(resolve(root, 'references/tables/island_nodes.csv')),
    readFile(resolve(root, 'references/tables/island_edges.csv')),
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
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/') {
    const snapshot = await port.readSnapshot();
    const settings = await readSettingsView(store, modelSettings, secrets);
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
    response.end(clientScript);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/observer') {
    const snapshot = await port.readSnapshot();
    const settings = await readSettingsView(store, modelSettings, secrets);
    sendJson(response, 200, { markup: renderObserverMarkup(snapshot, selectionFromUrl(url), settings) });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/slot') {
    if (!store || !modelSettings) { sendJson(response, 503, { error: '模型設定儲存尚未連接。' }); return; }
    const body = await readJsonBody(request);
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.length > 0 ? body.apiKey : undefined;
    if (apiKey && apiKey.length > 4096) throw new Error('API 金鑰長度超出限制。');
    const slot = parseModelSlot(body);
    const previous = modelSettings.readSlots().find((candidate) => candidate.slotId === slot.slotId);
    const saved = modelSettings.saveSlot(slot);
    if (apiKey !== undefined) secrets.set(saved.credentialRef, apiKey);
    else if (body.clearApiKey === true) secrets.set(saved.credentialRef, undefined, true);
    else if (previous && previous.credentialRef !== saved.credentialRef
      && previous.provider === saved.provider && previous.baseUrl === saved.baseUrl) {
      secrets.copy(previous.credentialRef, saved.credentialRef);
    }
    const assignments = modelAssignmentsBySlot(modelSettings.readSlots(), secrets);
    const currentState = store.readSnapshot();
    if (currentState) {
      const boundState = bindUnstartedInitialResidents(currentState, assignments);
      if (boundState !== currentState) store.commit(currentState.sequence, boundState, []);
    }
    sendJson(response, 200, { saved: true, ready: isModelSlotReady(saved, secrets.has(saved.credentialRef)), apiKeyConfigured: secrets.has(saved.credentialRef) });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/control') {
    const body = await readJsonBody(request);
    if (body.kind === 'pause' || body.kind === 'resume') {
      await port.requestControl({ kind: body.kind });
      sendJson(response, 200, { ok: true });
      return;
    }
    if (body.kind === 'speed' && typeof body.speedId === 'string') {
      await port.requestControl({ kind: 'speed', speedId: body.speedId });
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 400, { error: '控制要求格式不正確。' });
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('找不到頁面');
}

async function readSettingsView(store?: SQLiteWorldStore, modelSettings?: ModelSettingsStore, secrets = new ProcessModelSecrets()): Promise<ModelSettingsView> {
  const slots = modelSettings?.readSlots() ?? [];
  const monthlyStatus = store?.readMonthlyCost(new Date().toISOString());
  const monthly = monthlyStatus
    ? { capUsd: 20, actualUsd: monthlyStatus.settledUsd, reservedUsd: monthlyStatus.reservedUsd, remainingUsd: monthlyStatus.remainingUsd }
    : { capUsd: 20, actualUsd: 0, reservedUsd: 0, remainingUsd: 20 };
  return {
    slots: slots.map((slot) => ({ ...slot, apiKeyConfigured: secrets.has(slot.credentialRef) })),
    monthly,
  };
}

function parseModelSlot(body: Record<string, unknown>): ModelSlotInput {
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
    maxInputTokens: number('maxInputTokens', true),
    maxOutputTokens: number('maxOutputTokens', true),
    modelSizeB: number('modelSizeB', false),
    sizeAtLeast8BConfirmed: body.sizeAtLeast8BConfirmed === true,
    styleDescription: text('styleDescription'),
  };
}

function selectionFromUrl(url: URL): ObserverSelection {
  const residentId = url.searchParams.get('residentId');
  const activeTabValue = url.searchParams.get('activeTab');
  const activeTab = activeTabValue === 'world' || activeTabValue === 'residents' || activeTabValue === 'history' || activeTabValue === 'settings' ? activeTabValue : undefined;
  if (residentId) return { residentId, ...(activeTab ? { activeTab } : {}) };
  const nodeId = url.searchParams.get('nodeId');
  return { ...(nodeId ? { nodeId } : {}), ...(activeTab ? { activeTab } : {}) };
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

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startObserverServer();
