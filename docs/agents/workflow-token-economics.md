# Workflow token economics — baseline and projections

_Measured 2026-08-04 over the telemetry window **2026-07-11 → 2026-08-04** (24
days). Companion to PRD #2180. **This document exists to be checked against
reality later** — see § Next measurement._

## Why this exists

Every optimization decision recorded in `process-gh-issues/SKILL.md` up to this
point was an anecdote with a date attached ("observed 2026-08-04: it inverted
the bug key on half the queue"). Anecdotes are how the loop found its bugs, but
they cannot rank the fixes: they say a thing happened, not what it cost. This is
the first attempt at ranking the PRD #2180 work by measured token impact, and at
recording the projections precisely enough that a later pass can tell whether
they were right.

## Measured baseline

Source: `.claude/telemetry/tool-events.jsonl`, 188,639 events, 293 sessions.

| Quantity                            | Value                                                         | Method                            |
| ----------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| Sessions                            | 293 (88 "orchestrator-shaped": ran `gh issue list`)           | distinct `session_id`             |
| Tool calls                          | 92,974 Bash, 1,972 Agent, 130 Skill                           | `phase: "pre"`                    |
| Tool calls per session              | median 67, mean 325                                           | —                                 |
| Tool calls per orchestrator session | median 312, mean 872, p90 2,534                               | —                                 |
| Subagent run cost                   | median **105,317 tok**, p25 48k, p75 164k, p90 226k, max 333k | `tool_response.totalTokens`, n=24 |
| Subagent total (sample)             | 2,850,088 tok                                                 | same n=24                         |
| **cache_read share of input-side**  | **98.9%**                                                     | n=18 events reporting usage       |

### Unit costs of the artifacts the loop moves

Token estimate uses **3.5 chars/token** throughout.

| Artifact                                                                         | Size        | Tokens     |
| -------------------------------------------------------------------------------- | ----------- | ---------- |
| `gh issue list --json number,title,labels,parent,assignees,updatedAt --limit 60` | 31,820 char | **9,091**  |
| `gh issue view --json state,labels,body` (avg of 5)                              | 4,285 char  | **1,224**  |
| `bun run queue:plan` output                                                      | 5,002 char  | **1,429**  |
| `SKILL.md` (whole)                                                               | 64,865 char | **18,533** |
| — sections superseded by the planner                                             | 14,805 char | **4,230**  |
| — episodic sections (#2190 candidates)                                           | —           | **4,838**  |

### Observed volumes over the window

| Command class                                                                        | Count                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `gh issue list`                                                                      | 312                                           |
| `gh issue view` **inside** orchestrator sessions (= selection)                       | 1,776                                         |
| `gh issue view` outside them (= implementer reading its own issue)                   | 209                                           |
| full-gate invocations (`bun run test`/`check:*`)                                     | 3,981 — of which **2,819 piped into a pager** |
| targeted `vitest run`                                                                | 4,189 — of which **2,295 piped**              |
| force pushes                                                                         | 266 — of which **38 naming main**             |
| discarding git ops (`checkout --`, `stash`, `reset --hard`, `clean -f`, `commit -a`) | 584 (cwd unknown)                             |
| `gh pr merge`                                                                        | 391 (cwd unknown)                             |

### Queue health at measurement time

60 open `ready-for-agent` issues: **37 (62%) declare no `Target files` section**,
**30 (50%) have no parent edge**. Three PRDs (#2180, #2162, #2091) carried a
stray `ready-for-agent` label, found by the planner's first real run and
stripped.

## The finding that reorders everything

**98.9% of input-side tokens are cache reads.** A token that merely _sits_ in
context bills at roughly a tenth of a fresh one — but it is re-read on **every
request**. With a median of 312 tool calls per orchestrator session, 4,000
tokens of resident prose cost far more than 4,000 tokens of tool output read
once.

The practical consequence: **removing text from the always-loaded prefix beats
removing tool output**, which is the opposite of the intuition that ranked the
skill-decomposition work as a low-priority cleanup. Accounting below uses

```
input-equivalent = fresh × 1.0 + resident × 0.1
```

## Projections

Over the same 24-day window, had each change been in place throughout. Negative
= saving.

| #    | Change                                                            | Δ fresh     | Δ resident (input-eq) | **Net input-eq** | Confidence |
| ---- | ----------------------------------------------------------------- | ----------- | --------------------- | ---------------- | ---------- |
| 2189 | Prune the action space (~4,000 tok off every session's prefix)    | 0           | −25.3 M               | **−25.3 M**      | **low**    |
| 2184 | Loop consumes the planner; 4,230 tok of prose deleted             | −4.56 M     | −7.74 M               | **−12.3 M**      | **high**   |
| 2190 | Skill decomposition: 4,838 tok of episodic prose out of the frame | 0           | −8.85 M               | **−8.85 M**      | medium     |
| 2188 | Queue lint → batches stop degenerating to solo                    | −0.90 M     | 0                     | **−0.90 M**      | medium     |
| 2182 | Receipts on disk instead of in context                            | +0.04 M     | −0.21 M               | **−0.17 M**      | medium     |
| 2183 | Policy hooks                                                      | **+0.42 M** | 0                     | **+0.42 M**      | high       |
| 2185 | Train order from receipts                                         | +0.01 M     | 0                     | +0.01 M          | high       |
| 2187 | Scorecard (weekly)                                                | +0.01 M     | 0                     | +0.01 M          | high       |
| 2193 | Skill versioned in-repo                                           | 0           | 0                     | **0**            | high       |
|      | **Programme total**                                               | −5.4 M      | −42.1 M               | **−47.5 M**      |            |

### #2181/#2184 — the arithmetic, in full

```
before:   312 × 9,091   (gh issue list)              = 2,836,392
        1,776 × 1,224   (gh issue view, selection)   = 2,173,824
                                              total    5,010,216 fresh
after:    312 × 1,429   (plan JSON)                  =   445,848
                                            saving     4,564,368   (−91%)
```

Plus 4,230 tok of resident prose deleted: 88 orchestrator sessions × ~208
requests × 4,230 ≈ 77 M cache-read ≈ 7.74 M input-equivalent.

**#2181 alone saves nothing** — the planner exists but the loop still derives
its own batch. The saving is realised by #2184.

### #2189 — sensitivity (the widest error bars)

Two unknowns: the actual prunable mass in the system prompt, and the request
count (tool calls over-count requests; ~1.5 calls/request assumed → ~63k).

| prunable mass | 40k requests | 63k requests | 90k requests |
| ------------- | ------------ | ------------ | ------------ |
| 2,000 tok     | −8.0 M       | −12.6 M      | −18.0 M      |
| 4,000 tok     | −16.0 M      | **−25.3 M**  | −36.0 M      |
| 6,000 tok     | −24.0 M      | −37.9 M      | −54.0 M      |

Even the pessimistic corner outranks the planner, and the change is
configuration with no code and no tests.

### #2183 — a cost, and its break-even

The hooks add no tokens on the happy path (a `PreToolUse` hook that exits 0
emits nothing into context). The cost is entirely rule 3: each of the 2,819
piped full-gate invocations becomes a redirect plus a grep — one extra Bash
round-trip, ~150 tok → **+423 k**.

It pays for itself if it prevents **4** wasted subagent cycles out of 2,819
masked exit codes: 4 × 105,317 ≈ 423 k. That is a false-green rate of **0.14%**.

**Rule 3 was rescoped by this measurement.** As first written it also denied
piped `vitest run`, which telemetry showed is 2,295 of 4,189 targeted runs —
that would have made the rule a workflow change (a second round-trip on more
than half of all test invocations) rather than a safety net. It now covers only
the commands whose exit code _is_ the done/not-done signal.

## Caveats

- **n=24 for subagent cost.** 1,972 Agent spawns were recorded but only 24
  carried `tool_response` usage fields. The median (105k) is the best available
  figure and the least redundantly sourced one in this document.
- **Requests are inferred, not counted.** The telemetry records tool calls, not
  model requests. Every resident-token figure inherits that assumption
  (~1.5 calls/request).
- **The 3.5 chars/token divisor** is an average; dense JSON runs nearer 3.0 and
  prose nearer 3.8, so per-artifact figures carry roughly ±10%.
- **Cache reads assume prefix stability.** A change that invalidates the cached
  prefix mid-session converts resident tokens back to fresh ones at full price.
  None of the changes above rewrite the prefix, but a future one might.
- **`cwd` is not in the telemetry**, so the incidence figures for the rules that
  key off it (`gh pr merge` from an issue worktree, discarding ops in the main
  checkout) are _populations_, not counts of commands the rule would have
  blocked.

## Next measurement

**When the next telemetry analysis runs, its first job is to compare actuals
against the projections above** — not to produce a fresh ranking from scratch.
The point of writing the numbers down is to find out which of them were wrong.

Specifically:

1. **Re-measure the same baseline quantities** over the new window and record
   them in the same shape, so the two are comparable.
2. **For each landed change, compute the realised delta** and put it beside the
   projection. State the ratio. A projection that came in at 3× or ⅓ is more
   interesting than one that was right.
3. **Attribute the misses.** The three assumptions most likely to be wrong are,
   in order: the prunable mass in #2189, the requests-per-tool-call ratio, and
   the 105k subagent median (n=24). Any large miss probably lands on one of
   them — check those before inventing a new explanation.
4. **Look for what this pass could not see.** The measurement had no per-request
   usage data for the main loop, no `cwd` on Bash events, and no receipt data at
   all. #2182 (durable receipts) and #2187 (scorecard) exist precisely to close
   those gaps — once they have landed, the next pass should be able to compute
   per-issue cost directly instead of inferring it, which is itself a result
   worth recording.
5. **Then, and only then, look for new optimizations.** A ranking built on
   unvalidated projections would repeat this document's own methodological risk
   one level deeper.
