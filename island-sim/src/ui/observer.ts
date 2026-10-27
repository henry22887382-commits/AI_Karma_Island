import { renderUiIcon, type UiIconName } from './icons.ts';
import type { SurfaceTerrainClassification } from '../domain/model.ts';
import { formatNodeLocationReference } from '../content/location-names.ts';

export type ObserverNode = {
  readonly id: string;
  readonly label: string;
  readonly labelStatus: string;
  readonly surfaceTerrain?: SurfaceTerrainClassification | null;
  readonly x: number;
  readonly y: number;
  readonly residents: readonly string[];
  readonly objects: readonly ObserverObject[];
  readonly monsters?: readonly { readonly name: string | null }[];
  readonly previousScene?: { readonly day: number; readonly timeT: number; readonly events: readonly ObserverEvent[] };
};

export type ObserverObject = { readonly label: string; readonly type: 'item' | 'corpse' | 'container' | 'unknown' };

export type ObserverResident = {
  readonly id: string;
  readonly generation: number | null;
  readonly model: string | null;
  readonly modelSlotId?: number | null;
  readonly nodeId: string | null;
  readonly movingToNodeId?: string;
  readonly remainingLife?: number;
  readonly hunger?: number;
  readonly sleep?: number;
  readonly inventory: readonly string[];
  readonly equipment: readonly string[];
  readonly lastAction: string;
  readonly lastActionResult: string;
  readonly intents?: readonly (string | ObserverResidentIntent)[];
  readonly alive?: boolean;
  readonly dungeonFloor?: number;
  readonly dungeonCellId?: string;
};

export type ObserverResidentIntent = {
  readonly eventId: string;
  readonly sequence: number;
  readonly day: number;
  readonly timeT: number;
  readonly intent: string;
  readonly description: string;
  readonly nodeId?: string;
  readonly nodeLabel?: string;
};

export type ObserverEvent = {
  readonly id: string;
  readonly sequence?: number;
  readonly kind?: string;
  readonly day: number;
  readonly timeT: number;
  readonly nodeId?: string;
  readonly nodeLabel?: string;
  readonly actorId?: string;
  readonly participantIds?: readonly string[];
  readonly description: string;
  readonly intent?: string;
  readonly interaction?: string;
  readonly publicMessage?: { readonly sender: string; readonly recipient: string; readonly text: string };
  readonly visibility: 'public' | 'observer';
};

export type ObserverBiography = {
  readonly residentId: string;
  readonly displayName: string;
  readonly text: string;
};

export type ObserverSnapshot = {
  readonly initialized?: boolean;
  readonly lifecycle?: {
    readonly status: 'setup' | 'in-progress' | 'ended';
    readonly sessionId: string;
    readonly loadedSaveId?: string | null;
    readonly loadInstanceId?: string | null;
    readonly sessionName: string;
    readonly mapId?: string;
    readonly setupMapId?: string;
    readonly mapProfiles?: readonly { readonly mapId: string; readonly name: string }[];
    readonly residentCount: number;
    readonly nextResidentCount?: number;
    readonly residentTemplateSlots: Readonly<Record<number, number>>;
    readonly saves: readonly { readonly saveId: string; readonly sessionName: string; readonly name: string; readonly savedAt: string; readonly sequence: number }[];
  };
  readonly unresolved?: readonly string[];
  readonly worldTime: { readonly day: number; readonly timeT: number; readonly phase: string };
  readonly simulation: { readonly running: boolean; readonly speedLabel: string; readonly speedMultiplier?: number; readonly freshAt: string; readonly controllable?: boolean; readonly status?: string };
  readonly map: { readonly nodes: readonly ObserverNode[]; readonly edges: readonly { readonly fromId: string; readonly toId: string }[] };
  readonly dungeonMap?: {
    readonly activeFloor: number | null;
    readonly floors: readonly { readonly number: number; readonly label: string }[];
    readonly cells: readonly { readonly id: string; readonly neighbors: readonly string[] }[];
    readonly residents: readonly { readonly actorId: string; readonly floor: number; readonly cellId: string }[];
  };
  readonly residents: readonly ObserverResident[];
  readonly events: readonly ObserverEvent[];
  readonly biographies: readonly ObserverBiography[];
};

export type ModelSlotSettingsView = {
  readonly slotId: number;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly fallbackModels: readonly string[];
  readonly inputUsdPerMillion: number | null;
  readonly outputUsdPerMillion: number | null;
  readonly maxInputTokens: number | null;
  readonly maxContextCharacters: number;
  readonly styleDescription: string | null;
  readonly updatedAt: string | null;
  readonly apiKeyConfigured: boolean;
};

export type ModelSettingsView = {
  readonly slots: readonly ModelSlotSettingsView[];
  readonly summarizer?: { readonly modelSlotId: number | null; readonly prompt: string };
  readonly deathSummaries?: readonly { readonly summaryId: string; readonly sessionId: string | null; readonly sourceSaveId: string | null; readonly loadInstanceId: string | null; readonly residentId: string; readonly displayName: string; readonly status: string; readonly text: string | null; readonly error: string | null; readonly updatedAt: string }[];
  readonly latestAiFormatError?: { readonly recordedAt: string; readonly actorId: string; readonly reason: string; readonly rawOutput: string } | null;
};

export type ObserverControlRequest =
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'speed'; readonly value: number };

export interface ObserverReadPort {
  readSnapshot(): Promise<ObserverSnapshot>;
  requestControl(request: ObserverControlRequest): Promise<void>;
}

export type ObserverSelection = {
  readonly nodeId?: string;
  readonly residentId?: string;
  readonly eventResidentId?: string;
  readonly eventPage?: number;
  readonly mapView?: 'surface' | 'dungeon';
  readonly dungeonFloor?: number;
  readonly dungeonCellId?: string;
  readonly activeTab?: 'world' | 'residents' | 'history' | 'settings' | 'death-summaries' | 'format-errors';
};

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function residentButton(id: string, selected: boolean): string {
  return `<button class="resident-chip${selected ? ' is-selected' : ''}" type="button" data-resident-id="${escapeHtml(id)}" aria-pressed="${selected}">島民 ${escapeHtml(id)}</button>`;
}

function mapTerrainClass(terrain: SurfaceTerrainClassification | null | undefined): string {
  return `terrain-${terrain ?? 'unclassified'}`;
}

function mapTerrainLabel(terrain: SurfaceTerrainClassification | null | undefined): string {
  const labels: Readonly<Record<SurfaceTerrainClassification, string>> = {
    beach: '海灘', 'coconut-beach': '椰子沙灘', forest: '森林', 'berry-forest': '莓果森林', river: '河流', rock: '岩地',
    'dungeon-entrance': '地牢入口', port: '港口', 'monument-valley': '紀念碑谷', unclassified: '未分類',
  };
  return labels[terrain ?? 'unclassified'];
}

function renderNodeScene(node: ObserverNode, snapshot: ObserverSnapshot): string {
  const terrain = mapTerrainClass(node.surfaceTerrain);
  const scene = node.previousScene;
  const timeLabel = scene
    ? `最近場景 · 第 ${scene.day} 日 · ${scene.timeT}T`
    : `目前世界 · ${snapshot.worldTime.phase}`;
  const aliveResidents = node.residents.filter((id) => snapshot.residents.some((candidate) => candidate.id === id && candidate.alive === true && candidate.nodeId === node.id));
  const residents = aliveResidents
    .map((id, index) => {
      return `<button type="button" class="scene-resident" style="--scene-index:${index}" data-resident-id="${escapeHtml(id)}" aria-label="查看島民 ${escapeHtml(id)}"><span class="scene-avatar" aria-hidden="true"><i></i></span><span class="scene-resident-name">島民 ${escapeHtml(id)}</span></button>`;
    }).join('');
  const residentLinks = aliveResidents.map((id) => residentButton(id, false)).join('');
  const objects = node.objects.length
    ? node.objects.map((object, index) => `<span class="scene-object scene-object-${object.type}" style="--scene-index:${index}"><span aria-hidden="true">${object.type === 'corpse' ? '✚' : object.type === 'container' ? '▣' : '◇'}</span>${escapeHtml(object.label)}</span>`).join('')
    : '<span class="scene-object scene-object-quiet">風掠過這片地方</span>';
  const narration = scene?.events.length
    ? `最近紀錄 · 第 ${scene.day} 日 ${scene.timeT}T：${scene.events.length} 筆同時記錄的事件`
    : (aliveResidents.length
    ? `${aliveResidents.length} 位存活居民目前記錄在此 Node。`
    : '這裡暫時安靜，等待新的故事。');
  const sceneContent = scene?.events.length
    ? `<p class="help-text">最近有紀錄的時間：第 ${scene.day} 日 · ${scene.timeT}T</p><ol class="island-event-list">${scene.events.map((item) => `<li><p>${escapeHtml(item.description)}</p><small>${item.intent ? `行動方向：${escapeHtml(item.intent)} · ` : ''}${escapeHtml(item.interaction ?? '環境事件')}</small></li>`).join('')}</ol>`
    : '<p class="empty-state">本 Node 尚無可顯示的最近紀錄。</p>';
  const monsters = (node.monsters ?? []).map((monster) => `<span class="scene-monster"><span aria-hidden="true">♟</span>${escapeHtml(monster.name?.trim() || '名稱未提供')}</span>`).join('');
  const messageEvents = scene?.events.filter((item) => item.publicMessage) ?? [];
  const bubbles = messageEvents.map((item) => `<blockquote class="scene-message"><p>${escapeHtml(item.publicMessage!.text)}</p><footer>${escapeHtml(item.publicMessage!.sender)} → ${escapeHtml(item.publicMessage!.recipient)}<small>公開訊息 · 最近紀錄 第 ${item.day} 日 ${item.timeT}T</small></footer></blockquote>`).join('');
  return `<section class="node-scene-card ${terrain}" aria-labelledby="node-scene-title"><div class="node-scene-sky" aria-hidden="true"><span class="scene-sun"></span><span class="scene-cloud scene-cloud-one"></span><span class="scene-cloud scene-cloud-two"></span></div><div class="node-scene-land" aria-hidden="true"><span class="scene-hill scene-hill-back"></span><span class="scene-hill scene-hill-front"></span></div><div class="node-scene-header"><p class="eyebrow">${escapeHtml(timeLabel)} · ${escapeHtml(mapTerrainLabel(node.surfaceTerrain))}</p><h2 id="node-scene-title">${escapeHtml(node.label || `Node ${node.id}`)}</h2><span class="scene-node-number">Node ${escapeHtml(node.id)}</span></div><div class="node-scene-people" role="group" aria-label="此地存活居民">${residents || '<p class="scene-empty">此 Node 目前沒有存活居民</p>'}${monsters}</div><div class="node-scene-objects" role="group" aria-label="此地物件">${objects}</div>${bubbles ? `<div class="scene-messages" aria-label="最近紀錄中的公開訊息">${bubbles}</div>` : ''}<p class="node-scene-narration">${escapeHtml(narration)}</p><details class="node-scene-details"><summary>地點資料與最近事件</summary><dl class="fact-grid"><div><dt>標籤狀態</dt><dd>${escapeHtml(node.labelStatus)}</dd></div><div><dt>地形</dt><dd>${escapeHtml(mapTerrainLabel(node.surfaceTerrain))}</dd></div><div class="wide"><dt>物件與資源</dt><dd>${node.objects.length ? node.objects.map((object) => escapeHtml(object.label)).join('、') : '目前沒有物件資料'}</dd></div></dl><h3>最近已記錄事件</h3>${sceneContent}<p class="help-text">世界資料沒有獨立回合編號；事件依該 Node 最近有紀錄的遊戲時間分組。</p><h3>此地存活居民</h3><div class="resident-roster">${residentLinks || '<span class="empty-state">目前沒有存活居民資料</span>'}</div></details></section>`;
}

