---
title: Eight tracked-by markers cite issues that are already closed
discoveredBy: 1009
status: draft
confidence: high
---

**What is wrong.** A `tracked-by:` marker whose issue is CLOSED is dead on
arrival: nobody following it finds live work, and the confession it guards keeps
reading as "someone is on it". The `/audit-tracker #1009` pass resolved the state
of every issue any marker cites — 119 distinct numbers across `convex/` and
`src/` — and eight of them are closed.

**Evidence.** Enumerated at `origin/staging` @ `289a277be` with
`grep -rhoE "tracked-by:? *#[0-9]+" convex/ src/ | grep -oE "[0-9]+" | sort -u`,
then `gh issue view <n>` per hit:

| Closed issue                                               | Marker sites                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #782 — hybrid mana residual                                | `convex/cards/sets/iko/multicolor.ts:21`, `:119`                                                 |
| #1086 — INV White capability gaps                          | `convex/cards/sets/inv/multicolor.ts:1765`                                                       |
| #1097 — INV Green capability gaps                          | `convex/cards/sets/znr/blue.ts:20`                                                               |
| #1301 — Emrakul PRD                                        | `convex/limited/capabilityRegistry.ts:92`                                                        |
| #1435 — resolve()→effects migration gate                   | `convex/cards/sets/atq/colorless.ts:598`, `:1308`, `:1855`, `convex/cards/sets/leg/green.ts:524` |
| #1980 — land played from exile skips the shock-land choice | `convex/gre/state.ts:12800`, `:13170`                                                            |
| #2064 — Continuous Effects Registry PRD                    | `convex/cards/sets/atq/colorless.ts:1225`, `convex/cards/sets/atq/green.ts:342`, `:353`          |
| #2390 — Ninjutsu / Fallen Shinobi                          | `convex/cards/types.ts:13202`                                                                    |

Three further hits (#123, #999, #1213) are fixture strings inside
`convex/cards/__tests__/divergenceMarkers.test.ts` and are not real markers.

Two shapes are mixed together here and want different dispositions. #1086, #1097,
#1301 and #2390 look like markers that outlived work that actually SHIPPED — the
confession beside them may itself be stale and should be re-read, not merely
re-pointed. #1435, #1980 and #2064 are the opposite: the work looks genuinely
unfinished and the issue was closed anyway (#2064 is a whole PRD), so the marker
is pointing at a decision nobody can now find.

**Why it may not deserve its own issue.** Guard B (`divergenceMarkers.test.ts`)
checks that a marker HAS a tracking ref, never that the ref is alive, so nothing
will ever fail on this. The cheap durable fix is a guard extension — resolve each
cited issue's state in `check:guards` and red on a closed one — which is one
ticket for the class, not eight for the instances. Re-pointing the eight by hand
without that guard buys a year at most.
