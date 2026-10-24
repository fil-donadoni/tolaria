# /health-fix --headless — the unattended repair

Read when `$2` is `--headless`: `bun run health:fix --headless` spawned you as
`claude -p` for `loop:afk` (`loop-drain.sh` step 2b, issue #5589), or
`bun run health:fix ladder` did for the RED ladder (`health-fix.yml`, issue
#5646). The loop attempts ONE repair per RED tip, the ladder at most two per
RED episode, each recorded on the pivot (`health-fix-attempt` commit status
on the sha); the loop stops on your `stuck`, the ladder tries again and then
reverts the culprit.

- **Nobody answers a question.** Wherever `SKILL.md` says **grill**, the
  headless answer is **`stuck`**: write the analysis in the repair issue (or,
  before one is opened, in the verdict's `note`). A guess is never the
  answer to an ambiguity.
- **Certain instance fix, class guard for the owner → `landed-partial`**
  (issue #6552). When the instance fix is reproduced (red at the tip, green
  after), understood and defensible, but the class guard turns on a design
  call only the owner can make (e.g. its placement trades the lane's 10 s
  budget against the bot-suite boundary), do not end `stuck`: land the
  instance fix through the usual proof, review and `land` path, then file the
  class guard as its own issue labelled `ready-for-human` (`area:*` + type;
  options weighed, each with its measured cost) and write the verdict
  `{sha, outcome:"landed-partial", pr, classGuardIssue, note}`. The ladder
  reads it as `landed`: it waits for health on the new tip, no revert rung.
  **No reproduction, two plausible causes, or a fix that trades a correctness
  invariant is still `stuck`** — the revert answers "we do not know how to
  fix this". A guard you simply did not try to write is not an owner
  decision.
- **Unchanged:** the four prohibitions, the class guard, the one review
  round, the fail-closed verdict file.
- **`land` is a gate that outlives the Bash tool's cap**, and under `claude -p`
  the end of your turn is the end of the process. Run it as
  `TOLARIA_LAND_RUNNER=1 bun run gate:run land <PR#>` with the tool's
  `timeout` at 600000, re-issuing the identical command while it exits 75 —
  never in the background (`/next-ticket` § RUNNING A GATE).
- **A RED you can neither read (no evidence published) nor reproduce at the
  tip is `stuck`** — see `evidence.md`.
