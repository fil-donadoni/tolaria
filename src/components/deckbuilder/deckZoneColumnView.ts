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
} from "~/lib/deckViewPrefs";

function prefsZone(zone: DeckZone): "main" | "side" {
    return zone === "maindeck" ? "main" : "side";
}

/** The Grouping/Ordering a Zone's Layout should seed from on mount — the
 *  user's saved preference, or the engine's own defaults (`mv/name`) on a
 *  first-ever visit (`deckViewPrefs`'s own fallback). */
export function seededColumnView(zone: DeckZone): {
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
    zone: DeckZone,
    grouping: GroupingKind
): void {
    saveGrouping(prefsZone(zone), grouping);
}

/** Persists an Ordering change for `zone` — see {@link recordGroupingChange}. */
export function recordOrderingChange(
    zone: DeckZone,
    ordering: OrderingKind
): void {
    saveOrdering(prefsZone(zone), ordering);
}
