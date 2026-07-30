// Planeshift (PLS) — multicolor behavior tests (ADR 0043 colour split, issue
// #1944).
//
// Keldon Twilight is a DSL card, but it introduces a genuinely new construct
// combination the auto-generated canned-scenario smoke sweep cannot drive: a
// CR 603.4 intervening-if reading the new game-level
// `creatureAttackedThisTurn` flag, and a new `EffectCardFilter` clause
// (`controlledSinceTurnStart`) whose truth depends on turn-scoped state the
// generator has no way to arrange. Per the per-Op regime
// (`.claude/rules/gre-development.md`) that earns hand-written coverage here,
// including the wire-format leg — the sacrifice picker's legality is read
// CLIENT-side off projected fields, so a projection that dropped them would
// leave the card correct on the server and dead on the board.

import { describe, it, expect } from "vitest";
import { keldonTwilight, phyrexianTyranny } from "../multicolor";
import {
    grizzlyBears,
    savannahLions,
    controlMagic,
    ancestralRecall,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    applyControlChange,
    emitCardDrawn,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { PhaseBeginEvent } from "../../../types";

const ABILITY = keldonTwilight.triggeredAbilities!.find(
    (a) => a.id === "keldon-twilight-end-step-sac"
)!;

const endStepEvent = (playerId: string): PhaseBeginEvent => ({
    type: "PHASE_BEGIN",
    phase: "END_STEP",
    activePlayerId: playerId,
});

/** Pushes Keldon Twilight's end-step trigger for `activePlayerId` and resolves
 *  it, exactly as the engine does (`resolveTopOfStack` runs the CR 603.4d
 *  intervening-if re-check before the body). */
function fireEndStep(
    state: GameState,
    source: CardInstanceState,
    activePlayerId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: ABILITY.id,
        triggerSourceId: source.id,
        triggerEvent: endStepEvent(activePlayerId),
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

/** Answers the head `sacrifice-permanents` choice through the REAL server
 *  submit path, so the pick is re-validated against the pending choice's
 *  filter (`effectivePermanentView` + `matchesPermanentFilter`). */
function submitSacrifice(state: GameState, cardInstanceId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

/** Board: Keldon Twilight under p1, one long-standing creature per player. */
function twoPlayerBoard(turn = 5) {
    const twilight = makeInstance(keldonTwilight.id, {
        id: "twilight",
        controllerId: "p1",
        ownerId: "p1",
    });
    const mine = makeInstance(grizzlyBears.id, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
    });
    mine.enteredOnTurn = 1;
    const theirs = makeInstance(savannahLions.id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
    });
    theirs.enteredOnTurn = 1;
    const state = makeState({
        turn,
        players: [
            makePlayer("p1", { battlefield: [twilight, mine] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
    return { state, twilight, mine, theirs };
}

describe("Keldon Twilight — card data (Scryfall / modern Oracle text)", () => {
    it("is a {1}{B}{R} rare Enchantment", () => {
        expect(keldonTwilight.manaCost).toEqual({ X: 1, B: 1, R: 1 });
        expect(keldonTwilight.types).toEqual(["Enchantment"]);
        expect(keldonTwilight.rarity).toBe("rare");
        expect(keldonTwilight.oracleText).toBe(
            "At the beginning of each player's end step, if no creatures attacked this turn, that player sacrifices a creature of their choice that they controlled since the beginning of the turn."
        );
    });

    it("declares exactly one triggered ability, written as an Effect Script (ADR 0045)", () => {
        expect(keldonTwilight.triggeredAbilities).toHaveLength(1);
        expect(ABILITY.effects).toBeDefined();
        expect(ABILITY.resolve).toBeUndefined();
    });
});

describe("Keldon Twilight — trigger scope (CR 603.6a, 'each player's end step')", () => {
    it("fires on EACH player's end step, and the sacrificing player is that player", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const self = { ...twilight } as never;

        // p1's own end step.
        expect(ABILITY.matches!(endStepEvent("p1"), self, state)).toBe(true);
        fireEndStep(state, twilight, "p1");
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitSacrifice(state, mine.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);

        // p2's end step — the OPPONENT is asked, not Keldon Twilight's
        // controller. (`{ ref: "$event.activePlayerId" }`, not "controller".)
        const second = twoPlayerBoard().state;
        const twilight2 = second.players[0].battlefield[0];
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight2 as never, second)
        ).toBe(true);
        fireEndStep(second, twilight2, "p2");
        expect(second.pendingChoices![0].playerId).toBe("p2");
        submitSacrifice(second, "theirs");
        expect(second.players[1].graveyard.map((c) => c.id)).toEqual([
            "theirs",
        ]);
    });

    it("does not fire on other steps", () => {
        const { state, twilight } = twoPlayerBoard();
        expect(
            ABILITY.matches!(
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                } as PhaseBeginEvent,
                twilight as never,
                state
            )
        ).toBe(false);
    });
});

describe("Keldon Twilight — intervening-if 'if no creatures attacked this turn' (CR 603.4 / 603.4d)", () => {
    it("does not trigger at all once a creature has attacked this turn", () => {
        const { state, twilight } = twoPlayerBoard();
        state.creatureAttackedThisTurn = true;
        expect(
            ABILITY.matches!(endStepEvent("p1"), twilight as never, state)
        ).toBe(false);
    });

    it("fizzles on RESOLUTION if the condition became false after the trigger went on the stack (CR 603.4d)", () => {
        const { state, twilight } = twoPlayerBoard();
        state.stack.push({
            ...twilight,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: ABILITY.id,
            triggerSourceId: twilight.id,
            triggerEvent: endStepEvent("p1"),
            targets: [],
        } as StackItem);
        state.creatureAttackedThisTurn = true;
        resolveTopOfStack(state);
        // No sacrifice choice was ever raised and nothing died.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("counts ANY player's creatures — the OPPONENT attacking suppresses it too", () => {
        const { state, twilight } = twoPlayerBoard();
        // The flag is game-level, so an attack by p2's creature during p2's
        // turn silences the trigger on p2's own end step.
        state.creatureAttackedThisTurn = true;
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight as never, state)
        ).toBe(false);
        state.creatureAttackedThisTurn = undefined;
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight as never, state)
        ).toBe(true);
    });
});

