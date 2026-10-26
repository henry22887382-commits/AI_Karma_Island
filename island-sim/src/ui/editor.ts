import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseCsv } from '../content/csv.ts';
import { LEGACY_START_BEACH_NODE_IDS } from '../content/island.ts';
import { NODE_CLASSIFICATION_BEHAVIOR, environmentTerrainForClassification } from '../domain/node-classification.ts';
import { CENTRAL_CAMPFIRE_NODE_ID, initialCampfireNodeIds as getInitialCampfireNodeIds, MIN_RESIDENT_COUNT } from '../engine/world.ts';
import { renderUiIcon } from './icons.ts';

const headers = {
  nodes: ['node_id', 'node_label', 'label_status', 'region_description', 'image_x_px_approx', 'image_y_px_approx', 'neighbor_count', 'surface_terrain', 'surface_terrain_source', 'day_surface_entry_events_enabled', 'starting_location'],
  edges: ['source_node', 'target_node', 'bidirectional', 'kind', 'evidence'],
  documents: ['document_id', 'pool_type', 'text', 'status'],
  notices: ['node_id', 'document_id'],
} as const;
const persistedNodeColumns = ['node_id', 'visual_type', ...headers.nodes.filter((column) => column !== 'node_id')] as const;
type Row = Record<string, string>;
type Data = { nodes: Row[]; edges: Row[]; documents: Row[]; pools: Row[]; notices: Row[]; mapId?: string; mapName?: string; mapProfiles?: { mapId: string; name: string }[]; initial_campfire_node_ids?: string[]; documentChanges?: { upsert: Row[]; deleteIds: string[] } };
let documentSaveQueue: Promise<void> = Promise.resolve();

function withDocumentSaveLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = documentSaveQueue.then(operation);
  documentSaveQueue = result.then(() => undefined, () => undefined);
  return result;
}
const DEFAULT_RESIDENT_COUNT = 10;

export interface ResidentCountSetting {
  readonly residentCount: number;
}

export async function readResidentCountSetting(root: string): Promise<number> {
  try {
    const saved = JSON.parse(await readFile(resolve(root, 'data/workbench-settings.json'), 'utf8')) as Partial<ResidentCountSetting>;
    const count = saved.residentCount;
    return Number.isSafeInteger(count) && count! >= MIN_RESIDENT_COUNT
      ? count!
      : DEFAULT_RESIDENT_COUNT;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return DEFAULT_RESIDENT_COUNT;
    throw error;
  }
}

export async function writeResidentCountSetting(root: string, residentCount: number): Promise<void> {
  if (!Number.isSafeInteger(residentCount) || residentCount < MIN_RESIDENT_COUNT) {
    throw new RangeError('居民人數必須是正整數。');
  }
  const path = resolve(root, 'data/workbench-settings.json');
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ residentCount }, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

