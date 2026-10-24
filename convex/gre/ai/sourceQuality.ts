// Quality of ONE mana source — the derivation behind smart auto-tap's
// untapped-source bonus (`evaluate.ts`) and the library-search land pricing
// (`candidateValue.ts`). Lives beside the Bot modules, not in `evaluate.ts`,
// because `gre/ai` must not depend on `evaluate.ts`.

import type { CardInstanceState } from "../state";
import {
    getProducibleColorsOnBoard,
    hasNonManaActivatedAbility,
    isUntappedManaSource,
} from "../constants";
import { tryGetDefinition } from "../../cards";
import type { EvalWeights } from "./evalWeights";

/** Quality of ONE mana source: its extra colour breadth plus the dual-purpose
 *  flat bonus. The single derivation behind the auto-tap bonus above AND the
 *  library-search land pricing (`ai/candidateValue.ts`), so the two can never
 *  disagree on what makes a source better than a plain basic. Zero for a
 *  permanent that is not a currently usable mana source. Pure. */
export function sourceQuality(
    perm: CardInstanceState,
    controllerBattlefield: readonly CardInstanceState[],
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    weights: EvalWeights
): number {
    // CR 605.1a / 305.6 — score only sources that can produce mana; a
    // fetchland (no mana ability) is not one, even though `isLand` is true
    // and its search ability makes it "dual-purpose" (issue #1499). Nor is
    // a board-conditional source currently producing zero (issue #1889).
    if (!isUntappedManaSource(perm, controllerBattlefield)) return 0;
    // Only score a source with a real definition — a token without one
    // (`getProducibleColorsOnBoard` reads the throwing `getDefinition`)
    // contributes nothing to source quality.
    if (!tryGetDefinition((perm.card as { id?: string }).id ?? "")) return 0;
    let bonus = 0;
    // CR 106.4 (issue #1941) — BOARD-aware breadth: a board-derived
    // colour set (Meteor Crater, Fellwar Stone) is worth exactly what it
    // currently offers, not the five-colour no-board fallback its static
    // `manaChoices` carries.
    const breadth = getProducibleColorsOnBoard(perm, battlefields).size;
    if (breadth > 1) bonus += (breadth - 1) * weights.sourceBreadthWeight;
    if (hasNonManaActivatedAbility(perm))
        bonus += weights.sourceDualPurposeWeight;
    return bonus;
}
