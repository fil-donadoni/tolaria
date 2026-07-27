# Draft Lab: a client-only draft inspector, with replay reconstructed rather than logged

## Status

accepted

## Context

Tuning the Bot Drafter (ADR 0072/0073) is impossible without seeing what it
weighed. Today nothing is observable: `limitedEvents` mutates in place — packs
empty as they are picked through — and no record of individual picks survives
the draft. Reconstructing "why did seat 3 take that card at pick 12" after the
fact cannot be done at all.

The obvious fix is to persist the decision. It is also the expensive one, and
it produces a worse instrument than it appears to. Recording every candidate's
term breakdown costs roughly 8 seats × 45 picks × 15 candidates ≈ 5,400 rows per
event, and — the real defect — it **freezes the explanation**: after a weight
change the stored trace narrates arithmetic that no longer decides anything,
which is precisely the state in which the tool is needed.

## Decision

**The Draft Lab is a client-only developer surface. It writes nothing, and no
draft log table exists.**

It imports the same pure modules the server picks with (`botDrafter.ts`,
`draftEngine.ts`) and runs drafts in the browser. This follows the precedent
already set by the gameplay Bot, whose ISMCTS Brain runs client-side against
`@convex/gre` and reports through a client-only, never-persisted trace store
(`src/lib/ai/trace-store.ts` → `ai-decision-trace.tsx`). Sharing the modules
rather than reimplementing them is what makes the Lab incapable of drifting
from real Bot Drafter behaviour.

Two modes:

- **Synthetic** — a draft generated from any seed, every seat a bot, stepped or
  auto-played, with the full per-candidate breakdown and its provenance (ADR
  0073). This is the tuning instrument: it gives visibility into all eight
  seats, which a real event's privacy projection correctly never will, and a
  weight change is re-evaluated by re-running it.
- **Replay** — a real completed Limited Event, reconstructed with **no stored
  data beyond what already exists**. The draft is fully determined by the
  event's `seed` plus the human seat's pick sequence, and that sequence is
  already persisted: `seat.pool` is append-only, one entry per pick, in pick
  order, never reordered. The Lab regenerates the packs from the seed, replays
  the human's picks by matching `pool[i]`, and recomputes every bot pick
  deterministically. The only addition is exposing `seed` on the projection of
  a **completed** event, where it can no longer reveal anything hidden.

**Access: the whole `/draft-lab` route is admin-only, and a non-admin gets a
404 — not an explanation.** The surface exposes the scorer's internals, every
bot seat's Pool mid-draft, and a completed event's reconstruction, which needs
the `seed` that regenerates every seat's Pool and is therefore released to an
admin alone. Gating the ROUTE rather than each panel gives one predicate
(`canViewDraftLab`) instead of one per surface, and it is what lets the two
queries the Lab reads through (`listScopeCardProfiles`,
`listScopeCardRatingsForReplay`) gate on `assertIsAdmin`: a non-admin never
mounts the hooks that call them. The server gate is the real boundary — hiding
the route alone would be cosmetic, since anyone signed in could call the
queries directly. The 404 is deliberate: an admin-only developer surface should
not confirm its own existence, so it renders the SAME page an unknown path
does.

The event carries a `scorerVersion`. The Lab shows the historical pick beside
what the **current** scorer would pick, and the divergence between them is the
tuning signal: change a weight, reopen an old draft, see which of 360 picks
moved. A stored trace cannot do this by construction — which is the argument
against storing one, independent of cost.

**A replay diverges from reality the moment retuned weights change any bot
pick**, because from that point the packs passed onward are no longer the packs
that were really passed. The divergence point is displayed, and the replay is
not presented as faithful past it. A replay tool that quietly keeps rendering
after it has stopped describing what happened is actively misleading.

## Considered Options

- **Persist per-pick candidate traces in Convex** — rejected: ~5,400 rows per
  event for an occasional debugging activity, and the stored explanation goes
  stale on the first retune, defeating the purpose.
- **Persist a minimal pick log (seat, pickId, pack snapshot) and recompute the
  trace** — rejected once it emerged that `seat.pool` already _is_ an ordered
  pick log. The log would be a second copy of data the schema holds, kept in
  sync for no gain. A pack snapshot was considered as insurance against a bug
  in the passing engine corrupting reconstruction; the synthetic mode covers
  that case without persistence, since it exercises the same passing code from
  a known seed.
- **Serve the trace from a read-only Convex query that simulates server-side** —
  rejected: it avoids no real problem (the frontend already imports engine
  modules for the gameplay Brain) while adding a large payload and a second
  execution environment for the same pure code.
- **Weaken the event privacy projection so real bot picks can be watched live** —
  rejected: it leaks other seats' packs into a live draft to serve a debugging
  need, and the synthetic mode gives strictly more visibility with no leak.

## Consequences

- Nothing about the Draft Lab can regress production behaviour: it has no write
  path, and its correctness depends entirely on modules that are already tested
  server-side.
- Replaying a real draft is free today and stays free — no migration, no
  retention policy, no growth in event document size.
- The Lab is invisible to a normal player: no navigation entry, and the route
  answers a 404. Reaching it is an admin act, which is also why the two reads
  it depends on could be tightened to `assertIsAdmin` with no other consumer
  affected — a static guard (`scripts/__tests__/draft-lab-admin-gating.test.ts`)
  keeps them there.
- A draft played before a scorer change can never be replayed with its original
  bot picks. Accepted: the historical picks are the user's own, and the value
  of the replay is the comparison, not the reproduction.
- The frontend's documented "never import from `convex/gre`" boundary
  (CLAUDE.md) was already contradicted by the client-side Brain; this record
  makes the real rule explicit — **pure engine modules may be imported by the
  client, engine state mutation may not**.
