---
title: driver.resume on a disarmed loop surfaces as an opaque 500, not a state the button can explain
discoveredBy: 2628
status: draft
confidence: medium
---

## What I noticed

`/api/action`'s `driver.resume` shells out to `scripts/loop-handoff.sh resume`
(`scripts/telemetry-serve.ts`, `defaultDriverActions`). That subcommand exits 1
with a message on **stderr** whenever `blocked_reason` holds — most commonly
"the loop is not armed", because arming is deliberately outside the endpoint's
allow-list (`scripts/loop-handoff.sh:337-341`, `blocked_reason` at the same
`start | resume` branch).

The endpoint therefore answers `500 { ok: false, error: "<execFile error incl.
stderr>" }` for a perfectly ordinary, expected operator state. The action
endpoint's own contract is fine — the operation genuinely failed — but the
buttons ticket will want to render "the loop is not armed; run `bun run
loop:afk --arm`" rather than a shell error string, and there is no structured
signal to key that on.

## Evidence

- `scripts/loop-handoff.sh:337-341` — `resume` clears the stop-file, then
  `if ! reason=$(blocked_reason); then echo … >&2; exit 1; fi`.
- Note the ORDER: the stop-file is removed _before_ the blocked check, so a
  refused `resume` still has the side effect of clearing the stop-file. That is
  pre-existing behaviour, unchanged by #2628, but it means a 500 from this
  endpoint is not "nothing happened".
- `scripts/telemetry-serve.ts` — `handleActionRequest`'s catch maps any thrown
  operation to `500 { ok: false, error: String(err) }`.

## Why it might NOT deserve a ticket

The three-action endpoint was specified as dispatch-plus-refusal, and a failing
operation returning 500 with the underlying stderr is the honest answer at this
layer. The buttons ticket (#2621's action-UI slice) can perfectly well read
`/api/loop-status` — which already reports `armed` — _before_ offering a resume
button, and disable it when the loop is disarmed. If it does that, no structured
error code is needed and this is a non-issue. It only becomes real if the UI
chooses to call and react rather than to gate up front.
