// Limited drafted-set basics (issue #1115, #5106): the pure half of
// `ResolveBasicLand`. The `cardPrints` read happens above this module
// (`loadPrintIdsInSet`, `convex/cardPrintRows.ts`); everything here is
// synchronous, the same split `convex/cards/printRows.ts` draws.
import { getCardByName } from "../cards";
import { basicLandsForColors } from "../cards/colors";
import { getDefinitionSetCode } from "../cards/catalogue";
import type { Color } from "../cards/types";
import type { ResolveBasicLand } from "./autoBuild";

/** The five basics' Card IDs — what a boundary asks `loadPrintIdsInSet` for. */
export function basicLandCardIds(): string[] {
    return (["W", "U", "B", "R", "G"] as const).map(
        (color) => getCardByName(basicLandsForColors([color])[0]).id
    );
}

/** Resolves ONE basic land of `color` to a `DeckCard` printed in `setCode`
 *  when a printing of that basic exists there, else the card's own canonical
 *  printing (issue #1115: "basics of the drafted set"). The Card
 *  Definition's own printing counts first (no `cardPrints` row ever holds it);
 *  `printIdsInSet` is the table's printing of each basic in `setCode`. */
export function makeResolveBasicLand(
    setCode: string,
    printIdsInSet: ReadonlyMap<string, string>
): ResolveBasicLand {
    return (color: Color) => {
        const name = basicLandsForColors([color])[0];
        const def = getCardByName(name);
        const printId =
            getDefinitionSetCode(def.id) === setCode
                ? def.id
                : printIdsInSet.get(def.id);
        return { cardId: printId ?? def.id, cardName: name };
    };
}
