// Player EDICT — "<player> sacrifices a <permanent filter> [of their choice]"
// (CR 701.21a, CR 101.4, CR 608.2b, issue #4246).
//
// Four layers:
//
//  1. GOLDENS — a real corpus card compiled whole must produce exactly this
//     Compiled Definition, one per accepted form: each subject (target player,
//     target opponent, each opponent, each player) and each permanent filter
//     the corpus prints (creature, land, attacking creature, creature or
//     planeswalker, a counted "two creatures", the whole-permanent list).
//  2. REFUSALS — the neighbours this rule must NOT read: a rider on the
//     phrase, an X count, a second verb in the sentence, a selector the
//     descriptor has no field for, a subject with no antecedent.
//  3. LOWERING — the chooser is the NAMED player, never the caster.
//  4. BEHAVIOUR — the compiled scripts run through the real interpreter: the
//     prompt belongs to the sacrificing player, a player with nothing to give
//     up is neither prompted nor errored, and the projection the client reads
//     carries the same chooser.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { registerTokenDefinition } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import {
    assertExpectedInput,
    refreshExpectedInput,
} from "../../gre/expectedInput";
import { applyPendingChoiceSubmit } from "../../gre/pendingChoiceSubmit";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

/** A corpus row, verbatim (`data/oracle-corpus.json.gz`). */
function row(
    oracleId: string,
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
): OracleCard {
    return { oracleId, name, manaCost, typeLine, oracleText, layout: "normal" };
}

const DIABOLIC_EDICT = row(
    "058917c1-21ab-488a-9f9c-591c55f3c596",
    "Diabolic Edict",
    "{1}{B}",
    "Instant",
    "Target player sacrifices a creature of their choice."
);
const CRUEL_EDICT = row(
    "10c585c4-bf5b-4d8f-94a9-e9a5036a688f",
    "Cruel Edict",
    "{1}{B}",
    "Sorcery",
    "Target opponent sacrifices a creature of their choice."
);
const YAWNING_FISSURE = row(
    "634ec9d3-24c9-4090-a087-2624b6d5bf5b",
    "Yawning Fissure",
    "{4}{R}",
    "Sorcery",
    "Each opponent sacrifices a land of their choice."
);
const INNOCENT_BLOOD = row(
    "6791ec3c-c397-4087-8c8c-84d3797df415",
    "Innocent Blood",
    "{B}",
    "Sorcery",
    "Each player sacrifices a creature of their choice."
);
const BARTER_IN_BLOOD = row(
    "9167998d-5cac-47d7-99f2-f38122f7b8e7",
    "Barter in Blood",
    "{2}{B}{B}",
    "Sorcery",
    "Each player sacrifices two creatures of their choice."
);
const WING_SHARDS = row(
    "b302bce5-d7ad-46d8-9dbf-8159e8709b4f",
    "Wing Shards",
    "{1}{W}{W}",
    "Instant",
    "Target player sacrifices an attacking creature of their choice.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)"
);
const UMBRAL_JUKE = row(
    "d56afdf6-51e0-4151-a86c-4c4827a50a0e",
    "Umbral Juke",
    "{2}{B}",
    "Instant",
    "Choose one —\n• Target player sacrifices a creature or planeswalker of their choice.\n• Create a 2/1 white and black Inkling creature token with flying."
);
const MISGUIDED_RAGE = row(
    "f5c77355-96dc-46af-a7de-f547a1368ff1",
    "Misguided Rage",
    "{2}{R}",
    "Sorcery",
    "Target player sacrifices a permanent of their choice."
);

