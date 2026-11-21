# The Bot on a weak line and a weak client (issue #10116)

> **Dated:** 2026-11-21, client bundle built at `3910404f0` (production
> build, `vite build` + `vite preview`), against the local Convex backend on
> the development MacBook (Apple M1 Pro, 8 cores) while it was also the
> pipeline's runner: load average 14–52 during the window. Games played
> 11:35–12:35 (Rome); field reports read over the same day. Every number
> below is as of that commit and that day. Slice of PRD issue #10017; owner
> ruling in issue #10027.

**Question.** How does the Bot behave on a slow network and on a client with
few resources: iterations per search, consults over the timeout, in-thread
fallbacks, watchdog rungs, first-consult latency on a cold cache? What breaks
first?

**Verdict up front.**

1. **What breaks first is not the search, it is the driver's subscription.**
   On a loaded backend one query failed with a server timeout, the vs-Bot
   driver's subscription parked on the first error, the board said "The Bot
   lost contact with the game", and the server's deadline backstop skipped
   **three** Bot decisions before a manual Reconnect. Filed as issue #10407.
2. **Chrome DevTools CPU throttling does not reach the Brain.** It slows the
   page's main thread (a fixed loop: 155 → 789 ms at 4x) and leaves the
   dedicated Worker the Brain searches in untouched (131 → 138 ms). The 4x
   and 6x games therefore measure the driver and the UI on a slow main
   thread, not a slow search. The search on a slow core stays unmeasured in a
   real browser (§ Not measured).
3. **The network never reached the consult budget.** At Slow 4G and Slow 3G
   on a cold cache, the Brain's shards finished loading before the first
   consult was posted; every first consult took 3.3 s, the time cap. No
   consult timed out, none fell back in-thread, in any condition.
4. **The field already holds the slowest client measured, and it is a
   near-miss.** Two Gecko games on macOS, played on production the same
   morning, ran 342–472 ms per iteration (p50), 1,658 ms at p90, and a first
   iteration of 3,567 ms. The slowest consult took **5,046 ms against a
   5,300 ms timeout**: the timeout's overrun margin (1,500 ms) assumes an
   iteration shorter than one of these. Filed as issue #10408.
