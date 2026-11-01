// Trigger heads over casting, a main phase and zone changes: "whenever you
// cast a noncreature spell", "when you cast this spell", "at the beginning of
// your first main phase", "when this artifact enters or leaves the
// battlefield", "when {self} enter" (a plural name), "whenever a creature you
// control with power N or greater enters", "whenever you sacrifice a land",
// "whenever an opponent searches their library" (CR 603.2, 603.6a, 603.6c,
// 113.6k, 505.1, 701.21a, 701.23a).
//
//  1. GOLDENS — a real corpus card compiled whole and compared with `sortKeys`
//     equality, for the four forms whose corpus bodies already compile.
//  2. HEADS — the other four forms have no corpus card whose body compiles
//     yet (each body is its own Grammar Gap), so the head is pinned at the
//     table and, end to end, behind a body that does.
//  3. REFUSALS — the printed neighbours the rows must NOT read.
//  4. ENGINE — the rebuilt ability fires on the events the words name and on
//     no neighbour, through `resolveCompiledTrigger` and the real trigger scan.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CardDefinition,
    GameEvent,
    PermanentView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { collectTriggers } from "../../gre/triggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { OTHER_HEADS } from "../grammar/shared/triggerHead";
import { oracleCard } from "./oracle.fixture";

const NONCARD = { power: undefined, toughness: undefined } as const;

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

const probe = (oracleText: string) =>
    compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText,
            ...NONCARD,
        })
    );

const refused = (oracleText: string) => probe(oracleText).state === "unparsed";

/** The one compiled trigger of a probe card whose body compiles. */
function probeTrigger(oracleText: string) {
    const outcome = probe(oracleText);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    const [ability] = outcome.definition.compiledTriggeredAbilities ?? [];
    return ability!;
}

const BOAR_Q_PINE = oracleCard({
    name: "Boar-q-pine",
    manaCost: "{2}{R}",
    typeLine: "Creature — Boar Porcupine",
    oracleText:
        "Whenever you cast a noncreature spell, put a +1/+1 counter on this creature.",
    power: "2",
    toughness: "2",
});

const CRYOGEN_RELIC = oracleCard({
    name: "Cryogen Relic",
    manaCost: "{1}{U}",
    typeLine: "Artifact",
    oracleText:
        "When this artifact enters or leaves the battlefield, draw a card.\n{1}{U}, Sacrifice this artifact: Put a stun counter on up to one target tapped creature. (If a permanent with a stun counter would become untapped, remove one from it instead.)",
    ...NONCARD,
});

const GERT_AND_OLD_LACE = oracleCard({
    name: "Gert and Old Lace, Runaways",
    manaCost: "{2}{R/G}",
    typeLine: "Legendary Creature — Human Dinosaur Hero",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player they're attacking.)\nWhen Gert and Old Lace enter, you may discard a card. If you do, search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
    power: "4",
    toughness: "3",
});

const ELEMENTAL_BOND = oracleCard({
    name: "Elemental Bond",
    manaCost: "{2}{G}",
    typeLine: "Enchantment",
    oracleText:
        "Whenever a creature you control with power 3 or greater enters, draw a card.",
    ...NONCARD,
});

