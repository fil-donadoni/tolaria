/**
 * Type line reading (CR 205.1) — supertypes, card types, subtypes.
 *
 * Structured data, not prose, so this is a table lookup: every word before the
 * em dash must be a known supertype or card type. An unknown word fails the
 * card. That is not pedantry — `types[]` drives every zone rule in the engine,
 * so a type line read as "probably a creature" is a card that behaves wrongly
 * everywhere at once.
 */

import type { CardSupertype, CardType } from "../cards/types";
import type { ParsedTypeLine } from "./types";

const CARD_TYPES: readonly CardType[] = [
    "Creature",
    "Planeswalker",
    "Instant",
    "Sorcery",
    "Artifact",
    "Enchantment",
    "Land",
    "Battle",
    "Kindred",
];

const SUPERTYPES: readonly CardSupertype[] = [
    "Basic",
    "Legendary",
    "Ongoing",
    "Snow",
    "World",
];

/** CR 305.6 — the five basic land types. */
export const BASIC_LAND_TYPES: ReadonlySet<string> = new Set([
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
]);

const CARD_TYPE_SET = new Set<string>(CARD_TYPES);
const SUPERTYPE_SET = new Set<string>(SUPERTYPES);

export type TypeLineResult =
    | { readonly ok: true; readonly parsed: ParsedTypeLine }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

export function readTypeLine(printed: string): TypeLineResult {
    // Scryfall uses an em dash between types and subtypes (CR 205.1).
    const [head, ...restOfDash] = printed.split(" — ");
    if (restOfDash.length > 1) {
        return {
            ok: false,
            reason: "more than one em dash in the type line",
            fragment: printed,
        };
    }
    const subtypes = (restOfDash[0] ?? "")
        .split(" ")
        .filter((w) => w.length > 0);
    const words = (head ?? "").split(" ").filter((w) => w.length > 0);

    const supertypes: CardSupertype[] = [];
    const types: CardType[] = [];
    for (const word of words) {
        if (types.length === 0 && SUPERTYPE_SET.has(word)) {
            supertypes.push(word as CardSupertype);
        } else if (CARD_TYPE_SET.has(word)) {
            types.push(word as CardType);
        } else {
            return {
                ok: false,
                reason: `unknown type-line word "${word}"`,
                fragment: printed,
            };
        }
    }
    if (types.length === 0) {
        return {
            ok: false,
            reason: "type line names no card type",
            fragment: printed,
        };
    }
    return { ok: true, parsed: { types, supertypes, subtypes } };
}
