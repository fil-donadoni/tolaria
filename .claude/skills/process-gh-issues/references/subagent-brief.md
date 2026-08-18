# Implement-subagent brief

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

The implement / fixup subagent reads this file itself. The orchestrator passes the PATH, never the
contents — this is the single biggest thing the frame does not have to carry.

---

**Subagent task (runs entirely in the subagent's context):**

1. **Create an isolated worktree + branch.** Branch name: `fix/issue-N` (bug) or `feat/issue-N` (enhancement). Never work in the shared main checkout — a concurrent process may be editing it. Spin up a dedicated worktree instead:

    ```bash
    # from the repo root; branch off the current default branch's tip
    git worktree add ../<repo>-issue-N -b fix/issue-N
    cd ../<repo>-issue-N
    ```

    - `../<repo>-issue-N` is a sibling dir outside the main checkout — it gets its own working files, so parallel processes never clobber each other.
    - **`git worktree add -b` is the atomic ownership claim.** If it fails with **`branch already exists`**, that is the last-line collision signal (SKILL.md §1b): another session claimed this issue between the orchestrator's probe and now. **Probe before assuming it's a resumable WIP:**

        ```bash
        git ls-remote --heads origin feat/issue-N        # remote branch present?
        gh pr list --state open --json headRefName | grep issue-N   # open PR?
        ```

        - **Remote branch or open PR exists → another live session owns it. ABORT immediately.** Do NOT create the worktree, do NOT reuse the branch, do NOT delete or force anything. Return a `collision` receipt (`outcome: failed`, reason "branch/PR owned by another session") so the orchestrator backs off and leaves the issue to its owner.
        - **Only** when there is **no remote branch and no open PR** (a purely local branch left by a _crashed_ prior attempt of your own loop) may you resume it with `git worktree add ../<repo>-issue-N feat/issue-N` (no `-b`).

    - **Bootstrap the worktree — first command, before anything else.** A fresh worktree is missing every gitignored runtime input: deps (`node_modules`/`vendor`), generated client/codegen output (e.g. `convex/_generated`), the local env file (`.env.local`), and the git-hook shims (`.husky/_`, whose absence silently skips `lint-staged` so prettier drift reaches the merge-train). Without the generated client, hundreds of test files fail at _import_ (`Cannot find module './_generated/api'`) — the tell is **`N files failed, 0 tests failed`**, a setup error that reads as a catastrophic red baseline and will send you debugging the wrong thing.
        - **Tolaria: `bun run worktree:init`** (idempotent; `--force` re-copies). It does all four.
        - Other projects: install deps, then copy the codegen dir + env file from the primary checkout by hand.
    - **All remaining steps run inside this worktree**, never in the main checkout.

2. **Abort-on-red check (green-main invariant, SKILL.md §0) — with gate-dedup skip.** If the branch tip equals the **verified-green SHA** passed in the prompt, skip this check entirely (that exact tree already passed the baseline — same tree, same result). Otherwise run the full suite on the fresh branch: if the pre-existing failure set is **non-empty** (reds you did not introduce), abort immediately — do not implement on top of red. Return a `failed` receipt naming the reds. "Not my test" is never an exemption.
3. Fetch and read the full issue body (`gh issue view N`) — acceptance criteria are the spec. If the body references a `Parent #N`, fetch and read `#N` (the PRD) as **additional spec/context** — the user stories, implementation and testing decisions there frame this slice. Read it, do **not** implement it wholesale.
    - **Context discipline — keep your own context lean (measured lever).** Telemetry shows implement subagents balloon to a **228k median / 600k peak** context, driven not by the handed-in prompt (~43k) but by **inline tool-call volume** — a single heavy run logged 113 `grep`s + 95–142 `Read`s, each result resident for the rest of the run. So: **(a) delegate codebase location/mapping to a `caveman:cavecrew-investigator` sub-agent** (spawn it via the `Agent` tool, `model: sonnet` — the plugin's copy pins no model of its own) instead of grepping/globbing the tree inline — its file dumps stay in _its_ context and only the compressed `file:line` map returns to you. Reserve your own `Read` for the handful of files you will actually edit. **(b) Pipe noisy `Bash` through a filter** — `… | tail -20`, `bunx vitest run <path> 2>&1 | tail -30`, `grep -n` over a full-file cat — so a failing suite or a build log never dumps in full. That applies to a **targeted** run only: `deny-guard.sh` §3 denies a gate command (`bun run test`, `check:all`, `check:pr`, `land`, …) piped into a pager, because the pipeline's exit code becomes the pager's and a red gate would report success — redirect a gate to a file and `grep` that instead (`bun run test >/tmp/gate.log 2>&1; grep -E 'Tests|FAIL' /tmp/gate.log`). **(c) One search question = one investigator**, not a fresh grep each time you wonder where something lives. A lean implement context is cheaper _and_ sharper (less noise to reason over).
    - **Convergence cap — stopping is a legitimate outcome, grinding is not.**
      The cost of a run is roughly quadratic in its length (every message
      re-reads everything before it), and the expensive tail of implement runs
      is a handful of agents that never got told stopping was allowed: one
      2026-08-06 run spent 284 messages and a 246k average context on a card it
      still did not finish. Concrete stop-rule — if **either** (a) you are on
      your **third failed gate/fix cycle** on the same failure, or (b) the work
      has grown past the issue's acceptance criteria (a missing capability, a
      seam that needs design), then **stop**: write a `wip` receipt stating
      precisely what is done, what remains, what you learned (including the
      failing test names and your best hypothesis), and return. A precise
      partial receipt lets the orchestrator respawn a fresh, cheap, targeted
      agent — or escalate the tier — which is strictly better than doubling
      down inside a bloated context.
4. **Producer census — MANDATORY before implementing, whenever the issue widens an input space.** Triggers: a new event type / trigger condition, a new hook or seam other code feeds, a new field on a shared record, a new `*.type` union member, a new predicate other call sites must satisfy. In all of these the hard part is **not writing the code — it is classifying what already flows in**, and that is precisely what a guard checklist cannot check for you.

    Before writing any implementation:
    1. **Enumerate every producer.** Grep every site that can raise/emit/produce the thing, and read each one. Not "find the choke point" — a single funnel is necessary but says nothing about the traffic through it. Delegate the sweep to a `caveman:cavecrew-investigator` (`model: sonnet`) to keep your context lean.
    2. **Tabulate the semantics.** One row per site: which field means what, who the acting party is, and — the load-bearing column — **should this one count, yes or no**. Sites that reuse a shared kind/type for a _different_ meaning are the bug: they look identical to a `kind ===` check and are not.
    3. **Put the table in the PR description**, and name any site you deliberately excluded plus why.
    4. **Derive the tests from the table, one row = one test** — explicitly including the must-NOT rows. Tests written from the implementation inherit the implementation's assumptions and cannot falsify them; tests written from an independently-built census can.
    5. **Prefer an explicit, fail-closed discriminator** over an implicit invariant ("today every real one leaves field X unset"). Implicit invariants fail _open_ the moment someone adds a producer that doesn't know about them.

    Skipping this is the single most expensive failure mode this loop has: three consecutive `blocking` review rounds on one PR, each finding a producer the implementer never read (a searcher/owner mix-up, a regression in two shipped cards, and a choice-kind overloaded by two more) — every round green on the local gate, because the tests shared the bug's premise. The census is roughly 10 lines of table and would have pre-empted all three.

5. Follow project development cycle (CLAUDE.md § Development cycle), including its **quality-gate cadence** (CLAUDE.md § Quality gates): targeted tests while iterating, the full gate once before the PR. Use the commands documented there — do not re-specify or assume a tool here. **Work test-first at the agreed seams** (`/tdd` discipline: red → green → refactor) — write the failing test before the implementation wherever a natural seam exists, so the tests the gate later runs prove behaviour rather than restate it.
    - **Preset scenario — DB-direct, post-merge (mandatory for any new card / user-visible mechanic, CLAUDE.md step 7).** The DB is the single source of truth for debug scenarios — there is no code-array/file path (issue #1455). You are headless (no Debug panel), so you do NOT insert the scenario yourself. Instead **emit one `{ label, spec }` object in your PR receipt** (spec = `debugSetupScenario`'s args minus `gameId`; pick cards/zones/phase/`landCount` that hit the golden path, and make sure every card name resolves in the catalogue). The orchestrator registers it post-merge in SKILL.md §5. Skip ONLY for a pure refactor with no user-visible behaviour change.
6. **Pre-PR gate (light, mandatory).** When the implementation is complete, run: (a) the **targeted tests** for everything the diff touches (the issue's own tests + the suites of the modules it modifies), and (b) the project's **complete fast static checks — never a hand-picked subset**. In Tolaria that is exactly **`bun run check:pr`**: the same `check:all:inner` as the full gate (format + lint + type-check + `check:index` + `check:stubs`) on the unlocked light tier. Picking `check:ts && lint` and dropping the rest saved nothing (those checks cost <0.2s each) and made every card-shipping PR fail at the merge-train on the card-index lockfile guard. Do **not** run the full suite or full `check:all` on the branch — the merge-train (SKILL.md §4 step 3) runs the full gate once on the rebased tree that actually lands, and a per-branch full gate would be re-paid there. Do not open the PR until this light gate is green.

    **This is enforced mechanically where the project supports it, not by prose.** Tolaria's `scripts/gate.ts` makes `bun run test` / `bun run check:all` exit 1 inside a `feat/issue-N` / `fix/issue-N` worktree — telemetry showed the prose rule alone was routinely ignored, with several subagents running full suites concurrently and driving the machine to 5× oversubscription. If a subagent hits that block, the correct response is to run the targeted gate, **never** to set the `TOLARIA_ALLOW_FULL_SUITE=1` escape hatch: that flag belongs to the orchestrator's train, not to an implement subagent.
    - **Migration light lane (`migration` label).** For a `migration`-labelled issue only, the pre-PR gate is the **targeted gate**, not the full suite: the migrated card's own per-card test (kept byte-for-byte untouched — it is the equivalence proof) plus the two catalogue sweeps that auto-discover every migrated card, `convex/cards/__tests__/effectScripts.test.ts` (static validation: schema, Op vocabulary, ref-check, JSON purity) and `convex/cards/__tests__/effectScriptSmoke.test.ts` (canned-scenario smoke through the real `resolveTopOfStack`). These three green on the branch is the pre-PR bar. The full `bun run check:all` + `bun run test` is **not** run per migration issue — the merge-train runs it once on the combined tree (SKILL.md §4 step 3), where it is load-bearing. Any non-`migration` issue still runs the light pre-PR gate above.

7. **Ship to a PR — but do NOT merge** (all from inside the worktree). Merging is the orchestrator's job (SKILL.md §4), behind the serial merge lock:
    1. Commit with message referencing the issue: `fix: <description> (closes #N)` or `feat: <description> (closes #N)`
    2. Push branch, open PR: `gh pr create --title "<type>: <short title>" --body "Closes #N\n\n<summary>"`
    3. **Stop here.** Leave the worktree intact (the orchestrator may hand the branch back for a rebase fixup in SKILL.md §4). Never run `gh pr merge`.
8. **Record what you noticed but were not asked to fix — as a DRAFT, never an issue.** Working an issue routinely turns up something adjacent: a producer nobody enumerated, a guard that fails open, a second card carrying the same bug. Write one file per observation:

    `docs/findings/<issue>-<slug>.md` — format and fields in `docs/findings/README.md`. It lands with your PR, so it is tracked in git and readable next month.

    **Do NOT open a GitHub issue for it.** The loop drains the queue and never fills it; an agent that files its own work removes the one place a human sets direction. Your job is the draft, the triage is theirs (`bun run findings`).

    Two things make a finding worth writing rather than noise: **`file:line` evidence** instead of prose, and a sentence on **why it might NOT deserve a ticket** — you are the one best placed to know, and a one-sided finding leaves the reader to redo your work. `confidence: low` is fine; silence is not.

9. **Write the receipt to the batch artifact directory, then return a one-line summary.** The receipt is a FILE, not a paragraph — `.claude/receipts/<BATCH_ID>/<issue>-implement.json`, written through `writeReceipt` (`scripts/lib/receipt.ts`), which validates before it writes and rejects a malformed receipt naming the offending field. `BATCH_ID` arrives in your prompt.

    **A receipt is append-only.** `writeReceipt` refuses to overwrite an existing file — it throws naming the path. This only bites you if you are writing a SECOND round for the same (issue, role): a fixup subagent respawned after its own PR came back `blocking` again, or a reviewer re-reviewing a fix. In that case pass an explicit `round` (`{ role: "fixup", round: 2, ... }`) — `receiptFilename` encodes it as `<issue>-fixup-2.json` so it sits beside the round-1 receipt instead of colliding with it. Figure out the number by listing what is already on disk for this issue+role (`ls .claude/receipts/<BATCH_ID>/ | grep '^<issue>-<role>'`) and going one past the highest round you see; round 1 has no suffix. **The common case — one implement, at most one fixup — needs no `round` at all**; only pass it when you know you are not the first receipt for this (issue, role).

    `WorkReceipt` in `scripts/lib/receipt.ts` **is** the field list — read it there rather than from a copy here, and let the validator tell you what is missing. Three fields carry judgment no schema can enforce:
    - **`targetFiles`** — the paths the diff ACTUALLY touched (`git diff --name-only main`), not the paths the issue predicted. The train's conflict graph is built from these.
    - **`restructures`** — the subset you MOVED, RENAMED, SPLIT or REWROTE, as opposed to appended to or edited in place. The train cannot derive this from paths: "we both touched `layers.ts`" says nothing about who must land first, and you are the only one who knows. Omit when nothing was restructured (the common case).
    - **`proofOfFailure`** — one entry per test you added that _guards_ a behaviour (a regression test, a catalogue guard, a CR-conformance assertion): what you broke, and what went red. Break the subject, watch it fail, revert. A test never seen failing is not evidence, and the failure mode is silent — a test that passes when it should fail looks identical to a real one in the diff, in review, and in a green suite. If a test still passes after you break what it guards, fix the test; do not report it as covered.

    Then return **one line** to the orchestrator: outcome, PR number, and — on `wip`/`failed` — what is still red. Nothing more (no file dumps, no test logs, no restated receipt). The file is the payload; the line is a pointer.

    **A `SubagentStop` hook backs this up.** If you stop without writing a receipt, `.claude/hooks/receipt-guard.sh` records a `missing` marker so the gap is a fact on disk rather than an absence. That is a backstop, not an alternative — a `missing` marker carries no PR, no paths and no verdict, so an issue whose receipt is only a marker cannot be merged this pass. The marker is keyed on your `agent_id` and rewritten in place, because `SubagentStop` fires on every yield of a background agent, not once at the end: what counts is whether YOUR marker is still there when the pass ends, and writing your receipt clears it.

The subagent inherits the same error-handling rules (max 3 attempts, then `[WIP]` draft PR — see SKILL.md § Error handling).
