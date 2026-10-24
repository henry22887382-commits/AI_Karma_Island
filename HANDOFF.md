# Island Sim handoff

**Updated:** 2026-10-21. Implementation has resumed under the existing Cookie scope. This handoff records the current code/evidence boundary; it does not mark any Cookie DONE. The workspace is not verified as a Git repository and no remote/publish state is claimed.

## Start here

1. Read this page.
2. For current execution evidence and per-Cookie status, read [cookie-work/EXECUTION_LOG.md](cookie-work/EXECUTION_LOG.md). For the approved scope and source distinctions, consult [PROJECT_BRANDING.md](cookie-work/PROJECT_BRANDING.md), then only the relevant sections of [DESIGN_DECISIONS.md](cookie-work/DESIGN_DECISIONS.md) and [BAG_REVIEWS.md](cookie-work/BAG_REVIEWS.md). [COOKIE_REVIEW.md](cookie-work/COOKIE_REVIEW.md) is the planning review and points to later decisions/evidence.
3. For source files, use [island-sim/references/SOURCE_INDEX.md](island-sim/references/SOURCE_INDEX.md) and open only the cited source/table. The original map is [island-sim/references/assets/主島28Node原圖.png](island-sim/references/assets/主島28Node原圖.png). Preserve the original ZIP, CSVs, PNGs, and SQLite databases.
4. Current bounded movement/encounter/monster scheduling work and its unresolved requirements are in the latest section of `cookie-work/EXECUTION_LOG.md`. Preserve movement cost at 3T; arrival, forest entry roll, and any source-matched monster spawn happen in that same scheduled movement settlement. Do not invent the missing forest outcome table or report the blocked Cookies as DONE.

## Workspace and runtime

- Workspace: `D:\Henry\Documents\AI-land`; app source: `island-sim`. The workspace has no verified Git metadata or remote in this checkout; no publish/sync is claimed.
- Node ESM + TypeScript; `package.json` requires Node `>=24.15.0`. Scripts: `npm run typecheck`, `npm test`, `npm run check` (typecheck then tests). There is no package start script.
- Server entry inferred from its CLI guard: `node --experimental-strip-types src/ui/server.ts`. It opens SQLite and starts the simulation; do not start it as a status probe. Defaults to `127.0.0.1:4173`; `ISLAND_HOST`, `ISLAND_PORT`, `ISLAND_DB_PATH`, `ISLAND_SETTINGS_DB_PATH`, and `ISLAND_SEED` configure it. SQLite files are under `island-sim/data/`.
- Model credentials use process memory; after a server restart the API key must be entered again. Never copy keys into handoff or logs. No real paid-provider end-to-end evidence is recorded.
- Historical verification at 2026-10-21 13:18:43 (Asia/Taipei) failed before the bounded build fixes; its exact diagnostics remain in the earlier EXECUTION_LOG entry and are not current. Latest `npm run check` exits 0 with typecheck and 157/157 tests passing. The UI server was not started in this task; no browser/runtime claim is made.

## Implementation and evidence boundaries

- Engine, content, SQLite persistence, model settings/provider, simulation runner, and observer UI modules exist. The latest slice connects scheduled 3T movement settlement to immediate Node update and forest entry resolution, creates an actor only when the selected outcome exactly matches a monster source row, orders resident/monster actions by time and speed, and automatically commits monster action events. The runner test verifies it makes no AI request for automatic monster turns; AI view tests verify same-Node actors can receive the prior outcome narrative. Full source encounter tables, all special monster FSM branches, complete monster death/drop lifecycle, and a cross-type same-speed tie rule remain absent or unresolved; dungeon-runtime events are not yet connected to WorldActor combat. See EXECUTION_LOG for precise Crumbs and blockers. No Cookie is declared DONE.
- The latest full check is 157/157 passing; earlier 141/141 and failed fresh checks are historical snapshots, not current state.
- The map was visually checked against 03A and CSVs: 28 nodes and 51 edges; forest 9/17/23, rock 6/19/22, and river 24 are supported by group/order source mapping. Fish stations 2/10/14 and coconut nodes 1/8/13 are user-adopted settings, not labels shown on the original map. Keep the original image and preserve that provenance distinction.
- Source berry collection 80/20 is historical; the user-adopted active collection setting is 90/10. Forest entry rules are distinct: day event 15% with 35% negative share (5.25% negative total), night event 25% with 70% negative share (17.5% negative total).
- Sleep rules: safe areas have zero extra sleep-risk checks; unsafe-area checks use each resident's entry-check time as anchor, every 3T, up to 8 across a full 24T sleep. An attack resolves damage/death first; only survivors wake. Missing event definitions/effects remain gated, not invented. Other pending formal definitions are tracked in DESIGN_DECISIONS.md; do not reproduce or silently settle them here.

## Work mode and context budget

Main agent coordinates and avoids broad file reading; GPT-6 Luna low handles reading and ordinary document edits; GPT-6 Luna medium handles code/environment work. Do not open high reasoning for this handoff, fork the full conversation, reread the whole ZIP, or scan all source/tests by default. Use short summaries, targeted file sections, and one task at a time. No long-term memory was updated.
