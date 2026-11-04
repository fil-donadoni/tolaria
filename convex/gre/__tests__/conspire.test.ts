// Conspire — CR 702.78 (issue #4012).
//
// CR 702.78a: "'Conspire' means 'As an additional cost to cast this spell, you
// may tap two untapped creatures you control that each share a color with it'
// and 'When you cast this spell, if its conspire cost was paid, copy it. If the
// spell has any targets, you may choose new targets for the copy.'"
// CR 702.78b: each instance is paid separately and triggers on its own payment.
//
// The shared cast-copy machinery is proved by `storm.test.ts` and
// `replicate.test.ts`; this file proves the tap leg, its colour clause, its
// interplay with mana payment, and the trigger's count, through the real commit
// path (`finalizeTargetSelection`, `selectSacrificeOnState`).
import { describe, it, expect } from "vitest";
import {
    autoTapForPayment,
    finalizeTargetSelection,
    selectSacrificeOnState,
    tapForPayment,
} from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
} from "../state";
import {
    canPayKickerLegs,
    kickedCountOfPayments,
    resolveKickerPayments,
    additionalCostPaidCount,
} from "../kicker";
import { tryAutoCommitPendingCast } from "../activation";
import { applySacrificeSelection } from "../sacrificeChoice";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { conspireCost } from "../../cards/abilities/conspire";
import { getCardByName, registerTokenDefinition } from "../../cards";
import type { Id } from "../../_generated/dataModel";
import { withTemporaryDefinition } from "../../cards/registry";
import { lightningBolt } from "../../cards/sets/lea/index.cards";
import type { CardDefinition, ManaCost } from "../../cards/types";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";

const GAME_ID = "game-1" as Id<"games">;
type TapArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string }[];
};
type AutoTapArgs = { gameId: Id<"games">; playerId: string };

const SPELL_ID = "spell";
const RED_CREATURE = getCardByName("Hill Giant").id;
const GREEN_CREATURE = getCardByName("Grizzly Bears").id;
const SWAMP = getCardByName("Swamp").id;
const DROUGHT = getCardByName("Drought").id;

function conspireSpell(manaCost: ManaCost): CardDefinition {
    return {
        ...lightningBolt(),
        id: "conspire-spell",
        name: "Conspire Spell",
        manaCost,
        staticAbilities: ["conspire"],
        kickers: [conspireCost()],
    };
}

function creature(
    id: string,
    cardId: string,
    over?: Partial<CardInstanceState>
) {
    return makeInstance(cardId, {
        id,
        zone: "battlefield",
        controllerId: "p1",
        ownerId: "p1",
        ...over,
    });
}

