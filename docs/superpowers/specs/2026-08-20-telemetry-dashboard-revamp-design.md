# Telemetry dashboard revamp — design

Date: 2026-08-20
Status: approved in chat, pending implementation plan
Surface: `scripts/telemetry-dashboard.html`, `scripts/telemetry-serve.ts`,
`scripts/lib/loop-status.ts`

## Why

The dashboard is written in the engine's own vocabulary, not a human's. Two
failures, both observed:

1. **No at-a-glance verdict.** On the night of 2026-08-19 the AFK driver died
   at 00:58 holding five claims, and stayed dead for eight hours. The
   dashboard reported this as `armed · no driver pid · no stop-file` — eleven
   grey pixels of subtitle, third clause, no colour, no emphasis. The operator
   read the page and saw nothing wrong.
2. **Machine shorthand as UI text.** A non-exhaustive census of what the page
   renders today:

    | rendered today                       | what it means                                  |
    | ------------------------------------ | ---------------------------------------------- |
    | `pct 62.699807482999994`             | context window used, 63%                       |
    | `queue 180→178 · -`                  | queue depth before→after, no note              |
    | `Batch bbdbad93-4057-…-e2882 (389)`  | batch id, 389 receipts                         |
    | `missing missing: 389`               | role `missing`, outcome `missing`              |
    | `impl '` / `rev $` / `fix ×`         | implement minutes / review cost / fixup rounds |
    | `sup '` / `lat '` / `orch $`         | support minutes / latency / orchestrator cost  |
    | `Family × role`                      | agent family × role                            |
    | `spans` / `cmd_bucket` / `model_req` | dataset and dimension names                    |
    | `×` / `?` marks in the claims table  | orphaned / unsure claim                        |

Neither is a wording bug alone. The page has no information hierarchy: an
operational alarm and a retrospective cost breakdown carry identical visual
weight.

## Decisions taken (chat, 2026-08-20)

| #   | Decision                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------- |
| D1  | Two explicit modes — **Now** (operations) and **History** (analysis) — rather than one blended scroll |
| D2  | Now leads with a **verdict**, then **four traffic lights**, then a **timeline**                       |
| D3  | All UI text in English (repo rule: `.claude/rules/frontend-components.md`)                            |
| D4  | The dashboard may **act**, limited to safe reversible operations behind a confirmation dialog         |
| D5  | "Shortcut" means all three: expanded abbreviations, keyboard shortcuts, navigation jumps              |
| D6  | History gets the same clarification work as Now — labels, fields, subtitles, tooltips                 |
| D7  | Tabs in one page (`?view=now\|history`), assets split out of the single 1769-line file                |

## Architecture

The data split is already clean and is not redesigned:

- **Now** reads `GET /api/loop-status` only. No database. It must render when
  `telemetry.db` is absent — that property is load-bearing today and is kept.
- **History** reads `telemetry.db` through `/api/meta`, `/api/issues`,
  `/api/sessions`, `/api/families`, `/api/runs`, `POST /api/q`, scoped by the
  filter bar.

So the filter bar and the metric tiles belong to History; the existing
`loop-status` card grows into the whole of Now.

### File layout

`scripts/telemetry-dashboard.html` (1769 lines, HTML + CSS + JS inline)
becomes:

```
scripts/dashboard/
├── index.html        shell: header, tabs, mount points
├── dashboard.css     tokens + components (moved verbatim, then extended)
├── glossary.js       the single term → prose map (§ Glossary)
├── common.js         esc, formatters, tooltip engine, keyboard layer
├── now.js            verdict, lights, timeline, claims, batch
└── history.js        filters, tiles, issues, sessions, families, charts
```

`telemetry-serve.ts` gains one static route, `GET /assets/<name>`, serving
only from an explicit allow-list of the filenames above — no path join with
user input, no directory walk.

No build step is introduced. The files are plain ES modules loaded with
`<script type="module">`.

## Now

Vertical order, top to bottom.

### 1. Verdict band

One state, large, with a plain-English cause and an action.

| verdict           | condition                                                         | example line                                                              |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `RUNNING`         | driver pid alive                                                  | "Pass 2 running for 14 min — 3 issues claimed, 1 PR open"                 |
| `IDLE`            | armed, no driver, queue empty                                     | "Nothing to do — the queue is empty"                                      |
| `STOPPED`         | stop-file present                                                 | "Stopped on purpose — resume when you want"                               |
| `STALLED`         | armed, driver not alive, queue non-empty                          | "The driver died 8h ago. 195 issues are still waiting."                   |
| `NEEDS ATTENTION` | orphaned claims, failed reads, or a pass that died holding claims | "4 issues were claimed 12h ago and never opened a PR. They block 9 more." |

Precedence when several hold: `NEEDS ATTENTION` > `STALLED` > `STOPPED` >
`RUNNING` > `IDLE`. A blocked-tree fact is worth more than a liveness fact,
because a live driver with orphaned claims still makes no progress.

