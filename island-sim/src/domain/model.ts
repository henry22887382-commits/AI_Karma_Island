export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface WorldActor {
  readonly id: string;
  readonly actorType: 'resident' | 'monster' | 'animal';
  readonly alive: boolean;
  readonly nodeId: string | null;
  readonly nextActionAtT: number;
  readonly speed: number | null;
  readonly unsafeEntryAtT: number | null;
  readonly travel?: TravelState | null;
  readonly dungeonLocation?: DungeonLocation | null;
  readonly sleeping: boolean;
  readonly sleepingSinceT?: number | null;
  /** Number of complete 8T blocks already credited in the current continuous sleep. */
  readonly sleepRecoveryBlocks?: number;
  /** Island day in which this resident last earned sleep through continuous rest. */
  readonly sleepRecoveryDay?: number | null;
  readonly hitPoints?: number;
  readonly hunger?: number;
  readonly sleep?: number;
  readonly attack?: number;
  readonly defense?: number;
  readonly name?: string;
  readonly modelId?: string | null;
  readonly generation?: number | null;
  readonly slotId?: string | null;
  readonly modelSlotId?: number | null;
  readonly modelAssignment?: ModelBinding | null;
  readonly modelSizeB?: number | null;
  readonly sizeAtLeast8BConfirmed?: boolean;
  readonly styleDescription?: string | null;
  readonly nightExplorationStreakAction?: 'night-river-dive' | 'rock-exploration' | null;
  readonly nightExplorationStreakCount?: number;
  readonly diedAtT?: number | null;
  readonly lastActionId?: string | null;
  readonly lastActionResult?: string | null;
  readonly routeHistory?: readonly string[];
  readonly combatRoundCount?: number;
  readonly boss2Breakthroughs?: number;
  readonly invulnerableUntilT?: number | null;
  readonly taunted?: boolean;
  readonly dungeonRouteHistory?: readonly string[];
  readonly encounterId?: string;
  readonly spawnedAtSequence?: number;
  readonly isSummonedCompanion?: boolean;
  readonly inventory?: readonly string[];
  /** Per-instance readable texts carried by this resident; keys remain unique across identical item names. */
  readonly readableInventoryItems?: readonly ReadableInventoryItem[];
  readonly equipment?: Readonly<Record<string, string | null>>;
  /** Per-life record of public events this resident had a chance to observe. */
  readonly aiMemory?: ResidentAiMemory;
}

export interface ReadableInventoryItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly readableTextId?: string | null;
  readonly readableText?: string | null;
}

export interface ResidentAiMemory {
  readonly processedThroughSequence: number;
  readonly entries: readonly ResidentAiMemoryEntry[];
}

export interface ResidentAiMemoryEntry {
  readonly sequence: number;
  readonly eventId: string;
  readonly kind: string;
  readonly text: string;
  readonly importance: 'priority' | 'recent';
}

export interface ModelBinding {
  readonly slotId: number;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly fallbackModels: readonly string[];
  readonly maxInputTokens: number | null;
  /** Per-card character budget for the assembled prompt; legacy bindings default to 8000. */
  readonly maxContextCharacters?: number;
  /** Legacy persisted property; current bindings omit it. */
  readonly maxOutputTokens?: number | null;
  readonly updatedAt: string | null;
  readonly credentialRef: string | null;
  readonly modelSizeB?: number | null;
  readonly sizeAtLeast8BConfirmed?: boolean;
  readonly styleDescription?: string | null;
}

export interface TravelState {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly arrivesAtT: number;
}

export interface DungeonLocation {
  readonly tripId: string;
  readonly floor: number;
  readonly cellId: string;
}

export interface DungeonRuntimeState {
  readonly schemaVersion: 1;
  readonly tripId: string;
  readonly activeFloor: number;
  readonly cellByActorId: Readonly<Record<string, string>>;
  readonly unlockedFloorByActorId: Readonly<Record<string, number>>;
  readonly visitedCells: readonly string[];
  readonly activeEncounterByCell: Readonly<Record<string, DungeonEncounterState>>;
  readonly routeByActorId?: Readonly<Record<string, readonly string[]>>;
}

export interface DungeonEncounterState {
  readonly encounterId: string;
  readonly monsterIds: readonly string[];
}

export type SurfaceTerrain = 'beach' | 'forest' | 'river' | 'rock';
export type SurfaceTerrainClassification = SurfaceTerrain | 'unclassified' | 'coconut-beach' | 'berry-forest' | 'dungeon-entrance' | 'port' | 'monument-valley';

export interface WorldNode {
  readonly id: string;
  readonly label: string | null;
  readonly labelStatus: string;
  readonly visualType: string;
  readonly surfaceTerrain: SurfaceTerrainClassification | null;
  readonly isStartingLocation?: boolean;
  readonly daySurfaceEntryEventsEnabled?: boolean;
  readonly mapPosition?: Readonly<{ x: number | null; y: number | null }>;
  readonly neighbors: readonly string[];
  readonly safe: boolean | null;
}

