export type ObserverNode = {
  readonly id: string;
  readonly label: string;
  readonly labelStatus: string;
  readonly regionDescription: string;
  readonly x: number;
  readonly y: number;
  readonly residents: readonly string[];
  readonly objects: readonly string[];
};

export type ObserverResident = {
  readonly id: string;
  readonly generation: number | null;
  readonly model: string | null;
  readonly nodeId: string | null;
  readonly movingToNodeId?: string;
  readonly hp?: number;
  readonly hunger?: number;
  readonly sleep?: number;
  readonly inventory: readonly string[];
  readonly equipment: readonly string[];
  readonly lastAction: string;
};

export type ObserverEvent = {
  readonly id: string;
  readonly day: number;
  readonly timeT: number;
  readonly nodeId?: string;
  readonly actorId?: string;
  readonly description: string;
  readonly visibility: 'public' | 'observer';
};

export type ObserverBiography = {
  readonly residentId: string;
  readonly displayName: string;
  readonly text: string;
};

export type ObserverSnapshot = {
  readonly initialized?: boolean;
  readonly unresolved?: readonly string[];
  readonly worldTime: { readonly day: number; readonly timeT: number; readonly phase: string };
  readonly simulation: { readonly running: boolean; readonly speedLabel: string; readonly freshAt: string; readonly controllable?: boolean; readonly status?: string };
  readonly map: { readonly nodes: readonly ObserverNode[]; readonly edges: readonly { readonly fromId: string; readonly toId: string }[] };
  readonly residents: readonly ObserverResident[];
  readonly events: readonly ObserverEvent[];
  readonly biographies: readonly ObserverBiography[];
  readonly availableSpeedOptions: readonly { readonly id: string; readonly label: string }[];
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
  readonly maxOutputTokens: number | null;
  readonly modelSizeB: number | null;
  readonly sizeAtLeast8BConfirmed: boolean;
  readonly styleDescription: string | null;
  readonly updatedAt: string | null;
  readonly apiKeyConfigured: boolean;
};

export type ModelSettingsView = {
  readonly slots: readonly ModelSlotSettingsView[];
  readonly monthly: { readonly capUsd: number; readonly actualUsd: number; readonly reservedUsd: number; readonly remainingUsd: number };
};

export type ObserverControlRequest =
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'speed'; readonly speedId: string };

export interface ObserverReadPort {
  readSnapshot(): Promise<ObserverSnapshot>;
  requestControl(request: ObserverControlRequest): Promise<void>;
}

export type ObserverSelection = {
  readonly nodeId?: string;
  readonly residentId?: string;
  readonly activeTab?: 'world' | 'residents' | 'history' | 'settings';
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

function renderMap(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
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
    const residents = node.residents.length > 0 ? `<title>${escapeHtml(node.residents.join('、'))}</title>` : '';
    return `<g class="map-node${selected ? ' is-selected' : ''}" role="button" tabindex="0" aria-label="Node ${node.id}：${escapeHtml(label)}，${escapeHtml(node.labelStatus)}" aria-pressed="${selected}" data-node-id="${node.id}"><circle cx="${node.x}" cy="${node.y}" r="15" />${residents}<text x="${node.x}" y="${node.y + 4}">${node.id}</text></g>`;
  }).join('');
  return `<section class="panel map-panel" aria-labelledby="map-title"><div class="panel-heading"><div><p class="eyebrow">世界位置</p><h2 id="map-title">主島地圖</h2></div><span class="count">${snapshot.map.nodes.length} 個 Node · ${snapshot.map.edges.length} 條道路</span></div><p class="help-text">點選 Node 查看已提供的地點資料；Node 編號與居民代次分開顯示。位置依來源原圖 991×823 座標比例呈現；補定互動點會標示其資料層級。</p><div class="map-viewport"><svg class="island-map" viewBox="0 0 991 823" preserveAspectRatio="xMidYMid meet" role="img" aria-label="輪迴島 Node 與道路拓樸">${edges}${nodes}</svg></div></section>`;
}

