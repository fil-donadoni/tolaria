// Compound trigger heads (issue #10353): "whenever <self> or another <noun>
// you control <event>" (CR 201.5 + CR 109.2) and "when this artifact enters and
// when you sacrifice it" (CR 603.2 + CR 603.6a + CR 701.21a).
//
//  1. GOLDEN fixtures — a real corpus card compiled whole, one per accepted
//     form: another creature enters, another <creature type> enters, another
//     creature leaves the battlefield without dying, enters-and-sacrificed.
//  2. REFUSALS — the neighbours the rule must not read (fail-closed).
//  3. LOWERING invariant — the "this or another X" collapse to "an X of
//     yours" holds only for a card printed as an X.
//  4. The REBUILT abilities fire on exactly the events the words name.

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    GameEvent,
    PermanentLeftEvent,
    PermanentView,
} from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import {
    matchSelfHead,
    matchSelfOrAnotherHead,
} from "../grammar/shared/triggerHead";
import { oracleCard } from "./oracle.fixture";

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const BOGWATER_LUMARET = oracleCard({
    name: "Bogwater Lumaret",
    manaCost: "{B}{G}",
    typeLine: "Creature — Spirit Frog",
    oracleText:
        "Whenever this creature or another creature you control enters, you gain 1 life.",
    power: "2",
    toughness: "2",
});

const KAZANDU_BLADEMASTER = oracleCard({
    name: "Kazandu Blademaster",
    manaCost: "{W}{W}",
    typeLine: "Creature — Human Soldier Ally",
    oracleText:
        "First strike, vigilance\nWhenever this creature or another Ally you control enters, you may put a +1/+1 counter on this creature.",
    power: "1",
    toughness: "1",
});

const THREE_TREE_SCRIBE = oracleCard({
    name: "Three Tree Scribe",
    manaCost: "{1}{G}",
    typeLine: "Creature — Frog Druid",
    oracleText:
        "Whenever this creature or another creature you control leaves the battlefield without dying, put a +1/+1 counter on target creature you control.",
    power: "2",
    toughness: "3",
});

const HEAPED_HARVEST = oracleCard({
    name: "Heaped Harvest",
    manaCost: "{2}{G}",
    typeLine: "Artifact — Food",
    oracleText:
        "When this artifact enters and when you sacrifice it, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\n{2}, {T}, Sacrifice this artifact: You gain 3 life.",
    power: undefined,
    toughness: undefined,
});

