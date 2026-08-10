---
title: happy-dom hands out two distinct JS wrappers for the same <form> node
discoveredBy: 2435
status: draft
confidence: medium
---

**What is wrong.** Under happy-dom, an `Element` reached via `document.querySelector`/`querySelectorAll`
and the "same" element reached via `parentElement`/`closest` from a descendant can be two
distinct JS wrapper objects for one underlying DOM node. Measured directly:
`form.isSameNode(closest)` is `true` (the underlying node-identity check passes) while
`form !== closest` (reference equality fails) for a `<form>` obtained the first way vs. the
second. A bare `<form>` built via `innerHTML` shows correct identity — the divergence is
triggered by something the real, componentized form has that a minimal repro doesn't (most
likely happy-dom's named-item `Proxy` wrapping `HTMLFormElement`, which intercepts property
access on the element and may be constructing a fresh wrapper per access path).

**Consequence.** Any `===`/reference-equality comparison against a `<form>` reached by an
UPWARD walk (`.parentElement`, `.closest(...)`, `Node.contains()` when the form is the
needle rather than the haystack) is unreliable under happy-dom — the same class of bug that
required adapting `src/components/deckbuilder/__tests__/deck-builder-shell.test.tsx:283-301`
(issue #2435, `getAllByText("Stats").find(el => form.contains(el))` → a downward
`querySelectorAll` scan instead). That fix is sound and stays; the point of this finding is
that the underlying divergence is a general happy-dom property, not specific to that one
assertion.

**Evidence.**

- `src/components/deckbuilder/__tests__/deck-builder-shell.test.tsx:283-301` — the adapted
  test and its comment.
- Reviewer's #2447 review receipt (`.claude/receipts/session_01NN6fdV2g2tLrbYQnyn38AP/2435-review.json`),
  finding on `deck-builder-shell.test.tsx:283-301`: confirmed `form.isSameNode(closest) === true`
  while `form !== closest`.
- Checked the only other candidate in the suite,
  `src/components/deckbuilder/__tests__/pool-deck-builder-form.test.tsx:982`
  (`expect(scrollWrapper.contains(form)).toBe(false)`, run 10x via `it.each`) — measured SAFE
  (`container.contains(form) === true` as expected), because there the form is the walk's
  START (`container.contains(form)`) rather than a node being matched against during an
  upward walk.

**Why it may not deserve its own issue.** Only one test in the 2207-file `dom` project hits
this today, and it is already adapted correctly. A standing global fix (e.g. patching
`Node.prototype.contains`/`closest` to never rely on `.parentNode` chains) would be a much
bigger, riskier change than the one local adaptation, for a gap with no second occurrence yet.
Worth revisiting if a second test trips over the same divergence — at that point the
per-test-adaptation approach stops scaling and a targeted happy-dom form-identity shim (in
`vitest.setup.ts`, alongside the other three #2435 shims) becomes the better trade.
