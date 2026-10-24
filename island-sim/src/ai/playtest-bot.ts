import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActionDefinition, ActionProposal, WorldEvent } from '../domain/model.ts';
import type { IslandGraph } from '../content/island.ts';
import type { SimulationActionContent } from '../engine/simulation.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { loadIslandGraph } from '../content/island.ts';
import { loadSimulationActionContent } from '../content/actions.ts';
import { createInitialWorld, syncWorldNodeMetadataFromGraph } from '../engine/world.ts';
import { availableActions, nextWorldEvent, settleAndCommitNextAction, settleAndCommitNextTimerEvent } from '../engine/simulation.ts';
import { SeededRandom, seedToState } from '../engine/random.ts';
import { SQLiteWorldStore as Store } from '../persistence/sqlite-store.ts';

export type PlaytestBotOptions = {
  readonly store: SQLiteWorldStore;
  readonly graph: IslandGraph;
  readonly actionContent: SimulationActionContent;
  readonly seed?: string;
  readonly choiceDrawOffset?: number;
};

export type PlaytestBotStep =
  | { readonly kind: 'action'; readonly actorId: string; readonly actionId: string; readonly eventKind: string; readonly sequence: number }
  | { readonly kind: 'timer'; readonly eventKind: string; readonly sequence: number }
  | { readonly kind: 'stopped'; readonly reason: string; readonly sequence: number };

export type PlaytestBotRunResult = {
  readonly steps: number;
  readonly stopped: boolean;
  readonly reason?: string;
  readonly worldTimeT: number;
};

/** Uniformly samples only the current availableActions list. */
export function choosePlaytestAction(actions: readonly ActionDefinition[], random: SeededRandom): ActionDefinition | null {
  if (actions.length === 0) return null;
  const draw = random.next('playtest-bot-action');
  return actions[Math.floor(draw.value * actions.length)] ?? null;
}

export class PlaytestBot {
  private readonly store: SQLiteWorldStore;
  private readonly graph: IslandGraph;
  private readonly actionContent: SimulationActionContent;
  private readonly random: SeededRandom;

  constructor(options: PlaytestBotOptions) {
    this.store = options.store;
    this.graph = options.graph;
    this.actionContent = options.actionContent;
    this.random = new SeededRandom(seedToState(options.seed ?? 'island-playtest'));
    const choiceDrawOffset = options.choiceDrawOffset ?? 0;
    if (!Number.isSafeInteger(choiceDrawOffset) || choiceDrawOffset < 0) throw new RangeError('選擇器恢復偏移必須是非負整數。');
    for (let index = 0; index < choiceDrawOffset; index += 1) this.random.next('playtest-bot-resume-offset');
    this.syncSnapshotNodeMetadata();
  }

  stepOnce(): PlaytestBotStep {
    const state = this.store.readSnapshot();
    if (!state) return { kind: 'stopped', reason: '找不到世界快照。', sequence: 0 };
    const scheduled = nextWorldEvent(state);
    if (scheduled.kind !== 'resident-action') {
      if ('unresolved' in scheduled && scheduled.unresolved.length > 0) {
        return { kind: 'stopped', reason: scheduled.unresolved.join('；'), sequence: state.sequence };
      }
      const result = settleAndCommitNextTimerEvent(this.store, {}, {
        ...(this.actionContent.monsters === undefined ? {} : { monsters: this.actionContent.monsters }),
        ...(this.actionContent.attackDistributions === undefined ? {} : { attackDistributions: this.actionContent.attackDistributions }),
        ...(this.actionContent.surfaceEntryEvents === undefined ? {} : { surfaceEntryEvents: this.actionContent.surfaceEntryEvents }),
        ...(this.actionContent.monsters === undefined ? {} : { surfaceMonsters: this.actionContent.monsters }),
      });
      if (!result.ok) return { kind: 'stopped', reason: result.unresolved.join('；'), sequence: state.sequence };
      return { kind: 'timer', eventKind: result.event.kind, sequence: result.state.sequence };
    }
    if (scheduled.unresolved.length > 0) return { kind: 'stopped', reason: scheduled.unresolved.join('；'), sequence: state.sequence };
    const actorId = scheduled.actorIds[0];
    if (!actorId) return { kind: 'stopped', reason: '排程器沒有提供下一位居民。', sequence: state.sequence };
    const actions = availableActions(state, actorId, this.graph, undefined, this.actionContent);
    const action = choosePlaytestAction(actions, this.random);
    if (!action) return { kind: 'stopped', reason: `居民 ${actorId} 目前沒有合法動作。`, sequence: state.sequence };
    const proposal: ActionProposal = {
      actorId,
      actionId: action.id,
      timeCostT: action.costT,
      payload: action.payload,
      intent: '本機试玩 bot',
      ...(action.requiresText ? { text: '本機試玩' } : {}),
    };
    const result = settleAndCommitNextAction(this.store, proposal, this.graph, undefined, this.actionContent);
    if (!result.ok) return { kind: 'stopped', reason: result.unresolved.join('；'), sequence: state.sequence };
    return { kind: 'action', actorId, actionId: action.id, eventKind: result.event.kind, sequence: result.state.sequence };
  }

  run(maxSteps: number): { readonly steps: number; readonly stopped: boolean; readonly reason?: string } {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError('步數必須是正整數。');
    let steps = 0;
    while (steps < maxSteps) {
      const result = this.stepOnce();
      if (result.kind === 'stopped') return { steps, stopped: true, reason: result.reason };
      steps += 1;
    }
    return { steps, stopped: false };
  }

