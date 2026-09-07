# Land and release

**The whole delivery path, in order: a worktree off the [base branch](#g-base-branch),
the [lane gate](#g-lane-gate), a PR, `land`, and — when a human decides — `release`.**
Six commands. Everything else in the repository's workflow tooling serves one of
them or is history.

```bash
cd "$(bun run --silent wt:new <N>)"   # 1. worktree off origin/<base>   (--fix for a bug)
…                                      # 2. implement; bunx vitest run <path> while iterating
git add -A && git commit               # 3. commit (the gate pins the HEAD sha)
bun run check:lane                     # 4. pre-PR gate — paste its output in the PR
git push -u origin feat/issue-<N>
gh pr create                           # 5. base = the base branch (GitHub default), no --base
bun run land <PR#>                     # 6. rebase, gate, merge into the base branch
```

```bash
cd /Users/filippo/code/mtg/tolaria     # the primary checkout, on the release branch
bun run release --dry-run              # what would move, nothing moves
bun run release                        # full gate on the base tip, then main fast-forwards
```

Branch names are not in this guide because they are not in the scripts either:
`tolaria.config.json` names the [base branch](#g-base-branch) (`staging` today)
and the [release branch](#g-release-branch) (`main`). Only
`scripts/lib/branches.ts` and `deny-guard.sh` read that file (ADR 0116).

## Landing a change on the base branch

### 1. `bun run wt:new <N>`

Fetches `origin/<base>`, creates `../tolaria-issue-N` on `feat/issue-N`
(`--fix` → `fix/issue-N`), runs `bun run worktree:init` (node_modules,
`convex/_generated`, `.env.local`, the merge driver), prints the path on its
last line so `cd "$(…)"` works.

Why not `git worktree add` by hand: the primary checkout keeps the
[release branch](#g-release-branch) checked out, so a branch off its HEAD
starts every issue a release behind the [base branch](#g-base-branch) — and a
rebase conflict gets manufactured out of nothing.

Never write a versioned file in the primary checkout (`deny-guard.sh` § 0):
markdown included.

### 2. Implement

Targeted runs only: `bunx vitest run <path>`. The full suites are blocked
inside an issue worktree by design. Every guarding test is proven to fail
once (break the subject, watch red, revert, say what you broke).

### 3. Commit before gating

`check:lane` refuses a dirty tree: the receipt it prints pins the HEAD sha,
and a receipt about a tree that then changed is worthless. Amending after a
green run invalidates it — write the message first, gate last.

### 4. `bun run check:lane` — the [lane gate](#g-lane-gate)

Classifies the diff against `origin/<base>` and runs exactly what that lane
owes:

| Lane     | Diff                                                         | Runs                                                                 | Measured |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------- | -------- |
| `skin`   | `src/**`, `public/**`, `index.html` only                     | format, lint, `check:ts` (app + scripts), bundle, `dom` + `node`/src | ~222 s   |
| `engine` | no `src/**`                                                  | format, lint, whole `check:ts`, index/stubs, bot fast lane, `node`   | ~175 s   |
| `docs`   | markdown only                                                | `check:docs` — seconds                                               |          |
| `full`   | anything else (mixed, `package.json`, `.claude/**`, scripts) | `check:pr` verbatim                                                  | ~305 s   |

Light tier: two vitest workers, no machine lock, so several sessions gate at
once. **Never hand-pick a subset of `check:pr`.** On formatting drift run
`bun run format` and re-run; the gate verifies, it does not repair.

A diff that can change what a user sees also owes **`bun run check:ui`** — five
viewports, the occlusion probe, axe — and its output pasted byte-exact in the
PR ([Browser verification](browser-verification.md)). `land` re-derives that
receipt and refuses a `skin` PR whose receipt does not match.

### 5. The PR

`gh pr create` targets the [base branch](#g-base-branch) because it is the
repository's default branch — no `--base`. The body carries: the `check:lane`
receipt, the `check:ui` receipt when owed, a `## Preset scenario` fence for
any `convex/{cards/sets,gre}` change (or "none owed"), the Bot reachability
outcome, proof-of-failure receipts for new guarding tests.

### 6. `bun run land <PR#>` — from the PR's worktree

Refuses, named, before taking any lock:

- on the base or release branch, a dirty tree, PR not open, PR head ≠ current
  branch;
- **PR base ≠ the base branch** — the API merge lands wherever the PR points,
  and a PR against the release branch would ship to production unreleased.
  Fix: `gh pr edit <PR#> --base <base>`;
- a `skin` diff whose pasted `check:ui` receipt fails verification;
- a card/engine diff with no preset scenario; a lockfile row retired without
  its PR naming the card.

Then, under the machine-wide [heavy mutex](#g-heavy-mutex), as ONE shell
command so the tree that lands is the tree that was gated:

1. `unset GITHUB_TOKEN` — the bug-report PAT `.env.local` carries cannot merge.
2. `git fetch origin <base> && git rebase origin/<base>` — on conflict: prints
   the paths, `--abort`, exits; the tree stays usable.
3. Regenerates the generated artifacts the rebase marked.
4. `bun run check:lane` — the lane gate again, on the rebased tree.
5. `git push --force-with-lease` of the feature branch.
6. Merge through the API (`scripts/pr-merge.ts`, squash, retried on the
   transient refusal a fresh force-push causes).
7. Verifies `origin/<base>` advanced by exactly one commit — ours. Anything
   else means someone pushed to the base branch from outside the lock, and the
   housekeeping below is skipped rather than run on a tip nobody gated.
8. Housekeeping, none of it gating: seeds the PR's preset scenario into the
   local Convex deployment; fast-forwards the primary checkout's local base
   branch if it is the one checked out; releases the `in-progress` claim on
   issue N; deletes the remote and local branch and removes the worktree
   (`--keep` keeps all three; `--no-merge` stops after step 5).

**No health gate per landing.** The full offline gate runs once, at release.
A landing costs the mutex 3–5 minutes.

If only the MERGE failed (step 6), retry `bun scripts/pr-merge.ts <PR#>` —
never a second `land`, which re-pays the gate. `deny-guard.sh` § 1 denies a
hand-typed `gh pr merge` everywhere; `TOLARIA_ALLOW_MANUAL_MERGE=1` is the
per-command hatch for a real recovery.

## Releasing the base branch to production

`bun run release`, from the primary checkout, when a human decides. Vercel
deploys the [release branch](#g-release-branch) and only it, so this is the
production deploy.

1. Fetches both branches. Same tip → "nothing to release", exit 0.
2. `--dry-run` stops here, printing the tip and the commit count.
3. Runs the [health gate](#g-health-gate) on the `origin/<base>` tip under the
   [heavy mutex](#g-heavy-mutex): a throwaway worktree at that sha,
   `check:all` then `bun run test` (app, bot, blade), ~13 minutes with the
   4-worker cap. Deduplicated by sha: a tip already GREEN is not re-gated.
4. Reads `.claude/telemetry/health/last.json` and releases **only** if the
   record is GREEN and about exactly the tip being promoted. A record about
   another sha, a RED, or a run still marked `running` refuses with the reason.
5. `git push origin <sha>:refs/heads/<release>` — a plain refspec, so git
   itself refuses a non-fast-forward. Never `--force` (`deny-guard.sh` § 2
   denies it for both configured branches).
6. Fast-forwards the primary checkout's local release branch when it is the
   one checked out.

`bun run health:status` shows the last verdict at any time. `bun run health`
runs the same gate by hand (`--branch=<name>` picks the tip).

### When release refuses

- **RED.** The marker stays; `land` warns on every landing until it is gone.
  Fix forward on the base branch like any PR — never stack unrelated work on
  a red tip, never silence a test — then `release` again. Attribution over a
  batch of N landings costs at most ⌈log₂ N⌉ health runs.
- **Non-fast-forward.** The release branch has a commit the base branch lacks
  (someone pushed to it directly). In a detached worktree at `origin/<base>`:
  `git merge origin/<release>`, `git push origin HEAD:refs/heads/<base>`, then
  `release`. Do not rebase or force anything.
- **"health record is about X, not the base tip".** Another health run wrote
  the record for a different sha between your fetch and the read — the base
  branch moved. Run `release` again.

## Glossary

### <a id="g-base-branch"></a>Base branch

The integration branch every PR targets and `land` merges into —
`branches.base` in `tolaria.config.json`, `staging` today. May be red between
releases; never deployed.

### <a id="g-release-branch"></a>Release branch

The production branch — `branches.release`, `main` today. Moves only by a
fast-forward from a health-proven base tip, only through `release`. The
primary checkout keeps it checked out.

### <a id="g-lane-gate"></a>Lane gate

`bun run check:lane`: the checks a diff owes, chosen by which paths it
touches, degrading to the whole `check:pr` on anything it cannot place. The
gate every landing pays, twice — once pre-PR for the receipt, once under the
lock on the rebased tree.

### <a id="g-health-gate"></a>Health gate

`scripts/health-main.ts`: the full offline gate (`check:all` plus all three
test suites) on one branch tip, leaving a durable verdict under
`.claude/telemetry/health/`. Runs at release, or by hand — never per landing
(ADR 0116; the per-landing version cost ~213 minutes of mutex a day and
produced 1.4 contention false-REDs a day).

### <a id="g-heavy-mutex"></a>Heavy mutex

`scripts/gate.ts`'s machine-wide lock (`~/.cache/tolaria/gate.lock`) around
anything that runs the full suites or `land`'s locked command. `bun run
gate:who` names the holder; a holder that stops burning CPU is reclaimed. The
light tier (`check:lane` by itself, targeted vitest) takes no lock.
