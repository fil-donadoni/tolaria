// Training (CR 702.149).
//
// CR 702.149a — "Whenever this creature and at least one other creature with power
// greater than this creature's power attack, put a +1/+1 counter on this creature."
// CR 702.149b — "If a creature has multiple instances of training, each triggers
// separately."
// CR 702.149c — "When this creature trains" means "When a resolving training
// ability puts one or more +1/+1 counters on this creature."
//
// The trigger is derived from the live keyword multiset, so every board here goes
// through the production path: `emitAttackersDeclaredEvents` → the trigger scan →
// the stack → `resolveTopOfStack`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    TRAINING_TRIGGER,
    TRAINING_TRIGGER_ID,
    trainedTrigger,
} from "../../cards/abilities/training";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateAbilityEffectScript } from "../effects/validate";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { emitAttackersDeclaredEvents } from "../phases";
import { checkStateBasedActions } from "../sba";
import { compactState, expandState } from "../serialize";
import {
    addCounterToCard,
    beginApplyingStaticEffects,
    buildSpellContext,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const TRAINEE: CardDefinition = {
    id: "test-only-trainee",
    rarity: "common",
    name: "Test Trainee",
    oracleText: "Training",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 1,
    staticAbilities: ["training"],
};

const TRAINED_REACTOR: CardDefinition = {
    ...TRAINEE,
    id: "test-only-trained-reactor",
    name: "Test Trained Reactor",
    oracleText: "Training\nWhenever this creature trains, you gain 1 life.",
    triggeredAbilities: [
        trainedTrigger({
            id: "test-only-trained-reactor-life",
            oracleText: "Whenever this creature trains, you gain 1 life.",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
};

/** Reads "trains", and puts a +1/+1 counter on itself through another trigger. */
const OTHER_COUNTER_REACTOR: CardDefinition = {
    ...TRAINED_REACTOR,
    id: "test-only-other-counter-reactor",
    name: "Test Other Counter Reactor",
    triggeredAbilities: [
        ...TRAINED_REACTOR.triggeredAbilities!,
        {
            id: "test-only-attack-counter",
            oracleText:
                "Whenever this creature attacks, put a +1/+1 counter on it.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
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
};

const PARTNER: CardDefinition = {
    id: "test-only-partner",
    rarity: "common",
    name: "Test Partner",
    oracleText: "",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
};

const EVEN_PARTNER: CardDefinition = {
    ...PARTNER,
    id: "test-only-even-partner",
    name: "Test Even Partner",
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

const TRAINING_ANTHEM: CardDefinition = {
    id: "test-only-training-anthem",
    rarity: "common",
    name: "Test Training Anthem",
    oracleText: "All Bear creatures have training.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView) =>
                target.subtypes.includes("Bear"),
            keyword: "training",
        },
    ],
};

function withDefs(run: () => void): void {
    withTemporaryDefinition(TRAINEE, () =>
        withTemporaryDefinition(TRAINED_REACTOR, () =>
            withTemporaryDefinition(OTHER_COUNTER_REACTOR, () =>
                withTemporaryDefinition(PARTNER, () =>
                    withTemporaryDefinition(EVEN_PARTNER, () =>
                        withTemporaryDefinition(TRAINING_ANTHEM, run)
                    )
                )
            )
        )
    );
}

function mine(def: CardDefinition, id: string): CardInstanceState {
    return makeInstance(def.id, { id, controllerId: "p1", ownerId: "p1" });
}

/** `attackers` are declared; `home` stays out of combat on the same side. */
function combat(
    attackers: CardInstanceState[],
    home: CardInstanceState[] = []
): GameState {
    for (const attacker of attackers) attacker.isAttacking = true;
    return makeState({
        players: [
            makePlayer("p1", {
                life: 20,
                battlefield: [...attackers, ...home],
            }),
            makePlayer("p2", { life: 20, battlefield: [] }),
        ],
        phase: "DECLARE_ATTACKERS",
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function trainingOnStack(state: GameState): number {
    return state.stack.filter(
        (s) => s.triggeredAbilityId === TRAINING_TRIGGER_ID
    ).length;
}

function resolveStack(state: GameState): void {
    resolveTriggerOrder(state);
    while (state.stack.length > 0) {
        resolveTopOfStack(state);
        resolveTriggerOrder(state);
    }
    checkStateBasedActions(state);
}

describe("Training (CR 702.149a)", () => {
    it("the body is a valid script on ATTACKERS_DECLARED", () => {
        expect(
            validateAbilityEffectScript(
                TRAINING_TRIGGER,
                "Training",
                "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });

    it("attacking with a creature of greater power: a +1/+1 counter", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const state = combat([trainee, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(1);
            resolveStack(state);
            expect(trainee.counters?.["+1/+1"]).toBe(1);
            expect(getEffectivePower(state, trainee)).toBe(3);
            expect(getEffectiveToughness(state, trainee)).toBe(2);
        });
    });

    it("attacking alone: no trigger", () => {
        withDefs(() => {
            const state = combat([mine(TRAINEE, "trainee")]);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(0);
        });
    });

    it("a partner of equal power is not greater: no trigger", () => {
        withDefs(() => {
            const state = combat([
                mine(TRAINEE, "trainee"),
                mine(EVEN_PARTNER, "even"),
            ]);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(0);
        });
    });

    it("a greater creature that stayed home does not count", () => {
        withDefs(() => {
            const state = combat(
                [mine(TRAINEE, "trainee")],
                [mine(PARTNER, "partner")]
            );
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(0);
        });
    });

    it("a trainee that stayed home does not train", () => {
        withDefs(() => {
            const state = combat(
                [mine(PARTNER, "partner")],
                [mine(TRAINEE, "trainee")]
            );
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(0);
        });
    });

    it("compares effective power: a counter lifts the partner past the trainee", () => {
        withDefs(() => {
            const even = mine(EVEN_PARTNER, "even");
            const state = combat([mine(TRAINEE, "trainee"), even]);
            addCounterToCard(state, even, "+1/+1", 1);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(1);
        });
    });

    it("compares effective power: a counter lifts the trainee level with the partner", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const state = combat([trainee, mine(PARTNER, "partner")]);
            addCounterToCard(state, trainee, "+1/+1", 1);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(0);
        });
    });

    it("two trainees beside one greater creature both train", () => {
        withDefs(() => {
            const first = mine(TRAINEE, "first");
            const second = mine(TRAINEE, "second");
            const state = combat([first, second, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(2);
            resolveStack(state);
            expect(first.counters?.["+1/+1"]).toBe(1);
            expect(second.counters?.["+1/+1"]).toBe(1);
        });
    });
});

describe("Training granted at runtime", () => {
    it("a static grant makes a vanilla attacker train", () => {
        withDefs(() => {
            const even = mine(EVEN_PARTNER, "even");
            const anthem = mine(TRAINING_ANTHEM, "anthem");
            const state = combat([even, mine(PARTNER, "partner")], [anthem]);
            beginApplyingStaticEffects(state, anthem);
            expect(even.staticAbilities).toContain("training");
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(1);
        });
    });

    it("each instance triggers separately and no instance re-compares (CR 702.149b)", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            trainee.staticAbilities = ["training", "training"];
            const state = combat([trainee, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(2);
            resolveStack(state);
            expect(trainee.counters?.["+1/+1"]).toBe(2);
        });
    });

    it("a creature that lost all its abilities does not train (CR 613.1f)", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const state = combat([trainee, mine(PARTNER, "partner")]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, PARTNER.id, "p1")
            );
            ctx.loseAllAbilities({ type: "permanent", id: trainee.id });
            state.stack.length = 0;
            emitAttackersDeclaredEvents(state);
            expect(trainingOnStack(state)).toBe(0);
        });
    });
});

describe("Training on the stack", () => {
    it("a partner leaving in response does not stop the counter (CR 603.4 does not apply)", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const partner = mine(PARTNER, "partner");
            const state = combat([trainee, partner]);
            emitAttackersDeclaredEvents(state);
            removePermanentTo(state, partner.id, "graveyard");
            resolveStack(state);
            expect(trainee.counters?.["+1/+1"]).toBe(1);
        });
    });

    it("a source that left the battlefield takes no counter and the stack clears", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const state = combat([trainee, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            removePermanentTo(state, trainee.id, "graveyard");
            resolveStack(state);
            expect(state.stack).toHaveLength(0);
            expect(
                state.players[0].graveyard.find((c) => c.id === trainee.id)
                    ?.counters?.["+1/+1"] ?? 0
            ).toBe(0);
        });
    });

    it("survives a save and load while on the stack", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const state = combat([trainee, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            const loaded = expandState(compactState(state));
            resolveStack(loaded);
            const reloaded = loaded.players[0].battlefield.find(
                (c) => c.id === trainee.id
            )!;
            expect(reloaded.counters?.["+1/+1"]).toBe(1);
        });
    });

    it("wire: the item and the trainee's P/T reach the client", () => {
        withDefs(() => {
            const trainee = mine(TRAINEE, "trainee");
            const state = combat([trainee, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            const before = projectPublicState(state, 1, "p2");
            expect(
                before.stack.find(
                    (s) => s.triggeredAbilityId === TRAINING_TRIGGER_ID
                )
            ).toBeDefined();

            resolveStack(state);
            const after = projectPublicState(state, 2, "p2");
            const slim = after.players[0].battlefield.find(
                (c) => c.id === trainee.id
            )!;
            expect(getEffectivePower(after, slim)).toBe(3);
            expect(getEffectiveToughness(after, slim)).toBe(2);
        });
    });
});

describe("Whenever this creature trains (CR 702.149c)", () => {
    it("the resolving training ability's counter fires the reader", () => {
        withDefs(() => {
            const reactor = mine(TRAINED_REACTOR, "reactor");
            const state = combat([reactor, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            resolveStack(state);
            expect(reactor.counters?.["+1/+1"]).toBe(1);
            expect(state.players[0].life).toBe(21);
        });
    });

    it("a +1/+1 counter from anywhere else is not training", () => {
        withDefs(() => {
            const reactor = mine(OTHER_COUNTER_REACTOR, "reactor");
            const state = combat([reactor]);
            emitAttackersDeclaredEvents(state);
            resolveStack(state);
            expect(reactor.counters?.["+1/+1"]).toBe(1);
            expect(state.players[0].life).toBe(20);
        });
    });

    it("a trigger that never placed a counter is not training", () => {
        withDefs(() => {
            const reactor = mine(TRAINED_REACTOR, "reactor");
            const state = combat([reactor, mine(PARTNER, "partner")]);
            emitAttackersDeclaredEvents(state);
            removePermanentTo(state, reactor.id, "graveyard");
            resolveStack(state);
            expect(state.players[0].life).toBe(20);
        });
    });
});
