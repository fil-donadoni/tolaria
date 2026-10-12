// Board-aware keyword relevance (issue #5356) — which of a creature's priced
// keywords do NOTHING against the players it faces on this board.
//
// WHY. `creatureBody.ts`'s keyword table prices a keyword by the creature's
// power alone, so protection from red read the same against a mono-black
// opponent as against a mono-red one, and swampwalk the same whether or not
// the defender controlled a Swamp. Two families have an exact, public test of
// whether they apply:
//
//   - landwalk (CR 702.14c): the creature "can't be blocked as long as the
//     defending player controls at least one land with the specified land
//     type" — read off the combat registry's own landwalk rules, so a
//     landwalk-negation static (Great Wall) and a snow or supertype variant
//     answer exactly as they do when blockers are declared;
//   - protection from a colour (CR 702.16a): it matters only against sources
//     of that colour — read off the colours the opponent has SHOWN
//     (`observedOpponentColors`: battlefield, graveyard, stack, the decklist
//     at `expert`) plus every colour a mana source they control can produce,
//     tapped or not (a tapped Mountain still says "red").
//
// Such a keyword is INERT and its table bonus is taken back, so it is worth
// zero. Every other case keeps its bonus — fail open to today's reading:
//
//   - an opponent who has shown no colour at all (`unknown`, the abstention
//     `estimateOpponentColorDemand` exists for) — nothing proves the colour is
//     absent;
//   - every non-colour protection quality (creatures, artifacts, everything,
//     a player, a subtype) — no single board fact rules each one out;
//   - menace, flying and the other evasion rows — their worth depends on
//     blockers that change every turn, which the rollouts play out.
//
// In the EVALUATOR, never at the root (ADR 0124 §5): this is a term of the
// creature's valuation, so every consumer of `evaluateCreature` — the leaf,
// the removal lens, the combat deltas — reads the same answer.

import { EVASION_RULES } from "../combatRegistry";
import { getProducibleColors } from "../constants";
import { keywordBonusFor } from "../creatureBody";
import { parseProtectionFromColor } from "../protection";
import type { CardInstanceState, GameState } from "../state";
import { observedOpponentColors } from "./observedColors";

/** The landwalk rule for `keyword`, or undefined when it is not landwalk. */
function landwalkRule(keyword: string) {
    if (!/walk$/.test(keyword)) return undefined;
    return EVASION_RULES.find((r) => r.keyword === keyword);
}

/** CR 702.14c — `keyword` is a landwalk the registry models AND no opposing
 *  battlefield makes it evasive. `canBlock` of a landwalk rule reads only the
 *  defender's battlefield, so the creature itself stands in for both sides. */
function inertLandwalk(
    keyword: string,
    card: CardInstanceState,
    opponents: readonly CardInstanceState[][]
): boolean {
    const rule = landwalkRule(keyword);
    if (!rule) return false;
    return opponents.every((battlefield) =>
        rule.canBlock(card, card, battlefield)
    );
}

/** The colours `opponentId` provably plays, or null when they have shown none
 *  (the abstention — nothing can then be proven absent). */
function shownColors(
    state: GameState,
    opponentId: string,
    battlefield: readonly CardInstanceState[]
): ReadonlySet<string> | null {
    const shown = new Set<string>();
    for (const [color, mass] of Object.entries(
        observedOpponentColors(state, opponentId)
    )) {
        if (mass && mass > 0) shown.add(color);
    }
    for (const permanent of battlefield) {
        for (const color of getProducibleColors(permanent)) shown.add(color);
    }
    shown.delete("C");
    return shown.size > 0 ? shown : null;
}

/** The flat table bonus `creatureValueRaw` added for the keywords of `card`
 *  that are inert on this board (see the header), at `power` — what
 *  `evaluateCreature` takes back. `alreadyRemoved` lists occurrences another
 *  correction has taken back already (the quiet defensive grant, issue
 *  #2937); each is skipped once, so no occurrence is subtracted twice. Zero
 *  on every board where nothing is provably inert. */
export function inertKeywordDiscount(
    state: GameState,
    card: CardInstanceState,
    power: number,
    alreadyRemoved: readonly string[] = []
): number {
    const opponents = state.players.filter((p) => p.id !== card.controllerId);
    if (opponents.length === 0) return 0;
    const skip = [...alreadyRemoved];
    let colors: (ReadonlySet<string> | null)[] | undefined;
    let discount = 0;
    for (const keyword of card.staticAbilities) {
        const skipAt = skip.indexOf(keyword);
        if (skipAt >= 0) {
            skip.splice(skipAt, 1);
            continue;
        }
        let inert = inertLandwalk(
            keyword,
            card,
            opponents.map((p) => p.battlefield)
        );
        const color = inert ? null : parseProtectionFromColor(keyword);
        if (color && color !== "C") {
            colors ??= opponents.map((p) =>
                shownColors(state, p.id, p.battlefield)
            );
            inert = colors.every(
                (shown) => shown !== null && !shown.has(color)
            );
        }
        if (inert) discount += keywordBonusFor(keyword, power);
    }
    return discount;
}
