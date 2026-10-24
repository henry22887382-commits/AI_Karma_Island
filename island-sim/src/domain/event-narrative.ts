import type { WorldEvent } from './model.ts';

export interface EventNarrativeContext {
  readonly actor: string;
  readonly itemName: (itemId: string) => string;
  readonly participantName?: (participantId: string) => string;
  readonly nodeName?: (nodeId: string) => string;
  readonly intent?: string;
  readonly createdItems?: readonly string[];
}

/** Player-facing event text shared by the observer and resident biographies. */
export function describeWorldEvent(event: WorldEvent, context: EventNarrativeContext): string {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.kind === 'surface-action-resolved') {
    const actions: Readonly<Record<string, string>> = {
      fishing: '釣魚', 'river-exploration': '探索河流', 'night-river-dive': '夜間潛入河流',
      'rock-exploration': '探索岩地', 'forest-berry-gather': '採集野莓',
    };
    const actionId = typeof payload.action === 'string' ? payload.action : '';
    const action = actions[actionId] ?? '進行地表活動';
    const outcome = displayOutcome(payload.outcome);
    const delta = isRecord(payload.actorDelta) ? payload.actorDelta : {};
    const spawnName = typeof payload.spawnMonsterName === 'string' && payload.spawnMonsterName.trim()
      ? payload.spawnMonsterName.trim() : undefined;
    const sameAsSpawn = outcome !== undefined && spawnName === outcome;
    const spawned = spawnName && !sameAsSpawn ? `，遇見${spawnName}` : '';
    const gainedItems = [...new Set(context.createdItems ?? [])];
    const namedItems = gainedItems.map(context.itemName);
    const resultIsItem = outcome !== undefined && (namedItems.includes(outcome) || isSurfaceReward(actionId, outcome));
    const result = outcome
      ? sameAsSpawn ? `，遇到${outcome}`
        : outcome === '空竿' ? '，沒有釣到魚'
          : outcome === '無收穫' ? '，沒有收穫'
        : resultIsItem && actionId === 'fishing' ? `，釣到${outcome}`
          : resultIsItem ? `，得到${outcome}` : `，結果：${outcome}`
      : '';
    const gainedNames = namedItems.filter((name) => name !== outcome);
    const gained = gainedNames.length ? `，另外取得${joinItems(gainedNames)}` : '';
    const changes = [numericDelta(delta.hitPoints, '餘命'), numericDelta(delta.sleep, '睡眠'), numericDelta(delta.hunger, '飽足')]
      .filter((entry): entry is string => entry !== undefined);
    const status = changes.length ? `；${changes.join('，')}` : '';
    const intent = context.intent?.trim() ? `；想做的是「${context.intent.trim()}」` : '';
    return `${context.actor}${action}${result}${gained}${spawned}${status}${intent}`;
  }
  if (event.kind === 'item-picked-up') {
    const item = typeof payload.itemId === 'string' ? context.itemName(payload.itemId) : '一件物品';
    const intent = context.intent?.trim() ? `，打算「${context.intent.trim()}」` : '';
    return `${context.actor}拾起${item}${intent}`;
  }
  const participant = (id: unknown, fallback: string) => typeof id === 'string'
    ? context.participantName?.(id) ?? fallback : fallback;
  const target = participant(payload.targetActorId ?? payload.targetId, '另一個對象');
  const item = typeof payload.itemId === 'string' ? context.itemName(payload.itemId) : undefined;
  const result = displayOutcome(payload.outcome);
  const location = typeof payload.toNodeId === 'string' ? context.nodeName?.(payload.toNodeId) : undefined;
  const intent = context.intent?.trim() ? `；原本打算「${context.intent.trim()}」` : '';
  const stories: Readonly<Record<string, (p: Record<string, unknown>) => string>> = {
    'resident-action-settled': (p) => {
      const destinationIsMovement = isMovingAction(p) && typeof p.toNodeId === 'string' && p.toNodeId !== p.fromNodeId;
      return `${context.actor}${actionLabel(p)}${destinationIsMovement && location ? `，前往${location}` : ''}${intent}`;
    },
    'resident-action-format-error': () => `${context.actor}這回合沒有完成行動，回覆內容無法辨認${intent}`,
    'resident-arrived': (p) => `${context.actor}抵達${location ?? '目的地'}${arrivalDetails(p)}${intent}`,
    'resident-attacked': (p) => `${context.actor}攻擊${target}${typeof p.damage === 'number' ? `，造成 ${p.damage} 點傷害` : ''}${p.killed === true ? '，對方倒下' : ''}${intent}`,
    'boss1-flying-hit-blocked': () => `${context.actor}攻擊${target}，但沒有命中`,
    'boss1-taunt-counterattack': (p) => `${participant(p.targetActorId, '首領')}發動反擊${formatHits(p.bossAttacks, participant)}`,
    'boss2-defense-breakthrough': (p) => `${context.actor}突破${target}的防線${typeof p.breakthroughs === 'number' ? `，累計 ${p.breakthroughs} 次` : ''}${intent}`,
    'boss1-defeated': (p) => `${context.actor}擊敗首領${rewardText(p, context.itemName)}`,
    'boss2-retreated': (p) => `${participant(p.lastHitActorId, context.actor)}擊退了首領${rewardText(p, context.itemName)}`,
    'gift-transferred': (p) => `${participant(p.giverId, context.actor)}把${item ?? '物品'}送給${participant(p.recipientId, '居民')}${intent}`,
    'gift-dropped': (p) => `${participant(p.giverId, context.actor)}想把${item ?? '物品'}送給${participant(p.recipientId, '居民')}，但對方背包已滿，物品掉在地上，沒有交付${intent}`,
    'trade-requested': (p) => `${participant(p.proposerId, context.actor)}向${participant(p.receiverId, '居民')}提出交換：拿出${p.offeredItemId ? context.itemName(String(p.offeredItemId)) : '物品'}，換取${p.requestedItemId ? context.itemName(String(p.requestedItemId)) : '對方的物品'}${intent}`,
    'trade-accepted': (p) => `交易完成：${participant(p.proposerId, '居民')}交出${p.offeredItemId ? context.itemName(String(p.offeredItemId)) : '物品'}，換得${p.requestedItemId ? context.itemName(String(p.requestedItemId)) : '物品'}；${participant(p.receiverId, '居民')}接受交換${intent}`,
    'trade-rejected': (p) => `${participant(p.receiverId, '居民')}拒絕了${participant(p.proposerId, '居民')}提出的交換（${p.offeredItemId ? context.itemName(String(p.offeredItemId)) : '物品'}換${p.requestedItemId ? context.itemName(String(p.requestedItemId)) : '物品'}）${intent}`,
    'public-message-sent': (p) => `${context.actor}向${participant(p.recipientId, '居民')}傳話${typeof p.text === 'string' ? `：「${p.text}」` : ''}${intent}`,
    'item-dropped': () => `${context.actor}放下${item ?? '一件物品'}${intent}`,
    'scene-object-destroyed': () => `${context.actor}拆除${item ?? '一件放置物'}${intent}`,
    'resident-ate': () => `${context.actor}吃下${item ?? '食物'}${intent}`,
    'item-equipped': () => `${context.actor}裝備${item ?? '一件物品'}${intent}`,
    'coconut-harvested': () => `${context.actor}採收並取得 1 顆椰子${typeof payload.stockAfter === 'number' ? `，海灘還剩 ${payload.stockAfter} 顆` : ''}${intent}`,
    'container-opened': () => `${context.actor}打開${typeof payload.containerName === 'string' ? payload.containerName : '容器'}${item ? `，找到${item}` : ''}${intent}`,
    'object-read': () => `${context.actor}閱讀${item ?? '一件物品'}${typeof payload.text === 'string' ? `：「${payload.text}」` : ''}${intent}`,
    'corpse-item-scavenged': () => `${context.actor}在遺體旁找到${item ?? '一件物品'}${intent}`,
    'corpse-carried': () => `${context.actor}搬運遺體${intent}`,
    'corpse-dropped': () => `${context.actor}放下遺體${intent}`,
    'resident-died': () => `${context.actor}離世`,
    'resident-born': () => `${context.actor}來到島上`,
    'actor-moved': () => `${context.actor}${location ? `前往${location}` : '移動到新的地方'}${intent}`,
    'sleep-started': () => `${context.actor}開始休息${intent}`,
    'sleep-ended': () => `${context.actor}醒來了`,
    'world-object-expired': () => `${item ?? '地上的物品'}已消失`,
    'biography': () => `${context.actor}留下了一段生命回憶`,
    'monument-inscription-written': () => `${context.actor}在紀念碑留下文字${typeof payload.text === 'string' ? `：「${payload.text}」` : ''}${intent}`,
    'monument-inscription-read': () => `${context.actor}閱讀紀念碑上的文字${typeof payload.text === 'string' ? `：「${payload.text}」` : ''}${intent}`,
    'dungeon-resident-exited': () => `${context.actor}離開地牢${intent}`,
    'dungeon-resident-retreated': () => `${context.actor}從地牢撤退${intent}`,
    'dungeon-action-settled': (p) => `${context.actor}在地牢中前進${dungeonOutcome(p)}${p.killed === true ? '，遭遇後離世' : ''}${intent}`,
    'dungeon-lava-splash-settled': (p) => `${context.actor}遭熔岩飛濺${typeof p.lavaSplashDamage === 'number' ? `，受傷 ${p.lavaSplashDamage}` : ''}${p.killed === true ? '並離世' : ''}`,
    'dungeon-boss-encounter-started': () => `${context.actor}在地牢遇見首領${typeof payload.bossName === 'string' ? `「${payload.bossName}」` : ''}`,
    'forest-entry-risk-category': () => `${context.actor}進入森林時遇到狀況${result ? `：${result}` : ''}`,
    'personal-sleep-risk-settled': (p) => formatSleepChecks(p.checks, participant),
    'daily-survival-settled': (p) => formatDailySettlement(p, participant),
    'monster-action-settled': (p) => `${context.actor}${p.action === 'attack' ? '發動攻擊' : p.action === 'sleep' ? '休息' : '採取行動'}${formatHits(p.hits, participant)}`,
  };
  const story = stories[event.kind];
  if (story) return story(payload);
  const subject = item ? `，牽涉到${item}` : location ? `，地點在${location}` : '';
  return `島上發生了一件事${subject}；細節沒有完整記下${intent}`;
}

