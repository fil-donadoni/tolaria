// CR 401.4 look-and-distribute as a SETTLE and a choice node (issue #4899).
//
// `look-distribute` had no candidate generator, so `choiceCandidates` answered
// `[]` and every settle stopped at the keep: the 1-ply policy probe
// (`policyProbeState`) handed back the resolution as it was, and an Op of the
// same resolution AFTER the keep — Thassa's Oracle's win check, CR 104.2b —
// never reached a scored state. The cast read as a 1/3 body.
//
// Two seams, pinned here:
//
//  1. the settle: a look-distribute-then-payoff script resolves THROUGH the
//     mover's keep, and the payoff is in the probed state;
//  2. the generator (`choiceCandidates` for the kind): the empty keep only
//     when the count admits it, one candidate led by each distinct
//     keep-eligible identity, the owner's best first (worst first when an
//     opponent chooses), and nothing at all when the looked-at window is no
//     longer the library's top run.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { GameState, PendingChoice } from "../../state";
import { cloneGameState } from "../../clone";
import { enumerateMoves } from "../../moves";
import { applyMoveInSearch, policyProbeState } from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import { findBladeScenario } from "../blade/registry";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { choiceCandidates, stableCardIdentity } from "../choiceCandidates";
import { libraryTargetWorth } from "../candidateValue";
import { isCategorizedPickLegal } from "../../categorizedPick";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";

const THASSA_ENTRY =
    "alternate win: casts Thassa's Oracle when its trigger wins on the spot";

describe("look-distribute settle (CR 401.4, issue #4899)", () => {
    it("the 1-ply probe answers the keep and reaches the win check after it (CR 104.2b)", () => {
        const entry = findBladeScenario(THASSA_ENTRY);
        if (!entry) throw new Error(`no blade entry "${THASSA_ENTRY}"`);
        const s = buildPositionFromSpec(entry.spec);
        const me = s.activePlayerId;
        const oracleId = getCardByName("Thassa's Oracle").id;
        const cast = enumerateMoves(s, me).find(
            (m) =>
                m.kind === "cast-spell" &&
                s.players
                    .find((p) => p.id === me)!
                    .hand.some(
                        (c) =>
                            c.id === m.cardInstanceId &&
                            (c.card as { id?: string }).id === oracleId
                    )
        );
        if (!cast) throw new Error("Thassa's Oracle is not castable here");
        const probe = cloneGameState(s);
        applyMoveInSearch(probe, me, cast);

        const settled = policyProbeState(probe, cast, DEFAULT_EVAL_WEIGHTS, me);

        expect(settled.gameOver?.winnerId).toBe(me);
        expect(settled.stack).toHaveLength(0);
        expect(settled.pendingChoices ?? []).toHaveLength(0);
    });
});

/** A library of `names` (top first) for p1, and a `look-distribute` choice
 *  over its top `window` cards. */
function lookPosition(
    names: string[],
    window: number,
    choice: Partial<PendingChoice>
): { state: GameState; choice: PendingChoice } {
    const library = names.map((n, i) =>
        makeInstance(getCardByName(n).id, { id: `lib-${i}`, ownerId: "p1" })
    );
    const state = makeState({
        players: [makePlayer("p1", { library }), makePlayer("p2")],
    });
    const head = {
        stackItemId: "item-1",
        step: 0,
        choiceId: "dig-to-hand",
        playerId: "p1",
        kind: "look-distribute",
        zone: "library",
        count: { min: 1, max: 1 },
        prompt: "keep one",
        candidateIds: library.slice(0, window).map((c) => c.id),
        destination: "library-bottom",
        ...choice,
    } as PendingChoice;
    state.pendingChoices = [head];
    return { state, choice: head };
}

/** The looked-at card the OWNER values most / least, by the generator's own
 *  ranking authority (`libraryTargetWorth`). */
function ownerExtremes(state: GameState, choice: PendingChoice) {
    const window = state.players[0].library.filter((c) =>
        choice.candidateIds!.includes(c.id)
    );
    const ranked = [...window].sort(
        (a, b) =>
            libraryTargetWorth(state, "p1", b) -
            libraryTargetWorth(state, "p1", a)
    );
    return {
        best: `look-distribute:${stableCardIdentity(ranked[0])}`,
        worst: `look-distribute:${stableCardIdentity(ranked.at(-1)!)}`,
    };
}