function board(
    def: CardDefinition,
    battlefield: CardInstanceState[]
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(def.id, {
                        id: SPELL_ID,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield,
                manaPool: { W: 1, U: 1, B: 1, R: 1, G: 1, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
}

function cast(state: GameState, payments?: Record<string, number>) {
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: SPELL_ID,
        targetType: "any",
        count: 1,
        selected: [{ type: "player", id: "p2" }],
        ...(payments ? { kickerPayments: payments } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
}

function pick(state: GameState, id: string) {
    selectSacrificeOnState(state, { playerId: "p1", cardInstanceId: id });
}

const triggers = (state: GameState) =>
    state.stack.filter((s) => s.triggeredAbilityId === "conspire");
/** Resolves the trigger to completion, keeping the copy's inherited target. */
function resolveKeepingTargets(state: GameState): void {
    let guard = 0;
    while (triggers(state).length > 0 && guard++ < 8) {
        resolveTopOfStack(state);
        if (state.pendingTarget?.kind === "copy-retarget") {
            state.pendingTarget = undefined;
        }
    }
    expect(guard, "the conspire trigger never finished").toBeLessThan(8);
}
const tapped = (state: GameState, id: string) =>
    state.players[0].battlefield.find((c) => c.id === id)?.isTapped;

describe("Conspire — the cost half (CR 702.78a)", () => {
    const def = conspireSpell({ R: 1 });

    it("is optional and paid at most once", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, []);
            cast(state);
            expect(state.stack.some((s) => s.id === SPELL_ID)).toBe(true);
            expect(triggers(state)).toHaveLength(0);
            expect(() => resolveKickerPayments(def, { conspire: 2 })).toThrow();
        }));

    it("needs two untapped creatures that each share a colour", () =>
        withTemporaryDefinition(def, () => {
            const payable = (battlefield: CardInstanceState[]) => {
                const state = board(def, battlefield);
                return canPayKickerLegs(
                    state,
                    state.players[0],
                    def,
                    { conspire: 1 },
                    SPELL_ID,
                    state.players[0].hand[0]
                );
            };
            const red = (id: string, over?: Partial<CardInstanceState>) =>
                creature(id, RED_CREATURE, over);
            expect(payable([red("a"), red("b")])).toBe(true);
            expect(payable([red("a")])).toBe(false);
            expect(payable([red("a"), creature("b", GREEN_CREATURE)])).toBe(
                false
            );
            expect(payable([red("a"), red("b", { isTapped: true })])).toBe(
                false
            );
        }));

    it("reads a hybrid spell's colours: either half shares (CR 105.2)", () => {
        const hybrid = conspireSpell({ hybrid: [["R", "G"]] });
        withTemporaryDefinition(hybrid, () => {
            const state = board(hybrid, [
                creature("a", RED_CREATURE),
                creature("b", GREEN_CREATURE),
            ]);
            expect(
                canPayKickerLegs(
                    state,
                    state.players[0],
                    hybrid,
                    { conspire: 1 },
                    SPELL_ID,
                    state.players[0].hand[0]
                )
            ).toBe(true);
        });
    });

    it("a colourless spell shares no colour, so it cannot be paid (CR 105.2c)", () => {
        const colourless = conspireSpell({ X: 1 });
        withTemporaryDefinition(colourless, () => {
            const state = board(colourless, [
                creature("a", RED_CREATURE),
                creature("b", GREEN_CREATURE),
            ]);
            expect(
                canPayKickerLegs(
                    state,
                    state.players[0],
                    colourless,
                    { conspire: 1 },
                    SPELL_ID,
                    state.players[0].hand[0]
                )
            ).toBe(false);
        });
    });

    it("the caster picks which creatures, and only legal ones", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, [
                creature("a", RED_CREATURE),
                creature("b", RED_CREATURE),
                creature("c", RED_CREATURE),
                creature("g", GREEN_CREATURE),
            ]);
            cast(state, { conspire: 1 });
            const parked = state.pendingCast;
            expect(parked?.sacrificeSelection?.requirements[0]?.count).toBe(2);
            expect(() => pick(state, "g")).toThrow();
            pick(state, "a");
            expect(tapped(state, "a")).toBe(false);
            pick(state, "c");
            expect(state.pendingCast).toBeFalsy();
            expect(tapped(state, "a")).toBe(true);
            expect(tapped(state, "c")).toBe(true);
            expect(tapped(state, "b")).toBe(false);
            expect(state.players[0].battlefield).toHaveLength(4);
        }));

    it("tapping for the cost announces PERMANENT_TAPPED (CR 701.26a)", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, [
                creature("a", RED_CREATURE),
                creature("b", RED_CREATURE),
            ]);
            state.pendingEvents = [];
            applySacrificeSelection(state, {
                playerId: "p1",
                reason: "Conspire",
                requirements: [
                    {
                        filter: { types: ["Creature"] },
                        count: 2,
                        action: "tap",
                    },
                ],
                picked: ["a", "b"],
            });
            const events = (state.pendingEvents ?? []).filter(
                (e) => e.type === "PERMANENT_TAPPED"
            );
            expect(events).toHaveLength(2);
            expect(state.players[0].battlefield).toHaveLength(2);
        }));

    it("is not a kick (CR 702.33d)", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, [
                creature("a", RED_CREATURE),
                creature("b", RED_CREATURE),
            ]);
            cast(state, { conspire: 1 });
            pick(state, "a");
            pick(state, "b");
            const spell = state.stack.find((s) => s.id === SPELL_ID)!;
            expect(spell.kickerPayments).toBeUndefined();
            expect(additionalCostPaidCount(spell, "conspire")).toBe(1);
            expect(kickedCountOfPayments(def, { conspire: 1 })).toBe(0);
        }));

    it("a picked creature that has become tapped makes the commit stale (CR 601.2h)", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, [
                creature("a", RED_CREATURE),
                creature("b", RED_CREATURE),
            ]);
            state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            cast(state, { conspire: 1 });
            pick(state, "a");
            pick(state, "b");
            // Mana is still owed, so the cast is parked with both picks made.
            expect(state.pendingCast).toBeTruthy();
            const a = state.players[0].battlefield.find((c) => c.id === "a")!;
            a.isTapped = true;
            state.players[0].manaPool.R = 1;
            // Re-attempts the parked commit the way a paid mana tap does.
            tryAutoCommitPendingCast(state, "p1");
            expect(state.stack.some((s) => s.id === SPELL_ID)).toBe(false);
        }));
});

