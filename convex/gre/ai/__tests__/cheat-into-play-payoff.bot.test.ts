/**
 * A cheat-into-play spell is worth what SURVIVES its own resolution
 * (issue #3293).
 *
 * `choice(choose-hand-card, Creature, min 0) -> moveZone(hand -> battlefield)`
 * followed by "sacrifice it unless you pay" is one resolution with a body in
 * the middle of it. Every probe that ranks a cast or a choice branch stopped at
 * the first suspension, so it scored the state where the creature has ENTERED
 * and the sacrifice has not happened yet — a free body. Measured on Flash with
 * a hand it cannot pay for: 234.5 for cheating a Hill Giant in against 233.95
 * for passing, on a line whose settled value is −24. The greedy policy took
 * that bait at the choice node and, from the `pass` branch, cast the same spell
 * one ply later for the same reason, so passing never looked better either.
 *
 * Two seams answer it, asserted here deterministically rather than through a
 * search (a root-level assertion would be pinning rollout noise — the blade
 * pair "cheat-into-play" carries that evidence):
 *
 *   * `settleStackForBreakdown` runs the engine's own trigger scan and keeps
 *     going while anything is owed, so the sacrifice AND the dies trigger it
 *     fires are both in the settled state;
 *   * `policyValue` settles a suspended resolution before scoring, so the
 *     1-ply probe never sees the phantom body.
 *
 * The pair is a payoff body against a vanilla body of the SAME mana value, so
 * the reduced cost (CR 118.9) is identical and the only difference is what the
 * creature does when it dies.
 */

import { describe, expect, it } from "vitest";
import {
    applyMoveInSearch,
    decidingPlayer,
    policyValue,
    settleStackForBreakdown,
} from "../../search";
import { evaluate } from "../../evaluate";
import { enumerateMoves, type Move } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { cloneGameState } from "../../clone";
import type { GameState } from "../../state";
import type { BladeScenario } from "../blade/types";

/** Flash plus one creature, on exactly its own {1}{U} and nothing more — so
 *  the {2}-reduced cost of a seven-drop can never be paid and the trailing
 *  sacrifice is the only reachable end of the resolution. */
