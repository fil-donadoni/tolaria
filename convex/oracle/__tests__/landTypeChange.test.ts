// Land-type change: "<subject> becomes <basic land types> until <duration>"
// (CR 305.7 / CR 613.1d layer 4, CR 305.6, CR 608.2d — issue #4138).
//
// Four layers, each watching a different way this family can go wrong:
//
//  1. GOLDEN forms — a real corpus card must produce exactly the Compiled
//     Definition below, for each of the three arities the template prints:
//     the free choice among all five types (an activated ability, a spell,
//     and a "you control" narrowing), the named PAIR, and the single named
//     type — which emits no `optionChoice` at all, because a one-mode offer
//     is not a choice (CR 608.2d).
//  2. REFUSALS — the neighbours this rule must NOT read: the ADD form
//     ("in addition to its other types", CR 205.1b), a duration the shared
//     sub-grammar does not know, a subject that is not a land, a CR 205.3i
//     land type that is not one of CR 305.6's five, and a line with no
//     duration at all. Each stays refused under its own Grammar Gap key.
//  3. The MODE ORDER, which is a compiled byte: the grammar's vendored
//     CR 305.6 list and the catalogue's `BASIC_LAND_SUBTYPES` are asserted
//     identical, so a reordering on either side reds here rather than
//     silently splitting a compiled card from the hand-written one beside it.
//  4. VALIDATION — a golden compares a definition and says nothing about
//     whether that definition validates, so the graduates are compiled
//     through the real gate and required to reach `ready`, not `quarantine`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";
import { BASIC_LAND_SUBTYPE_ORDER } from "../grammar/shared/subtypes";
import { BASIC_LAND_SUBTYPES } from "../../cards/types";

/** The `setSubtype` Op one mode (or a whole one-type line) lowers to. */
function becomes(subtype: string) {
    return {
        op: "setSubtype",
        target: { target: 0 },
        subtypes: [subtype],
        duration: { phase: "end-of-turn" },
    };
}