function editorStyles(): string {
  return `
:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
  color: #145b65;
  background: #fff9e9;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --ink: #145b65;
  --muted: #145b65;
  --canvas: #fff9e9;
  --panel: #f5e6bb;
  --card: #fff9e9;
  --surface: var(--panel);
  --surface-soft: var(--card);
  --line: #145b65;
  --frame: #b67c49;
  --ocean: #39c6c3;
  --ocean-hover: #39c6c3;
  --ocean-pressed: #39c6c3;
  --button-ink: #103f46;
  --lagoon: #145b65;
  --brand: var(--ocean);
  --brand-hover: var(--ocean-hover);
  --brand-pressed: var(--ocean-pressed);
  --brand-soft: var(--ocean);
  --focus: #145b65;
  --success: #5b9b49;
  --success-ink: #2e5d24;
  --success-soft: #eaf5e5;
  --warning: #63351f;
  --warning-accent: #f47955;
  --warning-soft: #f5e6bb;
  --danger: #a23d3d;
  --danger-soft: #fbeaea;
  --info: #145b65;
  --info-soft: #fff9e9;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --space-6: 40px;
  --radius: 12px;
  --shadow: 0 8px 24px #1c39300d;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100dvh; color: var(--ink); background: var(--canvas); font: 400 clamp(14px, calc(13.5px + .16vw), 15px)/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif; }
h1, h2, h3, p { margin-top: 0; }
h1 { min-width: 0; margin: 0; font-size: clamp(20px, calc(18px + .5vw), 24px); line-height: 1.2; letter-spacing: -.02em; overflow-wrap: anywhere; }
h2 { min-width: 0; margin: 0 0 var(--space-2); font-size: clamp(18px, calc(16px + .5vw), 22px); line-height: 1.3; overflow-wrap: anywhere; }
h3 { min-width: 0; margin: 0 0 var(--space-2); font-size: clamp(16px, calc(15px + .2vw), 18px); line-height: 1.4; overflow-wrap: anywhere; }
h4 { min-width: 0; margin: 0 0 var(--space-2); font-size: clamp(16px, calc(15px + .2vw), 18px); line-height: 1.4; overflow-wrap: anywhere; }
p { margin-bottom: var(--space-3); }
small, .caption, .brand-copy span, .eyebrow, .count-badge, .status-pill, .document-row span, .text-note, .field-help, .field-error, .status-line, .swatch span, .type-sample span { font-size: clamp(12px, calc(11.5px + .1vw), 13px); line-height: 1.45; }
.caption, .brand-copy span, .field-help, .text-note, .status-line, .swatch span, .type-sample span { color: var(--muted); }
a { color: var(--ink); text-underline-offset: 3px; }
a:hover { color: var(--ink); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.app-header { position: sticky; top: 0; z-index: 5; min-width: 0; min-height: 72px; display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3) clamp(16px, 3vw, 40px); border-bottom: 2px solid var(--frame); background: linear-gradient(105deg, var(--surface), var(--surface-soft)); }
.brand-block { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.brand-mark { display: grid; place-items: center; flex: 0 0 40px; width: 40px; height: 40px; border: 1px solid var(--ink); border-radius: 12px; background: var(--ocean); color: #103f46; font-weight: 800; }
.brand-copy { display: grid; gap: 2px; min-width: 0; }
.brand-copy span { color: var(--muted); }
.app-nav { display: flex; align-items: center; gap: var(--space-2); min-width: 0; max-width: 100%; margin-left: auto; }
.app-nav a { min-width: 0; max-width: 100%; min-height: 40px; display: inline-flex; align-items: center; padding: 8px 12px; border-radius: 8px; color: var(--muted); text-decoration: none; font-size: clamp(14px, calc(13.5px + .12vw), 15px); font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
.app-nav a:hover { background: var(--surface-soft); color: var(--ink); }
.app-nav a[aria-current=page] { background: var(--brand-soft); color: var(--button-ink); }
.ui-icon { width: 16px; height: 16px; flex: 0 0 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vertical-align: -3px; }
.status-pill { display: inline-flex; align-items: center; gap: 8px; flex: 0 1 auto; max-width: 100%; min-width: 0; padding: 7px 10px; border-radius: 999px; background: var(--info-soft); color: var(--info); font-weight: 700; white-space: normal; overflow-wrap: anywhere; }
.status-pill:before { width: 7px; height: 7px; border-radius: 50%; background: currentColor; content: ""; }
.status-pill.is-dirty { border: 1px solid var(--warning-accent); background: var(--warning-soft); color: var(--warning); }
.status-pill.is-saved { border: 1px solid var(--success); background: var(--success-soft); color: var(--success-ink); }
.status-pill.is-saved:before { background: var(--success); }
.status-pill.is-loading { background: var(--info-soft); color: var(--info); }
.status-pill.is-loading:before { display: none; }
.loading-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1.1s ease-in-out infinite alternate; }
@keyframes pulse { to { opacity: .35; transform: scale(.8); } }
.workbench-shell { width: min(1560px, 100%); margin: 0 auto; padding: var(--space-4) clamp(12px, 2.5vw, 36px) var(--space-6); display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--space-3); align-items: start; }
.workbench-tabs { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--space-2); border-bottom: 2px solid var(--frame); }
.workbench-tabs button { min-width: 0; max-width: 100%; min-height: 40px; border-color: var(--frame); border-bottom-color: var(--frame); border-radius: 8px 8px 0 0; background: var(--card); color: var(--ink); white-space: normal; overflow-wrap: anywhere; }
.workbench-tabs button[aria-selected="true"] { border-color: var(--ink); border-bottom-color: var(--ink); background: var(--brand); color: var(--button-ink); }
.workbench-tab-panel { grid-column: 1 / -1; min-width: 0; }
.workbench-tab-panel[hidden] { display: none; }
.text-workspace { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--space-3); align-items: start; }
.panel { min-width: 0; padding: var(--space-3); border: 1px solid var(--frame); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
.library-pane { grid-column: span 3; }
.editor-pane { grid-column: span 6; }
.side-stack { grid-column: span 3; display: grid; gap: var(--space-3); min-width: 0; }
.preview-tools-panel { display: grid; align-content: start; gap: var(--space-3); }
.preview-tools-panel .action-panel { border-top: 1px solid var(--line); padding-top: var(--space-3); }
.node-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
.node-fields > label { align-content: start; }
.node-fields > label.checkbox-field { display: flex; align-items: center; gap: var(--space-2); min-height: 40px; }
.node-fields > label.checkbox-field input[type=checkbox] { width: 18px; min-height: 18px; flex: 0 0 18px; margin: 0; accent-color: var(--brand); }
.map-pane { grid-column: 1 / -1; }
.panel-heading, .preview-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); min-width: 0; margin-bottom: var(--space-3); }
.eyebrow { margin: 0 0 4px; color: var(--ink); font-weight: 750; letter-spacing: .06em; }
.panel-intro { margin: 0; color: var(--muted); font-size: 14px; }
.count-badge { flex: 0 1 auto; max-width: 100%; min-width: 0; padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); white-space: normal; overflow-wrap: anywhere; }
.button, button { min-width: 0; max-width: 100%; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 14px; border: 1px solid var(--ink); border-bottom: 4px solid var(--ink); border-radius: 10px; background: var(--brand); color: var(--button-ink); font: 650 clamp(14px, calc(13.5px + .12vw), 15px)/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: normal; overflow-wrap: anywhere; text-align: center; cursor: pointer; transition: background-color .2s ease, border-color .2s ease, box-shadow .2s ease, transform .2s ease; }
.button:hover, button:hover { background: var(--brand-hover); }
.button:not(.secondary):not(.ghost):not(.danger):active, button:not(.secondary):not(.ghost):not(.danger):active { background: var(--brand); transform: translateY(2px); border-bottom-width: 2px; }
.button:focus-visible, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.button:disabled, button:disabled { border-color: var(--frame); border-bottom-color: var(--frame); background: var(--card); color: var(--muted); cursor: not-allowed; transform: none; }
.button.secondary, button.secondary { border-color: var(--frame); border-bottom-color: var(--frame); background: var(--card); color: var(--ink); }
.button.secondary:hover, button.secondary:hover { border-color: var(--frame); background: var(--panel); }
.button.secondary:active, button.secondary:active, .button.ghost:active, button.ghost:active { border-bottom-width: 2px; transform: translateY(2px); background: var(--panel); }
.button.ghost, button.ghost { border-color: var(--frame); border-bottom-color: var(--frame); background: transparent; color: var(--ink); }
.button.ghost:hover, button.ghost:hover { background: var(--surface-soft); color: var(--ink); }
.button.danger, button.danger { border-color: var(--danger); border-bottom-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
.button.danger:hover, button.danger:hover { background: var(--danger-soft); }
.button-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
label { display: grid; gap: var(--space-1); min-width: 0; color: var(--ink); font-size: clamp(14px, calc(13.5px + .12vw), 15px); font-weight: 650; overflow-wrap: anywhere; }
input, textarea, select { width: 100%; min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid var(--ink); border-radius: 8px; background: var(--surface-soft); color: var(--ink); font: 400 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
input::placeholder, textarea::placeholder { color: var(--muted); opacity: 1; }
input:hover, textarea:hover, select:hover { border-color: var(--ink); }
input:focus, textarea:focus, select:focus { outline: 3px solid #145b6530; border-color: var(--focus); }
input[aria-invalid=true], textarea[aria-invalid=true], select[aria-invalid=true] { border-color: var(--danger); }
input:disabled, textarea:disabled, select:disabled { background: var(--panel); color: var(--muted); cursor: not-allowed; }
.field-error { display: block; color: var(--danger); font-weight: 650; }
.field-help { display: block; color: var(--muted); font-weight: 400; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.form-grid .wide { grid-column: 1 / -1; }
#search { margin-bottom: var(--space-2); }
.document-list { display: grid; gap: var(--space-1); max-height: 52vh; overflow: auto; margin: 0; padding: 0; list-style: none; }
.document-list li { margin: 0; padding: 0; }
.document-row { width: 100%; min-height: auto; display: grid; grid-template-columns: minmax(0, 1fr); justify-content: start; padding: 10px; border-color: transparent; background: transparent; color: var(--ink); text-align: left; }
.document-row:hover { border-color: var(--line); background: var(--surface-soft); }
.document-row[aria-current=true] { border-color: var(--ink); background: var(--brand-soft); color: var(--button-ink); }
.document-row strong { overflow-wrap: anywhere; }
.document-row span { color: var(--muted); font-weight: 500; }
.text-tools { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0; }
.text-note { color: var(--muted); }
#text { width: 100%; min-height: 420px; resize: vertical; padding: 16px; font-size: 14px; line-height: 1.75; tab-size: 2; }
.text-preview { min-height: 120px; max-height: 42vh; overflow: auto; margin: 0; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-soft); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.75; }
.preview-empty { color: var(--muted); font-style: italic; }
.preview-heading { align-items: center; margin-bottom: var(--space-2); }
.map-editor-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--space-3); }
.map-board { grid-column: span 7; min-width: 0; }
.map-controls { grid-column: span 5; min-width: 0; }
.profile-toolbar { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto; gap: var(--space-2); align-items: end; margin: 0 0 var(--space-3); padding: var(--space-3); border: 1px solid var(--frame); border-radius: 10px; background: var(--surface-soft); }
.profile-toolbar label { display: grid; gap: var(--space-1); min-width: 0; }
.profile-toolbar input, .profile-toolbar select { width: 100%; min-width: 0; min-height: 40px; padding: 8px 10px; border: 1px solid var(--ink); border-radius: 8px; background: var(--card); color: var(--ink); }
.map-visual { display: block; width: 100%; height: auto; aspect-ratio: 900 / 820; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); }
.map-visual svg { display: block; width: 100%; height: 100%; }
.map-visual .map-edge { stroke: #758595; stroke-width: 2; }
.map-visual .map-node { cursor: pointer; }
.map-visual .map-node circle { stroke: #26394a; stroke-width: 2; fill: #d9d1a8; }
.map-visual .map-node.terrain-forest circle { fill: #a8c79d; }
.map-visual .map-node.terrain-berry-forest circle { fill: #87b57a; }
.map-visual .map-node.terrain-river circle { fill: #91c7d8; }
.map-visual .map-node.terrain-rock circle { fill: #b7b4b1; }
.map-visual .map-node.terrain-coconut circle { fill: #b7d0a1; }
.map-visual .map-node.terrain-unclassified circle { fill: #d6b4df; }
.map-visual .map-node.is-selected circle { stroke: #102d3b; stroke-width: 4; }
.map-visual .node-id { fill: #17212b; font-size: 12px; font-weight: 750; text-anchor: middle; pointer-events: none; }
.map-visual .node-label { fill: #192a36; font-size: 12px; font-weight: 650; paint-order: stroke; stroke: #f8f7f2; stroke-width: 4px; stroke-linejoin: round; pointer-events: none; }
.map-visual .map-object { font-size: 15px; text-anchor: middle; pointer-events: none; }
.map-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 10px; color: var(--muted); font-size: 12px; }
.map-legend span { white-space: nowrap; }
.map-legend .legend-beach::before, .map-legend .legend-forest::before, .map-legend .legend-berry-forest::before, .map-legend .legend-river::before, .map-legend .legend-rock::before, .map-legend .legend-coconut::before, .map-legend .legend-unclassified::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 5px; border: 1px solid #26394a; border-radius: 50%; }
.map-legend .legend-beach::before { background: #d9d1a8; }
.map-legend .legend-forest::before { background: #a8c79d; }
.map-legend .legend-berry-forest::before { background: #87b57a; }
.map-legend .legend-river::before { background: #91c7d8; }
.map-legend .legend-rock::before { background: #b7b4b1; }
.map-legend .legend-coconut::before { background: #b7d0a1; }
.map-legend .legend-unclassified::before { background: #d6b4df; }
.map { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-2); min-width: 0; max-width: 100%; padding: var(--space-3); border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); }
.node { min-width: 0; min-height: 44px !important; padding: 6px !important; border: 1px solid var(--ink) !important; border-radius: 10px !important; background: var(--card) !important; color: var(--ink) !important; font-size: 14px !important; }
.node:hover { border-color: var(--ink) !important; background: var(--panel) !important; }
.node.is-selected { border-color: var(--ink) !important; background: var(--brand) !important; color: var(--button-ink) !important; box-shadow: 0 0 0 3px #145b652b; }
.selected-node { min-width: 0; margin: var(--space-2) 0 0; padding: 10px 12px; border-radius: 8px; background: var(--panel); color: var(--ink); font-size: clamp(14px, calc(13.5px + .12vw), 15px); font-weight: 650; overflow-wrap: anywhere; }
.divider { height: 1px; margin: var(--space-3) 0; background: var(--line); }
.map-controls .form-grid { margin-bottom: var(--space-3); }
.checkbox-field { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-soft); }
.checkbox-field > * { min-width: 0; }
.checkbox-field input[type=checkbox] { width: 18px; min-height: 18px; margin: 0; accent-color: var(--brand); }
.checkbox-field .field-help { margin-left: auto; }
.hint-box, .notice-box, .warning-box, .error-box { padding: 12px 14px; border-radius: 8px; font-size: 14px; }
.hint-box { background: var(--info-soft); color: var(--info); }
.notice-box { background: var(--success-soft); color: var(--success-ink); }
.warning-box { border: 1px solid var(--warning-accent); border-left: 4px solid var(--warning-accent); background: var(--warning-soft); color: var(--warning); }
.error-box { background: var(--danger-soft); color: var(--danger); }
.hint-box p, .notice-box p, .warning-box p, .error-box p { margin: 0; }
.action-panel { display: grid; gap: var(--space-2); }
.action-panel .button-row > * { flex: 1 1 auto; }
#errors { margin: 0; padding: 12px; border-radius: 8px; background: var(--danger-soft); color: var(--danger); white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.status-line { min-height: 20px; color: var(--muted); }
.ui-kit-page { width: min(1200px, 100%); margin: 0 auto; padding: var(--space-4) clamp(12px, 3vw, 40px) var(--space-6); }
.ui-kit-intro { margin-bottom: var(--space-3); padding: var(--space-4); border: 1px solid var(--frame); border-radius: var(--radius); background: linear-gradient(120deg, var(--card), var(--panel)); color: var(--ink); }
.ui-kit-intro p { margin: 8px 0 0; color: var(--ink); }
.kit-section { margin-bottom: var(--space-3); }
.token-grid, .type-grid, .state-grid, .semantic-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
.swatch, .type-sample { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.swatch-color { height: 56px; margin-bottom: 8px; border: 1px solid #00000010; border-radius: 6px; }
.swatch strong, .swatch span { display: block; }
.swatch span, .type-sample span { color: var(--muted); }
.type-sample span { display: block; }
.state-card { min-height: 108px; display: grid; align-content: start; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
.state-card h3 { color: var(--ink); font-size: 16px; }
.table-wrap { overflow: auto; }
.kit-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.kit-table th, .kit-table td { padding: 12px; border-bottom: 1px solid var(--line); text-align: left; }
.kit-table th { background: var(--surface-soft); color: var(--muted); font-size: 12px; }
.kit-table tbody tr:hover { background: var(--panel); }
.kit-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1120px) { .library-pane { grid-column: span 4; } .editor-pane { grid-column: span 8; } .side-stack { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); } .side-stack .action-panel { grid-column: 1 / -1; } }
@media (max-width: 760px) { .app-header { align-items: flex-start; flex-wrap: wrap; padding: 12px 16px; } .brand-block { flex: 1; } .app-nav { order: 3; width: 100%; margin: 0; } .app-nav a { flex: 1; justify-content: center; } .status-pill { margin-left: auto; } .workbench-shell { gap: 12px; padding: 12px 12px 28px; } .text-workspace { gap: 12px; } .library-pane, .editor-pane, .side-stack, .map-pane { grid-column: 1 / -1; } .side-stack { grid-template-columns: 1fr; } .side-stack .action-panel { grid-column: auto; } .map-editor-grid { grid-template-columns: 1fr; } .map-board, .map-controls { grid-column: 1 / -1; } .form-grid { grid-template-columns: 1fr; } .form-grid .wide { grid-column: auto; } .map { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; padding: 10px; } .node { min-height: 40px !important; padding: 4px !important; } .panel { padding: 16px; } .document-list { max-height: 34vh; } #text { min-height: 320px; } .ui-kit-page { padding: 16px 12px 32px; } .token-grid, .type-grid, .state-grid, .semantic-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .token-grid, .type-grid, .state-grid, .semantic-grid { grid-template-columns: 1fr; } .brand-copy span { max-width: 160px; } .button-row .button, .button-row button { flex: 1 1 auto; } .workbench-tabs button { flex: 1 1 100%; justify-content: flex-start; text-align: left; } .map { gap: 4px; padding: 8px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
`;
}

