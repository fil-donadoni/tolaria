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