function renderResidentRoster(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const allResidents = snapshot.residents.map((resident) => residentButton(resident.id, selection.residentId === resident.id)).join('');
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">居民清單</p><h2>選取居民</h2></div><span class="count">${snapshot.residents.length} 位</span></div><div class="resident-roster" aria-label="居民清單">${allResidents || '<span class="empty-state">目前沒有居民資料</span>'}</div></section>`;
}

function renderResident(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const node = snapshot.map.nodes.find((candidate) => candidate.id === selection.nodeId);
  const resident = snapshot.residents.find((candidate) => candidate.id === selection.residentId);
  if (resident) {
    const location = resident.nodeId === null
      ? resident.movingToNodeId === undefined ? '目前不屬於任何 Node' : `移動中，目的 Node ${resident.movingToNodeId}`
      : `Node ${resident.nodeId}`;
    return `<section class="panel detail-panel" aria-labelledby="detail-title"><div class="panel-heading"><div><p class="eyebrow">玩家觀察</p><h2 id="detail-title">居民 ${escapeHtml(resident.id)}</h2></div><span class="badge">${resident.generation === null ? '代次未設定' : `第 ${resident.generation} 代`}</span></div><dl class="fact-grid"><div><dt>所在位置</dt><dd>${escapeHtml(location)}</dd></div><div><dt>使用模型</dt><dd>${escapeHtml(resident.model ?? '尚未配置')}</dd></div><div><dt>HP</dt><dd>${escapeHtml(resident.hp ?? '來源未提供')}</dd></div><div><dt>飽食</dt><dd>${escapeHtml(resident.hunger ?? '來源未提供')}</dd></div><div><dt>睡眠</dt><dd>${escapeHtml(resident.sleep ?? '來源未提供')}</dd></div><div><dt>上一行動</dt><dd>${escapeHtml(resident.lastAction || '尚無資料')}</dd></div><div class="wide"><dt>背包</dt><dd>${resident.inventory.length ? resident.inventory.map(escapeHtml).join('、') : '空或尚未提供'}</dd></div><div class="wide"><dt>裝備</dt><dd>${resident.equipment.length ? resident.equipment.map(escapeHtml).join('、') : '無或尚未提供'}</dd></div></dl><p class="boundary-note">這是玩家觀察投影，不代表其他居民可看見這些數值；本畫面沒有居民行動指令。</p></section>`;
  }
  if (node) {
    const people = node.residents.map((id) => residentButton(id, false)).join('');
    const objects = node.objects.length ? node.objects.map(escapeHtml).join('、') : '目前沒有物件資料';
    return `<section class="panel detail-panel" aria-labelledby="detail-title"><div class="panel-heading"><div><p class="eyebrow">地點觀察</p><h2 id="detail-title">Node ${node.id}</h2></div><span class="badge">${escapeHtml(node.labelStatus)}</span></div><dl class="fact-grid"><div><dt>地點標籤</dt><dd>${escapeHtml(node.label || '未逐點命名')}</dd></div><div><dt>區域描述</dt><dd>${escapeHtml(node.regionDescription || '來源未提供')}</dd></div><div class="wide"><dt>物件與資源</dt><dd>${objects}</dd></div></dl><h3>此 Node 居民</h3><div class="resident-roster">${people || '<span class="empty-state">目前沒有居民資料</span>'}</div></section>`;
  }
  return `<section class="panel detail-panel empty-detail"><p class="eyebrow">只讀觀察</p><h2 id="detail-title">選擇地點或居民</h2><p>選擇地圖上的 Node 或居民編號，可查看來源提供的世界資料。</p></section>`;
}