const workbenchResponsiveStyles = () => `
.editor-workbench .text-mobile-tabs { display: none; }
@media (max-width: 1120px) {
  .editor-workbench .text-workspace { grid-template-columns: minmax(0, 1fr); }
  .editor-workbench .text-mobile-tabs { position: sticky; top: 0; z-index: 3; grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-1); padding: var(--space-2) 0; background: var(--canvas); }
  .editor-workbench .text-mobile-tabs button { min-height: 40px; padding: 8px; border-radius: 8px; }
  .editor-workbench .text-mobile-tabs button[aria-selected="true"] { background: var(--brand); color: var(--button-ink); }
  .editor-workbench .text-workspace > [data-text-pane] { grid-column: 1 / -1; min-width: 0; }
  .editor-workbench .text-workspace[data-text-view="library"] > [data-text-pane]:not([data-text-pane="library"]),
  .editor-workbench .text-workspace[data-text-view="editor"] > [data-text-pane]:not([data-text-pane="editor"]),
  .editor-workbench .text-workspace[data-text-view="side"] > [data-text-pane]:not([data-text-pane="side"]) { display: none; }
  .editor-workbench .side-stack { grid-template-columns: minmax(0, 1fr); }
  .editor-workbench .side-stack .action-panel { grid-column: auto; }
  .editor-workbench .document-list { max-height: none; overflow: visible; }
  .editor-workbench .text-preview { max-height: none; overflow: visible; }
  .editor-workbench #text { min-height: clamp(280px, 48dvh, 520px); max-width: 100%; }
}
@media (max-width: 900px) {
  .editor-workbench .map-editor-grid { grid-template-columns: minmax(0, 1fr); }
  .editor-workbench .map-board, .editor-workbench .map-controls { grid-column: 1 / -1; }
  .editor-workbench .map-board { min-width: 0; }
  .editor-workbench .map { gap: clamp(4px, 1vw, 8px); padding: clamp(8px, 1.5vw, 16px); }
  .editor-workbench .map-controls .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .editor-workbench .map-controls .form-grid .wide { grid-column: 1 / -1; }
  .editor-workbench .map-controls .button-row > button { flex: 1 1 180px; min-width: 0; }
}
@media (max-width: 600px) {
  .editor-workbench .app-header { gap: 8px 12px; padding: 10px 12px; }
  .editor-workbench .brand-block { flex: 1 1 180px; }
  .editor-workbench .app-nav { display: flex; flex-wrap: wrap; gap: 4px; }
  .editor-workbench .app-nav a { flex: 1 1 auto; white-space: nowrap; }
  .editor-workbench .status-pill { margin-left: 0; }
  .editor-workbench .workbench-shell { width: 100%; min-width: 0; padding: 10px 10px 24px; gap: 10px; }
  .editor-workbench .workbench-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .editor-workbench .workbench-tabs button { min-width: 0; justify-content: center; text-align: center; white-space: normal; overflow-wrap: normal; }
  .editor-workbench .text-mobile-tabs { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .editor-workbench .text-mobile-tabs button { min-width: 0; padding-inline: 6px; white-space: normal; }
  .editor-workbench .text-workspace { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .editor-workbench .text-workspace > [data-text-pane] { grid-column: 1 / -1; min-width: 0; }
  .editor-workbench .panel { padding: 12px; }
  .editor-workbench .panel-heading { flex-wrap: wrap; }
  .editor-workbench .form-grid, .editor-workbench .map-controls .form-grid { grid-template-columns: minmax(0, 1fr); }
  .editor-workbench .form-grid .wide, .editor-workbench .map-controls .form-grid .wide { grid-column: 1 / -1; }
  .editor-workbench .text-tools, .editor-workbench .button-row { align-items: stretch; }
  .editor-workbench .text-tools > button, .editor-workbench .button-row > button { flex: 1 1 150px; min-width: 0; white-space: normal; overflow-wrap: normal; }
  .editor-workbench .map-controls .button-row > button { flex-basis: 100%; }
  .editor-workbench .profile-toolbar { grid-template-columns: minmax(0, 1fr); }
  .editor-workbench .map { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; padding: 8px; }
  .editor-workbench .node { min-width: 0; min-height: 38px !important; padding: 2px !important; font-size: 13px !important; }
  .editor-workbench #text { min-height: 50dvh; padding: 12px; }
  .editor-workbench .text-preview { min-height: 120px; overflow-wrap: anywhere; }
}
@media (max-width: 380px) {
  .editor-workbench .workbench-shell { padding-inline: 8px; }
  .editor-workbench .workbench-tabs { grid-template-columns: minmax(0, 1fr); }
  .editor-workbench .map { gap: 3px; padding: 6px; }
  .editor-workbench .node { min-height: 40px !important; font-size: 12px !important; }
  .editor-workbench .map-pane, .editor-workbench .panel { padding: 10px; }
}
`;

