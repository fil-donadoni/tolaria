// Edict with a SUPERLATIVE selector — "<player> sacrifices a <filter> with the
// greatest <stat> among <set they control>" (CR 701.21a, CR 608.2h,
// issue #4247). Builds on the plain edict rule (`playerEdict.test.ts`).
//
// Four layers:
//
//  1. GOLDENS — one per accepted form: power over "they control" (Consume's
//     first sentence), power over "that player controls" (Crackling Doom's
//     second), mana value over "creatures and planeswalkers they control"
//     (Soul Shatter, a whole corpus row).
//  2. REFUSALS — the neighbours the rule must NOT read: another extreme, an
//     unknown stat, a set the engine does not rank, a set that is not the
//     candidates' own pool, a counted pick, a filter clause on the pool.
//  3. THE FRONTIER — Consecrate // Consume's first sentence compiles and the
//     gap moves on to the acted-on-power clause (issue #4248), which is what
//     keeps the card out of `ready` here.
//  4. BEHAVIOUR — the compiled script through the real interpreter, with the
//     narrowed candidate list reaching the client through `projectPublicState`.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { applyPendingChoiceSubmit } from "../../gre/pendingChoiceSubmit";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const SOUL_SHATTER: OracleCard = {
    oracleId: "615927c2-3fb0-4e64-a1a7-55fb56de1423",
    name: "Soul Shatter",
    manaCost: "{2}{B}",
    typeLine: "Instant",
    oracleText:
        "Each opponent sacrifices a creature or planeswalker with the greatest mana value among creatures and planeswalkers they control.",
    layout: "normal",
};

/** A spell whose Oracle text is exactly `oracleText` — for a sentence the
 *  corpus prints inside a larger card (its neighbours are other Grammar Gaps). */
