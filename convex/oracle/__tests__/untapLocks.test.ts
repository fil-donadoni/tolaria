// Untap-step locks and the set-wide enters-tapped replacement — the static
// clause frames "Islands don't untap during their controllers' untap steps",
// "As long as this artifact is untapped, players can't untap more than one land
// during their untap steps", "Each land with an activated ability that isn't a
// mana ability doesn't untap …", "Players skip their untap steps" (CR 502.3,
// 614.10) and "Artifacts and lands enter tapped" (CR 614.1d), issue #4561.
//
// Four layers, each watching a different way the frames can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition (Choke, Winter Orb, Tsabo's Web, Root Maze).
//     Stasis prints a second, upkeep-cost line that is a different gap, so its
//     sentence is pinned at the clause and lowering level instead.
//  2. REFUSALS — the neighbours of each sentence stay unparsed.
//  3. LOWERING invariants — JSON-pure descriptors, one per printed line.
//  4. BEHAVIOUR — each compiled definition, registered as-is, does what the
//     sentence says at the real `untapStep` / `applyPlayLand` seam, and a
//     control run without the lock does not — so the assertion can tell the
//     two apart.

import { describe, expect, it } from "vitest";
import { getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyPlayLand } from "../../gre/playLand";
import { untapStep } from "../../gre/phases";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { lowerStaticClause } from "../lowerStatic";
import { oracleCard, parseContext } from "./oracle.fixture";

const CHOKE = oracleCard({
    oracleId: "057fa60b-10b0-4612-be0d-157076c82241",
    name: "Choke",
    manaCost: "{2}{G}",
    typeLine: "Enchantment",
    oracleText: "Islands don't untap during their controllers' untap steps.",
    power: undefined,
    toughness: undefined,
});

const WINTER_ORB = oracleCard({
    oracleId: "1dcbd583-3388-4b34-a7cd-131648aa6abd",
    name: "Winter Orb",
    manaCost: "{2}",
    typeLine: "Artifact",
    oracleText:
        "As long as this artifact is untapped, players can't untap more than one land during their untap steps.",
    power: undefined,
    toughness: undefined,
});

const TSABOS_WEB = oracleCard({
    oracleId: "96a4e515-2b4e-4c2d-aa1a-963597484723",
    name: "Tsabo's Web",
    manaCost: "{2}",
    typeLine: "Artifact",
    oracleText:
        "When this artifact enters, draw a card.\nEach land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
    power: undefined,
    toughness: undefined,
});

const ROOT_MAZE = oracleCard({
    oracleId: "2f4abc5e-5aad-455e-b1ec-137d7ac4a10c",
    name: "Root Maze",
    manaCost: "{G}",
    typeLine: "Enchantment",
    oracleText: "Artifacts and lands enter tapped.",
    power: undefined,
    toughness: undefined,
});

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

/** The clause alone, through the static slot. */
function clause(line: string) {
    const parsed = staticSlot.run(line, parseContext());
    expect(parsed.ok, `expected "${line}" to parse`).toBe(true);
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error("not a static clause");
    return parsed.value.clause;
}

