---
title: The phone bottom nav ships three destinations, not ADR 0101's four — there is no /decks list route
discoveredBy: 2582
status: draft
confidence: medium
---

**What is wrong.** ADR 0101 specifies the phone-portrait bottom nav as
**Play · Decks · Limited · Me**. Issue #2582 shipped it with three entries —
Play, Limited, Me — because the app has no `/decks` LIST route to point the
second one at. Decks live on the lobby (`/`), alongside Play, so a "Decks"
item would either duplicate Play's destination or link to a 404. Three items
that work were preferred to four where one is a dead end.

**Evidence.** `src/router.tsx` registers `/decks/create`, `/decks/$slug` and
`/decks/$slug/edit` — every `/decks` route is a leaf that needs a slug or is
the builder; none of them is a list. The list lives inside the lobby route
(`src/routes/lobby.route.tsx`). The shell's route census
(`src/lib/shellChrome.ts`, `SHELL_ROUTE_RULES`) therefore has no `/decks` row
either, and `src/lib/__tests__/shellChrome.test.ts` asserts registry and router
name exactly the same set, so adding one would red the gate until the route
exists.

**Why it may not deserve its own issue.** PRD #2405 has a lobby slice of its
own, and splitting the deck list onto its own route is a lobby decision — what
`/decks` should show, how it relates to the lobby's format filter, whether the
lobby keeps a deck section at all. Filed as a finding rather than a ticket so
that decision is made once, in the lobby slice, rather than pre-empted here by
a nav item. If the lobby slice lands a `/decks` route, the bottom nav gains its
fourth item in that same change: `src/components/chrome/app-bottom-nav.tsx`.
