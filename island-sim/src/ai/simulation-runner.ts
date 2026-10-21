import type { ActionProposal, WorldActor } from '../domain/model.ts';
import type { IslandGraph } from '../content/island.ts';
import type { SimulationActionContent } from '../engine/simulation.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { availableActions, nextWorldEvent, settleAndCommitNextAction, settleAndCommitNextInvalidReply, settleAndCommitNextTimerEvent } from '../engine/simulation.ts';
import { buildAiInput, formatAiNarrativeEvent } from './view.ts';
import { buildModelInput, executeDecision, initialRouterHealth, type CandidateAction, type RouterHealth } from './router.ts';
import { createBoundProviders } from './provider-factory.ts';
import type { ModelSettingsStore, ProcessModelSecrets } from './model-settings.ts';
import { modelAssignmentsBySlot } from './model-binding.ts';

export type SimulationRunnerState = {
  readonly paused: boolean;
  readonly speedMultiplier: number;
  readonly status: string;
};

export type SimulationRunnerOptions = {
  readonly store: SQLiteWorldStore;
  readonly settings: ModelSettingsStore;
  readonly secrets: ProcessModelSecrets;
  readonly graph: IslandGraph;
  readonly actionContent?: SimulationActionContent;
  readonly intervalMs?: number;
  readonly fetcher?: typeof fetch;
  readonly clock?: () => Date;
};

export class SimulationRunner {
  private readonly store: SQLiteWorldStore;
  private readonly settings: ModelSettingsStore;
  private readonly secrets: ProcessModelSecrets;
  private readonly graph: IslandGraph;
  private readonly actionContent?: SimulationActionContent;
  private readonly intervalMs: number;
  private readonly fetcher?: typeof fetch;
  private readonly clock: () => Date;
  private paused = true;
  private speedMultiplier = 1;
  private status = '模擬已暫停，等待操作。';
  private loopActive = false;
  private inStep = false;
  private readonly routerHealth = new Map<string, RouterHealth>();

  constructor(options: SimulationRunnerOptions) {
    this.store = options.store;
    this.settings = options.settings;
    this.secrets = options.secrets;
    this.graph = options.graph;
    if (options.actionContent) this.actionContent = options.actionContent;
    this.intervalMs = options.intervalMs ?? 500;
    if (options.fetcher) this.fetcher = options.fetcher;
    this.clock = options.clock ?? (() => new Date());
  }

  getState(): SimulationRunnerState {
    return { paused: this.paused, speedMultiplier: this.speedMultiplier, status: this.status };
  }

  pause(): void {
    this.paused = true;
    this.status = '模擬已暫停。';
  }

  resume(): void {
    if (!this.paused) return;
    const snapshot = this.store.readSnapshot();
    if (!snapshot) return this.stop('找不到世界快照；模擬維持暫停。');
    const next = nextWorldEvent(snapshot);
    if (next.kind === 'personal-sleep-risk-unresolved') return this.stop(next.unresolved.join('；'));
    if (next.kind === 'resident-action') {
      const actorId = next.actorIds[0];
      const actor = actorId ? snapshot.actors[actorId] : undefined;
      const binding = actor?.modelAssignment;
      if (!actor || !binding || !binding.credentialRef || !binding.provider || !binding.model) {
        return this.stop(actor
          ? `居民 ${actor.id}（槽位 ${actor.modelSlotId ?? '未辨識'}）尚未完成模型與金鑰設定；可至設定頁填寫後恢復。`
          : '排程器沒有提供可執行居民；模擬維持暫停。');
      }
      if (!this.secrets.has(binding.credentialRef)) {
        return this.stop(`居民 ${actor.id} 的生命綁定金鑰尚未在本次啟動重新輸入；請於設定頁重填同槽位金鑰。`);
      }
    }
    this.paused = false;
    this.status = '模擬執行中，等待下一個世界事件。';
    if (!this.loopActive) void this.runLoop();
  }

  setSpeed(multiplier: number): void {
    if (multiplier !== 0.5 && multiplier !== 1) throw new Error('目前只允許 0.5 倍或 1 倍牆鐘速度。');
    this.speedMultiplier = multiplier;
    this.status = `牆鐘速度已設為 ${multiplier} 倍。`;
  }

