# /next-issue — why the context-hygiene habits exist

Reached from `SKILL.md` when a habit seems not to fit your case. This file
carries the reasoning; the numbers live with their owners and are cited, not
restated:

- the per-turn cost curve, the per-bucket token table and the command that
  re-derives both: `docs/agents/quality-gates.md` § Context hygiene — the
  measurement, and why it is not a gate;
- the incidents behind the pass's own rules: `docs/agents/quality-gates.md`
  § `/next-issue` — the incidents behind its rules.

## The cost model

One long context is the whole design (ADR 0110), and its one weakness is that
nothing ever leaves it. Every token a tool result adds is re-read as
cache-read by every later turn, so a session's cost is super-linear in its
length: the back half of a session costs more than the front half for the
same number of turns. The habits are prose, not a gate, on purpose (issue
#3078): a hook pricing every exception at the rate of the waste would cost
more than the waste.

None of this narrows what you may read. It is about the SHAPE of what enters
the transcript: read the whole issue, run the whole gate — just don't carry
the rendering of either for the rest of the session.

## 1. Fields, not pages

`gh issue view N` and `gh pr view N` render the whole record — reactions,
project cards, every comment. Name what you will read; one field is one
field (`gh pr view N --json state --jq .state`, never a full view to check
whether a PR is open). An unfielded `gh issue list` is among the most
expensive single calls a session makes, and `gh` costs more per call than
`git` as a bucket.

## 2. Noisy stdout to a file

Gates, test runs, builds and broad searches reach the transcript as an exit
code plus the lines that carry the answer; the full log stays on disk for a
targeted re-read. Reading is the largest sink measured, so the same applies
to files: `grep -c` or `grep -n 'export function'` before `cat`, `sed -n` for
a known region, `--files-with-matches` when you only need the list.
`deny-guard.sh` § 3 refuses a `bun run` piped into a pager, and the
file-redirect idiom is what it asks for. The log path is in the session
scratchpad, never a shared `/tmp` name another session's run can overwrite.

## 3. Never poll

A `sleep N; echo` round-trip is a full-price turn at tail context carrying
zero information. Waiting inside ONE foreground call is not polling:
`gate:run` blocks in the shell, so the transcript grows by one line per call,
not by one turn per `sleep`.

The gate exception exists because under `claude -p` the end of a turn is the
end of the process: a backgrounded gate's notification never arrives, and a
pass that ends its turn "waiting for X" dies holding its claim — sometimes
with a mergeable PR nothing lands (issue #4763).
