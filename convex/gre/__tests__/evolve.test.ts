// Evolve (CR 702.100, issue #4001) — "Whenever a creature you control enters, if
// that creature's power is greater than this creature's power and/or that
// creature's toughness is greater than this creature's toughness, put a +1/+1
// counter on this creature."
//
// Every board goes through the production funnels: `putReanimatedSetOnBattlefield`
// / `removePermanentTo` → `processPendingActionTriggers` → the stack.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    addCounterToCard,
    processPendingActionTriggers,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { withTemporaryDefinition } from "../../cards/registry";
import { getDefinition } from "../../cards";
import { evolvedTrigger } from "../../cards/abilities/evolve";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import { AURA_AFFECTS_HOST, type CardDefinition } from "../../cards/types";

const EVOLVER_ID = "test-only-evolver";

function creature(
    id: string,
    power: number,
    toughness: number,
    extra: Partial<CardDefinition> = {}
): CardDefinition {
    return {
        id,
        rarity: "common",
        name: `Test ${id}`,
        oracleText: "",
        manaCost: { X: 1 },
        types: ["Creature"],
        power,
        toughness,
        ...extra,
    };
}

function evolver(
    power: number,
    toughness: number,
    extra: Partial<CardDefinition> = {}
): CardDefinition {
    return creature(EVOLVER_ID, power, toughness, {
        staticAbilities: ["evolve"],
        ...extra,
    });
}

function entrant(power: number, toughness: number): CardDefinition {
    return creature("test-only-entrant", power, toughness);
}

function withDefs(defs: CardDefinition[], run: () => void): void {
    const [head, ...rest] = defs;
    if (!head) return run();
    withTemporaryDefinition(head, () => withDefs(rest, run));
}

