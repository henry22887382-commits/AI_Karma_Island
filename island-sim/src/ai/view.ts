import type { ResidentAiMemory, ResidentAiMemoryEntry, WorldActor, WorldEvent, WorldState } from '../domain/model.ts';
import type { CandidateAction, ModelInput } from './router.ts';
import { dayPhaseAt } from '../engine/clock.ts';
import { locationNameForNode } from '../content/location-names.ts';
import { isNodeCampfireProtected } from '../domain/campfire-safety.ts';
import { canonicalInventoryItemId } from '../domain/item-identity.ts';

export type AiLegalAction = {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly costT: 1 | 3;
  readonly requiresText: boolean;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type AiNarrativeFormatter = (event: WorldEvent, actorId: string) => string | undefined;

const ARRIVAL_MEMORY_TEXT = '你在沙灘上醒來，你什麼都不記得了。';
const PRIORITY_MEMORY_KINDS = new Set([
  'resident-attacked', 'monster-action-settled', 'public-message-sent', 'object-read',
  'monument-inscription-read', 'monument-inscription-written', 'container-opened', 'gift-dropped',
  'resident-ate',
]);

function residentHpChange(event: WorldEvent, actorId: string): { readonly damage: number; readonly remainingHp: number } | undefined {
  const changes = asRecord(event.payload).hpChanges;
  if (!Array.isArray(changes)) return undefined;
  const change = changes.find((candidate) => asRecord(candidate).actorId === actorId);
  if (change === undefined) return undefined;
  const record = asRecord(change);
  return typeof record.damage === 'number' && Number.isFinite(record.damage) && record.damage > 0
    && typeof record.remainingHp === 'number' && Number.isFinite(record.remainingHp)
    ? { damage: record.damage, remainingHp: record.remainingHp }
    : undefined;
}

function isPriorityMemoryEvent(event: WorldEvent, actorId: string): boolean {
  return PRIORITY_MEMORY_KINDS.has(event.kind)
    || residentHpChange(event, actorId) !== undefined
    || (event.kind === 'resident-action-settled' && asRecord(event.payload).actionType === 'sleep');
}

function boundResidentMemory(entries: readonly ResidentAiMemoryEntry[]): readonly ResidentAiMemoryEntry[] {
  return [...new Map(entries.map((entry) => [entry.sequence, entry])).values()]
    .sort((left, right) => left.sequence - right.sequence);
}

function promptMemoryCandidates(entries: readonly ResidentAiMemoryEntry[]) {
  const priority = entries.filter((entry) => entry.importance === 'priority' && entry.kind !== 'arrival-memory');
  const recent = entries.filter((entry) => entry.importance === 'recent');
  return [...priority, ...recent].sort((left, right) => left.sequence - right.sequence);
}

function damageEffect(appliedDamage: number, hitPointsBefore: number | undefined): string {
  if (appliedDamage <= 0) return '沒有扣除餘命';
  if (hitPointsBefore === undefined || !Number.isFinite(hitPointsBefore) || hitPointsBefore <= 0) {
    return `實際傷害 ${appliedDamage} 點（缺少受擊前餘命，無法判定比例）`;
  }
  const actualDamage = Math.min(appliedDamage, hitPointsBefore);
  const ratio = actualDamage / hitPointsBefore;
  const effect = ratio <= 0.15 ? '幾乎沒什麼用'
    : ratio <= 0.30 ? '輕傷'
      : ratio <= 0.50 ? '重傷'
        : '非常有效';
  return `實際扣除 ${actualDamage} 點餘命（${effect}，佔受擊前餘命 ${(ratio * 100).toFixed(1)}%）`;
}

function describeResidentAttack(event: WorldEvent, actorId: string, payload: Record<string, unknown>): string | undefined {
  if (typeof payload.targetActorId !== 'string' || typeof payload.damage !== 'number' || !Number.isFinite(payload.damage)) return undefined;
  const attacker = event.actorId === actorId ? '你' : '一位居民';
  const targetName = typeof payload.targetName === 'string' ? payload.targetName : undefined;
  const target = payload.targetType === 'monster' ? targetName === undefined ? '怪物' : `「${targetName}」`
    : payload.targetActorId === actorId ? '你' : '另一位居民';
  const damage = payload.damage;
  const killed = payload.killed === true;
  const effect = damageEffect(damage, typeof payload.targetHitPointsBefore === 'number' ? payload.targetHitPointsBefore : undefined);
  const details: string[] = [];
  if (damage <= 0) details.push(`${attacker}攻擊了${target}，但沒有扣除餘命`);
  else details.push(`${attacker}攻擊了${target}；${effect}`);
  if (killed) details.push(targetName === undefined ? '目標倒下了' : `「${targetName}」被擊敗`);
  if (typeof payload.reflectionDamage === 'number') {
    const reflected = damageEffect(payload.reflectionDamage, typeof payload.reflectionHitPointsBefore === 'number' ? payload.reflectionHitPointsBefore : undefined);
    const reflectionRecipient = event.actorId === actorId ? '你' : '攻擊者';
    details.push(`熔岩史萊姆反傷：${reflectionRecipient}${reflected}`);
    if (payload.reflectionOnLethalHit === true) details.push('即使這一擊擊敗熔岩史萊姆，牠仍然反傷');
    if (typeof payload.reflectionHitPointsAfter === 'number' && payload.reflectionHitPointsAfter <= 0) details.push(`${reflectionRecipient}被反傷擊倒`);
  }
  if (typeof payload.summonedMonsterId === 'string') {
    const companion = typeof payload.summonedMonsterName === 'string' ? `「${payload.summonedMonsterName}」` : '一隻同伴';
    details.push(`${targetName === undefined ? '怪物' : `「${targetName}」`}召來了${companion}同伴`);
  }
  if (typeof payload.dragonBloodHealing === 'number' && payload.dragonBloodHealing > 0) {
    details.push(`${attacker}因龍血恢復 ${payload.dragonBloodHealing} 點餘命`);
  }
  if (event.kind === 'boss1-defeated' && Array.isArray(payload.rewardItemIds) && payload.rewardItemIds.length > 0) {
    details.push(`取得戰利品：${payload.rewardItemIds.filter((item): item is string => typeof item === 'string').join('、')}`);
  }
  return `${details.join('；')}。`;
}

export function formatAiNarrativeEvent(event: WorldEvent, actorId: string): string | undefined {
  const rawPayload = asRecord(event.payload);
  const payload: Record<string, unknown> = {
    ...rawPayload,
    ...(typeof rawPayload.itemId === 'string' ? { itemId: canonicalInventoryItemId(rawPayload.itemId) } : {}),
    ...(typeof rawPayload.fromItemId === 'string' ? { fromItemId: canonicalInventoryItemId(rawPayload.fromItemId) } : {}),
    ...(typeof rawPayload.toItemId === 'string' ? { toItemId: canonicalInventoryItemId(rawPayload.toItemId) } : {}),
  };
  const self = event.actorId === actorId;
  const subject = self ? '你' : `居民 ${event.actorId ?? '未知'}`;
  const hpChange = residentHpChange(event, actorId);
  if (hpChange !== undefined) return `你失去了 ${hpChange.damage} 點餘命，目前剩餘 ${hpChange.remainingHp} 點。`;
  if (event.kind === 'resident-action-settled') {
    if (payload.actionType === 'wait') return `${subject}等待了。`;
    if (payload.actionType === 'move' && typeof payload.toNodeId === 'string') {
      const forestEntry = asRecord(payload.forestEntry);
      const encounter = typeof forestEntry.outcomeId === 'string' ? `區域遭遇抽取結果為 ${forestEntry.outcomeId}。` : '';
      return `${subject}移動並抵達 Node ${payload.toNodeId}。${encounter}`;
    }
    if (payload.actionType === 'sleep') return `${subject}開始睡覺，等待天亮。`;
    if (payload.actionType === 'surface' && typeof payload.actionId === 'string') return `${subject}進行了地表行動。`;
    return undefined;
  }
  if (event.kind === 'resident-action-format-error' && self && typeof payload.hesitationText === 'string') return payload.hesitationText;
  if (event.kind === 'resident-arrived' && typeof payload.toNodeId === 'string') {
    return `${subject}抵達了 Node ${payload.toNodeId}。`;
  }
  if (event.kind === 'public-message-sent' && typeof payload.recipientId === 'string' && typeof payload.text === 'string') {
    const sender = self ? '你' : subject;
    return `${sender}向${payload.recipientId}發送公開訊息：「${payload.text}」`;
  }
  if (event.kind === 'gift-transferred' && typeof payload.giverId === 'string' && typeof payload.recipientId === 'string') {
    const item = typeof payload.itemId === 'string' ? payload.itemId : undefined;
    if (item && (actorId === payload.giverId || actorId === payload.recipientId)) {
      const giver = actorId === payload.giverId ? '你' : `居民 ${payload.giverId}`;
      const recipient = actorId === payload.recipientId ? '你' : `居民 ${payload.recipientId}`;
      return `${giver}把「${item}」送給${recipient}。`;
    }
    return `${subject}把一件物品送給另一位居民。`;
  }
  if (event.kind === 'gift-dropped' && typeof payload.giverId === 'string' && typeof payload.recipientId === 'string') {
    const item = typeof payload.itemId === 'string' ? payload.itemId : '物品';
    const giver = actorId === payload.giverId ? '你' : `居民 ${payload.giverId}`;
    const recipient = actorId === payload.recipientId ? '你' : `居民 ${payload.recipientId}`;
    return `${giver}想把「${item}」送給${recipient}，但${recipient}的背包已滿，物品掉在地上，沒有交付。`;
  }
  if (event.kind === 'object-read' && self && typeof payload.text === 'string') {
    const itemName = typeof payload.itemId === 'string' ? payload.itemId : '物件';
    return `你讀了「${itemName}」。上面寫著：「${payload.text}」。`;
  }
  if (event.kind === 'monument-inscription-written' && typeof payload.text === 'string') {
    return `${subject}在紀念碑谷留下碑文：「${payload.text}」。`;
  }
  if (event.kind === 'monument-inscription-read' && self && typeof payload.text === 'string') {
    return `你在紀念碑谷讀到碑文：「${payload.text}」。`;
  }
  if (event.kind === 'container-opened' && typeof payload.itemId === 'string') {
    const containerName = typeof payload.containerName === 'string' ? payload.containerName : '容器';
    return `${subject}打開了「${containerName}」，取得「${payload.itemId}」。`;
  }
  if (event.kind === 'monster-action-settled' && typeof payload.monsterName === 'string' && Array.isArray(payload.hits)) {
    const hits = payload.hits.map((hit) => asRecord(hit)).filter((hit) => typeof hit.targetId === 'string');
    const hitsByTarget = new Map<string, Record<string, unknown>[]>();
    for (const hit of hits) {
      const targetId = String(hit.targetId);
      hitsByTarget.set(targetId, [...(hitsByTarget.get(targetId) ?? []), hit]);
    }
    const results = [...hitsByTarget.entries()].map(([targetId, targetHits]) => {
      const target = targetId === actorId ? '你' : '一位居民';
      const damage = targetHits.reduce((sum, hit) => sum + (typeof hit.appliedDamage === 'number' && Number.isFinite(hit.appliedDamage) ? hit.appliedDamage : 0), 0);
      const firstHitPointsBefore = targetHits.find((hit) => typeof hit.targetHitPointsBefore === 'number')?.targetHitPointsBefore;
      const effect = damageEffect(damage, typeof firstHitPointsBefore === 'number' ? firstHitPointsBefore : undefined);
      return damage <= 0 ? `${target}沒有受到傷害` : `${target}${effect}${targetHits.some((hit) => hit.killed === true) ? '，倒下了' : ''}`;
    }).join('；');
    if (payload.action === 'flying') return '大金剛鸚鵡飛到空中，這回合不會受到攻擊。';
    if (payload.action === 'taunt') return '大金剛鸚鵡發動嘲諷；居民若在此時攻擊，牠會立刻反擊。';
    if (payload.action === 'sleep') return `${payload.monsterName}仍在熟睡，沒有攻擊。`;
    if (payload.monsterName === '大貓爪' && hits.length === 0) return '大貓爪撲擊落空，沒有命中居民。';
    if (payload.action === 'claw') return results ? `巨龍揮出爪擊：${results}。` : '巨龍揮出爪擊，但沒有居民受擊。';
    if (payload.action === 'breath') return results ? `巨龍吐息：${results}。` : '巨龍吐息，但沒有居民受擊。';
    if (payload.action === 'peck') return results ? `大金剛鸚鵡啄擊：${results}。` : '大金剛鸚鵡啄擊，但沒有居民受擊。';
    if (results) return `怪物${payload.monsterName}發動攻擊：${results}。`;
    return `怪物${payload.monsterName}發動攻擊，但沒有居民受到傷害。`;
  }
  if (event.kind === 'boss1-flying-hit-blocked') {
    return `${self ? '你' : '一位居民'}攻擊大金剛鸚鵡，但牠正飛在空中，這次攻擊沒有命中。`;
  }
  if (event.kind === 'boss1-taunt-counterattack') {
    const attacks = Array.isArray(payload.bossAttacks) ? payload.bossAttacks.map((attack) => asRecord(attack)) : [];
    const victim = attacks.find((attack) => attack.targetId === actorId);
    const victimEffect = victim && typeof victim.appliedDamage === 'number'
      ? damageEffect(victim.appliedDamage, typeof victim.targetHitPointsBefore === 'number' ? victim.targetHitPointsBefore : undefined)
      : undefined;
    const otherVictim = attacks[0];
    const otherVictimEffect = otherVictim && typeof otherVictim.targetId === 'string' && typeof otherVictim.appliedDamage === 'number'
      ? damageEffect(otherVictim.appliedDamage, typeof otherVictim.targetHitPointsBefore === 'number' ? otherVictim.targetHitPointsBefore : undefined)
      : undefined;
    if (self) {
      const counterOutcome = victimEffect ? `牠反擊你；你${victimEffect}`
        : otherVictimEffect ? `牠反擊另一位居民；對方${otherVictimEffect}` : '牠立刻反擊';
      return `你攻擊大金剛鸚鵡時，牠因嘲諷立刻反擊；你的攻擊沒有生效，${counterOutcome}。`;
    }
    if (victimEffect) return `大金剛鸚鵡因嘲諷立刻反擊你；你${victimEffect}。`;
    if (otherVictimEffect) return `大金剛鸚鵡因嘲諷立刻反擊另一位居民；對方${otherVictimEffect}。`;
    return '大金剛鸚鵡因嘲諷立刻反擊，原本的居民攻擊沒有生效。';
  }
  if (event.kind === 'boss2-defense-breakthrough') {
    const attacker = self ? '你' : '一位居民';
    return typeof payload.breakthroughAdded === 'number' && payload.breakthroughAdded > 0
      ? `${attacker}突破了大貓爪一層防禦，目前累積 ${String(payload.breakthroughs)} 層。`
      : `${attacker}的攻擊沒有突破大貓爪的防禦。`;
  }
  if (event.kind === 'resident-attacked' && typeof payload.breakthroughAdded === 'number' && typeof payload.breakthroughs === 'number') {
    const attacker = self ? '你' : '一位居民';
    return payload.breakthroughAdded > 0
      ? `${attacker}突破了大貓爪一層防禦，目前累積 ${payload.breakthroughs} 層。`
      : `${attacker}攻擊大貓爪，但沒有突破防禦；目前累積 ${payload.breakthroughs} 層。`;
  }
  if (event.kind === 'boss2-retreated') {
    const winner = payload.lastHitActorId === actorId ? '你擊退了大貓爪' : '居民擊退了大貓爪';
    const rewards = Array.isArray(payload.rewardItemIds)
      ? payload.rewardItemIds.filter((item): item is string => typeof item === 'string')
      : [];
    return `${winner}，通往下一層的路已開啟${rewards.length > 0 ? `；取得戰利品：${rewards.join('、')}` : ''}。`;
  }
  if (event.kind === 'item-eaten' && self && typeof payload.itemId === 'string') return `你吃下了 ${payload.itemId}。`;
  if (event.kind === 'resident-ate' && self && typeof payload.itemId === 'string') return `你吃下了 ${payload.itemId}，補充飽食。`;
  if (event.kind === 'item-picked-up' && self && typeof payload.itemId === 'string') return `你撿起了 ${payload.itemId}。`;
  if (event.kind === 'item-equipped' && self && typeof payload.itemId === 'string') return `你裝備了 ${payload.itemId}。`;
  if (event.kind === 'item-upgraded' && typeof payload.fromItemId === 'string' && typeof payload.toItemId === 'string') return `${self ? '你' : '一位居民'}用魔法石把 ${payload.fromItemId} 升級為 ${payload.toItemId}。`;
  if (event.kind === 'corpse-item-scavenged' && self && typeof payload.itemId === 'string') return `你從屍體取得了 ${payload.itemId}。`;
  if (event.kind === 'corpse-carried' && self) return '你搬起了一具屍體。';
  if (event.kind === 'corpse-dropped' && self) return '你放下了攜帶的屍體。';
  if (event.kind === 'resident-attacked' || event.kind === 'boss1-defeated') return describeResidentAttack(event, actorId, payload);
  return undefined;
}

export type BuildAiInputResult =
  | { readonly ok: true; readonly input: ModelInput; readonly memory: ResidentAiMemory }
  | { readonly ok: false; readonly unresolved: readonly string[] };

function timeOfDay(worldTimeT: number): '白天' | '夜晚' | undefined {
  if (!Number.isSafeInteger(worldTimeT) || worldTimeT < 0) return undefined;
  return dayPhaseAt(worldTimeT) === 'day' ? '白天' : '夜晚';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function visibleActorType(actor: WorldActor): 'human' | 'animal' | 'monster' {
  return actor.actorType === 'resident' ? 'human' : actor.actorType;
}

function visibleStatus(actor: WorldActor): readonly string[] {
  const statuses: string[] = [];
  if (actor.hitPoints !== undefined && actor.hitPoints <= 5) statuses.push('狀態不好');
  if (actor.hunger === 0) statuses.push('面黃肌瘦');
  if (actor.sleep === 0) statuses.push('黑眼圈');
  return statuses;
}

function actorJson(actor: WorldActor, self: boolean): Readonly<Record<string, unknown>> {
  if (self) {
    return {
      id: actor.id,
      node_id: actor.nodeId,
      remaining_life: actor.hitPoints,
      hunger: actor.hunger,
      sleep: actor.sleep,
      inventory: (actor.inventory ?? []).map(canonicalInventoryItemId),
    };
  }
  return {
    id: actor.id,
    type: visibleActorType(actor),
    statuses: visibleStatus(actor),
    ...(actor.sleeping ? { activity: 'sleeping' } : {}),
  };
}

export function buildAiInput(
  state: WorldState,
  actorId: string,
  legalActions: readonly AiLegalAction[],
  recentEvents: readonly WorldEvent[],
  formatEvent: AiNarrativeFormatter,
  priorMemory?: ResidentAiMemory,
): BuildAiInputResult {
  const self = state.actors[actorId];
  if (!self || !self.alive) return { ok: false, unresolved: [`actor:${actorId}:missing-or-dead`] };
  if (legalActions.length === 0) return { ok: false, unresolved: [`actor:${actorId}:no-legal-actions`] };
  const phase = timeOfDay(state.worldTimeT);
  if (!phase) return { ok: false, unresolved: ['world-time:invalid-phase'] };

  const nodeId = self.nodeId;
  const currentNodeName = nodeId === null ? null : locationNameForNode(nodeId, state.nodes[nodeId]?.label);
  const actorsInNode = nodeId === null
    ? []
    : Object.values(state.actors).filter((actor) => actor.alive && actor.nodeId === nodeId);
  const objectsInNode = nodeId === null
    ? []
    : Object.values(state.objects)
      .filter((object) => object.nodeId === nodeId && object.ownerActorId === null)
      .sort((left, right) => left.id.localeCompare(right.id));
  const memory = priorMemory ?? self.aiMemory ?? { processedThroughSequence: state.sequence, entries: [] };
  const arrivalMemory = memory.entries.find((entry) => entry.kind === 'arrival-memory') ?? (self.lastActionId == null ? {
    sequence: 0, eventId: `arrival-${actorId}`, kind: 'arrival-memory', text: ARRIVAL_MEMORY_TEXT, importance: 'priority' as const,
  } : undefined);
  const eligibleEvents = recentEvents
    .filter((event) => event.sequence > memory.processedThroughSequence && event.sequence <= state.sequence && event.visibility === 'public' && (
      event.actorId === actorId
      || residentHpChange(event, actorId) !== undefined
      || (['gift-transferred', 'gift-dropped'].includes(event.kind) && asRecord(event.payload).recipientId === actorId)
      || (nodeId !== null && event.nodeId === nodeId && event.worldTimeT >= (self.unsafeEntryAtT ?? state.worldTimeT))
    ))
    .sort((left, right) => left.sequence - right.sequence);
  const additions: ResidentAiMemoryEntry[] = [];
  for (const event of eligibleEvents) {
    let sentence: string | undefined;
    try { sentence = formatEvent(event, actorId); } catch { sentence = undefined; }
    const text = sentence?.trim();
    if (!text) continue;
    additions.push({
      sequence: event.sequence,
      eventId: event.eventId,
      kind: event.kind,
      text,
      importance: isPriorityMemoryEvent(event, actorId) ? 'priority' : 'recent',
    });
  }
  const entries = boundResidentMemory([...memory.entries, ...(arrivalMemory && !memory.entries.some((entry) => entry.kind === 'arrival-memory') ? [arrivalMemory] : []), ...additions]);
  const updatedMemory: ResidentAiMemory = { processedThroughSequence: state.sequence, entries };

  const narration = [
    '請以自然繁體中文寫出身在島上的故事口吻；避免系統報告或機械清單。intent 與 text 都要自然敘述。action_id 只放在 JSON 欄位，不要出現在 intent、text 或其他自然文字。事件若記錄對方背包已滿、物品掉在地上，請明確保留「背包已滿」及「沒有交付、掉在地上」的結果，不可寫成禮物已送達；只依事件記錄敘述，不推測其他居民的背包狀態。',
    'self.remaining_life 代表目前餘命。',
    'self.hunger 代表飽食度：數值越高越飽，5 代表已達最飽的進食門檻；低於 5 才能進食。食物效果可能讓數值暫時超過 5。',
    'self.sleep 代表睡眠充足度：3 代表精神最佳、已睡足；數值越低越疲倦，0 代表最疲累，會因此損失餘命。',
    ...(self.lastActionId == null ? [ARRIVAL_MEMORY_TEXT] : []),
    ...(currentNodeName === null ? [] : [`你現在位於${currentNodeName}。`]),
    `現在是${phase}。`,
    ...(phase === '夜晚' && !isNodeCampfireProtected(state, nodeId, state.worldTimeT, self.dungeonLocation != null)
      ? ['晚上了，你想找個有火的地方過夜']
      : []),
    ...additions.map((entry) => entry.text),
  ].join('\n');
  const candidateActions: readonly CandidateAction[] = legalActions.map((action) => ({
    id: action.id,
    type: action.type,
    name: action.name,
    timeCostT: action.costT,
    requiresText: action.requiresText,
  }));
  const snapshot: Readonly<Record<string, unknown>> = {
    self: { ...actorJson(self, true), ...(arrivalMemory ? { arrival_memory: arrivalMemory.text } : {}) },
    ...(nodeId === null ? {} : { current_location: { node_id: nodeId, name: currentNodeName } }),
    visible_actors: actorsInNode.filter((actor) => actor.id !== actorId).map((actor) => actorJson(actor, false)),
    visible_objects: objectsInNode.map((object, index) => ({ slot: index + 1 })),
  };
  const actionRows = candidateActions.map((action) => ({
    id: action.id,
    type: action.type,
    name: action.name,
    timeCostT: action.timeCostT,
    requiresText: action.requiresText,
  }));
  return {
    ok: true,
    memory: updatedMemory,
    input: {
      narration,
      snapshot: { ...snapshot, available_actions: actionRows },
      actions: candidateActions,
      rememberedEvents: promptMemoryCandidates(memory.entries).map(({ sequence, importance, text }) => ({ sequence, importance, text })),
    },
  };
}