function sorcery(oracleText: string, name = "Edict Probe") {
    return oracleCard({
        name,
        manaCost: "{2}{B}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The refusal reason, or null when the card compiled. */
function refusal(card: OracleCard): string | null {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? (outcome.gaps[0]?.reason ?? "")
        : null;
}

/** The span the first gap is attributed to (the sub-grammar that refused). */
function refusedSpan(card: OracleCard): string | undefined {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps[0]?.attribution?.span
        : undefined;
}

/** The edict as the interpreter reads it: the pick, then the sacrifice. */
function edict(
    player: unknown,
    filter: unknown,
    count: number,
    prompt: string
) {
    return [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player,
            zone: "battlefield",
            filter,
            count,
            prompt,
            bind: "$sacrifice1",
        },
        { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
    ];
}

describe("player edict — goldens (CR 701.21a, CR 101.4)", () => {
    it("target player, creature: Diabolic Edict", () => {
        expect(sortKeys(compiled(DIABOLIC_EDICT))).toEqual(
            sortKeys({
                name: "Diabolic Edict",
                types: ["Instant"],
                manaCost: { X: 1, B: 1 },
                oracleText:
                    "Target player sacrifices a creature of their choice.",
                effects: edict(
                    { target: 0 },
                    { type: "Creature" },
                    1,
                    "Sacrifice a creature."
                ),
                targetRequirement: { type: "player", count: 1 },
            })
        );
    });

    it("target opponent, creature: Cruel Edict — the target narrows to an opponent", () => {
        expect(sortKeys(compiled(CRUEL_EDICT))).toEqual(
            sortKeys({
                name: "Cruel Edict",
                types: ["Sorcery"],
                manaCost: { X: 1, B: 1 },
                oracleText:
                    "Target opponent sacrifices a creature of their choice.",
                effects: edict(
                    { target: 0 },
                    { type: "Creature" },
                    1,
                    "Sacrifice a creature."
                ),
                targetRequirement: {
                    type: "player",
                    count: 1,
                    controller: "opponent",
                },
            })
        );
    });

    it("each opponent, land: Yawning Fissure — CR 102.2, the one other player", () => {
        expect(sortKeys(compiled(YAWNING_FISSURE))).toEqual(
            sortKeys({
                name: "Yawning Fissure",
                types: ["Sorcery"],
                manaCost: { X: 4, R: 1 },
                oracleText: "Each opponent sacrifices a land of their choice.",
                effects: edict(
                    "opponent",
                    { type: "Land" },
                    1,
                    "Sacrifice a land."
                ),
            })
        );
    });

    it("each player, creature: Innocent Blood — a simultaneous forEach over the players", () => {
        expect(sortKeys(compiled(INNOCENT_BLOOD))).toEqual(
            sortKeys({
                name: "Innocent Blood",
                types: ["Sorcery"],
                manaCost: { B: 1 },
                oracleText:
                    "Each player sacrifices a creature of their choice.",
                effects: [
                    {
                        op: "forEach",
                        select: { set: "players" },
                        simultaneous: true,
                        effects: edict(
                            { ref: "$each" },
                            { type: "Creature" },
                            1,
                            "Sacrifice a creature."
                        ),
                    },
                ],
            })
        );
    });

    it("attacking creature: Wing Shards — the filter reads combat status", () => {
        expect(sortKeys(compiled(WING_SHARDS))).toEqual(
            sortKeys({
                name: "Wing Shards",
                types: ["Instant"],
                manaCost: { X: 1, W: 2 },
                oracleText: WING_SHARDS.oracleText,
                staticAbilities: ["storm"],
                effects: edict(
                    { target: 0 },
                    { type: "Creature", isAttacking: true },
                    1,
                    "Sacrifice an attacking creature."
                ),
                targetRequirement: { type: "player", count: 1 },
            })
        );
    });

    it("creature or planeswalker: Umbral Juke's first mode — an or-list is a union", () => {
        const modes = compiled(UMBRAL_JUKE).modes ?? [];
        expect(sortKeys(modes[0]?.effects)).toEqual(
            sortKeys(
                edict(
                    { target: 0 },
                    { type: ["Creature", "Planeswalker"] },
                    1,
                    "Sacrifice a creature or planeswalker."
                )
            )
        );
        expect(modes[0]?.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });

    it("a printed count: Barter in Blood sacrifices TWO, and the noun agrees in number", () => {
        const effects = compiled(BARTER_IN_BLOOD).effects as unknown as [
            { effects: unknown },
        ];
        expect(sortKeys(effects[0].effects)).toEqual(
            sortKeys(
                edict(
                    { ref: "$each" },
                    { type: "Creature" },
                    2,
                    "Sacrifice two creatures."
                )
            )
        );
    });

    it("a permanent: Misguided Rage — the whole permanent-type list, which is every permanent", () => {
        expect(sortKeys(compiled(MISGUIDED_RAGE).effects)).toEqual(
            sortKeys(
                edict(
                    { target: 0 },
                    {
                        type: [
                            "Artifact",
                            "Battle",
                            "Creature",
                            "Enchantment",
                            "Land",
                            "Planeswalker",
                        ],
                    },
                    1,
                    "Sacrifice a permanent."
                )
            )
        );
    });

    it("every golden reaches `ready` — the fixtures clear the choice-binding and forEach smoke skips", () => {
        for (const card of [
            DIABOLIC_EDICT,
            CRUEL_EDICT,
            YAWNING_FISSURE,
            INNOCENT_BLOOD,
            BARTER_IN_BLOOD,
            WING_SHARDS,
            UMBRAL_JUKE,
            MISGUIDED_RAGE,
        ])
            expect([card.name, compileCard(card).state]).toEqual([
                card.name,
                "ready",
            ]);
    });

    it('"of their choice" is the default reading spelled out — leaving it off is the same script', () => {
        const spelled = compiled(
            sorcery("Target opponent sacrifices a creature of their choice.")
        );
        const bare = compiled(
            sorcery("Target opponent sacrifices a creature.")
        );
        expect(sortKeys(bare.effects)).toEqual(sortKeys(spelled.effects));
    });
});

describe("player edict — refusals (fail-closed, ADR 0105 § 2)", () => {
    it.each([
        // A clause on the phrase the descriptor has no field for (Run Afoul).
        "Target opponent sacrifices a creature of their choice with flying.",
        // A magnitude that is a fact about the cast (Devastating Dreams).
        "Each player sacrifices X lands of their choice.",
        // A second verb in the sentence (Geth's Verdict).
        "Target player sacrifices a creature of their choice and loses 1 life.",
        // The superlative selector is its own slice (Consumed by Greed).
        "Target opponent sacrifices a creature with the greatest power among creatures they control.",
        // "attacking or blocking" is two roles; the filter reads one (Celestial Flare).
        "Target player sacrifices an attacking or blocking creature of their choice.",
        // A colour clause has no sacrifice-filter field yet (Self-Inflicted Wound).
        "Target opponent sacrifices a green or white creature of their choice.",
        // Nor does a type exclusion (Doomsday Confluence).
        "Each player sacrifices a nonartifact creature of their choice.",
        // "blocking" is a combat role the filter does not read: only "attacking".
        "Target player sacrifices a blocking creature of their choice.",
        // "multicolored" is no descriptor word at all (Renounce the Guilds).
        "Each player sacrifices a multicolored permanent of their choice.",
        // Two nouns, each with its own article: no single filter (Perilous Predicament).
        "Each opponent sacrifices an artifact creature and a nonartifact creature of their choice.",
        // A counted rider (Urborg Justice).
        "Target opponent sacrifices a creature of their choice for each creature put into your graveyard from the battlefield this turn.",
        // The noun disagrees with the count.
        "Target player sacrifices two creature of their choice.",
        "Target player sacrifices a creatures of their choice.",
    ])("%s", (text) => {
        expect(refusal(sorcery(text))).toBe("no slot consumed the line");
    });

    it("a rider on the phrase is refused by the DESCRIPTOR, naming the phrase it could not read", () => {
        expect(
            refusedSpan(
                sorcery(
                    "Target opponent sacrifices a creature of their choice with flying."
                )
            )
        ).toBe("creature of their choice with flying");
    });

    it('"that player" with no head naming one is refused, never guessed', () => {
        expect(
            refusal(
                sorcery("That player sacrifices a creature of their choice.")
            )
        ).toBe('"that player" names no player at this site');
    });

    it('"you" is not an edict subject — the controller\'s own sacrifice is another form', () => {
        expect(
            refusal(sorcery("You sacrifices a creature of their choice."))
        ).toBe("a sacrifice by the controller is not the edict form");
    });
});

describe("player edict — lowering (the chooser is the named player)", () => {
    const chooserOf = (card: OracleCard) =>
        (compiled(card).effects as unknown as { player: unknown }[])[0]!.player;

    it("target player / opponent: the announced slot, not the controller", () => {
        expect(chooserOf(DIABOLIC_EDICT)).toEqual({ target: 0 });
        expect(chooserOf(CRUEL_EDICT)).toEqual({ target: 0 });
    });

    it("each opponent: the opponent ref, which is relative to the controller", () => {
        expect(chooserOf(YAWNING_FISSURE)).toBe("opponent");
    });

    it("no lowered edict names the caster as the chooser", () => {
        for (const card of [DIABOLIC_EDICT, CRUEL_EDICT, YAWNING_FISSURE])
            expect(chooserOf(card)).not.toBe("controller");
    });
});

describe("player edict — behaviour through the real interpreter (CR 701.21a)", () => {
    const BEAR_ID = "test-4246-bear";
    registerTokenDefinition({
        id: BEAR_ID,
        name: BEAR_ID,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
    });
    const LAND_ID = "test-4246-land";
    registerTokenDefinition({
        id: LAND_ID,
        name: LAND_ID,
        rarity: "common",
        manaCost: {},
        types: ["Land"],
        power: undefined,
        toughness: undefined,
    });

    const bear = (owner: string, id: string, attacking = false) => {
        const card = makeInstance(BEAR_ID, {
            id,
            controllerId: owner,
            ownerId: owner,
        });
        if (attacking) card.isAttacking = true;
        return card;
    };
    const land = (owner: string, id: string) =>
        makeInstance(LAND_ID, { id, controllerId: owner, ownerId: owner });

    function withCompiled<T>(card: OracleCard, fn: (id: string) => T): T {
        const id = `test-4246-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
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

    it("Diabolic Edict: the TARGET chooses among ITS OWN creatures; the caster's are untouched", () => {
        withCompiled(DIABOLIC_EDICT, (id) => {
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [bear("p1", "mine")] }),
                    makePlayer("p2", {
                        battlefield: [bear("p2", "t1"), bear("p2", "t2")],
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
            expect(resolveTopOfStack(state)).toBeNull(); // suspended
            const head = state.pendingChoices![0]!;
            expect(head.kind).toBe("sacrifice-permanents");
            expect(head.playerId).toBe("p2"); // the target, not the caster
            expect(head.count).toBe(1);
            expect(head.prompt).toBe("Sacrifice a creature.");
            expect(state.stack).toHaveLength(1); // CR 608.3 — held across the wait

            submit(state, "p2", ["t2"]);
            expect(getPlayer(state, "p2").battlefield.map((c) => c.id)).toEqual(
                ["t1"]
            );
            expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
                "t2",
            ]);
            expect(getPlayer(state, "p1").battlefield.map((c) => c.id)).toEqual(
                ["mine"]
            );
            expect(state.stack).toHaveLength(0);
            expect(state.pendingChoices).toBeUndefined();
        });
    });

    it("a target with NO creature sacrifices nothing — no prompt, no error (CR 608.2b)", () => {
        withCompiled(DIABOLIC_EDICT, (id) => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    // A land is not a creature: nothing matches the filter.
                    makePlayer("p2", { battlefield: [land("p2", "forest")] }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
            expect(resolveTopOfStack(state)).not.toBeNull();
            expect(state.pendingChoices).toBeUndefined();
            expect(getPlayer(state, "p2").battlefield.map((c) => c.id)).toEqual(
                ["forest"]
            );
            expect(state.stack).toHaveLength(0);
        });
    });

    it("Yawning Fissure: the OPPONENT of whoever cast it chooses a land — from either seat", () => {
        withCompiled(YAWNING_FISSURE, (id) => {
            for (const [caster, victim] of [
                ["p1", "p2"],
                ["p2", "p1"],
            ] as const) {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [land("p1", "l1"), land("p1", "l1b")],
                        }),
                        makePlayer("p2", {
                            battlefield: [land("p2", "l2"), land("p2", "l2b")],
                        }),
                    ],
                });
                pushSpell(state, id, caster);
                expect(resolveTopOfStack(state)).toBeNull();
                const head = state.pendingChoices![0]!;
                expect(head.playerId).toBe(victim);
                const own = getPlayer(state, victim).battlefield[0]!.id;
                submit(state, victim, [own]);
                expect(getPlayer(state, victim).battlefield).toHaveLength(1);
                expect(getPlayer(state, caster).battlefield).toHaveLength(2);
            }
        });
    });

    it("Wing Shards: only an ATTACKING creature is a legal pick (CR 508.1k combat status)", () => {
        withCompiled(WING_SHARDS, (id) => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [
                            bear("p2", "home"),
                            bear("p2", "attacker", true),
                        ],
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
            resolveTopOfStack(state);
            const head = state.pendingChoices![0]!;
            expect(head.playerId).toBe("p2");
            expect(() => submit(state, "p2", ["home"])).toThrow();
            submit(state, "p2", ["attacker"]);
            expect(getPlayer(state, "p2").battlefield.map((c) => c.id)).toEqual(
                ["home"]
            );
        });
    });

    it("Innocent Blood: every player picks in APNAP order, then the sacrifices land together", () => {
        withCompiled(INNOCENT_BLOOD, (id) => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [bear("p1", "a1"), bear("p1", "a2")],
                    }),
                    makePlayer("p2", { battlefield: [bear("p2", "b1")] }),
                ],
            });
            pushSpell(state, id, "p2");
            resolveTopOfStack(state);
            expect(state.pendingChoices![0]!.playerId).toBe("p1"); // active player first
            submit(state, "p1", ["a1"]);
            expect(state.pendingChoices![0]!.playerId).toBe("p2");
            // CR 101.4 — p1's pick is recorded, not yet applied.
            expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
            submit(state, "p2", ["b1"]);
            expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toEqual([
                "a1",
            ]);
            expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        });
    });

    it("Barter in Blood: two picks, clamped to what a player controls (CR 608.2b)", () => {
        withCompiled(BARTER_IN_BLOOD, (id) => {
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [bear("p1", "only")] }),
                    makePlayer("p2", {
                        battlefield: [
                            bear("p2", "x"),
                            bear("p2", "y"),
                            bear("p2", "z"),
                        ],
                    }),
                ],
            });
            pushSpell(state, id, "p1");
            resolveTopOfStack(state);
            expect(state.pendingChoices![0]!.playerId).toBe("p1");
            expect(state.pendingChoices![0]!.count).toBe(1); // clamped from 2
            submit(state, "p1", ["only"]);
            expect(state.pendingChoices![0]!.playerId).toBe("p2");
            expect(state.pendingChoices![0]!.count).toBe(2);
            submit(state, "p2", ["x", "z"]);
            expect(getPlayer(state, "p2").battlefield.map((c) => c.id)).toEqual(
                ["y"]
            );
            expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        });
    });

    it("wire format: the chooser's client owns the prompt and the Expected Input; the caster's gate is shut (ADR 0047)", () => {
        withCompiled(DIABOLIC_EDICT, (id) => {
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [bear("p2", "t1"), bear("p2", "t2")],
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
            resolveTopOfStack(state);
            refreshExpectedInput(state);

            expect(state.expectedInput?.kind).toBe("choice");
            expect(state.expectedInput?.playerId).toBe("p2");
            expect(() =>
                assertExpectedInput(state, { playerId: "p1", expect: "choice" })
            ).toThrow(); // the caster is NOT the chooser
            assertExpectedInput(state, { playerId: "p2", expect: "choice" });

            const projected = projectPublicState(state, 1, "p2");
            const head = projected.pendingChoices![0]!;
            expect(head.kind).toBe("sacrifice-permanents");
            expect(head.playerId).toBe("p2");
            expect(head.prompt).toBe("Sacrifice a creature.");
            expect(projected.expectedInput?.playerId).toBe("p2");
        });
    });
});