5. **Iterations per search against the 400 target (issue #10027):** every
   lab condition cleared it but one (277, the 4x game, played at load
   average ~52); the Gecko field games did not come close (39–67).

## Method

- **Client.** A production build of the worktree at `3910404f0`, served by
  `vite preview` on `localhost:5173`. Not the dev server: the shared checkout
  it would watch switched branch mid-game and HMR reloaded the page. That
  first baseline game (`jn7cvvcv`) is discarded; the reload split it into
  two reports, 43 searches and 1.
- **Browser.** Chrome 157 driven over CDP (`chrome-devtools-mcp`), one
  **isolated browser context per condition**, so every condition starts on a
  cold HTTP cache and an empty origin storage. Emulation set before the
  first navigation: CPU 4x, CPU 6x, network `Slow 4G`, network `Slow 3G`, or
  none (baseline). Desktop viewport, desktop user agent.
- **Game.** Constructed vs Bot, Arena, Premodern, Bo1, `Stompy` against the
  Bot's Mirror at `expert` (1,320 iterations, 3,300 ms cap). The human seat
  only passes, keeps, skips attacks and discards to hand size: the Bot does
  all the playing. Each game runs to a fixed turn or to game over, then
  concedes, which flushes the report.
- **Sources.** (a) The `bot search` report, read twice: from the request the
  SDK sent (DevTools network) and from Sentry (`message:"bot search"`, org
  `filippo-donadoni`). (b) A page init script wrapping `Worker` to timestamp
  every Brain `postMessage` and its reply: consult latency, the first
  consult, the `prime` message. (c) Resource Timing for the shard fetches.
  (d) The local backend's `bugReports` table for server-deadline faults
  (rung 5 and the server backstop file there). (e) The local backend's log
  (`convex logs`).
- **Watchdog rungs.** Rungs 1–4 leave no trace outside the in-tab ring; rung
  5 and the server backstop file a system bug report. The board's two
  notices were watched from the 6x game on (the Reconnect banner,
  `role="alert"`); the rung-5 notice (`role="status"`, 6 s) was not watched
  directly — its server record was read instead.

## 1. The five conditions

All games: Chromium, macOS, `5-8` cores, `mobile: false`, `expert`.

| condition | game     | window       | consults | searches | stopped by time | iterations / search | ratio | ms / iteration p50 | consult max | timeouts | in-thread | server-deadline faults |
| --------- | -------- | ------------ | -------- | -------- | --------------- | ------------------- | ----- | ------------------ | ----------- | -------- | --------- | ---------------------- |
| baseline  | jn7fdc6m | T1–T11       | 80       | 76       | 76              | **443**             | 0.335 | 9.46               | 3,400 ms    | 0        | 0         | 0                      |
| CPU 4x    | jn7c3e6e | T1–T8        | 43       | 39       | 39              | **277**             | 0.210 | 12.64              | 3,352 ms    | 0        | 0         | **3**                  |
| CPU 6x    | jn73r49s | T1–T5 (lost) | 23       | 19       | 19              | **597**             | 0.452 | 5.27               | 3,323 ms    | 0        | 0         | 0                      |
| Slow 4G   | jn7dy8z5 | T1–T6 (lost) | 18       | 14       | 13              | **517**             | 0.392 | 7.19               | 3,330 ms    | 0        | 0         | 0                      |
| Slow 3G   | jn76zfye | T1–T7        | 41       | 35       | 35              | **412**             | 0.312 | 9.01               | 3,331 ms    | 0        | 0         | 0                      |

Iterations per search = `iterations.completed / searches`. `timeouts` and
`in-thread` are the report's `consults.timeout` and `consults.inline`: absent
from every report, and Sentry knows neither attribute over the day, field
games included.

**The spread is the board and the machine, not the condition.** The 6x game
is the fastest per iteration and the 4x game the slowest: the Worker is not
throttled (verdict 2), so ms per iteration follows the board the Bot searched
and the runner's load (~52 during the 4x game, 14–25 otherwise).

## 2. First consult on a cold cache

Milliseconds from the navigation that loaded the setup page (the time the
human seat takes to click through the setup is in the column, so only the
last column compares across conditions).

| condition | shard files fetched (169 KB on the wire, 277 KB decoded) | `prime` posted | first consult posted | first consult latency |
| --------- | -------------------------------------------------------- | -------------- | -------------------- | --------------------- |
| baseline  | 8,984 – 9,010                                            | 9,136          | 20,062               | 3,313 ms              |
| CPU 4x    | —                                                        | 17,160         | 65,343               | 3,325 ms              |
| CPU 6x    | —                                                        | 9,953          | 87,069               | 3,319 ms              |
| Slow 4G   | 5,852 – 25,047                                           | 23,295         | 37,309               | 3,318 ms              |
| Slow 3G   | 20,554 – 80,864                                          | 74,700         | 103,337              | 3,322 ms              |

At Slow 3G the shards take a minute, and they still land before the Bot's
first window: the pregame (coin toss, mulligans) covers them. `warmBrain` /
`primeBrain` do what they were built for; no cold-cache miss reached a
consult. **The 1.4 MB figure in the issue was not reproduced:** this game's
Manifest (a Premodern mirror) is 11 set shards plus the dictionary, 169 KB compressed. A deck drawing
on more sets fetches more shards; none was tried.

## 3. The failure: a parked subscription and three skipped decisions

During the 4x game, at 11:58 (Rome), the local backend logged
`Q(game:getPublicState)` and `Q(cardPrints:populated)` failing with **"Your
request timed out performing too many system operations"**, after several
queries and mutations took 8–9 s (the runner at load ~52). The driver's
`useResilientQuery` retries only errors whose message matches
`TRANSIENT_PATTERNS` (`src/lib/transient-query-error.ts`); this message
matches none ("execution timed out" is the nearest), so the first failure
parked the subscription for good and the board showed **"The Bot lost
contact with the game. Reconnect"**.

With the driver dead, the server backstop (`convex/botDeadline.ts`) took
over: three `deadline-expired` system reports, `origin: server-deadline`,
"no client hand-off — driver dead or tab closed", at 11:58, 11:59 and 12:00 —
three Bot decisions passed by the server instead of searched. The game moved
again only after Reconnect was clicked.

The trigger here is a loaded backend, not a weak client; the gap it exposes
is the client's: one query error on a slow round-trip is enough to stop the
Bot until the player notices a banner. In a production deployment the
message a client sees for a server-side failure may be redacted, which would
not match `TRANSIENT_PATTERNS` either — not verified here.

## 4. The field: Gecko on macOS, the same morning

Production reports (`gameId:jh7*`) read in Sentry over 2026-11-21; all
desktop, `5-8` cores.

| report (Rome) | game     | engine | searches | iterations / search | ms / iteration p50 | p90      | first    | consult p90 | consult max  |
| ------------- | -------- | ------ | -------- | ------------------- | ------------------ | -------- | -------- | ----------- | ------------ |
| 11:31         | jh73x8ad | gecko  | 16       | 185                 | 17.19              | 33.07    | —        | 3,353 ms    | 3,431 ms     |
| 11:40         | jh73x8ad | gecko  | 38       | 67                  | 50.06              | 116.03   | 58.16    | 3,427 ms    | 3,532 ms     |
| 12:08         | jh7396nx | gecko  | 43       | **39**              | **342.27**         | 925.5    | 30.72    | 4,099 ms    | **5,046 ms** |
| 12:17         | jh7396nx | gecko  | 11       | **55**              | **471.88**         | **1658** | **3567** | 3,819 ms    | 4,327 ms     |

The consult timeout is `HARDEST_SEARCH_TIME_MS` (3,300) +
`BRAIN_CONSULT_OVERRUN_MARGIN_MS` (1,500) + `BRAIN_CONSULT_TRANSPORT_MARGIN_MS`
(500) = 5,300 ms (`src/lib/ai/consult-timeout.ts`). The lab's claim that
"the overshoot is one iteration" (`brain-search-off-the-dev-machine.md`,
verdict 3) holds; what fails is the size of one iteration: 1,658 ms at p90
and 3,567 ms for the first one are each larger than the 1,500 ms margin. A
search whose cap falls just after a long iteration starts overruns the
timeout. Nothing timed out yet; the slowest consult had 254 ms to spare.

Both Gecko games sent two reports each (the same game id, minutes apart);
whether a page-hide flush followed by more play explains it was not checked.

## Not measured

- **The search on a throttled CPU in a real browser.** DevTools' CPU
  throttling, set on the page target over CDP, does not reach dedicated
  Workers (§ verdict 2). Reaching the Brain needs throttling the Worker
  target itself (CDP `Target.setAutoAttach` on the page, then
  `Emulation.setCPUThrottlingRate` on each worker session — untried, may be
  unsupported), or a genuinely slow device. The lab bench's synthetic
  slowdowns (`brain-search-off-the-dev-machine.md` § 2) remain the only
  numbers for a slow core.
- **A phone.** Owed by the owner: a vs-Bot game at `expert` on a phone, read
  from its `bot search` report (`device.mobile` now reads true on a phone
  since issue #10022).
- **Memory pressure on a mobile tab** — not reproducible on a desktop
  browser.
- **WebSocket under network emulation.** The game's Convex traffic is a
  WebSocket to `127.0.0.1:3210`; how much of Chrome's network emulation
  applies to its frames was not measured. The games progressed in both
  network conditions, so mutations round-tripped; their latency was not read.
- **One game per condition.** No variance; the table reads a regime, not a
  distribution.

## Reproduce

Build and serve the client from a worktree (not the shared checkout):

```bash
bunx vite build --outDir "$SCRATCH/dist" --emptyOutDir
bunx vite preview --outDir "$SCRATCH/dist" --port 5173 --strictPort
```

Then, per condition: a new isolated browser context, `emulate` the
condition, sign in, navigate to `/play/constructed` with an init script that
wraps `window.Worker` (timestamps on `postMessage` and `message`), set up
Arena · Bot · Premodern · Bo1 · `Stompy`, pass through the game, concede,
and read the last `ingest.sentry.io` envelope from the network panel.
Server-side faults: `bunx convex data bugReports --order desc` in the primary
checkout.