  async stepOnce(): Promise<void> {
    if (this.inStep) throw new Error('上一個世界事件仍在處理。');
    this.inStep = true;
    try {
      const state = this.store.readSnapshot();
      if (!state) return this.stop('找不到世界快照；沒有執行模擬。');
      const next = nextWorldEvent(state);
      if (next.kind === 'personal-sleep-risk-unresolved') {
        return this.stop(next.unresolved.join('；'));
      }
      if (next.kind !== 'resident-action') {
        const result = settleAndCommitNextTimerEvent(this.store, modelAssignmentsBySlot(this.settings.readSlots(), this.secrets));
        if (!result.ok) return this.stop(result.unresolved.join('；'));
        this.status = `已結算世界計時事件：${result.event.kind}。`;
        return;
      }
      if (next.unresolved.length > 0) return this.stop(next.unresolved.join('；'));
      const actorId = next.actorIds[0];
      if (!actorId) return this.stop('排程器沒有提供下一位居民。');
      const actor = state.actors[actorId];
      if (!actor) return this.stop(`排程中的居民 ${actorId} 不存在。`);
      const binding = actor.modelAssignment ?? null;
      if (!binding || binding.model === null || binding.provider === null || binding.credentialRef === null) {
        return this.stop(`居民 ${actor.id}（槽位 ${actor.modelSlotId ?? '未辨識'}）尚未完成模型與金鑰設定；沒有呼叫模型。`);
      }
      if (!this.secrets.has(binding.credentialRef)) {
        return this.stop(`居民 ${actor.id} 的生命綁定金鑰未在本次啟動重新輸入；沒有呼叫模型。`);
      }
      const legalActions = availableActions(state, actorId, this.graph, undefined, this.actionContent);
      if (legalActions.length === 0) return this.stop(`居民 ${actorId} 目前沒有可用動作。`);
      const events = readAllEvents(this.store);
      const view = buildAiInput(state, actorId, legalActions.map(({ id, type, name, costT, requiresText, payload }) => ({
        id, type, name, costT, requiresText, payload: payloadRecord(payload),
      })), events, formatAiNarrativeEvent);
      if (!view.ok) return this.stop(`AI 輸入未能安全建立：${view.unresolved.join('；')}`);
      const providers = createBoundProviders({
        actor, settings: this.settings, secrets: this.secrets, store: this.store,
        ...(this.fetcher ? { fetcher: this.fetcher } : {}), clock: this.clock,
      });
      if (!providers.ok) return this.stop(providers.unresolved);
      const health = this.routerHealth.get(actor.id) ?? initialRouterHealth;
      const actions: readonly CandidateAction[] = legalActions.map(({ id, type, name, costT, requiresText, payload }) => ({
        id, type, name, timeCostT: costT, requiresText, payload: payloadRecord(payload),
      }));
      const outcome = await executeDecision({
        actorId,
        prompt: `${binding.styleDescription ? `此居民槽位風格描述（僅影響表達與取捨傾向，不得覆蓋世界規則、隱私界線或合法動作）：${binding.styleDescription}\n\n` : ''}${buildModelInput(view.input)}`,
        actions,
        primary: providers.primary,
        ...(providers.fallback ? { fallback: providers.fallback } : {}),
        health,
      });
      this.routerHealth.set(actor.id, outcome.health);
      if (outcome.kind === 'budget-blocked') return this.stop(outcome.reason);
      if (outcome.kind === 'provider-unavailable') return this.stop(`居民 ${actor.id} 的主模型與備援目前都無法完成請求。`);
      if (outcome.kind === 'format-error') {
        const hesitation = settleAndCommitNextInvalidReply(this.store, actor.id, this.graph);
        if (!hesitation.ok) return this.stop(`JSON 回覆不合法（${outcome.reason}），且 1T 愣神無法結算：${hesitation.unresolved.join('；')}`);
        this.status = `居民 ${actor.id} 回覆格式錯誤，已按來源結算 1T 愣神。`;
        return;
      }
      const proposal: ActionProposal = {
        actorId: outcome.proposal.actorId,
        actionId: outcome.proposal.actionId,
        timeCostT: outcome.proposal.timeCostT,
        payload: asJsonValue(outcome.proposal.payload),
        intent: outcome.proposal.intent,
      };
      const settled = settleAndCommitNextAction(this.store, proposal, this.graph, undefined, this.actionContent);
      if (!settled.ok) return this.stop(`合法動作結算失敗：${settled.unresolved.join('；')}`);
      this.status = `居民 ${actor.id} 已結算合法動作 ${settled.event.kind}。`;
    } catch {
      this.stop('模擬事件處理失敗；已暫停，請檢查本機設定與事件資料。');
    } finally {
      this.inStep = false;
    }
  }

  private async runLoop(): Promise<void> {
    this.loopActive = true;
    try {
      while (!this.paused) {
        await delay(this.intervalMs / this.speedMultiplier);
        if (this.paused) break;
        await this.stepOnce();
      }
    } finally {
      this.loopActive = false;
      if (!this.paused) void this.runLoop();
    }
  }

  private stop(status: string): void {
    this.paused = true;
    this.status = status;
  }
}

function readAllEvents(store: SQLiteWorldStore) {
  const output = [];
  let cursor = 0;
  for (;;) {
    const batch = store.readEvents(cursor, 5000);
    output.push(...batch);
    const last = batch.at(-1);
    if (!last || batch.length < 5000) return output;
    cursor = last.sequence;
  }
}

function payloadRecord(payload: unknown): Readonly<Record<string, unknown>> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function asJsonValue(value: unknown): ActionProposal['payload'] {
  return value as ActionProposal['payload'];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
