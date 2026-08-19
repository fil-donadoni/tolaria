// Vertical reveal between two overlaid cards in a deckbuilder-style pile, as a
// fraction of card height. Expressed relative to `--card-h` (not a fixed rem)
// so it grows with the per-zone zoom: bigger cards get a proportionally bigger
// gap. 0.23 reproduces the historical 1.4rem reveal at the default density.
// Shared by `BuilderPile` (lobby deckbuilder) and `LimitedPoolPile` (draft-time
// Pool) so both piles read identically.
export const PILE_STACK_OFFSET_RATIO = 0.23;

/** Absolute `top` offset for the card at `index` in an overlaid vertical pile. */
export function pileCardTop(index: number): string {
    return `calc(var(--card-h) * ${PILE_STACK_OFFSET_RATIO} * ${index})`;
}

/** Total height of an overlaid vertical pile of `count` cards — one full card
 *  plus a stagger reveal for every card after the first. */
export function pileHeight(count: number): string {
    const steps = Math.max(0, count - 1);
    return `calc(var(--card-h) * (1 + ${PILE_STACK_OFFSET_RATIO} * ${steps}))`;
}

/** Computes fan-style rotation and offset for a card at a given index in a hand. */
export function getFanStyle(
    cardIndex: number,
    totalCards: number,
    isOpponent = false
) {
    const centerIndex = (totalCards - 1) / 2;
    const distanceFromCenter = cardIndex - centerIndex;

    // Cap total angular spread so large piles don't over-rotate.
    const maxTotalSpreadDeg = isOpponent ? 36 : 50;
    const basePerCardDeg = isOpponent ? 3 : 5;
    const degPerCard =
        totalCards > 1
            ? Math.min(basePerCardDeg, maxTotalSpreadDeg / (totalCards - 1))
            : basePerCardDeg;
    const rotation = distanceFromCenter * degPerCard;

    // Cards lie on a circular arc whose virtual pivot is below them.
    // Bigger pivotDistancePx = gentler arc. In items-end layout,
    // marginBottom pushes content UP, so we give the center the
    // largest marginBottom and edges 0, producing a natural dome
    // (center highest, edges lowest) like a hand-held fan.
    const pivotDistancePx = isOpponent ? 360 : 480;
    const rad = (rotation * Math.PI) / 180;
    const arcDropPx = pivotDistancePx * (1 - Math.cos(rad));
    const maxAngleRad = (centerIndex * degPerCard * Math.PI) / 180;
    const maxArcDropPx = pivotDistancePx * (1 - Math.cos(maxAngleRad));
    const marginBottomPx = maxArcDropPx - arcDropPx;

    // Overlap ~50% of card width — cards sit closer together.
    const overlapVar = isOpponent
        ? "calc(var(--card-w-sm) * -0.5)"
        : "calc(var(--card-w) * -0.5)";

    return {
        transform: `rotate(${rotation}deg)`,
        marginLeft: cardIndex === 0 ? "0" : overlapVar,
        marginBottom: `${marginBottomPx}px`,
        transformOrigin: "bottom center",
    };
}

/** ClassName for cards in the player's fan layout. */
export const fanCardClassName =
    "w-(--card-w) aspect-5/7 shrink-0 mb-2 transition-[translate,transform,margin] hover:-translate-y-4 hover:z-10";

/** ClassName for cards in the opponent's fan layout. */
export const fanCardOpponentClassName =
    "w-[var(--card-w-sm)] aspect-5/7 shrink-0 mb-2 transition-[translate,transform,margin] hover:-translate-y-4 hover:z-10";

/** THE box of one collapsed zone-pile tile — graveyard / library / exile and
 *  every sibling tile in the pile rail (#1768).
 *
 *  One constant because a pile has TWO renderings — the stacked cards when it
 *  holds any, and the bordered "empty zone" placeholder when it doesn't — and
 *  they must occupy the SAME box. They did not: the placeholder is a normal
 *  in-flow box while the stacked cards are `absolute`, so the placeholder's
 *  trailing `mb-2` was live geometry where the cards' identical `mb-2` was
 *  inert. A landscape rail sizes its tiles from `--card-w-sm`, so any
 *  divergence between the two shows up directly as an empty Exile tile with a
 *  different aspect than the populated Graveyard beside it — the audit finding.
 *  Both renderings now spell their box exactly once, here. */
