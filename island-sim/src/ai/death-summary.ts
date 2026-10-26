import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import type { WorldEvent, WorldState } from '../domain/model.ts';
import { locationNameForNode } from '../content/location-names.ts';
import { dayPhaseAt } from '../engine/clock.ts';
import { describeWorldEvent } from '../domain/event-narrative.ts';
import type { ModelSettingsStore, ProcessModelSecrets } from './model-settings.ts';
import { createSummarizerProvider } from './provider-factory.ts';

export class DeathSummaryService {
  private readonly store: SQLiteWorldStore;
  private readonly settings: ModelSettingsStore;
  private readonly secrets: ProcessModelSecrets;
  private running = false;

  constructor(store: SQLiteWorldStore, settings: ModelSettingsStore, secrets: ProcessModelSecrets) {
    this.store = store; this.settings = settings; this.secrets = secrets;
    this.settings.requeueInterruptedDeathSummaries();
  }

  retryFailedSummary(target: { readonly summaryId: string; readonly sessionId: string; readonly sourceSaveId: string | null; readonly loadInstanceId: string | null; readonly residentId: string }): { readonly status: 'pending' } | { readonly status: 'missing' | 'stale-session' | 'stale-save' | 'stale-branch' | 'not-dead' | 'ambiguous-save' | 'pending' | 'running' | 'complete' | 'failed' } {
    const currentSession = this.store.readCurrentWorldSession();
    if (target.sessionId !== currentSession?.sessionId) return { status: 'stale-session' };
    if (currentSession.loadedSaveId !== target.sourceSaveId) return { status: 'stale-save' };
    if (!target.loadInstanceId) return { status: 'ambiguous-save' };
    if (currentSession.loadInstanceId !== target.loadInstanceId) return { status: 'stale-branch' };
    const snapshot = this.store.readSnapshot();
    const actor = snapshot?.actors[target.residentId];
    if (!snapshot || !actor || actor.actorType !== 'resident') return { status: 'missing' };
    if (actor.alive) return { status: 'not-dead' };
    const row = this.settings.deathSummaryRetryTarget(target.summaryId, target.residentId);
    if (!row) return { status: 'missing' };
    if (row.sessionId === null || row.loadInstanceId === null || row.sessionId !== target.sessionId || row.sourceSaveId !== target.sourceSaveId || row.loadInstanceId !== target.loadInstanceId) return { status: 'ambiguous-save' };
    if (target.summaryId !== deathSummaryId(target.sessionId, target.loadInstanceId, target.residentId) && target.summaryId !== legacyDeathSummaryId(target.sessionId, target.loadInstanceId, target.residentId)) return { status: 'ambiguous-save' };
    if (row.status !== 'failed') return { status: row.status };
    if (this.settings.retryFailedDeathSummary(target.summaryId, target.sessionId, target.sourceSaveId, target.loadInstanceId, target.residentId)) return { status: 'pending' };
    return { status: this.settings.deathSummaryStatus(target.summaryId, target.residentId) ?? 'missing' };
  }

  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const snapshot = this.store.readSnapshot();
      if (!snapshot) return;
      const session = this.store.readCurrentWorldSession();
      const sessionId = session?.sessionId ?? 'world';
      const sourceSaveId = session?.loadedSaveId ?? null;
      const loadInstanceId = session?.loadInstanceId ?? null;
      const summarySettings = this.settings.readSummarizer();
      const config = this.settings.readSlots().find(({ slotId }) => slotId === summarySettings.modelSlotId);
      const provider = config ? createSummarizerProvider({ config, secrets: this.secrets, store: this.store }) : null;
      for (const actor of Object.values(snapshot.actors)) {
        if (actor.actorType !== 'resident' || actor.alive) continue;
        const summaryId = this.settings.deathSummaryIdForIdentity(sessionId, sourceSaveId, loadInstanceId, actor.id) ?? deathSummaryId(sessionId, loadInstanceId, actor.id);
        this.settings.ensureDeathSummary(summaryId, sessionId, sourceSaveId, loadInstanceId, actor.id, actor.name ?? actor.id);
        if (!config || !provider || !this.settings.startDeathSummary(summaryId, sessionId, sourceSaveId, loadInstanceId, actor.id)) continue;
        try {
          const history: WorldEvent[] = [];
          let cursor = 0;
          for (;;) {
            const page = this.store.readEvents(cursor, 5000);
            history.push(...page.filter((event) => event.kind !== 'biography' && event.visibility !== 'player-only' && isEventAboutResident(event, actor.id, snapshot)));
            const last = page.at(-1);
            if (!last || page.length < 5000) break;
            cursor = last.sequence;
          }
          const facts = history.map((event) => {
            const payload = isRecord(event.payload) ? event.payload : {};
            const intent = event.actorId === actor.id ? snapshot.privateEventIntents?.[event.eventId] : undefined;
            const actorName = event.actorId === actor.id ? (actor.name ?? '居民') : event.actorId ? participantName(snapshot, event.actorId) : '島上環境';
            const description = describeWorldEvent(event, {
              actor: actorName,
              itemName: readableItemName,
              participantName: (id) => participantName(snapshot, id),
              nodeName: (id) => locationNameForNode(id, snapshot.nodes[id]?.label) ?? '島上某處',
              ...(typeof intent === 'string' && intent.trim() ? { intent } : {}),
            });
            const recordedIntent = typeof intent === 'string' ? intent.trim() : '';
            const descriptionWithIntent = recordedIntent && !description.includes(recordedIntent)
              ? `${description}；意圖：「${recordedIntent}」`
              : description;
            const relation = event.actorId === actor.id ? undefined : residentRelation(event, actor.id, snapshot);
            const residentName = actor.name?.trim() || '這位居民';
            const personalizedDescription = relation && !descriptionWithIntent.includes(residentName)
              ? `${descriptionWithIntent}（${residentName}：${relation}）`
              : descriptionWithIntent;
            const nodeId = typeof payload.toNodeId === 'string' && event.kind === 'resident-action-settled' ? payload.toNodeId : event.nodeId;
            const location = nodeId ? locationNameForNode(nodeId, snapshot.nodes[nodeId]?.label) : null;
            const day = Math.floor(event.worldTimeT / 72) + 1;
            const phase = dayPhaseAt(event.worldTimeT) === 'day' ? '白天' : '夜晚';
            return `第 ${day} 日${phase}${location ? `・${location}` : ''}：${personalizedDescription}。`;
          });
          const prompt = [
            summarySettings.prompt,
            '請根據下列已記錄事實，寫成繁體中文、連貫而有故事感的居民生命回顧；依素材自然組織開端、轉折、重要關係或抉擇與結局，不必硬套固定模板。避免逐筆列清單或重述事件紀錄，應把重要經歷串成生平敘事。只寫資料能支持的事實；不得臆造心理、對話或因果。事實附有「意圖」時，請把居民當時明確表達的意圖自然融入相應經歷，保留原意；清楚區分打算做的事與實際完成的行動，不得遺漏、反向改寫或將意圖描述為已完成。若紀錄寫明對方背包已滿、物品掉在地上，請自然說清背包已滿、物品未交付並掉落地面；不可寫成成功送達，也不可自行補充未記錄的背包狀態。不要輸出居民 ID、事件代碼、Node 編號、資料欄位名稱或任何工程用語。分成 2 至 4 個短段落；若紀錄不足，簡潔說明可確認的經歷，不要補寫。',
            `居民：${actor.name ?? '居民'}`,
            `世代：${actor.generation ?? '未記錄'}`,
            `可核對的事件共 ${facts.length} 筆：`,
            facts.length ? facts.join('\n') : '沒有可供回顧的已記錄事件。',
          ].join('\n\n');
          if (prompt.length > config.maxContextCharacters) throw new Error(`完整行動紀錄與固定指令共 ${prompt.length} 字元，超過所選模型卡的上下文字元上限（${config.maxContextCharacters}）；未裁切紀錄，也未呼叫模型。`);
          const completion = await provider.complete(prompt, 1500, { operation: 'biography', retry: false });
          const text = normalizeDeathSummary(completion.raw, facts, actor.id);
          this.settings.finishDeathSummary(summaryId, sessionId, sourceSaveId, loadInstanceId, actor.id, text);
        } catch (error) {
          this.settings.failDeathSummary(summaryId, sessionId, sourceSaveId, loadInstanceId, actor.id, error instanceof Error ? error.message : '總結生成失敗。');
        }
      }
    } finally { this.running = false; }
  }
}