function sorcery(oracleText: string, name = "Superlative Probe") {
    return oracleCard({
        name,
        manaCost: "{2}{B}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

const CONSUME_SENTENCE =
    "Target player sacrifices a creature with the greatest power among creatures they control.";
const CRACKLING_DOOM_SENTENCE =
    "Each opponent sacrifices a creature with the greatest power among creatures that player controls.";

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function refusedSpan(card: OracleCard): string | undefined {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps[0]?.attribution?.span
        : undefined;
}

function edict(
    player: unknown,
    filter: unknown,
    superlative: unknown,
    prompt: string
) {
    return [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player,
            zone: "battlefield",
            filter,
            superlative,
            count: 1,
            prompt,
            bind: "$sacrifice1",
        },
        { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
    ];
}

describe("superlative edict — goldens (CR 701.21a, CR 608.2h)", () => {
    it('power over "they control": Consume\'s first sentence — the chooser is the target', () => {
        expect(
            sortKeys(compiled(sorcery(CONSUME_SENTENCE, "Consume")))
        ).toEqual(
            sortKeys({
                name: "Consume",
                types: ["Sorcery"],
                manaCost: { X: 2, B: 1 },
                oracleText: CONSUME_SENTENCE,
                effects: edict(
                    { target: 0 },
                    { type: "Creature" },
                    { stat: "power", extreme: "greatest" },
                    "Sacrifice a creature with the greatest power among creatures they control."
                ),
                targetRequirement: { type: "player", count: 1 },
            })
        );
    });

    it('power over "that player controls": Crackling Doom\'s second sentence — each opponent', () => {
        expect(
            sortKeys(
                compiled(sorcery(CRACKLING_DOOM_SENTENCE, "Crackling Doom"))
            )
        ).toEqual(
            sortKeys({
                name: "Crackling Doom",
                types: ["Sorcery"],
                manaCost: { X: 2, B: 1 },
                oracleText: CRACKLING_DOOM_SENTENCE,
                effects: edict(
                    "opponent",
                    { type: "Creature" },
                    { stat: "power", extreme: "greatest" },
                    "Sacrifice a creature with the greatest power among creatures that player controls."
                ),
            })
        );
    });

    it("mana value over creatures and planeswalkers: Soul Shatter, a whole corpus row", () => {
        expect(sortKeys(compiled(SOUL_SHATTER))).toEqual(
            sortKeys({
                name: "Soul Shatter",
                types: ["Instant"],
                manaCost: { X: 2, B: 1 },
                oracleText: SOUL_SHATTER.oracleText,
                effects: edict(
                    "opponent",
                    { type: ["Creature", "Planeswalker"] },
                    { stat: "mana-value", extreme: "greatest" },
                    "Sacrifice a creature or planeswalker with the greatest mana value among creatures and planeswalkers they control."
                ),
            })
        );
    });

    it("each player: every player ranks their OWN pool, inside the simultaneous forEach", () => {
        const definition = compiled(
            sorcery(
                "Each player sacrifices a creature with the greatest power among creatures they control."
            )
        );
        expect(sortKeys(definition.effects)).toEqual(
            sortKeys([
                {
                    op: "forEach",
                    select: { set: "players" },
                    simultaneous: true,
                    effects: edict(
                        { ref: "$each" },
                        { type: "Creature" },
                        { stat: "power", extreme: "greatest" },
                        "Sacrifice a creature with the greatest power among creatures they control."
                    ),
                },
            ])
        );
    });

    it("every golden reaches `ready`", () => {
        for (const card of [
            sorcery(CONSUME_SENTENCE, "Consume"),
            sorcery(CRACKLING_DOOM_SENTENCE, "Crackling Doom"),
            SOUL_SHATTER,
        ])
            expect(compileCard(card).state, card.name).toBe("ready");
    });
});

describe("superlative edict — the frontier (issue #4248)", () => {
    it("Consecrate // Consume: the first sentence compiles and the gap moves to the acted-on-power clause", () => {
        const card = sorcery(
            `${CONSUME_SENTENCE} You gain life equal to its power.`,
            "Consume"
        );
        expect(compileCard(card).state).toBe("unparsed");
        expect(refusedSpan(card)).toBe("You gain life equal to its power");
    });
});

describe("superlative edict — refusals (fail-closed, ADR 0105 § 2)", () => {
    // [line, the span the refusal is attributed to]. The span says WHICH check
    // refused — the sentence read as "no slot consumed the line" before the rule.
    it.each([
        // Out of scope: "least"/"lowest" print on no sole-gap card.
        [
            "Target opponent sacrifices a creature with the least power among creatures they control.",
            "least",
        ],
        // A stat the grammar does not rank by.
        [
            "Target opponent sacrifices a creature with the greatest toughness among creatures they control.",
            "toughness",
        ],
        // Another player's pool, or the whole battlefield — not the engine's.
        [
            "Target opponent sacrifices a creature with the greatest power among creatures you control.",
            "creatures you control",
        ],
        [
            "Target opponent sacrifices a creature with the greatest power among creatures on the battlefield.",
            "creatures on the battlefield",
        ],
        // A pool that is NOT the candidates' own: ranking creatures and
        // planeswalkers, offering only creatures, would rank the wrong set.
        [
            "Target opponent sacrifices a creature with the greatest mana value among creatures and planeswalkers they control.",
            "creatures and planeswalkers they control",
        ],
        // A combat-role clause narrows the candidates but not the printed pool.
        [
            "Target opponent sacrifices an attacking creature with the greatest power among attacking creatures they control.",
            "attacking creatures",
        ],
        // …and the converse: the candidates are narrowed to attackers but the
        // printed pool is every creature, which the engine would not rank.
        [
            "Target opponent sacrifices an attacking creature with the greatest power among creatures they control.",
            "creatures they control",
        ],
        // Power is a creature's characteristic; a pool that holds a planeswalker
        // has permanents with no power to rank (CR 208.1).
        [
            "Target opponent sacrifices a creature or planeswalker with the greatest power among creatures and planeswalkers they control.",
            "power",
        ],
        // "two creatures with the greatest power" ranks each pick, not the pool once.
        [
            "Target opponent sacrifices two creatures with the greatest power among creatures they control.",
            "two",
        ],
        // Not a type noun at all.
        [
            "Target opponent sacrifices a creature with the greatest power among cards they control.",
            "cards",
        ],
    ])("%s", (line, span) => {
        const card = sorcery(line);
        expect(compileCard(card).state).toBe("unparsed");
        expect(refusedSpan(card)).toBe(span);
    });

    it("the plain edict is unchanged — no superlative field is invented", () => {
        const plain = compiled(
            sorcery("Target player sacrifices a creature of their choice.")
        );
        expect(JSON.stringify(plain.effects)).not.toContain("superlative");
    });
});

describe("superlative edict — behaviour through the real interpreter", () => {
    const id = (name: string) => `t4247-${name}`;
    for (const [name, power, mv] of [
        ["small", 1, 1],
        ["big", 5, 1],
        ["big-twin", 5, 1],
        ["pricey", 1, 6],
    ] as const)
        registerTokenDefinition({
            id: id(name),
            name: id(name),
            rarity: "common",
            manaCost: { G: mv },
            types: ["Creature"],
            power,
            toughness: power,
        });
    registerTokenDefinition({
        id: id("walker"),
        name: id("walker"),
        rarity: "common",
        manaCost: { B: 6 },
        types: ["Planeswalker"],
        power: undefined,
        toughness: undefined,
    });
    const held = (owner: string, name: string, cardId: string) =>
        makeInstance(id(name), {
            id: cardId,
            controllerId: owner,
            ownerId: owner,
        });

    function withCompiled<T>(card: OracleCard, fn: (defId: string) => T): T {
        const defId = `t4247-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id: defId,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(defId));
    }
    const submit = (
        state: ReturnType<typeof makeState>,
        playerId: string,
        ids: string[]
    ) => {
        const head = state.pendingChoices![0]!;
        applyPendingChoiceSubmit(state, {
            playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ids,
        });
    };

    it("Consume's sentence: the target is offered only its own tied-greatest creatures, and the client sees exactly that list", () => {
        withCompiled(sorcery(CONSUME_SENTENCE, "Consume"), (defId) => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [held("p1", "big", "mine")],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            held("p2", "small", "small"),
                            held("p2", "big", "big-a"),
                            held("p2", "big-twin", "big-b"),
                        ],
                    }),
                ],
            });
            pushSpell(state, defId, "p1", [{ type: "player", id: "p2" }]);
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0]!;
            expect(head.playerId).toBe("p2");
            expect([...head.candidateIds!].sort()).toEqual(["big-a", "big-b"]);
            const wire = projectPublicState(state, 1, "p2").pendingChoices![0]!;
            expect([...wire.candidateIds!].sort()).toEqual(["big-a", "big-b"]);
            expect(() => submit(state, "p2", ["small"])).toThrow();
            submit(state, "p2", ["big-b"]);
            expect(
                getPlayer(state, "p2")
                    .battlefield.map((c) => c.id)
                    .sort()
            ).toEqual(["big-a", "small"]);
            expect(getPlayer(state, "p1").battlefield.map((c) => c.id)).toEqual(
                ["mine"]
            );
        });
    });

    it("Soul Shatter: a planeswalker with the greatest mana value is a legal victim beside the creatures", () => {
        withCompiled(SOUL_SHATTER, (defId) => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [
                            held("p2", "big", "big"),
                            held("p2", "pricey", "pricey"),
                            held("p2", "walker", "walker"),
                        ],
                    }),
                ],
            });
            pushSpell(state, defId, "p1");
            resolveTopOfStack(state);
            const head = state.pendingChoices![0]!;
            expect(head.playerId).toBe("p2");
            expect([...head.candidateIds!].sort()).toEqual([
                "pricey",
                "walker",
            ]);
            submit(state, "p2", ["walker"]);
            expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
                "walker",
            ]);
        });
    });

    it("each player: each chooser is offered the extreme of THEIR pool, in APNAP order", () => {
        withCompiled(
            sorcery(
                "Each player sacrifices a creature with the greatest power among creatures they control.",
                "Mutual Culling"
            ),
            (defId) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                held("p1", "small", "a-small"),
                                held("p1", "big", "a-big"),
                            ],
                        }),
                        makePlayer("p2", {
                            battlefield: [held("p2", "small", "b-small")],
                        }),
                    ],
                });
                pushSpell(state, defId, "p2");
                resolveTopOfStack(state);
                expect(state.pendingChoices![0]!.playerId).toBe("p1");
                expect(state.pendingChoices![0]!.candidateIds).toEqual([
                    "a-big",
                ]);
                submit(state, "p1", ["a-big"]);
                expect(state.pendingChoices![0]!.playerId).toBe("p2");
                expect(state.pendingChoices![0]!.candidateIds).toEqual([
                    "b-small",
                ]);
                submit(state, "p2", ["b-small"]);
                expect(
                    getPlayer(state, "p1").battlefield.map((c) => c.id)
                ).toEqual(["a-small"]);
                expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
            }
        );
    });
});