export function editorUiKitMarkup(basePath = ''): string {
  const editor = `${basePath.replace(/\/$/, '')}/editor`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>UI Kit｜輪迴島內容工房</title><style>${editorStyles()}</style></head><body>
<header class="app-header"><div class="brand-block"><div class="brand-mark" aria-hidden="true">島</div><div class="brand-copy"><h1>UI Kit 與樣式指南</h1><span>內容工房視覺與互動規範</span></div></div><nav class="app-nav" aria-label="工作台導覽"><a href="${editor}">工作台</a><a href="${editor}/ui-kit" aria-current="page">UI Kit</a></nav></header>
<main class="ui-kit-page"><section class="ui-kit-intro"><p class="eyebrow" style="color:#103f46">DESIGN TOKENS</p><h1>島嶼色彩・清楚狀態・易讀操作</h1><p>熱帶淺海藍、奶油沙面板、深潟湖文字與白沙卡片構成介面基底；成功、提示、警告與錯誤色只表達各自語意。</p></section>
<section class="panel kit-section"><div class="panel-heading"><div><p class="eyebrow">01 · 色彩</p><h2>介面色票</h2></div></div><div class="token-grid"><div class="swatch"><div class="swatch-color" style="background:#39c6c3"></div><strong>熱帶淺海藍</strong><span>品牌與主要操作</span></div><div class="swatch"><div class="swatch-color" style="background:#145b65"></div><strong>深潟湖藍</strong><span>正文與邊框</span></div><div class="swatch"><div class="swatch-color" style="background:#f5e6bb"></div><strong>奶油沙面板</strong><span>主要面板</span></div><div class="swatch"><div class="swatch-color" style="background:#fff9e9"></div><strong>卡片內層</strong><span>高對比內容底色</span></div><div class="swatch"><div class="swatch-color" style="background:#b67c49"></div><strong>次要框架</strong><span>輔助邊框與分隔</span></div><div class="swatch"><div class="swatch-color" style="background:#5b9b49"></div><strong>成功</strong><span>完成與已儲存</span></div><div class="swatch"><div class="swatch-color" style="background:#145b65"></div><strong>提示</strong><span>說明與資訊</span></div><div class="swatch"><div class="swatch-color" style="background:#f47955"></div><strong>警告</strong><span>待處理與未儲存</span></div><div class="swatch"><div class="swatch-color" style="background:#a23d3d"></div><strong>錯誤（獨立語意）</strong><span>無效輸入與失敗</span></div></div></section>
<section class="panel kit-section"><div class="panel-heading"><div><p class="eyebrow">02 · 字體與間距</p><h2>層級和節奏</h2></div></div><div class="type-grid"><div class="type-sample"><strong style="font-size:24px">主標題 24px</strong><span>頁面標題 · 行高 1.2</span></div><div class="type-sample"><strong style="font-size:20px">區塊標題 20px</strong><span>面板標題 · 行高 1.3</span></div><div class="type-sample"><strong style="font-size:14px">正文 14px</strong><span>主要閱讀內容 · 行高 1.55</span></div><div class="type-sample"><strong style="font-size:14px">輔助 14px</strong><span>欄位資訊與次要內容</span></div><div class="type-sample"><strong style="font-size:12px">Caption 12px</strong><span>最小標註字級，不低於 12px</span></div><div class="type-sample"><strong>間距 4 / 8 / 16 / 24 / 32 / 40px</strong><span>以 4px 為基準，常用 8px 倍數</span></div></div></section>
<section class="panel kit-section"><div class="panel-heading"><div><p class="eyebrow">03 · 按鈕狀態</p><h2>操作回饋</h2></div></div><div class="state-grid"><div class="state-card"><h3>主要按鈕</h3><button type="button">一般</button><button type="button" class="secondary">次要</button></div><div class="state-card"><h3>滑過狀態</h3><button type="button" class="button" style="background:var(--brand-hover)">Hover 示意</button></div><div class="state-card"><h3>按下狀態</h3><button type="button" class="button" style="background:var(--brand);transform:translateY(2px);border-bottom-width:2px">Active 示意</button></div><div class="state-card"><h3>停用狀態</h3><button type="button" disabled>目前不可用</button></div></div><p class="field-help" style="margin-top:12px">鍵盤焦點使用高對比外框，可按 Tab 檢視。</p></section>
<section class="panel kit-section"><div class="panel-heading"><div><p class="eyebrow">04 · 表單</p><h2>Placeholder、焦點與錯誤</h2></div></div><div class="form-grid"><label>一般欄位<input placeholder="例如：Node 12"></label><label>鍵盤焦點示意<input value="焦點外框" style="outline:3px solid #145b6555;border-color:var(--focus)"></label><label class="wide">錯誤欄位<input aria-invalid="true" value="無效內容"><span class="field-error">請輸入有效內容，並確認欄位格式。</span></label></div></section>
<section class="panel kit-section"><div class="panel-heading"><div><p class="eyebrow">05 · 提示與狀態</p><h2>語意提示及載入</h2></div></div><div class="semantic-grid"><div class="notice-box"><p>成功 · 已儲存變更</p></div><div class="hint-box"><p>提示 · 這是一則操作說明</p></div><div class="warning-box"><p>警告 · 尚有變更未儲存</p></div><div class="error-box"><p>錯誤 · 目前內容無法保存</p></div></div><p style="margin-top:16px"><span class="status-pill is-loading"><i class="loading-dot" aria-hidden="true"></i>正在載入資料</span></p></section>
<section class="panel kit-section"><div class="panel-heading"><div><p class="eyebrow">06 · 清單</p><h2>表格互動</h2></div></div><div class="table-wrap"><table class="kit-table"><thead><tr><th>文本卡</th><th>文本池</th><th>狀態</th></tr></thead><tbody><tr><td>book-example</td><td>書籍池</td><td>已儲存</td></tr><tr><td>bottle-example</td><td>漂流瓶池</td><td>草稿</td></tr></tbody></table></div><p class="field-help" style="margin-top:12px">滑鼠移至資料列時會顯示柔和底色。</p></section><footer class="kit-footer"><span class="caption">輪迴島內容工房 · UI Kit</span><a href="${editor}">返回工作台</a></footer></main></body></html>`;
}

export function editorMarkup(basePath = ''): string {
  const base = `${basePath.replace(/\/$/, '')}/editor`;
  const mapTerrainColors = Object.fromEntries(Object.keys(NODE_CLASSIFICATION_BEHAVIOR).map((classification) => [
    classification,
    classification === 'coconut-beach' ? 'coconut' : classification === 'berry-forest' ? 'berry-forest' : environmentTerrainForClassification(classification as keyof typeof NODE_CLASSIFICATION_BEHAVIOR),
  ]));
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>輪迴島｜內容工房</title><style>${editorStyles()}${workbenchResponsiveStyles()}</style></head><body class="editor-workbench">
<header class="app-header"><div class="brand-block"><div class="brand-mark" aria-hidden="true">島</div><div class="brand-copy"><h1>輪迴島｜內容工房</h1><span>文本、地圖與連線資料</span></div></div><nav class="app-nav" aria-label="工作台導覽"><a href="${base}" aria-current="page">${renderUiIcon('edit')}工作台</a><a href="${base}/ui-kit">${renderUiIcon('palette')}UI Kit</a></nav><span id="state" class="status-pill is-loading" role="status" aria-live="polite"><span class="loading-dot" aria-hidden="true"></span>載入中</span></header>
<main class="workbench-shell">
<div class="workbench-tabs" role="tablist" aria-label="內容工房工作區"><button type="button" id="workbench-tab-text" role="tab" aria-controls="workbench-panel-text" aria-selected="true" tabindex="0" data-workbench-tab="text">${renderUiIcon('edit')}文本編輯</button><button type="button" id="workbench-tab-map" role="tab" aria-controls="workbench-panel-map" aria-selected="false" tabindex="-1" data-workbench-tab="map">${renderUiIcon('world')}地圖／Node 設定</button><button type="button" id="workbench-tab-saves" role="tab" aria-controls="workbench-panel-saves" aria-selected="false" tabindex="-1" data-workbench-tab="saves">${renderUiIcon('save')}存檔管理</button></div>
<section class="workbench-tab-panel text-workspace" id="workbench-panel-text" role="tabpanel" aria-labelledby="workbench-tab-text" tabindex="0" data-text-view="editor">
<div class="text-mobile-tabs" role="tablist" aria-label="文本工作區"><button type="button" id="text-pane-tab-library" role="tab" aria-controls="text-pane-library" aria-selected="false" tabindex="-1" data-text-pane-tab="library">文本清單</button><button type="button" id="text-pane-tab-editor" role="tab" aria-controls="text-pane-editor" aria-selected="true" tabindex="0" data-text-pane-tab="editor">編輯內容</button><button type="button" id="text-pane-tab-side" role="tab" aria-controls="text-pane-side" aria-selected="false" tabindex="-1" data-text-pane-tab="side">預覽與版本</button></div>
<nav class="panel library-pane" id="text-pane-library" data-text-pane="library" role="tabpanel" aria-labelledby="text-pane-tab-library" tabindex="0" aria-label="文本庫導航"><div class="panel-heading"><div><p class="eyebrow">01 · 文本庫</p><h2>內容導航</h2></div><span class="count-badge" id="documentCount">讀取中</span></div><label for="search">搜尋文本<input id="search" type="search" placeholder="輸入 ID、文字或狀態"></label><ul id="docs" class="document-list" aria-label="文本卡列表"></ul><button type="button" id="newDoc" class="button secondary" style="width:100%" disabled title="請先等候資料載入">${renderUiIcon('add')}新增書籍文本</button><button type="button" id="newInscriptionDoc" class="button secondary" style="width:100%;margin-top:8px" disabled title="請先等候資料載入">${renderUiIcon('add')}新增預設碑文</button><button type="button" id="newSignboardDoc" class="button secondary" style="width:100%;margin-top:8px" disabled title="請先等候資料載入">${renderUiIcon('add')}新增告示牌文本</button></nav>
<section class="panel editor-pane" id="text-pane-editor" data-text-pane="editor" role="tabpanel" aria-labelledby="text-pane-tab-editor" tabindex="0"><div class="panel-heading"><div><p class="eyebrow">02 · 編輯內容</p><h2 id="textEditorTitle">文本卡正文</h2><p class="panel-intro">純文字會原樣保存，空行與換行在預覽中保留。</p></div><span id="currentDoc" class="count-badge">未選取</span></div><div class="form-grid"><label for="pool">文本池<select id="pool" disabled></select></label><label for="status">內容狀態<input id="status" placeholder="例如：draft" disabled></label></div><div class="text-tools" aria-label="純文字排版工具"><button type="button" id="insertLineBreak" class="button secondary" disabled>插入換行</button><button type="button" id="insertParagraphBreak" class="button secondary" disabled>插入段落空行</button><span class="text-note">不解析 Markdown；不會替換或轉換輸入內容。</span></div><label class="sr-only" for="text">文本內容</label><textarea id="text" rows="18" placeholder="在此輸入文本內容" disabled></textarea><div class="button-row" style="margin-top:16px"><button type="button" id="saveDoc" class="button" disabled>${renderUiIcon('save')}套用文本卡</button><button type="button" id="delDoc" class="button danger" disabled>刪除文本卡</button></div><p class="field-help">先按「套用文本卡」將欄位內容套入本頁編輯資料；再按「儲存地圖存檔」保存地圖及已套用的文本變更。套用文本卡本身不會寫入存檔。</p></section>
<aside class="side-stack" id="text-pane-side" data-text-pane="side" role="tabpanel" aria-labelledby="text-pane-tab-side" tabindex="0" aria-label="文本預覽與版本工具"><section class="panel preview-tools-panel"><div class="preview-heading"><div><p class="eyebrow">即時預覽</p><h2>純文字呈現</h2></div><span class="count-badge">保留換行</span></div><pre id="preview" class="text-preview preview-empty">選取文本卡以預覽</pre><div class="action-panel"><div><p class="eyebrow">編輯狀態</p><h2>變更與版本</h2><p class="panel-intro">復原與重做只調整本頁編輯資料；文本卡與地圖變更都需按地圖工作區中的「儲存地圖存檔」才會寫入存檔。</p></div><div class="button-row"><button type="button" id="undo" class="button secondary" disabled>復原</button><button type="button" id="redo" class="button secondary" disabled>重做</button></div><div class="button-row"><button type="button" id="export" class="button ghost" disabled title="請先等候資料載入">${renderUiIcon('download')}匯出 JSON</button><button type="button" id="import" class="button ghost" disabled title="請先等候資料載入">${renderUiIcon('upload')}匯入 JSON</button></div><input type="file" id="file" accept="application/json,.json" hidden><div id="errors" class="error-box" role="alert" hidden></div></div></section></aside>
</section>
<section class="workbench-tab-panel map-workspace" id="workbench-panel-map" role="tabpanel" aria-labelledby="workbench-tab-map" tabindex="0" hidden>
<section class="panel map-pane" aria-labelledby="mapEditorTitle"><div class="profile-toolbar" aria-label="地圖存檔管理"><label for="mapProfile">地圖存檔<select id="mapProfile"></select></label><label for="mapName">地圖名稱<input id="mapName" maxlength="80" placeholder="輸入地圖名稱"></label><button type="button" id="newMapProfile" class="button secondary">另存新地圖</button><button type="button" id="save" class="button" disabled title="請先等候資料載入">${renderUiIcon('save')}儲存地圖存檔</button><span id="saveFeedback" class="status-line" role="status" aria-live="polite">所有編輯都先保留在此頁。</span></div><div class="panel-heading"><div><p class="eyebrow">03 · 地圖設定</p><h2 id="mapEditorTitle">Node 與連線</h2><p class="panel-intro">地形與遊戲分類會決定地表活動、環境事件、椰子產能與特殊地點功能。</p></div><span class="count-badge">地表節點</span></div><div class="map-editor-grid"><div class="map-board"><div id="nodes" class="map-visual" role="group" aria-label="選取地圖 Node"></div><div class="map-legend" aria-label="地圖圖例"><span class="legend-beach">沙灘</span><span class="legend-forest">森林</span><span class="legend-berry-forest">莓果森林</span><span class="legend-river">河流</span><span class="legend-rock">岩石</span><span class="legend-coconut">椰子沙灘</span><span class="legend-unclassified">未分類</span><span>⌖ 出生點</span><span>🔥 營火</span><span>▤ 告示牌</span></div><p id="selected" class="selected-node" role="status">請先選取 Node；地圖操作按鈕會在選取後啟用。</p></div><div class="map-controls"><div class="form-grid node-fields"><label for="selectedNode">目前編輯 Node<select id="selectedNode"></select></label><label for="label">地點名稱<input id="label" placeholder="可留空"></label><label for="terrain">地形與遊戲分類<select id="terrain"><option value="beach">沙灘</option><option value="coconut-beach">椰子沙灘（每日產椰）</option><option value="forest">森林</option><option value="berry-forest">莓果森林（可採莓）</option><option value="river">河流</option><option value="rock">岩石</option><option value="dungeon-entrance">地牢入口</option><option value="port">港口</option><option value="monument-valley">紀念碑谷</option><option value="unclassified">無／未分類</option></select></label><label for="startingLocation" class="checkbox-field">新局出生點<input id="startingLocation" type="checkbox"></label><label for="region" class="wide">區域描述<input id="region" placeholder="來源提供的區域說明"></label><label for="labelStatus">地點名稱狀態<input id="labelStatus" placeholder="保留來源狀態"></label><label>白天地表進入事件<span id="daySurfaceEntryEventsStatus">由地形決定</span></label></div><div class="hint-box" style="margin-bottom:16px"><p>特殊地形的規則由地形與遊戲分類直接決定；港口和紀念碑谷不觸發白天進入事件。</p></div><div class="button-row"><button type="button" id="nodeEdit" class="button secondary" disabled>套用 Node 變更</button><button type="button" id="position" class="button secondary" disabled>套用地圖位置</button></div><div class="form-grid" style="margin-top:16px"><label for="x">原圖 X 座標<input id="x" type="number" placeholder="選取 Node"></label><label for="y">原圖 Y 座標<input id="y" type="number" placeholder="選取 Node"></label><label for="notice" class="wide">告示文本卡<select id="notice"></select></label></div><div class="button-row"><button type="button" id="bind" class="button secondary" disabled>綁定／解除告示</button></div><div class="divider"></div><div class="form-grid"><label for="target">連線目標 Node<select id="target"></select></label><div style="align-self:end"><button type="button" id="edge" class="button secondary" disabled>切換連線</button></div></div></div></div></section>
</section>
<section class="workbench-tab-panel" id="workbench-panel-saves" role="tabpanel" aria-labelledby="workbench-tab-saves" tabindex="0" hidden>
<section class="panel"><div class="panel-heading"><div><p class="eyebrow">04 · 遊戲存檔</p><h2>存檔管理</h2><p class="panel-intro">刪除只影響指定存檔，當局與其他存檔會保留。</p></div><span id="saveCount" class="count-badge">讀取中</span></div><div class="button-row" style="margin-bottom:16px"><button type="button" id="refreshSaves" class="button secondary">刷新清單</button></div><p id="saveManagerStatus" class="status-line" role="status" aria-live="polite"></p><div class="table-wrap"><table class="kit-table"><thead><tr><th>存檔名稱</th><th>所屬當局</th><th>儲存時間</th><th>事件數</th><th>操作</th></tr></thead><tbody id="saveRows"><tr><td colspan="5">讀取中…</td></tr></tbody></table></div></section>
</section>
</main><script>const base=${JSON.stringify(base)}, mapTerrainColors=${JSON.stringify(mapTerrainColors)}, legacyStartBeachNodeIds=${JSON.stringify(LEGACY_START_BEACH_NODE_IDS)}, centralCampfireNodeId=${JSON.stringify(CENTRAL_CAMPFIRE_NODE_ID)}, api=(p,init)=>fetch(base+'/api/editor'+p,init);let data,selected='',doc='',history=[],future=[],dirty=false,originalDocuments=[];
const workbenchTabs=[...document.querySelectorAll('[role="tab"][data-workbench-tab]')];function activateWorkbenchTab(id){const active=workbenchTabs.find(tab=>tab.dataset.workbenchTab===id);if(!active)return;if(id==='saves')loadSaves();workbenchTabs.forEach(tab=>{const selected=tab===active;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;const panel=document.getElementById(tab.getAttribute('aria-controls'));if(panel)panel.hidden=!selected})}document.addEventListener('click',event=>{const tab=event.target.closest('[role="tab"][data-workbench-tab]');if(!tab)return;event.preventDefault();activateWorkbenchTab(tab.dataset.workbenchTab)});document.addEventListener('keydown',event=>{const tab=event.target.closest('[role="tab"][data-workbench-tab]');if(!tab)return;let index=workbenchTabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%workbenchTabs.length;else if(event.key==='ArrowLeft')index=(index-1+workbenchTabs.length)%workbenchTabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=workbenchTabs.length-1;else return;event.preventDefault();workbenchTabs[index].focus();activateWorkbenchTab(workbenchTabs[index].dataset.workbenchTab)});
async function loadSaves(){const rows=document.getElementById('saveRows'),status=document.getElementById('saveManagerStatus');status.textContent='正在讀取存檔…';try{const response=await api('/saves');const body=await response.json();if(!response.ok)throw Error(body.error||'存檔讀取失敗');rows.replaceChildren();const saves=body.saves||[];document.getElementById('saveCount').textContent=saves.length+' 筆';for(const save of saves){const row=document.createElement('tr');for(const value of [save.name,save.sessionName,new Date(save.savedAt).toLocaleString('zh-TW'),String(save.sequence)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}const action=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='button danger';button.textContent='刪除';button.setAttribute('aria-label','刪除存檔 '+save.name);button.onclick=async()=>{if(!confirm('確定刪除「'+save.name+'」？此操作無法復原。'))return;button.disabled=true;try{const result=await api('/saves',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({saveId:save.saveId})});const outcome=await result.json();if(!result.ok)throw Error(outcome.error||'刪除失敗');await loadSaves();status.textContent='已刪除存檔「'+save.name+'」。'}catch(error){button.disabled=false;status.textContent=error.message}};action.append(button);row.append(action);rows.append(row)}if(!saves.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='目前沒有存檔。';row.append(cell);rows.append(row)}status.textContent='清單已更新。'}catch(error){status.textContent=error.message}}
document.getElementById('refreshSaves').onclick=loadSaves;
const textPaneTabs=[...document.querySelectorAll('[role="tab"][data-text-pane-tab]')];function activateTextPane(id){const workspace=document.querySelector('#workbench-panel-text');const active=textPaneTabs.find(tab=>tab.dataset.textPaneTab===id);if(!workspace||!active)return;workspace.dataset.textView=id;textPaneTabs.forEach(tab=>{const selected=tab===active;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1})}document.addEventListener('click',event=>{const tab=event.target.closest('[role="tab"][data-text-pane-tab]');if(!tab)return;event.preventDefault();activateTextPane(tab.dataset.textPaneTab)});document.addEventListener('keydown',event=>{const tab=event.target.closest('[role="tab"][data-text-pane-tab]');if(!tab)return;let index=textPaneTabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%textPaneTabs.length;else if(event.key==='ArrowLeft')index=(index-1+textPaneTabs.length)%textPaneTabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=textPaneTabs.length-1;else return;event.preventDefault();textPaneTabs[index].focus();activateTextPane(textPaneTabs[index].dataset.textPaneTab)});
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));function updatePreview(value){$('preview').textContent=value||'（空白文本）';$('preview').className='text-preview'+(value?'':' preview-empty')}function insertPlainText(value){let editor=$('text');editor.setRangeText(value,editor.selectionStart,editor.selectionEnd,'end');editor.focus();updatePreview(editor.value)}function mark(){dirty=true;$('state').textContent='未儲存變更';$('state').className='status-pill is-dirty';$('saveFeedback').textContent='有尚未儲存的變更。'}function change(fn){history.push(clone(data));future=[];fn();mark();render();syncActionStates()}
function render(){if(!data)return;$('docs').replaceChildren();data.documents.filter(d=>(d.text+d.document_id+d.status).toLowerCase().includes($('search').value.toLowerCase())).forEach(d=>{let li=document.createElement('li'),button=document.createElement('button'),title=document.createElement('strong'),meta=document.createElement('span');button.type='button';button.className='document-row';button.setAttribute('aria-current',String(d.document_id===doc));title.textContent=d.document_id;meta.textContent=d.pool_type+' · '+d.status;button.append(title,meta);button.onclick=()=>selectDoc(d.document_id);li.append(button);$('docs').append(li)});$('documentCount').textContent=data.documents.length+' 張';$('currentDoc').textContent=doc||'未選取';$('mapProfile').innerHTML=(data.mapProfiles||[]).map(p=>'<option value="'+esc(p.mapId)+'">'+esc(p.name)+'</option>').join('');$('mapProfile').value=data.mapId||'default-map';if(document.activeElement!==$('mapName'))$('mapName').value=data.mapName||'';$('selectedNode').innerHTML='<option value="">選取 Node</option>'+data.nodes.map(n=>'<option value="'+esc(n.node_id)+'">'+esc(n.node_id+' · '+(n.node_label||('Node '+n.node_id)))+'</option>').join('');$('selectedNode').value=selected;const nodesById=new Map(data.nodes.map(n=>[n.node_id,n]));const mapTerrainNames={beach:'沙灘','coconut-beach':'椰子沙灘',forest:'森林','berry-forest':'莓果森林',river:'河流',rock:'岩石','dungeon-entrance':'地牢入口',port:'港口','monument-valley':'紀念碑谷',unclassified:'未分類'};const point=n=>({x:Number(n.image_x_px_approx)||0,y:Number(n.image_y_px_approx)||0});const edgeMarkup=data.edges.map(e=>{const a=nodesById.get(e.source_node),b=nodesById.get(e.target_node);if(!a||!b)return '';const p=point(a),q=point(b);return '<line class="map-edge" x1="'+p.x+'" y1="'+p.y+'" x2="'+q.x+'" y2="'+q.y+'" />'}).join('');const nodeMarkup=data.nodes.map(n=>{const p=point(n),label=n.node_label||('Node '+n.node_id),terrain=n.surface_terrain||'unclassified';const terrainClass='terrain-'+(mapTerrainColors[terrain]||'unclassified'),startingLocation=n.starting_location==='true',campfire=(data.initial_campfire_node_ids||[]).includes(n.node_id),notice=data.notices.some(item=>item.node_id===n.node_id);const objectTitle=(startingLocation?'出生點':'')+(startingLocation&&(campfire||notice)?'、':'')+(campfire?'營火':'')+(campfire&&notice?'、':'')+(notice?'告示牌':'');return '<g class="map-node '+terrainClass+(n.node_id===selected?' is-selected':'')+'" role="button" tabindex="0" aria-label="Node '+esc(n.node_id)+'：'+esc(label)+'，'+esc(mapTerrainNames[terrain]||terrain)+(objectTitle?'，'+esc(objectTitle):'')+'" aria-pressed="'+(n.node_id===selected)+'" data-node-id="'+esc(n.node_id)+'"><title>'+esc(label+' · '+(mapTerrainNames[terrain]||terrain)+(objectTitle?' · '+objectTitle:''))+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="14" /><text class="node-id" x="'+p.x+'" y="'+(p.y+4)+'">'+esc(n.node_id)+'</text><text class="node-label" x="'+(p.x+17)+'" y="'+(p.y-8)+'">'+esc(label)+'</text>'+(startingLocation?'<text class="map-object" x="'+(p.x-9)+'" y="'+(p.y+25)+'">⌖</text>':'')+(campfire?'<text class="map-object" x="'+(p.x+9)+'" y="'+(p.y+25)+'">🔥</text>':'')+(notice?'<text class="map-object" x="'+(p.x+28)+'" y="'+(p.y+25)+'">▤</text>':'')+'</g>'}).join('');$('nodes').innerHTML='<svg viewBox="0 0 900 820" aria-label="Node 地圖、地形與連線">'+edgeMarkup+nodeMarkup+'</svg>';$('nodes').onclick=event=>{const node=event.target.closest('[data-node-id]');if(node)selectNode(node.dataset.nodeId)};$('nodes').onkeydown=event=>{if(event.key!=='Enter'&&event.key!==' ')return;const node=event.target.closest('[data-node-id]');if(!node)return;event.preventDefault();selectNode(node.dataset.nodeId)};$('pool').innerHTML=data.pools.map(p=>'<option value="'+esc(p.pool_type)+'">'+esc(p.pool_type)+'</option>').join('');$('pool').value=data.documents.find(d=>d.document_id===doc)?.pool_type||'';$('notice').innerHTML='<option value="">未綁定</option>'+data.documents.filter(d=>d.pool_type==='signboard').map(d=>'<option value="'+esc(d.document_id)+'">'+esc(d.document_id)+'</option>').join('');$('notice').value=data.notices.find(item=>item.node_id===selected)?.document_id||'';$('target').innerHTML=data.nodes.map(n=>'<option>'+esc(n.node_id)+'</option>').join('');let n=data.nodes.find(x=>x.node_id===selected);let terrainNames={beach:'沙灘','coconut-beach':'椰子沙灘',forest:'森林','berry-forest':'莓果森林',river:'河流',rock:'岩石','dungeon-entrance':'地牢入口',port:'港口','monument-valley':'紀念碑谷',unclassified:'無／未分類'};$('selected').textContent=n?'Node '+n.node_id+' · 地點：'+(n.node_label||('Node '+n.node_id))+' · 地形與遊戲：'+(terrainNames[n.surface_terrain]||'無／未分類')+' · 告示 '+(data.notices.find(x=>x.node_id===n.node_id)?.document_id||'未綁定'):'';$('x').value=n?.image_x_px_approx||'';$('y').value=n?.image_y_px_approx||'';$('label').value=n?.node_label||'';$('terrain').value=n?.surface_terrain||'';$('terrain').onchange=()=>{if(!n)return;const terrain=$('terrain').value||'unclassified';change(()=>{n.surface_terrain=terrain})};$('region').value=n?.region_description||'';$('labelStatus').value=n?.label_status||'';$('startingLocation').checked=n?.starting_location==='true';$('startingLocation').onchange=()=>{if(!n)return;change(()=>{n.starting_location=$('startingLocation').checked?'true':'false';data.initial_campfire_node_ids=[...new Set([...data.nodes.filter(x=>x.starting_location==='true').map(x=>x.node_id),centralCampfireNodeId])]})};daySurfaceEntryEventsStatus.textContent=['beach','coconut-beach','forest','berry-forest','river','rock','dungeon-entrance'].includes(n?.surface_terrain||'')?'啟用':'不啟用';updatePreview(doc?$('text').value:'選取文本卡預覽');let errors=validate();$('errors').textContent=errors.join('\\n');$('errors').hidden=errors.length===0}
function normalizeStartingLocations(value){value.notices=value.notices||[];value.nodes=value.nodes.map(n=>({...n,starting_location:n.starting_location??(legacyStartBeachNodeIds.includes(n.node_id)?'true':'false')}));value.initial_campfire_node_ids=[...new Set([...value.nodes.filter(n=>n.starting_location==='true').map(n=>n.node_id),centralCampfireNodeId])];return value}function syncActionStates(){const hasDoc=Boolean(doc&&data.documents.some(item=>item.document_id===doc)),hasNode=Boolean(selected&&data.nodes.some(node=>node.node_id===selected));$('newDoc').disabled=false;$('newInscriptionDoc').disabled=false;$('newSignboardDoc').disabled=false;$('save').disabled=false;$('export').disabled=false;$('import').disabled=false;$('pool').disabled=!hasDoc;$('status').disabled=!hasDoc;$('text').disabled=!hasDoc;$('insertLineBreak').disabled=!hasDoc;$('insertParagraphBreak').disabled=!hasDoc;$('saveDoc').disabled=!hasDoc;$('delDoc').disabled=!hasDoc;$('undo').disabled=history.length===0;$('redo').disabled=future.length===0;$('nodeEdit').disabled=!hasNode;$('position').disabled=!hasNode;$('bind').disabled=!hasNode;$('edge').disabled=!hasNode||!$('target').value||$('target').value===selected}
function selectDoc(id){doc=id;let d=data.documents.find(x=>x.document_id===id);$('pool').value=d.pool_type;$('status').value=d.status;$('text').value=d.text;render();syncActionStates()}function selectNode(id){selected=id;$('target').value=id;render();syncActionStates()}function validate(){let e=[],ids=new Set(data.nodes.map(n=>n.node_id)),startingNodes=data.nodes.filter(n=>n.starting_location==='true');if(startingNodes.length===0)e.push('至少要設定一個新局出生點');for(const n of startingNodes)if(!['beach','coconut'].includes(mapTerrainColors[n.surface_terrain]))e.push('Node '+n.node_id+' 設為出生點時，地形必須是沙灘或椰子沙灘');for(let i=0;i<startingNodes.length;i++)for(let j=i+1;j<startingNodes.length;j++){const a=startingNodes[i].node_id,b=startingNodes[j].node_id;if(data.edges.some(x=>x.source_node===a&&x.target_node===b||x.source_node===b&&x.target_node===a))e.push('出生點 Node '+a+' 與 '+b+' 不能相鄰')}data.edges.forEach(x=>{if(!ids.has(x.source_node)||!ids.has(x.target_node))e.push('連線 '+x.source_node+' → '+x.target_node+'：Node 不存在')});const documentIds=new Set();data.documents.forEach(x=>{if(!x.document_id)e.push('文本卡缺少 ID');else if(documentIds.has(x.document_id))e.push('文本卡 ID 重複：'+x.document_id);documentIds.add(x.document_id)});data.notices.forEach(x=>{if(!ids.has(x.node_id))e.push('告示綁定找不到 Node '+x.node_id);const d=data.documents.find(d=>d.document_id===x.document_id);if(!d||d.pool_type!=='signboard'||!String(d.text??'').trim())e.push('告示綁定須使用已填寫的告示牌文本：'+x.document_id)});return e}function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function load(mapId){try{let r=await api('/data'+(mapId?'?mapId='+encodeURIComponent(mapId):''));if(!r.ok)throw Error('資料載入失敗');data=normalizeStartingLocations(await r.json());originalDocuments=clone(data.documents);dirty=false;history=[];future=[];render();syncActionStates();$('state').textContent='已載入';$('state').className='status-pill is-saved'}catch(error){$('state').textContent='載入失敗';$('state').className='status-pill is-dirty';$('errors').textContent=error.message;$('errors').hidden=false}}$('target').onchange=syncActionStates;$('mapProfile').onchange=()=>{if((dirty||$('mapName').value.trim()!==data.mapName)&&!confirm('目前地圖有未儲存變更，確定切換？')){$('mapProfile').value=data.mapId;return}load($('mapProfile').value)};$('newMapProfile').onclick=()=>{const name=prompt('新地圖名稱','地圖副本');if(!name?.trim())return;data.mapId='';data.mapName=name.trim();$('mapName').value=data.mapName;$('save').click()};$('selectedNode').onchange=()=>{if($('selectedNode').value)selectNode($('selectedNode').value)};$('search').oninput=render;$('text').oninput=()=>updatePreview($('text').value);$('insertLineBreak').onclick=()=>insertPlainText('\\n');$('insertParagraphBreak').onclick=()=>insertPlainText('\\n\\n');$('newDoc').onclick=()=>{let id='note-'+crypto.randomUUID();change(()=>data.documents.push({document_id:id,pool_type:'book',text:'',status:'draft'}));doc=id;selectDoc(id)};$('newInscriptionDoc').onclick=()=>{let id='monument-valley-'+crypto.randomUUID();change(()=>data.documents.push({document_id:id,pool_type:'monument-valley',text:'',status:'draft'}));doc=id;selectDoc(id)};$('newSignboardDoc').onclick=()=>{let id='signboard-'+crypto.randomUUID();change(()=>data.documents.push({document_id:id,pool_type:'signboard',text:'',status:'draft'}));doc=id;selectDoc(id)};$('saveDoc').onclick=()=>{if(!doc)return;change(()=>Object.assign(data.documents.find(d=>d.document_id===doc),{pool_type:$('pool').value,text:$('text').value,status:$('status').value}))};$('delDoc').onclick=()=>{if(!doc)return;change(()=>{data.documents=data.documents.filter(d=>d.document_id!==doc);data.notices=data.notices.filter(n=>n.document_id!==doc)});doc='';$('text').value='';render();syncActionStates()};$('bind').onclick=()=>{if(!selected)return;const selectedDocumentId=$('notice').value;change(()=>{const currentBinding=data.notices.find(n=>n.node_id===selected);data.notices=data.notices.filter(n=>n.node_id!==selected);if(selectedDocumentId&&currentBinding?.document_id!==selectedDocumentId)data.notices.push({node_id:selected,document_id:selectedDocumentId})})};$('nodeEdit').onclick=()=>{let n=data.nodes.find(x=>x.node_id===selected);if(!n)return;const terrain=$('terrain').value||'unclassified';change(()=>Object.assign(n,{node_label:$('label').value,surface_terrain:terrain,region_description:$('region').value,label_status:$('labelStatus').value,starting_location:$('startingLocation').checked?'true':'false'}))};$('position').onclick=()=>{let n=data.nodes.find(x=>x.node_id===selected);if(!n)return;change(()=>Object.assign(n,{image_x_px_approx:$('x').value,image_y_px_approx:$('y').value}))};$('edge').onclick=()=>{let target=$('target').value;if(!selected||target===selected)return;change(()=>{let i=data.edges.findIndex(e=>e.source_node===selected&&e.target_node===target||e.source_node===target&&e.target_node===selected);if(i>=0)data.edges.splice(i,1);else data.edges.push({source_node:selected,target_node:target,bidirectional:'true',kind:'editor_link',evidence:'editor'})})};$('undo').onclick=()=>{if(history.length){future.push(clone(data));data=history.pop();mark();render();syncActionStates()}};$('redo').onclick=()=>{if(future.length){history.push(clone(data));data=future.pop();mark();render();syncActionStates()}};$('save').onclick=async()=>{const button=$('save');data.mapName=$('mapName').value.trim();if(!data.mapName){$('errors').textContent='請輸入地圖名稱。';$('errors').hidden=false;return}const errors=validate();if(errors.length){$('errors').textContent=errors.join('\\n');$('errors').hidden=false;return}button.disabled=true;$('saveFeedback').textContent='正在儲存地圖…';try{const originalById=new Map(originalDocuments.map(item=>[item.document_id,item]));const documentChanges={upsert:data.documents.filter(item=>JSON.stringify(item)!==JSON.stringify(originalById.get(item.document_id))),deleteIds:originalDocuments.filter(item=>!data.documents.some(current=>current.document_id===item.document_id)).map(item=>item.document_id)};const saved=await api('/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,documentChanges})});const out=await saved.json();if(!saved.ok)throw Error(out.error||'地圖儲存失敗');data.mapId=out.mapId;data.mapName=out.mapName;data.mapProfiles=[...(data.mapProfiles||[]).filter(item=>item.mapId!==out.mapId),{mapId:out.mapId,name:out.mapName}];let option=[...$('mapProfile').options].find(item=>item.value===out.mapId);if(!option){option=document.createElement('option');option.value=out.mapId;$('mapProfile').append(option)}option.textContent=out.mapName;$('mapProfile').value=out.mapId;originalDocuments=clone(data.documents);dirty=false;$('state').textContent='已儲存';$('state').className='status-pill is-saved';$('saveFeedback').textContent='已儲存地圖：'+out.mapName;$('errors').hidden=true;history=[];future=[]}catch(error){dirty=true;$('state').textContent='儲存失敗（編輯仍保留）';$('state').className='status-pill is-dirty';$('saveFeedback').textContent='儲存失敗，編輯仍保留；修正連線後可重試。';$('errors').textContent='地圖未儲存，編輯內容仍保留。'+(error instanceof Error?'\\n'+error.message:'');$('errors').hidden=false}finally{button.disabled=false;syncActionStates()}};$('export').onclick=()=>{const exported={...data,nodes:data.nodes.map(node=>Object.fromEntries(Object.entries(node).filter(([key])=>key!=='visual_type')))};download(JSON.stringify(exported,null,2),'island-editor.json','application/json')};$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{let f=$('file').files[0];if(!f)return;try{let v=JSON.parse(await f.text());if(!v.nodes||!v.edges||!v.documents)throw Error('格式不符');change(()=>data=normalizeStartingLocations(v))}catch(e){$('errors').textContent=e.message;$('errors').hidden=false}};function download(s,n,t){let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([s],{type:t}));a.download=n;a.click()}load();
</script></html>`;
}