function renderRecentIslandEvents(snapshot: ObserverSnapshot): string {
  const events = snapshot.events
    .filter((event) => event.visibility === 'public' || event.visibility === 'observer')
    .slice()
    .sort((left, right) => right.day - left.day || right.timeT - left.timeT || (right.sequence ?? 0) - (left.sequence ?? 0))
    .slice(0, 5);
  const rows = events.map((event) => `<li><span>第 ${event.day} 日 · ${event.timeT}T</span><p>${escapeHtml(event.description)}</p><small>意圖：${escapeHtml(event.intent ?? '意圖未記錄')} · 互動雙方：${escapeHtml(event.interaction ?? '無居民互動對象（環境事件）')}</small><small>${formatEventLocation(event)}${event.actorId ? ` · ${escapeHtml(event.actorId)}` : ''}</small></li>`).join('');
  return `<section class="island-events" aria-labelledby="island-events-title"><div class="panel-heading"><div><p class="eyebrow">已結算紀錄</p><h3 id="island-events-title">最近島上事件</h3></div></div><ol class="island-event-list">${rows || '<li class="empty-state">目前沒有可顯示的事件</li>'}</ol><p class="help-text">完整時間線請切換「事件與傳記」。</p></section>`;
}

function renderIslandStatus(snapshot: ObserverSnapshot): string {
  const nodeIds = new Set(snapshot.map.nodes.map((node) => node.id));
  const currentResidents = snapshot.residents.filter((resident) => resident.alive !== false);
  const surfaceResidents = currentResidents.filter((resident) => resident.dungeonFloor === undefined && resident.dungeonCellId === undefined && resident.nodeId !== null && nodeIds.has(resident.nodeId));
  const occupiedNodes = snapshot.map.nodes.flatMap((node) => {
    const residents = surfaceResidents.filter((resident) => resident.nodeId === node.id);
    return residents.length ? [{ node, residents }] : [];
  });
  const otherResidents = currentResidents.filter((resident) => resident.dungeonFloor !== undefined && resident.dungeonCellId !== undefined || resident.nodeId === null || !nodeIds.has(resident.nodeId));
  const distribution = occupiedNodes.map(({ node, residents }) => `<li><div class="island-node-heading"><strong>Node ${escapeHtml(node.id)}${node.label ? ` · ${escapeHtml(node.label)}` : ''}</strong><span class="count">${residents.length} 位</span></div><div class="island-node-people">${residents.map(({ id }) => residentButton(id, false)).join('')}</div></li>`).join('');
  const elsewhere = otherResidents.slice(0, 3).map((resident) => {
    const location = resident.dungeonFloor !== undefined && resident.dungeonCellId !== undefined
      ? `地牢第 ${resident.dungeonFloor} 層 · Cell ${resident.dungeonCellId}`
      : resident.nodeId === null
        ? '目前沒有地表 Node 位置'
        : `Node ${resident.nodeId}（不在目前地圖資料中）`;
    return `<li><div class="island-node-heading"><strong>島民 ${escapeHtml(resident.id)}</strong><span class="help-text">${escapeHtml(location)}</span></div>${residentButton(resident.id, false)}</li>`;
  }).join('');
  const moreResidents = occupiedNodes.reduce((count, entry) => count + entry.residents.length, 0) - occupiedNodes.slice(0, 4).reduce((count, entry) => count + Math.min(entry.residents.length, 4), 0);
  const compactDistribution = occupiedNodes.slice(0, 4).map(({ node, residents }) => `<li><div class="island-node-heading"><strong>Node ${escapeHtml(node.id)}${node.label ? ` · ${escapeHtml(node.label)}` : ''}</strong><span class="count">${residents.length} 位</span></div><div class="island-node-people">${residents.slice(0, 4).map(({ id }) => residentButton(id, false)).join('')}${residents.length > 4 ? `<span class="help-text">另 ${residents.length - 4} 位</span>` : ''}</div></li>`).join('');
  return `<section class="panel detail-panel island-status-panel" aria-labelledby="island-status-title"><div class="panel-heading"><div><p class="eyebrow">島上現況</p><h2 id="island-status-title">居民分布</h2></div></div><dl class="fact-grid"><div><dt>居民記錄</dt><dd>${currentResidents.length}</dd></div><div><dt>有居民的地表 Node</dt><dd>${occupiedNodes.length} / ${snapshot.map.nodes.length}</dd></div></dl><ul class="island-node-list">${compactDistribution}</ul>${distribution ? '' : '<p class="empty-state">目前沒有居民記錄在地表 Node。</p>'}${occupiedNodes.length > 4 || moreResidents > 0 ? '<p class="help-text">完整居民清單請切換「居民觀察」。</p>' : ''}${elsewhere ? `<h3>其他位置</h3><ul class="island-node-list island-other-residents">${elsewhere}</ul>${otherResidents.length > 3 ? `<p class="help-text">另有 ${otherResidents.length - 3} 位居民位於其他位置。</p>` : ''}` : ''}</section>`;
}

function renderWorldSidebar(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const resident = snapshot.residents.find((candidate) => candidate.id === selection.residentId);
  const node = snapshot.map.nodes.find((candidate) => candidate.id === selection.nodeId);
  const selectedDetails = resident || node
    ? resident
      ? `<details class="world-side-details" open><summary>選取資訊 · 居民 ${escapeHtml(resident.id)}</summary>${renderResident(snapshot, selection)}</details>`
      : `<div class="world-node-scene">${renderNodeScene(node!, snapshot)}</div>`
    : renderIslandStatus(snapshot);
  return `<div class="world-side-tabs" role="tablist" id="world-side-tabs" aria-label="地圖旁資訊"><button type="button" role="tab" id="world-side-tab-overview" data-tab="overview" aria-controls="world-side-panel-overview" aria-selected="true" tabindex="0">${resident || node ? '選取詳情' : '島上現況'}</button><button type="button" role="tab" id="world-side-tab-events" data-tab="events" aria-controls="world-side-panel-events" aria-selected="false" tabindex="-1">最近事件</button></div><section class="world-side-tab-panel" role="tabpanel" id="world-side-panel-overview" aria-labelledby="world-side-tab-overview" data-tablist="world-side-tabs">${selectedDetails}</section><section class="world-side-tab-panel" role="tabpanel" id="world-side-panel-events" aria-labelledby="world-side-tab-events" data-tablist="world-side-tabs" hidden>${renderRecentIslandEvents(snapshot)}</section>`;
}

function renderWorldConsole(mapPanel: string, snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  return `<div class="world-console-grid"><div class="world-map-column">${mapPanel}</div><aside class="world-side-column" aria-label="地圖旁資訊">${renderWorldSidebar(snapshot, selection)}</aside></div>`;
}

