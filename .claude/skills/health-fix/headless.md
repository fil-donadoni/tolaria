# /health-fix --headless — the unattended repair

Read when `$2` is `--headless`: `bun run health:fix --headless` spawned you as
`claude -p` for `loop:afk` (`loop-drain.sh` step 2b, issue #5589). The loop
attempts ONE repair per RED tip, recorded on the pivot (`health-fix` commit
status on the sha), and stops on your `stuck`.

- **Nobody answers a question.** Wherever `SKILL.md` says **grill**, the
  headless answer is **`stuck`**: write the analysis in the repair issue (or,
  before one is opened, in the verdict's `note`). A guess is never the
  answer to an ambiguity.
- **Unchanged:** the four prohibitions, the class guard, the one review
  round, the fail-closed verdict file.
- **`land` is a gate that outlives the Bash tool's cap**, and under `claude -p`
  the end of your turn is the end of the process. Run it as
  `TOLARIA_LAND_RUNNER=1 bun run gate:run land <PR#>` with the tool's
  `timeout` at 600000, re-issuing the identical command while it exits 75 —
  never in the background (`/next-ticket` § RUNNING A GATE).
- **A RED you can neither read (no evidence published) nor reproduce at the
  tip is `stuck`** — see `evidence.md`.
