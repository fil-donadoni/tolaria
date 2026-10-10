# PROTOTYPE — Limited flow (throwaway, branch `prototype/limited-flow`)

Grill of 2026-10-10. Mounted at `/limited?proto=<surface>&variant=<key>` (DEV only),
entry `limited-flow-prototype.tsx`. Mock data only: `proto-cards.ts` (220 real cards,
real Scryfall ids → `getArtCropImageUrl` / `getPrintedCardImageUrl` from `~/lib/images`).
No Convex reads, no mutations: buttons log or flip local state.

Style precedent: `prototype/match-setup-wizard` (PRD #5334) — bento tiles with card art
(`proto-art-card.tsx`), recap rail + active step (`git show
prototype/match-setup-wizard:src/components/lobby/prototype-match-setup/variant-c-split.tsx`).
Use the project's semantic tokens (bg-surface, border-border-strong, text-parchment,
--panel-radius, font-display …) and existing primitives (mana symbol SVG component,
Panel, Button) — grep `src/components/ui` and `src/components/` first.
All UI text in English. Must work at phone portrait (375), phone landscape, tablet, desktop.

## Decisions already taken (do not re-open)

- **Hub `/limited`**: your in-progress events first (hero tile: Feature Card art, event
  name, phase, ONE primary CTA for the phase), then open events to join, then a Create
  tile. Status chips Open / Drafting / Building / Playing; **History** replaces Done and
  Mine (closed events, compact, with result). Never a vertical list of finished events.
- **Setup `/limited/new`**: recap rail (left) + active step (right), stacked on mobile,
  like PRD #5334. Steps: 1 Type (Draft preselected · Sealed), 2 Pack Source (tiles with
  display name + Feature Card art; Vintage Cube first and preselected), 3 Table (seats
  default 8, Games Format Bo1/Bo3, pick timer default ON, round deadline, boosters per
  seat only for Sealed, **Open Decklists** toggle default off with its warning text).
  Every step has a default → Create is enabled on arrival. Later visits preselect the
  last choices (localStorage).
- Pack Sources + Feature Cards: Vintage Cube / Black Lotus · Limited Edition Alpha /
  Mox Sapphire · Ice Age / Necropotence · The Dark / Maze of Ith · Invasion / Fact or
  Fiction · Invasion Block (INV→PLS→APC) / Dromar, the Banisher.
- **Event `/limited/{id}`** skeleton for every phase: header (Feature Card banner, name,
  Games Format, phase stepper Waiting ▸ Draft ▸ Deckbuilding ▸ Games ▸ Done, secondary
  actions Copy link / Leave seat / Close event in a ⋯ menu), a NEXT ACTION hero with one
  big CTA, the TABLE as an Arena-style circle (seats around a ring: occupied human /
  bot / empty, pass direction arrow, deck colours as mana symbols when known; inline on
  desktop, compact tile opening a dialog on mobile), phase tiles (standings, round, your
  deck, pool…). Tabs [Event] [Review the table] — Review from Games on.
- Standings: mana symbols of each player's deck colours beside the name; better graphics.
- Review the table: per player a clearly visible collapsible trigger; inside, tabs Deck /
  Pick order; a zoom slider for card size. Other seats locked ("Revealed when the event
  ends") during Games unless Open Decklists is on (then a banner warns). Finished: all
  visible to all.
- **Builder**: Add Basic = 5 big distinct tiles (basic art, mana symbol, − count +),
  tapping the art opens a printing picker. MTGO split: creature piles on top row,
  non-creature piles below, with the creature/non-creature filter still available.
  Default sort: colour when grouped by mana value, mana value when grouped by colour.
  Default deck name carries the Pack Source ("Vintage Cube Draft").
