import { readCsv, type CsvRow } from './csv.ts';
import { createActiveSurfaceCapabilities, type ActiveSurfaceCapabilities } from './approved-surface-capabilities.ts';

export interface SimulationActionContent {
  readonly foods: readonly CsvRow[];
  readonly equipment: readonly CsvRow[];
  readonly fishing: readonly CsvRow[];
  readonly surface: readonly CsvRow[];
  readonly recovered: readonly CsvRow[];
  readonly monsters: readonly CsvRow[];
  readonly capabilities: ActiveSurfaceCapabilities;
}

/** Reads authoritative tables as text values; action handlers parse only fields they need and keep blanks unresolved. */
export async function loadSimulationActionContent(directory: URL): Promise<SimulationActionContent> {
  const [foods, equipment, fishing, surface, recovered, monsters, nodes] = await Promise.all([
    readCsv(new URL('food.csv', directory)),
    readCsv(new URL('equipment.csv', directory)),
    readCsv(new URL('fishing_pool.csv', directory)),
    readCsv(new URL('surface_exploration.csv', directory)),
    readCsv(new URL('recovered_surface_actions.csv', directory)),
    readCsv(new URL('monsters.csv', directory)),
    readCsv(new URL('island_nodes.csv', directory)),
  ]);
  return { foods, equipment, fishing, surface, recovered, monsters, capabilities: createActiveSurfaceCapabilities(nodes) };
}