export function editorBasePath(): string { return process.env.ISLAND_EDITOR_BASE_PATH ?? ''; }

export async function readEditorData(root: string): Promise<Data> {
  const tables = resolve(root, 'references/tables');
  const [nodes, edges, documents, notices] = await Promise.all([
    readTable(resolve(tables, 'island_nodes.csv')),
    readTable(resolve(tables, 'island_edges.csv')),
    readTable(resolve(tables, 'readable_documents.csv')),
    readOptional(resolve(tables, 'node_notices.csv'), headers.notices),
  ]);
  const pools = await readTable(resolve(tables, 'readable_document_pools.csv'));
  const nodesWithStartingLocations: Row[] = nodes.map((node): Row => ({
    ...node,
    starting_location: node.starting_location ?? (LEGACY_START_BEACH_NODE_IDS.includes(node.node_id as typeof LEGACY_START_BEACH_NODE_IDS[number]) ? 'true' : 'false'),
  }));
  const initialCampfireNodeIds = getInitialCampfireNodeIds(nodesWithStartingLocations.map((node) => {
    if (!node.node_id) throw new Error('地圖資料列缺少 Node ID。');
    return { id: node.node_id, isStartingLocation: node.starting_location === 'true' };
  }));
  return { nodes: nodesWithStartingLocations, edges, documents, pools, notices, initial_campfire_node_ids: initialCampfireNodeIds };
}

