// Enlist (CR 702.154, issue #4009).
//
// CR 702.154a — "As this creature attacks, you may tap up to one untapped
// creature you control that you didn't choose to attack with and that either has
// haste or has been under your control continuously since this turn began. When
// you do, this creature gets +X/+0 until end of turn, where X is the tapped
// creature's power."
// CR 702.154d — multiple instances function independently, each trigger firing
// only for its own cost.
//
// Every board goes through the production path: `emitAttackersDeclaredEvents`
// pays the cost, the scan puts the trigger on the stack, `resolveTopOfStack`
// resolves it.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    ENLIST_TRIGGER,
    ENLIST_TRIGGER_ID,
    enlistAssignments,
    enlistCandidates,
    enlistInstanceCount,
    type EnlistPair,
} from "../../cards/abilities/enlist";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateAbilityEffectScript } from "../effects/validate";
import {
    isLegalEnlistChoice,
    payDeclaredEnlistCosts,
    pruneEnlistChoices,
    toggleEnlistChoice,
} from "../enlist";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { emitAttackersDeclaredEvents } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const ENLISTER: CardDefinition = {
    id: "test-only-enlister",
    rarity: "common",
    name: "Test Enlister",
    oracleText: "Enlist",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["enlist"],
};

const PARTNER: CardDefinition = {
    id: "test-only-partner",
    rarity: "common",
    name: "Test Partner",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 3,
    toughness: 3,
};

const NON_CREATURE: CardDefinition = {
    id: "test-only-artifact",
    rarity: "common",
    name: "Test Artifact",
    oracleText: "",
    manaCost: { X: 1 },
    types: ["Artifact"],
    subtypes: [],
};

function withDefs(run: () => void): void {
    withTemporaryDefinition(ENLISTER, () =>
        withTemporaryDefinition(PARTNER, () =>
            withTemporaryDefinition(NON_CREATURE, run)
        )
    );
}

function enlister(
    id = "attacker",
    over: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(ENLISTER.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...over,
    });
}

function partner(
    id = "partner",
    over: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(PARTNER.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...over,
    });
}

/** A declaration being locked in, as `finalizeConfirmAttackers` leaves it just
 *  before it calls `emitAttackersDeclaredEvents`. */