  runUntilWorldTimeT(targetWorldTimeT: number): PlaytestBotRunResult {
    if (!Number.isSafeInteger(targetWorldTimeT) || targetWorldTimeT < 0) throw new RangeError('目標世界時間必須是非負整數。');
    let steps = 0;
    while (true) {
      const state = this.store.readSnapshot();
      if (!state) return { steps, stopped: true, reason: '找不到世界快照。', worldTimeT: 0 };
      if (state.worldTimeT >= targetWorldTimeT) return { steps, stopped: false, worldTimeT: state.worldTimeT };
      if (!Object.values(state.actors).some((actor) => actor.actorType === 'resident' && actor.alive)) {
        return { steps, stopped: true, reason: '所有居民均已死亡。', worldTimeT: state.worldTimeT };
      }
      const step = this.stepOnce();
      if (step.kind === 'stopped') return { steps, stopped: true, reason: step.reason, worldTimeT: this.store.readSnapshot()?.worldTimeT ?? state.worldTimeT };
      steps += 1;
    }
  }

  private syncSnapshotNodeMetadata(): void {
    const snapshot = this.store.readSnapshot();
    if (snapshot === null) return;
    const sync = syncWorldNodeMetadataFromGraph(snapshot, this.graph);
    if (sync.changedNodeIds.length === 0) return;
    const sequence = snapshot.sequence + 1;
    const event: WorldEvent = {
      eventId: `node-metadata-sync-${sequence}`,
      sequence,
      worldTimeT: snapshot.worldTimeT,
      actorId: null,
      nodeId: null,
      kind: 'simulation-lineage-repair',
      visibility: 'public',
      payload: {
        action: 'sync-snapshot-node-metadata-from-current-island-source',
        source: 'references/tables/island_nodes.csv',
        changedNodes: sync.changedFieldsByNode.map(({ nodeId, fields }) => ({ nodeId, fields })),
        randomDrawsConsumed: false,
      },
      randomDraws: [],
    };
    this.store.commit(snapshot.sequence, { ...sync.state, sequence }, [event]);
  }
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);
  const sourceTables = new URL('../../references/tables/', import.meta.url);
  const [graph, actionContent] = await Promise.all([loadIslandGraph(sourceTables), loadSimulationActionContent(sourceTables)]);
  await mkdir(dirname(options.database), { recursive: true });
  const store = Store.open(options.database);
  try {
    if (!store.readSnapshot()) {
      const state = createInitialWorld(graph, { seed: options.seed, contentVersion: 'local-playtest' });
      store.commit(0, state, []);
    }
    const bot = new PlaytestBot({ store, graph, actionContent, seed: options.seed, choiceDrawOffset: options.choiceDrawOffset });
    const result = options.untilWorldTimeT === undefined
      ? bot.run(options.steps)
      : bot.runUntilWorldTimeT(options.untilWorldTimeT);
    process.stdout.write(`试玩步数：${result.steps}；世界序列：${store.readSnapshot()?.sequence ?? 0}\n`);
    if ('worldTimeT' in result) process.stdout.write(`世界时间T：${result.worldTimeT}\n`);
    if (result.stopped) process.stdout.write(`安全停止：${result.reason ?? '未知原因'}\n`);
  } finally {
    store.close();
  }
}

function parseArgs(args: readonly string[]): { database: string; seed: string; steps: number; choiceDrawOffset: number; untilWorldTimeT?: number } {
  let database = resolve('./data/playtest.sqlite');
  let seed = 'island-playtest';
  let steps = 100;
  let choiceDrawOffset = 0;
  let untilWorldTimeT: number | undefined;
  for (const arg of args) {
    const [key, value] = arg.split('=', 2);
    if (key === '--db' && value) database = resolve(value);
    else if (key === '--seed' && value) seed = value;
    else if (key === '--steps' && value) steps = Number(value);
    else if (key === '--choice-offset' && value) choiceDrawOffset = Number(value);
    else if (key === '--until-t' && value) untilWorldTimeT = Number(value);
    else if (arg === '--help') {
      process.stdout.write('用法：node --experimental-strip-types src/ai/playtest-bot.ts [--db=./data/playtest.sqlite] [--seed=island-playtest] [--choice-offset=0] [--steps=100 | --until-t=2160]\n');
      process.exit(0);
    } else throw new Error(`不支援的參數：${arg}`);
  }
  if (!seed) throw new Error('seed 不可為空。');
  if (!Number.isSafeInteger(steps) || steps < 1) throw new Error('--steps 必須是正整數。');
  if (!Number.isSafeInteger(choiceDrawOffset) || choiceDrawOffset < 0) throw new Error('--choice-offset 必須是非負整數。');
  if (untilWorldTimeT !== undefined && (!Number.isSafeInteger(untilWorldTimeT) || untilWorldTimeT < 0)) throw new Error('--until-t 必須是非負整數。');
  if (untilWorldTimeT !== undefined && args.some((arg) => arg.startsWith('--steps='))) throw new Error('--steps 與 --until-t 不可同時使用。');
  return { database, seed, steps, choiceDrawOffset, ...(untilWorldTimeT === undefined ? {} : { untilWorldTimeT }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : '试玩 bot 執行失敗。'}\n`);
    process.exitCode = 1;
  });
}
