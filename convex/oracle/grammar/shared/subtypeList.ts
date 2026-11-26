/**
 * Shared sub-grammar: a printed LIST of subtypes (CR 205.3) — "Bat, Bird,
 * Mouse, or Rabbit", "Squirrels, Bats, Lizards, and Rats", "Squirrel and/or
 * Food".
 *
 * Every conjunction names the same SET, the objects having at least one of the
 * subtypes: "each Scout, Pirate, and Rogue" is not an object that is all three.
 * What differs is which noun phrase may print which conjunction, so the list is
 * returned with the conjunction and its grammatical number, and the READER at
 * each site decides what it admits. Nothing here picks a filter shape.
 *
 * Fail-closed (ADR 0105 § 2): every member is ONE word of the CR 205.3 tables,
 * all members agree in number, a list of three or more carries the serial
 * comma, and no subtype is named twice. A card-type member ("Elf or land") is
 * a union of two filter dimensions and is refused here.
 */

import { isPermanentSubtype, singularOfPermanentSubtype } from "./subtypes";

export interface SubtypeListIR {
    /** As printed, in order, singular. At least two. */
    readonly subtypes: readonly string[];
    readonly conjunction: "or" | "and" | "and/or";
    readonly number: "singular" | "plural";
}

/** "A or B", "A and B", "A and/or B". */
const PAIR = /^([^\s,]+) (or|and|and\/or) ([^\s,]+)$/;
/** "A, B, or C" — three members or more, with the serial comma. */
const SERIAL = /^([^\s,]+(?:, [^\s,]+)+), (or|and|and\/or) ([^\s,]+)$/;

/** The whole phrase as one subtype list, or `null` when it is not one. */
export function readSubtypeList(phrase: string): SubtypeListIR | null {
    const match = phrase.match(SERIAL) ?? phrase.match(PAIR);
    if (match === null) return null;
    const words = [...match[1]!.split(", "), match[3]!];
    const conjunction = match[2] as SubtypeListIR["conjunction"];
    const singular = words.every(isPermanentSubtype);
    // CR 205.3i — "Plains" and its like are their own plural; a list of them
    // alone reads as singular, and any other mix of numbers is refused.
    const subtypes = singular ? words : words.map(singularOfPermanentSubtype);
    if (subtypes.some((s) => s === null)) return null;
    if (new Set(subtypes).size !== subtypes.length) return null;
    return {
        subtypes: subtypes as string[],
        conjunction,
        number: singular ? "singular" : "plural",
    };
}
