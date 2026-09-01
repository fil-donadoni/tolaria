// The two reflexive CAST WINDOWS as in-tree ISMCTS decision nodes (issue #2983)
// — Madness (CR 702.35a) and Rebound (CR 702.88a).
//
// Both were answered by a hardcoded `decline` in `brain.ts` on a documented
// minimal-legal policy, and — the half that made it unfixable from the Brain
// alone — neither kind had a candidate generator, so while one was the head
// choice `enumerateMoves` returned an EMPTY list: the choice was not a decision
// node, and the playout stopped there. The observable result was that a Madness
// card the Bot discarded was a card it threw away and a Rebound spell was a
// spell it cast exactly once.
//
// What this file pins, per mechanism:
//   - the generator emits BOTH halves (the cast and the decline), so
//     `enumerateMoves` is non-empty at the window;
//   - the cast is priced through `castRawManaCost` — the madness cost, never
//     the printed one; nothing at all for a rebound recast — so the Bot's plan
//     and the real `announceCast` mutation charge the same amount;
//   - it FAILS CLOSED: an unaffordable madness cost and a rebound with no legal
//     target emit the decline ALONE, never a cast the executor cannot complete;
//   - the two halves are applicable in the search sandbox with the stack flags
//     the real mutation stamps, and each half consumes the window;
//   - the candidate KEYS are stable across determinizations (contract property
//     2, `choiceCandidates.ts`).
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import {
    discardToGraveyard,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
} from "../../state";
import { advancePhase } from "../../phases";
import { enumerateMoves, type Move } from "../../moves";
import { applyMoveInSearch } from "../../search";
import { applyMoveForSearch } from "../../applyMove";
import { CHOICE_TOP_K, choiceCandidates } from "../choiceCandidates";
import { anjesRavager } from "../../../cards/sets/c19/red";
import { ephemerate } from "../../../cards/sets/mh1/white";
import { grizzlyBears } from "../../../cards/sets/lea";
import { mountain } from "../../../cards/sets/lea";

/** Discards `cardId` from `playerId`, fires the reflexive madness trigger
 *  through the real post-action trigger scan, and resolves it — leaving the
 *  cast window OPEN as the head pending choice (CR 702.35a). Mirrors
 *  `madness.test.ts`'s own helper plus its `resolveTopOfStack`. */
function openMadnessWindow(
    state: GameState,
    playerId: string,
    cardId: string
): void {
    discardToGraveyard(state, playerId, cardId);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
}

/** Advances to `playerId`'s own upkeep, where `fireDelayedTriggers` runs, and
 *  resolves the rebound reflexive trigger — leaving the cast window OPEN as the
 *  head pending choice (CR 702.88a). Mirrors `rebound.test.ts`'s helper. */
function openReboundWindow(state: GameState, playerId: string): void {
    for (let i = 0; i < 40; i++) {
        if (state.phase === "UPKEEP" && state.activePlayerId === playerId)
            break;
        advancePhase(state);
    }
    resolveTopOfStack(state);
}

const castMoves = (moves: Move[]) =>
    moves.filter((m) => m.kind === "cast-spell");