describe("Conspire — from another zone (CR 601.3)", () => {
    const def = conspireSpell({ R: 1 });

    it("reads the colours of the card being cast, wherever it is", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, [
                creature("a", RED_CREATURE),
                creature("b", RED_CREATURE),
            ]);
            const fromLibrary = makeInstance(def.id, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            state.players[0].library = [fromLibrary];
            expect(
                canPayKickerLegs(
                    state,
                    state.players[0],
                    def,
                    { conspire: 1 },
                    "top",
                    fromLibrary
                )
            ).toBe(true);
        }));
});

describe("Conspire — beside a sacrifice the cast also owes (CR 601.2f)", () => {
    const def = conspireSpell({ B: 1 });

    it("Drought's tax and the conspire tap are both paid", () =>
        withTemporaryDefinition(def, () => {
            const black = getCardByName("Vampire Nighthawk").id;
            const state = board(def, [
                creature("drought", DROUGHT),
                creature("s1", SWAMP),
                creature("s2", SWAMP),
                creature("a", black),
                creature("b", black),
            ]);
            cast(state, { conspire: 1 });
            const sel = state.pendingCast?.sacrificeSelection;
            expect(sel?.requirements).toHaveLength(2);
            // The fungible Swamp was auto-resolved; the tap leg is the caster's.
            pick(state, "a");
            pick(state, "b");
            const zone = state.players[0];
            expect(
                zone.battlefield.filter((c) => c.card.id === SWAMP)
            ).toHaveLength(1);
            expect(zone.graveyard.some((c) => c.card.id === SWAMP)).toBe(true);
            expect(tapped(state, "a")).toBe(true);
            expect(tapped(state, "b")).toBe(true);
            expect(triggers(state)).toHaveLength(1);
        }));
});

describe("Conspire — the cast-copy trigger (CR 702.78a)", () => {
    const def = conspireSpell({ R: 1 });

    function paid(): GameState {
        const state = board(def, [
            creature("a", RED_CREATURE),
            creature("b", RED_CREATURE),
        ]);
        cast(state, { conspire: 1 });
        pick(state, "a");
        pick(state, "b");
        return state;
    }

    it("copies the spell once, above the spell (CR 405.2)", () =>
        withTemporaryDefinition(def, () => {
            const state = paid();
            const [trigger] = triggers(state);
            expect(trigger, "no conspire trigger was collected").toBeDefined();
            expect(trigger.castCopiesRemaining).toBe(1);
            expect(state.stack[state.stack.length - 1].id).toBe(trigger.id);
            resolveKeepingTargets(state);
            const copies = state.stack.filter((s) => s.isCopy === true);
            expect(copies).toHaveLength(1);
            expect(copies[0].targets).toEqual([{ type: "player", id: "p2" }]);
            expect(triggers(state)).toHaveLength(0);
        }));

    it("offers a new target for the copy (CR 707.10c)", () =>
        withTemporaryDefinition(def, () => {
            const state = paid();
            resolveTopOfStack(state);
            expect(state.pendingTarget?.kind).toBe("copy-retarget");
        }));

    it("still copies a spell countered in response", () =>
        withTemporaryDefinition(def, () => {
            const state = paid();
            state.stack = state.stack.filter((s) => s.id !== SPELL_ID);
            resolveKeepingTargets(state);
            expect(state.stack.filter((s) => s.isCopy === true)).toHaveLength(
                1
            );
        }));

    it("survives persistence and reaches the client (wire format)", () =>
        withTemporaryDefinition(def, () => {
            const state = paid();
            const restored = expandState(compactState(state));
            expect(triggers(restored)[0]?.castCopiesRemaining).toBe(1);
            const view = projectPublicState(state, 1, "p1");
            const onWire = view.stack.find(
                (s) => s.triggeredAbilityId === "conspire"
            );
            expect(onWire?.castCopiesRemaining).toBe(1);
        }));
});