function renderMap(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const mapView = selection.mapView === 'dungeon' && snapshot.dungeonMap ? 'dungeon' : 'surface';
  const selectedFloorNumber = snapshot.dungeonMap?.floors.find(({ number }) => number === selection.dungeonFloor)?.number
    ?? snapshot.dungeonMap?.floors.find(({ number }) => number === snapshot.dungeonMap?.activeFloor)?.number
    ?? snapshot.dungeonMap?.floors[0]?.number;
  const selectedMap = `<div class="map-view-controls"><label>觀察地圖<select data-map-view aria-label="選擇觀察地圖"><option value="surface"${mapView === 'surface' ? ' selected' : ''}>地表</option>${snapshot.dungeonMap ? `<option value="dungeon"${mapView === 'dungeon' ? ' selected' : ''}>地牢</option>` : ''}</select></label>${mapView === 'dungeon' && snapshot.dungeonMap ? `<label>樓層<select data-dungeon-floor aria-label="選擇地牢樓層">${snapshot.dungeonMap.floors.map((floor) => `<option value="${floor.number}"${selectedFloorNumber === floor.number ? ' selected' : ''}>${escapeHtml(floor.label)}</option>`).join('')}</select></label>` : ''}</div>`;
  if (mapView === 'dungeon' && snapshot.dungeonMap) {
    const floor = snapshot.dungeonMap.floors.find((candidate) => candidate.number === selectedFloorNumber)
      ?? snapshot.dungeonMap.floors.find((candidate) => candidate.number === snapshot.dungeonMap?.activeFloor)
      ?? snapshot.dungeonMap.floors[0];
    const floorNumber = floor?.number ?? 1;
    const positions: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
      S: { x: 62, y: 160 }, A1: { x: 182, y: 64 }, A2: { x: 326, y: 64 },
      B1: { x: 182, y: 160 }, B2: { x: 326, y: 160 }, C1: { x: 182, y: 256 },
      C2: { x: 326, y: 256 }, E: { x: 466, y: 160 },
    };
    const cellsById = new Map(snapshot.dungeonMap.cells.map((cell) => [cell.id, cell]));
    const edges = snapshot.dungeonMap.cells.flatMap((cell) => cell.neighbors
      .filter((neighborId) => cell.id < neighborId)
      .map((neighborId) => {
        const from = positions[cell.id];
        const to = positions[neighborId];
        return from && to ? `<line class="map-edge dungeon-edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />` : '';
      })).join('');
    const cells = snapshot.dungeonMap.cells.map((cell) => {
      const position = positions[cell.id];
      if (!position) return '';
      const residents = snapshot.dungeonMap?.residents.filter((resident) => resident.floor === floorNumber && resident.cellId === cell.id) ?? [];
      const residentLabel = residents.map((resident) => resident.actorId).join(' · ');
      const residentMarkers = residents.map((resident, index) => {
        const actor = snapshot.residents.find(({ id }) => id === resident.actorId);
        const color = ['#397d73', '#a76546', '#637d49', '#a27b36', '#557b91', '#93665b', '#6d806b', '#947b55'][Math.max(snapshot.residents.findIndex(({ id }) => id === resident.actorId), 0) % 8];
        const x = position.x + (index - (residents.length - 1) / 2) * 20;
        const title = `居民 ${resident.actorId}，地牢第 ${floorNumber} 層 Cell ${cell.id}`;
        return actor ? `<g class="dungeon-resident-marker" style="--resident-color:${color}" role="button" tabindex="0" aria-label="${escapeHtml(title)}，選取查看資訊" data-resident-id="${escapeHtml(resident.actorId)}"><title>${escapeHtml(title)}</title><circle cx="${x}" cy="${position.y + 19}" r="8"/><text x="${x}" y="${position.y + 22}">${escapeHtml(resident.actorId.replace(/^.*[-_]/, ''))}</text></g>` : '';
      }).join('');
      const selected = selection.dungeonCellId === cell.id;
      return `<g class="dungeon-cell${selected ? ' is-selected' : ''}"><rect role="button" tabindex="0" aria-label="地牢第${floorNumber}層 Cell ${escapeHtml(cell.id)}，${residents.length ? `居民 ${escapeHtml(residentLabel)}` : '沒有存活居民'}" aria-pressed="${selected}" data-dungeon-cell="${escapeHtml(cell.id)}" x="${position.x - 42}" y="${position.y - 27}" width="84" height="54" rx="14"/><text class="dungeon-cell-id" x="${position.x}" y="${position.y - 5}">${escapeHtml(cell.id)}</text>${residentMarkers}</g>`;
    }).join('');
    const selectedCell = cellsById.get(selection.dungeonCellId ?? '');
    const occupantText = selectedCell
      ? (snapshot.dungeonMap.residents.filter((resident) => resident.floor === floorNumber && resident.cellId === selectedCell.id).map(({ actorId }) => actorId).join('、') || '目前沒有存活居民')
      : '選取地牢格可查看所在居民';
      const panel = `<section class="panel map-panel" aria-labelledby="map-title"><div class="panel-heading"><div><p class="eyebrow">世界位置</p><h2 id="map-title">${escapeHtml(floor?.label ?? '地牢樓層')}</h2></div><span class="count">${snapshot.dungeonMap.cells.length} 個 Cell · 地牢格內居民位置</span></div>${selectedMap}<details class="map-help" open><summary>地圖說明</summary><p class="help-text">點擊居民圓形符號可查看其資訊；Cell 內排列只表示居民所在地，不代表行動順序。</p></details><div class="map-viewport dungeon-map-viewport"><svg class="dungeon-map" viewBox="0 0 528 320" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${escapeHtml(floor?.label ?? '地牢樓層')}格子拓撲">${edges}${cells}</svg></div><p class="map-location-summary" role="status">${escapeHtml(occupantText)}</p></section>`;
    return renderWorldConsole(panel, snapshot, selection);
  }
  const nodesById = new Map(snapshot.map.nodes.map((node) => [node.id, node]));
  const edges = snapshot.map.edges.map((edge) => {
    const from = nodesById.get(edge.fromId);
    const to = nodesById.get(edge.toId);
    if (!from || !to) return '';
    return `<line class="map-edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
  }).join('');
  const nodes = snapshot.map.nodes.map((node) => {
    const selected = selection.nodeId === node.id;
    const label = node.label || '未逐點命名';
    const terrainClass = mapTerrainClass(node.surfaceTerrain);
    return `<g class="map-node ${terrainClass}${selected ? ' is-selected' : ''}" role="button" tabindex="0" aria-label="Node ${node.id}：${escapeHtml(label)}，${escapeHtml(node.labelStatus)}，${escapeHtml(mapTerrainLabel(node.surfaceTerrain))}" aria-pressed="${selected}" data-node-id="${node.id}"><title>${escapeHtml(label)}</title><circle cx="${node.x}" cy="${node.y}" r="15" /><text x="${node.x}" y="${node.y + 4}">${node.id}</text></g>`;
  }).join('');
  const mapResidents = snapshot.residents.filter((resident) => resident.alive !== false && resident.dungeonFloor === undefined && resident.dungeonCellId === undefined);
  const leftResidents = mapResidents.filter((_, index) => index % 2 === 0);
  const rightResidents = mapResidents.filter((_, index) => index % 2 === 1);
  const residentColors = ['#397d73', '#a76546', '#637d49', '#a27b36', '#557b91', '#93665b', '#6d806b', '#947b55'];
  const mapXOffset = 150;
  const connectors = mapResidents.map((resident) => {
    const side = mapResidents.indexOf(resident) % 2 === 0 ? 'left' : 'right';
    const sideResidents = side === 'left' ? leftResidents : rightResidents;
    const row = sideResidents.indexOf(resident);
    const y = 52 + (row + 1) * (719 / (sideResidents.length + 1));
    const node = resident.nodeId ? nodesById.get(resident.nodeId) : undefined;
    if (!node) return '';
    const startX = side === 'left' ? 114 : 1176;
    const startY = y + 18;
    const targetX = node.x + mapXOffset;
    const targetY = node.y;
    return `<path class="resident-map-link" style="--resident-color:${residentColors[snapshot.residents.indexOf(resident) % residentColors.length]}" d="M ${startX} ${startY} C ${side === 'left' ? 145 : 1145} ${startY}, ${side === 'left' ? targetX - 100 : targetX + 100} ${targetY}, ${targetX} ${targetY}" />`;
  }).join('');
  const renderMapResident = (resident: ObserverResident, side: 'left' | 'right'): string => {
    const sideResidents = side === 'left' ? leftResidents : rightResidents;
    const row = sideResidents.indexOf(resident);
    const y = 52 + (row + 1) * (719 / (sideResidents.length + 1));
    const color = residentColors[snapshot.residents.indexOf(resident) % residentColors.length];
    const location = resident.nodeId ? `目前位於 Node ${resident.nodeId}` : resident.movingToNodeId ? `目前位置未定，目的地 Node ${resident.movingToNodeId}` : '目前未定位';
    const movement = resident.movingToNodeId ? `，移動中，目的地 Node ${resident.movingToNodeId}` : '';
    return `<g class="map-resident-marker ${side}" style="--resident-color:${color}" role="button" tabindex="0" aria-label="居民 ${escapeHtml(resident.id)}，${escapeHtml(location + movement)}，選取查看資訊" data-resident-id="${escapeHtml(resident.id)}"><title>居民 ${escapeHtml(resident.id)} · ${escapeHtml(location + movement)}</title><circle cx="${side === 'left' ? 55 : 1245}" cy="${y + 18}" r="22"/><text x="${side === 'left' ? 55 : 1245}" y="${y + 22}">${escapeHtml(resident.id.replace(/^.*[-_]/, ''))}</text></g>`;
  };
  const mapPeople = `${leftResidents.map((resident) => renderMapResident(resident, 'left')).join('')}${rightResidents.map((resident) => renderMapResident(resident, 'right')).join('')}`;
  const mobileResidentChips = mapResidents.map((resident) => {
    const color = residentColors[snapshot.residents.indexOf(resident) % residentColors.length];
    const location = resident.nodeId ? `Node ${resident.nodeId}` : '未定位';
    return `<button type="button" class="map-mobile-resident" style="--resident-color:${color}" data-resident-id="${escapeHtml(resident.id)}"><span>${escapeHtml(resident.id)}</span><small>${location}</small></button>`;
  }).join('');
  const terrainLegend = `<ul class="map-legend" aria-label="地圖顏色圖例"><li><i class="terrain-beach"></i>海灘</li><li><i class="terrain-coconut-beach"></i>椰子沙灘</li><li><i class="terrain-forest"></i>森林</li><li><i class="terrain-berry-forest"></i>莓果森林</li><li><i class="terrain-river"></i>河流</li><li><i class="terrain-rock"></i>岩地／地牢入口</li><li><i class="terrain-port"></i>港口</li><li><i class="terrain-monument-valley"></i>紀念碑谷</li><li><i class="terrain-unclassified"></i>未分類</li></ul>`;
  const panel = `<section class="panel map-panel" aria-labelledby="map-title"><div class="panel-heading"><div><p class="eyebrow">世界位置</p><h2 id="map-title">主島地圖</h2></div><span class="count">${snapshot.map.nodes.length} 個 Node · ${snapshot.map.edges.length} 條道路</span></div>${selectedMap}<details class="map-help" open><summary>地圖顏色與居民標記</summary><p class="help-text">Node 顏色依遊戲資料的地形分類；居民連線指向目前記錄的 Node，移動目標另以文字標示。點居民圖示可查看資訊。</p>${terrainLegend}</details><div class="map-viewport"><svg class="island-map" viewBox="0 0 1300 823" preserveAspectRatio="xMidYMid meet" role="group" aria-label="輪迴島 Node 地形與居民位置"><g transform="translate(${mapXOffset} 0)">${edges}${nodes}</g>${connectors}${mapPeople}</svg><div class="map-mobile-residents" aria-label="居民位置清單">${mobileResidentChips || '<span class="empty-state">目前沒有居民位置</span>'}</div></div></section>`;
  return renderWorldConsole(panel, snapshot, selection);
}

function renderResidentRoster(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const allResidents = snapshot.residents.map((resident) => `<span data-resident-search-item data-search-text="${escapeHtml(`島民 ${resident.id} ${resident.id}`)}">${residentButton(resident.id, selection.residentId === resident.id)}</span>`).join('');
  return `<section class="panel resident-list-panel" id="resident-list-panel" role="tabpanel" data-tablist="resident-workspace-tabs" aria-labelledby="resident-list-title" tabindex="0"><div class="panel-heading resident-list-heading"><div><p class="eyebrow">居民清單</p><h2 id="resident-list-title">選取居民</h2></div><span class="count" data-resident-search-count>${snapshot.residents.length} 位</span></div><label class="resident-search-label" for="resident-search">搜尋居民 ID 或名稱</label><input id="resident-search" class="resident-search" type="search" data-resident-search aria-label="搜尋居民 ID 或名稱" placeholder="輸入居民 ID 或名稱" autocomplete="off"><div class="resident-roster" aria-label="居民清單">${allResidents || '<span class="empty-state">目前沒有居民資料</span>'}<span class="empty-state" data-resident-search-empty hidden>沒有符合搜尋的居民</span></div></section>`;
}

function renderResidentOverview(snapshot: ObserverSnapshot): string {
  const activeResidents = snapshot.residents.filter((resident) => resident.alive !== false);
  const surfaceResidents = activeResidents.filter((resident) => resident.nodeId !== null && resident.dungeonFloor === undefined && resident.dungeonCellId === undefined);
  const dungeonResidents = activeResidents.filter((resident) => resident.dungeonFloor !== undefined && resident.dungeonCellId !== undefined);
  const unlocatedResidents = activeResidents.length - surfaceResidents.length - dungeonResidents.length;
  const actions = activeResidents.slice(0, 6).map((resident) => {
    const location = resident.dungeonFloor !== undefined && resident.dungeonCellId !== undefined
      ? `地牢第 ${resident.dungeonFloor} 層 · Cell ${resident.dungeonCellId}`
      : resident.nodeId === null ? '目前不屬於任何 Node' : `Node ${resident.nodeId}`;
    return `<li>${residentButton(resident.id, false)}<span>${escapeHtml(location)}</span><strong>${escapeHtml(resident.lastAction || '尚無行動資料')}</strong></li>`;
  }).join('');
  return `<section class="panel resident-detail-panel resident-overview" id="resident-detail-panel" role="tabpanel" data-tablist="resident-workspace-tabs" aria-labelledby="resident-overview-title" tabindex="0"><div class="panel-heading"><div><p class="eyebrow">目前居民</p><h2 id="resident-overview-title">居民分布與行動</h2></div></div><dl class="fact-grid"><div><dt>居民記錄</dt><dd>${snapshot.residents.length}</dd></div><div><dt>目前存活</dt><dd>${activeResidents.length}</dd></div><div><dt>地表 Node</dt><dd>${surfaceResidents.length}</dd></div><div><dt>地牢位置</dt><dd>${dungeonResidents.length}</dd></div><div><dt>未定位</dt><dd>${unlocatedResidents}</dd></div></dl><h3>目前居民行動</h3><ul class="resident-overview-list">${actions || '<li class="empty-state">目前沒有居民行動資料</li>'}</ul>${activeResidents.length > 6 ? '<p class="help-text">其餘居民可由左側清單選取。</p>' : ''}</section>`;
}

function renderResident(snapshot: ObserverSnapshot, selection: ObserverSelection, residentsWorkspace = false): string {
  const node = snapshot.map.nodes.find((candidate) => candidate.id === selection.nodeId);
  const resident = snapshot.residents.find((candidate) => candidate.id === selection.residentId);
  if (resident) {
    const location = resident.dungeonFloor !== undefined && resident.dungeonCellId
      ? `地牢第 ${resident.dungeonFloor} 層 · Cell ${resident.dungeonCellId}`
      : resident.nodeId === null
      ? resident.movingToNodeId === undefined ? '目前不屬於任何 Node' : `移動中，目的 Node ${resident.movingToNodeId}`
      : `Node ${resident.nodeId}`;
    const intents = resident.intents ?? [];
    const recentIntents = intents.slice(-20).reverse();
    const intentContent = recentIntents.length === 0
      ? '<span class="empty-state">目前尚無意圖紀錄。</span>'
      : `<ol class="observer-intent-records" tabindex="0" aria-label="最近居民意圖紀錄">${recentIntents.map((entry) => typeof entry === 'string'
        ? `<li>${escapeHtml(entry)}</li>`
        : `<li><span>第 ${entry.day} 日 · ${entry.timeT}T${entry.nodeId ? ` · ${escapeHtml(formatNodeLocationReference(entry.nodeId, entry.nodeLabel))}` : ''}</span><p>${escapeHtml(entry.description)}</p><small>意圖：${escapeHtml(entry.intent)}</small></li>`).join('')}</ol>`;
    const intentCard = `<div class="wide observer-intent"><dt>觀察資訊 · 居民 AI 意圖（最近 ${recentIntents.length} 則，共 ${intents.length} 則）</dt><dd>${intentContent}</dd></div>`;
    return `<section class="panel detail-panel${residentsWorkspace ? ' resident-detail-panel' : ''}"${residentsWorkspace ? ' id="resident-detail-panel" role="tabpanel" data-tablist="resident-workspace-tabs" tabindex="0"' : ''} aria-labelledby="detail-title"><div class="panel-heading"><div><p class="eyebrow">玩家觀察</p><h2 id="detail-title">居民 ${escapeHtml(resident.id)}</h2></div><span class="badge">${resident.generation === null ? '代次未設定' : `第 ${resident.generation} 代`}</span></div><dl class="fact-grid"><div><dt>所在位置</dt><dd>${escapeHtml(location)}</dd></div><div><dt>使用模型</dt><dd>${escapeHtml(resident.model ?? '尚未配置')}</dd></div><div><dt>餘命</dt><dd>${escapeHtml(resident.remainingLife ?? '來源未提供')}</dd></div><div><dt>飽食</dt><dd>${escapeHtml(resident.hunger ?? '來源未提供')}</dd></div><div><dt>睡眠</dt><dd>${escapeHtml(resident.sleep ?? '來源未提供')}</dd></div><div><dt>上一行動</dt><dd>${escapeHtml(resident.lastAction || '尚無資料')}</dd></div><div class="wide"><dt>上一行動結果</dt><dd>${escapeHtml(resident.lastActionResult || '尚無資料')}</dd></div>${intentCard}<div class="wide"><dt>背包</dt><dd>${resident.inventory.length ? resident.inventory.map(escapeHtml).join('、') : '空或尚未提供'}</dd></div><div class="wide"><dt>裝備</dt><dd>${resident.equipment.length ? resident.equipment.map(escapeHtml).join('、') : '無或尚未提供'}</dd></div></dl><p class="boundary-note">這是玩家觀察投影，不代表其他居民可看見這些數值；居民 AI 意圖是本機觀察資訊，並非居民公開說出的事件。本畫面沒有居民行動指令。</p></section>`;
  }
  if (node) {
    const people = node.residents.map((id) => residentButton(id, false)).join('');
    const objects = node.objects.length ? node.objects.map((object) => escapeHtml(object.label)).join('、') : '目前沒有物件資料';
    const scene = node.previousScene;
    const sceneContent = scene?.events.length
      ? `<p class="help-text">最近有紀錄的時間：第 ${scene.day} 日 · ${scene.timeT}T</p><ol class="island-event-list">${scene.events.map((event) => `<li><p>${escapeHtml(event.description)}</p><small>${event.intent ? `行動方向：${escapeHtml(event.intent)} · ` : ''}${escapeHtml(event.interaction ?? '環境事件')}</small></li>`).join('')}</ol>`
      : '<p class="empty-state">本 Node 上一回合沒有已記錄事件。</p>';
    return `<section class="panel detail-panel" aria-labelledby="detail-title"><div class="panel-heading"><div><p class="eyebrow">地點觀察</p><h2 id="detail-title">Node ${node.id}</h2></div><span class="badge">${escapeHtml(node.labelStatus)}</span></div><dl class="fact-grid"><div><dt>地點標籤</dt><dd>${escapeHtml(node.label || '未逐點命名')}</dd></div><div class="wide"><dt>物件與資源</dt><dd>${objects}</dd></div></dl><h3>最近已記錄事件</h3>${sceneContent}<p class="help-text">世界資料沒有獨立回合編號；此處依該 Node 最近有事件的遊戲時間分組顯示，內容取自已存事件。</p><h3>此 Node 存活居民</h3><div class="resident-roster">${people || '<span class="empty-state">目前沒有存活居民資料</span>'}</div></section>`;
  }
  return `<section class="panel detail-panel empty-detail"><p class="eyebrow">只讀觀察</p><h2 id="detail-title">選擇地點或居民</h2><p>選擇地圖上的 Node 或居民編號，可查看來源提供的世界資料。</p></section>`;
}

function renderControls(snapshot: ObserverSnapshot): string {
  const controlDisabled = snapshot.simulation.controllable === false;
  const speed = snapshot.simulation.speedMultiplier ?? 1;
  const speedOptions = [0.5, 1, 2].map((value) => `<option value="${value}"${value === speed ? ' selected' : ''}>${value} 倍</option>`).join('');
  return `<section class="panel controls-panel" aria-label="模擬控制"><div class="status-copy"><span class="status-dot${snapshot.simulation.running ? ' is-running' : ''}"></span><strong>${snapshot.simulation.controllable === false ? '執行控制器未連接' : snapshot.simulation.running ? '模擬執行中' : '模擬已暫停'}</strong>${snapshot.simulation.status ? `<span role="status">${escapeHtml(snapshot.simulation.status)}</span>` : ''}</div><div class="control-actions"><button type="button" data-control="pause"${controlDisabled || !snapshot.simulation.running ? ' disabled' : ''}>${renderUiIcon('pause')}暫停</button><button type="button" data-control="resume"${controlDisabled || snapshot.simulation.running ? ' disabled' : ''}>${renderUiIcon('play')}恢復</button><label>模擬倍率<select data-control-setting="speed"${controlDisabled ? ' disabled' : ''}>${speedOptions}</select></label></div><p class="control-feedback" data-control-feedback role="alert" aria-live="assertive" hidden></p></section>`;
}

function renderSavedGameControls(snapshot: ObserverSnapshot, setup: boolean): string {
  const lifecycle = snapshot.lifecycle;
  if (!lifecycle) return '';
  const options = lifecycle.saves.map((save) => `<option value="${escapeHtml(save.saveId)}">${escapeHtml(save.sessionName)} · ${escapeHtml(save.name)} · ${escapeHtml(save.sequence)} 事件 · ${escapeHtml(save.savedAt)}</option>`).join('');
  const primaryControls = setup
    ? `<label>新局名稱<input data-session-name maxlength="80" value="輪迴島新局" placeholder="輸入存檔名稱"></label><button type="button" data-lifecycle="start">開始新局</button>`
    : `<label>存檔名稱<input data-save-name maxlength="80" placeholder="例如：第 3 日夜間"></label><div class="button-row"><button type="button" data-lifecycle="save">存檔</button><button type="button" data-lifecycle="end">結束當局</button></div>`;
  const loadControls = `<label>讀取／切換存檔<select data-save-select${options ? '' : ' disabled'}><option value="">${options ? '選擇要載入的存檔' : '尚無存檔'}</option>${options}</select></label>`;
  const loadButton = `<button type="button" data-lifecycle="load"${options ? '' : ' disabled'}>載入存檔</button>`;
  return `<section class="panel session-actions" aria-label="遊戲局與存檔"><div class="session-card-left"><div class="panel-heading"><div><p class="eyebrow">遊戲資料</p><h2>${setup ? '新局準備' : '目前遊戲'}</h2><p class="panel-intro">${escapeHtml(lifecycle.sessionName)} · ${lifecycle.residentCount} 位居民 · ${lifecycle.status === 'setup' ? '尚未開始' : lifecycle.status === 'ended' ? '已結束' : '進行中'}</p></div></div><div class="session-action-controls${setup ? ' is-setup' : ''}">${primaryControls}</div></div><div class="session-card-right">${setup ? '' : renderControls(snapshot)}${loadControls}${loadButton}</div><p class="control-feedback" data-lifecycle-feedback role="status" aria-live="polite"></p></section>`;
}

function renderSetupMarkup(snapshot: ObserverSnapshot, settings?: ModelSettingsView): string {
  const slots = settings?.slots ?? [];
  const residentCount = snapshot.lifecycle?.nextResidentCount ?? snapshot.lifecycle?.residentCount ?? 10;
  const readySlots = slots.filter((slot) => slot.provider && slot.baseUrl && slot.model && slot.apiKeyConfigured
    && slot.maxInputTokens !== null);
  const assignments = Array.from({ length: residentCount }, (_, index) => {
    const residentIndex = index + 1;
    const selectedSlot = snapshot.lifecycle?.residentTemplateSlots[residentIndex] ?? (residentIndex <= 10 ? residentIndex : 1);
    const selectedReady = readySlots.some((slot) => slot.slotId === selectedSlot);
    const options = slots.map((slot) => {
      const ready = readySlots.some((candidate) => candidate.slotId === slot.slotId);
      return `<option value="${slot.slotId}"${ready && selectedReady && selectedSlot === slot.slotId ? ' selected' : ''}${ready ? '' : ' disabled'}>模型卡 ${slot.slotId}${ready ? ` · ${escapeHtml(slot.provider ?? '')} / ${escapeHtml(slot.model ?? '')}` : ' · 設定未完成'}</option>`;
    }).join('');
    const emptyLabel = !readySlots.length
      ? '沒有已完成的模型卡'
      : selectedReady ? '選擇已完成的模型卡' : `目前選取模型卡 ${selectedSlot} 尚未完成，請改選`;
    return `<label>居民 ${String(residentIndex).padStart(2, '0')}<select data-setup-model="${residentIndex}"${readySlots.length ? '' : ' disabled'}><option value=""${selectedReady ? '' : ' selected'}>${emptyLabel}</option>${options}</select></label>`;
  }).join('');
  const hasUnavailableAssignment = Array.from({ length: residentCount }, (_, index) => {
    const selectedSlot = snapshot.lifecycle?.residentTemplateSlots[index + 1] ?? (index < 10 ? index + 1 : 1);
    return !readySlots.some((slot) => slot.slotId === selectedSlot);
  }).some(Boolean);
  const modelSetupHint = !readySlots.length
    ? `<div class="setup-model-unavailable" role="status"><p>目前沒有可分配的已完成模型卡。請到右側「建立模型卡」完成必要欄位並儲存；完成後即可在此選擇，同一張卡可重複分配。</p><button type="button" data-setup-open-model-settings>前往建立模型卡</button></div>`
    : hasUnavailableAssignment
      ? `<div class="setup-model-unavailable" role="status"><p>部分居民目前指向尚未完成的模型卡。可在居民選單改選可用卡，或到右側完成對應模型卡並儲存。</p><button type="button" data-setup-open-model-settings>前往建立模型卡</button></div>`
      : '';
  const summarySelection = renderSummarizerSelection(settings, 'setup');
  const mapProfiles = snapshot.lifecycle?.mapProfiles ?? [];
  const selectedMapId = snapshot.lifecycle?.setupMapId ?? 'default-map';
  const mapOptions = mapProfiles.map((profile) => `<option value="${escapeHtml(profile.mapId)}"${profile.mapId === selectedMapId ? ' selected' : ''}>${escapeHtml(profile.name)}</option>`).join('');
  return `<main class="observer-shell" data-active-tab="setup"><header class="topbar"><div class="observer-brand"><span class="observer-mark" aria-hidden="true">${renderUiIcon('world')}</span><div><p class="eyebrow">輪迴島 · 新局準備</p><h1>開始遊戲</h1></div></div>${renderSavedGameControls(snapshot, true)}</header><div class="setup-grid"><aside class="setup-sidebar" aria-label="開始前資料設定"><section class="panel setup-intro"><p class="eyebrow">開始前設定</p><h2>準備你的島嶼</h2><p>設定本局居民人數與居民模型分配；開始後人數固定。</p><p class="hint-box" data-setup-target-count="${residentCount}">本局目標：<strong>${residentCount}</strong> 位居民</p></section><details class="panel setup-fold setup-resident-count" open><summary>居民人數</summary><div class="setup-fold-body"><label for="setup-resident-count">設定新局居民人數<input id="setup-resident-count" data-setup-resident-count type="number" min="1" step="1" inputmode="numeric" value="${residentCount}"></label><button type="button" data-setup-resident-count-save>儲存人數</button><p class="control-feedback" data-setup-resident-count-feedback role="status" aria-live="polite">只影響尚未開始的新局；目前遊戲不會改變。</p></div></details><details class="panel setup-fold setup-assignment" open><summary id="setup-model-assignment">本局居民模型分配</summary><div class="setup-fold-body"><p class="help-text">為每位居民選擇已完成設定的模型卡；同一張卡可重複分配。</p>${modelSetupHint}<div class="setup-model-list">${assignments}</div><p class="settings-status" data-setup-model-feedback role="status" aria-live="polite"></p></div></details><details class="panel setup-fold"><summary>死亡總結者卡</summary>${summarySelection}</details><details class="panel setup-fold"><summary>地圖選擇</summary><label for="setup-map-profile">開始使用的地圖</label><select id="setup-map-profile" data-setup-map-profile>${mapOptions}</select><p class="help-text">遊戲將依選定地圖的地形、出生點、營火與告示綁定建立世界。</p><p class="control-feedback" data-setup-map-feedback role="status" aria-live="polite"></p></details></aside><div class="setup-workspace"><section class="setup-model-settings-workspace">${renderModelSettings(settings)}</section><div class="setup-diagnostics"></div></div></div><footer class="freshness">資料更新：<time>${escapeHtml(snapshot.simulation.freshAt)}</time><span>遊戲尚未開始</span></footer><div class="live-status" role="status" aria-live="polite"></div></main>`;
}

function renderSummarizerSelection(settings: ModelSettingsView | undefined, idPrefix: string): string {
  const slots = settings?.slots ?? [];
  const summarySettings = settings?.summarizer ?? { modelSlotId: null, prompt: '' };
  const ready = (slot: ModelSlotSettingsView) => Boolean(slot.provider && slot.baseUrl && slot.model && slot.apiKeyConfigured && slot.maxInputTokens !== null);
  const selectedSlot = slots.find(({ slotId }) => slotId === summarySettings.modelSlotId);
  const options = slots.map((slot) => {
    const selected = summarySettings.modelSlotId === slot.slotId;
    return `<option value="${slot.slotId}"${selected ? ' selected' : ''}${ready(slot) || selected ? '' : ' disabled'}>模型卡 ${slot.slotId}${slot.provider && slot.model ? ` · ${escapeHtml(slot.provider)} / ${escapeHtml(slot.model)}` : ' · 尚未設定'}${ready(slot) ? '' : '（設定未完成）'}</option>`;
  }).join('');
  const currentSelection = selectedSlot
    ? `目前選用：模型卡 ${selectedSlot.slotId}${selectedSlot.provider && selectedSlot.model ? ` · ${escapeHtml(selectedSlot.provider)} / ${escapeHtml(selectedSlot.model)}` : ' · 設定未完成'}`
    : '目前未指定死亡總結模型卡。';
  return `<section class="panel model-settings-panel summarizer-panel" aria-labelledby="${idPrefix}-summarizer-title"><div class="panel-heading"><div><p class="eyebrow">死亡居民回顧</p><h2 id="${idPrefix}-summarizer-title">死亡總結模型卡</h2><p class="panel-intro">選擇已建立的模型卡；連線與金鑰沿用該卡設定，居民也可共用。</p></div></div><form data-summarizer-settings class="summarizer-selection"><label for="${idPrefix}-summarizer-model">套用模型卡</label><select id="${idPrefix}-summarizer-model" name="modelSlotId" data-summarizer-slot><option value="">不指定模型卡</option>${options}</select><p class="summarizer-current" data-summarizer-current>${currentSelection}</p><label for="${idPrefix}-summarizer-prompt">總結指示（選填）</label><textarea id="${idPrefix}-summarizer-prompt" name="prompt" maxlength="4000" rows="3">${escapeHtml(summarySettings.prompt)}</textarea><p class="help-text">使用模型卡的連線、token 上限與已保存金鑰；不另設供應商或金鑰欄位。</p><button type="submit">儲存死亡總結設定</button><p data-summarizer-feedback role="status" aria-live="polite"></p></form></section>`;
}

function renderTimeline(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const selectedEvents = snapshot.events.filter((event) => {
    if (event.visibility !== 'public' && event.visibility !== 'observer') return false;
    if (selection.eventResidentId && event.actorId !== selection.eventResidentId && !event.participantIds?.includes(selection.eventResidentId)) return false;
    return true;
  }).sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0));
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(selectedEvents.length / pageSize));
  const page = Number.isSafeInteger(selection.eventPage) && selection.eventPage! > 0 ? Math.min(selection.eventPage!, pageCount) : 1;
  const rows = selectedEvents.length
    ? selectedEvents.map((event, index) => {
      const rowPage = Math.floor(index / pageSize) + 1;
      return `<li data-history-page="${rowPage}"${rowPage === page ? '' : ' hidden'}><time>第 ${event.day} 日 · ${event.timeT}T</time><p>${escapeHtml(event.description)}</p><small>意圖：${escapeHtml(event.intent ?? '意圖未記錄')} · 互動雙方：${escapeHtml(event.interaction ?? '無居民互動對象（環境事件）')}</small><span>${formatEventLocation(event)}</span></li>`;
    }).join('')
    : '<li class="empty-state" data-history-page="1">此範圍目前沒有已結算事件</li>';
  const residentIds = new Set(snapshot.residents.map((resident) => resident.id));
  for (const event of snapshot.events) for (const participantId of event.participantIds ?? []) residentIds.add(participantId);
  if (selection.eventResidentId) residentIds.add(selection.eventResidentId);
  const residentOptions = [...residentIds].sort().map((id) => `<option value="${escapeHtml(id)}"${id === selection.eventResidentId ? ' selected' : ''}>居民 ${escapeHtml(id)}</option>`).join('');
  const filterLabel = selection.eventResidentId ? `居民 ${selection.eventResidentId}` : '全部可見事件';
  return `<section class="panel timeline-panel" id="timeline-panel" aria-labelledby="timeline-title"><div class="panel-heading"><div><p class="eyebrow">已結算客觀事件</p><h2 id="timeline-title">事件時間線</h2></div><label class="timeline-filter">事件範圍<select data-event-resident-filter aria-label="選擇事件範圍"><option value=""${selection.eventResidentId ? '' : ' selected'}>全部可見事件</option>${residentOptions}</select></label><span class="badge">${escapeHtml(filterLabel)}</span></div><nav class="history-pager" data-history-pager data-page="${page}" data-pages="${pageCount}" data-total="${selectedEvents.length}" aria-label="歷史事件分頁"><button type="button" data-history-page-step="previous"${page === 1 ? ' disabled' : ''}>上一頁</button><span data-history-page-status role="status" aria-live="polite">第 ${page} 頁，共 ${pageCount} 頁 · ${selectedEvents.length} 筆事件</span><button type="button" data-history-page-step="next"${page === pageCount ? ' disabled' : ''}>下一頁</button></nav><ol class="timeline">${rows}</ol></section>`;
}

function formatEventLocation(event: { readonly nodeId?: string; readonly nodeLabel?: string }): string {
  return event.nodeId === undefined
    ? '全島事件'
    : escapeHtml(formatNodeLocationReference(event.nodeId, event.nodeLabel));
}

function renderDeathSummaries(settings?: ModelSettingsView, lifecycle?: NonNullable<ObserverSnapshot['lifecycle']>): string {
  const entries = [...(settings?.deathSummaries ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const rows = entries.map((item) => {
    const sourceIsCurrent = Boolean(item.sessionId && item.loadInstanceId && lifecycle?.sessionId === item.sessionId && lifecycle.loadedSaveId === item.sourceSaveId && lifecycle.loadInstanceId === item.loadInstanceId);
    const sameLoadedSave = Boolean(item.sessionId && lifecycle?.sessionId === item.sessionId && lifecycle.loadedSaveId === item.sourceSaveId);
    const retry = item.status === 'failed' && sourceIsCurrent
      ? `<button type="button" data-retry-death-summary="${escapeHtml(item.residentId)}" data-summary-id="${escapeHtml(item.summaryId)}" data-session-id="${escapeHtml(item.sessionId ?? '')}" data-source-save-id="${escapeHtml(item.sourceSaveId ?? '')}" data-load-instance-id="${escapeHtml(item.loadInstanceId ?? '')}">重試此居民總結</button><span role="status" data-death-summary-retry-status></span>`
      : item.status === 'failed' ? `<p class="help-text">${sameLoadedSave ? '此摘要屬於同一存檔的先前載入分支；重新載入會建立新分支，為避免重用錯誤事件紀錄，暫不提供重試。' : item.sourceSaveId ? '此摘要屬於另一個存檔或遊戲；只有載入其來源存檔且仍在原載入分支時才能重試。' : '此失敗摘要沒有可核對的來源存檔 ID，為避免重試錯誤存檔，暫不提供重試。'}</p>` : '';
    const statusLabel = item.status === 'complete' ? (item.text?.trim() ? '完成' : '無內容') : item.status === 'failed' ? '失敗' : item.status === 'running' ? '生成中' : item.status === 'pending' ? '等待生成' : '無內容';
    const updatedAtDate = new Date(item.updatedAt);
    const updatedAtLabel = Number.isNaN(updatedAtDate.valueOf()) ? item.updatedAt : updatedAtDate.toLocaleString('zh-TW');
    const summaryText = item.text?.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
      || `<p class="help-text">${item.status === 'pending' ? '生命故事正在等待生成。' : item.status === 'running' ? '生命故事正在編寫中。' : item.status === 'failed' ? '生命故事生成失敗，請查看下方原因。' : '目前沒有可顯示的生命故事。'}</p>`;
    return `<details class="biography" data-death-summary-id="${escapeHtml(item.summaryId)}" data-summary-name="${escapeHtml(item.displayName)}" data-summary-resident-id="${escapeHtml(item.residentId)}" data-summary-status="${escapeHtml(item.status)}" data-summary-updated-at="${escapeHtml(item.updatedAt)}"><summary>${escapeHtml(item.displayName)} · 總結${statusLabel}</summary><time class="summary-updated-at" datetime="${escapeHtml(item.updatedAt)}">更新於 ${escapeHtml(updatedAtLabel)}</time>${summaryText}${item.error ? `<p class="help-text">${escapeHtml(item.error)}</p>` : ''}<span class="help-text">依居民行動與相關事件整理</span>${retry}</details>`;
  }).join('');
  return `<section class="panel biography-panel" id="death-summary-list"><div class="panel-heading"><div><p class="eyebrow">死亡居民</p><h2>生命行動總結</h2></div></div><div class="death-summary-controls"><label>搜尋居民<input type="search" data-death-summary-search placeholder="姓名或居民 ID"></label><label>排序<select data-death-summary-sort><option value="newest">最近更新</option><option value="oldest">最早更新</option><option value="name">居民名稱</option><option value="resident-id">居民 ID</option><option value="status">摘要狀態</option></select></label></div><p class="empty-state" data-death-summary-empty${rows ? ' hidden' : ''}>${rows ? '沒有符合搜尋條件的死亡總結' : '尚無死亡居民總結'}</p><div data-death-summary-entries>${rows}</div></section>`;
}

function renderLatestAiFormatError(settings?: ModelSettingsView): string {
  const error = settings?.latestAiFormatError;
  return `<section class="panel biography-panel" aria-labelledby="latest-ai-format-error-title"><div class="panel-heading"><div><p class="eyebrow">玩家專屬診斷</p><h2 id="latest-ai-format-error-title">最近一次 AI 格式錯誤</h2></div></div>${error
    ? `<p>時間：<time>${escapeHtml(error.recordedAt)}</time> · 居民：${escapeHtml(error.actorId)} · 原因：<code>${escapeHtml(error.reason)}</code></p><details><summary>查看完整模型原始輸出</summary><pre class="ai-format-error-output">${escapeHtml(error.rawOutput)}</pre></details>`
    : '<p class="empty-state">目前沒有已記錄的 AI 格式錯誤。</p>'}</section>`;
}

function renderModelSettings(settings?: ModelSettingsView): string {
  const slots = settings?.slots?.length ? settings.slots : Array.from({ length: 10 }, (_, index) => ({
    slotId: index + 1, provider: null, baseUrl: null, model: null, fallbackModels: [], inputUsdPerMillion: null,
    outputUsdPerMillion: null, maxInputTokens: null, maxContextCharacters: 8000, styleDescription: null, updatedAt: null, apiKeyConfigured: false,
  }));
  const activeSlot = slots[0]?.slotId ?? 1;
  const rows = slots.map((slot) => {
    const fallbackCandidates = slots.filter((candidate) => candidate.slotId !== slot.slotId
      && candidate.provider === slot.provider && candidate.baseUrl === slot.baseUrl
      && candidate.provider && candidate.baseUrl && candidate.model);
    const compatibleModelIds = new Set(fallbackCandidates.map((candidate) => candidate.model ?? ''));
    const oldFallbacks = slot.fallbackModels.filter((model) => !compatibleModelIds.has(model));
    const fallbackChoices = oldFallbacks.map((model) => `<label class="fallback-option"><input type="checkbox" name="fallbackModels" value="${escapeHtml(model)}" checked><span>既有備援 ${escapeHtml(model)} · 未匹配其他相同供應商槽位</span></label>`)
      .concat(fallbackCandidates.map((candidate) => `<label class="fallback-option"><input type="checkbox" name="fallbackModels" value="${escapeHtml(candidate.model ?? '')}"${slot.fallbackModels.includes(candidate.model ?? '') ? ' checked' : ''}><span>槽位 ${candidate.slotId} · ${escapeHtml(candidate.provider ?? '')} / ${escapeHtml(candidate.model ?? '')}</span></label>`))
      .join('');
    const currentModel = slot.model ? `<option value="${escapeHtml(slot.model)}" selected>${escapeHtml(slot.model)}（尚未重新讀取費率）</option>` : '<option value="" selected>先載入模型清單</option>';
    const tabs = [
      ['connection', '連線與模型'], ['style', '居民風格'], ['billing', '費率與帳務'],
    ] as const;
    const tabMarkup = tabs.map(([id, label], index) => `<button type="button" role="tab" id="model-section-tab-${slot.slotId}-${id}" aria-controls="model-section-${slot.slotId}-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-tab="${id}">${label}</button>`).join('');
    const openRouterSlot = slot.baseUrl?.toLowerCase().includes('openrouter.ai') === true;
    const createKeyControl = `<div class="openrouter-slot-key"><button type="button" data-create-openrouter-key="${slot.slotId}"${!openRouterSlot || slot.apiKeyConfigured ? ' disabled' : ''}>${renderUiIcon('add')}${slot.apiKeyConfigured ? '槽位金鑰已保存' : '由 Management key 建立槽位推理 key'}</button><p data-openrouter-slot-status role="status" aria-live="polite">${!openRouterSlot ? '將 API Base URL 設為 OpenRouter 後可使用。' : slot.apiKeyConfigured ? '避免重複建立，這個槽位已有已保存的金鑰。' : '新 key 會本機持久保存於模型設定資料庫；頁面只顯示是否已設定，不會回傳明文。'}</p></div>`;
    return `<form data-model-settings data-slot-id="${slot.slotId}"${slot.slotId === activeSlot ? '' : ' hidden'}><fieldset class="model-slot"><legend>模型槽位 ${slot.slotId}</legend><div class="model-section-tabs" role="tablist" id="model-section-tabs-${slot.slotId}" aria-label="模型槽位 ${slot.slotId} 設定區段">${tabMarkup}</div><section class="model-section-panel" role="tabpanel" id="model-section-${slot.slotId}-connection" data-tablist="model-section-tabs-${slot.slotId}" aria-labelledby="model-section-tab-${slot.slotId}-connection" tabindex="0"><div class="model-connection-fields"><label>供應商名稱<input name="provider" value="${escapeHtml(slot.provider ?? '')}" maxlength="80" autocomplete="off"></label><label>API Base URL<input name="baseUrl" type="url" value="${escapeHtml(slot.baseUrl ?? '')}" placeholder="https://…" autocomplete="url"></label><div class="model-id-picker"><label>搜尋模型<input type="search" data-model-search placeholder="搜尋已載入的模型 ID" autocomplete="off"></label><label>模型 ID<select name="model" data-model-select>${currentModel}</select></label><button type="button" data-load-model-list>${renderUiIcon('refresh')}載入模型清單</button><p class="model-list-feedback" data-model-list-feedback role="status" aria-live="polite">尚未讀取供應商模型與費率。</p></div><label>上下文字元上限<input name="maxContextCharacters" type="number" min="1" step="1" inputmode="numeric" value="${slot.maxContextCharacters ?? 8000}"></label><p class="help-text">限制每回合送給 AI 的完整上下文字元數；與供應商 token 上限不同。超出時優先省略較舊記憶，必要內容超限會停止呼叫，不會刪除記憶。</p><label>API 金鑰<input name="apiKey" type="password" value="" autocomplete="new-password" placeholder="${slot.apiKeyConfigured ? '已設定；留白沿用' : '未設定'}"></label><p class="help-text">${slot.apiKeyConfigured ? '金鑰已保存；留白即可沿用。可勾選清除金鑰；頁面不會回顯明文。' : '金鑰會本機持久保存於模型設定資料庫；頁面只呈現是否已設定。'}</p><div class="fallback-picker" role="group" aria-label="備援模型"><span class="fallback-picker-label">備援模型</span><input type="search" data-fallback-search aria-label="搜尋備援模型" placeholder="搜尋其他已配置槽位" autocomplete="off"${fallbackChoices ? '' : ' disabled'}><div class="fallback-options" data-fallback-options>${fallbackChoices}<p class="empty-state" data-fallback-empty${fallbackChoices ? ' hidden' : ''}>${fallbackChoices ? '沒有符合搜尋的備援模型' : '目前沒有其他已設定模型槽位'}</p></div><span class="help-text">可複選；僅列出其他相同供應商與端點的槽位。</span></div><label class="clear-secret"><input name="clearApiKey" type="checkbox" value="true">清除已保存金鑰</label>${createKeyControl}</div></section><section class="model-section-panel" role="tabpanel" id="model-section-${slot.slotId}-style" data-tablist="model-section-tabs-${slot.slotId}" aria-labelledby="model-section-tab-${slot.slotId}-style" tabindex="0" hidden><div class="model-connection-fields"><label>此槽位風格（選填）<input name="styleDescription" value="${escapeHtml(slot.styleDescription ?? '')}" maxlength="160" autocomplete="off" placeholder="例如：謹慎探索、重視交換"></label></div></section><section class="model-section-panel cost-estimation" role="tabpanel" id="model-section-${slot.slotId}-billing" data-tablist="model-section-tabs-${slot.slotId}" aria-labelledby="model-section-tab-${slot.slotId}-billing" tabindex="0" hidden><input type="hidden" name="inputUsdPerMillion" value=""><input type="hidden" name="outputUsdPerMillion" value=""><p class="provider-cost-status" data-provider-cost-status>請載入模型清單；僅顯示提供者 API 回傳的費率。</p><p class="provider-billing-status" data-provider-billing-status role="status" aria-live="polite">請在下方輸入 Management key，僅查詢 OpenRouter 實際帳務。</p><div class="openrouter-management" data-openrouter-management><label>OpenRouter Management key（僅本次執行）<input type="password" data-management-key autocomplete="new-password" placeholder="不會寫入資料庫或回傳明文"></label><div><button type="button" data-save-management-key>驗證並暫存</button><button type="button" data-refresh-openrouter-account>重新查詢帳務與 key 使用量</button></div><p data-openrouter-account-feedback role="status" aria-live="polite">Management key 僅保存在伺服器記憶體；一般模型呼叫仍使用槽位推理 key。</p><div data-openrouter-account-summary></div></div></section><div class="model-form-actions"><p class="model-form-error" data-model-form-error role="alert" hidden></p><p class="model-form-feedback" data-model-form-feedback role="status" aria-live="polite"></p><button type="submit">${renderUiIcon('save')}儲存槽位</button><span class="slot-status">${slot.apiKeyConfigured ? '金鑰已保存' : '金鑰未設定'}</span></div></fieldset></form>`;
  }).join('');
  const slotOptions = slots.map((slot) => `<option value="${slot.slotId}"${slot.slotId === activeSlot ? ' selected' : ''}>槽位 ${slot.slotId} · ${slot.provider && slot.model ? '已填模型' : '待設定'}${slot.apiKeyConfigured ? ' · 金鑰已設定' : ''}</option>`).join('');
  return `<section class="panel model-settings-panel" aria-labelledby="model-settings-title"><div class="panel-heading"><div><p class="eyebrow">可重用模板</p><h2 id="model-settings-title" tabindex="-1">建立模型卡</h2></div></div><div class="settings-toolbar"><label>編輯居民槽位<select data-slot-select aria-label="選擇要編輯的居民模型槽位">${slotOptions}</select></label><button type="button" data-create-model-slot>新增模型卡</button></div><details class="settings-guidance"><summary>設定規則與相容性</summary><p class="help-text">OpenRouter 帳務與各 key 使用量需 Management key 權限；普通推理 key 僅供模型 API 呼叫。</p></details>${rows}<p class="settings-status" role="status" aria-live="polite"></p></section>`;
}