describe("self-or-another trigger heads — golden fixtures (CR 201.5, CR 109.2)", () => {
    it("another creature enters (CR 603.6a): Bogwater Lumaret", () => {
        const text =
            "Whenever this creature or another creature you control enters, you gain 1 life.";
        expect(sortKeys(compiled(BOGWATER_LUMARET))).toEqual(
            sortKeys({
                name: "Bogwater Lumaret",
                types: ["Creature"],
                subtypes: ["Spirit", "Frog"],
                manaCost: { B: 1, G: 1 },
                power: 2,
                toughness: 2,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "bogwater-lumaret-trigger",
                        oracleText: text,
                        head: {
                            kind: "entered",
                            scope: "yours",
                            filter: { types: ["Creature"] },
                        },
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            })
        );
    });

    it("another <creature type> enters (CR 205.3m): Kazandu Blademaster", () => {
        const text =
            "Whenever this creature or another Ally you control enters, you may put a +1/+1 counter on this creature.";
        expect(sortKeys(compiled(KAZANDU_BLADEMASTER))).toEqual(
            sortKeys({
                name: "Kazandu Blademaster",
                types: ["Creature"],
                subtypes: ["Human", "Soldier", "Ally"],
                manaCost: { W: 2 },
                power: 1,
                toughness: 1,
                oracleText: KAZANDU_BLADEMASTER.oracleText,
                staticAbilities: ["first strike", "vigilance"],
                compiledTriggeredAbilities: [
                    {
                        id: "kazandu-blademaster-trigger",
                        oracleText: text,
                        head: {
                            kind: "entered",
                            scope: "yours",
                            filter: { subtypes: ["Ally"] },
                        },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Put a +1/+1 counter on this creature?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "counters",
                                        action: "add",
                                        counter: "+1/+1",
                                        target: { ref: "$source" },
                                        count: 1,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("another creature leaves the battlefield without dying (CR 603.6c + CR 700.4): Three Tree Scribe", () => {
        expect(sortKeys(compiled(THREE_TREE_SCRIBE))).toEqual(
            sortKeys({
                name: "Three Tree Scribe",
                types: ["Creature"],
                subtypes: ["Frog", "Druid"],
                manaCost: { X: 1, G: 1 },
                power: 2,
                toughness: 3,
                oracleText: THREE_TREE_SCRIBE.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "three-tree-scribe-trigger",
                        oracleText: THREE_TREE_SCRIBE.oracleText,
                        head: {
                            kind: "left",
                            scope: "yours",
                            filter: { types: ["Creature"] },
                            toZone: ["exile", "hand", "library"],
                        },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "you",
                        },
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "+1/+1",
                                target: { target: 0 },
                                count: 1,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("enters and when you sacrifice it (CR 603.2 + CR 701.21a): Heaped Harvest", () => {
        const text =
            "When this artifact enters and when you sacrifice it, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.";
        expect(sortKeys(compiled(HEAPED_HARVEST))).toEqual(
            sortKeys({
                name: "Heaped Harvest",
                types: ["Artifact"],
                subtypes: ["Food"],
                manaCost: { X: 2, G: 1 },
                oracleText: HEAPED_HARVEST.oracleText,
                activatedAbilities: [
                    {
                        id: "heaped-harvest-ability",
                        oracleText:
                            "{2}, {T}, Sacrifice this artifact: You gain 3 life.",
                        cost: { mana: { X: 2 }, tap: true, sacrifice: true },
                        useStack: true,
                        effects: [
                            { op: "gainLife", player: "controller", amount: 3 },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "heaped-harvest-trigger",
                        oracleText: text,
                        head: { kind: "enters-or-sacrificed" },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle?",
                                bind: "$may2",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may2" },
                                then: [
                                    {
                                        op: "choice",
                                        kind: "search-library",
                                        player: "controller",
                                        zone: "library",
                                        filter: {
                                            type: "Land",
                                            supertype: "Basic",
                                        },
                                        count: { min: 0, max: 1 },
                                        prompt: "Search your library for a basic land card.",
                                        bind: "$found1",
                                    },
                                    {
                                        op: "moveZone",
                                        cards: { ref: "$found1" },
                                        player: "controller",
                                        from: "library",
                                        to: "battlefield",
                                        tapped: true,
                                    },
                                    {
                                        op: "libraryLook",
                                        action: "shuffle",
                                        player: "controller",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("self-or-another trigger heads — refused neighbours (fail-closed)", () => {
    it.each([
        // CR 702.9a — no zone-change event carries the moving permanent's
        // keywords, so a `requireAbility` filter there would never match.
        "Whenever this creature or another creature you control with flying enters",
        "Whenever this creature or another creature you control with flying dies",
        // No filter field compares a permanent's toughness with its power.
        "Whenever this creature or another creature you control with toughness greater than its power enters",
        // A card type, a plural, a type list and "dies": no fixture here.
        "Whenever this creature or another artifact you control enters",
        "Whenever this creature or another Elf or Warrior you control enters",
        "Whenever this creature or another creature you control dies",
        "Whenever this creature or another Ally you control leaves the battlefield without dying",
        // Not a self subject on the left of "or".
        "Whenever a creature or another creature you control enters",
        // "under your control" is the older wording, not this frame.
        "Whenever this creature or another Ally enters the battlefield under your control",
    ])("refuses %j", (span) => {
        expect(matchSelfOrAnotherHead(span)).toBeNull();
    });

    it.each([
        // CR 701.21a — a destroy is no sacrifice, and "or" is another head.
        "When this artifact enters and when it's destroyed",
        "When this artifact enters or when you sacrifice it",
        // The corpus prints "when"; "whenever" is unread.
        "Whenever this artifact enters and when you sacrifice it",
    ])("refuses the enters-and-sacrificed neighbour %j", (span) => {
        expect(matchSelfHead(span)).toBeNull();
    });

    it("Plumecreed Mentor's gap stays its head", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Plumecreed Mentor",
                manaCost: "{1}{W}{U}",
                typeLine: "Creature — Bird Scout",
                oracleText:
                    "Flying\nWhenever this creature or another creature you control with flying enters, put a +1/+1 counter on target creature you control without flying.",
                power: "2",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("unparsed");
        const paths =
            outcome.state === "unparsed"
                ? outcome.gaps.map((g) => g.attribution?.path ?? [])
                : [];
        expect(paths.some((p) => p.includes("trigger head"))).toBe(true);
    });
});

describe("self-or-another trigger heads — the printed source (CR 201.5)", () => {
    it("refuses a card whose printed subtypes lack the type the head names", () => {
        const outcome = compileCard({
            ...KAZANDU_BLADEMASTER,
            typeLine: "Creature — Human Soldier",
        });
        expect(outcome.state).toBe("unparsed");
        expect(JSON.stringify(outcome)).toContain(
            'a \\"this creature or another Ally\\" head on a card that is no Ally'
        );
    });

    it("refuses a card that is no creature", () => {
        const outcome = compileCard({
            ...BOGWATER_LUMARET,
            typeLine: "Artifact",
            power: undefined,
            toughness: undefined,
        });
        expect(outcome.state).toBe("unparsed");
        expect(JSON.stringify(outcome)).toContain(
            "on a card that is no creature"
        );
    });
});

const SELF = { id: "src", controllerId: "p1" } as PermanentView;

function left(
    instanceId: string,
    over: Partial<PermanentLeftEvent> = {}
): GameEvent {
    return {
        type: "PERMANENT_LEFT",
        instanceId,
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        wasAura: false,
        toZone: "exile",
        ...over,
    };
}

describe("self-or-another trigger heads — the rebuilt leaves-without-dying ability (CR 603.6c, CR 700.4)", () => {
    const ability = resolveCompiledTrigger({
        id: "left-without-dying-probe",
        oracleText: THREE_TREE_SCRIBE.oracleText,
        head: {
            kind: "left",
            scope: "yours",
            filter: { types: ["Creature"] },
            toZone: ["exile", "hand", "library"],
        },
        effects: [{ op: "draw", player: "controller", count: 1 }],
    });

    it("fires on the source's own exit and another creature of yours", () => {
        expect(ability.matches!(left("src", { toZone: "hand" }), SELF)).toBe(
            true
        );
        expect(ability.matches!(left("other"), SELF)).toBe(true);
        expect(
            ability.matches!(left("other", { toZone: "library" }), SELF)
        ).toBe(true);
    });

    it("never on a death, an opponent's creature or a noncreature", () => {
        expect(
            ability.matches!(left("other", { toZone: "graveyard" }), SELF)
        ).toBe(false);
        expect(
            ability.matches!(left("src", { toZone: "graveyard" }), SELF)
        ).toBe(false);
        expect(
            ability.matches!(left("other", { controllerId: "p2" }), SELF)
        ).toBe(false);
        expect(
            ability.matches!(left("other", { types: ["Artifact"] }), SELF)
        ).toBe(false);
    });
});

describe("enters-and-sacrificed trigger head — the rebuilt ability (CR 603.6a, CR 701.21a)", () => {
    const ability = resolveCompiledTrigger({
        id: "enters-or-sacrificed-probe",
        oracleText:
            "When this artifact enters and when you sacrifice it, draw a card.",
        head: { kind: "enters-or-sacrificed" },
        effects: [{ op: "draw", player: "controller", count: 1 }],
    });
    const entered = (instanceId: string): GameEvent => ({
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId: "p1",
        cardId: "x",
        types: ["Artifact"],
    });

    it("is ONE ability over both events, not an ETB-only one", () => {
        expect(ability.event).toEqual(["PERMANENT_ENTERED", "PERMANENT_LEFT"]);
        expect(ability.etbAbility).toBe(false);
    });

    it("fires on the source's own entry and its own sacrifice", () => {
        expect(ability.matches!(entered("src"), SELF)).toBe(true);
        expect(
            ability.matches!(
                left("src", { toZone: "graveyard", cause: "sacrifice" }),
                SELF
            )
        ).toBe(true);
    });

    it("never on a destroy, a bounce, or another permanent", () => {
        expect(
            ability.matches!(
                left("src", { toZone: "graveyard", cause: "destroy" }),
                SELF
            )
        ).toBe(false);
        expect(ability.matches!(left("src", { toZone: "hand" }), SELF)).toBe(
            false
        );
        expect(ability.matches!(entered("other"), SELF)).toBe(false);
        expect(
            ability.matches!(
                left("other", { toZone: "graveyard", cause: "sacrifice" }),
                SELF
            )
        ).toBe(false);
    });
});