function deathSummaryId(sessionId: string, loadInstanceId: string | null, residentId: string): string {
  return `${encodeSummaryIdPart(sessionId)}:${loadInstanceId === null ? '~' : encodeSummaryIdPart(loadInstanceId)}:${encodeSummaryIdPart(residentId)}`;
}

function legacyDeathSummaryId(sessionId: string, loadInstanceId: string | null, residentId: string): string {
  return `${sessionId}:${loadInstanceId ?? 'untracked'}:${residentId}`;
}

function encodeSummaryIdPart(value: string): string {
  return value.replaceAll('%', '%25').replaceAll(':', '%3A');
}

function isEventAboutResident(event: WorldEvent, residentId: string, state: WorldState): boolean {
  if (event.actorId === residentId) return true;
  return explicitResidentRole(event, residentId, state) !== undefined;
}

function residentRelation(event: WorldEvent, residentId: string, state: WorldState): string | undefined {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.kind === 'monument-inscription-written' || event.kind === 'monument-inscription-read') {
    if (payload.authorActorId === residentId) return '碑文作者';
  }
  if (event.kind === 'public-message-sent' && payload.recipientId === residentId) return '訊息收件人';
  if (event.kind === 'gift-transferred') {
    if (payload.recipientId === residentId) return '收下物品';
    if (payload.giverId === residentId) return '送出物品';
  }
  if (event.kind === 'gift-dropped') {
    if (payload.recipientId === residentId) return '因背包已滿而未收到物品';
    if (payload.giverId === residentId) return '因對方背包已滿而送禮未成';
  }
  if (event.kind.startsWith('trade-') && (payload.proposerId === residentId || payload.receiverId === residentId)) return '交換雙方之一';
  if (['resident-attacked', 'boss1-flying-hit-blocked', 'boss1-taunt-counterattack', 'boss2-defense-breakthrough'].includes(event.kind)
    && (payload.targetActorId === residentId || payload.targetId === residentId)) return '攻擊目標';
  if (event.kind === 'boss1-taunt-counterattack') {
    if (arrayHasParticipant(payload.bossAttacks, residentId, ['targetId'])) return '反擊受擊者';
    if (arrayHasParticipant(payload.bossAttacks, residentId, ['attackerId'])) return '反擊者';
  }
  if (event.kind === 'monster-action-settled' && arrayHasParticipant(payload.hits, residentId, ['targetId'])) return '怪物攻擊的對象';
  if (event.kind === 'daily-survival-settled') {
    if (arrayHasParticipant(payload.deaths, residentId, ['actorId'])) return '每日結算中的離世居民';
    if (arrayHasParticipant(payload.newGenerations, residentId, ['actorId'])) return '新生居民';
  }
  if (event.kind === 'personal-sleep-risk-settled' && arrayHasParticipant(payload.checks, residentId, ['actorId'])) return '夜間休息檢查對象';
  if (event.kind === 'boss1-defeated' || event.kind === 'boss2-retreated') {
    if (payload.lastHitActorId === residentId) return '擊退首領的居民';
    if (Array.isArray(payload.accessGrantedTo) && payload.accessGrantedTo.includes(residentId)) return '獲准前往下一層的居民';
  }
  if (event.kind.startsWith('corpse-')) {
    const corpseId = typeof payload.corpseId === 'string' ? payload.corpseId : undefined;
    if (corpseId && state.objects[corpseId]?.remainsActorId === residentId) return '遺體所屬居民';
  }
  if (['dungeon-action-settled', 'dungeon-resident-retreated', 'dungeon-lava-splash-settled'].includes(event.kind)
    && arrayHasNestedParticipant(payload.dungeonEvents, residentId)) return '地牢事件參與者';
  return undefined;
}