function renderSessionModelAssignments(snapshot: ObserverSnapshot, settings?: ModelSettingsView): string {
  const slots = settings?.slots ?? [];
  const residents = [...snapshot.residents].sort(compareResidentLineage).map((resident) => {
    const options = slots.map((slot) => `<option value="${slot.slotId}"${resident.modelSlotId === slot.slotId ? ' selected' : ''}${slot.provider && slot.model ? '' : ' disabled'}>模型卡 ${slot.slotId}${slot.provider && slot.model ? ` · ${escapeHtml(slot.provider)} / ${escapeHtml(slot.model)}` : ' · 尚未設定'}</option>`).join('');
    return `<li><div><strong>${escapeHtml(resident.id)}</strong><span>${escapeHtml(resident.model ?? '尚未配置')}</span></div><label>本局模型卡<select data-resident-model="${escapeHtml(resident.id)}"${slots.some((slot) => slot.provider && slot.model) ? '' : ' disabled'}><option value="">選擇模型卡</option>${options}</select></label></li>`;
  }).join('');
  return `<section class="panel model-settings-panel" aria-labelledby="session-model-title"><div class="panel-heading"><div><p class="eyebrow">本局副本</p><h2 id="session-model-title">居民模型卡分配</h2><p class="panel-intro">可讓多人使用同一張卡。此處變更只寫入當前遊戲存檔，不改動工房模板。</p></div></div><ul class="session-model-list">${residents || '<li class="empty-state">目前沒有居民資料</li>'}</ul><p class="settings-status" data-session-model-feedback role="status" aria-live="polite"></p></section>`;
}