function position(creature: string): { state: GameState; botId: string } {
    const scenario = {
        label: "issue #3293 probe",
        spec: {
            cards: [
                { name: "Flash", owner: "me", zone: "hand" },
                { name: creature, owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        seeds: [0],
        tier: "must",
        expect: { forbidden: [] },
    } as unknown as BladeScenario;
    const state = buildBladeState(scenario);
    return { state, botId: state.players[0].id };
}

/** The position one ply into Flash's resolution: the spell has resolved far
 *  enough to raise its "you may put a creature onto the battlefield" pick, and
 *  the pick has not been answered yet. */
function atHandPick(creature: string): {
    state: GameState;
    botId: string;
    put: Move;
    decline: Move;
} {
    const { state, botId } = position(creature);
    const cast = enumerateMoves(state, botId).find(
        (m) => m.kind === "cast-spell"
    );
    expect(
        cast,
        "the position must offer the cheat-into-play cast"
    ).toBeTruthy();
    applyMoveInSearch(state, botId, cast!);
    const oppId = state.players[1].id;
    applyMoveInSearch(state, oppId, enumerateMoves(state, oppId)[0]);
    expect(decidingPlayer(state)).toBe(botId);
    const moves = enumerateMoves(state, botId);
    const put = moves.find(
        (m) =>
            ((m as { cardInstanceIds?: string[] }).cardInstanceIds ?? [])
                .length > 0
    );
    const decline = moves.find(
        (m) =>
            ((m as { cardInstanceIds?: string[] }).cardInstanceIds ?? [])
                .length === 0
    );
    expect(put, "the hand pick must offer the creature").toBeTruthy();
    expect(decline, "the hand pick must offer the decline").toBeTruthy();
    return { state, botId, put: put!, decline: decline! };
}

/** Apply `move` on a clone and read the 1-ply probe the rollout policy and the
 *  root breakdown both use. */
function probe(state: GameState, botId: string, move: Move): number {
    const clone = cloneGameState(state);
    applyMoveInSearch(clone, botId, move);
    return policyValue(clone, botId, move, undefined, botId);
}

/** A dies trigger that pays IMMEDIATELY (Vaultborn Tyrant leaves a token copy
 *  of itself behind) against a vanilla body of the same mana value. Rukh Egg is
 *  deliberately not the payoff card: its Bird arrives at the beginning of the
 *  next end step, so nothing a settle of THIS resolution can see. */
const PAYOFF = "Vaultborn Tyrant";
const VANILLA = "Lady Orca";

describe("cheat-into-play is worth what survives (issue #3293)", () => {
    describe("settleStackForBreakdown", () => {
        it("finishes the resolution instead of stopping at its suspension", () => {
            const { state, botId, put } = atHandPick(VANILLA);
            const mid = cloneGameState(state);
            applyMoveInSearch(mid, botId, put);
            // The bait: mid-resolution, the body is on the battlefield and the
            // "sacrifice it unless you pay" has not happened.
            expect(mid.pendingChoices?.length).toBeGreaterThan(0);

            const settled = settleStackForBreakdown(mid, botId);
            expect(settled.stack).toHaveLength(0);
            expect(settled.pendingChoices ?? []).toHaveLength(0);
            // Nothing survives: the creature was cheated in and sacrificed, so
            // the bot is down both cards and the mana with no body to show.
            const creatures = settled.players[0].battlefield.filter((c) =>
                c.types.includes("Creature")
            );
            expect(creatures).toHaveLength(0);
        });

        it("collects the dies trigger the sacrifice fires (CR 603.2)", () => {
            // Without the engine's own trigger scan the settle loop exits on an
            // empty stack having thrown the payoff away, and a payoff body
            // settles to the same number as a vanilla one.
            const vanilla = atHandPick(VANILLA);
            const payoff = atHandPick(PAYOFF);
            const settledOf = (p: typeof vanilla): GameState => {
                const mid = cloneGameState(p.state);
                applyMoveInSearch(mid, p.botId, p.put);
                return settleStackForBreakdown(mid, p.botId);
            };
            const vanillaSettled = settledOf(vanilla);
            const payoffSettled = settledOf(payoff);

            expect(
                payoffSettled.players[0].battlefield.filter((c) =>
                    c.types.includes("Creature")
                ).length
            ).toBeGreaterThan(0);
            expect(evaluate(payoffSettled, payoff.botId)).toBeGreaterThan(
                evaluate(vanillaSettled, vanilla.botId)
            );
        });
    });

    describe("policyValue at the hand pick", () => {
        it("prefers the DECLINE when nothing survives the sacrifice", () => {
            const { state, botId, put, decline } = atHandPick(VANILLA);
            expect(probe(state, botId, put)).toBeLessThan(
                probe(state, botId, decline)
            );
        });

        it("prefers the PUT when the body pays on the way out", () => {
            const { state, botId, put, decline } = atHandPick(PAYOFF);
            expect(probe(state, botId, put)).toBeGreaterThan(
                probe(state, botId, decline)
            );
        });
    });

    describe("policyValue at the cast", () => {
        // The acceptance criterion the whole slice turns on: a prior identical
        // for both hands cannot drive a decision that differs between them.
        it("differs between the two hands, and by sign", () => {
            const vanilla = position(VANILLA);
            const payoff = position(PAYOFF);
            const split = (p: { state: GameState; botId: string }) => {
                const moves = enumerateMoves(p.state, p.botId);
                const cast = moves.find((m) => m.kind === "cast-spell")!;
                const pass = moves.find((m) => m.kind === "pass")!;
                return {
                    cast: probe(p.state, p.botId, cast),
                    pass: probe(p.state, p.botId, pass),
                };
            };
            const v = split(vanilla);
            const p = split(payoff);
            expect(v.cast).toBeLessThan(v.pass);
            expect(p.cast).toBeGreaterThan(p.pass);
        });
    });
});
