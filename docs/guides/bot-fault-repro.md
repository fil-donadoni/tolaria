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
vs-Bot game reports once, at game over or when the game is left, how its
searches went on the player's device (issue #9526) — a structured log named
`bot search`, counters and a coarse device class only, no consent-gated
payload. A game with no Brain consult, or whose tab was closed mid-play, has no
report.

Read one game in Sentry (Explore → Logs):

```
message:"bot search" gameId:<gameId>
```

| Attribute                                                          | Reads as                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `iterations.ratio`                                                 | completed / requested over the game's searches: 1 = as tested   |
| `stopped.time` / `.iterations` / `.settled`                        | how many searches the clock ended, against the other two stops  |
| `msPerIteration.p50` / `.p90`                                      | the device's speed, comparable across games                     |
| `searchMs.*` against `consultMs.*`                                 | the gap is what stood before the search (Worker start, a queue) |
| `consults.timeout` / `.worker-error` / `.search-error` / `.inline` | consults that gave no answer, or ran in-thread                  |
| `device.engine` / `.cores` / `.mobile`                             | browser engine family, core-count bucket, mobile flag           |

Across games, group the same query by `device.engine` or `device.cores` and
average `iterations.ratio`.