export const PILE_TILE_BOX = "w-(--card-w-sm) aspect-5/7";

/** Pixel breakpoint below which a pile/picker card grid switches to its
 *  mobile-compact tile (issue #1817, opus review round 2). Below this width:
 *  the tile drops to `PILE_GRID_TILE_PX`, `GameDialog`'s opt-in
 *  `density="comfortable"` (`panel.tsx`) shrinks the surrounding Panel
 *  padding, and `cards-pile.tsx`'s `PILE_GRID_ROW_CLASS` / `PILE_GRID_H_PADDING`
 *  shrink their gap/padding. At/above it every one of those reverts to the
 *  pre-#1817 sizing (96px tile, `p-6` Panel padding, `gap-2`/`px-2`) — the
 *  420–639px band must read identically to before this issue.
 *
 *  MUST stay in sync with the literal `min-[420px]` arbitrary-variant text
 *  baked into `PILE_GRID_TILE_W` below and the analogous breakpoints in
 *  `panel.tsx` / `cards-pile.tsx` — Tailwind's JIT scanner needs the literal
 *  text in source, so it can't be interpolated from this constant. This is a
 *  cross-reference for authors and the executable fit assertion in
 *  `cards-pile.test.tsx`, not a live binding. */
export const PILE_GRID_COMPACT_BREAKPOINT_PX = 420;

/** Grid-layout pile/picker tile width (issue #1817). At/above
 *  {@link PILE_GRID_COMPACT_BREAKPOINT_PX} this is unchanged from before the
 *  issue: `w-24` (96px) up to `sm:` (640px), `w-28` (112px) at `sm:` and up.
 *  BELOW the compact breakpoint ("phone held upright" territory) it drops to
 *  a fixed 68px (`PILE_GRID_TILE_PX`) — chosen so 4 tiles + 3
 *  `PILE_GRID_GAP_PX` gaps fit the available dialog width at BOTH 360px and
 *  390px viewports once `GameDialog`'s `density="comfortable"` shrinks the
 *  surrounding Panel padding (see the executable arithmetic assertion in
 *  `__tests__/cards-pile.test.tsx`).
 *
 *  Shared by `cards-pile.tsx`'s flat grid, every categorized section
 *  (`GridLayout`), AND the 5 sibling cost/target-picker dialogs that render
 *  an analogous card grid in a `size="wide"` `GameDialog`
 *  (`cast-exile-cost-dialog.tsx`, `cast-alternative-hand-cost-dialog.tsx`,
 *  `discard-cost-dialog.tsx`, `convoke-creature-dialog.tsx`,
 *  `graveyard-card-picker.tsx`) — one constant so every pile/picker grid on
 *  the same phone renders the SAME tile size instead of drifting (opus
 *  review round 2 finding: the pile browser rendered 76px tiles while the
 *  graveyard-target picker, on the same phone, still hardcoded 96px). */
export const PILE_GRID_TILE_PX = 68;
export const PILE_GRID_TILE_W = "w-[68px] min-[420px]:w-24 sm:w-28";

/** Horizontal gap between grid tiles below
 *  {@link PILE_GRID_COMPACT_BREAKPOINT_PX} (issue #1817). `gap-1` = 4px; kept
 *  in sync with `PILE_GRID_TILE_W`'s fit math — see its comment. Only
 *  `cards-pile.tsx`'s own `PILE_GRID_ROW_CLASS` uses this (the 5 sibling
 *  pickers lay their grid out with a plain `flex flex-wrap gap-2`, unchanged;
 *  they share the TILE width, not the row/gap treatment). */
export const PILE_GRID_GAP_PX = 4;
