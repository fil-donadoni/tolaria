---
title: The fixed "Report a bug" button silently occludes whatever page control sits under it
discoveredBy: 2511
status: draft
confidence: low
---

**What is wrong.** The app-wide "Report a bug" floating button is
`position: fixed` in the lower-right corner with nothing reserving space for
it, so on a narrow viewport it is painted over ordinary page controls. A tap in
that region opens the bug reporter instead of doing what the user aimed at.

**Evidence.** `/decks/create` at 390x844, after this issue's fix: the
occlusion probe from `docs/guides/browser-verification.md` reports exactly one
occluded control, and `document.elementFromPoint` at that control's centre
returns the `position: fixed` `Report a bug` button rather than the control
itself (the Sideboard zone's `View ▾` disclosure toggle, at ~(351, 688)).
The same probe on `main` before the fix reported 8 occluded controls at the
same viewport, several of them the same overlap.

**Why it may not deserve its own issue.** It is one control on one screen at
one viewport, it moves as soon as any layout above it changes, and the fix is a
generic one (bottom padding / safe-area on scroll containers, or moving the
button into the header) that nobody has asked for. It is also entirely outside
the deckbuilder, so a deckbuilder ticket is the wrong home for it. Worth a line
on a UI-chrome tracker rather than a ticket of its own, unless it turns up on
the gameplay board too — which this pass did not check.
