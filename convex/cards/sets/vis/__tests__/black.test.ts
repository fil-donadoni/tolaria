// VIS — black behaviour tests (ADR 0043 colour split).
//
// Necromancy is the first shipped card to exercise three engine primitives at
// once, so every one of them is driven through its REAL entry point here:
//
//   - the per-instance Aura enchant restriction (issue #2471) — a permanent
//     that BECOMES an Aura at runtime and must survive the CR 303.4c / 704.5m
//     attachment sweep;
//   - the `next-cleanup-step` delayed-trigger boundary (CR 514.3a, issue
//     #2472) — driven through `advancePhase`, not by calling
//     `fireDelayedTriggers` by hand;
//   - the CR 307.1 / 117.1a cast-time snapshot `castOffSorceryTiming` (issue
//     #2473) — set on the STACK ITEM the way `announceCast` sets it, so the
//     CR 603.4 check-time condition is decided by the engine's own trigger
//     scan rather than by hand-pushing a trigger the condition never gated.
//
// Plus the CR 601.3 cast-timing permission at its single authority
// (`castTimingBaseLegal`) and one wire-format assertion through the real
// `projectPublicState`.
import { describe, it, expect } from "vitest";
import { necromancy } from "../black";
import { grizzlyBears, animateDead } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    hostMatchesEnchantRestriction,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import type { GameEvent } from "../../../types";
import { collectTriggers } from "../../../../gre/triggers";
import { checkAuraAttachmentSBA } from "../../../../gre/sba";
import { advancePhase } from "../../../../gre/phases";
import {
    castTimingBaseLegal,
    flashSurchargeRequired,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";

const NECRO = "necro-1";
const DEAD_BEAR = "bear-dead";

function find(state: GameState, id: string): CardInstanceState | undefined {
    return state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
}

function stackIds(state: GameState): (string | undefined)[] {
    return state.stack.map((s) => s.triggeredAbilityId);
}

/** p1 casts Necromancy; p2's graveyard holds a Grizzly Bears — the only legal
 *  target, so the CR 603.3d announcement auto-locks. `offSorceryTiming` is the
 *  CR 307.1 / 117.1a snapshot the cast-commit sites stamp
 *  (`wasCastOffSorceryTiming`), set here on the STACK ITEM exactly as
 *  `announceCast` does, so the test also proves it rides onto the permanent. */
function necromancyOnStack(opts: { offSorceryTiming: boolean }): GameState {
    const dead = makeInstance(grizzlyBears.id, {
        id: DEAD_BEAR,
        controllerId: "p2",
        ownerId: "p2",
        zone: "graveyard",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { graveyard: [dead] })],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    const spell: StackItem = {
        ...makeInstance(necromancy.id, {
            id: NECRO,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        ...(opts.offSorceryTiming ? { castOffSorceryTiming: true } : {}),
    } as StackItem;
    state.stack.push(spell);
    return state;
}

/** Resolves the Necromancy SPELL: it becomes a permanent, the engine's own
 *  trigger scan decides which of its ETB abilities fired (CR 603.4), and the
 *  CR 603.3b ordering choice — raised whenever both fire — is answered in
 *  collection order. Leaves the fired triggers on the stack. */
function resolveNecromancySpell(state: GameState): void {
    resolveTopOfStack(state);
    resolveTriggerOrder(state);
}

/** Cast → resolve → let the triggers fire → resolve every one of them. */
function reanimateWith(opts: { offSorceryTiming: boolean }): {
    state: GameState;
    fired: (string | undefined)[];
} {
    const state = necromancyOnStack(opts);
    resolveNecromancySpell(state);
    const fired = stackIds(state);
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 8) resolveTopOfStack(state);
    expect(state.stack).toHaveLength(0);
    return { state, fired };
}

describe("Necromancy — CR 601.3 cast-timing permission", () => {
    /** p2's turn: p1 is not in a sorcery-speed window at all (CR 307.1). */
    function opponentsTurn(): GameState {
        return makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
    }

    function inHand(cardId: string, id: string): CardInstanceState {
        return makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    }

    it("is castable outside its controller's sorcery-speed window (CR 601.3 / 702.8a)", () => {
        const state = opponentsTurn();

        expect(
            castTimingBaseLegal(
                state,
                "p1",
                inHand(necromancy.id, "necro-hand")
            )
        ).toBe(true);
        // Control: an enchantment carrying no permission stays sorcery-speed.
        expect(
            castTimingBaseLegal(
                state,
                "p1",
                inHand(animateDead.id, "anim-hand")
            )
        ).toBe(false);
    });

    it("owes nothing for the permission — CR 601.3c prices a DIFFERENT rider", () => {
        const state = opponentsTurn();

        expect(
            flashSurchargeRequired(
                state,
                "p1",
                inHand(necromancy.id, "necro-hand")
            )
        ).toBe(false);
    });
});

describe("Necromancy — CR 303.4 self-transform, reanimation and attachment", () => {
    it("becomes an Aura with a granted enchant clause, reanimates and attaches — and SURVIVES the CR 704.5m sweep", () => {
        const { state } = reanimateWith({ offSorceryTiming: false });

        const aura = find(state, NECRO)!;
        const bear = find(state, DEAD_BEAR)!;

        // CR 400.7 — reanimated under the Necromancy controller's control;
        // ownership (CR 108.3) is unchanged.
        expect(bear.controllerId).toBe("p1");
        expect(bear.ownerId).toBe("p2");
        expect(state.players[1].graveyard).toHaveLength(0);

        // CR 303.4 — the runtime grant: the subtype plus the specific-object
        // enchant clause, resolved to the reanimated creature's instance id.
        expect(aura.subtypes).toContain("Aura");
        expect(aura.attachedTo).toBe(DEAD_BEAR);
        expect(aura.grantedEnchantRestriction).toEqual({
            types: ["Creature"],
            hostId: DEAD_BEAR,
        });

        // CR 303.4c / 704.5m — the attachment sweep must find this legal. With
        // no readable restriction the Aura is binned the instant it attaches.
        expect(checkAuraAttachmentSBA(state)).toBe(false);
        expect(find(state, NECRO)).toBeDefined();
    });

    it("CR 702.5c — the granted clause names ONE object: another creature is no legal host", () => {
        const { state } = reanimateWith({ offSorceryTiming: false });
        const other = makeInstance(grizzlyBears.id, {
            id: "bear-other",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(other);

        const aura = find(state, NECRO)!;
        expect(
            hostMatchesEnchantRestriction(find(state, DEAD_BEAR)!, aura)
        ).toBe(true);
        expect(hostMatchesEnchantRestriction(other, aura)).toBe(false);
    });

    it("survives the wire projection with its attachment, its host and its clause intact", () => {
        const { state } = reanimateWith({ offSorceryTiming: false });

        const projected = projectPublicState(state, 1, "p1");
        const slimAura = projected.players[0].battlefield.find(
            (c) => c.id === NECRO
        )!;
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === DEAD_BEAR
        )!;

        expect(slimBear).toBeDefined();
        expect(slimAura.subtypes).toContain("Aura");
        expect(slimAura.attachedTo).toBe(DEAD_BEAR);
        // The projection strips `card.card` to `{ id }`; the granted clause
        // must NOT be among the fields it drops — the client-side Brain runs
        // the same predicate over this state, and a dropped clause bins the
        // Aura there while the server keeps it.
        expect(slimAura.grantedEnchantRestriction).toEqual({
            types: ["Creature"],
            hostId: DEAD_BEAR,
        });
        expect(
            hostMatchesEnchantRestriction(
                slimBear as CardInstanceState,
                slimAura as CardInstanceState
            )
        ).toBe(true);
    });

    it("CR 603.4 — the intervening-if: an enchantment already gone reanimates nothing", () => {
        const state = necromancyOnStack({ offSorceryTiming: false });
        resolveNecromancySpell(state);
        expect(stackIds(state)).toEqual(["necromancy-etb-reanimate"]);

        // "…if it's on the battlefield" is re-checked at resolution.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== NECRO
        );
        resolveTopOfStack(state);

        expect(find(state, DEAD_BEAR)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            DEAD_BEAR
        );
    });
});

describe("Necromancy — CR 603.7 / 514.3a cleanup-step sacrifice", () => {
    it("a SORCERY-timing cast arms nothing", () => {
        const { state, fired } = reanimateWith({ offSorceryTiming: false });

        // CR 603.4 — the check-time condition kept the ability out of the
        // trigger scan entirely: only the reanimation trigger fired.
        expect(fired).toEqual(["necromancy-etb-reanimate"]);
        expect(state.delayedTriggers).toBeUndefined();

        // …and the turn ends with both permanents still on the battlefield.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(find(state, NECRO)).toBeDefined();
        expect(find(state, DEAD_BEAR)).toBeDefined();
    });

    it("an INSTANT-timing cast sacrifices Necromancy at the next cleanup step, and that takes the creature with it (CR 514.3a)", () => {
        const { state, fired } = reanimateWith({ offSorceryTiming: true });

        // The cast-time snapshot rode onto the permanent (CR 307.1 / 117.1a).
        expect(find(state, NECRO)!.castOffSorceryTiming).toBe(true);
        expect([...fired].sort()).toEqual([
            "necromancy-cleanup-sacrifice",
            "necromancy-etb-reanimate",
        ]);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-cleanup-step");

        // CR 514.3a — through the real phase machinery, not by hand.
        state.phase = "END_STEP";
        const traversed = advancePhase(state);
        expect(traversed).toEqual(["CLEANUP"]);
        expect(state.phase).toBe("CLEANUP");
        expect(state.stack).toHaveLength(1);

        // The delayed ability resolves: Necromancy is sacrificed…
        resolveTopOfStack(state);
        expect(find(state, NECRO)).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(NECRO);

        // …and its own leaves-the-battlefield trigger, which the sacrifice put
        // on the stack, takes the creature with it (CR 603.10a — the host is
        // read from last-known information).
        expect(stackIds(state)).toContain("necromancy-ltb");
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 8) resolveTopOfStack(state);
        expect(find(state, DEAD_BEAR)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            DEAD_BEAR
        );
    });
});

describe("Necromancy — CR 603.10a leaves-the-battlefield sacrifice", () => {
    it("sacrifices the reanimated creature however the Aura leaves", () => {
        const { state } = reanimateWith({ offSorceryTiming: false });

        // Necromancy leaves by the CR 704.5m sweep itself: the host stops
        // being a creature, so the granted "enchant creature" clause fails.
        find(state, DEAD_BEAR)!.types = ["Artifact"];
        state.pendingEvents = undefined;
        expect(checkAuraAttachmentSBA(state)).toBe(true);
        expect(find(state, NECRO)).toBeUndefined();

        // The SBA sweep emits PERMANENT_LEFT; the engine's own trigger scan
        // (which the SBA pass runs after it, not inside it) is what turns that
        // into a stack object — CR 603.10a, looking back in time at an object
        // that is already in the graveyard.
        const events = (state.pendingEvents ?? []) as GameEvent[];
        state.pendingEvents = undefined;
        for (const t of collectTriggers(state, events)) state.stack.push(t);
        expect(stackIds(state)).toContain("necromancy-ltb");
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 8) resolveTopOfStack(state);

        expect(find(state, DEAD_BEAR)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            DEAD_BEAR
        );
    });
});
