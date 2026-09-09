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
 * A third seam decides what the ROOT does with that reading, and it is pinned
 * at the bottom of this file: the confinement probe behind issue #3194's
 * self-confined hold used to count the per-turn tallies a self-inflicted death
 * writes (`deathsThisTurn`, `lastKnownCopiable`) as evidence the announcement
 * had reached the opponent, so the hold never fired on this shape and the root
 * fell through to a material tie-break reading a subtree-accumulated mean.
 *
 * The pair is a payoff body against a vanilla body of the SAME mana value, so
 * the reduced cost (CR 118.7a) is identical and the only difference is what the
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
import { reachesOnlyOwnSideThroughChoice } from "../../search";
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

    describe("policyValue leaves everything else alone", () => {
        it("does not settle a resolution the OPPONENT owes a choice on", () => {
            // The safety argument of the whole change: the settle answers only
            // choices the MOVER owns, so a suspension waiting on the other seat
            // is never resolved on that seat's behalf.
            const { state, botId, put } = atHandPick(VANILLA);
            const oppId = state.players[1].id;
            const mid = cloneGameState(state);
            applyMoveInSearch(mid, botId, put);
            expect(mid.pendingChoices?.[0]?.playerId).toBe(botId);
            const asOpponent = settleStackForBreakdown(mid, oppId);
            expect(asOpponent.pendingChoices?.length).toBeGreaterThan(0);
            expect(asOpponent.stack.length).toBeGreaterThan(0);
        });

        it("settles only when a mover is named, and only mid-resolution", () => {
            // Two halves of one guard. Mid-resolution the `moverId` argument is
            // load-bearing: without it the caller keeps the old, unsettled
            // reading. With nothing suspended there is nothing to settle, so
            // naming a mover changes no score at all — which is what makes the
            // change inert for every position that is not mid-resolution.
            const { state, botId, put } = atHandPick(VANILLA);
            const mid = cloneGameState(state);
            applyMoveInSearch(mid, botId, put);
            expect(policyValue(mid, botId, put, undefined, botId)).not.toBe(
                policyValue(mid, botId, put, undefined)
            );

            const root = position(VANILLA);
            const pass = enumerateMoves(root.state, root.botId).find(
                (m) => m.kind === "pass"
            )!;
            const settledRoot = cloneGameState(root.state);
            applyMoveInSearch(settledRoot, root.botId, pass);
            expect(settledRoot.pendingChoices ?? []).toHaveLength(0);
            expect(
                policyValue(
                    settledRoot,
                    root.botId,
                    pass,
                    undefined,
                    root.botId
                )
            ).toBe(policyValue(settledRoot, root.botId, pass, undefined));
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

    // The 1-ply probe above is only half the decision. What the ROOT does with
    // it is settled by `selectRootMove`, and its material tie-break reads a
    // `meanMargin` accumulated over the whole SUBTREE — the `pass` subtree
    // explores casting the same spell one ply later, so it carries the identical
    // loss and LOSES to the branch that already paid it. The rule that answers
    // that (issue #3194's self-confined hold, `search.ts`) was already shipped
    // and was measured INERT here, for a reason with nothing to do with Flash:
    // its confinement probe compared the state-level per-turn tallies, and a
    // resolution that puts the mover's OWN creature onto the battlefield and
    // then sacrifices it bumps `deathsThisTurn` and stamps `lastKnownCopiable`.
    // Neither is a fact about the opponent, and reading them as reach answered
    // "this announcement leaves my side" for a resolution that demonstrably
    // does not.
    describe("the confinement probe is not fooled by its own death bookkeeping", () => {
        it("reads the cheat-into-play cast as reaching only the mover's side", () => {
            // Both hands, because the confinement question is about REACH and
            // must not depend on whether the body pays: what separates the two
            // is the resolved margin, which is the hold's second conjunct.
            for (const creature of [VANILLA, PAYOFF]) {
                const { state, botId } = position(creature);
                const cast = enumerateMoves(state, botId).find(
                    (m) => m.kind === "cast-spell"
                )!;
                expect(
                    reachesOnlyOwnSideThroughChoice(state, cast, botId),
                    `${creature}: the whole resolution happens on the mover's own side`
                ).toBe(true);
            }
        });

        it("still reads a resolution that reaches the OPPONENT as reaching them", () => {
            // The negative control for the three ignored tallies: dropping an
            // echo must not drop the evidence. Vision Charm's land-type mode is
            // the shape issue #3194 drew its own discriminating pair with — the
            // same mode, self-confined against the bot's lone Island and NOT
            // confined once the opponent controls lands it can re-type — so it
            // pins both directions of the predicate this change touches.
            const selfOnly = visionCharmPosition([]);
            const reaching = visionCharmPosition([
                { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
            ]);
            expect(
                reachesOnlyOwnSideThroughChoice(
                    selfOnly.state,
                    selfOnly.landTypeMode,
                    selfOnly.botId
                )
            ).toBe(true);
            expect(
                reachesOnlyOwnSideThroughChoice(
                    reaching.state,
                    reaching.landTypeMode,
                    reaching.botId
                )
            ).toBe(false);
        });
    });
});

/** Vision Charm on a lone Island, plus whatever `extra` cards the position
 *  needs — the issue #3194 pair, reused here as the reach control. */
function visionCharmPosition(extra: Record<string, unknown>[]): {
    state: GameState;
    botId: string;
    landTypeMode: Move;
} {
    const scenario = {
        label: "issue #3293 reach control",
        spec: {
            cards: [
                { name: "Vision Charm", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 1 },
                ...extra,
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        seeds: [0],
        tier: "must",
        expect: { forbidden: [] },
    } as unknown as BladeScenario;
    const state = buildBladeState(scenario);
    const botId = state.players[0].id;
    const landTypeMode = enumerateMoves(state, botId).find(
        (m) =>
            m.kind === "cast-spell" &&
            (m as { chosenModeId?: string }).chosenModeId === "land-type"
    );
    expect(
        landTypeMode,
        "the position must offer the land-type mode"
    ).toBeTruthy();
    return { state, botId, landTypeMode: landTypeMode! };
}