**New health rules**, each encoding the 2026-08-19 incident:

- `driverDead` — armed, pid absent or not alive, queue non-empty → `STALLED`.
- `passDiedHoldingClaims` — a drain pass with `exit 0` whose
  `queueBefore > queueAfter` (it claimed) but which produced no merge and left
  claims standing. Today this is logged as `no-progress`, which reads as "there
  was nothing to do". It is the opposite: there was work, and it was lost.
- `blastRadius` — for each orphaned claim, how many open issues name it in
  their `## Blocked by`. This is the number that made last night expensive:
  two orphans froze nine children.

**Orphan detection is NOT re-derived.** `classifyClaim` in `loop-doctor.ts` is
already the sole authority, and `loop-status.ts`'s header comment makes
importing it rather than re-deriving it an explicit acceptance criterion. It
returns `orphan` for a claim with no branch and no PR older than
`minAgeHours = 2`, `suspect` below that age, `live` otherwise. The verdict
band consumes that verdict; it never computes its own age threshold, and the
claims table's amber band reads the same constant. What the verdict adds is
only the aggregate — how many orphans, and their blast radius.

Each verdict renders: the word, the sentence, and the remedy — an action
button where D4 allows one, otherwise a copyable command.

### 2. Four lights

`Driver` · `Queue` · `Claims` · `Batch`. Each is a colour, one number and one
line of prose. Clicking a light scrolls to and highlights its detail section.

### 3. Timeline (last 24h)

A horizontal strip, time on the x-axis:

- **passes** as blocks — green (landed something), grey (ran, landed nothing),
  red (killed / died holding claims)
- **claims** as pins at the moment of claiming, with a tail to their release
  or to now
- **merges** as ticks

Hover gives the same human sentence the verdict band uses. This is the object
that would have made last night legible in one look: five pins with no
release, and a red block at 22:40.

### 4. Claims table

| today                  | becomes                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `×` / `?` / `·` marks  | `orphaned` / `unsure` / `working` as words, with the reason as tooltip |
| `pri`                  | `Priority`                                                             |
| `stage: branch pushed` | `Branch pushed, no PR yet`                                             |
| `stage: PR open`       | `PR open, waiting for review`                                          |
| `stage: merging`       | `Approved, merging`                                                    |
| `age: 23.8h`           | `23h ago`, amber past `classifyClaim`'s `minAgeHours`                  |
| bare row               | a `blocks N others` badge when blast radius > 0                        |

### 5. Batch

`Batch #389 · started 22:24` — the UUID moves into a tooltip with a copy
button. Receipt counts render as `389 receipts · 4 implement, 2 review, 383
missing session markers`, not `missing missing: 389`.

## History

Same clarification work, applied to every label the page renders (D6).

### Datasets and dimensions

| raw          | label            | subtitle / tooltip                                                 |
| ------------ | ---------------- | ------------------------------------------------------------------ |
| `spans`      | Tool calls       | One row per tool invocation — how long each call took              |
| `llm`        | Model messages   | One row per request to a model — tokens and cost                   |
| `agent_runs` | Agent runs       | One row per subagent run — its whole lifetime                      |
| `cmd_bucket` | Command          | Which slash command or prompt started the work                     |
| `model_req`  | Model requested  | The model the caller asked for (not always the one that served it) |
| `agent_type` | Agent type       | Which subagent definition ran                                      |
| `effort`     | Reasoning effort | low / medium / high / xhigh / max                                  |
| `surface`    | Surface          | Where the request came from — main loop, subagent, hook            |
| `kind`       | Call kind        | Read, write, search, execute …                                     |
| `role`       | Role             | implement / review / fixup / investigate / …                       |

### Metrics

| raw                  | label          | tooltip                                                |
| -------------------- | -------------- | ------------------------------------------------------ |
| `calls`              | Tool calls     | How many tool invocations                              |
| `total_seconds`      | Total time     | Summed wall-clock, not billed time                     |
| `avg_seconds`        | Average time   | Mean per call                                          |
| `max_seconds`        | Slowest        | The single longest call                                |
| `messages`           | Messages       | Requests sent to a model                               |
| `cost_usd`           | Cost           | US dollars, from the published per-token rate          |
| `output_tokens`      | Output tokens  | Tokens the model generated                             |
| `input_tokens`       | Input tokens   | Tokens sent, cache reads excluded                      |
| `cache_read_tokens`  | Cache reads    | Prompt tokens served from cache — billed at a discount |
| `cache_write_tokens` | Cache writes   | Prompt tokens written to cache — billed at a premium   |
| `avg_output_tokens`  | Average output | Mean generated tokens per message                      |
| `runs`               | Runs           | How many subagent runs                                 |
| `avg_cost_usd`       | Average cost   | Mean dollars per run                                   |

