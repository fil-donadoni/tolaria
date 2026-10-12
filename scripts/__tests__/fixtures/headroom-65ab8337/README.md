# headroom-65ab8337

The duration files the issue #5484 reporter would have written for the health
run that went RED at 65ab8337 (issue #5477, repaired by PR #5478), built from
that run's log as issue #5477 quotes it: two `bot-node` tests past their 60s
`testTimeout` with no failed assertion (73.4s and 83.0s), the 400-iteration
fetchland case at 26.6s under the same contention, and one `node-engine` test
above `RECORD_FLOOR`. `run.json` is the seal `health-main.ts` writes.

`scripts/__tests__/health-main-headroom.test.ts` reads it: the headroom view
must list both tests that timed out, and only them.
