# Engine decisions and implementation gates

This file records reversible implementation choices and source-backed values. It does not replace the Cookie plan, rewrite user requirements, or treat unresolved fields as approved.

## Approved world rules

- Starting residents are born at a selected starting beach, never at the central camp (`references/14_AI決策提示詞與Node報幕.md`, §6).
- Following user approval relayed on 2026-10-20, starting beach candidates are Nodes **1, 8, 13**. The source node table marks all three `海灘類`; `island_edges.csv` has no edge among any candidate pair. Each new resident independently draws a candidate from the world seed. Selection allows repeats; later generations draw again instead of inheriting the previous location.
- The same-speed ordering is HP, hunger, sleep resource, attack, defense, then empty inventory slots, each descending. Compare fields present for both actors, including across resident/monster types; skip fields absent from either actor. A seeded recorded draw resolves complete ties. This is the user-approved rule implemented by `engine/tie-break.ts`.
- Resident speed follows `round(current HP / 10 + equipment modifiers)` (`references/02_時間與行動排程.md` §6 and `references/05_戰鬥與怪物.md` §1). User confirmed half values round up; implementation uses `Math.round` for nonnegative speed inputs.
- WAIT costs 1T; one-edge map movement costs 3T (`references/03A_28Node原圖與鄰接表.md`, recovery notes; user confirmation for WAIT). Movement is represented as transit with no current Node until arrival.

## Reversible technical choices

- Runtime, tests, and persistence use Node.js 24 built-in `node:sqlite` and the built-in test runner; schema version 1 has an append-only event table and atomic snapshot/event commit.
- Same-time timers settle before resident actions. At equal times the deterministic priority is travel arrival, personal sleep-risk check, object expiry, day boundary, then resident action. This makes a resident arrive before acting at the arrival T and prevents acting on an object at or after its expiry T.
- Each action/timer is one atomic world event and snapshot commit. Random choices store before/after RNG state and value in the event.
- Historical records and existing database files are preserved; starting a new world must use an explicit new-world flow/path, not overwrite the existing snapshot.

## Unresolved runtime gates

- User clarification on 2026-10-20 supersedes the imprecise older reference wording: there is no fixed global night-risk check. The eight checks are the resident-specific sleeping risk cadence: every 3T while the resident is sleeping in an unsafe area, anchored to that resident's area-entry time. Ordinary enter/explore triggers remain separate actions.
- The complete 24T night anchored at T48 checks at T51, 54, 57, 60, 63, 66, 69, and T72. The user-supplied 2026-10-22 surface table resolves the terrain rates and sleep-risk outcome: use the current Node's night enemy rate, apply fixed HP -1 before spawning the night enemy, and skip at a lit campfire. T72's check precedes the day-boundary settlement. Runtime terrain classification uses source-backed node visual types/labels; Node11 is forest (user confirmed 2026-10-22), with a 35% night enemy rate. Node25 is the central camp with a permanent default lit campfire, so surface entry and sleep environment checks are skipped there. Do not infer other Node terrain from a group description or substitute another terrain's rate.
- Food spoilage is three island days, but its start event is unresolved. Daily-survival death now creates a permanent corpse and separate non-expiring item objects at the actor's current Node; the dead actor retains history but no longer owns those items. Dawn replacement creates a fresh generation for the same stable slot, draws a new beach, has fresh survival state and empty possessions, and reads the current model assignment for its 1-based model slot. Snapshot v1 read-time migration fills stable slot/generation mapping without changing the stored JSON until the next normal commit. Model intents can be kept in a private per-life snapshot field, marked pending at death, and erased when `settleResidentBiography` writes a player-only biography event. This remains a lifecycle slice: combat deaths are not routed through the materializer, corpse movement/scavenging actions are absent, biography generation is not connected to a provider, model settings are not yet adapted into runtime assignments, and old snapshots contain no recoverable prior intent records.
- Provider API keys remain outside WorldState, event history, observer projections, and persistent model settings; only process memory is allowed by current settings design.
