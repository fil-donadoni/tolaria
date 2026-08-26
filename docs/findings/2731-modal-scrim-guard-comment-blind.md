---
title: modal-scrim.guard.test.ts's per-site check — comment-blind hole closed, two smaller blind spots remain
discoveredBy: 2731
status: draft
confidence: medium
---

**What was wrong (fixed this round).** The "every known full-screen overlay
site uses the shared utility" check in
`src/components/__tests__/modal-scrim.guard.test.ts` asserted
`readFileSync(site).includes("modal-scrim")` — a raw substring match over the
WHOLE file, including comments. Round-1 review proved this: reverting
`components/board/controller-phase-sheet.tsx` and
`components/ui/anchored-picker.tsx`'s real `className`s to the pre-#1891 bare
`bg-black/50` (no blur), while leaving the explanatory comments (which
themselves say the words "modal-scrim") untouched, left the guard 3/3 green.

**Fix applied.** The per-site check now runs against `stripCodeComments(src)`
— a small state-machine scanner (added in this same file) that removes `//`
and `/* */` comments while leaving string/template-literal contents (and any
`//` inside a URL) untouched. Proof-of-failure: reverted both sites'
`className`s to `bg-black/50` with comments intact, one at a time — each
independently reds the check by file name (`<site> must use modal-scrim in
its actual code, not only in a comment`); reverted the mutation, all 4 tests
green again. `stripCodeComments` itself has its own unit test asserting a
leading `//` comment, a block comment and a trailing `//` comment are all
removed while a `https://` URL and a template-literal body survive.

**Two smaller blind spots remain, neither touched this round.**

1. **The FIRST test in the file** ("no component uses a bare `bg-scrim`")
   still does a raw, comment-inclusive substring match. This is the opposite
   direction of risk — a comment merely mentioning the string `bg-scrim`
   would make an innocent file fail as a false "offender" — so it is a
   possible noisy-red, not a silent-pass hole like the one just fixed. Low
   priority; would use the same `stripCodeComments` helper if picked up.
2. **`stripCodeComments`'s template-literal handling is a simplification**:
   it treats a whole `` `...` `` template as one opaque string, including any
   `${expression}` inside it. A component that computed its scrim class
   through a template literal with a NESTED template or a comment inside the
   `${}` expression (none currently do — `action-sheet.tsx`'s
   `` `z-modal fixed inset-0 transition-colors duration-200 ${animIn ? "modal-scrim" : "bg-transparent"}` ``
   is the one template-literal scrim site in `SITES`, and its `${}` is a
   plain ternary with no nested backtick or comment) would not be scanned
   correctly. Fine for every current site; worth a second look only if a
   future site's scrim expression gets that complex.

**Why these may not deserve their own issue.** Both are narrow, currently
inert (no site in `SITES` triggers either), and mechanical to fix later using
the same helper already living in this file — flagging here so they are
findable rather than opening a ticket for a gap nothing currently exercises.