describe("Madness cast window as a search node (CR 702.35a, issue #2983)", () => {
    /** Anje's Ravager: printed {2}{R}, Madness {1}{R}. Two Mountains is enough
     *  for the madness cost and NOT for the printed one, so the same board
     *  proves both the pricing claim and the affordability gate. */
    function ravagerWindow(mountains: number): GameState {
        const card = makeInstance(anjesRavager.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = Array.from({ length: mountains }, (_, i) =>
            makeInstance(mountain.id, {
                id: `mtn${i}`,
                zone: "battlefield",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [card], battlefield: lands }),
                makePlayer("p2"),
            ],
        });
        openMadnessWindow(state, "p1", card.id);
        return state;
    }

    it("enumerates BOTH the cast and the decline instead of an empty move list", () => {
        const state = ravagerWindow(2);
        expect(state.pendingChoices?.[0]?.kind).toBe("madness-cast");

        const moves = enumerateMoves(state, "p1");
        // The whole point: before this issue the list was empty here.
        expect(moves.length).toBeGreaterThan(1);
        expect(moves.some((m) => m.kind === "madness-decline")).toBe(true);
        expect(castMoves(moves).length).toBeGreaterThan(0);
    });

    it("prices the cast at the MADNESS cost, not the printed one", () => {
        // Anje's Ravager: printed {2}{R} (three mana), Madness {1}{R} (two).
        // With THREE Mountains both costs are affordable, so "a cast exists" no
        // longer proves anything — the TAP PLAN is what discriminates: exactly
        // two lands tapped is the madness cost, three would be the printed one.
        // This is the acceptance criterion "the Bot's plan matches what the
        // real cast-announcement mutation charges": both sides read the one
        // authority, `castRawManaCost` (gre/castCost.ts).
        const state = ravagerWindow(3);
        const cast = castMoves(enumerateMoves(state, "p1"));
        expect(cast.length).toBeGreaterThan(0);
        for (const m of cast) {
            if (m.kind !== "cast-spell") continue;
            expect(m.castFromZone).toBe("exile");
            expect(m.tapPlan).toHaveLength(2);
        }
    });

    it("FAILS CLOSED — an unaffordable madness cost emits the decline alone", () => {
        // One Mountain cannot pay Madness {1}{R}.
        const state = ravagerWindow(1);
        const moves = enumerateMoves(state, "p1");
        expect(castMoves(moves)).toHaveLength(0);
        expect(moves.map((m) => m.kind)).toEqual(["madness-decline"]);
    });

    it("applies the CAST in the sandbox: the spell reaches the stack and the window closes", () => {
        const state = ravagerWindow(2);
        const cast = castMoves(enumerateMoves(state, "p1"))[0];
        applyMoveInSearch(state, "p1", cast);

        expect(state.stack).toHaveLength(1);
        // CR 702.35a — the window is consumed by the accept, exactly as
        // `announceCast` consumes it; leaving it open would re-offer the
        // window's candidates for a card that has already left exile.
        expect(state.madnessCastWindow).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("applies the DECLINE in the sandbox: the card is binned and the window closes", () => {
        const state = ravagerWindow(2);
        applyMoveInSearch(state, "p1", { kind: "madness-decline" });

        const p1 = getPlayer(state, "p1");
        // CR 702.35a — "or put it into their graveyard".
        expect(p1.graveyard.some((c) => c.card.id === anjesRavager.id)).toBe(
            true
        );
        expect(p1.exile).toHaveLength(0);
        expect(state.madnessCastWindow).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("FAILS CLOSED under a cast LOCK the cost check alone cannot see", () => {
        // CR 601.3a (Xantid Swarm / Abeyance) — the discriminating case for the
        // generator's own legality gate. The madness cost is affordable and the
        // card has no targets to miss, so `enumerateCastMoves` would build the
        // cast happily; only `getLegalActions` knows the cast is prohibited.
        // Without that gate the Bot plans a cast the `announceCast` mutation
        // rejects, which is precisely the "never offer a cast the executor
        // cannot complete" criterion.
        const state = ravagerWindow(2);
        state.cannotCastSpellsThisTurn = [{ playerId: "p1" }];

        const moves = enumerateMoves(state, "p1");
        expect(castMoves(moves)).toHaveLength(0);
        expect(moves.map((m) => m.kind)).toEqual(["madness-decline"]);
    });

    it("opens the CAST above the decline — the halves are not equal budget", () => {
        // The issue's "a prior so the search does not spend equal budget on an
        // obviously bad half". Madness's decline BINS the card, so the cast is
        // favoured; without a prior branch both halves sit at NEUTRAL_PRIOR and
        // cast-vs-decline is pure rollout noise.
        const state = ravagerWindow(2);
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const decline = cands.find((c) => c.move.kind === "madness-decline")!;
        const cast = cands.find((c) => c.move.kind === "cast-spell")!;
        expect(cast.prior).toBeGreaterThan(decline.prior);
    });

    it("keys both candidates by stable identity, never a per-world instance id", () => {
        const state = ravagerWindow(2);
        const head = state.pendingChoices![0];
        const keys = choiceCandidates(state, head).map((c) => c.key);
        expect(keys).toContain("madness-cast:decline");
        // Contract property 2 (`choiceCandidates.ts`): a key that embedded the
        // exiled card's instance id would split this decision's statistics
        // across determinizations and the node would never accumulate.
        const instanceId = head.cardInstanceId!;
        for (const k of keys) expect(k).not.toContain(instanceId);
    });
});

describe("Rebound cast window as a search node (CR 702.88a, issue #2983)", () => {
    /** Ephemerate ({W} Instant, Rebound) resolved from hand and exiled, with
     *  `hasTarget` deciding whether its free recast has a legal target — the
     *  discriminator for the fail-closed claim. */
    function ephemerateWindow(hasTarget: boolean): GameState {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: hasTarget ? [bear] : [] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(
            state,
            ephemerate.id,
            "p1",
            hasTarget ? [{ type: "permanent", id: "bear" }] : []
        );
        item.reboundFromHand = true;
        resolveTopOfStack(state);
        openReboundWindow(state, "p1");
        return state;
    }

    it("enumerates BOTH the free recast and the decline", () => {
        const state = ephemerateWindow(true);
        expect(state.pendingChoices?.[0]?.kind).toBe("rebound-cast");

        const moves = enumerateMoves(state, "p1");
        expect(moves.some((m) => m.kind === "rebound-decline")).toBe(true);
        expect(castMoves(moves).length).toBeGreaterThan(0);
    });

    it("prices the recast at NOTHING and names a target chosen at recast time", () => {
        const state = ephemerateWindow(true);
        const cast = castMoves(enumerateMoves(state, "p1"));
        expect(cast.length).toBeGreaterThan(0);
        for (const m of cast) {
            if (m.kind !== "cast-spell") continue;
            expect(m.castFromZone).toBe("exile");
            // CR 702.88a — Rebound recasts "without paying its mana cost",
            // so the plan taps nothing at all.
            expect(m.tapPlan ?? []).toHaveLength(0);
            expect(m.payLife ?? 0).toBe(0);
            // CR 601.2c — the recast picks a FRESH target at recast time.
            expect(m.targets.length).toBeGreaterThan(0);
        }
    });

    it("FAILS CLOSED — a recast with no legal target emits the decline alone", () => {
        const state = ephemerateWindow(false);
        const moves = enumerateMoves(state, "p1");
        expect(castMoves(moves)).toHaveLength(0);
        expect(moves.map((m) => m.kind)).toEqual(["rebound-decline"]);
    });

    it("applies the DECLINE in the sandbox: the card stays EXILED, not binned", () => {
        const state = ephemerateWindow(true);
        applyMoveInSearch(state, "p1", { kind: "rebound-decline" });

        const p1 = getPlayer(state, "p1");
        // CR 702.88c — "it remains exiled": no zone change, unlike Madness.
        expect(p1.exile.some((c) => c.card.id === ephemerate.id)).toBe(true);
        expect(p1.graveyard.some((c) => c.card.id === ephemerate.id)).toBe(
            false
        );
        expect(state.reboundCastWindow).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("opens the FREE recast well above the decline", () => {
        // CR 702.88a/c — the recast costs nothing and the window never returns,
        // so this half opens higher than Madness's (which still owes mana).
        const state = ephemerateWindow(true);
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const decline = cands.find((c) => c.move.kind === "rebound-decline")!;
        const cast = cands.find((c) => c.move.kind === "cast-spell")!;
        expect(cast.prior).toBeGreaterThan(decline.prior);
    });

    it("applies the CAST in the sandbox: the spell reaches the stack and the window closes", () => {
        const state = ephemerateWindow(true);
        const cast = castMoves(enumerateMoves(state, "p1"))[0];
        applyMoveInSearch(state, "p1", cast);

        expect(state.stack).toHaveLength(1);
        expect(state.reboundCastWindow).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the GREEDY 1-ply sandbox agrees with the ISMCTS tree (PR #2995 review finding 4)", () => {
        // `applyMoveForSearch` listed both declines among its no-ops, under a
        // comment reasoning that they "never reach the search anyway —
        // `enumerateMoves` returns [] while a choice is pending". Registering
        // the generators made that false. The two sandboxes disagreeing about
        // what a move DOES is the issue-#2473 class, so this pins them equal on
        // the two facts that matter: the window closes, and the card is gone
        // from exile the way CR 702.88c says (still exiled) — asserted here on
        // the greedy leaf, which no other test drives.
        const state = ephemerateWindow(true);
        const after = applyMoveForSearch(state, "p1", {
            kind: "rebound-decline",
        });
        expect(after.reboundCastWindow).toBeUndefined();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        const p1 = getPlayer(after, "p1");
        expect(p1.exile.some((c) => c.card.id === ephemerate.id)).toBe(true);
        expect(p1.graveyard.some((c) => c.card.id === ephemerate.id)).toBe(
            false
        );
        // Pure: the caller's state is untouched (this leaf clones).
        expect(state.reboundCastWindow).toBeDefined();
    });

    it("keeps BOTH same-named targets as distinct branches (PR #2995 review finding 1)", () => {
        // The candidate KEY once collapsed a target to its card NAME, on the
        // claim that two permanents sharing a name are interchangeable. They
        // are not — and the collapse did not merely share a statistics key: the
        // generator's `seen` set DROPS a colliding candidate, so with two
        // Grizzly Bears exactly one Ephemerate cast survived and the Bot could
        // not choose which to blink. The two differ here the way they would in
        // a real game (one tapped and damaged), which is precisely the state a
        // name-only key cannot see.
        const state = ephemerateWindow(true);
        const p1 = getPlayer(state, "p1");
        const second = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        second.isTapped = true;
        second.damageMarked = 1;
        p1.battlefield.push(second);

        const casts = castMoves(enumerateMoves(state, "p1"));
        expect(casts).toHaveLength(2);
        const targeted = casts.flatMap((m) =>
            m.kind === "cast-spell" ? m.targets.map((t) => t.id) : []
        );
        expect(new Set(targeted)).toEqual(new Set(["bear", "bear2"]));
    });

    it("never lets the top-K slice cut the DECLINE (PR #2995 review finding 2)", () => {
        // `choiceCandidates` slices the node to CHOICE_TOP_K by prior, and
        // every cast variant carries the same prior — strictly above the
        // decline's. With enough legal targets the decline sorted last and was
        // cut, leaving the tree with no branch in which the Bot declines at
        // all. Nine distinctly-identified blink targets is past the K=8 ceiling.
        const state = ephemerateWindow(true);
        const p1 = getPlayer(state, "p1");
        for (let i = 0; i < 9; i++) {
            p1.battlefield.push(
                makeInstance(grizzlyBears.id, {
                    id: `extra${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                })
            );
        }

        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.length).toBeLessThanOrEqual(CHOICE_TOP_K);
        expect(cands.some((c) => c.move.kind === "rebound-decline")).toBe(true);
    });
});