function boardWith(cardId: string = EVOLVER_ID): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(cardId, {
                        id: "source",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function onBattlefield(state: GameState, id: string): CardInstanceState {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    throw new Error(`${id} is not on the battlefield`);
}

/** Puts the listed permanents onto the battlefield in ONE event and collects
 *  whatever triggered. */
function enter(
    state: GameState,
    ...defs: { def: CardDefinition; id: string; controllerId?: string }[]
): void {
    putReanimatedSetOnBattlefield(
        state,
        defs.map(({ def, id, controllerId = "p1" }) => ({
            card: makeInstance(def.id, {
                id,
                controllerId,
                ownerId: controllerId,
            }),
            controllerId,
        }))
    );
    processPendingActionTriggers(state);
    resolveTriggerOrder(state);
}

function evolveItems(state: GameState) {
    return state.stack.filter((s) => s.triggeredAbilityId === "evolve");
}

function drainStack(state: GameState): void {
    resolveTriggerOrder(state);
    while (state.stack.length > 0) {
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTriggerOrder(state);
    }
}

function plusOneCounters(state: GameState, id = "source"): number {
    return onBattlefield(state, id).counters?.["+1/+1"] ?? 0;
}

/** A blink through the two production funnels, under the SAME instance id. No
 *  trigger is collected, so a resolution afterwards reads the older item. */
function blinkUncollected(state: GameState, id: string): void {
    const left = removePermanentTo(state, id, "exile");
    expect(left).not.toBeNull();
    const owner = state.players.find((p) => p.id === left!.ownerId)!;
    const idx = owner.exile.findIndex((c) => c.id === id);
    const [card] = owner.exile.splice(idx, 1);
    putReanimatedSetOnBattlefield(state, [
        { card, controllerId: card.ownerId },
    ]);
}

describe("Evolve — expansion (CR 702.100a / 702.100d)", () => {
    it("the bare keyword injects one PERMANENT_ENTERED trigger", () => {
        withDefs([evolver(1, 1)], () => {
            const evolve = (
                getDefinition(EVOLVER_ID).triggeredAbilities ?? []
            ).filter((t) => t.id === "evolve");
            expect(evolve).toHaveLength(1);
            expect(evolve[0].event).toBe("PERMANENT_ENTERED");
        });
    });

    it("declared twice, it injects one trigger per instance", () => {
        withDefs(
            [evolver(1, 1, { staticAbilities: ["evolve", "evolve"] })],
            () => {
                const evolve = (
                    getDefinition(EVOLVER_ID).triggeredAbilities ?? []
                ).filter((t) => t.id === "evolve");
                expect(evolve).toHaveLength(2);
            }
        );
    });
});

describe("Evolve — the check as it triggers (CR 702.100a / 603.4)", () => {
    it.each([
        ["greater power only", [1, 1], [2, 1], 1],
        ["greater toughness only", [1, 1], [1, 2], 1],
        ["greater in both", [1, 1], [2, 2], 1],
        ["equal in both", [2, 2], [2, 2], 0],
        ["smaller in both", [3, 3], [1, 1], 0],
        // Power against toughness would call this one greater: 2 > 1.
        ["never compared across", [3, 1], [2, 1], 0],
    ])("%s", (_label, source, entering, triggers) => {
        const def = entrant(entering[0], entering[1]);
        withDefs([evolver(source[0], source[1]), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(triggers as number);
        });
    });

    it("reads the source through the layers: a counter already on it counts", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            addCounterToCard(state, onBattlefield(state, "source"), "+1/+1", 1);
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(0);
        });
    });

    it("reads the entering creature through the layers: a counter it enters with counts", () => {
        const def = creature("test-only-entrant", 1, 1, {
            entersWith: { counters: [{ type: "+1/+1", count: 1 }] },
        });
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(1);
        });
    });

    it("an opponent's creature does not trigger it", () => {
        const def = entrant(5, 5);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering", controllerId: "p2" });
            expect(evolveItems(state)).toHaveLength(0);
        });
    });

    it("a noncreature permanent does not trigger it", () => {
        const def: CardDefinition = {
            ...entrant(5, 5),
            types: ["Artifact"],
        };
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(0);
        });
    });

    it("a noncreature source does not trigger: nothing is greater than it (CR 702.100c)", () => {
        const def = entrant(5, 5);
        const artifact: CardDefinition = {
            ...evolver(1, 1),
            types: ["Artifact"],
        };
        withDefs([artifact, def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(0);
        });
    });

    it("the source entering alongside a greater creature triggers on that creature, not on itself", () => {
        const def = entrant(2, 2);
        const source = evolver(1, 1);
        withDefs([source, def], () => {
            const state = makeState({
                players: [makePlayer("p1"), makePlayer("p2")],
            });
            enter(
                state,
                { def: source, id: "source" },
                { def, id: "entering" }
            );
            expect(evolveItems(state)).toHaveLength(1);
            drainStack(state);
            expect(plusOneCounters(state)).toBe(1);
        });
    });
});

describe("Evolve — resolution (CR 702.100a / 603.4)", () => {
    it("puts one +1/+1 counter on the source; the entering creature gets none", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            drainStack(state);
            const source = onBattlefield(state, "source");
            expect(source.counters).toEqual({ "+1/+1": 1 });
            expect(getEffectivePower(state, source)).toBe(2);
            expect(getEffectiveToughness(state, source)).toBe(2);
            expect(onBattlefield(state, "entering").counters ?? {}).toEqual({});
        });
    });

    it("the source outgrowing it in response: the re-check fails and no counter comes", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            addCounterToCard(state, onBattlefield(state, "source"), "+1/+1", 1);
            drainStack(state);
            expect(plusOneCounters(state)).toBe(1);
        });
    });

    it("the entering creature shrinking in response: the re-check fails and no counter comes", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            addCounterToCard(
                state,
                onBattlefield(state, "entering"),
                "-1/-1",
                1
            );
            drainStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });

    it("two entering together: each triggers, and the second finds the source already grown", () => {
        const a = creature("test-only-a", 2, 2);
        const b = creature("test-only-b", 2, 2);
        withDefs([evolver(1, 1), a, b], () => {
            const state = boardWith();
            enter(state, { def: a, id: "a" }, { def: b, id: "b" });
            expect(evolveItems(state)).toHaveLength(2);
            drainStack(state);
            expect(plusOneCounters(state)).toBe(1);
        });
    });

    it("a token entering evolves it like any other creature", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            putReanimatedSetOnBattlefield(state, [
                {
                    card: makeInstance(def.id, {
                        id: "token",
                        controllerId: "p1",
                        ownerId: "p1",
                        isToken: true,
                    }),
                    controllerId: "p1",
                },
            ]);
            processPendingActionTriggers(state);
            drainStack(state);
            expect(plusOneCounters(state)).toBe(1);
        });
    });

    it("wire format: the counter and the grown body survive `projectPublicState`", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            drainStack(state);
            const wire = projectPublicState(
                state,
                1,
                "p1"
            ).players[0].battlefield.find((c) => c.id === "source");
            expect(wire?.counters).toEqual({ "+1/+1": 1 });
        });
    });
});