function explicitResidentRole(event: WorldEvent, residentId: string, state: WorldState): string | undefined {
  const payload = isRecord(event.payload) ? event.payload : {};
  const rootParticipantFields: Readonly<Record<string, readonly string[]>> = {
    'monument-inscription-written': ['authorActorId'],
    'monument-inscription-read': ['authorActorId'],
    'public-message-sent': ['recipientId'],
    'gift-transferred': ['giverId', 'recipientId'],
    'gift-dropped': ['giverId', 'recipientId'],
    'trade-requested': ['proposerId', 'receiverId'],
    'trade-accepted': ['proposerId', 'receiverId'],
    'trade-rejected': ['proposerId', 'receiverId'],
    'resident-attacked': ['targetActorId', 'targetId'],
    'boss1-flying-hit-blocked': ['targetActorId'],
    'boss1-taunt-counterattack': ['targetActorId', 'targetId'],
    'boss2-defense-breakthrough': ['targetActorId'],
    'boss1-defeated': ['lastHitActorId'],
    'boss2-retreated': ['lastHitActorId'],
  };
  if (hasParticipant(payload, residentId, rootParticipantFields[event.kind] ?? [])) return '事件參與者';
  if (event.kind === 'boss1-defeated' || event.kind === 'boss2-retreated') {
    if (Array.isArray(payload.accessGrantedTo) && payload.accessGrantedTo.includes(residentId)) return '獲准前往下一層的居民';
  }
  const nestedParticipantFields: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
    'boss1-taunt-counterattack': { bossAttacks: ['targetId', 'attackerId'] },
    'monster-action-settled': { hits: ['targetId'] },
    'daily-survival-settled': { deaths: ['actorId'], newGenerations: ['actorId'] },
    'personal-sleep-risk-settled': { checks: ['actorId'] },
  };
  const nested = nestedParticipantFields[event.kind];
  if (nested && Object.entries(nested).some(([arrayKey, fields]) => arrayHasParticipant(payload[arrayKey], residentId, fields))) return '事件參與者';
  if (['dungeon-action-settled', 'dungeon-resident-retreated', 'dungeon-lava-splash-settled'].includes(event.kind)
    && arrayHasNestedParticipant(payload.dungeonEvents, residentId)) return '地牢事件參與者';
  if (event.kind.startsWith('corpse-')) {
    const corpseId = typeof payload.corpseId === 'string' ? payload.corpseId : undefined;
    if (corpseId && state.objects[corpseId]?.remainsActorId === residentId) return '遺體所屬居民';
  }
  return undefined;
}

