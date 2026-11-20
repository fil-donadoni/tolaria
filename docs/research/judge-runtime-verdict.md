# The judge's runtime: Node against the default runtime against the client (issue #10030)

> **Dated:** 2026-11-20, read at `44678eab2`. Every number comes from
> production telemetry in Sentry (org `filippo-donadoni`) read on 2026-11-20
> over the preceding 3 days, or from `brain-search-in-the-field.md` (read at
> `a245582e4`). The decision it fed is the owner's ruling recorded below; ADR
> 0183 § Reopening this record names the test.

**Question.** ADR 0183 kept the Bot on the client because the server searched
no faster than a desktop browser, and named one untried candidate: a
Node-runtime action. Issue #10024 shipped the judge's search in Node for half
the games. Is Node at a third or less of desktop Chromium's time per
iteration?

**Verdict up front.** No. Node searched at **54–76 ms per iteration** (game
p50s, a lower bound) where Chromium, in the same two games, spent **17.5 and
23.2 ms**: three to four times slower. The backstop cut **27 of 36** Node
searches (75%), worse than the default runtime's 40 of 100 a week earlier.
ADR 0183 is not reopened.

## Sources

- `message:"verdict proposals"` with `judge.runtime` (issue #10024): 4
  reports, 2 games, all `node`, 2026-11-19 11:51–12:25 (Rome).
- `message:"bot search"` for the same `gameId`s: 2 reports, both Chromium.
- The default runtime: `brain-search-in-the-field.md` § 2 (8 games,
  2026-11-15/16). **No default-runtime game was played after the release**: the
  per-game hash routed both production games to Node, so the default runtime
  has no same-day row.

**Games, not reports.** Game `jh74hw4e` sent three reports (a reload re-judges
its sample); its counts below sum all three, as the field note does.

## Per game

`search-error` is the backstop: every game's `serverMs.max` is at or past
30 000 ms, and no `server-error` or `server-rejected` was reported. "ms per
iteration" is the p50 search time over the 400-iteration budget — a lower
bound, since a cut search finished fewer than 400.

| game     | runtime | consults | moves | backstop | server ms p50 (per report) | ms per iteration | Chromium ms per iteration p50 | Node ÷ Chromium |
| -------- | ------- | -------- | ----- | -------- | -------------------------- | ---------------- | ----------------------------- | --------------- |
| jh74hw4e | node    | 15       | 8     | 7 (47%)  | 21 481 / 24 966 / 30 220   | 54 – 76          | 17.47                         | 3.1 – 4.3x      |
| jh7egd6x | node    | 21       | 1     | 20 (95%) | 30 556                     | ≥ 76             | 23.17                         | ≥ 3.3x          |
| **all**  | node    | 36       | 9     | 27 (75%) |                            |                  |                               |                 |

Against the default runtime (`brain-search-in-the-field.md` § 2): 100
searches, 40 cut (40%), 5.8–78.1 ms per iteration by game; Chromium games
2.6–11x the client. Node's two games sit at the slow end of that range, not
below it. The reopening test asked for at most 0.33x.

The round trip adds 300–450 ms to the server's search time (p50, per
report), against 215–264 ms in the default runtime's ordinary games: the hop
to the Node action costs little next to the search.

## The 2026-11-16 slow window (12:11–12:53 Rome)

**Unexplained.** That window's three games cut 31 of 37 searches and carried
2–4x the usual round-trip overhead. Convex's own logs could not be read for
it: `convex logs --prod --history` returns only the newest 1000 entries
(about 15 minutes of traffic on 2026-11-20), and the deployment keeps no older
history the CLI can reach. Nothing in Sentry separates a slow Convex host from
heavy positions for those games. It no longer decides anything: the budget
below is sized to the slowest per-iteration cost measured anywhere, that
window included.

## The ruling (owner, 2026-11-20)

- **ADR 0183 not reopened.** Node is slower than the client, not faster.
- **The judge's budget is 200 iterations** (`tolaria.config.json`
  § verdictProposals, was 400). At 78 ms per iteration — the worst game p50
  measured in the default runtime — 200 iterations take about 16 s, half the
  30 s backstop.
- **The Node variant is removed**: `convex/verdictJudgeNode.ts`, the per-game
  routing, the `judge.runtime` attribute, and ADR 0113 Amendment VIII's
  seam exception.
- **Acceptance: the post-game review loses at most 5% of its decisions to the
  backstop.** Read it as `judge.search-error` over all consults, summed by
  game, on the reports after this change ships.

## How to re-read

```
message:"verdict proposals"
  fields: gameId, tags[judge.move,number], tags[judge.search-error,number],
          tags[judge.serverMs.p50,number], tags[judge.serverMs.max,number],
          tags[judge.roundTripMs.p50,number]
message:"bot search"
  fields: gameId, device.engine, tags[msPerIteration.p50,number]
```
