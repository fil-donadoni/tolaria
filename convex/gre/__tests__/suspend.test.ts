// Suspend (CR 702.62, issue #10495) — the keyword's three abilities across every
// surface they cross:
//   - GRE unit: the special action's window (702.62a / 116.2f) and its "could
//     begin to cast" check (702.62c), the suspended state (702.62b), the
//     exile-zone upkeep tick, the free play when the LAST time counter is
//     removed — however it leaves — and its decline (702.62a, 702.62d), the
//     haste rider until control is lost (702.62a, 611.2b).
//   - Integration: the `suspendCard` mutation through its own handler.
//   - Wire format: the hand card's `canSuspend` and the suspended card in exile
//     (face up, `suspended`, `counters.time`) through `projectPublicState`.
//   - Serialization: the haste rider on a stack item survives the round trip.
import { describe, expect, it } from "vitest";
import {
    getCardByName,
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { suspendCard } from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { projectPublicState } from "../../gameProjections";
import { enumerateMoves } from "../moves";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import {
    applySuspend,
    canSuspend,
    isSuspendedCard,
    suspendableHandCards,
} from "../suspend";
import { collectTriggers } from "../triggers";
import {
    buildSpellContext,
    getPlayer,
    recomputeContinuousEffects,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const MOUNTAIN = getCardByName("Mountain").id;
const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;

/** Suspend 2—{R}: a sorcery that gains its caster 3 life. */
const SORCERY: CardDefinition = {
    id: "test-suspend-sorcery",
    name: "Test Suspend Sorcery",
    rarity: "common",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    staticAbilities: ["suspend 2"],
    suspend: { R: 1 },
    effects: [{ op: "gainLife", player: "controller", amount: 3 }],
};

/** Suspend 1—{U}: an instant with the same body. */
const INSTANT: CardDefinition = {
    ...SORCERY,
    id: "test-suspend-instant",
    name: "Test Suspend Instant",
    types: ["Instant"],
    staticAbilities: ["suspend 1"],
    suspend: { U: 1 },
};

/** Suspend 1—{G}: a 2/2 creature, for the haste rider. */
const CREATURE: CardDefinition = {
    id: "test-suspend-creature",
    name: "Test Suspend Creature",
    rarity: "common",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 2,
    toughness: 2,
    staticAbilities: ["suspend 1"],
    suspend: { G: 1 },
};

/** Suspend 3—{R}, NO mana cost (Living End's shape, CR 118.6). */
const NO_COST: CardDefinition = {
    ...SORCERY,
    id: "test-suspend-no-cost",
    name: "Test Suspend No Cost",
    manaCost: undefined,
    staticAbilities: ["suspend 3"],
};

function withCards<T>(fn: () => T): T {
    return withTemporaryDefinition(SORCERY, () =>
        withTemporaryDefinition(INSTANT, () =>
            withTemporaryDefinition(CREATURE, () =>
                withTemporaryDefinition(NO_COST, fn)
            )
        )
    );
}

function inst(
    defId: string,
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"],
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: ownerId,
        ownerId,
        zone,
        ...extra,
    });
}

/** p1 in their precombat main, priority, empty stack, holding `handDef` and
 *  one untapped Mountain, Forest and Island. */
function board(handDef: CardDefinition, turn = 3): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [inst(handDef.id, "card", "p1", "hand")],
                battlefield: [
                    inst(MOUNTAIN, "m", "p1", "battlefield"),
                    inst(FOREST, "f", "p1", "battlefield"),
                    inst(ISLAND, "i", "p1", "battlefield"),
                ],
                library: [inst(MOUNTAIN, "lib1", "p1", "library")],
            }),
            makePlayer("p2", {
                library: [inst(MOUNTAIN, "lib2", "p2", "library")],
            }),
        ],
    });
    state.turn = turn;
    return state;
}

const p1 = (state: GameState) => getPlayer(state, "p1");
const handCard = (state: GameState) => p1(state).hand[0];
const exiled = (state: GameState, id = "card") =>
    p1(state).exile.find((c) => c.id === id);

/** A resolving item's `SpellContext` for `controllerId`, without leaving the
 *  item on the stack. */
function effectCtx(state: GameState, controllerId: string) {
    const item = pushSpell(state, SORCERY.id, controllerId);
    state.stack.pop();
    return buildSpellContext(state, item);
}

const UPKEEP = (activePlayerId: string) => ({
    type: "PHASE_BEGIN" as const,
    phase: "UPKEEP" as const,
    activePlayerId,
});

/** Fires `activePlayerId`'s upkeep and resolves the stack until it empties or
 *  a pending choice parks it. */
