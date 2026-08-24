---
title: Shell session test fixtures cast away ActiveSession's type, so a new required field doesn't fail loudly at compile time
discoveredBy: 2674
status: draft
confidence: low
---

**What is wrong.** Several `AppShell` test files stub `useActiveSession`
directly and hand it a literal object cast through `as ActiveSession` /
`as never` instead of a value TypeScript actually checks against the real
interface. Adding a required field to `ActiveSessionEvent` (this PR added
`packSlots`) does not produce a compile error at these call sites — the
first signal is a runtime crash inside `limitedEventName` (`[...new
Set(undefined)]` is not iterable) the moment a test path actually renders
the event branch of the return banner, which is exactly the kind of thing
`bun run check:ts` is supposed to catch before a test ever runs.

**Evidence.**

- `src/components/chrome/__tests__/app-shell-modes.test.tsx:90-94` —
  `RUNNING_DRAFT: ActiveSession = { ... } as ActiveSession` (the whole
  object, not just one field, is cast — a missing/renamed field anywhere in
  the object is silently accepted).
- `src/components/chrome/__tests__/app-shell-scroll-contract.test.tsx:290-295`
  — `session = { ... } as never` for a fixture on `/game` (`ownChrome`),
  which happens to never reach the code that would need the field it's
  missing (`packSlots`) — this one got lucky on route choice, not on typing.
- `src/components/chrome/__tests__/app-shell-session.test.tsx` mocks
  `useQuery` instead and returns raw untyped result objects
  (`h.results[EVENTS_QUERY]`), so it has the same blind spot one layer
  further out.

This PR found and fixed the two fixtures that were actually reachable
(`app-shell-modes.test.tsx`'s `RUNNING_DRAFT`, and added a properly-typed
new case in `app-shell-session.test.tsx`) by running the suite and reading
the crash, not by a type error pointing at the gap.

**Why it may not deserve its own issue.** This is a narrow, low-frequency
seam — `ActiveSessionEvent` has grown one field in its whole history — and
the cost so far is "a test fails loudly at run time instead of at
type-check time," never a silent pass. A dedicated issue would likely be
"stop casting `as ActiveSession`/`as never` in shell test fixtures," which
is a small, mechanical cleanup rather than a design gap; it may be more
efficient to fold into whatever PR next touches `ActiveSession` and notices
the same friction, rather than opening a ticket for two casts today.