export interface WorldObject {
  readonly id: string;
  readonly itemId: string | null;
  readonly objectType?: 'item' | 'corpse' | 'container';
  readonly readableTextId?: string | null;
  /** Snapshot bound to this physical readable item on first read; keeps pool draws stable across later reads and content edits. */
  readonly readableText?: string | null;
  readonly managedBy?: 'node-notices';
  readonly managedNoticeKey?: string;
  readonly containerSourceId?: string | null;
  readonly dungeonLocation?: DungeonLocation | null;
  readonly remainsActorId?: string | null;
  readonly corpseId?: string | null;
  readonly ownerActorId: string | null;
  readonly nodeId: string | null;
  readonly generatedAtT: number | null;
  readonly expiresAtT: number | null;
  readonly unique: boolean;
  readonly provisional: boolean;
  readonly lit?: boolean;
  /** Scene object placed by a resident's use action; unlike ordinary ground drops, it cannot be picked up. */
  readonly placed?: boolean;
}

export interface WorldState {
  readonly schemaVersion: 1 | 2;
  readonly mapId?: string;
  readonly sequence: number;
  readonly contentVersion: string;
  readonly worldTimeT: number;
  readonly residentCount?: number;
  readonly seed: string;
  readonly rngState: string;
  readonly actors: Readonly<Record<string, WorldActor>>;
  readonly nodes: Readonly<Record<string, WorldNode>>;
  readonly objects: Readonly<Record<string, WorldObject>>;
  /** Permanent free-text inscriptions for this world session; separate from shared book and bottle pools. */
  readonly monumentValleyInscriptionPool?: readonly MonumentValleyInscription[];
  readonly bootstrapRandomDraws?: readonly RandomDraw[];
  readonly unresolved?: readonly UnresolvedIssue[];
  readonly privateLifeData?: Readonly<Record<string, PrivateLifeRecord>>;
  /** Player-only notes keyed by the public action event ID; never part of event payloads or resident prompts. */
  readonly privateEventIntents?: Readonly<Record<string, string>>;
  readonly surfaceStocks?: SurfaceStockState;
  readonly pendingTradeOffers?: Readonly<Record<string, TradeOfferState>>;
  readonly uniqueOwnerByItemId?: Readonly<Record<string, string>>;
  readonly destroyedNodeNoticeKeys?: readonly string[];
  readonly dungeonRuntime?: DungeonRuntimeState;
}

export interface MonumentValleyInscription {
  readonly id: string;
  readonly poolId: 'monument-valley';
  readonly text: string;
  readonly authorActorId: string;
  readonly createdAtT: number;
}

export interface SurfaceStockState {
  readonly schemaVersion: 1;
  readonly byNode: Readonly<Record<string, number>>;
  readonly advancedThroughDay: number;
}

export interface TradeOfferState {
  readonly offerId: string;
  readonly proposerId: string;
  readonly receiverId: string;
  readonly nodeId: string;
  readonly offeredItemId: string;
  readonly requestedItemId: string;
  readonly createdAtT: number;
  readonly status: 'pending' | 'accepted' | 'rejected';
}

export interface PrivateLifeRecord {
  readonly intents: readonly string[];
  readonly biographyStatus: 'active' | 'pending' | 'complete';
}

export interface RandomDraw {
  readonly sourceId: string;
  readonly stateBefore: string;
  readonly stateAfter: string;
  readonly value: number;
}

export interface WorldEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly worldTimeT: number;
  readonly actorId: string | null;
  readonly nodeId: string | null;
  readonly kind: string;
  readonly visibility: 'public' | 'private' | 'player-only';
  readonly payload: JsonValue;
  readonly randomDraws: readonly RandomDraw[];
}

export interface ActionProposal {
  readonly actorId: string;
  readonly actionId: string;
  readonly timeCostT: 1 | 3;
  readonly payload: JsonValue;
  readonly intent?: string;
  readonly text?: string;
}

export interface ActionDefinition {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly costT: 1 | 3;
  readonly requiresText: boolean;
  readonly payload: JsonValue;
  readonly payloadSchemaKey: string;
}

export interface UnresolvedIssue {
  readonly sourceId: string;
  readonly detail: string;
}

export interface WorldProjection {
  readonly worldTimeT: number;
  readonly phase: 'day' | 'night';
  readonly contentVersion: string;
  readonly actors: readonly WorldActor[];
  readonly nodes: readonly WorldNode[];
  readonly objects: readonly WorldObject[];
  readonly sequence: number;
}

export type ControlRequest =
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'set-speed'; readonly value: number };

export interface ControlState {
  readonly paused: boolean;
  readonly speedMultiplier: number;
}