/** The `optionChoice` Op the rule emits for an offer of two or more types. */
function landTypePick(name: string, offered: readonly string[]) {
    return {
        op: "optionChoice",
        prompt: `Choose a basic land type (${name}).`,
        modes: offered.map((subtype) => ({
            id: subtype,
            label: subtype,
            effects: [becomes(subtype)],
        })),
    };
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The compile STATE, which is what separates `ready` from `quarantine`. */
function state(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? `unparsed: ${JSON.stringify(outcome.gaps)}`
        : outcome.state;
}

/**
 * WHERE the compiler gave up on every line of a card it refuses — the reason,
 * or the furthest sub-grammar path and the span it could not read.
 *
 * Every line, not the first: a refusal test whose card carries a SECOND unread
 * sentence goes on passing after the thing it guards stops guarding.
 */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    return outcome.gaps.map((gap) =>
        gap.attribution === undefined
            ? gap.reason
            : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`
    );
}

describe("becomes a basic land type (CR 305.7)", () => {
    // The free choice, on an activated ability — the APC pilot's own card.
    it("compiles the free five-type choice — Reef Shaman, whole", () => {
        const oracleText =
            "{T}: Target land becomes the basic land type of your choice until end of turn.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "4ad870b2-133c-4229-84a8-f91e4c62fcd0",
                        name: "Reef Shaman",
                        manaCost: "{U}",
                        typeLine: "Creature — Merfolk Shaman",
                        oracleText,
                        power: "0",
                        toughness: "2",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Reef Shaman",
                types: ["Creature"],
                subtypes: ["Merfolk", "Shaman"],
                manaCost: { U: 1 },
                power: 0,
                toughness: 2,
                oracleText,
                activatedAbilities: [
                    {
                        id: "reef-shaman-ability",
                        oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            landTypePick("Reef Shaman", [
                                "Plains",
                                "Island",
                                "Swamp",
                                "Mountain",
                                "Forest",
                            ]),
                        ],
                        targetRequirement: { type: "Land", count: 1 },
                    },
                ],
            })
        );
    });

    // The same clause in the SPELL slot, where it is the spell's own effect
    // rather than an ability's — the second APC target.
    it("compiles the spell slot — Shimmering Mirage, whole", () => {
        const oracleText =
            "Target land becomes the basic land type of your choice until end of turn.\nDraw a card.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "d1720ddc-d6ad-4d78-8dd7-29539bbb73da",
                        name: "Shimmering Mirage",
                        manaCost: "{1}{U}",
                        typeLine: "Instant",
                        oracleText,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Shimmering Mirage",
                types: ["Instant"],
                manaCost: { X: 1, U: 1 },
                oracleText,
                effects: [
                    landTypePick("Shimmering Mirage", [
                        "Plains",
                        "Island",
                        "Swamp",
                        "Mountain",
                        "Forest",
                    ]),
                    { op: "draw", player: "controller", count: 1 },
                ],
                targetRequirement: { type: "Land", count: 1 },
            })
        );
    });

    // CR 115.1 — the same clause over a NARROWED slot. The narrowing is the
    // shared target sub-grammar's, not this rule's, and the point of the
    // golden is that the rule reads whatever that sub-grammar announced
    // rather than re-deciding it.
    it("compiles the you-control narrowing — Unstable Frontier, whole", () => {
        const landTypeLine =
            "{T}: Target land you control becomes the basic land type of your choice until end of turn.";
        const oracleText = `{T}: Add {C}.\n${landTypeLine}`;
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "495214b5-2eab-4fe4-8879-a30a57a67163",
                        name: "Unstable Frontier",
                        manaCost: "",
                        typeLine: "Land",
                        oracleText,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Unstable Frontier",
                types: ["Land"],
                oracleText,
                activatedAbilities: [
                    {
                        id: "unstable-frontier-mana",
                        oracleText: "{T}: Add {C}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { C: 1 },
                    },
                    {
                        id: "unstable-frontier-ability-2",
                        oracleText: landTypeLine,
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            landTypePick("Unstable Frontier", [
                                "Plains",
                                "Island",
                                "Swamp",
                                "Mountain",
                                "Forest",
                            ]),
                        ],
                        targetRequirement: {
                            type: "Land",
                            count: 1,
                            controller: "you",
                        },
                    },
                ],
            })
        );
    });

    // CR 608.2d — the RESTRICTED offer: the same pick, over the two types the
    // line names instead of CR 305.6's five. Same production, one field
    // different, which is the whole reason this is one rule and not two.
    it("compiles the named pair — Tundra Kavu, whole", () => {
        const oracleText =
            "{T}: Target land becomes a Plains or an Island until end of turn.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "b0b7d88b-694b-4bbe-888d-05245e7d1c3e",
                        name: "Tundra Kavu",
                        manaCost: "{2}{R}",
                        typeLine: "Creature — Kavu",
                        oracleText,
                        power: "2",
                        toughness: "2",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Tundra Kavu",
                types: ["Creature"],
                subtypes: ["Kavu"],
                manaCost: { X: 2, R: 1 },
                power: 2,
                toughness: 2,
                oracleText,
                activatedAbilities: [
                    {
                        id: "tundra-kavu-ability",
                        oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            landTypePick("Tundra Kavu", ["Plains", "Island"]),
                        ],
                        targetRequirement: { type: "Land", count: 1 },
                    },
                ],
            })
        );
    });

    // The degenerate arity: ONE named type, and so NO choice at all. The
    // `optionChoice` wrapper is absent, not present with a single mode —
    // the shape the hand-written Kavu Recluse (sets/pls/red.ts) already
    // ships, which is why it round-trips under Guard C.
    it("compiles the single named type with NO choice — Kavu Recluse, whole", () => {
        const oracleText =
            "{T}: Target land becomes a Forest until end of turn.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "d44ff432-7485-448f-a08d-8417e18b8820",
                        name: "Kavu Recluse",
                        manaCost: "{2}{R}",
                        typeLine: "Creature — Kavu",
                        oracleText,
                        power: "2",
                        toughness: "2",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Kavu Recluse",
                types: ["Creature"],
                subtypes: ["Kavu"],
                manaCost: { X: 2, R: 1 },
                power: 2,
                toughness: 2,
                oracleText,
                activatedAbilities: [
                    {
                        id: "kavu-recluse-ability",
                        oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [becomes("Forest")],
                        targetRequirement: { type: "Land", count: 1 },
                    },
                ],
            })
        );
    });
});

describe("becomes a basic land type — the neighbours it refuses", () => {
    // CR 205.1b — "in addition to its other types" KEEPS the land's own
    // types; CR 305.7's set REPLACES them. Two different continuous effects,
    // and the `addSubtype` Op the ADD form would need has no duration arm at
    // all, so reading this line as a set would be a card that does something
    // else. Its own Grammar Gap key.
    it("refuses the ADD form — Navigator's Compass", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "c994e148-1bb5-4113-a9f2-73e6dab8f72d",
                    name: "Navigator's Compass",
                    manaCost: "{1}",
                    typeLine: "Artifact",
                    oracleText:
                        "When this artifact enters, you gain 3 life.\n{T}: Until end of turn, target land you control becomes the basic land type of your choice in addition to its other types.",
                })
            )
        ).toEqual([
            "effect clause: Until end of turn, target land you control becomes the basic land type of your choice in addition to its other types",
        ]);
    });

    // The duration sub-grammar knows four phrases and this is not one of
    // them. The refusal is attributed to `duration`, not to the effect
    // clause — the land-type half reads fine, and the gap that has to be
    // closed to graduate this card is the duration's.
    it("refuses an unknown duration — Orcish Farmer", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "c3039d19-8c98-4953-8943-9922b6ab45ef",
                    name: "Orcish Farmer",
                    manaCost: "{1}{R}{R}",
                    typeLine: "Creature — Orc",
                    oracleText:
                        "{T}: Target land becomes a Swamp until its controller's next untap step.",
                    power: "2",
                    toughness: "2",
                })
            )
        ).toEqual([
            "effect clause > duration: until its controller's next untap step",
        ]);
    });

    // CR 305.7 is written about a LAND. Writing "Forest" into a creature's
    // subtype line would give it the name and none of the meaning — the mana
    // ability comes with the land card type (CR 305.6) — so the selector is
    // an allow-list of one shape. No printed card spells this, which is
    // exactly why the guard is a test rather than a corpus row.
    it("refuses a subject that is not a land", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "00000000-0000-4000-8000-000000000001",
                    name: "Probe Creature Terrain",
                    manaCost: "{U}",
                    typeLine: "Creature — Merfolk",
                    oracleText:
                        "{T}: Target creature becomes a Forest until end of turn.",
                    power: "1",
                    toughness: "1",
                })
            )
        ).toEqual([
            "only a land on the battlefield has land types (CR 305.7, CR 110.1)",
        ]);
    });

    // CR 305.6 names five; Desert is a CR 205.3i land type and not one of
    // them, so it is a type a land can HAVE and never one this template
    // sets. The reader falls through rather than offering a sixth mode.
    it("refuses a land type that is not one of the five", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "00000000-0000-4000-8000-000000000002",
                    name: "Probe Desert Terrain",
                    manaCost: "{U}",
                    typeLine: "Creature — Merfolk",
                    oracleText:
                        "{T}: Target land becomes a Desert until end of turn.",
                    power: "1",
                    toughness: "1",
                })
            )
        ).toEqual([
            "effect clause: Target land becomes a Desert until end of turn",
        ]);
    });

    // CR 611.2a — no duration means it lasts until the end of the game. Every
    // printed land-type change carries one, so a line without one is a line
    // this grammar has not seen, not an indefinite change to be invented.
    it("refuses a line with no duration", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "00000000-0000-4000-8000-000000000003",
                    name: "Probe Undated Terrain",
                    manaCost: "{U}",
                    typeLine: "Creature — Merfolk",
                    oracleText: "{T}: Target land becomes a Forest.",
                    power: "1",
                    toughness: "1",
                })
            )
        ).toEqual(["effect clause: Target land becomes a Forest"]);
    });
});

describe("becomes a basic land type — the mode order is a compiled byte", () => {
    // The grammar's vendored CR 305.6 list decides the order of the modes in
    // every definition this rule emits, and the catalogue's own list decides
    // the order in the hand-written Dream Thrush beside it. A divergence is
    // five modes in a different order — a diff no reviewer would catch and a
    // Guard C round-trip failure nobody would attribute.
    it("matches the catalogue's BASIC_LAND_SUBTYPES exactly", () => {
        expect(BASIC_LAND_SUBTYPE_ORDER).toEqual(BASIC_LAND_SUBTYPES);
    });
});

describe("becomes a basic land type — the graduates reach ready", () => {
    // A golden compares a definition; it says nothing about whether the
    // Effect Script it contains VALIDATES, or whether the smoke planner can
    // play it. Both are what separates `ready` from `quarantine`, and a card
    // that compiles into quarantine has graduated nothing.
    it.each([
        [
            "Reef Shaman",
            "Creature — Merfolk Shaman",
            "{T}: Target land becomes the basic land type of your choice until end of turn.",
        ],
        [
            "Tundra Kavu",
            "Creature — Kavu",
            "{T}: Target land becomes a Plains or an Island until end of turn.",
        ],
        [
            "Kavu Recluse",
            "Creature — Kavu",
            "{T}: Target land becomes a Forest until end of turn.",
        ],
    ])("%s reaches ready", (name, typeLine, oracleText) => {
        expect(
            state(
                oracleCard({
                    oracleId: `00000000-0000-4000-8000-00000000000${name.length}`,
                    name,
                    manaCost: "{2}{R}",
                    typeLine,
                    oracleText,
                    power: "2",
                    toughness: "2",
                })
            )
        ).toBe("ready");
    });
});
