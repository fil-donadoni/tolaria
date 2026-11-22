# Reproduce a Bot fault

A `[Bot Fault]` issue is filed by the system (PRD issue #8998): the Bot faulted
in a vs-AI game and the server force-advanced it. The issue body is public, so
it carries a board summary and a **report row id**; the frozen game state, the
client diagnostics and the raw error stay on the `bugReports` row.

## Start from the exact position

```bash
bun run bug-report:pull <reportId> --prod --out bug-report-<reportId>.json
```

The issue body prints this line with its own id filled in. It reads the row
through the internal `bugReports:getReport` (from the primary checkout, where
the deployment state lives) and lowers the frozen state with `specFromState`.
It prints one JSON object on stdout:

- `spec` — the position as a `ScenarioSpec`;
- `dropped[]` and `stackBlockers[]` — everything the lowering could NOT carry
  (a pending choice, a mid-flight payment, a stack item the spec has no field
  for). The spec is the position **minus** these: read them before trusting a
  replay;
- `clientDiagnostics` — a one-line-per-fact summary (build, Bot ring depths,
  console / failed-request counts). The full object: `bugReports:getReport`.

`--out` writes `{ "label", "spec" }`, the shape a `## Preset scenario` fence
and the debug-scenario panel take. `--seat <playerId>` picks which seat is
`"me"`; the default is the human `-p1` seat (the Bot is `"opp"`). Without
`--prod` it reads the local deployment.

Exit 1 with a message: no such row, or a row with no state (a user report
filed outside a game, or with diagnostics declined) — nothing to lower.

It works on user-button rows too (`/admin/bug-reports` shows their id).

## When the Bot passed instead of faulting

A Brain consult that gives no answer (`search-error`, `worker-error`,
`timeout`) never files a `[Bot Fault]`: the driver's ladder passes legally, so
the game moves on (issue #9502). Each such consult is counted server-side,
with no consent-gated payload, against the game:

```bash
bunx convex run botLiveness:getConsultFailures '{"gameId":"<gameId>"}' --prod
```

`null` = the Bot never failed a consult in that game. Otherwise per-outcome
counters plus the most recent samples (state `seq`, turn, phase, whether a
land drop was legal, the truncated Brain message). A report filed with a game
id carries the counters on `bugReports:getReport` as `botConsultFailures`.

## When the Bot played weakly: was it cut short?

A Bot that answers every consult can still be starved: the search stops at its
wall-clock cap long before its iteration budget, and nothing fails. Every
vs-Bot game reports once how its searches went on the player's device (issue
#9526) — a structured log named `bot search`, counters and a coarse device
class only, no consent-gated payload. The report goes out at game over, when
the game is left (30 s after the board unmounts, so a remount continues the
same report), or when the page is hidden or closed, whichever comes first
(issue #10022); a game whose page was hidden mid-play reports only the part
before it. A game with no Brain consult has no report.

Read one game in Sentry (Explore → Logs):

```
message:"bot search" gameId:<gameId>
```

| Attribute                                                          | Reads as                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `iterations.ratio`                                                 | completed / requested over the game's searches: 1 = as tested    |
| `stopped.time` / `.iterations` / `.settled`                        | how many searches the clock ended, against the other two stops   |
| `msPerIteration.p50` / `.p90`                                      | the device's speed over every board the game reached             |
| `msPerIteration.first`                                             | the device's speed at the game's first search: an early board    |
| `probesPerIteration.p50`                                           | what the boards cost: candidates the rollout tried per iteration |
| `msPerProbe.p50`                                                   | what the machine made of them: time per candidate tried          |
| `idleMs.p50`                                                       | the time the Worker sat idle between two consults                |
| `calibration.first` / `.last` / `.min` / `.count`                  | the machine itself: a fixed search on a fixed board, in ms       |
| `searchMs.*` against `consultMs.*`                                 | the gap is what stood before the search (Worker start, a queue)  |
| `consults.timeout` / `.worker-error` / `.search-error` / `.inline` | consults that gave no answer, or ran in-thread                   |
| `device.engine` / `.os` / `.cores` / `.mobile`                     | engine family, OS family, core bucket, phone or iPad             |

Across games, group the same query by `device.engine`, `device.os` or
`device.cores` and average `iterations.ratio`. A ratio between two engines is
read on `msPerIteration.first` within one `device.os` (issue #10128): later
boards cost more, so `.p50` makes a long game read slower on the same machine,
and the OS family tells the machines behind the engines apart.

**A slow game: costly boards, or a slow machine?** (issue #10321) A probe is
one candidate move the rollout cloned, applied and evaluated; on a late board
the probes are most of an iteration. Many probes per iteration
(`probesPerIteration.p50`) with an ordinary time per probe is a game that
reached costly boards. A high `msPerProbe.p50` is a slow or busy machine.
The time per probe is the search's whole time over its probes: it carries
the tree's own work too, so it reads high on a search of few iterations
(compare searches of similar `iterations.completed`). `idleMs` is read only
between two consults the Worker itself answered: after a timeout, a failure
or an in-thread consult the next one has none.
The `calibration.*` keys hold the board still (issue #10451): the Worker
times the same fixed search (8 iterations, capped at 50 ms) on the same small
board after each of the game's first three consults and then at most every
30 s, in milliseconds per iteration. The first readings run colder (the
browser is still compiling that code), and a cold run the cap cut short
covered fewer iterations, a different workload: `.first` is biased high and
says little alone. `.min` is the machine at its best and the number to
compare two machines on; `.last` against `.min` says whether the machine
slowed down during the game. No reading follows a search whose last
iteration ran more than 300 ms past its cap, so a game stuck on very slow
boards stops taking them.

**One decision at a time.** Each consult also records a span named
`bot.consult` (Explore → Traces, `span.op:bot.consult gameId:<gameId>`), in
order (`consult` = 1, 2, …), under the same boundary as the report: counters,
durations, the turn and step, the device class.

| Span attribute                                     | Reads as                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| `consult`                                          | the consult's place in the game on this page          |
| `outcome` / `via`                                  | how it ended, in the Worker or in-thread              |
| `consultMs` / `searchMs`                           | posting to verdict, and the search inside it          |
| `idleMs`                                           | the time since the previous consult's verdict         |
| `iterations.requested` / `.completed`, `stoppedBy` | what the search asked for, got, and what stopped it   |
| `msPerIteration`                                   | this decision's speed                                 |
| `probes` / `msPerProbe`                            | candidates the rollout tried, and the time per one    |
| `turn` / `phase` / `permanents`                    | where the game was, and how many permanents stood     |
| `calibration`                                      | the game's latest calibration reading at that consult |
| `gameId`, `difficulty`, `device.*`                 | as on the report                                      |
