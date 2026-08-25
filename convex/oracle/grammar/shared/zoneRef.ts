/**
 * Shared sub-grammar: ZONE REFERENCE — "your graveyard", "the battlefield",
 * "its owner's hand", "the top of your library" (CR 400.1).
 *
 * A zone phrase carries three separate facts — WHICH zone, WHOSE, and WHERE in
 * it — and Oracle text routinely varies one of the three while leaving the
 * other two ("on top of your library" vs "on the bottom of your library" vs
 * "into your graveyard"). Reading two of the three and defaulting the last is
 * how a tutor becomes a mill; all three are parsed or the phrase fails.
 */

import { fail, ok, rule, type Rule } from "../../rule";

export const ZONE_REF = "zone reference";

/** CR 400.1 — the zones grammar v0 can name. */
export type ZoneKind =
    | "battlefield"
    | "graveyard"
    | "hand"
    | "library"
    | "exile";

export interface ZoneRefIR {
    readonly zone: ZoneKind;
    /**
     * Whose zone. `"its-owner"` is the CR 400.3 default for a card CHANGING
     * zones ("return it to its owner's hand"), and is deliberately distinct
     * from `"you"`: they differ whenever the object is not yours, which is the
     * whole point of a bounce spell.
     */
    readonly owner: "you" | "its-owner" | "any";
    /** CR 401.1 — a library is ordered, so a library reference needs an end. */
    readonly position?: "top" | "bottom";
}

const PHRASES: ReadonlyMap<string, ZoneRefIR> = new Map<string, ZoneRefIR>([
    ["the battlefield", { zone: "battlefield", owner: "any" }],
    ["your graveyard", { zone: "graveyard", owner: "you" }],
    ["a graveyard", { zone: "graveyard", owner: "any" }],
    ["its owner's graveyard", { zone: "graveyard", owner: "its-owner" }],
    ["your hand", { zone: "hand", owner: "you" }],
    ["its owner's hand", { zone: "hand", owner: "its-owner" }],
    ["exile", { zone: "exile", owner: "any" }],
    ["your library", { zone: "library", owner: "you" }],
    [
        "the top of your library",
        { zone: "library", owner: "you", position: "top" },
    ],
    [
        "the bottom of your library",
        { zone: "library", owner: "you", position: "bottom" },
    ],
    [
        "the top of its owner's library",
        { zone: "library", owner: "its-owner", position: "top" },
    ],
    [
        "the bottom of its owner's library",
        { zone: "library", owner: "its-owner", position: "bottom" },
    ],
]);

export const zoneRefRule: Rule<ZoneRefIR> = rule(ZONE_REF, (span) => {
    const hit = PHRASES.get(span.toLowerCase());
    return hit === undefined
        ? fail("not a zone reference this grammar knows", span)
        : ok(hit);
});
