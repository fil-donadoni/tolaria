// The colours a card supplies to a Limited mana base (issue #9334): what it
// PRODUCES (`getDefinitionProducibleColors`, the rules' "could produce") plus
// what it FETCHES — a land that sacrifices itself to put a land from the
// library onto the battlefield. A fetch land produces no mana, so the rules'
// reading leaves it colourless, and the Limited Bot then never maindecked or
// drafted the cube's main fixing as fixing. The union is a deck-analysis
// notion only: in game, `getDefinitionProducibleColors` stays the authority.
//
// Derived from the definition's structure, never from a name: an activated
// ability on a LAND whose Effect Script searches the library (`choice` kind
// `search-library`) and moves the found card onto the battlefield fetches the
// colours of the land subtypes its filter names, or every colour when the
// filter asks for a basic land of any type.

import type { CardDefinition, Color, EffectOp } from "../cards/types";
import { getDefinitionProducibleColors } from "../gre/constants";
import { LAND_SUBTYPE_MANA } from "../gre/manaColors";

const ALL_COLOURS: readonly Color[] = ["W", "U", "B", "R", "G"];

/** The colours one search filter can find among lands: the subtypes it
 *  names, or every colour for a basic land of no named subtype. */
function filterColours(
    filter: Extract<EffectOp, { op: "choice" }>["filter"]
): Color[] {
    if (!filter) return [];
    const subtype = filter.subtype;
    if (typeof subtype === "string" || Array.isArray(subtype)) {
        const subtypes: readonly string[] =
            typeof subtype === "string" ? [subtype] : subtype;
        return subtypes
            .map((s) => LAND_SUBTYPE_MANA[s])
            .filter((c): c is Color => c !== undefined && c !== "C");
    }
    return subtype === undefined && filter.supertype === "Basic"
        ? [...ALL_COLOURS]
        : [];
}

/** The colours a land can put onto the battlefield from its library by its
 *  own activated abilities. Empty for a non-land (a tutor fetches cards, not
 *  mana) and for a search whose find goes anywhere but the battlefield. */
export function fetchableColors(def: CardDefinition): Set<Color> {
    const colours = new Set<Color>();
    if (!(def.types ?? []).includes("Land")) return colours;
    for (const ability of def.activatedAbilities ?? []) {
        const effects: readonly EffectOp[] = ability.effects ?? [];
        for (const op of effects) {
            if (op.op !== "choice" || op.kind !== "search-library") continue;
            const bound = op.bind;
            if (!bound) continue;
            const landsOnBattlefield = effects.some(
                (e) =>
                    e.op === "moveZone" &&
                    e.to === "battlefield" &&
                    "cards" in e &&
                    typeof e.cards === "object" &&
                    e.cards !== null &&
                    "ref" in e.cards &&
                    e.cards.ref === bound
            );
            if (!landsOnBattlefield) continue;
            for (const c of filterColours(op.filter)) colours.add(c);
        }
    }
    return colours;
}

/** The colours a card supplies to a Limited mana base: produced ∪ fetched,
 *  in WUBRG order. What every Limited card meta reads as `producedColors`. */
export function limitedSourceColors(def: CardDefinition): Color[] {
    const colours = getDefinitionProducibleColors(def);
    for (const c of fetchableColors(def)) colours.add(c);
    return ALL_COLOURS.filter((c) => colours.has(c));
}

/** True for a mana ability that sacrifices its own source to pay its cost
 *  (`cost.sacrifice`, CR 602.1 / 701.21): it produces mana once and is gone.
 *  A mana ability is one that does not use the stack (CR 605.1a, 605.3b). */
function isOneShotManaAbility(
    ability: NonNullable<CardDefinition["activatedAbilities"]>[number]
): boolean {
    return !ability.useStack && ability.cost.sacrifice === true;
}

/** The colours a card supplies to a Limited mana base ONLY by sacrificing
 *  itself for mana — a one-shot source of that colour (Lotus Petal, Chromatic
 *  Star, the coloured half of Archaeological Dig), never a permanent one. A
 *  subset of `limitedSourceColors`, in WUBRG order: a colour the card also
 *  makes by a mana ability that keeps it (a land subtype, a `{T}` ability) or
 *  fetches is a permanent source and is not listed. A fetch land sacrifices
 *  itself too, but to put a land onto the battlefield, which stays: its
 *  colours are permanent. */
export function oneShotSourceColors(def: CardDefinition): Color[] {
    const abilities = def.activatedAbilities ?? [];
    if (!abilities.some(isOneShotManaAbility)) return [];
    const permanent = getDefinitionProducibleColors({
        ...def,
        activatedAbilities: abilities.filter((a) => !isOneShotManaAbility(a)),
    });
    for (const c of fetchableColors(def)) permanent.add(c);
    const produced = new Set(limitedSourceColors(def));
    return ALL_COLOURS.filter((c) => produced.has(c) && !permanent.has(c));
}