describe("Keldon Twilight — '…that they controlled since the beginning of the turn'", () => {
    it("excludes a creature that ENTERED this turn", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const fresh = makeInstance(savannahLions.id, {
            id: "fresh",
            controllerId: "p1",
            ownerId: "p1",
        });
        fresh.enteredOnTurn = state.turn;
        state.players[0].battlefield.push(fresh);
        fireEndStep(state, twilight, "p1");
        // Only the long-standing creature is offered; picking the fresh one
        // is rejected by the server's own submit validation.
        expect(() => submitSacrifice(state, "fresh")).toThrow();
        submitSacrifice(state, mine.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
    });

    it("excludes a creature whose CONTROL changed this turn, in either direction", () => {
        const { state, twilight } = twoPlayerBoard();
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(magic);
        // p1 steals p2's long-standing creature this turn.
        applyControlChange(state, "theirs", "p1", "magic");
        // p1's own creature leaves via the same steal in reverse: give
        // "mine" to p2 as well so p1 has ONLY the freshly-stolen creature.
        applyControlChange(state, "mine", "p2", "magic");
        fireEndStep(state, twilight, "p1");
        // Nothing legal for p1 → no choice raised, nothing sacrificed.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
        // …and p2, who now controls "mine", also may not sacrifice it: they
        // did not control it when the turn began.
        fireEndStep(state, twilight, "p2");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("does nothing (and does not throw) when the player controls no legal creature", () => {
        const { state, twilight } = twoPlayerBoard();
        state.players[0].battlefield = [twilight];
        fireEndStep(state, twilight, "p1");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
        // The trigger still resolved off the stack — the player sees it come
        // and go under its own oracle text.
        expect(state.stack).toHaveLength(0);
    });

    it("is the controller's EXPLICIT choice — the picker is raised even with several legal creatures and nothing is auto-sacrificed", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const second = makeInstance(savannahLions.id, {
            id: "second",
            controllerId: "p1",
            ownerId: "p1",
        });
        second.enteredOnTurn = 1;
        state.players[0].battlefield.push(second);
        fireEndStep(state, twilight, "p1");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1");
        expect(state.players[0].graveyard).toHaveLength(0);
        submitSacrifice(state, second.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["second"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            mine.id
        );
    });
});

describe("Keldon Twilight — wire format (the picker's legality is read client-side)", () => {
    it("the projection preserves the turn-scoped fields the client filter reads", () => {
        const { state, twilight } = twoPlayerBoard();
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(magic);
        applyControlChange(state, "theirs", "p1", "magic");
        state.creatureAttackedThisTurn = true;

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.turn).toBe(state.turn);
        expect(projected.controlChangedThisTurn).toEqual(["theirs"]);
        expect(projected.creatureAttackedThisTurn).toBe(true);
        const slimStolen = projected.players[0].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimStolen.enteredOnTurn).toBe(1);

        fireEndStep(state, twilight, "p1");
        // Suppressed by the intervening-if reading the projected-safe flag.
        expect(state.pendingChoices).toBeUndefined();
    });

    it("the raised choice carries the filter across the wire so the board can highlight it", () => {
        const { state, twilight } = twoPlayerBoard();
        fireEndStep(state, twilight, "p1");
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.filter).toMatchObject({
            types: "Creature",
            controlledSinceTurnStart: true,
        });
    });
});