### Issues table columns

| today             | becomes                     |
| ----------------- | --------------------------- |
| `impl '`          | Implement (min)             |
| `impl $`          | Implement ($)               |
| `rev '` / `rev $` | Review (min) / Review ($)   |
| `fix ×`           | Fixup rounds                |
| `fix '` / `fix $` | Fixup (min) / Fixup ($)     |
| `sup '` / `sup $` | Support (min) / Support ($) |
| `lat '`           | Wall-clock latency (min)    |
| `out tok`         | Output tokens               |
| `tier`            | Model tier                  |
| `total $`         | Total cost                  |

### Sessions table columns

| today                                    | becomes                                  |
| ---------------------------------------- | ---------------------------------------- |
| `wall`                                   | Wall-clock                               |
| `impl '` / `rev '` / `fix '` / `other '` | Implement / Review / Fixup / Other (min) |
| `orch $`                                 | Orchestrator cost                        |
| `PRs`                                    | PRs opened                               |

### Family × role

Titled **Agent family × role**, subtitle "How cost splits across the agent
families and the role each run played". Every column header carries the role
tooltip from the dimensions table above.

### Section subtitles

Each card gains a one-line subtitle stating what question it answers, e.g.
Over time → "How the selected metric moved day by day", Ranking → "Which
values of the current split-by dimension cost the most".

## Glossary

`glossary.js` exports one map, term → `{ label, tooltip }`. It is the single
authority for every abbreviation the UI renders, and it is consumed by:

- History's dimension/metric selects and table headers
- Now's stage and verdict names
- the tooltip engine, which attaches to any element carrying `data-term`

A test asserts completeness: every `ClaimStage`, every verdict, every key of
`DIMENSIONS` and `METRICS` in `telemetry-serve.ts` resolves to a glossary
entry. A new dimension added server-side without a human label fails the
suite.

## Shortcuts (D5)

**Keyboard.** `1` Now · `2` History · `r` refresh · `/` focus the search box
of the visible view · `?` toggle the shortcut sheet · `Esc` close any overlay.
Bound on `document`, suppressed while a text input has focus.

**Navigation.** Clicking a traffic light scrolls to its section. An issue
number links to GitHub. The view, and History's filter state, live in the URL
query so a link is shareable.

## Actions (D4)

`POST /api/action`, body `{ action, args, token }`.

Allow-list, all reversible:

| action          | effect                                           |
| --------------- | ------------------------------------------------ |
| `driver.stop`   | writes the stop-file (`bun run loop:afk --stop`) |
| `driver.resume` | clears the stop-file and starts a driver         |
| `claim.release` | removes `in-progress` from one issue             |

Everything else — arming, disarming, bulk release, merges — stays a copyable
command.

**Guards**, all three required:

1. The server already binds `127.0.0.1` only; that stays.
2. A token generated at server boot, injected into the served HTML, required
   on every POST. This stops any other local process from driving the loop by
   guessing the URL.
3. An `Origin` check, to close browser-side cross-origin posting.

Each button opens a confirmation dialog naming the exact effect ("Remove the
`in-progress` label from #2582. The next pass may claim it again.").

## Testing

| what                  | where                                               | how                                                                                                                                                                   |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeVerdict`      | `scripts/__tests__/loop-status.test.ts`             | pure function in `lib/loop-status.ts`, so `bun run loop:status` and the dashboard cannot diverge — the same reason `classifyClaim` is imported rather than re-derived |
| the incident fixture  | same                                                | armed, no live pid, queue 195, 5 claims at 12h, 0 PRs → `STALLED` **and** a `passDiedHoldingClaims` finding                                                           |
| blast radius          | same                                                | an orphaned blocker with N dependents reports N                                                                                                                       |
| glossary completeness | `scripts/__tests__/dashboard-glossary.test.ts`      | every stage, verdict, dimension and metric name has an entry                                                                                                          |
| action endpoint       | `scripts/__tests__/telemetry-serve-actions.test.ts` | missing token rejected, wrong token rejected, unknown action rejected, bad Origin rejected, allowed action dispatches                                                 |

**Proof-of-failure is mandatory for each** (`.claude/rules/gre-development.md`
§ Proof-of-failure): break the subject, watch it go red, revert, record what
was broken in the PR description.

**Browser verification.** `bun run check:ui` walks the app's runbook surfaces
and does not reach `scripts/`, so it owes nothing here and its absence is not
a pass. Verification is a manual chrome-devtools-mcp pass over both views at
the five ADR-0101 viewports, with the probe receipt pasted into the PR.

## Out of scope

- Changing what telemetry is collected, or the ingest pipeline.
- Changing the drain loop's own behaviour. The `passDiedHoldingClaims`
  condition is _detected and displayed_ here; fixing the underlying
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` timeout is separate work.
- Authentication beyond the local token. The server stays loopback-only and
  single-user.