describe("cast / phase / zone-change trigger heads — goldens", () => {
    it("Boar-q-pine: 'you cast a noncreature spell' — excludeTypes [Creature] (CR 603.2, 205.2a)", () => {
        expect(sortKeys(compiled(BOAR_Q_PINE))).toEqual(
            sortKeys({
                name: "Boar-q-pine",
                types: ["Creature"],
                subtypes: ["Boar", "Porcupine"],
                manaCost: { X: 2, R: 1 },
                power: 2,
                toughness: 2,
                oracleText: BOAR_Q_PINE.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "boar-q-pine-trigger",
                        oracleText: BOAR_Q_PINE.oracleText,
                        head: {
                            kind: "spell-cast",
                            scope: "you",
                            filter: { excludeTypes: ["Creature"] },
                        },
                        effects: [
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
            })
        );
    });

    it("Cryogen Relic: 'enters or leaves the battlefield' — one enters-or-leaves head (CR 603.2, 603.6a, 603.6c)", () => {
        const trigger =
            "When this artifact enters or leaves the battlefield, draw a card.";
        expect(sortKeys(compiled(CRYOGEN_RELIC))).toEqual(
            sortKeys({
                name: "Cryogen Relic",
                types: ["Artifact"],
                manaCost: { X: 1, U: 1 },
                oracleText: CRYOGEN_RELIC.oracleText,
                activatedAbilities: [
                    {
                        id: "cryogen-relic-ability",
                        oracleText:
                            "{1}{U}, Sacrifice this artifact: Put a stun counter on up to one target tapped creature.",
                        cost: { mana: { X: 1, U: 1 }, sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "counters",
                                action: "add",
                                counter: "stun",
                                target: { target: 0 },
                                count: 1,
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: { min: 0, max: 1 },
                            tappedFilter: "tapped",
                        },
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "cryogen-relic-trigger",
                        oracleText: trigger,
                        head: { kind: "enters-or-leaves" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            })
        );
    });

    it("Gert and Old Lace: 'when {self} enter' — the self enters head behind a plural name (CR 201.5, 603.6a)", () => {
        const trigger =
            "When {self} enter, you may discard a card. If you do, search your library for a basic land card, reveal it, put it into your hand, then shuffle.";
        expect(sortKeys(compiled(GERT_AND_OLD_LACE))).toEqual(
            sortKeys({
                name: "Gert and Old Lace, Runaways",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Dinosaur", "Hero"],
                manaCost: { X: 2, hybrid: [["R", "G"]] },
                power: 4,
                toughness: 3,
                oracleText: GERT_AND_OLD_LACE.oracleText,
                staticAbilities: ["trample"],
                compiledTriggeredAbilities: [
                    {
                        id: "gert-and-old-lace-runaways-trigger",
                        oracleText: trigger,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: {
                                    hand: {
                                        action: "discard",
                                        requirements: [
                                            { filter: {}, count: 1 },
                                        ],
                                    },
                                },
                                prompt: "Discard a card?",
                                bind: "$paid2",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$paid2" },
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
                                        op: "reveal",
                                        player: "controller",
                                        cards: { ref: "$found1" },
                                    },
                                    {
                                        op: "moveZone",
                                        cards: { ref: "$found1" },
                                        player: "controller",
                                        from: "library",
                                        to: "hand",
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

    it("Elemental Bond: 'a creature you control with power 3 or greater enters' — powerAtLeast 3 (CR 603.6a, 208.1)", () => {
        expect(sortKeys(compiled(ELEMENTAL_BOND))).toEqual(
            sortKeys({
                name: "Elemental Bond",
                types: ["Enchantment"],
                manaCost: { X: 2, G: 1 },
                oracleText: ELEMENTAL_BOND.oracleText,
                compiledTriggeredAbilities: [
                    {
                        id: "elemental-bond-trigger",
                        oracleText: ELEMENTAL_BOND.oracleText,
                        head: {
                            kind: "entered",
                            scope: "yours",
                            filter: {
                                types: ["Creature"],
                                powerAtLeast: 3,
                            },
                        },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            })
        );
    });
});

describe("cast / phase / zone-change trigger heads — heads behind a compiling body", () => {
    it("'when you cast this spell' — a spell-cast head scoped to the source itself (CR 603.2, 113.6k)", () => {
        expect(OTHER_HEADS.get("when you cast this spell")).toEqual({
            kind: "spell-cast",
            scope: "self",
        });
        expect(
            probeTrigger("When you cast this spell, draw a card.").head
        ).toEqual({ kind: "spell-cast", scope: "self" });
    });

    it("'at the beginning of your first main phase' — the precombat main phase (CR 505.1, 505.1a)", () => {
        expect(
            OTHER_HEADS.get("at the beginning of your first main phase")
        ).toEqual({ kind: "phase", phase: "PRECOMBAT_MAIN", scope: "your" });
        expect(
            probeTrigger(
                "At the beginning of your first main phase, draw a card."
            ).head
        ).toEqual({ kind: "phase", phase: "PRECOMBAT_MAIN", scope: "your" });
    });

    it("'whenever you sacrifice a land' — a sacrificed head over lands (CR 701.21a)", () => {
        expect(OTHER_HEADS.get("whenever you sacrifice a land")).toEqual({
            kind: "sacrificed",
            scope: "yours",
            permanentType: "Land",
        });
        expect(
            probeTrigger("Whenever you sacrifice a land, draw a card.").head
        ).toEqual({
            kind: "sacrificed",
            scope: "yours",
            filter: { types: ["Land"] },
        });
    });

    it("'whenever an opponent searches their library' — names the searcher as 'that player' (CR 701.23a)", () => {
        expect(
            OTHER_HEADS.get("whenever an opponent searches their library")
        ).toEqual({ kind: "library-searched", scope: "opponents" });
        const ability = probeTrigger(
            "Whenever an opponent searches their library, that player loses 1 life."
        );
        expect(ability.head).toEqual({
            kind: "library-searched",
            scope: "opponents",
        });
        expect(JSON.stringify(ability.effects)).toContain(
            '{"ref":"$event.playerId"}'
        );
    });

    it("'you cast this spell' names no caster: 'that player' stays unread behind it (CR 603.2)", () => {
        expect(
            refused("When you cast this spell, that player loses 1 life.")
        ).toBe(true);
    });
});

describe("cast / phase / zone-change trigger heads — refused neighbours", () => {
    it.each([
        // A caster the noncreature row does not spell.
        "Whenever an opponent casts a noncreature spell, draw a card.",
        // A cast-zone narrowing the self row does not read.
        "When you cast this spell from your graveyard, draw a card.",
        // The other main phase.
        "At the beginning of your second main phase, draw a card.",
        // A second leg the enters-or-leaves row does not read.
        "When this artifact enters or dies, draw a card.",
        // The plural verb is the NAME's; "this artifact enter" is no head.
        "When this artifact enter, draw a card.",
        // A sacrificed permanent the row does not name.
        "Whenever you sacrifice another permanent, draw a card.",
        "Whenever you sacrifice a creature, draw a card.",
    ])("%s", (text) => {
        expect(refused(text)).toBe(true);
    });
});

// ── Engine half ────────────────────────────────────────────────────────────

const self: PermanentView = {
    id: "src",
    controllerId: "p1",
    ownerId: "p1",
    types: ["Artifact"],
} as unknown as PermanentView;

function ability(oracleText: string) {
    return resolveCompiledTrigger(probeTrigger(oracleText));
}

const left = (
    overrides: Partial<Extract<GameEvent, { type: "PERMANENT_LEFT" }>>
): GameEvent => ({
    type: "PERMANENT_LEFT",
    instanceId: "other",
    controllerId: "p1",
    ownerId: "p1",
    types: ["Land"],
    wasAura: false,
    toZone: "graveyard",
    ...overrides,
});

describe("cast / phase / zone-change trigger heads — the rebuilt ability fires on what the words name", () => {
    it("enters-or-leaves: ONE ability over the source's own entry and departure, never another's (CR 603.2, 603.6a, 603.6c)", () => {
        const built = ability(
            "When this artifact enters or leaves the battlefield, draw a card."
        );
        expect(built.event).toEqual(["PERMANENT_ENTERED", "PERMANENT_LEFT"]);
        const entered = (instanceId: string): GameEvent => ({
            type: "PERMANENT_ENTERED",
            instanceId,
            controllerId: "p1",
            types: ["Artifact"],
        });
        expect(built.matches(entered("src"), self)).toBe(true);
        expect(
            built.matches(left({ instanceId: "src", toZone: "exile" }), self)
        ).toBe(true);
        expect(built.matches(entered("other"), self)).toBe(false);
        expect(built.matches(left({ instanceId: "other" }), self)).toBe(false);
    });

    it("sacrificed: a land of yours SACRIFICED — not destroyed, not a creature, not an opponent's (CR 701.21a)", () => {
        const built = ability("Whenever you sacrifice a land, draw a card.");
        expect(built.matches(left({ cause: "sacrifice" }), self)).toBe(true);
        expect(built.matches(left({ cause: "destroy" }), self)).toBe(false);
        expect(built.matches(left({}), self)).toBe(false);
        expect(
            built.matches(
                left({ cause: "sacrifice", types: ["Creature"] }),
                self
            )
        ).toBe(false);
        expect(
            built.matches(
                left({ cause: "sacrifice", controllerId: "p2", ownerId: "p2" }),
                self
            )
        ).toBe(false);
    });

    it("library-searched: an opponent searching their own library, never you (CR 701.23a)", () => {
        const built = ability(
            "Whenever an opponent searches their library, draw a card."
        );
        const searched = (playerId: string): GameEvent => ({
            type: "LIBRARY_SEARCHED",
            playerId,
            libraryOwnerId: playerId,
        });
        expect(built.matches(searched("p2"), self)).toBe(true);
        expect(built.matches(searched("p1"), self)).toBe(false);
    });

    it("spell-cast self: functions from the stack and fires on its own cast only (CR 113.6k)", () => {
        const built = ability("When you cast this spell, draw a card.");
        expect(built.functionsFromStack).toBe(true);
        const cast = (spellInstanceId: string): GameEvent => ({
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId,
            spellCardId: "probe",
            spellTypes: ["Artifact"],
            spellSubtypes: [],
            spellColors: [],
        });
        expect(built.matches(cast("src"), self)).toBe(true);
        expect(built.matches(cast("other"), self)).toBe(false);
    });

    it("enters-or-leaves: the departed source's leaves half is found by the trigger scan in the zone it reached (CR 603.10a)", () => {
        const definition = {
            ...compiled(CRYOGEN_RELIC),
            id: "test-7216-cryogen-relic",
            rarity: "common" as const,
        } as CardDefinition;
        registerTokenDefinition(definition);
        const relic = makeInstance(definition.id, {
            id: "relic",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [relic] }),
                makePlayer("p2"),
            ],
        });
        const items = collectTriggers(state, [
            left({
                instanceId: "relic",
                types: ["Artifact"],
                cause: "sacrifice",
            }),
        ]);
        expect(items).toHaveLength(1);
        expect(items[0]!.triggeredAbilityId).toBe("cryogen-relic-trigger");
    });
});
