# The `/next-ticket` flow

What one session does from `/next-ticket` to a merged PR, and what the pipeline
does from there. The stages are `.claude/skills/next-ticket/SKILL.md`; the jobs are
[GitHub pipeline](github-pipeline.md). Re-derive any number with
`bun run telemetry:latency`.

## 1. One session, one issue

```mermaid
flowchart TD
    P["1 · Pick<br/><code>queue:plan --cap 1</code> — refuses only on a RED tip<br/><code>gh issue view N --json …</code>"]
    C["2 · Claim + ephemeral worktree<br/><code>gh issue edit --add-label in-progress</code> · <code>cd $(wt:new N)</code>"]
    I["3 · Implement in this context<br/>read/edit · <code>bunx vitest run &lt;path&gt;</code> · commit · <code>base:drift --rebase</code><br/><b>engine/skin</b>: proof-of-failure, cr:ledger, scenario JSON, bot + frontend walks<br/><b>cards lane</b> (decided by the diff, read with <code>check:lane --plan</code>): definition, scenario, regenerated artefacts"]
    R["4 · Review — one round, the session waits<br/>opus for any code, none for docs<br/>blocking findings → fix here → targeted tests"]
    PR["5 · Push + PR<br/>body: scenario JSON, proof receipts, <code>check:ui</code> receipt or its one line"]
    HO["<code>land:ready</code> — seconds-cost lane steps + body refusals, then <code>ready-to-land</code><br/>the session reports and STOPS"]
    subgraph Q["The Mergify queue (no session)"]
        direction TB
        Q1["entry statuses: <code>trusted-author</code>, <code>base-health</code>, advisory <code>check:lane</code>"] --> Q2["rebase into a draft"]
        Q2 --> Q3["<code>queue-lane</code>: <code>check:lane</code> on that tip, one flaky re-run"]
        Q3 --> Q4["merge"]
    end
    POST["<code>post-merge</code><br/>seed the scenario · sync machines · <code>derive:sync</code> · release the claim"]
    H["<code>health</code> — per batch<br/>at the 20th landing since the newest verdict; 2-hourly cron and heartbeat as the fallback"]
    REL["<code>release</code> — a human's dispatch<br/>requires GREEN on the exact base tip · fast-forwards the release branch"]

    P --> C --> I --> R --> PR --> HO --> Q --> POST
    R -. "blocking findings" .-> I
    HO -. "red → fix in this session" .-> I
    Q3 -. "regenerable → <code>pr-fixup</code>" .-> Q2
    Q3 -. "red → <code>land-failed</code> → a repair pick" .-> P
    POST --> H
    H -- "GREEN" --> REL
    H -. "RED → the ladder" .-> L["flake check → bisect → revert the culprit → reopened issue's pass"]
```

Step 3's two paths are chosen by the classifier, never by the session:
`bun run check:lane --plan` prints the lane and runs nothing. A session that finds
itself writing a test on a `cards` diff has found an unexercised Op and stops
(`/new-op`).

A session never runs the lane before the hand-off (ADR 0136 §1): the base moves
under a pre-PR gate, and it would be paid twice. `land:ready`'s seconds-cost steps
catch what the session can still fix for free.

## 2. The rules of a RED

- **Who sees it**: `health` writes the `health` commit status on the gated sha.
  `queue:plan` and [`base-health`](github-pipeline.md#g-base-health) read
  it through the verdict store, on every machine.
- **What stops**: new picks, and the queue for every PR that is not a declared
  repair. A queued PR is [held](github-pipeline.md#a-red-dequeue-is-a-hold), never
  blamed, and the GREEN requeues it. A session mid-issue finishes and hands off.
- **What runs**: the [RED ladder](github-pipeline.md#g-red-ladder) reverts a named
  culprit first; fix-forward is the reopened issue's pass (ADR 0158). `health-fix`
  takes what it cannot name, `bun run health:fix` by hand. A declared repair's tip
  is proven by the RED's own evidence (ADR 0156 Amendment V).
- **Coverage**: health gates the tip current at its start, so one run covers
  everything landed meanwhile.

## 3. Project skills only — the one local step

Tolaria's skills are the project skills (ADR 0150): committed
`.claude/settings.json` disables the `superpowers` plugin and hides every
machine-level skill, and `scripts/__tests__/project-skills.test.ts` fails on a
machine-level skill that is neither hidden nor a project skill — add
`"<name>": "off"` under `skillOverrides` (or adopt the skill into
`.claude/skills/` by copying it in).

Skills synced from the owner's claude.ai account (`~/.claude/skills/synced/`)
cannot be switched off from committed settings. If one shows up in a session,
hide it locally, once, in `.claude/settings.local.json` (gitignored):
`{ "skillOverrides": { "<name>": "off" } }`. Not gated.

## 4. AFK: the same flow, in jobs

[`afk-dispatch`](github-pipeline.md#afk-dispatch) picks as many issues as there
are free `pass` runners, claims each and dispatches
[`afk-pass`](github-pipeline.md#afk-pass), which runs `/next-ticket` for that one
issue ([A pass inside a job](github-pipeline.md#a-pass-inside-a-job),
`.claude/skills/next-ticket/job.md`). When a pass ends, it dispatches the
dispatcher again.

- **Parallelism** is the number of `pass` runners online. Pause a machine with
  `bun run runner pause`; the other carries the queue.
- **Depth**: no new pick while `ready-to-land` PRs reach `afkDispatch.queueMax`,
  repairs only past `afkDispatch.failedMax` (issue #6988).
- **A dead pass** is resumed by the dispatcher from its pushed branch.
- **Watching**: the Actions tab, `bun run cockpit`, `bun run runner status`.
