// mh1 — white cards (ADR 0043 colour split).
import type { CardDefinition, PermanentView } from "../../types";
import { protectionColorModes } from "../../abilities";

// Giver of Runes — {W} Creature — Kor Cleric (issue #684, Cube FREE evasion/
// protection statics). "{T}: Another target creature you control gains
// protection from colorless or from the color of your choice until end of
// turn." (CR 702.16 protection; CR 613.1f temporary keyword grant; CR 700.2
// modal choice; CR 109.2 "another" excludes the source itself.)
export const giverOfRunes: CardDefinition = {
    id: "4e117771-5a8b-4812-b487-32ba34b7f724",
    name: "Giver of Runes",
    rarity: "rare",
    oracleText:
        "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Kor", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "giver-of-runes-protect",
            oracleText:
                "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            getTargetRequirement: (source: PermanentView) => ({
                type: "Creature",
                count: 1,
                controller: "you",
                excludeInstanceIds: [source.id],
            }),
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose colorless or a color",
                    modes: protectionColorModes(["C", "W", "U", "B", "R", "G"]),
                },
            ],
        },
    ],
};

// Ephemerate — {W} Instant (issue #1402, closes the #676 stub). "Exile target
// creature you control, then return it to the battlefield under its owner's
// control. Rebound." Rebound (CR 702.88) shipped as reusable engine infra
// (`convex/gre/rebound.ts`, Mechanics Registry `rebound` now `implemented`) —
// see that module for the full timing model. The blink itself is the #1401
// "exile(bind) + moveZone(ref, battlefield)" idiom, the SAME-resolution shape
// (no `delayedTrigger` wrapper — unlike Liberate/Flickerwisp, which delay the
// return to the next end step, Ephemerate's oracle text has no such delay):
// `exile` the announced target with a `bind`, then an immediate `moveZone`
// resolves the bound ref back via `resolveObjectRef`'s exile-zone fallback,
// returning the card under its OWNER's control by default (no explicit
// `controller` — matches "under its owner's control"). Cast again from exile
// at the caster's next upkeep (Rebound), the fresh copy picks a NEW target.
export const ephemerate: CardDefinition = {
    id: "2da5f3f8-5eef-498f-ba2c-2f3fbc3745aa",
    name: "Ephemerate",
    rarity: "common",
    oracleText:
        "Exile target creature you control, then return it to the battlefield under its owner's control. Rebound. (If you cast this spell from your hand, instead of putting it into your graveyard as it resolves, exile it. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
    manaCost: { W: 1 },
    types: ["Instant"],
    staticAbilities: ["rebound"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    effects: [
        { op: "exile", target: { target: 0 }, bind: "$c" },
        { op: "moveZone", target: { ref: "$c" }, to: "battlefield" },
    ],
};

// Winds of Abandon — {1}{W} Sorcery (MH1 35, Vintage Cube). "Exile target
// creature you don't control. For each creature exiled this way, its controller
// searches their library for a basic land card. Those players put those cards
// onto the battlefield tapped, then shuffle. Overload {4}{W}{W}."
//
// CR 702.96 (issue #3215). The whole card is ONE `forEach { set: "targets" }`:
// printed, that set is the single announced target; overloaded it is every
// creature the caster doesn't control, computed with targeting restrictions
// bypassed (CR 702.96b), which is how an overloaded Winds exiles a hexproof
// creature that could never have been its target.
//
// The second sentence is the same text in both modes — "for each creature
// exiled this way" is already a fan-out — so it lives INSIDE the same
// iteration: one basic land per creature exiled, which is what makes an
// overloaded Winds a one-sided wrath that ramps its victim N times, not once.
// The searching player is read off the exile's `bind` SNAPSHOT
// (`{ ref: "$exiled.controller" }`), never off the card's live zone: by then it
// is in exile, and CR 608.2h's "last known information" is exactly what the
// snapshot holds.
//
// CR 701.23b — "a basic land card" is a stated quality in a hidden zone, so the
// searcher isn't required to find one even though the search is mandatory:
// `count: { min: 0, max: 1 }`, the Quirion Trailblazer shape.
//
// One divergence — tracked-by: #3289 — and it is a capability gap rather than
// a reading: CR 701.23h collapses repeated searches before a shuffle into ONE
// search, and the Oracle's "those players put those cards onto the battlefield
// tapped, then shuffle" enters the lands together. This runs one search, one
// entry and one shuffle PER exiled creature instead. A second `forEach` pass
// cannot fix it (`execForEach` skips a member that has already left the
// battlefield), and one search for N cards needs a `count` resolved at runtime,
// which the `choice` Op does not take. Observable only through a
// search-watching or lands-entering trigger.
//
// The grammar has no keyword-cost line rule for CR 702.96, and the
// "for each creature exiled this way…" tail has no rule either, so neither
// line round-trips yet (issue #3274):
// compiler-gap: Overload {4}{W}{W} (#3274)
export const windsOfAbandon: CardDefinition = {
    id: "3bb17913-fe4d-4acd-9b75-71f5a90f898b",
    name: "Winds of Abandon",
    rarity: "rare",
    oracleText:
        'Exile target creature you don\'t control. For each creature exiled this way, its controller searches their library for a basic land card. Those players put those cards onto the battlefield tapped, then shuffle.\nOverload {4}{W}{W} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
    manaCost: { X: 1, W: 1 },
    types: ["Sorcery"],
    overload: {
        id: "overload",
        description: "Overload {4}{W}{W}",
        mana: { X: 4, W: 2 },
    },
    targetRequirement: { type: "Creature", count: 1, controller: "opponent" },
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                { op: "exile", target: { ref: "$each" }, bind: "$exiled" },
                {
                    op: "choice",
                    kind: "search-library",
                    player: { ref: "$exiled.controller" },
                    zone: "library",
                    filter: { type: "Land", supertype: "Basic" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a basic land card.",
                    bind: "$land",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$land" },
                    player: { ref: "$exiled.controller" },
                    from: "library",
                    to: "battlefield",
                    tapped: true,
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { ref: "$exiled.controller" },
                },
            ],
        },
    ],
};
