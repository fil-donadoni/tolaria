// The colours a card supplies to a Limited mana base (issues #9334, #9348):
// what it PRODUCES (`getDefinitionProducibleColors`, the rules' "could
// produce") plus what it FETCHES — a land that sacrifices itself to put a land
// from the library onto the battlefield. A fetch land produces no mana, so the
// rules' reading leaves it colourless. The union is a deck-analysis notion
// only: in game, `getDefinitionProducibleColors` stays the authority.
//
// A fetch's colours depend on its collection. Polluted Delta finds an "Island
// or Swamp card": alone it reaches U/B through basics (always available in
// Limited), beside a Tropical Island it reaches green too. So a card meta
// carries the fetch's TARGETS (`fetchTargetsOf`) and every land's basic land
// types (`landTypesOf`); `resolveFetchSources` widens a fetch's colours
// within the Pool or Maindeck being counted. The static `limitedSourceColors`
// is the floor a fetch has in any collection.
//
// Derived from the definition's structure, never from a name: an activated
// ability on a LAND whose Effect Script searches the library (`choice` kind
// `search-library`) and moves the found card onto the battlefield is a fetch;
// its filter names land subtypes, or asks for a basic land of any type.

import type { CardDefinition, Color, EffectOp } from "../cards/types";
import { getDefinitionProducibleColors } from "../gre/constants";
import { LAND_SUBTYPE_MANA } from "../gre/manaColors";

const ALL_COLOURS: readonly Color[] = ["W", "U", "B", "R", "G"];

/** What a fetch land can find: a basic land of any type, and/or a land card
 *  with one of these basic land types. */
export interface FetchTargets {
    anyBasic: boolean;
    landTypes: readonly string[];
}

/** The fetch targets of a land's activated abilities, or `null` when it has
 *  none. Never set for a non-land (a tutor fetches cards, not mana) or for a
 *  search whose find goes anywhere but the battlefield. */
export function fetchTargetsOf(def: CardDefinition): FetchTargets | null {
    if (!(def.types ?? []).includes("Land")) return null;
    let anyBasic = false;
    const landTypes = new Set<string>();
    let found = false;
    for (const ability of def.activatedAbilities ?? []) {
        const effects: readonly EffectOp[] = ability.effects ?? [];
        for (const op of effects) {
            if (op.op !== "choice" || op.kind !== "search-library") continue;
            const bound = op.bind;
            if (!bound) continue;
            const ontoBattlefield = effects.some(
                (e) =>
                    e.op === "moveZone" &&
                    e.to === "battlefield" &&
                    "cards" in e &&
                    typeof e.cards === "object" &&
                    e.cards !== null &&
                    "ref" in e.cards &&
                    e.cards.ref === bound
            );
            if (!ontoBattlefield || !op.filter) continue;
            const subtype = op.filter.subtype;
            if (typeof subtype === "string" || Array.isArray(subtype)) {
                const named: readonly string[] =
                    typeof subtype === "string" ? [subtype] : subtype;
                for (const t of named) {
                    if (LAND_SUBTYPE_MANA[t] === undefined) continue;
                    landTypes.add(t);
                    found = true;
                }
            } else if (
                subtype === undefined &&
                op.filter.supertype === "Basic"
            ) {
                anyBasic = true;
                found = true;
            }
        }
    }
    return found ? { anyBasic, landTypes: [...landTypes] } : null;
}

/** A land's basic land types (the subtypes carrying an intrinsic mana
 *  ability): what a fetch's search can match. Empty for a non-land. */
export function landTypesOf(def: CardDefinition): string[] {
    if (!(def.types ?? []).includes("Land")) return [];
    return (def.subtypes ?? []).filter(
        (t) => LAND_SUBTYPE_MANA[t] !== undefined
    );
}

/** The colours a fetch reaches through basics alone: every colour for an
 *  any-basic fetch, the named types' colours otherwise. */
function basicReach(targets: FetchTargets): Color[] {
    if (targets.anyBasic) return [...ALL_COLOURS];
    return targets.landTypes
        .map((t) => LAND_SUBTYPE_MANA[t])
        .filter((c): c is Color => c !== undefined && c !== "C");
}

/** The colours a land can fetch with no other land in sight: its floor. */
export function fetchableColors(def: CardDefinition): Set<Color> {
    const targets = fetchTargetsOf(def);
    return new Set(targets ? basicReach(targets) : []);
}

/** The colours a card supplies to a Limited mana base in any collection:
 *  produced ∪ the fetch floor, in WUBRG order. Every Limited card meta's
 *  `producedColors`. */
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

/** The shape `resolveFetchSources` reads: a Limited card meta. */
export interface FetchSourceMeta {
    producedColors: Color[];
    landTypes?: readonly string[];
    fetch?: FetchTargets;
}

/** `metas` with every fetch land's `producedColors` widened by the lands of
 *  `collection` (default: `metas` itself) its search can find: a land
 *  carrying one of the fetch's land types supplies its produced colours. A
 *  non-fetch meta is returned as is (same object). Pure. */
export function resolveFetchSources<T extends FetchSourceMeta>(
    metas: readonly T[],
    collection: readonly FetchSourceMeta[] = metas
): T[] {
    return metas.map((meta) => {
        const targets = meta.fetch;
        if (!targets || targets.landTypes.length === 0) return meta;
        const colours = new Set<Color>(meta.producedColors);
        for (const land of collection) {
            if (land === meta) continue;
            if (
                !(land.landTypes ?? []).some((t) =>
                    targets.landTypes.includes(t)
                )
            )
                continue;
            for (const c of land.producedColors) colours.add(c);
        }
        if (colours.size === meta.producedColors.length) return meta;
        return {
            ...meta,
            producedColors: ALL_COLOURS.filter((c) => colours.has(c)),
        };
    });
}