describe("Evolve — last known information (CR 608.2h / 400.7)", () => {
    it("the entering creature gone at resolution: its LAST power counts, not its entry power", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            // Source 2/2, entering 3/3: the entry snapshot alone would say 2 > 2.
            addCounterToCard(state, onBattlefield(state, "source"), "+1/+1", 1);
            addCounterToCard(
                state,
                onBattlefield(state, "entering"),
                "+1/+1",
                1
            );
            removePermanentTo(state, "entering", "graveyard", "destroy");
            while (state.stack.length > 0) resolveTopOfStack(state);
            expect(plusOneCounters(state)).toBe(2);
        });
    });

    it("its last power includes what an Aura on it gave, though the Aura's effect ends with it", () => {
        const def = entrant(2, 2);
        const aura: CardDefinition = {
            id: "test-only-pump-aura",
            rarity: "common",
            name: "Test Pump Aura",
            oracleText: "Enchanted creature gets +2/+2.",
            manaCost: { X: 1 },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            staticEffects: [
                {
                    kind: "pt-buff",
                    applies: AURA_AFFECTS_HOST,
                    power: 2,
                    toughness: 2,
                },
            ],
        };
        withDefs([evolver(1, 1), def, aura], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            // Source 3/3: only the Aura's +2/+2 makes the creature (4/4) greater.
            addCounterToCard(state, onBattlefield(state, "source"), "+1/+1", 2);
            state.players[0].battlefield.push(
                makeInstance(aura.id, {
                    id: "aura",
                    controllerId: "p1",
                    ownerId: "p1",
                    attachedTo: "entering",
                })
            );
            expect(
                getEffectivePower(state, onBattlefield(state, "entering"))
            ).toBe(4);
            removePermanentTo(state, "entering", "graveyard", "destroy");
            while (state.stack.length > 0) resolveTopOfStack(state);
            expect(plusOneCounters(state)).toBe(3);
        });
    });

    it("shrunk before it left: its last power fails the check though its entry power passes", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            addCounterToCard(
                state,
                onBattlefield(state, "entering"),
                "-1/-1",
                1
            );
            removePermanentTo(state, "entering", "graveyard", "destroy");
            while (state.stack.length > 0) resolveTopOfStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });

    it("blinked in response: the older trigger reads the departed object, not the same-id newcomer", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            addCounterToCard(
                state,
                onBattlefield(state, "entering"),
                "-1/-1",
                1
            );
            // Departed as a 1/1, back as a 2/2: only the departed one counts.
            blinkUncollected(state, "entering");
            expect(
                getEffectivePower(state, onBattlefield(state, "entering"))
            ).toBe(2);
            resolveTopOfStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });

    it("the last known values survive a save and load while the trigger waits", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            addCounterToCard(
                state,
                onBattlefield(state, "entering"),
                "-1/-1",
                1
            );
            blinkUncollected(state, "entering");
            const reloaded = expandState(compactState(state));
            resolveTopOfStack(reloaded);
            expect(plusOneCounters(reloaded)).toBe(0);
        });
    });

    it("the source gone at resolution: nothing happens", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            removePermanentTo(state, "source", "graveyard", "destroy");
            while (state.stack.length > 0) resolveTopOfStack(state);
            expect(state.stack).toHaveLength(0);
            expect(state.players[0].graveyard.map((c) => c.id)).toContain(
                "source"
            );
        });
    });

    it("the source blinked in response: the returned object is new and gets no counter", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            blinkUncollected(state, "source");
            resolveTopOfStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });
});

