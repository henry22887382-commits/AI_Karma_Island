import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { renderObserverMarkup, type ObserverSnapshot } from './observer.ts';

const snapshot: ObserverSnapshot = {
  worldTime: { day: 2, timeT: 73, phase: '白天' },
  simulation: { running: false, speedLabel: '暫停中', freshAt: '2026-10-20T10:00:00+08:00' },
  map: {
    nodes: [{ id: '1', label: '', labelStatus: '未逐點命名', regionDescription: '西側沙灘', x: 132, y: 558, residents: ['1.1'], objects: [] }],
    edges: [],
  },
  residents: [{ id: '1.1', generation: 1, model: '待設定', nodeId: '1', remainingLife: 30, hunger: 5, sleep: 3, inventory: [], equipment: [], lastAction: '醒來', lastActionResult: '' }],
  events: [{ id: 'ev-1', day: 2, timeT: 73, nodeId: '1', actorId: '1.1', description: '居民醒來', visibility: 'public' }],
  biographies: [{ residentId: '0.1', displayName: '已故居民', text: '一段只供玩家查看的傳記' }],
};

test('renders the readonly observer map, resident detail, timeline and death-summary entry point', () => {
  const html = renderObserverMarkup(snapshot);
  assert.match(html, /主島地圖/);
  assert.match(html, /viewBox="0 0 1300 823"/);
  assert.match(html, /未逐點命名/);
  assert.match(html, /島民 1\.1/);
  assert.match(html, /事件時間線/);
  assert.match(html, /tab-death-summaries/);
  assert.match(html, /資料更新/);
});

