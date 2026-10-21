import type { WorldActor, WorldEvent, WorldState } from '../domain/model.ts';
import type { CandidateAction, ModelInput } from './router.ts';
import { dayPhaseAt } from '../engine/clock.ts';

export type AiLegalAction = {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly costT: 1 | 3;
  readonly requiresText: boolean;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type AiNarrativeFormatter = (event: WorldEvent, actorId: string) => string | undefined;

export function formatAiNarrativeEvent(event: WorldEvent, actorId: string): string | undefined {
  const payload = asRecord(event.payload);
  const self = event.actorId === actorId;
  const subject = self ? '你' : `居民 ${event.actorId ?? '未知'}`;
  if (event.kind === 'resident-action-settled') {
    if (payload.actionType === 'wait') return `${subject}等待了。`;
    if (payload.actionType === 'move' && typeof payload.toNodeId === 'string') return `${subject}開始移動至 Node ${payload.toNodeId}。`;
    if (payload.actionType === 'sleep') return `${subject}開始睡覺，等待天亮。`;
    if (payload.actionType === 'surface' && typeof payload.actionId === 'string') return `${subject}進行了地表行動。`;
    return undefined;
  }
  if (event.kind === 'resident-action-format-error' && self && typeof payload.hesitationText === 'string') return payload.hesitationText;
  if (event.kind === 'resident-arrived' && typeof payload.toNodeId === 'string') {
    return `${subject}抵達了 Node ${payload.toNodeId}。`;
  }
  if (event.kind === 'item-eaten' && self && typeof payload.itemId === 'string') return `你吃下了 ${payload.itemId}。`;
  if (event.kind === 'item-picked-up' && self && typeof payload.itemId === 'string') return `你撿起了 ${payload.itemId}。`;
  if (event.kind === 'item-equipped' && self && typeof payload.itemId === 'string') return `你裝備了 ${payload.itemId}。`;
  if (event.kind === 'corpse-item-scavenged' && self && typeof payload.itemId === 'string') return `你從屍體取得了 ${payload.itemId}。`;
  if (event.kind === 'corpse-carried' && self) return '你搬起了一具屍體。';
  if (event.kind === 'corpse-dropped' && self) return '你放下了攜帶的屍體。';
  if (event.kind === 'resident-attacked' && self && typeof payload.targetActorId === 'string' && typeof payload.damage === 'number') {
    return payload.killed === true
      ? `你攻擊了居民 ${payload.targetActorId}，造成 ${payload.damage} 點傷害。對方倒下了。`
      : `你攻擊了居民 ${payload.targetActorId}，造成 ${payload.damage} 點傷害。`;
  }
  return undefined;
}

export type BuildAiInputResult =
  | { readonly ok: true; readonly input: ModelInput }
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
      hit_points: actor.hitPoints,
      hunger: actor.hunger,
      sleep: actor.sleep,
      inventory: actor.inventory ?? [],
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
): BuildAiInputResult {
  const self = state.actors[actorId];
  if (!self || !self.alive) return { ok: false, unresolved: [`actor:${actorId}:missing-or-dead`] };
  if (legalActions.length === 0) return { ok: false, unresolved: [`actor:${actorId}:no-legal-actions`] };
  const phase = timeOfDay(state.worldTimeT);
  if (!phase) return { ok: false, unresolved: ['world-time:invalid-phase'] };

  const nodeId = self.nodeId;
  const actorsInNode = nodeId === null
    ? []
    : Object.values(state.actors).filter((actor) => actor.alive && actor.nodeId === nodeId);
  const objectsInNode = nodeId === null
    ? []
    : Object.values(state.objects)
      .filter((object) => object.nodeId === nodeId && object.ownerActorId === null)
      .sort((left, right) => left.id.localeCompare(right.id));

  const eligibleEvents = recentEvents
    .filter((event) => event.visibility === 'public' && (
      event.actorId === actorId
      || (nodeId !== null && event.nodeId === nodeId && event.worldTimeT >= (self.unsafeEntryAtT ?? state.worldTimeT))
    ))
    .sort((left, right) => left.sequence - right.sequence);
  const unresolved: string[] = [];
  const lastOwnActionSequence = recentEvents
    .filter((event) => event.actorId === actorId && event.kind === 'resident-action-settled')
    .reduce((latest, event) => Math.max(latest, event.sequence), 0);
  const previousNarratives: string[] = [];
  const currentNarratives: string[] = [];
  for (const event of eligibleEvents) {
    const sentence = formatEvent(event, actorId);
    if (sentence === undefined || sentence.trim().length === 0) {
      unresolved.push(`event:${event.eventId}:missing-narrative`);
    } else if (lastOwnActionSequence > 0 && event.sequence <= lastOwnActionSequence) {
      previousNarratives.push(sentence.trim());
    } else {
      currentNarratives.push(sentence.trim());
    }
  }
  if (unresolved.length > 0) return { ok: false, unresolved };

  const persistentStatuses = actorsInNode
    .filter((actor) => actor.id !== actorId && actor.sleeping)
    .map((actor) => `「${actor.id}」正在睡覺。`);
  const narration = [
    ...(previousNarratives.length ? [`你記得此前親身經歷的事情：\n${previousNarratives.join('\n')}`] : []),
    `現在是${phase}。`, ...currentNarratives, ...persistentStatuses,
  ].join('\n');
  const candidateActions: readonly CandidateAction[] = legalActions.map((action) => ({
    id: action.id,
    type: action.type,
    name: action.name,
    timeCostT: action.costT,
    requiresText: action.requiresText,
  }));
  const snapshot: Readonly<Record<string, unknown>> = {
    self: actorJson(self, true),
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
    input: {
      narration,
      snapshot: { ...snapshot, available_actions: actionRows },
      actions: candidateActions,
    },
  };
}