const keptIds = (c: { move: { kind: string } }): string[] =>
    (c.move as { cardInstanceIds: string[] }).cardInstanceIds;

describe("look-distribute candidates (CR 401.4, issue #4899)", () => {
    const names = ["Grizzly Bears", "Serra Angel", "Island", "Craw Wurm"];

    it("a mandatory keep offers no empty answer, one lead per distinct identity, best first", () => {
        const { state, choice } = lookPosition(names, 3, {});
        const cands = choiceCandidates(state, choice);
        expect(cands.map((c) => c.key)).not.toContain("look-distribute:none");
        expect(cands).toHaveLength(3);
        // Only the looked-at window is ever kept — never the card under it.
        for (const c of cands) {
            expect(keptIds(c)).toHaveLength(1);
            expect(choice.candidateIds).toContain(keptIds(c)[0]);
        }
        const { best, worst } = ownerExtremes(state, choice);
        expect(best).not.toBe(worst);
        expect(cands[0].key).toBe(best);
    });

    it("an optional keep ('up to one') also offers keeping nothing", () => {
        const { state, choice } = lookPosition(names, 3, {
            count: { min: 0, max: 1 },
        });
        const keys = choiceCandidates(state, choice).map((c) => c.key);
        expect(keys).toHaveLength(4);
        // The prior is flat for this kind, so this order IS the opening
        // order: the best keep first, keeping nothing last.
        expect(keys.at(-1)).toBe("look-distribute:none");
        expect(keys[0]).toBe(ownerExtremes(state, choice).best);
    });

    it("a categorised keep (Atraxa) only offers keeps with a card-to-category assignment", () => {
        const window = ["Grizzly Bears", "Serra Angel", "Craw Wurm"];
        const { state, choice } = lookPosition(window, 3, {
            count: { min: 0, max: 2 },
        });
        // Every card is a "Creature"; only the owner's WORST card also fills
        // the second category. The two best cards together are then
        // illegal (both can only be the Creature), and that pair is exactly
        // what an unguarded greedy fill from the best lead would submit.
        const byWorth = [...state.players[0].library].sort(
            (a, b) =>
                libraryTargetWorth(state, "p1", b) -
                libraryTargetWorth(state, "p1", a)
        );
        choice.categories = [
            { label: "Creature", cardIds: byWorth.map((c) => c.id) },
            { label: "Other", cardIds: [byWorth[2].id] },
        ];
        const cands = choiceCandidates(state, choice).filter(
            (c) => keptIds(c).length > 0
        );
        expect(cands.length).toBeGreaterThan(0);
        expect(cands.some((c) => keptIds(c).length === 2)).toBe(true);
        for (const c of cands) {
            expect(isCategorizedPickLegal(choice.categories, keptIds(c))).toBe(
                true
            );
        }
    });

    it("only `eligibleIds` may be kept (Narset's filtered keep)", () => {
        const { state, choice } = lookPosition(names, 3, {
            eligibleIds: ["lib-0"],
        });
        const cands = choiceCandidates(state, choice);
        expect(cands.map(keptIds)).toEqual([["lib-0"]]);
    });

    it("an opponent choosing from the owner's window leads with the owner's WORST card", () => {
        const { state, choice } = lookPosition(names, 3, {
            playerId: "p2",
            zoneOwnerId: "p1",
        });
        const cands = choiceCandidates(state, choice);
        const { best, worst } = ownerExtremes(state, choice);
        expect(cands[0].key).toBe(worst);
        expect(cands.at(-1)?.key).toBe(best);
    });

    it("a window that is no longer the library's top run yields nothing", () => {
        const { state, choice } = lookPosition(names, 3, {});
        const p1 = state.players[0];
        p1.library = [p1.library[3], ...p1.library.slice(0, 3)];
        expect(choiceCandidates(state, choice)).toEqual([]);
    });
});