export async function saveEditorData(root: string, value: Data): Promise<string> {
  const errors = validateData(value);
  if (errors.length) throw new Error(errors.join('\n'));
  const tables = resolve(root, 'references/tables');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = resolve(root, 'data/editor-backups', stamp);
  await mkdir(backup, { recursive: true });
  for (const name of ['island_nodes.csv', 'island_edges.csv', 'readable_documents.csv', 'node_notices.csv']) await copyFile(resolve(tables, name), resolve(backup, name));
  const sourceNodes = await readTable(resolve(tables, 'island_nodes.csv'));
  const legacyVisualTypes = new Map(sourceNodes.map((node) => [node.node_id, node.visual_type ?? '']));
  const persistedNodes = value.nodes.map((node) => ({ ...node, visual_type: legacyVisualTypes.get(node.node_id) ?? node.visual_type ?? '' }));
  await writeTable(resolve(tables, 'island_nodes.csv'), persistedNodeColumns, persistedNodes);
  await writeTable(resolve(tables, 'island_edges.csv'), headers.edges, value.edges);
  if (value.documentChanges) await saveEditorDocumentChanges(root, value.documentChanges);
  else await saveEditorDocuments(root, value.documents);
  await writeTable(resolve(tables, 'node_notices.csv'), headers.notices, value.notices);
  return backup;
}

