import type { WorldState } from './model.ts';

/** True when a lit surface campfire at this Node is still active at the given time. */
export function isNodeCampfireProtected(state: WorldState, nodeId: string | null, timeT: number, isDungeonLocation = false): boolean {
  if (nodeId === null || isDungeonLocation) return false;
  return Object.values(state.objects).some((object) => object.itemId === '營火'
    && object.nodeId === nodeId
    && object.dungeonLocation == null
    && object.lit === true
    && (object.expiresAtT === null || object.expiresAtT > timeT));
}
