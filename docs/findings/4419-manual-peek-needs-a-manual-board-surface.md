---
title: manual-peek-dialog cannot be a design-system specimen — it needs the lane's first Manual Board surface
discoveredBy: 4419
status: draft
confidence: high
---

**What is wrong.** Issue #4419 paid eighteen of the census's nineteen
`src/components/board/**` `DEBT` rows — seventeen as live specimens on
`/admin/design-system` § 16 with a `dlg-*` surface each, and `pregame-dialog`
on its own `game-pregame` walk. `src/components/board/manual-peek-dialog.tsx`
stays in `DEBT`, and the shape of the slice cannot reach it.

**Evidence.** Every other board dialog renders from pure props, so a fixture
mounts it. This one opens a live query as soon as a peek request exists
(`src/components/board/manual-peek-dialog.tsx:50`):

```ts
const result = useQuery(
    api.game.getManualLibraryTop,
    request ? { gameId, playerId: request.playerId, n: request.n } : "skip"
);
if (!request) return null;
```

There is no branch where the dialog RENDERS and the query is skipped, and
`convex/react`'s `useQuery` **throws** on a query error
(`node_modules/convex/dist/cjs/react/client.js` — `if (result instanceof
Error) throw result`). A specimen `gameId` fails `v.id("games")` server-side,
so the specimen would not paint a thin dialog: it would take the whole census
page down, and with it the `design-system` surface and the seventeen `dlg-*`
rows that walk from it.

Paying it needs a Manual Board surface for the lane — a `format: "manual"`
deck fixture on the lane account, the lobby's Cockatrice-mode selector, a
created manual game, and the pile verb that opens "Peek top N". That would be
the lane's first manual-mode coverage of any kind: `manual-board-view.tsx` is
walked at no viewport either.

**Why it may not deserve its own issue.** It is one census row, and it may
fall out of whichever slice of issue #4402 first needs a manual game for its
own reasons — the Manual Board's other overlays are spread across the
remaining slices. If no slice claims manual mode, this is the ticket that
buys the lane its first manual-mode surface, and then it is worth one.

**Also worth knowing.** The same shape stops any future board dialog whose
content is a live query on a row the census page cannot name. `pregame-dialog`
was the other one, and it was payable only because the lane already creates a
game it may measure.
