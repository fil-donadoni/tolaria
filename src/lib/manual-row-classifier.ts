// Manual battlefield row classifier (PRD #2162, issue #2169) — the value
// passed to `BoardBattlefield`'s `rowClassifier` prop (#2166), via
// `BoardSurface`.
//
// #2168 shipped the decision itself (`manualBandOf`, `src/lib/manual-band.ts`)
// and left the plug-in shape to this issue, because the two do not unify by
// type: the shared classifier takes a board `CardInstance`, while `manualBandOf`
// needs `lane` — a manual-only field `CardInstance` does not name (findings
// note `docs/findings/2168-manual-band-classifier-plug-point.md`).
//
// The resolution the finding predicted is the one taken here: the container
// already holds BOTH shapes, so the lane is looked up from the raw projected
// manual state by instance id and `CardInstance` is never widened. The GRE
// board's own `CardInstance` type is untouched.
//
// Pure: no Convex, no React, no DOM.

import type {
    BandKey,
    BattlefieldRowClassifier,
} from "~/components/board/board-battlefield";
import type { ProjectedManualCard } from "@convex/manual";
import { manualBandOf, type CatalogueRowLookup } from "./manual-band";
import { parseTypeLine } from "./typeLine";

/** Builds the `{ bandOf, backRowRank }` pair the shared battlefield wants.
 *
 *  - `bandOf` delegates to {@link manualBandOf}: an explicit `lane` always
 *    wins, an unset lane falls through to the Full Catalogue type line, and an
 *    unresolvable print id degrades to the back row.
 *  - `backRowRank` splits the back row the same way the GRE board does — lands
 *    flush-left, every other noncreature permanent flush-right — reading the
 *    same catalogue row. An unresolvable print id ranks as "other", so an
 *    unknown card never masquerades as a land. */
export function makeManualRowClassifier(
    cardById: Map<string, ProjectedManualCard>,
    lookupRow: CatalogueRowLookup
): BattlefieldRowClassifier {
    return {
        bandOf: (card): BandKey =>
            manualBandOf(
                {
                    card: card.card,
                    name: cardById.get(card.id)?.name,
                    lane: cardById.get(card.id)?.lane,
                },
                lookupRow
            ),
        backRowRank: (card): number => {
            const manual = cardById.get(card.id);
            // An explicit column always wins — the player dragged the card
            // there, and that is the only signal a Manual Game has that is
            // never wrong. The catalogue guess below is right whenever the
            // catalogue resolves the card, and silently arbitrary when it does
            // not (it misses a third of the print ids in play), which is what
            // made the back row sort itself half-right.
            if (manual?.backColumn) return manual.backColumn === "left" ? 0 : 1;
            const row = lookupRow(card.card.id, manual?.name);
            if (!row) return 1;
            return parseTypeLine(row.typeLine).types.includes("Land") ? 0 : 1;
        },
    };
}