// ---------------------------------------------------------------------------
// Phyrexian Tyranny (issue #1946) — "Whenever a player draws a card, that
// player loses 2 life unless they pay {2}." A DSL card, but `mayPay` always
// SUSPENDS on a live player decision (the auto-generated canned-scenario
// smoke sweep explicitly skips any script containing one,
// `gre/effects/scenarioGenerator.ts`), so per the per-Op regime this earns
// hand-written coverage. It is also the FIRST card to read `CARD_DRAWN`'s
// drawing player off the firing event (`{ ref: "$event.playerId" }`, the new
// `EVENT_FIELD_REGISTRY` row this issue adds) rather than `"controller"` —
// exactly the CR 117.3a "offered to the triggering player" gap.
// ---------------------------------------------------------------------------

const TYRANNY_ABILITY_ID = "phyrexian-tyranny-unless-pay";

function makeTyranny(
    controllerId: string,
    id = "tyranny"
): ReturnType<typeof makeInstance> {
    return makeInstance(phyrexianTyranny.id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** Simulates a real draw (library → hand) and runs it through the engine's
 *  real CARD_DRAWN choke point — `processPendingActionTriggers` — exactly
 *  like the turn-based draw step drives it (mirrors the Sheoldred fixture in
 *  `dmu/__tests__/black.test.ts`). */
function simulateTyrannyDraw(state: GameState, drawingPlayerId: string): void {
    const player = state.players.find((p) => p.id === drawingPlayerId)!;
    const drawn = player.library.shift();
    if (drawn) player.hand.push(drawn);
    state.pendingEvents = [
        { type: "CARD_DRAWN", playerId: drawingPlayerId, count: 1 },
    ];
    processPendingActionTriggers(state);
}

/** Batch draw through the REAL per-card choke point (`emitCardDrawn`) —
 *  proves the per-card fanout (CR 120.3): a draw-N raises N separate
 *  CARD_DRAWN events, so Phyrexian Tyranny's per-card trigger fires N times,
 *  not once. */
function simulateTyrannyBatchDraw(
    state: GameState,
    drawingPlayerId: string,
    n: number
): void {
    const player = state.players.find((p) => p.id === drawingPlayerId)!;
    for (let i = 0; i < n; i++) {
        const drawn = player.library.shift();
        if (drawn) player.hand.push(drawn);
    }
    emitCardDrawn(state, drawingPlayerId, n);
    processPendingActionTriggers(state);
}

describe("Phyrexian Tyranny — card data (Scryfall / modern Oracle text)", () => {
    it("is a {U}{B}{R} rare Enchantment", () => {
        expect(phyrexianTyranny.manaCost).toEqual({ U: 1, B: 1, R: 1 });
        expect(phyrexianTyranny.types).toEqual(["Enchantment"]);
        expect(phyrexianTyranny.rarity).toBe("rare");
        expect(phyrexianTyranny.oracleText).toBe(
            "Whenever a player draws a card, that player loses 2 life unless they pay {2}."
        );
    });

    it("declares exactly one triggered ability, written as an Effect Script (ADR 0045)", () => {
        expect(phyrexianTyranny.triggeredAbilities).toHaveLength(1);
        const ability = phyrexianTyranny.triggeredAbilities![0];
        expect(ability.id).toBe(TYRANNY_ABILITY_ID);
        expect(ability.effects).toBeDefined();
        expect(ability.resolve).toBeUndefined();
    });
});

describe("Phyrexian Tyranny — offered to the DRAWING player, not the controller (CR 117.3a)", () => {
    it("an opponent's draw offers the may-pay decision to the OPPONENT", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-1" })],
                    life: 20,
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");

        expect(
            state.stack.some((s) => s.triggeredAbilityId === TYRANNY_ABILITY_ID)
        ).toBe(true);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2"); // the DRAWER, not Tyranny's controller
    });

    it("Tyranny's own controller drawing offers the decision to THEMSELVES too (CR 121.1 'a player', either player)", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tyranny],
                    library: [makeInstance(grizzlyBears.id, { id: "lib-2" })],
                    life: 20,
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });

        simulateTyrannyDraw(state, "p1");

        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
    });
});

