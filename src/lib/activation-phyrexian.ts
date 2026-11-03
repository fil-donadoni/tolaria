import type { ActivatedAbility } from "@convex/cards/types";
import { phyrexianActivationLifePipOptions } from "@convex/gre/phyrexian";
import {
    phyrexianSplitChoicesForCost,
    type PhyrexianSplitChoice,
} from "~/lib/card-utils";

/** CR 107.4f / 602.2b — the mana-vs-life rows the activator chooses between
 *  for an activated ability whose cost carries Phyrexian pips, judged against
 *  the VIEWER's life net of the ability's own printed life leg (CR 119.4: life
 *  covers the whole payment). The options come from the same pure engine
 *  helper the server validates the pick with
 *  (`phyrexianActivationLifePipOptions`), so a row offered here is a row the
 *  mutation accepts. Empty (no picker) when there is no real choice — no pip,
 *  or life below 2 (mana only). */
export function activationPhyrexianChoices(
    ability: Pick<ActivatedAbility, "cost"> | undefined,
    viewerLife: number
): PhyrexianSplitChoice[] {
    const cost = ability?.cost.mana;
    const options = phyrexianActivationLifePipOptions(
        cost,
        viewerLife - (ability?.cost.life ?? 0)
    );
    return phyrexianSplitChoicesForCost(cost, options);
}