function hasParticipant(payload: Record<string, unknown>, residentId: string, fields: readonly string[]): boolean {
  return fields.some((field) => payload[field] === residentId);
}

function arrayHasParticipant(value: unknown, residentId: string, fields: readonly string[]): boolean {
  return Array.isArray(value) && value.some((entry) => isRecord(entry) && hasParticipant(entry, residentId, fields));
}

function arrayHasNestedParticipant(value: unknown, residentId: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (!isRecord(entry)) return false;
    const payload = entry.payload;
    if (!isRecord(payload)) return false;
    const fields = ['actorId', 'residentId', 'targetActorId', 'targetId', 'recipientId', 'receiverId', 'authorActorId', 'attackerId'];
    return fields.some((field) => payload[field] === residentId)
      || (Array.isArray(payload.participants) && payload.participants.some((participant) => {
        if (typeof participant === 'string') return participant === residentId;
        if (!isRecord(participant)) return false;
        return ['id', 'actorId', 'residentId'].some((field) => participant[field] === residentId);
      }));
  });
}

function participantName(state: WorldState, id: string): string {
  const participant = state.actors[id];
  return participant?.actorType === 'resident' && participant.name?.trim() ? participant.name.trim() : participant?.actorType === 'monster' ? `怪物${participant.name ? `「${participant.name}」` : ''}` : participant?.actorType === 'animal' ? `動物${participant.name ? `「${participant.name}」` : ''}` : '另一位居民';
}

function readableItemName(itemId: string): string {
  const names: Readonly<Record<string, string>> = {
    '破損木劍': '破木劍', '簡易盾': '簡易盾牌', '鐵矛': '鐵槍', '布衣': '布上裝', '騎士級雙手武器': '騎士雙手劍',
  };
  return names[itemId] ?? (/^[\p{Script=Han}\p{P}\p{Z}]+$/u.test(itemId) ? itemId : '一件物品');
}

function normalizeDeathSummary(raw: string, facts: readonly string[], residentId: string): string {
  const candidate = raw.trim().replace(/^```(?:markdown|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  const paragraphs = candidate.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const hasInternalDetails = /\b(?:eventId|randomDraws|payload|sequence|visibility|resident-[\w.-]+|Node\s*\d+)\b/i.test(candidate) || candidate.includes(residentId);
  if (candidate && !hasInternalDetails && !/[{}\[\]]/.test(candidate) && candidate.length <= 6000 && paragraphs.length <= 4) return paragraphs.join('\n\n');
  if (!facts.length) return '目前沒有可核對的個人事件紀錄，因此無法整理出更多經歷。';
  const sentences = facts.map((fact) => /[。！？]$/.test(fact) ? fact : `${fact}。`);
  const groupSize = Math.ceil(sentences.length / 4);
  const groups: string[] = [];
  for (let index = 0; index < sentences.length; index += groupSize) groups.push(sentences.slice(index, index + groupSize).join(''));
  return groups.join('\n\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
