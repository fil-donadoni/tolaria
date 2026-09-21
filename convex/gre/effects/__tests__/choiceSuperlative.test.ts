// `choice.superlative` — the candidates a chooser may pick are the permanents
// TIED for the greatest (or least) stat among the zone owner's pool (CR 608.2h,
// issue #4247). The Op is exercised through the real interpreter: the pick is
// raised as a Pending Choice whose `candidateIds` is the narrowed list, and the
// submit validator refuses anything outside it.
//
// Three layers:
//
//  1. RESOLUTION — only the extreme-stat permanents are offered; a tie offers
//     every tied permanent; an empty pool raises nothing; "least" mirrors
//     "greatest"; mana value ranks a mixed creature/planeswalker pool.
//  2. LAYERS + TIMING — the stat is layer-computed (an anthem changes who is
//     greatest), and it is computed ONCE, when the choice is raised.
//  3. VALIDATION — the field is fail-closed: an unknown stat/extreme, an extra
//     key, a non-battlefield zone, a `candidates`/`allControllers` pairing, and
//     a power ranking over a pool that may hold a permanent with no power are
//     all rejected.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { projectPublicState } from "../../../gameProjections";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { getPlayer, resolveTopOfStack } from "../../state";
import { validateEffectScript } from "../validate";

/** The stat carried by each fixture is its CARD's: power via the definition,
 *  mana value via the cost. Ids are the test's own, never a real card's. */
function creature(id: string, power: number, manaValue = 1, color = "G") {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { [color]: manaValue },
        types: ["Creature"],
        power,
        toughness: power,
    });
    return id;
}
function planeswalker(id: string, manaValue: number) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { B: manaValue },
        types: ["Planeswalker"],
        power: undefined,
        toughness: undefined,
    });
    return id;
}

const BEAR = creature("t4247-bear", 2);
const OGRE = creature("t4247-ogre", 4);
const OGRE_TWIN = creature("t4247-ogre-twin", 4);
const WHITE_KNIGHT = creature("t4247-knight", 2, 1, "W");
const CHEAP = creature("t4247-cheap", 6, 1);
const COSTLY = creature("t4247-costly", 1, 5);
const WALKER = planeswalker("t4247-walker", 5);
const SMALL_WALKER = planeswalker("t4247-small-walker", 2);
// Crusade — "White creatures get +1/+1." A real layer-7c static effect.
const CRUSADE = "057986c7-20c0-4157-b4df-beae4ef5c66d";

const held = (owner: string, defId: string, id: string) =>
    makeInstance(defId, { id, controllerId: owner, ownerId: owner });

function edictScript(
    filter: unknown,
    superlative: unknown
): readonly EffectOp[] {
    return [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player: "opponent",
            zone: "battlefield",
            filter,
            superlative,
            count: 1,
            prompt: "Sacrifice one.",
            bind: "$picked",
        },
        { op: "sacrifice", permanents: { ref: "$picked" } },
    ] as unknown as readonly EffectOp[];
}

function withScript<T>(script: readonly EffectOp[], fn: (id: string) => T): T {
    const id = "t4247-spell";
    const definition = {
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects: script,
    } as unknown as CardDefinition;
    return withTemporaryDefinition(definition, () => fn(id));
}

const POWER = { stat: "power", extreme: "greatest" } as const;
const CREATURE = { type: "Creature" } as const;

/** Resolve the spell against `battlefield` (p2's) and return the raised pick. */
function raise(
    id: string,
    battlefield: ReturnType<typeof held>[],
    extra: { p1?: ReturnType<typeof held>[] } = {}
) {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: extra.p1 ?? [] }),
            makePlayer("p2", { battlefield }),
        ],
    });
    pushSpell(state, id, "p1");
    const done = resolveTopOfStack(state);
    return { state, done, head: state.pendingChoices?.[0] };
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

