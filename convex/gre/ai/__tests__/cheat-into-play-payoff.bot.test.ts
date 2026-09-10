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
 * self-confined hold used to count the bookkeeping a self-inflicted death
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
    searchWithTrace,
    settleStackForBreakdown,
} from "../../search";
import { evaluate, materialMargin } from "../../evaluate";
import { reachesOnlyOwnSideThroughChoice } from "../../search";
import { enumerateMoves, type Move } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { cloneGameState } from "../../clone";
import type { GameState } from "../../state";
import type { BladeScenario } from "../blade/types";
import { MAX_CHOICE_DEPTH } from "../choiceDepth";
import { choiceCandidates } from "../choiceCandidates";
import { choiceFindDestination } from "../searchDestination";
import { NEUTRAL_PRIOR } from "../choicePriors";

/** Flash plus one creature, on exactly its own {1}{U} and nothing more — so
 *  the {2}-reduced cost of a seven-drop can never be paid and the trailing
 *  sacrifice is the only reachable end of the resolution. */
function position(
    creatures: string | string[],
    oppHand: string[] = []
): { state: GameState; botId: string } {
    const mine = typeof creatures === "string" ? [creatures] : creatures;
    const scenario = {
        label: "issue #3293 probe",
        spec: {
            cards: [
                { name: "Flash", owner: "me", zone: "hand" },
                ...mine.map((name) => ({ name, owner: "me", zone: "hand" })),
                ...oppHand.map((name) => ({
                    name,
                    owner: "opp",
                    zone: "hand",
                })),
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
/** The body from issue #3388's own report: TWO dies triggers (three 5/5 Wurm
 *  tokens, and "shuffle it into its owner's library"), which is what makes it
 *  the only one of the three that goes through CR 603.3b's ordering batch. */
const TWO_TRIGGERS = "Worldspine Wurm";

/** The same position with TWO creatures in hand, so the hand pick's ordering is
 *  observable at all: one body whose dies trigger pays, one vanilla body of the
 *  same mana value. Stops one ply in, at the pick itself. */
function atHandPickWithBoth(oppHand: string[] = []): {
    state: GameState;
    botId: string;
} {
    const { state, botId } = position([PAYOFF, VANILLA], oppHand);
    const cast = enumerateMoves(state, botId).find(
        (m) => m.kind === "cast-spell"
    )!;
    applyMoveInSearch(state, botId, cast);
    const oppId = state.players[1].id;
    applyMoveInSearch(state, oppId, enumerateMoves(state, oppId)[0]);
    expect(decidingPlayer(state)).toBe(botId);
    return { state, botId };
}

/** The settled state of one branch of the hand pick. */
function settledBranch(p: ReturnType<typeof atHandPick>, put: boolean) {
    const mid = cloneGameState(p.state);
    applyMoveInSearch(mid, p.botId, put ? p.put : p.decline);
    return settleStackForBreakdown(mid, p.botId);
}

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

        it("leaves the payoff branch AHEAD of declining on material margin", () => {
            // The measurement the root actually reads (`resolvedMarginDelta`,
            // and through it both halves of the self-confined rule): not the
            // full leaf value, which folds in the Danger Clock, but the plain
            // material difference. Cheating the Tyrant in and losing it leaves
            // the token copy it makes on the way out, and that has to beat
            // keeping the card — otherwise no root rule can want the line.
            const p = atHandPick(PAYOFF);
            const put = settledBranch(p, true);
            // …measured on a branch that is ACTUALLY settled. A margin read on
            // a put branch that merely stopped at the suspension is a read of
            // the phantom body — it clears declining for the wrong reason, and
            // by a wider margin than the truth.
            expect(put.stack).toHaveLength(0);
            expect(put.pendingChoices ?? []).toHaveLength(0);
            const board = put.players[0].battlefield.filter((c) =>
                c.types.includes("Creature")
            );
            expect(board).toHaveLength(1);
            expect(board[0].isToken).toBe(true);

            expect(materialMargin(put, p.botId)).toBeGreaterThan(
                materialMargin(settledBranch(p, false), p.botId)
            );
        });
    });

    // Issue #3388. The settle loop asked ONE question — "is there anything on
    // the stack" — and CR 603.3b answers it wrong at exactly the moment this
    // shape pays: a simultaneous-trigger batch is put to its controller for
    // ORDERING *before* the triggers go on the stack, so the sacrifice that
    // ends the resolution empties the stack and immediately queues a
    // `trigger-order` choice with `stack.length === 0`. The loop exited there,
    // the two dies triggers never reached the stack, and the branch that
    // cheated a Worldspine Wurm in scored as three 5/5 tokens' worth of
    // NOTHING — the spell reading as a blank card, which is the whole report.
    describe("a choice raised with an EMPTY stack (CR 603.3b)", () => {
        it("settles through the trigger-order batch the sacrifice raises", () => {
            const p = atHandPick(TWO_TRIGGERS);
            const mid = cloneGameState(p.state);
            applyMoveInSearch(mid, p.botId, p.put);
            const settled = settleStackForBreakdown(mid, p.botId);

            // Nothing owed: not on the stack, and not queued beside it.
            expect(settled.stack).toHaveLength(0);
            expect(settled.pendingChoices ?? []).toHaveLength(0);
            // The payoff the whole line exists for, three 5/5 Wurm tokens
            // (CR 111.1) — zero of them before this fix.
            const tokens = settled.players[0].battlefield.filter(
                (c) => c.isToken === true && c.types.includes("Creature")
            );
            expect(tokens).toHaveLength(3);
            // And the SECOND of the two simultaneous triggers ran as well, so
            // the batch was ordered and drained rather than half-answered: the
            // Wurm is shuffled into its owner's library, not left in the
            // graveyard (CR 701.24).
            expect(settled.players[0].graveyard).toHaveLength(1);
            expect(settled.players[0].library.length).toBe(21);
        });

        it("is entered at a state whose stack is ALREADY empty", () => {
            // The same bug at the other end of the seam. Above, the loop walks
            // into the batch; here the CALLER hands it one — a state whose
            // stack is empty and whose only owed work is the queued ordering.
            // "Is anything owed" has to read both, or the entry point answers
            // "nothing to settle, complete" and the caller scores a position
            // with two dies triggers still waiting to happen.
            const p = atHandPick(TWO_TRIGGERS);
            const mid = cloneGameState(p.state);
            applyMoveInSearch(mid, p.botId, p.put);
            // Walk by hand to the batch: decline the "unless you pay" (the
            // {2}-reduced cost of an eleven-drop is unpayable on two lands
            // anyway, CR 118.7a), which sacrifices the body and fires both
            // dies triggers at once.
            const decline = enumerateMoves(mid, p.botId).find(
                (m) => m.kind === "may-pay" && m.accept === false
            );
            expect(decline, "the may-pay must offer a decline").toBeTruthy();
            applyMoveInSearch(mid, p.botId, decline!);
            expect(mid.stack).toHaveLength(0);
            expect(mid.pendingChoices?.[0]?.kind).toBe("trigger-order");

            const report = { complete: false };
            const settled = settleStackForBreakdown(
                mid,
                p.botId,
                undefined,
                0,
                undefined,
                0,
                report
            );
            expect(report.complete).toBe(true);
            expect(
                settled.players[0].battlefield.filter((c) => c.isToken === true)
            ).toHaveLength(3);
        });

        // NOT asserted here, deliberately: that this branch's material margin
        // beats declining. It does not, and the reason is a term this issue did
        // not touch — the `hand` term prices an {8}{G}{G}{G} 15/15 held on TWO
        // LANDS at full latent worth (932) against the 840 the three tokens are
        // worth on the board, so `self-harm-removal` still refuses the cast.
        // Recorded as a `stretch` blade entry (`cause: "valuation"`, no
        // `passesAt`) and drafted in
        // `docs/findings/3388-hand-term-prices-an-uncastable-fatty-at-full-latent-worth.md`.
        // The margin assertion this issue CAN make is the one below, on the
        // body whose payoff its own hand worth does not outrun.
    });

    describe("a bail is not scoreable as a settled outcome (issue #3388)", () => {
        it("hands back the position as it was, not the half-applied one", () => {
            // Entered at the ANNOUNCEMENT — the spell on the stack, nothing
            // suspended yet — so the settle has to resolve one item before it
            // meets the pick, and starving the branch-work budget makes it bail
            // holding a resolution it has already begun. Before this, that
            // half-applied state WAS the answer: the "you may put a creature
            // onto the battlefield" queued, the "sacrifice it unless you pay"
            // that pays for it not yet run, and every caller feeding the result
            // straight to `evaluate`. That is an announcement's cost with its
            // payoff deleted, which is the same reading the stack-length bug
            // above produced by a different route.
            const { state, botId } = position(TWO_TRIGGERS);
            const cast = enumerateMoves(state, botId).find(
                (m) => m.kind === "cast-spell"
            )!;
            const probeState = cloneGameState(state);
            applyMoveInSearch(probeState, botId, cast);
            const before = cloneGameState(probeState);
            expect(before.stack).toHaveLength(1);
            expect(before.pendingChoices ?? []).toHaveLength(0);

            const report = { complete: true };
            const out = settleStackForBreakdown(
                probeState,
                botId,
                undefined,
                0,
                { left: 0 },
                0,
                report
            );
            expect(report.complete).toBe(false);
            // The announcement, exactly as it was announced — NOT one Op into
            // its own resolution with a choice queued.
            expect(out.stack).toHaveLength(1);
            expect(out.pendingChoices ?? []).toHaveLength(0);
            expect(materialMargin(out, botId)).toBe(
                materialMargin(before, botId)
            );
        });

        it("does not let a bailed BRANCH win the argmax over a settled one", () => {
            // One choice node, two branches, and only one of them can finish:
            // entered one below `MAX_CHOICE_DEPTH`, the hand pick is still
            // answerable but the "sacrifice it unless you pay" the PUT branch
            // runs into is one level too deep. The put branch therefore stops
            // with the body on the battlefield and the sacrifice unrun — the
            // free-creature bait of issue #3293 — while declining finishes.
            // Their margins are not the same quantity, so the max over both is
            // meaningless and always favours whichever branch stopped earliest.
            const p = atHandPick(TWO_TRIGGERS);
            const mid = cloneGameState(p.state);
            const settled = settleStackForBreakdown(
                mid,
                p.botId,
                undefined,
                MAX_CHOICE_DEPTH - 1
            );
            // The DECLINE branch, settled — not the snapshot the entry point
            // returns when every branch bails, which also has no creature on
            // the battlefield and would let this pass for the wrong reason.
            expect(settled.stack).toHaveLength(0);
            expect(settled.pendingChoices ?? []).toHaveLength(0);
            expect(
                settled.players[0].battlefield.filter((c) =>
                    c.types.includes("Creature")
                ),
                "the half-settled branch must not be the answer"
            ).toHaveLength(0);
        });
    });

    // The generator's own half of issue #3388. Every optional hand pick was
    // priced as material GIVEN UP and ordered cheapest-first — the shape it was
    // written for ("you may exile a card"), and exactly backwards when the same
    // `moveZone` puts the pick on the mover's own BATTLEFIELD. `CHOICE_TOP_K`
    // truncates the ordering, so the direction is not cosmetic: with nine
    // creature cards in hand, ascending order opens the eight worst bodies and
    // drops the bomb.
    describe("the hand pick knows a gain from a cost (issue #3388)", () => {
        it("reads the destination off the source's own Effect Script", () => {
            const { state } = atHandPickWithBoth();
            const choice = state.pendingChoices![0];
            expect(choice.kind).toBe("choose-hand-card");
            expect(choiceFindDestination(state, choice)).toBe("battlefield");
        });

        it("hints the pick as material GAINED and opens the best body first", () => {
            const { state } = atHandPickWithBoth();
            const choice = state.pendingChoices![0];
            const cands = choiceCandidates(state, choice);
            const picks = cands.filter(
                (c) =>
                    (
                        (c.move as { cardInstanceIds?: string[] })
                            .cardInstanceIds ?? []
                    ).length > 0
            );
            expect(picks.length).toBeGreaterThanOrEqual(2);
            for (const c of picks) {
                expect(c.hint?.materialGained).toBeGreaterThan(0);
                expect(c.hint?.materialGivenUp).toBeUndefined();
            }
            // Best-worth lead first: the Tyrant (a dies trigger that pays) over
            // the vanilla body of the same mana value.
            expect(picks[0].hint!.materialGained!).toBeGreaterThan(
                picks[picks.length - 1].hint!.materialGained!
            );
            // …and the prior follows the same sign, instead of every branch
            // sitting at the flat neutral the `accept`-shaped dispatch left it.
            const decline = cands.find(
                (c) =>
                    (
                        (c.move as { cardInstanceIds?: string[] })
                            .cardInstanceIds ?? []
                    ).length === 0
            )!;
            expect(picks[0].prior).toBeGreaterThan(decline.prior);
        });

        it("leaves a pick out of ANOTHER player's hand exactly as it was", () => {
            // The gate on the new direction (PR review finding C1). A
            // `choose-hand-card` can name someone else's hand (`zoneOwnerId` —
            // the Deep-Cavern Bat / Elite Spellbinder strip), and there the
            // worth moves away from the OPPONENT: signing it by the destination
            // alone would hint the decider "gained" their opponent's card, and
            // routing it through the signed prior band would subtract that loss
            // from the decider's own prior and open the best strip LAST. Both
            // stay off it — flat neutral, cost-shaped hint, exactly as before
            // this issue (the drawer holds the draft for signing it properly).
            const { state } = atHandPickWithBoth([PAYOFF, VANILLA]);
            const oppId = state.players[1].id;
            const own = state.pendingChoices![0];
            const foreign = {
                ...own,
                zoneOwnerId: oppId,
                // The interpreter's own id filter names the DECIDER's hand;
                // clearing it is what makes the other player's hand the pool.
                candidateIds: undefined,
            };
            // Same script, same destination — only the zone's owner differs.
            expect(choiceFindDestination(state, foreign)).toBe("battlefield");

            const picks = choiceCandidates(state, foreign).filter(
                (c) =>
                    (
                        (c.move as { cardInstanceIds?: string[] })
                            .cardInstanceIds ?? []
                    ).length > 0
            );
            expect(picks.length).toBeGreaterThan(0);
            for (const c of picks) {
                expect(c.hint?.materialGained).toBeUndefined();
                expect(c.hint?.materialGivenUp).toBeGreaterThan(0);
                expect(c.prior).toBe(NEUTRAL_PRIOR);
            }
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
    // its confinement probe compared the state-level bookkeeping it writes, and a
    // resolution that puts the mover's OWN creature onto the battlefield and
    // then sacrifices it bumps `deathsThisTurn` and stamps `lastKnownCopiable`.
    // Neither is a fact about the opponent, and reading them as reach answered
    // "this announcement leaves my side" for a resolution that demonstrably
    // does not.
    // Issue #3388's third acceptance criterion: the root pick is EXPLAINED, not
    // just changed. The reported trace showed `cast Flash` with more visits
    // (603 vs 597) and a higher `meanMargin` (1111.9 vs 1106.3) than `pass`,
    // and `pass` chosen — with nothing in the artifact naming the rule that
    // overrode the search's own argmax. `DecisionTrace.mechanism` is that name,
    // and it is the same `RootDecisionMechanism` the telemetry sink has always
    // recorded; only the sink is installed by tooling nobody runs mid-game,
    // while this rides on the JSON the debug box copies.
    describe("the root pick names the rule that made it", () => {
        const decide = (creature: string) => {
            const { state, botId } = position(creature);
            const { move, trace } = searchWithTrace(
                state,
                botId,
                { iterations: 400 },
                0xb1ade
            );
            return { move, trace };
        };

        it("credits a self-confined cast whose resolution pays", () => {
            const { move, trace } = decide(PAYOFF);
            expect(move?.kind).toBe("cast-spell");
            expect(trace?.mechanism).toBe("resolved-payoff");
        });

        it("still refuses the same cast when the resolution does not pay", () => {
            // The negative control's mechanism, and the proof the two halves are
            // one rule read in both directions: same gate, same measurement,
            // opposite sign. A `resolved-payoff` here would mean the credit had
            // stopped reading the resolution.
            const { move, trace } = decide(VANILLA);
            expect(move?.kind).toBe("pass");
            expect(trace?.mechanism).toBe("self-harm-removal");
        });
    });

    describe("the confinement probe is not fooled by its own death bookkeeping", () => {
        it("reads the cheat-into-play cast as reaching only the mover's side", () => {
            // Both hands, because the confinement question is about REACH and
            // must not depend on whether the body pays: what separates the two
            // is the resolved margin, which is the hold's second conjunct.
            //
            // Both are also the witness for the ignore list, one key each:
            // drop `deathsThisTurn` / `lastKnownCopiable` and the vanilla hand
            // reds (the sacrifice is a departure), drop `lifeGainedThisTurn`
            // and the payoff hand reds on its own (its body gains life as it
            // enters). No key on that list is there on the general argument
            // alone.
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

        // The other direction — a resolution that DOES reach the opponent must
        // still read as reaching them — is the issue #3194 pair, asserted on
        // this same seam in `choice-suspended-payoff.bot.test.ts` ("reads the
        // reach as self-confined only when the effect cannot leave it"). It is
        // not repeated here: none of the three ignored keys moves in either of
        // its positions (no death, no departure, no life gain), so a copy would
        // pass byte-identically with and without this change and would read as
        // a control it cannot be.
    });
});
