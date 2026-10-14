# Reading the RED evidence

Read from `SKILL.md` § 0. `bun run health:status --evidence <sha>` prints the
body `health-main` published on the pivot (issue #5589): a commit comment on
the gated sha on the github backend, a file beside the log on the file one.

## The `failure:` kinds

| Kind        | What it means                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertion` | Failing tests, named in `files:`, at least one not a timeout                                                                                   |
| `timeout`   | Every failing test timed out — a budget, or a machine slower than the one that landed it                                                       |
| `crash`     | The run died: a signal (SIGKILL reads as OOM), a worker death, an unhandled error. The failing files may be casualties, not the cause          |
| `gate`      | A step that is not a test suite failed (`check:all`'s tsc, lint…): the excerpt names the inner script                                          |
| `unparsed`  | A test step failed and its output names no failing test and no crash. The excerpt is the only evidence, and the parser gap is a defect to file |

The step is one of `worktree:init`, `check:all`, `test`… — the gate stops at
the first one that fails. `machine:` names where it ran: a RED on the Linux
runner that passes on macOS is a platform difference until proven otherwise
(issue #5590).

## No evidence published

The command exits 1 when none was published: a RED older than issue #5589,
or a publish that failed (`health-main`'s output says why). The log then
exists only on the machine the verdict names. On that machine, read it
surgically (`grep -nE '^===== |FAIL|✗|Error|error TS|failed' <log> | head
-40`, then `sed -n 'A,Bp'`). On the other one, reproduce (§ 1). Headless, a
RED you can neither read nor reproduce is `stuck`.