test('keeps pending setup, initialization and synchronization status in error records', () => {
  const pendingSnapshot = {
    ...snapshot,
    initialized: false,
    unresolved: ['居民模型尚未配置；觀察台不會推定供應商或模型名稱。'],
  } satisfies ObserverSnapshot;
  const html = renderObserverMarkup(pendingSnapshot);
  const headerStart = html.indexOf('<header class="topbar">');
  const headerEnd = html.indexOf('</header>', headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  assert.doesNotMatch(html.slice(0, headerStart), /尚待設定|世界尚未初始化/);
  assert.doesNotMatch(html.slice(headerStart, headerEnd), /待處理|資料同步正常/);
  const errorPanelStart = html.indexOf('<section class="tab-panel" role="tabpanel" id="panel-format-errors"');
  const errorPanelEnd = html.indexOf('</section>', errorPanelStart);
  assert.ok(errorPanelStart >= 0 && errorPanelEnd > errorPanelStart);
  assert.match(html.slice(errorPanelStart, errorPanelEnd), /資料同步正常/);
  assert.match(html.slice(errorPanelStart, errorPanelEnd), /<details id="readiness-pending" class="readiness-menu">/);
  assert.match(html.slice(errorPanelStart, errorPanelEnd), /aria-label="展開 2 項待處理提示"/);
  assert.match(html.slice(errorPanelStart, errorPanelEnd), /<span class="readiness-count">2<\/span>/);
  assert.match(html.slice(errorPanelStart, errorPanelEnd), /世界尚未初始化/);
  assert.match(html.slice(errorPanelStart, errorPanelEnd), /居民模型尚未配置/);
  assert.doesNotMatch(renderObserverMarkup(snapshot), /class="readiness-menu"/);
  assert.match(html, /id="panel-settings"[\s\S]*?<footer class="freshness">/);
});

test('shows the snapshot-backed island and resident summary until a node or resident is selected', () => {
  const emptyHtml = renderObserverMarkup(snapshot);
  assert.match(emptyHtml, /class="panel detail-panel island-status-panel"/);
  assert.match(emptyHtml, /島上現況/);
  assert.match(emptyHtml, /居民分布/);
  assert.match(emptyHtml, /居民記錄<\/dt><dd>1/);
  assert.match(emptyHtml, /有居民的地表 Node<\/dt><dd>1 \/ 1/);
  assert.match(emptyHtml, /Node 1/);
  assert.match(emptyHtml, /島民 1\.1/);
  assert.match(emptyHtml, /最近島上事件/);
  assert.match(emptyHtml, /居民醒來/);
  assert.match(emptyHtml, /id="world-side-tabs" aria-label="地圖旁資訊"/);
  assert.match(emptyHtml, /id="world-side-panel-overview" aria-labelledby="world-side-tab-overview"/);
  assert.match(emptyHtml, /id="world-side-panel-events"[^>]*aria-labelledby="world-side-tab-events"[^>]*hidden/);
  assert.doesNotMatch(emptyHtml, /尚未選取 · 點擊地圖查看資訊/);
  const selectedHtml = renderObserverMarkup(snapshot, { nodeId: '1' });
  assert.match(selectedHtml, /class="world-node-scene"/);
  assert.match(selectedHtml, /id="node-scene-title"/);
  assert.match(selectedHtml, /此地存活居民/);
});

test('resident tab shows the real roster overview instead of a stale node or invalid-resident empty card', () => {
  const resident = snapshot.residents[0];
  assert.ok(resident);
  const tenResidents = Array.from({ length: 10 }, (_, index) => ({
    ...resident,
    id: `1.${index + 1}`,
    lastAction: `現有行動 ${index + 1}`,
  }));
  const residentSnapshot = { ...snapshot, residents: tenResidents };
  const staleNodeMarkup = renderObserverMarkup(residentSnapshot, { activeTab: 'residents', nodeId: 'removed-node' });
  const residentsPanel = staleNodeMarkup.match(/<section class="tab-panel" role="tabpanel" id="panel-residents"[\s\S]*?<\/section><section class="tab-panel" role="tabpanel" id="panel-history"/)?.[0] ?? '';
  assert.match(residentsPanel, /<span class="count" data-resident-search-count>10 位<\/span>/);
  assert.match(residentsPanel, /id="resident-overview-title">居民分布與行動/);
  assert.match(residentsPanel, /居民記錄<\/dt><dd>10/);
  assert.match(residentsPanel, /現有行動 1/);
  assert.match(residentsPanel, /其餘居民可由左側清單選取/);
  assert.doesNotMatch(residentsPanel, /選擇地點或居民|class="panel detail-panel empty-detail"/);

  const staleResidentMarkup = renderObserverMarkup(residentSnapshot, { activeTab: 'residents', residentId: 'deleted-resident' });
  assert.match(staleResidentMarkup, /id="resident-overview-title">居民分布與行動/);
  assert.match(residentsPanel, /id="resident-workspace-tabs"/);
  assert.match(residentsPanel, /data-tab="list"/);
  assert.match(residentsPanel, /data-tab="detail"/);
});

test('history page paginates all filtered events in the current timeline workspace', () => {
  const event = snapshot.events[0];
  assert.ok(event);
  const events = Array.from({ length: 13 }, (_, index) => ({ ...event, id: `event-${index + 1}`, description: `歷史事件 ${index + 1}` }));
  const html = renderObserverMarkup({ ...snapshot, events }, { activeTab: 'history' });
  assert.match(html, /<div class="history-grid"><section class="panel timeline-panel"/);
  assert.match(html, /aria-label="歷史事件分頁"/);
  assert.match(html, /第 1 頁，共 3 頁 · 13 筆事件/);
  assert.match(html, /data-history-page="1"/);
  assert.match(html, /data-history-page="2" hidden/);
  assert.match(html, /data-history-page-step="next"/);
  assert.equal((html.match(/data-history-page="\d+"/g) ?? []).length, 13);
});

test('fits the desktop map and sidebar to the viewport, with natural vertical flow on small screens', async () => {
  const css = await readFile(new URL('./observer.css', import.meta.url), 'utf8');
  assert.match(css, /\.observer-shell\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/);
  assert.match(css, /\.tab-panel#panel-world\s*\{\s*overflow:\s*auto/);
  assert.match(css, /\.world-map-column\s*\{\s*grid-column:\s*span 8/);
  assert.match(css, /\.world-side-column\s*\{\s*grid-column:\s*span 4/);
  assert.match(css, /\.map-viewport\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0/);
  assert.match(css, /\.island-map\s*\{[^}]*height:\s*100%[^}]*max-height:\s*none/);
  assert.match(css, /\.world-side-tabs\s*\{\s*display:\s*flex/);
  assert.doesNotMatch(css.match(/\.island-node-list\s*\{[^}]*\}/)?.[0] ?? '', /max-height|overflow:\s*auto/);
  assert.match(css, /\.observer-shell:not\(\[data-active-tab="setup"\]\):not\(\[data-active-tab="residents"\]\):not\(\[data-active-tab="history"\]\):not\(\[data-active-tab="settings"\]\) \{ min-height: 680px; height: auto; overflow: visible; \}/);
  assert.match(css, /\.tab-panel, \.tab-panel#panel-world \{ flex: none; overflow: visible; \}/);
});

test('binds the generated observer tabs directly and restores bindings after refresh', async () => {
  const html = renderObserverMarkup(snapshot);
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tag]) => tag).filter((tag) => /id="tab-(world|residents|history|settings)"/.test(tag));
  assert.equal(tabs.length, 4);
  for (const id of ['world', 'residents', 'history', 'settings']) {
    assert.ok(tabs.some((tag) => tag.includes(`id="tab-${id}"`) && tag.includes(`data-tab="${id}"`)));
    assert.match(html, new RegExp(`id="panel-${id}"[^>]*aria-labelledby="tab-${id}"`));
  }

  const server = await readFile(new URL('./server.ts', import.meta.url), 'utf8');
  assert.match(server, /root\.querySelectorAll\('\[role="tablist"\] \[role="tab"\]'\)/);
  assert.match(server, /button\.addEventListener\('click',[\s\S]*?activateTab\(button\)/);
  assert.match(server, /root\.innerHTML = result\.markup;[\s\S]*?bindTabButtons\(\);/);
  assert.match(server, /candidate\.setAttribute\('aria-selected', String\(selected\)\)/);
  assert.match(server, /panel\.hidden = tablist\.dataset\.responsiveTabs === 'mobile'/);
});

test('the observer client script template expands to valid JavaScript', async () => {
  const server = await readFile(new URL('./server.ts', import.meta.url), 'utf8');
  const match = server.match(/(?:export )?const observerClientScript = `([\s\S]*?)`;/);
  if (!match?.[1]) throw new Error('clientScript template exists');
  const iconAssignment = match[1].match(/^const dataStateIcons = .*;$/m);
  if (!iconAssignment?.[0]) throw new Error('server-side icon interpolation exists');
  const clientScript = match[1].replace(iconAssignment[0], 'const dataStateIcons = {};');
  assert.doesNotThrow(() => new Script(clientScript, { filename: 'observer-client.js' }));
});

test('shows the resident previous action result in player observation', () => {
  const resident = snapshot.residents[0];
  assert.ok(resident);
  const withResult = {
    ...snapshot,
    residents: [{ ...resident, lastActionResult: '已抵達 Node 2，遭遇抽取未命中' }],
  } as ObserverSnapshot;
  const html = renderObserverMarkup(withResult, { residentId: '1.1' });
  assert.match(html, /餘命/);
  assert.doesNotMatch(html, />HP</);
  assert.match(html, /上一行動結果/);
  assert.match(html, /已抵達 Node 2，遭遇抽取未命中/);
});

test('shows only the 20 most recent resident intents while retaining the full observation record', () => {
  const resident = snapshot.residents[0];
  assert.ok(resident);
  const intents = Array.from({ length: 25 }, (_, index) => `意圖 ${index + 1}`);
  intents[24] = '<最後意圖>';
  const html = renderObserverMarkup({ ...snapshot, residents: [{ ...resident, intents }] }, { residentId: '1.1' });
  assert.match(html, /居民 AI 意圖（最近 20 則，共 25 則）/);
  assert.doesNotMatch(html, /意圖 1、|意圖 5、/);
  assert.match(html, /意圖 6/);
  assert.match(html, /&lt;最後意圖&gt;/);
  assert.doesNotMatch(html, /<最後意圖>/);
});

test('keeps simulation speed fixed without rendering a speed selector', () => {
  const html = renderObserverMarkup(snapshot);
  assert.doesNotMatch(html, /data-control="speed"/);
});

test('renders the selectable dungeon floors from runtime topology and labels resident cells', () => {
  const dungeonSnapshot: ObserverSnapshot = {
    ...snapshot,
    dungeonMap: {
      activeFloor: 2,
      floors: [
        { number: 1, label: '第一層 · 雨林' },
        { number: 2, label: '第二層 · 溫泉下水道' },
        { number: 3, label: '第三層 · 火山洞窟' },
      ],
      cells: [
        { id: 'S', neighbors: ['A1', 'B1', 'C1'] },
        { id: 'A1', neighbors: ['S', 'A2'] },
        { id: 'A2', neighbors: ['A1', 'E'] },
        { id: 'B1', neighbors: ['S', 'B2'] },
        { id: 'B2', neighbors: ['B1', 'E'] },
        { id: 'C1', neighbors: ['S', 'C2'] },
        { id: 'C2', neighbors: ['C1', 'E'] },
        { id: 'E', neighbors: ['A2', 'B2', 'C2'] },
      ],
      residents: [{ actorId: '1.1', floor: 2, cellId: 'B2' }],
    },
  };
  const html = renderObserverMarkup(dungeonSnapshot, { mapView: 'dungeon', dungeonFloor: 2, dungeonCellId: 'B2' });
  assert.match(html, /<option value="dungeon" selected>地牢<\/option>/);
  assert.match(html, /<option value="2" selected>第二層 · 溫泉下水道<\/option>/);
  assert.match(html, /data-dungeon-cell="B2"/);
  assert.match(html, /居民 1\.1/);
  assert.match(html, /data-dungeon-cell="S"[\s\S]*?data-dungeon-cell="A1"/);
  assert.match(html, /不代表行動順序/);
  assert.doesNotMatch(html, /data-node-id="1"/);
});

test('falls back to active dungeon floor when the requested floor is unavailable', () => {
  const dungeonSnapshot: ObserverSnapshot = {
    ...snapshot,
    dungeonMap: {
      activeFloor: 2,
      floors: [{ number: 2, label: '第二層 · 溫泉下水道' }],
      cells: [{ id: 'S', neighbors: [] }],
      residents: [],
    },
  };
  const html = renderObserverMarkup(dungeonSnapshot, { mapView: 'dungeon', dungeonFloor: 3 });
  assert.match(html, /<option value="2" selected>第二層 · 溫泉下水道<\/option>/);
  assert.match(html, /第二層 · 溫泉下水道格子拓撲/);
});

test('escapes untrusted event and diagnostic text before placing it in the DOM', () => {
  const event = snapshot.events[0];
  assert.ok(event);
  const html = renderObserverMarkup({
    ...snapshot,
    events: [{ ...event, description: '<script>alert(1)</script>' }],
  }, {}, { slots: [], latestAiFormatError: { recordedAt: 'now', actorId: 'resident-01', reason: '<img src=x>', rawOutput: '<img src=x onerror=alert(1)>' } });
  assert.doesNotMatch(html, /<script>|<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('keeps model slot editing focused and hides estimate-only amounts', () => {
  const html = renderObserverMarkup(snapshot, { activeTab: 'settings' });
  assert.equal((html.match(/data-model-settings/g) ?? []).length, 10);
  assert.equal((html.match(/data-model-settings[^>]* hidden/g) ?? []).length, 9);
  assert.equal((html.match(/<option value="\d+"/g) ?? []).length, 10);
  assert.match(html, /data-slot-select/);
  assert.doesNotMatch(html, /可用額度|月上限/);
  assert.doesNotMatch(html, /模型規模（B）|sizeAtLeast8BConfirmed|已聲明至少8B/);
  assert.match(html, /費率與帳務/);
  assert.match(html, /上下文字元上限/);
  assert.match(html, /居民風格/);
  assert.match(html, /目前沒有其他已設定模型槽位/);
  assert.match(html, /data-model-search/);
  assert.match(html, /data-model-select/);
  assert.match(html, /data-load-model-list/);
  assert.match(html, /type="search" data-model-search/);
  assert.match(html, /data-provider-billing-status/);
  assert.match(html, /data-management-key/);
  assert.match(html, /data-save-management-key/);
  assert.match(html, /data-refresh-openrouter-account/);
  assert.match(html, /data-create-openrouter-key/);
  assert.match(html, /實際金額未提供|尚未讀取供應商模型與費率/);
  assert.match(html, /id="model-section-tabs-1"/);
  for (const section of ['connection', 'style', 'billing']) assert.match(html, new RegExp(`data-tab="${section}"`));
  assert.match(html, /name="apiKey" type="password"/);
});

test('model settings candidate picker echoes persisted fallback IDs from other configured slots', () => {
  const settings = {
    slots: [
      { slotId: 1, provider: 'Provider A', baseUrl: 'https://api.example.test/v1', model: 'alpha', fallbackModels: ['beta', 'legacy-id'], inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxInputTokens: 1000, maxContextCharacters: 8000, maxOutputTokens: 100, styleDescription: '謹慎', updatedAt: null, apiKeyConfigured: false },
      { slotId: 2, provider: 'Provider A', baseUrl: 'https://api.example.test/v1', model: 'beta', fallbackModels: [], inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxInputTokens: 1000, maxContextCharacters: 8000, maxOutputTokens: 100, styleDescription: null, updatedAt: null, apiKeyConfigured: false },
      { slotId: 3, provider: 'Provider B', baseUrl: 'https://other.example.test/v1', model: 'gamma', fallbackModels: [], inputUsdPerMillion: null, outputUsdPerMillion: null, maxInputTokens: null, maxContextCharacters: 8000, maxOutputTokens: null, styleDescription: null, updatedAt: null, apiKeyConfigured: false },
    ],
  };
  const html = renderObserverMarkup(snapshot, { activeTab: 'settings' }, settings);
  const firstSlot = html.slice(html.indexOf('data-slot-id="1"'), html.indexOf('</form>'));
  assert.match(firstSlot, /name="fallbackModels" value="beta" checked><span>槽位 2 · Provider A \/ beta/);
  assert.doesNotMatch(firstSlot, /槽位 1 · Provider A \/ alpha/);
  assert.doesNotMatch(firstSlot, /槽位 3 · Provider B \/ gamma/);
  assert.match(firstSlot, /name="fallbackModels" value="legacy-id" checked><span>既有備援 legacy-id · 未匹配其他相同供應商槽位/);
  assert.match(firstSlot, /type="checkbox" name="fallbackModels"/);
  assert.doesNotMatch(firstSlot, /name="modelSizeB"|name="sizeAtLeast8BConfirmed"/);
});

test('resident observation allocates more desktop width to useful roster and overview, stacking on narrow screens', async () => {
  const css = await readFile(new URL('./observer.css', import.meta.url), 'utf8');
  assert.match(css, /\.resident-list-panel \{ grid-column: span 5; min-width: 0; max-width: 100%; padding: clamp\(16px, 1\.6vw, 24px\); \}/);
  assert.match(css, /\.resident-detail-panel \{ grid-column: span 7; min-width: 0; max-width: 100%; padding: clamp\(16px, 1\.6vw, 24px\); \}/);
  assert.match(css, /\.resident-overview-list > li \{ display: grid; grid-template-columns: minmax\(0, auto\) minmax\(110px, \.8fr\) minmax\(160px, 1\.2fr\)/);
  assert.match(css, /\.resident-overview-list > li > strong, \.resident-overview-list > li > span \{ min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.resident-overview-list > li \{ grid-template-columns: minmax\(0, 1fr\); align-items: start/);
  assert.match(css, /\.resident-list-panel, \.resident-detail-panel,[\s\S]*?grid-column: 1 \/ -1/);
});

test('model settings use normal document flow and responsive fields without an inner scrolling panel', async () => {
  const css = await readFile(new URL('./observer.css', import.meta.url), 'utf8');
  const server = await readFile(new URL('./server.ts', import.meta.url), 'utf8');
  assert.match(css, /\.observer-shell\[data-active-tab="settings"\] \{ min-height: 100dvh; height: auto; padding-bottom: clamp\(24px, 3vh, 36px\); overflow: visible; \}/);
  assert.match(css, /\.observer-shell\[data-active-tab="settings"\] \.tab-panel#panel-settings \{ flex: 0 0 auto; overflow: visible; \}/);
  assert.match(css, /\.model-settings-panel > \.panel-heading \{ padding-inline: var\(--space-3\); \}/);
  assert.match(css, /\.settings-toolbar \{[^}]*margin: 8px var\(--space-3\); padding: 10px 0;/);
  assert.match(css, /\.model-settings-panel form \{ min-width: 0; margin-inline: var\(--space-3\); \}/);
  assert.match(css, /\.model-slot \{[^}]*width: 100%; min-width: 0; min-inline-size: 0;/);
  assert.match(css, /\.settings-guidance \{ margin: var\(--space-2\) var\(--space-3\);/);
  assert.match(css, /\.model-connection-fields \{ display: grid; grid-column: 1 \/ -1; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.model-id-picker \{ display: grid; grid-column: 1 \/ -1; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.model-connection-fields \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.model-connection-fields \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.model-id-picker \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.model-id-picker \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.model-slot input\[name="apiKey"\] \{[^}]*height: 42px;[^}]*min-height: 42px/);
  assert.match(css, /\.fallback-options \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.openrouter-slot-key \{ display: grid; grid-column: 1 \/ -1; grid-template-columns: minmax\(220px, auto\) minmax\(0, 1fr\)/);
  assert.match(css, /\.openrouter-slot-key \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.openrouter-management > div \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.model-section-tabs \[role="tab"\]\[aria-selected="true"\]/);
  assert.match(css, /\.history-pager/);
  assert.match(css, /\.observer-shell\[data-active-tab="residents"\], \.observer-shell\[data-active-tab="history"\] \{ min-height: 100dvh; height: auto; overflow: visible; \}/);
  assert.match(css, /\.observer-shell\[data-active-tab="settings"\] \{ min-height: 100dvh; height: auto; padding-bottom: clamp\(24px, 3vh, 36px\); overflow: visible; \}/);
  assert.match(css, /\.responsive-workspace-tabs/);
  assert.match(server, /shell\.dataset\.activeTab = tab/);
  assert.match(server, /fields\.getAll\('fallbackModels'\)\.map\(String\)\.join\(', '\)/);
  assert.match(server, /option\.value\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(server, /option\.dataset\.inputPrice/);
  assert.match(server, /if \(!document\.hidden && activeTab !== 'settings'\) void refresh\(\{ background: true \}\)/);
  assert.doesNotMatch(css.match(/\.model-settings-panel \{[^}]*\}/)?.[0] ?? '', /height|max-height|overflow:\s*auto/);
});