function compareResidentLineage(first: ObserverResident, second: ObserverResident): number {
  const firstParts = residentLineageParts(first.id);
  const secondParts = residentLineageParts(second.id);
  return (first.modelSlotId ?? firstParts.slot + 1) - (second.modelSlotId ?? secondParts.slot + 1)
    || (first.generation ?? firstParts.generation) - (second.generation ?? secondParts.generation)
    || first.id.localeCompare(second.id, undefined, { numeric: true });
}

function residentLineageParts(id: string): { readonly slot: number; readonly generation: number } {
  const match = /^resident-(\d+)(?:\.(\d+))?$/.exec(id);
  if (!match) return { slot: Number.MAX_SAFE_INTEGER, generation: Number.MAX_SAFE_INTEGER };
  const rawSlot = Number(match[1]);
  const generation = Number(match[2] ?? 1);
  // Initial IDs are one-based (resident-01); later generations use their zero-based slot (resident-0.2).
  const slot = match[2] !== undefined || rawSlot === 0 ? rawSlot : rawSlot - 1;
  return { slot, generation };
}
export function renderObserverMarkup(snapshot: ObserverSnapshot, selection: ObserverSelection = {}, settings?: ModelSettingsView): string {
  if (snapshot.lifecycle && snapshot.lifecycle.status !== 'in-progress') return renderSetupMarkup(snapshot, settings);
  const lifecycle = snapshot.lifecycle;
  const unresolvedItems = snapshot.unresolved ?? [];
  const notInitialized = snapshot.initialized === false;
  const readinessCount = unresolvedItems.length + (notInitialized ? 1 : 0);
  const readinessNotice = readinessCount
    ? `<details id="readiness-pending" class="readiness-menu"><summary aria-label="展開 ${readinessCount} 項待處理提示"><span>待處理</span><span class="readiness-count">${readinessCount}</span></summary><div class="readiness-content"><h2>尚待設定</h2>${notInitialized ? '<div class="readiness-item"><strong>世界尚未初始化</strong><p>資料庫目前沒有世界快照；此畫面不會以範例居民代替真實資料。</p></div>' : ''}${unresolvedItems.length ? `<ul>${unresolvedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div></details>`
    : '';
  const tabs: readonly { readonly id: string; readonly label: string; readonly icon: UiIconName }[] = [
    { id: 'world', label: '世界地圖', icon: 'world' },
    { id: 'residents', label: '居民觀察', icon: 'people' },
    { id: 'history', label: '事件時間線', icon: 'history' },
    { id: 'settings', label: '建立模型卡', icon: 'settings' },
    { id: 'death-summaries', label: '死亡總結', icon: 'people' },
    { id: 'format-errors', label: '錯誤紀錄', icon: 'alert' },
  ];
  const activeTab = tabs.some(({ id }) => id === selection.activeTab) ? selection.activeTab : 'world';
  const tabMarkup = tabs.map(({ id, label, icon }) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? 0 : -1}" data-tab="${id}">${renderUiIcon(icon)}${label}</button>`).join('');
  const selectedResident = snapshot.residents.find((resident) => resident.id === selection.residentId);
  const residentPanel = selectedResident
    ? renderResident(snapshot, { residentId: selectedResident.id }, true)
    : renderResidentOverview(snapshot);
  const residentActive = selection.residentId ? 'detail' : 'list';
  const residentTabs = `<div class="responsive-workspace-tabs" role="tablist" id="resident-workspace-tabs" data-responsive-tabs="mobile" aria-label="居民頁面"><button type="button" role="tab" id="resident-list-tab" aria-controls="resident-list-panel" aria-selected="${residentActive === 'list'}" tabindex="${residentActive === 'list' ? 0 : -1}" data-tab="list">居民清單</button><button type="button" role="tab" id="resident-detail-tab" aria-controls="resident-detail-panel" aria-selected="${residentActive === 'detail'}" tabindex="${residentActive === 'detail' ? 0 : -1}" data-tab="detail">居民資訊</button></div>`;
  const deathSummariesPanel = `<section class="tab-panel" role="tabpanel" id="panel-death-summaries" data-tablist="observer-tabs" aria-labelledby="tab-death-summaries" tabindex="0"${activeTab === 'death-summaries' ? '' : ' hidden'}>${renderDeathSummaries(settings, lifecycle)}</section>`;
  const formatErrorsPanel = `<section class="tab-panel" role="tabpanel" id="panel-format-errors" data-tablist="observer-tabs" aria-labelledby="tab-format-errors" tabindex="0"${activeTab === 'format-errors' ? '' : ' hidden'}><div class="panel-heading"><div><p class="eyebrow">系統狀態</p><h2>狀態紀錄</h2></div></div><div class="error-statuses"><div class="data-state" data-data-state="ready" role="status" aria-live="polite"><span data-data-state-icon>${renderUiIcon('check')}</span><span data-data-state-label>資料同步正常</span></div>${readinessNotice}</div>${renderLatestAiFormatError(settings)}</section>`;
  return `<main class="observer-shell" data-active-tab="${activeTab}" data-map-view="${selection.mapView ?? 'surface'}" data-dungeon-floor="${selection.dungeonFloor ?? snapshot.dungeonMap?.activeFloor ?? 1}" data-dungeon-cell="${selection.dungeonCellId ?? ''}"><header class="topbar"><div class="observer-brand"><span class="observer-mark" aria-hidden="true">${renderUiIcon('world')}</span><div><p class="eyebrow">輪迴島 · 世界觀測</p><h1>觀察台</h1></div></div><div class="world-clock"><span>第 ${snapshot.worldTime.day} 日</span><strong>${escapeHtml(snapshot.worldTime.phase)}</strong><span>${snapshot.worldTime.timeT}T</span></div></header><div class="observer-tabs" role="tablist" id="observer-tabs" aria-label="觀察台頁面">${tabMarkup}</div>${renderSavedGameControls(snapshot, false)}<section class="tab-panel" role="tabpanel" id="panel-world" data-tablist="observer-tabs" aria-labelledby="tab-world" tabindex="0"${activeTab === 'world' ? '' : ' hidden'}>${renderMap(snapshot, selection)}</section><section class="tab-panel" role="tabpanel" id="panel-residents" data-tablist="observer-tabs" aria-labelledby="tab-residents" tabindex="0"${activeTab === 'residents' ? '' : ' hidden'}><div class="primary-grid" data-compact-active="${residentActive}">${residentTabs}${renderResidentRoster(snapshot, selection)}${residentPanel}</div></section><section class="tab-panel" role="tabpanel" id="panel-history" data-tablist="observer-tabs" aria-labelledby="tab-history" tabindex="0"${activeTab === 'history' ? '' : ' hidden'}><div class="history-grid">${renderTimeline(snapshot, selection)}</div></section><section class="tab-panel" role="tabpanel" id="panel-settings" data-tablist="observer-tabs" aria-labelledby="tab-settings" tabindex="0"${activeTab === 'settings' ? '' : ' hidden'}>${lifecycle ? renderSessionModelAssignments(snapshot, settings) : renderModelSettings(settings)}${renderSummarizerSelection(settings, 'settings')}</section>${deathSummariesPanel}${formatErrorsPanel}<footer class="freshness">資料更新：<time>${escapeHtml(snapshot.simulation.freshAt)}</time><span>觀察資料為唯讀投影</span></footer><div class="live-status" role="status" aria-live="polite"></div></main>`;
}