function displayOutcome(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const outcome = value.trim();
  return /[\u3400-\u9fff]/u.test(outcome) ? outcome : undefined;
}

function joinItems(items: readonly string[]): string {
  return items.length ? `「${items.join('」、「')}」` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionLabel(payload: Record<string, unknown>): string {
  const labels: Readonly<Record<string, string>> = {
    wait: '稍作等待', sleep: '開始休息', move: '移動', attack: '進行攻擊',
    pickup: '拾起物品', drop: '放下物品', eat: '進食', equip: '整理裝備',
    gift: '送出物品', message: '傳送訊息', surface: '進行地表活動',
    'harvest-coconut': '採集椰子', 'carry-corpse': '搬運遺體',
    'destroy-placed': '拆除放置物', 'dungeon-enter': '進入地牢',
    'dungeon-exit': '離開地牢', 'dungeon-move': '深入地牢', retreat: '撤退',
    'container-open': '打開容器', 'container-opened': '打開容器',
  };
  const type = typeof payload.actionType === 'string' ? payload.actionType : '';
  const id = typeof payload.actionId === 'string' ? payload.actionId : '';
  if (id === 'wait') return '稍作等待';
  if (id === 'sleep' || id.startsWith('sleep:')) return '開始休息';
  return labels[type] ?? (id.startsWith('pickup:') ? '拾起物品' : id.startsWith('move:') ? '移動' : '採取行動');
}

function isMovingAction(payload: Record<string, unknown>): boolean {
  const id = typeof payload.actionId === 'string' ? payload.actionId : '';
  return payload.actionType === 'move' || payload.actionType === 'retreat' || id.startsWith('move:') || id.startsWith('retreat:');
}

function numericDelta(value: unknown, label: string): string | undefined {
  if (typeof value !== 'number' || value === 0) return undefined;
  return `${label}${value > 0 ? '增加' : '減少'} ${Math.abs(value)}`;
}

function isSurfaceReward(action: string, outcome: string): boolean {
  const rewards: Readonly<Record<string, readonly string[]>> = {
    fishing: ['普通魚', '藍鰭／黑鮪魚', '河豚', '普通垃圾', '漂流瓶', '普通皮革下衣', '勇者下甲'],
    'river-exploration': ['普通魚', '名鮭魚'], 'night-river-dive': ['普通魚', '名鮭魚'],
    'rock-exploration': ['魔法石', '寶箱'], 'forest-berry-gather': ['有益野果'],
  };
  return rewards[action]?.includes(outcome) === true;
}

function rewardText(payload: Record<string, unknown>, itemName: (id: string) => string): string {
  const ids = [payload.rewardItemId, payload.uniqueHeroItemId, ...(Array.isArray(payload.rewardItemIds) ? payload.rewardItemIds : [])]
    .filter((id): id is string => typeof id === 'string');
  return ids.length ? `，取得${joinItems(ids.map(itemName))}` : '';
}

function dungeonOutcome(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.dungeonEvents)) return '';
  const outcomes = payload.dungeonEvents.filter(isRecord).flatMap((entry) => {
    const nested = isRecord(entry.payload) ? entry.payload : {};
    return typeof nested.event === 'string' && nested.event.trim() ? [nested.event.trim()] : [];
  });
  return outcomes.length ? `，途中${outcomes.join('、')}` : '';
}