describe("choice.superlative — resolution (CR 608.2h)", () => {
    it("power: only the greatest-power creature is offered, and the smaller ones are not pickable", () => {
        withScript(edictScript(CREATURE, POWER), (id) => {
            const { state, done, head } = raise(id, [
                held("p2", BEAR, "bear"),
                held("p2", OGRE, "ogre"),
            ]);
            expect(done).toBeNull(); // suspended on the chooser
            expect(head?.playerId).toBe("p2");
            expect(head?.candidateIds).toEqual(["ogre"]);
            expect(() => submit(state, "p2", ["bear"])).toThrow();
            submit(state, "p2", ["ogre"]);
            expect(getPlayer(state, "p2").battlefield.map((c) => c.id)).toEqual(
                ["bear"]
            );
            expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
                "ogre",
            ]);
        });
    });

    it("a tie offers EVERY tied permanent and the chooser picks among them", () => {
        withScript(edictScript(CREATURE, POWER), (id) => {
            const { state, head } = raise(id, [
                held("p2", OGRE, "ogre-a"),
                held("p2", BEAR, "bear"),
                held("p2", OGRE_TWIN, "ogre-b"),
            ]);
            expect([...head!.candidateIds!].sort()).toEqual([
                "ogre-a",
                "ogre-b",
            ]);
            submit(state, "p2", ["ogre-b"]);
            expect(
                getPlayer(state, "p2")
                    .battlefield.map((c) => c.id)
                    .sort()
            ).toEqual(["bear", "ogre-a"]);
        });
    });

    it("only the CHOOSER's own battlefield is ranked — the caster's bigger creature is not in the pool", () => {
        withScript(edictScript(CREATURE, POWER), (id) => {
            const { head } = raise(id, [held("p2", BEAR, "bear")], {
                p1: [held("p1", OGRE, "mine")],
            });
            expect(head?.candidateIds).toEqual(["bear"]);
        });
    });

    it("an empty pool raises no choice and sacrifices nothing (CR 101.3)", () => {
        withScript(edictScript(CREATURE, POWER), (id) => {
            const { state, done, head } = raise(id, []);
            expect(done).not.toBeNull();
            expect(head).toBeUndefined();
            expect(state.stack).toHaveLength(0);
        });
    });

    it('"least" is the mirror: the smallest-power creature is the candidate', () => {
        withScript(
            edictScript(CREATURE, { stat: "power", extreme: "least" }),
            (id) => {
                const { head } = raise(id, [
                    held("p2", BEAR, "bear"),
                    held("p2", OGRE, "ogre"),
                ]);
                expect(head?.candidateIds).toEqual(["bear"]);
            }
        );
    });

    it("mana value ranks a creature-or-planeswalker pool: the costliest permanent, whatever its type", () => {
        withScript(
            edictScript(
                { type: ["Creature", "Planeswalker"] },
                { stat: "mana-value", extreme: "greatest" }
            ),
            (id) => {
                const { state, head } = raise(id, [
                    held("p2", CHEAP, "cheap"), // power 6, mana value 1
                    held("p2", COSTLY, "costly"), // power 1, mana value 5
                    held("p2", WALKER, "walker"), // mana value 5
                    held("p2", SMALL_WALKER, "small-walker"),
                ]);
                expect([...head!.candidateIds!].sort()).toEqual([
                    "costly",
                    "walker",
                ]);
                submit(state, "p2", ["walker"]);
                expect(
                    getPlayer(state, "p2").graveyard.map((c) => c.id)
                ).toEqual(["walker"]);
            }
        );
    });

    it("mana value is the INSTANCE's: a token copy with no mana cost ranks 0, not its printed cost (CR 202.3, CR 707.2)", () => {
        withScript(
            edictScript(CREATURE, { stat: "mana-value", extreme: "greatest" }),
            (id) => {
                const costlyCopy = held("p2", COSTLY, "costly-copy");
                costlyCopy.manaCostOverride = {}; // e.g. an Eternalize token
                const { head } = raise(id, [
                    costlyCopy,
                    held("p2", CHEAP, "cheap"), // printed mana value 1
                ]);
                expect(head?.candidateIds).toEqual(["cheap"]);
            }
        );
    });

    it("the pool is what `filter` matches: a permanent outside it is neither ranked nor offered", () => {
        withScript(
            edictScript(
                { type: "Planeswalker" },
                { stat: "mana-value", extreme: "greatest" }
            ),
            (id) => {
                const { head } = raise(id, [
                    held("p2", COSTLY, "costly"), // mana value 5, but a creature
                    held("p2", SMALL_WALKER, "small-walker"),
                ]);
                expect(head?.candidateIds).toEqual(["small-walker"]);
            }
        );
    });

    it("wire format: the client reads the NARROWED list, not the whole pool", () => {
        withScript(edictScript(CREATURE, POWER), (id) => {
            const { state } = raise(id, [
                held("p2", BEAR, "bear"),
                held("p2", OGRE, "ogre"),
            ]);
            const projected = projectPublicState(state, 1, "p2");
            const head = projected.pendingChoices![0]!;
            expect(head.playerId).toBe("p2");
            expect(head.candidateIds).toEqual(["ogre"]);
        });
    });
});