export async function mountObserverUi(root: HTMLElement, port: ObserverReadPort): Promise<void> {
  let selection: ObserverSelection = {};
  const refresh = async (focusResidentId?: string): Promise<void> => {
    const snapshot = await port.readSnapshot();
    root.innerHTML = renderObserverMarkup(snapshot, selection);
    if (focusResidentId) {
      const residentControl = Array.from(root.querySelectorAll<HTMLElement>('[data-resident-id]'))
        .find((candidate) => candidate.dataset.residentId === focusResidentId && candidate.getClientRects().length > 0);
      (residentControl ?? root.querySelector<HTMLElement>('#resident-detail-panel'))?.focus();
    }
  };
  await refresh();
  root.addEventListener('click', async (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const node = target.closest<SVGGElement>('[data-node-id]');
    if (node) {
      if (!node.dataset.nodeId) return;
      selection = { nodeId: node.dataset.nodeId };
      await refresh();
      return;
    }
    const resident = target.closest<HTMLElement | SVGGElement>('[data-resident-id]');
    if (resident) {
      const residentId = resident.dataset.residentId;
      if (!residentId) return;
      const selectedTab = resident.closest('.world-side-column') ? 'world' : 'residents';
      selection = { residentId, activeTab: selectedTab };
      await refresh(residentId);
      return;
    }
    const control = target.closest<HTMLButtonElement>('[data-control]');
    if (control?.dataset.control === 'pause' || control?.dataset.control === 'resume') {
      await port.requestControl({ kind: control.dataset.control });
      await refresh();
    }
  });
  root.addEventListener('keydown', async (event: KeyboardEvent) => {
    const target = event.target;
    if ((event.key === 'Enter' || event.key === ' ') && target instanceof SVGGElement && target.dataset.nodeId) {
      event.preventDefault();
      selection = { nodeId: target.dataset.nodeId };
      await refresh();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && target instanceof SVGGElement && target.dataset.residentId) {
      event.preventDefault();
      selection = { residentId: target.dataset.residentId, activeTab: 'residents' };
      await refresh(target.dataset.residentId);
    }
  });
}
