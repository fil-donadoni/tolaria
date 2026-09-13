// The verdict lowering declares the stack (issue #3514, PRD #3397, ADR 0127).
//
// Every LIVE position here is built by the ENGINE — the blade builder walks a
// quiet board forward through the real cast / activation pipeline, or a move
// the production enumerator offered is applied through `applyMoveInSearch` —
// never a hand-written stack item. A hand-built stack can describe an object
// no game could have put there, and a round trip asserted against one proves
// nothing about the positions this slice exists to make judgeable.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import {
    stackFingerprint,
    stackRebuildMismatch,
    type SeatOf,
} from "../verdicts/stackFingerprint";
import { applyMoveInSearch } from "../../search";
import { describeMove } from "../../describeMove";
import type { BladeSetupStep } from "../blade/types";
import type { GameState, StackItem } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

function engineBuilt(spec: ScenarioSpec, setup: BladeSetupStep[]): GameState {
    return buildBladeState({
        label: "verdict stack lowering fixture",
        spec,
        setup,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
}

function seatsOf(state: GameState, botId: string): SeatOf {
    return (playerId) =>
        playerId === botId
            ? "me"
            : state.players.some((p) => p.id === playerId)
              ? "opp"
              : null;
}

/** Lower `state` from `botId`'s seat, naming the Bot's pick as the first
 *  candidate — any candidate the live position offers is a legitimate pick. */
function lower(state: GameState, botId: string) {
    const [first] = candidateMoves(state, botId);
    return lowerDecision(state, botId, describeMove(first, state));
}

/** The acceptance assertion: a candidate list, not a refusal, AND the rebuilt
 *  stack matches the live one on seat, name, kind, targets and `x`. */
function expectJudgeable(state: GameState, botId: string): void {
    const outcome = lower(state, botId);
    if (!outcome.ok) {
        throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
    }
    expect(outcome.lowered.candidates.length).toBeGreaterThan(1);
    expect(outcome.lowered.spec.stack?.length).toBe(state.stack.length);
    const rebuilt = buildVerdictPosition(outcome.lowered.spec);
    const rebuiltBot = rebuilt.players[0].id;
    expect(stackFingerprint(rebuilt, seatsOf(rebuilt, rebuiltBot))).toEqual(
        stackFingerprint(state, seatsOf(state, botId))
    );
}

/** The opponent casts Powder Keg on their own turn; the Bot, holding a Bolt,
 *  decides whether to respond. */
function powderKegPosition(): { state: GameState; botId: string } {
    const state = engineBuilt(
        {
            cards: [
                { name: "Powder Keg", owner: "opp", zone: "hand" },
                { name: "Mountain", owner: "opp", count: 2 },
                { name: "Mountain", owner: "me" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "opp",
            landCount: 0,
            libraryCount: 20,
        },
        [{ kind: "cast", card: "Powder Keg", by: "opp" }]
    );
    return { state, botId: state.players[0].id };
}

describe("the verdict lowering declares the stack (issue #3514)", () => {
    it("judges the Bot's response to the opponent's cast — [opp Powder Keg spell]", () => {
        const { state, botId } = powderKegPosition();
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            "opp Powder Keg spell targets[] x=-",
        ]);
        expectJudgeable(state, botId);
    });

    it("judges a decision over the Bot's own targeted activation and the opponent's answer — [me Rishadan Port ability | opp Impulse spell]", () => {
        const state = engineBuilt(
            {
                cards: [
                    { name: "Rishadan Port", owner: "me" },
                    { name: "Mountain", owner: "me", count: 2 },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    { name: "Island", owner: "opp" },
                    { name: "Swamp", owner: "opp" },
                    { name: "Impulse", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                activePlayer: "me",
                landCount: 0,
                libraryCount: 20,
            },
            [
                {
                    kind: "activate",
                    card: "Rishadan Port",
                    ability: "rishadan-port-ability-2",
                    controller: "me",
                    target: "Swamp",
                },
                { kind: "cast", card: "Impulse", by: "opp" },
            ]
        );
        const botId = state.players[0].id;
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            "me Rishadan Port ability:rishadan-port-ability-2 targets[permanent:opp Swamp {tapped}] x=-",
            "opp Impulse spell targets[] x=-",
        ]);
        expectJudgeable(state, botId);
    });
});

describe("the stack fingerprint sees what the lowering did not write (issue #3514)", () => {
    /** Two Grizzly Bears on the Bot's side — the SECOND one damaged — and the
     *  opponent's Bolt pointed at the damaged one. Cast through the production
     *  enumerator by instance id, so the target is the engine's, not a name
     *  resolved by a builder. The Bot holds a Bolt of its own, so it has a real
     *  decision. */
    function duplicateNameTarget(): { state: GameState; botId: string } {
        const state = buildVerdictPosition({
            cards: [
                { name: "Grizzly Bears", owner: "me" },
                { name: "Grizzly Bears", owner: "me", damageMarked: 1 },
                { name: "Mountain", owner: "me" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "opp" },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "opp",
            landCount: 0,
            libraryCount: 20,
        });
        const [bot, opp] = state.players;
        const damaged = bot.battlefield.find((c) => c.damageMarked === 1);
        expect(damaged).toBeDefined();
        const cast = candidateMoves(state, opp.id).find(
            (move) =>
                move.kind === "cast-spell" &&
                move.targets.length === 1 &&
                move.targets[0].id === damaged!.id
        );
        expect(cast).toBeDefined();
        applyMoveInSearch(state, opp.id, cast!);
        expect(state.stack).toHaveLength(1);
        return { state, botId: bot.id };
    }

    it("names the target's damage, so the damaged Bear is not the undamaged one", () => {
        const { state, botId } = duplicateNameTarget();
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            "opp Lightning Bolt spell targets[permanent:me Grizzly Bears {damage=1}] x=-",
        ]);
        expectJudgeable(state, botId);
    });

    it("refuses a rebuild whose duplicate-name target resolved to the WRONG instance", () => {
        const { state, botId } = duplicateNameTarget();
        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(outcome.error);
        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        const rebuiltBot = rebuilt.players[0];
        const liveSeats = seatsOf(state, botId);
        const rebuiltSeats = seatsOf(rebuilt, rebuiltBot.id);
        expect(
            stackRebuildMismatch(state, liveSeats, rebuilt, rebuiltSeats)
        ).toBe(null);

        // The builder's failure mode, reproduced: the spell pointed at the
        // other same-named permanent. Seat, name, kind, the candidate list —
        // all identical; only the target's observable facts differ.
        const targeted = rebuiltBot.battlefield.find(
            (c) => c.id === rebuilt.stack[0].targets?.[0]?.id
        );
        expect(targeted?.damageMarked).toBe(1);
        const undamaged = rebuiltBot.battlefield.find(
            (c) =>
                c.id !== targeted!.id &&
                (c.card as { id?: string }).id ===
                    (targeted!.card as { id?: string }).id
        );
        expect(undamaged).toBeDefined();
        (rebuilt.stack[0] as StackItem).targets = [
            { type: "permanent", id: undamaged!.id },
        ];
        const mismatch = stackRebuildMismatch(
            state,
            liveSeats,
            rebuilt,
            rebuiltSeats
        );
        expect(mismatch).not.toBe(null);
        expect(mismatch).toContain("damage=1");
        expect(mismatch).toContain("stack index 0");
    });
});

describe("a stack the spec cannot declare is refused by item and field (issue #3514)", () => {
    it("names a trigger's field — `opp Powder Keg spell: triggerEvent`", () => {
        const { state, botId } = powderKegPosition();
        // The one field `placeTriggersOnStack` always writes. Stamped on an
        // engine-cast object so the refusal is about exactly this field.
        (state.stack[0] as unknown as Record<string, unknown>).triggerEvent = {
            type: "CAST",
        };
        const outcome = lower(state, botId);
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("opp Powder Keg spell: triggerEvent");
    });

    it("names a payment still mid-flight — `pendingActivation`", () => {
        const { state, botId } = powderKegPosition();
        (state as unknown as Record<string, unknown>).pendingActivation = {
            playerId: botId,
        };
        // Straight to the lowering: a mid-flight payment owes no priority
        // decision, so there is no candidate to name as the Bot's pick — and
        // the refusal fires before any candidate is read.
        const outcome = lowerDecision(state, botId, "pass");
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("pendingActivation");
    });
});