function renderControls(snapshot: ObserverSnapshot): string {
  const controlDisabled = snapshot.simulation.controllable === false;
  const speedControl = snapshot.availableSpeedOptions.length
    ? `<label class="speed-control">模擬速度<select data-control="speed"${controlDisabled ? ' disabled' : ''}>${snapshot.availableSpeedOptions.map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`).join('')}</select></label>`
    : '<span class="help-text">調速倍率尚未設定</span>';
  return `<section class="panel controls-panel" aria-label="模擬控制"><div class="status-copy"><span class="status-dot${snapshot.simulation.running ? ' is-running' : ''}"></span><strong>${snapshot.simulation.controllable === false ? '執行控制器未連接' : snapshot.simulation.running ? '模擬執行中' : '模擬已暫停'}</strong><span>${escapeHtml(snapshot.simulation.speedLabel)}</span>${snapshot.simulation.status ? `<span role="status">${escapeHtml(snapshot.simulation.status)}</span>` : ''}</div><div class="control-actions"><button type="button" data-control="pause"${controlDisabled || !snapshot.simulation.running ? ' disabled' : ''}>暫停</button><button type="button" data-control="resume"${controlDisabled || snapshot.simulation.running ? ' disabled' : ''}>恢復</button>${speedControl}</div></section>`;
}

function renderTimeline(snapshot: ObserverSnapshot, selection: ObserverSelection): string {
  const selectedEvents = snapshot.events.filter((event) => {
    if (event.visibility !== 'public' && event.visibility !== 'observer') return false;
    if (selection.residentId && event.actorId !== selection.residentId) return false;
    if (!selection.residentId && selection.nodeId !== undefined && event.nodeId !== selection.nodeId) return false;
    return true;
  });
  const rows = selectedEvents.map((event) => `<li><time>第 ${event.day} 日 · ${event.timeT}T</time><p>${escapeHtml(event.description)}</p><span>${event.nodeId === undefined ? '全島事件' : `Node ${event.nodeId}`}${event.actorId ? ` · 居民 ${escapeHtml(event.actorId)}` : ''}</span></li>`).join('');
  const filterLabel = selection.residentId ? `居民 ${selection.residentId}` : selection.nodeId === undefined ? '全島' : `Node ${selection.nodeId}`;
  return `<section class="panel timeline-panel" aria-labelledby="timeline-title"><div class="panel-heading"><div><p class="eyebrow">已結算客觀事件</p><h2 id="timeline-title">事件時間線</h2></div><span class="badge">${filterLabel}</span></div><ol class="timeline">${rows || '<li class="empty-state">此範圍目前沒有已結算事件</li>'}</ol></section>`;
}

function renderBiographies(snapshot: ObserverSnapshot): string {
  const entries = snapshot.biographies.map((biography) => `<details class="biography"><summary>${escapeHtml(biography.displayName)} · 居民 ${escapeHtml(biography.residentId)}</summary><p>${escapeHtml(biography.text)}</p><span class="help-text">僅玩家可見的死後傳記</span></details>`).join('');
  return `<section class="panel biography-panel" aria-labelledby="biography-title"><div class="panel-heading"><div><p class="eyebrow">玩家專屬資料</p><h2 id="biography-title">生命傳記</h2></div></div>${entries || '<p class="empty-state">尚無可查看的死亡傳記</p>'}</section>`;
}

function renderModelSettings(settings?: ModelSettingsView): string {
  const slots = settings?.slots ?? Array.from({ length: 10 }, (_, index) => ({
    slotId: index + 1, provider: null, baseUrl: null, model: null, fallbackModels: [],
    inputUsdPerMillion: null, outputUsdPerMillion: null, maxInputTokens: null, maxOutputTokens: null, modelSizeB: null, sizeAtLeast8BConfirmed: false, styleDescription: null, updatedAt: null, apiKeyConfigured: false,
  }));
  const monthly = settings?.monthly ?? { capUsd: 20, actualUsd: 0, reservedUsd: 0, remainingUsd: 20 };
  const activeSlot = slots[0]?.slotId ?? 1;
  const rows = slots.map((slot) => `<form data-model-settings data-slot-id="${slot.slotId}"${slot.slotId === activeSlot ? '' : ' hidden'}><fieldset class="model-slot"><legend>模型槽位 ${slot.slotId}</legend><label>供應商名稱<input name="provider" value="${escapeHtml(slot.provider ?? '')}" maxlength="80" autocomplete="off"></label><label>API Base URL<input name="baseUrl" type="url" value="${escapeHtml(slot.baseUrl ?? '')}" placeholder="https://…" autocomplete="url"></label><label>模型 ID<input name="model" value="${escapeHtml(slot.model ?? '')}" maxlength="160" autocomplete="off"></label><label>模型規模（B；可留空）<input name="modelSizeB" type="number" min="0" step="0.1" value="${escapeHtml(slot.modelSizeB ?? '')}"></label><label class="attestation"><input name="sizeAtLeast8BConfirmed" type="checkbox" value="true"${slot.sizeAtLeast8BConfirmed ? ' checked' : ''}>我已確認此模型至少 8B（使用者聲明，未向供應商核驗）</label><label>此槽位風格（選填）<input name="styleDescription" value="${escapeHtml(slot.styleDescription ?? '')}" maxlength="160" autocomplete="off" placeholder="例如：謹慎探索、重視交換"></label><label>API 金鑰<input name="apiKey" type="password" value="" autocomplete="new-password" placeholder="${slot.apiKeyConfigured ? '已設定；留白保留本次啟動金鑰' : '未設定'}"></label><label>輸入價格（USD／百萬 token）<input name="inputUsdPerMillion" type="number" min="0" step="0.000001" value="${escapeHtml(slot.inputUsdPerMillion ?? '')}"></label><label>輸出價格（USD／百萬 token）<input name="outputUsdPerMillion" type="number" min="0" step="0.000001" value="${escapeHtml(slot.outputUsdPerMillion ?? '')}"></label><label>最大輸入 token<input name="maxInputTokens" type="number" min="1" step="1" value="${escapeHtml(slot.maxInputTokens ?? '')}"></label><label>最大輸出 token<input name="maxOutputTokens" type="number" min="1" step="1" value="${escapeHtml(slot.maxOutputTokens ?? '')}"></label><label>備援模型 ID（逗號分隔）<input name="fallbackModels" value="${escapeHtml(slot.fallbackModels.join(', '))}" autocomplete="off"></label><label class="clear-secret"><input name="clearApiKey" type="checkbox" value="true">清除本次啟動金鑰</label><button type="submit">儲存槽位</button><span class="slot-status">${slot.apiKeyConfigured ? '金鑰本次啟動有效' : '金鑰未設定'}</span></fieldset></form>`).join('');
  const slotOptions = slots.map((slot) => `<option value="${slot.slotId}"${slot.slotId === activeSlot ? ' selected' : ''}>槽位 ${slot.slotId} · ${slot.provider && slot.model ? '已填模型' : '待設定'}${slot.apiKeyConfigured ? ' · 金鑰已設定' : ''}${slot.sizeAtLeast8BConfirmed && !(slot.modelSizeB !== null && slot.modelSizeB < 8) ? ' · 已聲明至少8B' : ''}</option>`).join('');
  return `<section class="panel model-settings-panel" aria-labelledby="model-settings-title"><div class="panel-heading"><div><p class="eyebrow">本機操作設定</p><h2 id="model-settings-title">居民模型與費用</h2></div><span class="badge">月上限 US$${monthly.capUsd.toFixed(2)}</span></div><div class="settings-toolbar"><label>編輯居民槽位<select data-slot-select aria-label="選擇要編輯的居民模型槽位">${slotOptions}</select></label><dl class="cost-status"><div><dt>本月已結算</dt><dd>US$${monthly.actualUsd.toFixed(4)}</dd></div><div><dt>保留中</dt><dd>US$${monthly.reservedUsd.toFixed(4)}</dd></div><div><dt>可用額度</dt><dd>US$${monthly.remainingUsd.toFixed(4)}</dd></div></dl></div><p class="help-text">Ref09 的最低目標規模是 8B，十個槽位須設定不同主模型；每個槽位可指定風格。若參數量未知，可明確勾選「已確認至少 8B」；這是使用者聲明，未向供應商核驗。填入低於 8B 的數字會阻止該槽位執行。伺服器會拒絕重複的 provider/model 主模型。此版協定為 OpenAI-compatible Chat Completions（POST /v1/chat/completions）；其他協定不支援。API 金鑰僅保留在本次伺服器啟動記憶體，重啟後需重填。配置適用未開始的初始生命或新世代，不會替換已開始居民一生中的主模型。</p><p class="help-text"><strong>設定未完成時模擬會維持暫停，不會呼叫模型。</strong>每次請求先按價格與最大 token 設定保留費用；可用額度不足時會在送出前阻止。若回應缺少用量資料，以預留上限結算。</p>${rows}<p class="settings-status" role="status" aria-live="polite"></p></section>`;
}

export function renderObserverMarkup(snapshot: ObserverSnapshot, selection: ObserverSelection = {}, settings?: ModelSettingsView): string {
  const unresolved = snapshot.unresolved?.length ? `<section class="panel"><h2>尚待設定</h2><ul>${snapshot.unresolved.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';
  const notInitialized = snapshot.initialized === false ? '<section class="panel"><h2>世界尚未初始化</h2><p>資料庫目前沒有世界快照；此畫面不會以範例居民代替真實資料。</p></section>' : '';
  const tabs = [{ id: 'world', label: '世界地圖' }, { id: 'residents', label: '居民觀察' }, { id: 'history', label: '事件與傳記' }, { id: 'settings', label: '模型設定' }] as const;
  const activeTab = tabs.some(({ id }) => id === selection.activeTab) ? selection.activeTab : 'world';
  const tabMarkup = tabs.map(({ id, label }) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? 0 : -1}" data-tab="${id}">${label}</button>`).join('');
  return `<main class="observer-shell" data-active-tab="${activeTab}">${notInitialized}${unresolved}<header class="topbar"><div><p class="eyebrow">輪迴島 · 世界觀測</p><h1>觀察台</h1></div><div class="world-clock"><span>第 ${snapshot.worldTime.day} 日</span><strong>${escapeHtml(snapshot.worldTime.phase)}</strong><span>${snapshot.worldTime.timeT}T</span></div></header>${renderControls(snapshot)}<div class="observer-tabs" role="tablist" aria-label="觀察台頁面">${tabMarkup}</div><section class="tab-panel" role="tabpanel" id="panel-world" aria-labelledby="tab-world" tabindex="0"${activeTab === 'world' ? '' : ' hidden'}>${renderMap(snapshot, selection)}</section><section class="tab-panel" role="tabpanel" id="panel-residents" aria-labelledby="tab-residents" tabindex="0"${activeTab === 'residents' ? '' : ' hidden'}><div class="primary-grid">${renderResidentRoster(snapshot, selection)}${renderResident(snapshot, selection)}</div></section><section class="tab-panel" role="tabpanel" id="panel-history" aria-labelledby="tab-history" tabindex="0"${activeTab === 'history' ? '' : ' hidden'}><div class="history-grid">${renderTimeline(snapshot, selection)}${renderBiographies(snapshot)}</div></section><section class="tab-panel" role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" tabindex="0"${activeTab === 'settings' ? '' : ' hidden'}>${renderModelSettings(settings)}</section><footer class="freshness">資料更新：<time>${escapeHtml(snapshot.simulation.freshAt)}</time><span>觀察資料為唯讀投影</span></footer><div class="live-status" role="status" aria-live="polite"></div></main>`;
}

