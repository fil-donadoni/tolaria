# `manual-peek-dialog` cannot be a design-system specimen

**Noticed while**: paying issue #4419, the board's nineteen census `DEBT` rows
(slice of issue #4402).

**What**: eighteen of the nineteen rows are now measured — seventeen as live
specimens on `/admin/design-system` § 16 with a `dlg-*` surface each, and
`pregame-dialog` on its own `game-pregame` walk. The nineteenth,
`src/components/board/manual-peek-dialog.tsx`, stays in `DEBT`.

**Why it resisted the slice's shape**: every other board dialog renders from
pure props, so a fixture mounts it. This one opens a live query as soon as a
peek request exists:

```ts
const result = useQuery(
    api.game.getManualLibraryTop,
    request ? { gameId, playerId: request.playerId, n: request.n } : "skip"
);
if (!request) return null;
```

There is no branch where the dialog RENDERS and the query is skipped, and
`convex/react`'s `useQuery` **throws** when the query errors
(`node_modules/convex/dist/cjs/react/client.js` — `if (result instanceof
Error) throw result`). A specimen `gameId` fails `v.id("games")` server-side,
so the specimen would not paint a thin dialog: it would take the whole census
page down, and with it the `design-system` surface and the seventeen `dlg-*`
rows that walk from it.

**What paying it actually needs**: a Manual Board surface for the lane — a
`format: "manual"` deck fixture on the lane account, the lobby's
Cockatrice-mode selector, a created manual game, and the pile verb that opens
"Peek top N". That is the lane's first manual-mode coverage of any kind
(`manual-board-view.tsx` is walked at no viewport either), which makes it a
slice, not a loose end of this one.

**Also worth knowing**: the same shape would stop any future board dialog whose
content is a live query on a row the census page cannot name. `pregame-dialog`
was the other one, and it was payable only because the lane already creates a
game it may measure.