function declared(
    attackers: CardInstanceState[],
    others: CardInstanceState[],
    enlists: EnlistPair[]
): GameState {
    for (const a of attackers) {
        a.isTapped = true;
        a.isAttacking = true;
    }
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [...attackers, ...others] }),
            makePlayer("p2", { battlefield: [] }),
        ],
        combat: {
            attackerIds: attackers.map((a) => a.id),
            enlists,
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

/** The selection still open, nothing tapped yet. */
function open(
    attackers: CardInstanceState[],
    others: CardInstanceState[]
): GameState {
    const state = declared(attackers, others, []);
    state.combat = { ...state.combat!, enlists: undefined, confirmed: false };
    for (const a of attackers) a.isTapped = false;
    return state;
}

function pairOf(attackerId = "attacker", enlistedId = "partner"): EnlistPair {
    return { attackerId, enlistedId };
}

describe("enlist pays its cost as the attack is declared (CR 702.154a, 508.1g)", () => {
    it("taps the partner and pumps the attacker by its power, once the trigger resolves", () => {
        withDefs(() => {
            const attacker = enlister();
            const tapped = partner();
            const state = declared([attacker], [tapped], [pairOf()]);

            emitAttackersDeclaredEvents(state);

            expect(tapped.isTapped).toBe(true);
            // CR 603.3 — a real trigger: on the stack, and no pump until it resolves.
            expect(state.stack.map((i) => i.triggeredAbilityId)).toEqual([
                ENLIST_TRIGGER_ID,
            ]);
            expect(getEffectivePower(state, attacker)).toBe(2);

            resolveTopOfStack(state);

            expect(getEffectivePower(state, attacker)).toBe(5);
            // "+X/+0".
            expect(getEffectiveToughness(state, attacker)).toBe(2);
        });
    });

    it("a declaration that declines taps nothing and fires nothing", () => {
        withDefs(() => {
            const tapped = partner();
            const state = declared([enlister()], [tapped], []);

            emitAttackersDeclaredEvents(state);

            expect(tapped.isTapped).toBe(false);
            expect(state.stack).toEqual([]);
        });
    });

    it("the partner's tap joins the declaration's trigger batch (CR 603.3b)", () => {
        withDefs(() => {
            const state = declared([enlister()], [partner()], [pairOf()]);

            emitAttackersDeclaredEvents(state);

            expect(
                (state.pendingEvents ?? []).filter(
                    (e) => e.type === "PERMANENT_TAPPED"
                )
            ).toEqual([]);
        });
    });

    it("a tap that does not happen pays nothing and fires no 'when you do'", () => {
        withDefs(() => {
            const attacker = enlister();
            const state = declared(
                [attacker],
                [partner("partner", { isTapped: true })],
                [pairOf()]
            );

            emitAttackersDeclaredEvents(state);

            expect(state.stack).toEqual([]);
            expect(state.combat?.enlists).toBeUndefined();
        });
    });

    it("a cost is never paid for a creature no longer attacking", () => {
        withDefs(() => {
            const state = declared(
                [enlister("other")],
                [enlister(), partner()],
                [pairOf()]
            );

            expect(payDeclaredEnlistCosts(state)).toEqual([]);
        });
    });
});

describe("who can be tapped (CR 702.154a, 702.154c)", () => {
    const candidateIds = (cards: CardInstanceState[], attackerIds: string[]) =>
        enlistCandidates(cards, attackerIds).map((c) => c.id);

    it("an untapped creature, free of summoning sickness, not chosen to attack", () => {
        withDefs(() => {
            expect(candidateIds([partner()], [])).toEqual(["partner"]);
        });
    });

    it("not a tapped creature", () => {
        withDefs(() => {
            expect(
                candidateIds([partner("p", { isTapped: true })], [])
            ).toEqual([]);
        });
    });

    it("not a creature with summoning sickness, unless it has haste", () => {
        withDefs(() => {
            expect(
                candidateIds([partner("p", { isSummoningSick: true })], [])
            ).toEqual([]);
            expect(
                candidateIds(
                    [
                        partner("p", {
                            isSummoningSick: true,
                            staticAbilities: ["haste"],
                        }),
                    ],
                    []
                )
            ).toEqual(["p"]);
        });
    });

    it("not a creature chosen to attack, so never the attacker itself (CR 702.154c)", () => {
        withDefs(() => {
            expect(candidateIds([partner("p")], ["p"])).toEqual([]);
            const state = open([enlister()], []);
            expect(isLegalEnlistChoice(state, "attacker", "attacker")).toBe(
                false
            );
        });
    });

    it("not a noncreature permanent", () => {
        withDefs(() => {
            const artifact = makeInstance(NON_CREATURE.id, {
                id: "a",
                isSummoningSick: false,
            });
            expect(candidateIds([artifact], [])).toEqual([]);
        });
    });

    it("not an opponent's creature: the offer reads the attacker's own battlefield", () => {
        withDefs(() => {
            const state = open([enlister()], []);
            state.players[1].battlefield.push(
                partner("theirs", { controllerId: "p2", ownerId: "p2" })
            );
            expect(isLegalEnlistChoice(state, "attacker", "theirs")).toBe(
                false
            );
        });
    });

    it("an attacker without enlist offers nothing", () => {
        withDefs(() => {
            const state = open([partner("plain")], [partner()]);
            expect(isLegalEnlistChoice(state, "plain", "partner")).toBe(false);
        });
    });
});

describe("X is the tapped creature's power as the trigger resolves (CR 608.2h)", () => {
    function onStack(): {
        state: GameState;
        attacker: CardInstanceState;
        tapped: CardInstanceState;
    } {
        const attacker = enlister();
        const tapped = partner();
        const state = declared([attacker], [tapped], [pairOf()]);
        emitAttackersDeclaredEvents(state);
        return { state, attacker, tapped };
    }

    it("reads a pump the partner got in response", () => {
        withDefs(() => {
            const { state, attacker, tapped } = onStack();
            buildSpellContext(state, state.stack[0]).addTemporaryPTBuff(
                { type: "permanent", id: tapped.id, playerId: "p1" },
                2,
                0,
                { phase: "end-of-turn" }
            );

            resolveTopOfStack(state);

            expect(getEffectivePower(state, attacker)).toBe(7);
        });
    });

    it("reads last known power once the partner has left, pump included", () => {
        withDefs(() => {
            const { state, attacker, tapped } = onStack();
            buildSpellContext(state, state.stack[0]).addTemporaryPTBuff(
                { type: "permanent", id: tapped.id, playerId: "p1" },
                2,
                0,
                { phase: "end-of-turn" }
            );
            removePermanentTo(state, tapped.id, "graveyard");

            resolveTopOfStack(state);

            expect(getEffectivePower(state, attacker)).toBe(7);
        });
    });

    it("a partner with negative power gives +0, never a shrink (CR 107.1b)", () => {
        withDefs(() => {
            const { state, attacker, tapped } = onStack();
            buildSpellContext(state, state.stack[0]).addTemporaryPTBuff(
                { type: "permanent", id: tapped.id, playerId: "p1" },
                -5,
                0,
                { phase: "end-of-turn" }
            );

            resolveTopOfStack(state);

            expect(getEffectivePower(state, attacker)).toBe(2);
        });
    });

    it("does nothing when the attacker has left in response (CR 608.2b)", () => {
        withDefs(() => {
            const { state, attacker } = onStack();
            removePermanentTo(state, attacker.id, "graveyard");

            expect(() => resolveTopOfStack(state)).not.toThrow();
            expect(state.stack).toEqual([]);
        });
    });
});

describe("instances function independently (CR 702.154d)", () => {
    it("two instances tap two creatures and fire two triggers, one per cost", () => {
        withDefs(() => {
            const attacker = enlister("attacker", {
                staticAbilities: ["enlist", "enlist"],
            });
            const state = declared(
                [attacker],
                [partner("a"), partner("b")],
                [pairOf("attacker", "a"), pairOf("attacker", "b")]
            );

            emitAttackersDeclaredEvents(state);
            resolveTriggerOrder(state);

            expect(
                state.stack.filter(
                    (i) => i.triggeredAbilityId === ENLIST_TRIGGER_ID
                )
            ).toHaveLength(2);
            resolveTopOfStack(state);
            resolveTopOfStack(state);
            expect(getEffectivePower(state, attacker)).toBe(8);
        });
    });

    it("two instances with one cost paid fire ONE trigger", () => {
        withDefs(() => {
            const attacker = enlister("attacker", {
                staticAbilities: ["enlist", "enlist"],
            });
            const state = declared(
                [attacker],
                [partner()],
                [pairOf("attacker", "partner")]
            );

            emitAttackersDeclaredEvents(state);

            expect(state.stack).toHaveLength(1);
        });
    });

    it("one instance pays one cost, however many were chosen", () => {
        withDefs(() => {
            const a = partner("a");
            const b = partner("b");
            const state = declared(
                [enlister()],
                [a, b],
                [pairOf("attacker", "a"), pairOf("attacker", "b")]
            );

            emitAttackersDeclaredEvents(state);

            expect([a.isTapped, b.isTapped]).toEqual([true, false]);
            expect(state.combat?.enlists).toEqual([pairOf("attacker", "a")]);
        });
    });

    it("one creature can't pay two attackers' costs: only an untapped one can tap (CR 701.26a)", () => {
        withDefs(() => {
            const state = declared(
                [enlister("x"), enlister("y")],
                [partner()],
                [pairOf("x", "partner"), pairOf("y", "partner")]
            );

            expect(payDeclaredEnlistCosts(state)).toHaveLength(1);
        });
    });

    it("counts instances from the live multiset", () => {
        expect(enlistInstanceCount(undefined)).toBe(0);
        expect(enlistInstanceCount(["flying"])).toBe(0);
        expect(enlistInstanceCount(["enlist", "flying", "enlist"])).toBe(2);
    });
});

describe("enlist reaches a permanent through the live keyword list", () => {
    it("a granted instance fires", () => {
        withDefs(() => {
            const attacker = partner("attacker", {
                staticAbilities: ["enlist"],
            });
            const state = declared(
                [attacker],
                [partner("other")],
                [pairOf("attacker", "other")]
            );

            emitAttackersDeclaredEvents(state);

            expect(state.stack).toHaveLength(1);
        });
    });

    it("a creature that lost it pays nothing (CR 613.1f)", () => {
        withDefs(() => {
            const attacker = enlister("attacker", { staticAbilities: [] });
            const tapped = partner();
            const state = declared([attacker], [tapped], [pairOf()]);

            emitAttackersDeclaredEvents(state);

            expect(tapped.isTapped).toBe(false);
            expect(state.stack).toEqual([]);
        });
    });
});

describe("the choice while attackers are open (CR 508.1g)", () => {
    it("chooses, then withdraws", () => {
        withDefs(() => {
            const state = open([enlister()], [partner()]);
            toggleEnlistChoice(state, "attacker", "partner");
            expect(state.combat?.enlists).toEqual([pairOf()]);
            toggleEnlistChoice(state, "attacker", "partner");
            expect(state.combat?.enlists).toBeUndefined();
        });
    });

    it("a second partner on a single instance swaps", () => {
        withDefs(() => {
            const state = open([enlister()], [partner("a"), partner("b")]);
            toggleEnlistChoice(state, "attacker", "a");
            toggleEnlistChoice(state, "attacker", "b");
            expect(state.combat?.enlists).toEqual([pairOf("attacker", "b")]);
        });
    });

    it("two instances hold two partners", () => {
        withDefs(() => {
            const state = open(
                [
                    enlister("attacker", {
                        staticAbilities: ["enlist", "enlist"],
                    }),
                ],
                [partner("a"), partner("b")]
            );
            toggleEnlistChoice(state, "attacker", "a");
            toggleEnlistChoice(state, "attacker", "b");
            expect(state.combat?.enlists).toEqual([
                pairOf("attacker", "a"),
                pairOf("attacker", "b"),
            ]);
        });
    });

    it("a partner another attacker holds moves", () => {
        withDefs(() => {
            const state = open([enlister("x"), enlister("y")], [partner()]);
            toggleEnlistChoice(state, "x", "partner");
            toggleEnlistChoice(state, "y", "partner");
            expect(state.combat?.enlists).toEqual([pairOf("y", "partner")]);
        });
    });

    it("refuses a creature that can't pay", () => {
        withDefs(() => {
            const state = open(
                [enlister()],
                [partner("sick", { isSummoningSick: true })]
            );
            expect(() => toggleEnlistChoice(state, "attacker", "sick")).toThrow(
                /can't be tapped to enlist/
            );
            expect(state.combat?.enlists).toBeUndefined();
        });
    });

    it("refuses once the declaration is locked in", () => {
        withDefs(() => {
            const state = declared([enlister()], [partner()], []);
            expect(isLegalEnlistChoice(state, "attacker", "partner")).toBe(
                false
            );
        });
    });

    it("prunes a withdrawn attacker's choice and a partner now attacking", () => {
        withDefs(() => {
            const state = open([enlister("x"), enlister("y")], []);
            const combat = state.combat!;
            combat.enlists = [pairOf("gone", "a"), pairOf("x", "y")];
            pruneEnlistChoices(combat);
            expect(combat.enlists).toBeUndefined();
        });
    });
});

describe("enlistAssignments (CR 508.1g)", () => {
    it("leaves out the all-declines answer", () => {
        expect(enlistAssignments(["x"], ["a", "b"])).toEqual([
            [pairOf("x", "a")],
            [pairOf("x", "b")],
        ]);
    });

    it("never spends one partner on two costs", () => {
        const answers = enlistAssignments(["x", "y"], ["a"]);
        for (const pairs of answers) {
            expect(new Set(pairs.map((p) => p.enlistedId)).size).toBe(
                pairs.length
            );
        }
        expect(answers).toHaveLength(2);
    });

    it("two slots of one attacker are one choice in either order", () => {
        expect(enlistAssignments(["x", "x"], ["a", "b"])).toEqual([
            [pairOf("x", "a")],
            [pairOf("x", "a"), pairOf("x", "b")],
            [pairOf("x", "b")],
        ]);
    });
});

describe("enlist survives the wire and the snapshot", () => {
    it("the DSL script validates at its trigger site", () => {
        expect(
            validateAbilityEffectScript(
                ENLIST_TRIGGER,
                "Enlist",
                "CREATURE_ENLISTED"
            )
        ).toEqual([]);
    });

    it("the choice and the keyword cross projectPublicState (CR 508.1g)", () => {
        withDefs(() => {
            const state = open([enlister()], [partner()]);
            toggleEnlistChoice(state, "attacker", "partner");

            const view = projectPublicState(state, 1, "p1");

            expect(view.combat?.enlists).toEqual([pairOf()]);
            expect(
                view.players[0].battlefield.find((c) => c.id === "attacker")
                    ?.staticAbilities
            ).toContain("enlist");
        });
    });

    it("a trigger on the stack resolves after a save and load", () => {
        withDefs(() => {
            const state = declared([enlister()], [partner()], [pairOf()]);
            emitAttackersDeclaredEvents(state);

            const loaded = expandState(compactState(state));
            resolveTopOfStack(loaded);

            const attacker = loaded.players[0].battlefield.find(
                (c) => c.id === "attacker"
            )!;
            expect(getEffectivePower(loaded, attacker)).toBe(5);
            expect(loaded.combat?.enlists).toEqual([pairOf()]);
        });
    });
});