function runUpkeep(state: GameState, activePlayerId: string): void {
    state.activePlayerId = activePlayerId;
    state.priorityPlayerId = activePlayerId;
    state.phase = "UPKEEP";
    state.stack.push(...collectTriggers(state, [UPKEEP(activePlayerId)]));
    drain(state);
}

function drain(state: GameState): void {
    while (state.stack.length > 0 && !state.pendingChoices?.length) {
        resolveTopOfStack(state);
    }
}

/** Answers the head pending choice with `optionId`, then drains the stack. */
function answer(state: GameState, optionId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [optionId],
    });
    drain(state);
}

describe("Suspend — the special action (CR 702.62a, CR 116.2f)", () => {
    it("pays the cost and exiles the card face up with N time counters, priority kept", () => {
        withCards(() => {
            const state = board(SORCERY);
            expect(canSuspend(state, p1(state), handCard(state))).toBe(true);
            applySuspend(state, "p1", "card");
            const card = exiled(state);
            expect(card?.counters).toEqual({ time: 2 });
            expect(card?.faceDown).toBeUndefined();
            expect(p1(state).hand).toHaveLength(0);
            // CR 702.62a — the suspend cost {R}, not the mana cost {2}{R}.
            expect(
                p1(state)
                    .battlefield.filter((l) => l.isTapped)
                    .map((l) => l.id)
            ).toEqual(["m"]);
            // CR 116.3 — "this action doesn't use the stack"; priority stays.
            expect(state.stack).toHaveLength(0);
            expect(state.priorityPlayerId).toBe("p1");
        });
    });

    it("is refused when the cost cannot be paid", () => {
        withCards(() => {
            const state = board(SORCERY);
            p1(state).battlefield.find((l) => l.id === "m")!.isTapped = true;
            expect(canSuspend(state, p1(state), handCard(state))).toBe(false);
            expect(() => applySuspend(state, "p1", "card")).toThrow();
        });
    });

    it("needs no castable mana cost: a card with none suspends (CR 601.2a, 118.6)", () => {
        withCards(() => {
            const state = board(NO_COST);
            expect(canSuspend(state, p1(state), handCard(state))).toBe(true);
            applySuspend(state, "p1", "card");
            expect(exiled(state)?.counters).toEqual({ time: 3 });
        });
    });

    it("a card without suspend offers no action", () => {
        withCards(() => {
            const state = board(SORCERY);
            p1(state).hand = [
                inst(getCardByName("Lightning Bolt").id, "bolt", "p1", "hand"),
            ];
            expect(suspendableHandCards(state, p1(state))).toEqual([]);
        });
    });
});

describe('Suspend — "if you could begin to cast this card" (CR 702.62c)', () => {
    it("a sorcery suspends only in its owner's sorcery window", () => {
        withCards(() => {
            const state = board(SORCERY);
            state.stack.push({
                ...inst(SORCERY.id, "other", "p2", "stack"),
                castById: "p2",
            } as never);
            expect(canSuspend(state, p1(state), handCard(state))).toBe(false);
            state.stack = [];
            state.activePlayerId = "p2";
            expect(canSuspend(state, p1(state), handCard(state))).toBe(false);
        });
    });

    it("an instant suspends at instant speed — on the opponent's turn with priority", () => {
        withCards(() => {
            const state = board(INSTANT);
            state.activePlayerId = "p2";
            state.phase = "END_STEP";
            expect(canSuspend(state, p1(state), handCard(state))).toBe(true);
            // Without priority, no special action (CR 116.2f).
            state.priorityPlayerId = "p2";
            expect(canSuspend(state, p1(state), handCard(state))).toBe(false);
        });
    });

    it("a cast prohibition forbids it: a player who can't cast spells can't suspend", () => {
        withCards(() => {
            const state = board(INSTANT);
            state.cannotCastSpellsThisTurn = [{ playerId: "p1" }];
            expect(canSuspend(state, p1(state), handCard(state))).toBe(false);
        });
    });
});

