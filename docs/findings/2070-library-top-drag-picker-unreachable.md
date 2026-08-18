---
title: The distribute drag-picker's keepTo:"library-top" chrome is unreachable by any shipped card
discoveredBy: 2070
status: draft
confidence: high
---

**What is wrong.** `LibraryOrderPicker`'s `distribute` mode (the two-zone drag
picker, `src/components/board/library-order/library-order-picker.tsx`) grew a
`keepTo: "library-top"` branch in this issue — `detachRight` (line 260),
`META_LIBRARY_TOP_KEEP` chrome (line 239) — but no shipped card can reach it
through live gameplay today.

**Evidence.** `player-library.tsx`'s routing: a `look-distribute` choice only
reaches the two-zone drag picker (`isOrderTopPick`, line 113-123) when it is
**not** `isLookDistributeGridPick` (line 88-95), which is true whenever
`head.destination === "graveyard" || head.randomizeRest === true`. The one
shipped `keepTo: "library-top"` card, Thassa's Oracle
(`convex/cards/sets/thb/blue.ts:24-33`), sets `randomBottom: true`
unconditionally on its `lookDistribute` Op — mapped straight to
`randomizeRest: true` on the `PendingChoice`
(`convex/gre/effects/interpreter.ts:3297`). So Thassa's Oracle's ETB always
routes to the GRID pick (`isLookDistributeGridPick`), never `isOrderTopPick` —
the `distribute` object (and its `detachRight` chrome) is built but never
consumed for this card.

**Attempted browser verification (issue #2070 round-2 review finding 2).** I
built an isolated, zero-backend scratch harness (`main.tsx` temporarily
branching on `location.pathname === "/scratch-preview"` to mount
`LibraryOrderPicker` directly with `distribute={{ keep: 1, keepTo:
"library-top" }}`, reverted before commit) specifically to reach this render
path in a real browser regardless of the routing gap above. Vite served it
cleanly on port 5180, but the shared `chrome-devtools-mcp` Chrome profile
(`~/.cache/chrome-devtools-mcp/chrome-profile`) was held by another live
concurrent session (5 running MCP server processes observed, one active
Chrome singleton) — taking it over would have been destructive to that
session's work, so the live-browser pixel check did not happen this round.

**Why it may not deserve its own issue.** Nothing is currently broken — the
branch is inert, not wrong, and no player can trigger it. It only matters if a
future `keepTo: "library-top"` card ships WITHOUT `randomizeRest`/`randomBottom`
(an ordered dig that keeps to the library top, e.g. a hypothetical scry-style
"look N, keep 1 on top in an order you choose, rest to the bottom in your
chosen order"). Worth a line on a UI/browser-verification tracker rather than
its own ticket; the DOM-level SURFACE test added in round 2
(`src/components/board/__tests__/player-library.test.tsx`, "routes an ORDERED
look-distribute with keepTo:\"library-top\"...") does exercise the chrome
SELECTION logic (which `ZoneMeta` object gets picked) through the real
reducer, proven by mutation — it just can't see pixel layout (happy-dom has no
layout engine).