describe("Phyrexian Tyranny — pay or lose 2 life (CR 117.3a / 119.3b)", () => {
    it("declining costs the drawing player 2 life", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-3" })],
                    life: 20,
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(20); // controller unaffected

        // Wire format — life totals are client-visible.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(18);
    });

    it("paying {2} costs the drawing player nothing further", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-4" })],
                    life: 20,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });

        expect(state.players[1].life).toBe(20); // no life lost
        expect(state.players[1].manaPool.C).toBe(0); // {2} spent

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(20);
    });

    it("a player who cannot pay {2} is presented the decision and simply loses 2 life on decline — never silently skipped", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-5" })],
                    life: 20,
                    // No mana available to pay {2}.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // The decision is still RAISED (shown), not auto-skipped for lack of
        // funds — attempting to accept with insufficient mana is rejected by
        // the server (`applyMayPaySubmit` throws), same as any other
        // unaffordable may-pay.
        expect(head.kind).toBe("may-pay");
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p2", accept: true })
        ).toThrow();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(18);
    });
});

describe("Phyrexian Tyranny — fires once per card drawn (CR 120.3)", () => {
    it("a draw-three (Ancestral Recall) raises THREE separate decisions, one per card", () => {
        const tyranny = makeTyranny("p1");
        const p2Library = Array.from({ length: 3 }, (_, i) =>
            makeInstance(grizzlyBears.id, { id: `p2-lib-${i}` })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", { library: p2Library, life: 20 }),
            ],
        });

        // Effect-driven draw: cast Ancestral Recall targeting the opponent.
        pushSpell(state, ancestralRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // resolveTopOfStack resolves the spell AND drains the resulting
        // pending CARD_DRAWN events into three separate stack triggers
        // (`processPendingActionTriggers` runs internally after resolution).
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(3);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === TYRANNY_ABILITY_ID
            )
        ).toHaveLength(3);

        // Resolve all three, declining every time: 3 separate 2-life losses.
        for (let i = 0; i < 3; i++) {
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("may-pay");
            expect(head.playerId).toBe("p2");
            applyMayPaySubmit(state, { playerId: "p2", accept: false });
        }
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].life).toBe(14); // 20 − 3×2
    });

    it("fires on the natural draw-step draw too, via the same CARD_DRAWN choke point", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-6" })],
                    life: 20,
                }),
            ],
        });

        // simulateTyrannyBatchDraw mirrors the turn-based draw step's own
        // path through `emitCardDrawn` — the SAME choke point an
        // effect-driven draw uses.
        simulateTyrannyBatchDraw(state, "p2", 1);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === TYRANNY_ABILITY_ID
            )
        ).toHaveLength(1);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(18);
    });
});

describe("Phyrexian Tyranny — APNAP ordering when simultaneous (CR 603.3b)", () => {
    it("two Tyrannies under different controllers both trigger off one draw, in APNAP stack order", () => {
        const mine = makeTyranny("p1", "tyranny-mine");
        const theirs = makeTyranny("p2", "tyranny-theirs");
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [mine], life: 20 }),
                makePlayer("p2", {
                    battlefield: [theirs],
                    library: [makeInstance(grizzlyBears.id, { id: "lib-7" })],
                    life: 20,
                }),
            ],
        });

        const drawEvent = {
            type: "CARD_DRAWN" as const,
            playerId: "p2",
            count: 1,
        };
        const placed = collectTriggers(state, [drawEvent]);
        // Both permanents' abilities fire off the SAME "each" draw — APNAP
        // places the active player's (p1's) trigger first (underneath), the
        // non-active player's (p2's) on top, so the opponent's resolves
        // first (CR 603.3b).
        expect(placed).toHaveLength(2);
        expect(placed[0].triggerSourceId).toBe("tyranny-mine");
        expect(placed[1].triggerSourceId).toBe("tyranny-theirs");
        state.stack.push(...placed);

        // Top of stack (p2's Tyranny) resolves first.
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(18);

        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(16);

        expect(state.stack).toHaveLength(0);
    });
});

describe("Phyrexian Tyranny — wire format (the pending decision reaches the correct seat)", () => {
    it("the projected may-pay choice carries the DRAWING player's id, through the real reducer", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-8" })],
                    life: 20,
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        resolveTopOfStack(state);

        // Project for BOTH seats — the choice must reach p2 (the drawer),
        // not p1 (Tyranny's controller), on the wire.
        const projectedForP2 = projectPublicState(state, 1, "p2");
        const head = projectedForP2.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");

        const projectedForP1 = projectPublicState(state, 1, "p1");
        expect(projectedForP1.pendingChoices![0].playerId).toBe("p2");
    });
});
