// Bridges the Column Layout engine's Zone vocabulary (`maindeck`/`sideboard`,
// `convex/deckLayout.ts`) to the persisted per-user view-preferences seam
// (`main`/`side`, issue #1620's `src/lib/deckViewPrefs.ts`, PRD #1617 §
// "Persistence: layout on the deck, view preferences on the user"). The two
// were named independently: #1620 shipped the storage seam before #1618's
// engine existed to plug it into. This module is the ONE place that
// translates between them, so both builders (Constructed `deck-builder.tsx`,
// Limited `pool-deck-builder-form.tsx`) share one mapping instead of two
// near-identical copies (issue #1624).
//
// Deliberately does NOT hold or mutate a `ColumnLayout` itself — each builder
// keeps its Zones' Layouts in whatever shape already fits its own state
// (Constructed: a persisted-across-renders `DeckColumnLayout`; Limited: the
// Grouping/Ordering pair feeding a `useMemo`'d Layout rebuilt from the live
// Pool Arrangement). Mixing that concern in here would force one shape onto
// both.
import type { DeckZone, GroupingKind, OrderingKind } from "@convex/deckLayout";
import {
    loadGrouping,
    loadOrdering,
    saveGrouping,
    saveOrdering,
    type DeckZone as ViewPrefZone,
} from "~/lib/deckViewPrefs";

/** The draft-time Pool's own view-preference zone (issue #1632, ADR 0075 §6).
 *  NOT one of the engine's two `DeckZone`s: the draft Pool mounts the shared
 *  surface AS the Maindeck (same Column ids, same Pins, same drop model — that
 *  is the whole point of #1632), but its Grouping/Ordering must persist
 *  independently of the build view's Maindeck, so it needs a zone identity the
 *  engine's union deliberately does not have. Widening `DeckZone` itself would
 *  be wrong: `DeckColumnLayout` is a `Record<DeckZone, ColumnLayout>`, and
 *  there is no third Column Layout — only a third preference key. */
export const DRAFT_POOL_VIEW_ZONE = "draftPool";

/** A Zone this module can seed/record a view preference for — the engine's two,
 *  plus the draft Pool. */
export type ColumnViewZone = DeckZone | typeof DRAFT_POOL_VIEW_ZONE;

/** Exhaustive by construction (a `switch` with no `default`, returning in every
 *  arm): a new member of either union fails type-check here rather than
 *  silently falling into `"side"`, which is what a binary ternary did before
 *  issue #1632. */
function prefsZone(zone: ColumnViewZone): ViewPrefZone {
    switch (zone) {
        case "maindeck":
            return "main";
        case "sideboard":
            return "side";
        case DRAFT_POOL_VIEW_ZONE:
            return "draft";
    }
}

/** The Grouping/Ordering a Zone's Layout should seed from on mount — the
 *  user's saved preference, or the engine's own defaults (`mv/name`) on a
 *  first-ever visit (`deckViewPrefs`'s own fallback). */
export function seededColumnView(zone: ColumnViewZone): {
    grouping: GroupingKind;
    ordering: OrderingKind;
} {
    const pz = prefsZone(zone);
    return { grouping: loadGrouping(pz), ordering: loadOrdering(pz) };
}

/** Persists a Grouping change for `zone`. Callers still apply the change to
 *  their own Layout state separately (see module doc) — this only writes the
 *  per-user preference (issue #1620), it is not the whole state update. */
export function recordGroupingChange(
    zone: ColumnViewZone,
    grouping: GroupingKind
): void {
    saveGrouping(prefsZone(zone), grouping);
}

/** Persists an Ordering change for `zone` — see {@link recordGroupingChange}. */
export function recordOrderingChange(
    zone: ColumnViewZone,
    ordering: OrderingKind
): void {
    saveOrdering(prefsZone(zone), ordering);
}