describe("Evolve — a noncreature on either side (CR 702.100c)", () => {
    it("the entering creature stopped being a creature: the re-check fails", () => {
        const def = entrant(5, 5);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            onBattlefield(state, "entering").types = ["Artifact"];
            drainStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });

    it("the source stopped being a creature: the re-check fails", () => {
        const def = entrant(5, 5);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            onBattlefield(state, "source").types = ["Artifact"];
            drainStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });

    it("the entering creature left as a noncreature: its last known information fails too", () => {
        const def = entrant(5, 5);
        withDefs([evolver(1, 1), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            onBattlefield(state, "entering").types = ["Artifact"];
            removePermanentTo(state, "entering", "graveyard", "destroy");
            while (state.stack.length > 0) resolveTopOfStack(state);
            expect(plusOneCounters(state)).toBe(0);
        });
    });
});

describe("Evolve — multiple instances (CR 702.100d)", () => {
    const twice = { staticAbilities: ["evolve", "evolve"] };

    it("each triggers separately, and both grow the source past a large creature", () => {
        const def = entrant(5, 5);
        withDefs([evolver(1, 1, twice), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(2);
            drainStack(state);
            expect(plusOneCounters(state)).toBe(2);
        });
    });

    it("the second re-checks against the first one's counter", () => {
        const def = entrant(2, 2);
        withDefs([evolver(1, 1, twice), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            expect(evolveItems(state)).toHaveLength(2);
            drainStack(state);
            expect(plusOneCounters(state)).toBe(1);
        });
    });
});

describe("Evolves (CR 702.100b)", () => {
    /** An evolver with "whenever this creature evolves" that puts a charge
     *  counter on itself, so each firing leaves a count. */
    function watchingEvolver(
        extra: Partial<CardDefinition> = {}
    ): CardDefinition {
        return evolver(1, 1, {
            triggeredAbilities: [
                evolvedTrigger({
                    id: "on-evolved",
                    oracleText: "Whenever this creature evolves, test.",
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "charge",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                }),
                ...(extra.triggeredAbilities ?? []),
            ],
        });
    }

    function evolvedCount(state: GameState): number {
        return onBattlefield(state, "source").counters?.charge ?? 0;
    }

    it("a resolved evolve ability makes it evolve, once", () => {
        const def = entrant(2, 2);
        withDefs([watchingEvolver(), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            drainStack(state);
            expect(evolvedCount(state)).toBe(1);
        });
    });

    it("an evolve ability that fails its re-check does not", () => {
        const def = entrant(2, 2);
        withDefs([watchingEvolver(), def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            addCounterToCard(state, onBattlefield(state, "source"), "+1/+1", 1);
            drainStack(state);
            expect(evolvedCount(state)).toBe(0);
        });
    });

    it("a +1/+1 counter from anything but its evolve ability does not", () => {
        const def = entrant(0, 0);
        const source = watchingEvolver({
            triggeredAbilities: [
                enteredTrigger({
                    id: "other-counter",
                    oracleText: "Whenever a creature enters, test.",
                    scope: "another-yours",
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                }),
            ],
        });
        withDefs([source, def], () => {
            const state = boardWith();
            enter(state, { def, id: "entering" });
            drainStack(state);
            expect(plusOneCounters(state)).toBe(1);
            expect(evolvedCount(state)).toBe(0);
        });
    });
});