function formatHits(value: unknown, participant: (id: unknown, fallback: string) => string): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const details = value.filter(isRecord).map((hit) => {
    const target = participant(hit.targetId, '居民');
    const damage = typeof hit.appliedDamage === 'number' ? `受到 ${hit.appliedDamage} 點傷害` : '受到了攻擊';
    const died = hit.killed === true
      || (typeof hit.targetHitPointsBefore === 'number' && typeof hit.appliedDamage === 'number' && hit.targetHitPointsBefore - hit.appliedDamage <= 0);
    return `${target}${damage}${died ? '，倒下了' : ''}`;
  });
  return details.length ? `：${details.join('；')}` : '';
}

function formatSleepChecks(value: unknown, participant: (id: unknown, fallback: string) => string): string {
  if (!Array.isArray(value) || value.length === 0) return '夜裡沒有居民遭遇危險';
  const details = value.filter(isRecord).map((check) => {
    const resident = participant(check.actorId, '居民');
    if (check.category === 'no-encounter') return `${resident}平安度過夜晚`;
    const enemy = typeof check.enemyName === 'string' && !isInternalIdentifier(check.enemyName) ? `遇上${check.enemyName}` : '遇上危險';
    const damage = typeof check.hitPointChange === 'number' && check.hitPointChange < 0 ? `，受傷 ${-check.hitPointChange} 點` : '';
    const woke = check.woke === true ? '，因此醒來' : check.woke === false ? '，沒有醒來' : '';
    const died = check.hitPointChange === -1 && check.woke === false ? '，未能活過這次遭遇' : '';
    return `${resident}${enemy}${damage}${woke}${died}`;
  });
  return `夜間休息：${details.join('；')}`;
}

