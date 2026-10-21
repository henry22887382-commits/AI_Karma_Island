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
  readonly inventory?: readonly string[];
  readonly equipment?: Readonly<Record<string, string | null>>;
}

export interface ModelBinding {
  readonly slotId: number;
  readonly provider: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly fallbackModels: readonly string[];
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
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

export interface WorldNode {
  readonly id: string;
  readonly label: string | null;
  readonly labelStatus: string;
  readonly visualType: string;
  readonly neighbors: readonly string[];
  readonly safe: boolean | null;
}

export interface WorldObject {
  readonly id: string;
  readonly itemId: string | null;
  readonly objectType?: 'item' | 'corpse';
  readonly remainsActorId?: string | null;
  readonly corpseId?: string | null;
  readonly ownerActorId: string | null;
  readonly nodeId: string | null;
  readonly generatedAtT: number | null;
  readonly expiresAtT: number | null;
  readonly unique: boolean;
  readonly provisional: boolean;
}

export interface WorldState {
  readonly schemaVersion: 1 | 2;
  readonly sequence: number;
  readonly contentVersion: string;
  readonly worldTimeT: number;
  readonly seed: string;
  readonly rngState: string;
  readonly actors: Readonly<Record<string, WorldActor>>;
  readonly nodes: Readonly<Record<string, WorldNode>>;
  readonly objects: Readonly<Record<string, WorldObject>>;
  readonly bootstrapRandomDraws?: readonly RandomDraw[];
  readonly unresolved?: readonly UnresolvedIssue[];
  readonly privateLifeData?: Readonly<Record<string, PrivateLifeRecord>>;
  readonly surfaceStocks?: SurfaceStockState;
  readonly pendingTradeOffers?: Readonly<Record<string, TradeOfferState>>;
  readonly uniqueOwnerByItemId?: Readonly<Record<string, string>>;
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
  readonly status: 'pending';
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