describe("Suspend — suspended and the upkeep tick (CR 702.62a/b)", () => {
    it("a suspended card is exile + suspend + a time counter; the wire says so to both players", () => {
        withCards(() => {
            const state = board(SORCERY);
            applySuspend(state, "p1", "card");
            expect(isSuspendedCard(exiled(state)!)).toBe(true);
            for (const viewer of ["p1", "p2"]) {
                const card = projectPublicState(state, 1, viewer).players[0]
                    .exile[0];
                expect(card).toMatchObject({
                    id: "card",
                    suspended: true,
                    counters: { time: 2 },
                });
            }
            // CR 702.62b — no time counter, not suspended.
            exiled(state)!.counters = undefined;
            expect(isSuspendedCard(exiled(state)!)).toBe(false);
            const card = projectPublicState(state, 1, "p1").players[0].exile[0];
            expect(card.suspended).toBeUndefined();
        });
    });

    it("the upkeep trigger fires from exile on its owner's upkeep only, and ticks one counter", () => {
        withCards(() => {
            const state = board(SORCERY);
            applySuspend(state, "p1", "card");
            expect(collectTriggers(state, [UPKEEP("p2")])).toHaveLength(0);
            const mine = collectTriggers(state, [UPKEEP("p1")]);
            expect(mine.map((t) => t.triggeredAbilityId)).toEqual([
                "suspend-upkeep",
            ]);
            runUpkeep(state, "p1");
            expect(exiled(state)?.counters).toEqual({ time: 1 });
            expect(state.pendingChoices ?? []).toHaveLength(0);
        });
    });

    it("a card exiled with suspend but no time counter is not suspended: no tick (CR 603.4)", () => {
        withCards(() => {
            const state = board(SORCERY);
            applySuspend(state, "p1", "card");
            exiled(state)!.counters = undefined;
            expect(collectTriggers(state, [UPKEEP("p1")])).toHaveLength(0);
        });
    });
});

describe("Suspend — the last time counter (CR 702.62a/d)", () => {
    it("removing the last counter offers the play; accepting casts it free from exile and it resolves", () => {
        withCards(() => {
            const state = board(SORCERY);
            applySuspend(state, "p1", "card");
            runUpkeep(state, "p1");
            for (const l of p1(state).battlefield) l.isTapped = false;
            runUpkeep(state, "p1");
            const offer = state.pendingChoices?.[0];
            expect(offer).toMatchObject({ playerId: "p1" });
            expect(offer?.options?.map((o) => o.id)).toEqual([
                "cast",
                "decline",
            ]);
            const life = p1(state).life;
            answer(state, "cast");
            // CR 702.62d / 601.2b — suspend's free cast pays no mana cost.
            expect(p1(state).battlefield.every((l) => !l.isTapped)).toBe(true);
            expect(p1(state).life).toBe(life + 3);
            expect(exiled(state)).toBeUndefined();
            expect(p1(state).graveyard.map((c) => c.id)).toEqual(["card"]);
        });
    });

    it('declining leaves it exiled with no counter — "it remains exiled", no longer suspended', () => {
        withCards(() => {
            const state = board(INSTANT);
            applySuspend(state, "p1", "card");
            runUpkeep(state, "p1");
            answer(state, "decline");
            const card = exiled(state);
            expect(card).toBeDefined();
            expect(isSuspendedCard(card!)).toBe(false);
            expect(state.stack).toHaveLength(0);
            // Nothing more fires on later upkeeps.
            expect(collectTriggers(state, [UPKEEP("p1")])).toHaveLength(0);
        });
    });

    it("fires however the last counter leaves — an effect removing it, not the upkeep", () => {
        withCards(() => {
            const state = board(SORCERY);
            applySuspend(state, "p1", "card");
            const ctx = effectCtx(state, "p1");
            ctx.removeCounter(
                { type: "graveyard-card", id: "card" },
                "time",
                2
            );
            const events = state.pendingEvents ?? [];
            expect(events).toContainEqual(
                expect.objectContaining({
                    type: "COUNTER_REMOVED",
                    instanceId: "card",
                    counterType: "time",
                    remaining: 0,
                })
            );
            const triggers = collectTriggers(state, events);
            expect(triggers.map((t) => t.triggeredAbilityId)).toEqual([
                "suspend-last-counter",
            ]);
            // A removal that leaves a counter is not "the last".
            const state2 = board(SORCERY);
            applySuspend(state2, "p1", "card");
            const ctx2 = effectCtx(state2, "p1");
            ctx2.removeCounter(
                { type: "graveyard-card", id: "card" },
                "time",
                1
            );
            expect(collectTriggers(state2, state2.pendingEvents ?? [])).toEqual(
                []
            );
        });
    });
});

