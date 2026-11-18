# The Brain's search in the field, and what a server search costs (issue #9529)

> **Dated:** 2026-11-16, read at `a245582e4`. Every number below comes from
> production telemetry logged between 2026-11-15 09:10 and 2026-11-16 16:38
> (Rome), from the provider's pricing page read on 2026-11-16, or is derived
> from those two in the open below. Slice 4 of PRD issue #9525; the decision it
> feeds is ADR 0183.

**Question.** The lab (`brain-search-off-the-dev-machine.md`, measured at
`90996ede2`) said a slower device silently plays a shallower Bot. How shallow
is the Bot in real games, on the devices it was actually played on — and would
a search on the server be deeper, how much slower to answer, and at what cost?

**Verdict up front.**

1. **In real games the clock, not the budget, decides every search.** 614 of
   629 searches (98%) stopped on the time cap. The Bot at `expert` completes
   **24%** of its 1320 iterations in Chromium, **15%** in WebKit, **5%** in
   Gecko — on desktop machines with 5–8 cores. The lab's blade positions
   predicted 85% for this class of machine: a real board costs Chromium a
   median 13.2 ms per iteration against the lab's 3.2 ms.
2. **The server is not a faster device.** The server judge, searching
   positions of the same games in the default runtime, spent 15–78 ms per
   iteration (game medians) where the Bot, in the same Chromium games, spent
   1.4–13.6 ms. 40 of its 100 searches hit the 30 s backstop before finishing
   400 iterations.
3. **Cost decides nothing; speed does.** Even a full-depth server Bot at a
   hundred times today's volume prices below $250 a month. What it cannot buy
   is a playable move: 20–103 s each.
4. **The device class cannot see a phone.** The owner played one of the two
   WebKit games on an iPhone and the other on a Mac, both in Safari; both
   reports say `mobile: false`. No conclusion below separates a phone from a
   desktop.

## Sources

Two structured logs in Sentry (org `filippo-donadoni`), both read on
2026-11-16 over the preceding 7 days:

- `message:"bot search"` — one per vs-Bot game, from the driver
  (`src/lib/ai/bot-search-telemetry.ts`, issue #9526): 28 reports.
- `message:"verdict proposals"` carrying `judge.serverMs.p50` — one per game
  whose review the server judge built (`convex/verdictJudge.ts`, issue #9528):
  8 reports.

**Minimum before a conclusion.** The owner relaxed the first pass's minimum
(five games per engine family) on 2026-11-16. Applied here: a conclusion about
an engine family needs **at least two games** from it. Chromium (13) and Gecko
(5) clear it; WebKit (2) clears it at the floor and is read as indicative.
Mobile cannot be counted at all (§ 4).

**Games, not reports.** A driver remount re-opens the per-game recorder, so
one game can send several reports (6 of 20 games did, one of them three).
Every table below sums by `gameId` first.

## 1. The Bot's search, by device class

All 20 games at `expert` (1320 iterations, 3300 ms), all desktop, all in the
`5-8` core bucket.

| engine   | games | searches | stopped by time | iterations completed / requested, pooled | median game | range         | iterations per search | ms per iteration, median report p50 |
| -------- | ----- | -------- | --------------- | ---------------------------------------- | ----------- | ------------- | --------------------- | ----------------------------------- |
| Chromium | 13    | 338      | 325 (96%)       | 0.237                                    | 0.208       | 0.112 – 0.716 | 313                   | 13.2                                |
| WebKit   | 2     | 64       | 62 (97%)        | 0.152                                    | —           | 0.113 – 0.182 | 200                   | 16.7                                |
| Gecko    | 5     | 227      | 227 (100%)      | 0.054                                    | 0.052       | 0.033 – 0.141 | 71                    | 71.4                                |

Per game:

| game     | engine   | reports | consults | searches | ratio | iterations per search | ms per iteration p50, per report |
| -------- | -------- | ------- | -------- | -------- | ----- | --------------------- | -------------------------------- |
| jh7dbttc | chromium | 1       | 6        | 5        | 0.716 | 945                   | 1.38                             |
| jh7267tb | chromium | 3       | 28       | 26       | 0.505 | 667                   | 2.21 / 3.09 / 14.03              |
| jh7fm2p6 | chromium | 1       | 23       | 20       | 0.204 | 269                   | 27.99                            |
| jh7334vv | chromium | 2       | 22       | 18       | 0.139 | 183                   | 10.26 / 36.14                    |
| jh7bn3bk | chromium | 1       | 19       | 18       | 0.142 | 187                   | 27.77                            |
| jh74jtva | chromium | 1       | 68       | 63       | 0.136 | 180                   | 25.43                            |
| jn7884bn | chromium | 1       | 19       | 15       | 0.354 | 468                   | 9.63                             |
| jn72bfzc | chromium | 1       | 31       | 28       | 0.112 | 148                   | 26.02                            |
| jn7a4831 | chromium | 1       | 25       | 20       | 0.208 | 274                   | 13.55                            |
| jn77da2w | chromium | 2       | 46       | 44       | 0.246 | 325                   | 8.87 / 13.24                     |
| jn79qjhh | chromium | 1       | 26       | 23       | 0.199 | 262                   | 16.51                            |
| jn75h0jq | chromium | 1       | 35       | 30       | 0.251 | 331                   | 11.86                            |
| jn7fv2kf | chromium | 1       | 32       | 28       | 0.362 | 478                   | 8.03                             |
| jh7akebw | gecko    | 1       | 26       | 21       | 0.141 | 187                   | 21.89                            |
| jh79wbaz | gecko    | 1       | 25       | 19       | 0.081 | 107                   | 32.72                            |
| jh77b14s | gecko    | 1       | 29       | 21       | 0.052 | 69                    | 85.48                            |
| jh74dkfv | gecko    | 3       | 113      | 102      | 0.044 | 58                    | 39.39 / 71.4 / 1073.5            |
| jh79ywfg | gecko    | 1       | 75       | 64       | 0.033 | 44                    | 101.15                           |
| jh7bkzta | webkit   | 2       | 43       | 36       | 0.182 | 240                   | 16.7 / 62.15                     |
| jh74q517 | webkit   | 2       | 32       | 28       | 0.113 | 149                   | 7.42 / 46.32                     |

What else the reports say:

- **No consult failed.** In 723 consults no report carried a timeout, a Worker
  error, a search error or an in-thread fallback (Sentry knows none of those
  attributes in the window). The time cap holds: `searchMs.max` never passed
  4294 ms, `consultMs.max` never 4658 ms, under the 5000 ms consult timeout.
- **No search settled early**, and 15 of 629 stopped on the iteration count.
- **The player waits the whole cap.** `consultMs.p50` is 3310–3404 ms in 25
  of the 28 reports (the other three are early-game reports of the first two
  games): one Bot decision costs the player about 3.3 s.
- **Depth falls as the game goes on.** The split games show it inside one game:
  jh7267tb went from 2.21 to 14.03 ms per iteration across its three reports,
  jh74dkfv from 39 to 1073.
- **In the field the presets differ by their clocks only.** Since the clock
  ends almost every search, `expert` (3300 ms) is `hard` (3000 ms) plus 10% and
  `medium` (1500 ms) is about half of either; their iteration budgets never
  bind past the opening.

Against the lab: § 2 of `brain-search-off-the-dev-machine.md` gives 85% of
`expert`'s iterations at 3.2 ms per iteration and 27% at 18.9 ms. The field's
Chromium median report sits at 13.2 ms and completes 24%: real boards are the
lab's "slow device". Gecko's distance from Chromium is 4.4x in the field
(5.4% against 23.7%) against 2.0x in the lab; that gap was not explained here
(`gecko-search-gap.md`, issue #10122, attributes it).

## 2. The server judge

The judge searches the human seat's captured decisions at 400 iterations, a
fixed seed, no time cap, behind a 30 000 ms backstop, in Convex's default
runtime (64 MiB). A search the backstop cuts is counted `judge.search-error`.

| game     | client engine | moves | backstop | server ms, p50 | server ms, max | ms per iteration at p50 | client ms per iteration p50 (median report) | round trip − server, p50 |
| -------- | ------------- | ----- | -------- | -------------- | -------------- | ----------------------- | ------------------------------------------- | ------------------------ |
| jh7dbttc | chromium      | 4     | 0        | 2319           | 4317           | 5.8                     | 1.38                                        | 222                      |
| jh7267tb | chromium      | 9     | 6        | 13788          | 31043          | 34.5                    | 3.09                                        | 215                      |
| jh7akebw | gecko         | 16    | 0        | 7153           | 20258          | 17.9                    | 21.89                                       | 239                      |
| jh7334vv | chromium      | 14    | 0        | 10704          | 23864          | 26.8                    | 10.26                                       | 264                      |
| jn7a4831 | chromium      | 4     | 16       | 30576          | 44904          | 76.4                    | 13.55                                       | 998                      |
| jn77da2w | chromium      | 1     | 3        | 30060          | 30269          | 75.2                    | 8.87                                        | 572                      |
| jn75h0jq | chromium      | 1     | 12       | 31240          | 32881          | 78.1                    | 11.86                                       | 949                      |
| jh7bkzta | webkit        | 11    | 3        | 5988           | 30244          | 15.0                    | 16.7                                        | 240                      |

Totals: 100 server searches, 60 answered, **40 cut by the backstop**, no
`server-error` (so no out-of-memory call) and no `server-rejected`.

"ms per iteration at p50" is the p50 search time over the judge's 400
iterations. It is a **lower bound** on the server's cost: a search that the
backstop cut completed fewer than 400 iterations in its time. Where the p50
search was cut (the last three Chromium rows), the true figure is higher than
the one shown.

**Reading.** In every Chromium game the server spent 2.6–11 times the
client's time per iteration; in the Gecko and WebKit games, about the same
(0.8x, 0.9x). The server judge is a device between desktop WebKit and desktop
Gecko, not a faster one. Two caveats bound that reading: the judge searches
the human's decisions and the Bot its own, so the positions differ within a
game; and the three games judged on 2026-11-16 between 12:11 and 12:53
(Rome) cut 31 of their 37 searches and carried a round-trip overhead 2–4 times
the other games' — the server's speed varies within a day, for a reason not
measured here.

The search inside an action overshoots its backstop by up to one iteration:
44 904 ms against 30 000 ms is one iteration of about 15 s.

## 3. Cost

**Prices**, read 2026-11-16 at `convex.dev/pricing` (unchanged from the PRD's
2026-11-13 reading): action compute 20 GB-hours a month included on the Free
and Starter plans, $0.33 per further GB-hour; 250 GB-hours included on
Professional ($25 per developer a month), $0.30 beyond; 64 concurrent actions
on Free/Starter (deployment class S16), 512 on Professional (S256). Function
calls: 1M included on Free/Starter, 25M on Professional. The limits page gives
the default runtime 64 MiB and Node 512 MiB; neither page states how memory
and duration combine. **Assumed here:** billed GB-hours = the runtime's memory
× the action's wall time, so one default-runtime second is 0.0625 / 3600 =
1.74 × 10⁻⁵ GB-hours.

**Volume today.** Distinct vs-Bot game ids across both logs over the 7 days to
2026-11-16: 30 — about 130 games a month. The three volumes priced are 130,
1300 and 13 000 games a month.

**Per game** (31.4 searches per game, the 20 field games' mean):

| what runs on the server                     | server seconds per game             | GB-hours per game |
| ------------------------------------------- | ----------------------------------- | ----------------- |
| the judge (today, in every option)          | 150 – 376 ¹                         | 0.0026 – 0.0065   |
| the Bot, at `expert`'s 3300 ms cap          | 104 (31.4 × 3.3 s)                  | 0.0018            |
| the Bot, at `expert`'s full 1320 iterations | 622 – 3234 (31.4 × 1320 × 15–78 ms) | 0.0108 – 0.0562   |

¹ Lower bound: the 40 backstopped searches at 30 s and the 60 answered ones at
nothing (1200 s over 8 games). Upper bound: every search at its game's max
(3010 s over 8 games).

**Per month**, action compute only:

| option                             | 130 games      | 1300 games | 13 000 games |
| ---------------------------------- | -------------- | ---------- | ------------ |
| Client (judge only)                | 0.3 – 0.8 GB-h | 3.4 – 8.5  | 34 – 85      |
| Server at the cap (judge + Bot)    | 0.6 – 1.1      | 5.7 – 10.8 | 57 – 108     |
| Server at full depth (judge + Bot) | 1.7 – 8.1      | 17 – 81    | 174 – 815    |

Read against the plans:

- **Up to 1300 games**, every option but full depth fits Free/Starter's 20
  included GB-hours; full depth passes it at the upper end ($20 a month of
  overage at most).
- **At 13 000 games**, every option passes 20 GB-hours. On Starter that is
  overage, not a forced change: Client $5–21 a month, Server at the cap
  $12–29, full depth $51–262. Professional's 250 included GB-hours cover all
  but full depth's upper end.
- **Function calls** do not bind: a server Bot adds about 31 action calls a
  game, 0.4M a month at 13 000 games.
- **Concurrency is what forces a plan change, and only at full depth.** One
  capped search holds an action slot 3.3 s, so S16's 64 slots serve about 19
  searches a second; a full-depth search holds one 20–103 s, and 64 slots
  serve 0.6–3.2 a second — a peak hour of a few dozen concurrent games would
  queue. That is the point Professional's 512 slots become owed.

**Latency a player feels per Bot move:**

| option               | per move                                                 |
| -------------------- | -------------------------------------------------------- |
| Client               | 3.3 s (`consultMs.p50`, every game)                      |
| Server at the cap    | 3.3 s + 0.2 s round trip (0.6–1.0 s on the slow morning) |
| Server at full depth | 20–103 s                                                 |

**Depth by device class** (iterations per search, of 1320):

| where the search runs      | iterations per search | share   |
| -------------------------- | --------------------- | ------- |
| client, Chromium desktop   | 313                   | 24%     |
| client, WebKit desktop     | 200                   | 15%     |
| client, Gecko desktop      | 71                    | 5%      |
| client, mobile             | not measured          | —       |
| server, at the 3300 ms cap | 42 – 220 ²            | 3 – 17% |
| server, uncapped           | 1320                  | 100%    |

² 3300 ms over the server's 15–78 ms per iteration (§ 2), a derived figure.

## 4. Not measured

- **Phones.** No report has `mobile: true`, yet by the owner's account
  (2026-11-16) one of the two WebKit games, jh7bkzta or jh74q517, was played
  in Safari on an iPhone and the other in Safari on a Mac. The flag is derived
  from `userAgentData.mobile`, which Safari does not implement, else from an
  `iPhone`/`iPad`/`Mobi` token in the user agent; why an iPhone's report
  carried neither was not checked (a "Request Desktop Website" setting is one
  explanation; iPadOS sends a desktop agent by default, a second blind spot).
  The `5-8` core bucket does not separate them either. The WebKit row of § 1
  is therefore one phone and one desktop, and nothing here is a phone figure.
- **Device diversity.** Every report is in the `5-8` core bucket; one owner's
  machines. A slow laptop is the lab's scaled clock, not a field reading.
- **Machine load.** The owner's machines are also the pipeline's runners
  (ADR 0156); a game played under a running gate searches on a loaded core.
  The reports carry no load figure.
- **A Node-runtime search.** The judge runs in the default runtime. Node's
  512 MiB actions may run on different hardware at a different speed; nothing
  here says whether they are faster.
- **Billed compute.** The Convex usage dashboard was not read; § 3 prices from
  measured durations under the stated memory × wall-time assumption.

## Reproduce

In Sentry's log explorer (org `filippo-donadoni`, last 7 days), sort by
timestamp:

```text
message:"bot search"
  fields: gameId, device.engine, device.cores, device.mobile, consults, searches,
          iterations.requested, iterations.completed, stopped.time,
          stopped.iterations, searchMs.p50, searchMs.max, consultMs.p50,
          consultMs.max, msPerIteration.p50, msPerIteration.p90

message:"verdict proposals"
  fields: gameId, judge.move, judge.search-error, judge.serverMs.p50,
          judge.serverMs.max, judge.roundTripMs.p50, judge.roundTripMs.max,
          judge.runtime   # default | node | mixed, since issue #10024
```

Numeric attributes are typed in the API (`tags[consults,number]`). An
attribute absent from the whole window is reported "unknown" by the
explorer — that is how § 1 knows no consult failed. Sum each game's reports
by `gameId` before reading a ratio: pooled ratio = Σ completed / Σ requested.
