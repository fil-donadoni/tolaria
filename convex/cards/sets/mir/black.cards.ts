// mir — black cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Shallow Grave — {1}{B} Instant. "Return the top creature card of your
// graveyard to the battlefield. That creature gains haste until end of turn.
// Exile it at the beginning of the next end step." (CR 404.3 ordered
// graveyard, CR 400.7 reanimation, CR 702.10 haste, CR 603.7 delayed
// trigger.) Shipped by issue #1967, which built the deterministic
// top-of-graveyard selector this card was blocked on: "the TOP creature card
// of your graveyard" is a FILTERED positional scan (`moveZone`'s fifth shape,
// `target: { zone: "graveyard", position: "top", filter: { type: "Creature" } }`)
// — the topmost card MATCHING the filter, so a non-creature sitting above a
// creature is scanned past rather than making the spell fizzle. Deliberately
// NOT a player choice: substituting one would diverge from the modern oracle
// text (ADR 0004).
//
// The rest is the Sneak Attack idiom (`usg/red.ts`, issue #1151) with the
// sacrifice swapped for an exile: `bind` snapshots the permanent that just
// entered, `grantAbility(haste)` reads it, and `delayedTrigger`'s `capture`
// carries it to the next end step. `grantAbility`'s
// `duration: { phase: "end-of-turn" }` matches the oracle's "until end of
// turn" literally here (unlike Sneak Attack, whose grant is indefinite in
// print).
//
// An empty graveyard — or one holding no creature card — is a clean CR 608.2b
// no-op: the interpreter finds nothing, the moveZone is skipped, and the
// follow-up Ops read an unbound `$revived` and skip in turn.
export const shallowGrave: CardDefinition = {
    id: "d5c782cc-c951-4c6f-a93f-774ae6c1c214",
    name: "Shallow Grave",
    rarity: "rare",
    oracleText:
        "Return the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "moveZone",
            target: {
                zone: "graveyard",
                position: "top",
                player: "controller",
                filter: { type: "Creature" },
            },
            to: "battlefield",
            bind: "$revived",
        },
        {
            op: "grantAbility",
            ability: "haste",
            target: { ref: "$revived" },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText: "Exile it at the beginning of the next end step.",
            capture: { $captured: { ref: "$revived" } },
            effects: [{ op: "exile", target: { ref: "$captured" } }],
        },
    ],
};