export async function saveEditorDocuments(root: string, documents: readonly Record<string, string>[]): Promise<string> {
  return withDocumentSaveLock(async () => {
    const tables = resolve(root, 'references/tables');
    const documentPath = resolve(tables, 'readable_documents.csv');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = resolve(root, 'data/editor-backups', stamp);
    await mkdir(backup, { recursive: true });
    await copyFile(documentPath, resolve(backup, 'readable_documents.csv'));
    await writeTable(documentPath, headers.documents, documents);
    return backup;
  });
}

export async function saveEditorDocumentChanges(
  root: string,
  changes: { readonly upsert: readonly Record<string, string>[]; readonly deleteIds: readonly string[] },
): Promise<string> {
  const upsertIds = changes.upsert.map((document) => document.document_id);
  if (upsertIds.some((id) => !id)) throw new Error('文本卡缺少 document_id，沒有儲存任何變更。');
  if (new Set(upsertIds).size !== upsertIds.length) throw new Error('同一批文本卡 ID 重複，沒有儲存任何變更。');

  return withDocumentSaveLock(async () => {
    const tables = resolve(root, 'references/tables');
    const documentPath = resolve(tables, 'readable_documents.csv');
    const currentDocuments = await readTable(documentPath);
    const upsertIdSet = new Set(upsertIds);
    const deleteIds = new Set(changes.deleteIds.filter((id) => !upsertIdSet.has(id)));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = resolve(root, 'data/editor-backups', stamp);
    await mkdir(backup, { recursive: true });
    await copyFile(documentPath, resolve(backup, 'readable_documents.csv'));

    if (changes.upsert.length > 0 || deleteIds.size > 0) {
      const merged = currentDocuments.filter((document) => {
        const documentId = document.document_id;
        return documentId === undefined || !deleteIds.has(documentId);
      });
      for (const document of changes.upsert) {
        const index = merged.findIndex((current) => current.document_id === document.document_id);
        if (index < 0) merged.push(document);
        else merged[index] = document;
      }
      await writeTable(documentPath, headers.documents, merged);
    }

    return backup;
  });
}