export async function mountObserverUi(root: HTMLElement, port: ObserverReadPort): Promise<void> {
  let selection: ObserverSelection = {};
  const refresh = async (): Promise<void> => {
    const snapshot = await port.readSnapshot();
    root.innerHTML = renderObserverMarkup(snapshot, selection);
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
    const resident = target.closest<HTMLButtonElement>('[data-resident-id]');
    if (resident) {
      const residentId = resident.dataset.residentId;
      if (!residentId) return;
      selection = { residentId };
      await refresh();
      return;
    }
    const control = target.closest<HTMLButtonElement>('[data-control]');
    if (control?.dataset.control === 'pause' || control?.dataset.control === 'resume') {
      await port.requestControl({ kind: control.dataset.control });
      await refresh();
    }
  });
  root.addEventListener('change', async (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.dataset.control === 'speed' && target.value) {
      await port.requestControl({ kind: 'speed', speedId: target.value });
      await refresh();
    }
  });
  root.addEventListener('keydown', async (event: KeyboardEvent) => {
    const target = event.target;
    if ((event.key === 'Enter' || event.key === ' ') && target instanceof SVGGElement && target.dataset.nodeId) {
      event.preventDefault();
      selection = { nodeId: target.dataset.nodeId };
      await refresh();
    }
  });
}
