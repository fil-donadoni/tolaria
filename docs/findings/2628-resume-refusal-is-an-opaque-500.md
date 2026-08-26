---
title: driver.resume when a driver is already running surfaces as an opaque 500, after clearing the stop-file
discoveredBy: 2628
status: draft
confidence: medium
---

## What I noticed

`/api/action`'s `driver.resume` shells out to `sh scripts/loop-handoff.sh
--resume` (`scripts/telemetry-serve.ts`, `DRIVER_COMMANDS.resumeDriver`). That
mode exits 1 with a message on **stderr** whenever `blocked_reason` holds, and
the endpoint's catch maps any thrown operation to `500 { ok: false, error:
String(err) }` — a shell error string, for an ordinary operator state the UI
would want to name.

`--resume` is also a bigger operation than "un-stop": it clears the stop-file,
writes the arming conf and detaches a driver
(`scripts/loop-handoff.sh:337-356`). It never fails for "not armed" — it is
what arms. The blocked reasons it CAN hit (`blocked_reason`, `:264-278`) are:
`TOLARIA_LOOP_DRAIN=1` set in the environment, a stop-file (impossible here, it
was just removed) and, the realistic one from a dashboard button, **"a driver
is already running (pid N)"** — an operator pressing Resume on a loop that
never actually stopped.

## Evidence

- `scripts/loop-handoff.sh:337-344` — the `start | resume` branch: `rm -f
"$STOP_FILE"` when the mode is `resume`, THEN `if ! reason=$(blocked_reason);
then … exit 1; fi`.
- Note the ORDER: the stop-file is removed _before_ the blocked check, so a
  refused `resume` still has the side effect of clearing the stop-file. That is
  pre-existing behaviour, unchanged by #2628, but it means a 500 from this
  endpoint is not "nothing happened" — the loop is now un-stopped, and the next
  end-of-pass handoff will fire.
- `blocked_reason` refuses a second driver by pid, so the residue is only the
  cleared stop-file; no second driver is ever spawned.
- `scripts/telemetry-serve.ts` — `handleActionRequest`'s catch maps any thrown
  operation to `500 { ok: false, error: String(err) }`.

## Why it might NOT deserve a ticket

The three-action endpoint was specified as dispatch-plus-refusal, and a failing
operation returning 500 with the underlying stderr is the honest answer at this
layer. The buttons ticket (#2621's action-UI slice) can perfectly well read
`/api/loop-status` — which already reports both `armed` and whether a driver is
alive — _before_ offering a resume button, and disable it when a driver is
already running. If it does that, no structured error code is needed and this
is a non-issue. It only becomes real if the UI chooses to call and react rather
than to gate up front; the stop-file-cleared-on-refusal residue is the part
that would then be worth naming, since it makes the failed call not idempotent.