describe("Suspend — the creature spell's haste (CR 702.62a, 611.2b)", () => {
    function castCreature(): GameState {
        const state = board(CREATURE);
        applySuspend(state, "p1", "card");
        runUpkeep(state, "p1");
        answer(state, "cast");
        return state;
    }
    const creature = (state: GameState) =>
        state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "card");

    it("a creature cast this way enters with haste", () => {
        withCards(() => {
            const state = castCreature();
            const card = creature(state);
            expect(card?.controllerId).toBe("p1");
            expect(card?.staticAbilities).toContain("haste");
            expect(card?.hasteWhileControlledBy).toBeUndefined();
        });
    });

    it("loses it with control, and regaining control does not bring it back", () => {
        withCards(() => {
            const state = castCreature();
            effectCtx(state, "p2").gainControl(
                { type: "permanent", id: "card" },
                "p2"
            );
            recomputeContinuousEffects(state);
            expect(creature(state)?.controllerId).toBe("p2");
            expect(creature(state)?.staticAbilities).not.toContain("haste");
            expect(
                (state.continuousEffects ?? []).some(
                    (e) => e.expiry.kind === "while-controlled-by"
                )
            ).toBe(false);
            effectCtx(state, "p1").gainControl(
                { type: "permanent", id: "card" },
                "p1"
            );
            recomputeContinuousEffects(state);
            expect(creature(state)?.controllerId).toBe("p1");
            expect(creature(state)?.staticAbilities).not.toContain("haste");
        });
    });

    it("a noncreature spell cast this way carries no rider", () => {
        withCards(() => {
            const state = board(SORCERY, 3);
            applySuspend(state, "p1", "card");
            exiled(state)!.counters = { time: 1 };
            runUpkeep(state, "p1");
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["cast"],
            });
            const spell = state.stack.find((s) => s.id === "card");
            expect(spell).toBeDefined();
            expect(spell?.hasteWhileControlledBy).toBeUndefined();
        });
    });

    it("the rider on a creature spell survives the DB round trip", () => {
        withCards(() => {
            const state = board(CREATURE);
            applySuspend(state, "p1", "card");
            runUpkeep(state, "p1");
            const head = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["cast"],
            });
            const spell = state.stack.find((s) => s.id === "card");
            expect(spell?.hasteWhileControlledBy).toBe("p1");
            const round = expandState(compactState(state));
            expect(
                round.stack.find((s) => s.id === "card")?.hasteWhileControlledBy
            ).toBe("p1");
        });
    });
});

type CardArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

describe("Suspend — full path: mutation, wire, Bot (CR 702.62a)", () => {
    it("the hand card carries canSuspend for its owner only, while suspending is legal", () => {
        withCards(() => {
            const state = board(SORCERY);
            const mine = projectPublicState(state, 1, "p1").players[0].hand;
            expect(mine[0]).toMatchObject({ id: "card", canSuspend: true });
            p1(state).battlefield.find((l) => l.id === "m")!.isTapped = true;
            const tapped = projectPublicState(state, 1, "p1").players[0].hand;
            expect(tapped[0].canSuspend).toBeUndefined();
        });
    });

    it("the suspendCard mutation commits the action, and the exiled card reads suspended on the wire", async () => {
        await withTemporaryDefinitionAsyncAll(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board(SORCERY)),
            ]);
            await runMutation<CardArgs, void>(
                suspendCard as Handler<CardArgs, void>,
                harness.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: "card",
                }
            );
            const after = harness.state();
            expect(p1(after).hand).toHaveLength(0);
            const wire = projectPublicState(after, 1, "p2").players[0].exile;
            expect(wire[0]).toMatchObject({
                id: "card",
                suspended: true,
                counters: { time: 2 },
            });
            // A second suspend of a card no longer in hand is refused.
            await expect(
                runMutation<CardArgs, void>(
                    suspendCard as Handler<CardArgs, void>,
                    harness.ctx,
                    {
                        gameId: "game-1" as Id<"games">,
                        playerId: "p1",
                        cardInstanceId: "card",
                    }
                )
            ).rejects.toThrow();
        });
    });

    it("the Bot's enumerator offers the suspend action exactly when canSuspend holds", () => {
        withCards(() => {
            const state = board(NO_COST);
            const moves = enumerateMoves(state, "p1");
            expect(moves).toContainEqual({
                kind: "suspend",
                cardInstanceId: "card",
            });
            p1(state).battlefield.find((l) => l.id === "m")!.isTapped = true;
            expect(
                enumerateMoves(state, "p1").some((m) => m.kind === "suspend")
            ).toBe(false);
        });
    });
});

async function withTemporaryDefinitionAsyncAll<T>(
    fn: () => Promise<T>
): Promise<T> {
    return withTemporaryDefinitionAsync(SORCERY, () =>
        withTemporaryDefinitionAsync(INSTANT, () =>
            withTemporaryDefinitionAsync(CREATURE, () =>
                withTemporaryDefinitionAsync(NO_COST, fn)
            )
        )
    );
}