describe("choice.superlative — layers and timing (CR 613, CR 608.2h)", () => {
    it("an anthem changes who is greatest: Crusade lifts the white 2/2 into a tie with the green 3/3", () => {
        const green = creature("t4247-green-three", 3, 1, "G");
        withScript(edictScript(CREATURE, POWER), (id) => {
            const before = raise(id, [
                held("p2", WHITE_KNIGHT, "knight"),
                held("p2", green, "green"),
            ]);
            expect(before.head?.candidateIds).toEqual(["green"]);

            const after = raise(id, [
                held("p2", WHITE_KNIGHT, "knight"),
                held("p2", green, "green"),
                held("p2", CRUSADE, "crusade"),
            ]);
            expect([...after.head!.candidateIds!].sort()).toEqual([
                "green",
                "knight",
            ]);
        });
    });

    it("the extreme is decided when the choice is raised, not again at the pick", () => {
        withScript(edictScript(CREATURE, POWER), (id) => {
            const { state, head } = raise(id, [
                held("p2", OGRE, "ogre"),
                held("p2", BEAR, "bear"),
            ]);
            expect(head?.candidateIds).toEqual(["ogre"]);
            // The bear outgrows the ogre while the prompt is open. The allow-list
            // was fixed at the raise: the ogre is still the legal pick and the
            // bear still is not.
            const bear = getPlayer(state, "p2").battlefield.find(
                (c) => c.id === "bear"
            )!;
            bear.counters = { "+1/+1": 5 };
            expect(() => submit(state, "p2", ["bear"])).toThrow();
            submit(state, "p2", ["ogre"]);
            expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
                "ogre",
            ]);
        });
    });
});

describe("choice.superlative — validation (fail-closed)", () => {
    const check = (
        overrides: Record<string, unknown>,
        superlative: unknown = POWER
    ) =>
        validateEffectScript({
            id: "t4247-validate",
            name: "t4247-validate",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    filter: CREATURE,
                    superlative,
                    count: 1,
                    prompt: "Sacrifice one.",
                    bind: "$picked",
                    ...overrides,
                },
            ] as unknown as EffectOp[],
        });

    it("the shipped shape validates", () => {
        expect(check({})).toEqual([]);
        expect(
            check(
                { filter: { type: ["Creature", "Planeswalker"] } },
                { stat: "mana-value", extreme: "least" }
            )
        ).toEqual([]);
    });

    it.each([
        ["an unknown stat", { stat: "toughness", extreme: "greatest" }],
        ["an unknown extreme", { stat: "power", extreme: "median" }],
        ["a missing extreme", { stat: "power" }],
        ["an extra key", { stat: "power", extreme: "greatest", among: "all" }],
        ["a bare string", "greatest"],
        ["null", null],
    ])("%s is rejected, never read as no restriction", (_label, value) => {
        expect(check({}, value)).not.toEqual([]);
    });

    it("a non-battlefield zone has no layer-computed stat to rank", () => {
        expect(check({ zone: "graveyard" }).join("\n")).toMatch(
            /"superlative" is valid only with zone: "battlefield"/
        );
    });

    it('`candidates` and `allControllers` each name the set another way — both are refused with "superlative"', () => {
        expect(check({ candidates: [{ target: 0 }] }).join("\n")).toMatch(
            /never together with "candidates" or "allControllers"/
        );
        expect(
            check({ kind: "choose-permanents", allControllers: true }).join(
                "\n"
            )
        ).toMatch(/never together with "candidates" or "allControllers"/);
    });

    it("power over a pool that can hold a powerless permanent is refused (CR 208.3)", () => {
        for (const filter of [
            { type: ["Creature", "Planeswalker"] },
            { type: "Planeswalker" },
            undefined,
        ]) {
            expect(check({ filter }).join("\n")).toMatch(
                /by power requires filter: \{ type: "Creature" \}/
            );
        }
    });

    it("a count other than 1 is refused — a superlative names ONE permanent", () => {
        expect(check({ count: 2 }).join("\n")).toMatch(/selects ONE permanent/);
        expect(check({ count: { min: 0, max: 1 } }).join("\n")).toMatch(
            /selects ONE permanent/
        );
    });
});

describe("choice.superlative — defence in depth (a script that skipped the validator)", () => {
    it.each([
        ["a non-battlefield zone", { zone: "hand" }],
        ["`candidates`", { candidates: [{ target: 0 }] }],
        [
            "`allControllers`",
            { kind: "choose-permanents", allControllers: true },
        ],
    ])("%s leaves NO candidate — never the whole zone", (_label, overrides) => {
        const script = [
            {
                ...(edictScript(CREATURE, POWER)[0] as object),
                ...overrides,
            },
        ] as unknown as readonly EffectOp[];
        withScript(script, (id) => {
            const { head } = raise(id, [
                held("p2", BEAR, "bear"),
                held("p2", OGRE, "ogre"),
            ]);
            expect(head).toBeUndefined();
        });
    });
});
