# Island Sim handoff

**Updated:** 2026-10-21. The user asked to stop adding implementation and sync the current state for the next AI. This is a handoff snapshot, not approval to resume feature work. The current workspace snapshot is being published to the public GitHub repository `henry22887382-commits/AI_Karma_Island` on `main`; this records a source handoff, not implementation completion.

## Start here

1. Read this page.
2. For current execution evidence and per-Cookie status, read [cookie-work/EXECUTION_LOG.md](cookie-work/EXECUTION_LOG.md). For the approved scope and source distinctions, consult [PROJECT_BRANDING.md](cookie-work/PROJECT_BRANDING.md), then only the relevant sections of [DESIGN_DECISIONS.md](cookie-work/DESIGN_DECISIONS.md) and [BAG_REVIEWS.md](cookie-work/BAG_REVIEWS.md). [COOKIE_REVIEW.md](cookie-work/COOKIE_REVIEW.md) is the planning review and points to later decisions/evidence.
3. For source files, use [island-sim/references/SOURCE_INDEX.md](island-sim/references/SOURCE_INDEX.md) and open only the cited source/table. The original map is [island-sim/references/assets/主島28Node原圖.png](island-sim/references/assets/主島28Node原圖.png). Preserve the original ZIP, CSVs, PNGs, and SQLite databases.
4. The user has not resumed feature implementation. If implementation is explicitly resumed, first address the current bounded build/test failure; do not expand into all 17 Cookies. Do not treat a historical test count as completion.

## Workspace and runtime

- Workspace: `D:\Henry\Documents\AI-land`; app source: `island-sim`. The workspace was not previously a Git repository; this handoff snapshot is being published to `https://github.com/henry22887382-commits/AI_Karma_Island`.
- Node ESM + TypeScript; `package.json` requires Node `>=24.15.0`. Scripts: `npm run typecheck`, `npm test`, `npm run check` (typecheck then tests). There is no package start script.
- Server entry inferred from its CLI guard: `node --experimental-strip-types src/ui/server.ts`. It opens SQLite and starts the simulation; do not start it as a status probe. Defaults to `127.0.0.1:4173`; `ISLAND_HOST`, `ISLAND_PORT`, `ISLAND_DB_PATH`, `ISLAND_SETTINGS_DB_PATH`, and `ISLAND_SEED` configure it. SQLite files are under `island-sim/data/`.
- Model credentials use process memory; after a server restart the API key must be entered again. Never copy keys into handoff or logs. No real paid-provider end-to-end evidence is recorded.
- Fresh verification began 2026-10-21 13:18:43 (Asia/Taipei): `npm run check` exited 1 at typecheck; tests did not run through that command. `dungeon-runtime.test.ts:6:69` has TS2307 for missing `./dungeon-runtime.ts`; event implicit-any diagnostics at 39:38, 80:43, 81:38 follow from that missing module. `simulation.ts:273:10` cannot resolve `isSurfaceAction`; 281:7 reports `string` not assignable to `SurfaceAction`. Separate `npm test` exited 1: 145 total, 144 passed, one test-file load failure (`ERR_MODULE_NOT_FOUND` for `dungeon-runtime.test.ts`). Do not remove/replace the test or add a stub to force green. HTTP GET `http://127.0.0.1:4173/` failed (curl max 5s, exit 7, HTTP 000, 2.015s); `Get-NetTCPConnection -LocalPort 4173 -State Listen` returned no listener. The server was not started. Historical 141/141 green is no longer the current state. See the latest entry in EXECUTION_LOG for provenance.

## Implementation and evidence boundaries

- Engine, content, SQLite persistence, model settings/provider, simulation runner, and observer UI modules exist. Some combat/monster/dungeon functionality has been reported as pure helpers; monster and dungeon runtime dispatch remain unconnected. Surface/dungeon/social dispatch, a complete AI action loop, and death/generation lifecycle remain unverified or incomplete. Check the execution log before making a more specific claim.
- Earlier reports of 141/141 tests passing are historical snapshots. The fresh check above currently fails, and no Cookie is declared DONE solely from test counts.
- The map was visually checked against 03A and CSVs: 28 nodes and 51 edges; forest 9/17/23, rock 6/19/22, and river 24 are supported by group/order source mapping. Fish stations 2/10/14 and coconut nodes 1/8/13 are user-adopted settings, not labels shown on the original map. Keep the original image and preserve that provenance distinction.
- Source berry collection 80/20 is historical; the user-adopted active collection setting is 90/10. Forest entry rules are distinct: day event 15% with 35% negative share (5.25% negative total), night event 25% with 70% negative share (17.5% negative total).
- Sleep rules: safe areas have zero extra sleep-risk checks; unsafe-area checks use each resident's entry-check time as anchor, every 3T, up to 8 across a full 24T sleep. An attack resolves damage/death first; only survivors wake. Missing event definitions/effects remain gated, not invented. Other pending formal definitions are tracked in DESIGN_DECISIONS.md; do not reproduce or silently settle them here.

## Work mode and context budget

Main agent coordinates and avoids broad file reading; GPT-6 Luna low handles reading and ordinary document edits; GPT-6 Luna medium handles code/environment work. Do not open high reasoning for this handoff, fork the full conversation, reread the whole ZIP, or scan all source/tests by default. Use short summaries, targeted file sections, and one task at a time. No long-term memory was updated.