describe("Conspire — several instances (CR 702.78b)", () => {
    const def: CardDefinition = {
        ...conspireSpell({ R: 1 }),
        kickers: [conspireCost(), { ...conspireCost(), id: "conspire-2" }],
    };
    const fourReds = () => [
        creature("a", RED_CREATURE),
        creature("b", RED_CREATURE),
        creature("c", RED_CREATURE),
        creature("d", RED_CREATURE),
    ];

    it("each paid instance triggers on its own payment", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, fourReds());
            cast(state, { conspire: 1, "conspire-2": 1 });
            for (const id of ["a", "b", "c", "d"]) pick(state, id);
            expect(triggers(state)).toHaveLength(2);
            expect(triggers(state).map((t) => t.castCopiesRemaining)).toEqual([
                1, 1,
            ]);
        }));

    it("an unpaid instance puts nothing on the stack (CR 603.4)", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, fourReds());
            cast(state, { "conspire-2": 1 });
            pick(state, "a");
            pick(state, "b");
            expect(triggers(state)).toHaveLength(1);
        }));

    it("two instances cannot share creatures (CR 702.78b)", () =>
        withTemporaryDefinition(def, () => {
            const state = board(def, fourReds().slice(0, 3));
            expect(
                canPayKickerLegs(
                    state,
                    state.players[0],
                    def,
                    { conspire: 1, "conspire-2": 1 },
                    SPELL_ID,
                    state.players[0].hand[0]
                )
            ).toBe(false);
        }));
});

describe("Conspire — a picked creature is spoken for (CR 702.78a / 601.2h)", () => {
    // Registered, not temporary: a mutation handler outlives the synchronous
    // scope `withTemporaryDefinition` restores at.
    const def = { ...conspireSpell({ G: 1 }), id: "conspire-spell-green" };
    registerTokenDefinition(def);
    const elves = () => getCardByName("Llanowar Elves").id;
    const forest = () => getCardByName("Forest").id;

    /** A green cast with both picks made and {G} still owed. */
    function parked(): GameState {
        const state = board(def, [
            creature("e1", elves()),
            creature("e2", elves()),
            creature("e3", elves()),
            creature("f", forest()),
        ]);
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        cast(state, { conspire: 1 });
        pick(state, "e1");
        pick(state, "e2");
        expect(state.pendingCast, "the cast should still owe {G}").toBeTruthy();
        return state;
    }

    it("tapForPayment refuses it, and takes another source", async () => {
        const state = parked();
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        const tap = (cardInstanceId: string) =>
            runMutation<TapArgs, void>(
                tapForPayment as unknown as Handler<TapArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    payments: [{ cardInstanceId }],
                }
            );
        await expect(tap("e1")).rejects.toThrow(
            "That permanent is already paying this cost"
        );
        await tap("f");
        const after = stub.state();
        expect(after.pendingCast).toBeFalsy();
        const onBoard = after.players[0].battlefield;
        expect(onBoard.find((c) => c.id === "e1")?.isTapped).toBe(true);
        expect(triggers(after)).toHaveLength(1);
    });

    it("tapForPayment refuses a candidate the caster has yet to name", async () => {
        const state = board(def, [
            creature("e1", elves()),
            creature("e2", elves()),
            creature("f", forest()),
        ]);
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        cast(state, { conspire: 1 });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runMutation<TapArgs, void>(
                tapForPayment as unknown as Handler<TapArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    payments: [{ cardInstanceId: "e1" }],
                }
            )
        ).rejects.toThrow("That permanent is already paying this cost");
    });

    it("autoTapForPayment plans around it", async () => {
        const state = parked();
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<AutoTapArgs, void>(
            autoTapForPayment as unknown as Handler<AutoTapArgs, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );
        const after = stub.state();
        expect(after.pendingCast).toBeFalsy();
        expect(after.stack.some((s) => s.id === SPELL_ID)).toBe(true);
        expect(triggers(after)).toHaveLength(1);
    });
});