describe("untap locks — golden fixtures (CR 502.3)", () => {
    it("Choke: a lock over Islands, every controller's untap step", () => {
        expect(sortKeys(compiled(CHOKE))).toEqual(
            sortKeys({
                name: "Choke",
                types: ["Enchantment"],
                manaCost: { X: 2, G: 1 },
                oracleText:
                    "Islands don't untap during their controllers' untap steps.",
                compiledStaticEffects: [
                    {
                        kind: "untap-restriction",
                        id: "choke-untap-lock",
                        oracleText:
                            "Islands don't untap during their controllers' untap steps.",
                        filter: { types: "Land", subtypes: "Island" },
                        maxUntap: 0,
                    },
                ],
            })
        );
    });

    it("Winter Orb: a one-land cap that exists only while the Orb is untapped", () => {
        expect(sortKeys(compiled(WINTER_ORB))).toEqual(
            sortKeys({
                name: "Winter Orb",
                types: ["Artifact"],
                manaCost: { X: 2 },
                oracleText:
                    "As long as this artifact is untapped, players can't untap more than one land during their untap steps.",
                compiledStaticEffects: [
                    {
                        kind: "untap-restriction",
                        id: "winter-orb-untap-lock",
                        oracleText:
                            "As long as this artifact is untapped, players can't untap more than one land during their untap steps.",
                        filter: { types: "Land" },
                        maxUntap: 1,
                        whileSourceUntapped: true,
                    },
                ],
            })
        );
    });

    it("Tsabo's Web: the lock beside an enters-the-battlefield draw", () => {
        expect(sortKeys(compiled(TSABOS_WEB))).toEqual(
            sortKeys({
                name: "Tsabo's Web",
                types: ["Artifact"],
                manaCost: { X: 2 },
                oracleText:
                    "When this artifact enters, draw a card.\nEach land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
                compiledTriggeredAbilities: [
                    {
                        id: "tsabo-s-web-trigger",
                        oracleText: "When this artifact enters, draw a card.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
                compiledStaticEffects: [
                    {
                        kind: "untap-restriction",
                        id: "tsabo-s-web-untap-lock",
                        oracleText:
                            "Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
                        filter: { types: "Land" },
                        maxUntap: 0,
                        nonManaActivatedAbility: true,
                    },
                ],
            })
        );
    });

    it("Stasis: the sentence reads to the skip clause and lowers to a lock over every permanent type", () => {
        const sentence = "Players skip their untap steps.";
        expect(clause(sentence)).toEqual({ kind: "skip-untap-steps" });
        const routed = routeLine(sentence, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
        expect(
            lowerStaticClause(
                { kind: "skip-untap-steps" },
                sentence,
                (suffix) => `stasis-${suffix}`
            )
        ).toEqual({
            ok: true,
            lowered: {
                effects: [
                    {
                        kind: "untap-restriction",
                        id: "stasis-untap-lock",
                        oracleText: sentence,
                        filter: {
                            types: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                        },
                        maxUntap: 0,
                    },
                ],
            },
        });
    });
});

describe("enters-tapped lock — golden fixture (CR 614.1d)", () => {
    it("Root Maze: artifacts and lands enter tapped, whoever controls them", () => {
        expect(sortKeys(compiled(ROOT_MAZE))).toEqual(
            sortKeys({
                name: "Root Maze",
                types: ["Enchantment"],
                manaCost: { G: 1 },
                oracleText: "Artifacts and lands enter tapped.",
                compiledStaticEffects: [
                    {
                        kind: "enters-tapped-restriction",
                        id: "root-maze-enters-tapped-lock",
                        oracleText: "Artifacts and lands enter tapped.",
                        filter: { types: ["Artifact", "Land"] },
                    },
                ],
            })
        );
    });
});

describe("untap locks and enters-tapped lock — refusals (fail-closed neighbours)", () => {
    const refused = [
        // Whose permanents: the engine binds the active player's own, so a
        // controller clause is a different sentence.
        "Islands you control don't untap during your untap step.",
        "Islands your opponents control don't untap during their controllers' untap steps.",
        // The source's own marker is the `does-not-untap` frame, not a set.
        "Creatures don't untap during your untap step.",
        // A qualified subject the lock does not read.
        "Tapped Islands don't untap during their controllers' untap steps.",
        "Nonbasic lands don't untap during their controllers' untap steps.",
        "Blue lands don't untap during their controllers' untap steps.",
        // The cap is on LANDS, one of them, gated on THIS permanent.
        "As long as this artifact is untapped, players can't untap more than one creature during their untap steps.",
        "As long as this artifact is untapped, players can't untap more than two lands during their untap steps.",
        "As long as this artifact is tapped, players can't untap more than one land during their untap steps.",
        "As long as you control a Forest, players can't untap more than one land during their untap steps.",
        "Players can't untap more than one land during their untap steps.",
        // The non-mana-ability lock is read whole.
        "Each land with an activated ability doesn't untap during its controller's untap step.",
        "Each creature with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
        // Skip: the plural, unconditional, untap-step sentence only.
        "Skip your untap step.",
        "Players skip their draw steps.",
        "Each player skips their untap step.",
        "Players skip their next untap steps.",
        // Enters tapped: no controller clause (Kismet), no unlisted noun list.
        "Artifacts, creatures, and lands your opponents control enter tapped.",
        "Creatures your opponents control enter tapped.",
        "Artifacts and lands you control enter tapped.",
        "Artifacts and nonland permanents enter tapped.",
        "Artifacts and Goblins enter tapped.",
        "Artifacts and lands enter the battlefield tapped.",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }

    it("does not read the self rider 'enters tapped' as the plural frame", () => {
        expect(clause("This land enters tapped.")).toEqual({
            kind: "enters-tapped",
        });
    });
});

describe("untap locks — lowering invariants", () => {
    it("each descriptor is JSON-pure and carries no closure", () => {
        for (const card of [CHOKE, WINTER_ORB, TSABOS_WEB, ROOT_MAZE]) {
            const definition = compiled(card);
            expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
            expect(definition.staticAbilities).toBeUndefined();
            expect(definition.entersTapped).toBeUndefined();
        }
    });

    it("a card that prints no such sentence carries no lock", () => {
        const definition = compiled(
            oracleCard({
                typeLine: "Enchantment",
                power: undefined,
                toughness: undefined,
                oracleText: "Creatures you control get +1/+1.",
            })
        );
        expect(
            (definition.compiledStaticEffects ?? []).map((e) => e.kind)
        ).toEqual(["pt-buff"]);
    });

    it("the flags appear only on the sentence that asks for them", () => {
        const [choke] = compiled(CHOKE).compiledStaticEffects ?? [];
        expect(choke).not.toHaveProperty("whileSourceUntapped");
        expect(choke).not.toHaveProperty("nonManaActivatedAbility");
    });
});

describe("untap locks — the compiled definitions at the real untap step (CR 502.3)", () => {
    function withCompiled<T>(
        card: ReturnType<typeof oracleCard>,
        id: string,
        fn: () => T
    ): T {
        const definition: CardDefinition = {
            ...compiled(card),
            id,
            rarity: "rare",
        };
        return withTemporaryDefinition(definition, fn);
    }

    const island = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5");
    const plains = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed");
    const factory = getDefinition("a696c5b6-f216-454d-8029-74e84bbd1428");
    const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

    function board(
        sourceId: string | null,
        permanents: ReturnType<typeof makeInstance>[],
        sourceTapped = false
    ) {
        const source =
            sourceId === null
                ? []
                : [
                      makeInstance(sourceId, {
                          id: "source",
                          isTapped: sourceTapped,
                      }),
                  ];
        return makeState({
            phase: "UNTAP",
            players: [
                makePlayer("p1", { battlefield: [...source, ...permanents] }),
                makePlayer("p2"),
            ],
        });
    }

    const tappedIsland = () =>
        makeInstance(island.id, { id: "island", isTapped: true });
    const tappedPlains = () =>
        makeInstance(plains.id, { id: "plains", isTapped: true });
    const stateOf = (s: ReturnType<typeof board>, id: string) =>
        s.players[0].battlefield.find((c) => c.id === id)!;

    it("Choke: an Island stays tapped, a Plains untaps", () => {
        withCompiled(CHOKE, "compiled-choke", () => {
            const state = board("compiled-choke", [
                tappedIsland(),
                tappedPlains(),
            ]);
            untapStep(state);
            expect(stateOf(state, "island").isTapped).toBe(true);
            expect(stateOf(state, "plains").isTapped).toBe(false);
        });
    });

    it("Choke control: with no lock the Island untaps", () => {
        withCompiled(CHOKE, "compiled-choke", () => {
            const state = board(null, [tappedIsland()]);
            untapStep(state);
            expect(stateOf(state, "island").isTapped).toBe(false);
        });
    });

    it("Winter Orb: an untapped Orb asks which one land untaps", () => {
        withCompiled(WINTER_ORB, "compiled-winter-orb", () => {
            const state = board("compiled-winter-orb", [
                tappedIsland(),
                tappedPlains(),
            ]);
            untapStep(state);
            expect(state.pendingChoices).toHaveLength(1);
            expect(state.pendingChoices![0].kind).toBe("untap-pick");
            expect(state.pendingChoices![0].count).toEqual({ min: 0, max: 1 });
        });
    });

    it("Winter Orb: a TAPPED Orb locks nothing — both lands untap", () => {
        withCompiled(WINTER_ORB, "compiled-winter-orb", () => {
            const state = board(
                "compiled-winter-orb",
                [tappedIsland(), tappedPlains()],
                true
            );
            untapStep(state);
            expect(state.pendingChoices ?? []).toEqual([]);
            expect(stateOf(state, "island").isTapped).toBe(false);
            expect(stateOf(state, "plains").isTapped).toBe(false);
        });
    });

    it("Tsabo's Web: a land with a non-mana ability stays tapped, a Plains untaps", () => {
        withCompiled(TSABOS_WEB, "compiled-tsabos-web", () => {
            const state = board("compiled-tsabos-web", [
                makeInstance(factory.id, { id: "factory", isTapped: true }),
                tappedPlains(),
            ]);
            untapStep(state);
            expect(stateOf(state, "factory").isTapped).toBe(true);
            expect(stateOf(state, "plains").isTapped).toBe(false);
        });
    });

    it("Stasis lowering: no permanent untaps", () => {
        const lowered = lowerStaticClause(
            { kind: "skip-untap-steps" },
            "Players skip their untap steps.",
            (suffix) => `stasis-${suffix}`
        );
        if (!lowered.ok) throw new Error(lowered.reason);
        const definition: CardDefinition = {
            id: "compiled-stasis",
            rarity: "rare",
            name: "Stasis",
            types: ["Enchantment"],
            compiledStaticEffects: lowered.lowered.effects as never,
        };
        withTemporaryDefinition(definition, () => {
            const state = board("compiled-stasis", [
                tappedIsland(),
                makeInstance(bears.id, { id: "bear", isTapped: true }),
            ]);
            untapStep(state);
            expect(stateOf(state, "island").isTapped).toBe(true);
            expect(stateOf(state, "bear").isTapped).toBe(true);
        });
    });
});

describe("enters-tapped lock — the compiled definition at the real land play (CR 614.1d)", () => {
    const plains = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed");

    function playPlains(rootMazeOnBoard: boolean) {
        const definition: CardDefinition = {
            ...compiled(ROOT_MAZE),
            id: "compiled-root-maze",
            rarity: "common",
        };
        return withTemporaryDefinition(definition, () => {
            const land = makeInstance(plains.id, { id: "land", zone: "hand" });
            const p2Maze = makeInstance("compiled-root-maze", {
                id: "maze",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [land] }),
                    makePlayer("p2", {
                        battlefield: rootMazeOnBoard ? [p2Maze] : [],
                    }),
                ],
            });
            const player = state.players[0];
            applyPlayLand(state, player, "land");
            return player.battlefield.find((c) => c.id === "land")!.isTapped;
        });
    }

    it("a land enters tapped even when the OPPONENT controls the Maze", () => {
        expect(playPlains(true)).toBe(true);
    });

    it("control: without the Maze the same land enters untapped", () => {
        expect(playPlains(false)).toBeFalsy();
    });
});