function formatDailySettlement(payload: Record<string, unknown>, participant: (id: unknown, fallback: string) => string): string {
  const deaths = Array.isArray(payload.deaths) ? payload.deaths.filter(isRecord).map((entry) => participant(entry.actorId, '居民')) : [];
  const newborns = Array.isArray(payload.newGenerations) ? payload.newGenerations.filter(isRecord).map((entry) => participant(entry.actorId, '居民')) : [];
  return `每日生活結算${deaths.length ? `；離世：${deaths.join('、')}` : ''}${newborns.length ? `；新居民來到島上：${newborns.join('、')}` : ''}${deaths.length || newborns.length ? '' : '；居民平安度過這一天'}`;
}

function arrivalDetails(payload: Record<string, unknown>): string {
  const details: string[] = [];
  const encounter = isRecord(payload.nightEncounter) ? payload.nightEncounter : undefined;
  if (encounter?.encountered === true) {
    const enemy = typeof encounter.enemyName === 'string' && !isInternalIdentifier(encounter.enemyName) ? encounter.enemyName : '夜間來襲的怪物';
    const damage = typeof encounter.hitPointChange === 'number' && encounter.hitPointChange < 0 ? `，受傷 ${-encounter.hitPointChange} 點` : '';
    details.push(`夜裡遇上${enemy}${damage}`);
  }
  const entry = isRecord(payload.surfaceEntry) ? payload.surfaceEntry : undefined;
  if (entry?.triggered === true) {
    const outcome = displayOutcome(entry.outcomeId);
    details.push(outcome ? `遇到地表事件「${outcome}」` : '遇到地表事件');
  }
  return details.length ? `；${details.join('；')}` : '';
}

function isInternalIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}