export function validateData(data: Data): string[] {
  const errors: string[] = [], ids = new Set(data.nodes.map(n => n.node_id)), poolTypes = new Set(data.pools.map(p => p.pool_type));
  if (ids.size !== data.nodes.length) errors.push('Node ID 重複');
  if (data.nodes.filter(n => n.surface_terrain === 'coconut-beach').length !== 3) errors.push('椰子沙灘分類必須恰好指定 3 個 Node');
  const startingNodes = data.nodes.filter((node) => node.starting_location === 'true');
  if (startingNodes.length === 0) errors.push('至少要設定一個新局出生點');
  const edgeIds = data.edges.map(e => [e.source_node, e.target_node].sort().join(':'));
  if (new Set(edgeIds).size !== edgeIds.length) errors.push('連線重複');
  for (const n of data.nodes) {
    if (!(n.label_status ?? '').trim()) errors.push(`Node ${n.node_id} 缺少地點名稱狀態 label_status`);
    
    if (!['unclassified', 'beach', 'coconut-beach', 'forest', 'berry-forest', 'river', 'rock', 'dungeon-entrance', 'port', 'monument-valley'].includes(n.surface_terrain ?? '')) errors.push(`Node ${n.node_id} 地形值無效`);
    if (!['true', 'false'].includes(n.starting_location ?? '')) errors.push(`Node ${n.node_id} 出生點設定無效`);
    if (n.day_surface_entry_events_enabled && !['true', 'false'].includes(n.day_surface_entry_events_enabled)) errors.push(`Node ${n.node_id} 白天地表事件設定無效`);
    for (const coord of ['image_x_px_approx', 'image_y_px_approx']) if (n[coord] && !Number.isFinite(Number(n[coord]))) errors.push(`Node ${n.node_id} ${coord} 必須是數字`);
  }
  for (const node of startingNodes) {
    if (environmentTerrainForClassification(node.surface_terrain as keyof typeof NODE_CLASSIFICATION_BEHAVIOR) !== 'beach') {
      errors.push(`Node ${node.node_id} 設為出生點時，地形必須是沙灘或椰子沙灘`);
    }
  }
  for (let left = 0; left < startingNodes.length; left += 1) {
    for (let right = left + 1; right < startingNodes.length; right += 1) {
      const a = startingNodes[left]?.node_id;
      const b = startingNodes[right]?.node_id;
      if (a && b && data.edges.some((edge) => edge.source_node === a && edge.target_node === b || edge.source_node === b && edge.target_node === a)) {
        errors.push(`出生點 Node ${a} 與 ${b} 不能相鄰`);
      }
    }
  }
  for (const e of data.edges) if (!ids.has(e.source_node) || !ids.has(e.target_node)) errors.push(`連線 ${e.source_node} → ${e.target_node} 引用不存在的 Node`);
  const documentIds = new Set<string>();
  for (const d of data.documents) {
    if (!d.document_id) {
      errors.push('文本卡缺少 document_id');
    } else {
      if (documentIds.has(d.document_id)) errors.push(`同一批文本卡 ID 重複：${d.document_id}`);
      documentIds.add(d.document_id);
    }
    if (!poolTypes.has(d.pool_type)) errors.push(`文本卡 ${d.document_id} 引用不存在的文本池 ${d.pool_type}`);
  }
  for (const n of data.notices) {
    const document = data.documents.find(d => d.document_id === n.document_id);
    if (!ids.has(n.node_id) || !document || !(document.text ?? '').trim() || document.pool_type !== 'signboard') errors.push(`告示綁定 ${n.node_id} → ${n.document_id} 無效、文本尚未填寫或不屬於告示牌文本池`);
  }
  return errors;
}

async function readTable(path: string): Promise<Row[]> { return [...await parseCsv(await readFile(path, 'utf8'))] as Row[]; }
async function readOptional(path: string, _columns: readonly string[]): Promise<Row[]> { try { return await readTable(path); } catch { return []; } }
async function writeTable(path: string, columns: readonly string[], rows: readonly Row[]): Promise<void> {
  const quote = (s: string): string => /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  await writeFile(path, `${columns.join(',')}\n${rows.map(row => columns.map(c => quote(row[c] ?? '')).join(',')).join('\n')}\n`, 'utf8');
}
