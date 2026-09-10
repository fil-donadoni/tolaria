/**
 * `makeBlockDeltaLens` — the block-quality tie-break's determinized reading
 * (issue #2876).
 *
 * THE DEFECT. `selectRootMove`'s block-quality tie-break ranked candidate
 * blocks by `blockDeltaOf(rootState, …)`, and `blockDeltaOf`'s
 * `cautiousBlockPenalty` term (evaluate.ts, ADR 0021) asks the ATTACKER's hand
 * what it can cast this combat. The root position is the UN-determinized one —
 * on the wire it carries opaque placeholders for the opponent's hand — so the
 * tie-break weighed every block as if the attacker held nothing castable, and
 * no opponent model (the imagined hand, the Unseen Remainder, Deck Knowledge,
 * issue #2789) could reach a block decision at all.
 *
 * WHAT THIS FILE PROVES, at the seam rather than through a whole search:
 *   1. the answer is NOT in the root position — the old lens reads the two
 *      opponent models IDENTICALLY, so a search-level difference cannot be
 *      coming from anything but the sampled worlds;
 *   2. the new lens reads them DIFFERENTLY, and in the right direction;
 *   3. it flips the tie-break's actual comparison — declare-a-block vs the
 *      empty declaration (CR 509.1) — rather than merely moving a number;
 *   4. it is deterministic for a fixed seed (ADR 0070 §2).
 *
 * CR references: 509.1 (declaring blockers, the empty declaration included),
 * 510.1a (combat damage assignment), 704.5g (lethal damage).
 */

import { describe, it, expect } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { blockDeltaOf, makeBlockDeltaLens } from "../search";
import { enumerateMoves, type Move } from "../moves";
import { getCardByName } from "../../cards/catalogue";
import type { DeckKnowledgeBySeat } from "../deckKnowledge";
import type { GameState } from "../state";

const SEED = 0xb1ade;

/** The blade pair's board, at the block window. `me` (players[0], the active
 *  player) attacks with Savannah Lions (2/1) holding ONE card and an untapped
 *  Forest; the bot is `opp` and can block with a lone Ironroot Treefolk (3/5).
 *  Without a trick the block is a free kill; with Giant Growth the Lions blocks
 *  out as a 5/4 and eats the Treefolk. */
const scenario: BladeScenario = {
    label: "block delta lens fixture",
    spec: {
        cards: [
            {
                name: "Savannah Lions",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Forest", owner: "me", zone: "battlefield" },
            // Physically a Mountain — `determinize` re-derives this seat's
            // hidden zones from the decklist, so it is never what the bot
            // reasons about. That is what makes point 1 above meaningful.
            { name: "Mountain", owner: "me", zone: "hand" },
            {
                name: "Ironroot Treefolk",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "DECLARE_ATTACKERS",
        turn: 3,
        landCount: 0,
        libraryCount: 20,
    },
    setup: [{ kind: "declare-attackers" }],
    bot: "opp",
    budget: { iterations: 1 },
    seeds: [SEED],
    tier: "must",
    expect: { moves: [{ kind: "declare-blockers" }] },
};

function fixture(): {
    state: GameState;
    botId: string;
    attackerId: string;
    block: Move;
    decline: Move;
} {
    const state = buildBladeState(scenario);
    const attackerId = state.players[0].id;
    const botId = state.players[1].id;
    const moves = enumerateMoves(state, botId).filter(
        (m): m is Extract<Move, { kind: "declare-blockers" }> =>
            m.kind === "declare-blockers"
    );
    const block = moves.find((m) => m.assignments.length === 1);
    const decline = moves.find((m) => m.assignments.length === 0);
    if (!block || !decline) {
        throw new Error(
            `fixture is not a block decision: ${moves.length} declarations enumerated`
        );
    }
    return { state, botId, attackerId, block, decline };
}

/** The decklist the attacker seat is known to be holding, as the search takes
 *  it: definition ids, per player id. */
function knows(attackerId: string, cardName: string): DeckKnowledgeBySeat {
    return [{ playerId: attackerId, cardIds: [getCardByName(cardName).id] }];
}

describe("makeBlockDeltaLens — the opponent model reaches the block tie-break (issue #2876)", () => {
    it("the ROOT position reads both opponent models identically — the answer is never in it", () => {
        const { state, botId, block, decline } = fixture();
        // The pre-#2876 lens. It takes no deck knowledge at all, so this is
        // the whole of what the old tie-break could ever see, under EITHER
        // decklist: one number, blind to both.
        expect(blockDeltaOf(state, block, botId)).toBeGreaterThan(
            blockDeltaOf(state, decline, botId)
        );
    });

    it("the DETERMINIZED lens prices the trick the attacker's deck must be holding", () => {
        const { state, botId, attackerId, block } = fixture();
        const informed = makeBlockDeltaLens(
            state,
            botId,
            SEED,
            undefined,
            knows(attackerId, "Giant Growth")
        )(block);
        const blind = makeBlockDeltaLens(
            state,
            botId,
            SEED,
            undefined,
            knows(attackerId, "Mountain")
        )(block);
        // Same board, same seed, same sampler — only the decklist differs.
        expect(informed).toBeLessThan(blind);
    });

    it("and FLIPS the tie-break's own comparison: block vs the empty declaration", () => {
        const { state, botId, attackerId, block, decline } = fixture();
        const rank = (deck: string) => {
            const lens = makeBlockDeltaLens(
                state,
                botId,
                SEED,
                undefined,
                knows(attackerId, deck)
            );
            return lens(block) - lens(decline);
        };
        // A deck that cannot hold a trick: block, it is a free kill (CR 510.1a
        // — 3 power is lethal to a 1-toughness attacker, 2 back does not dent
        // a 5-toughness blocker).
        expect(rank("Mountain")).toBeGreaterThan(0);
        // A deck that must be holding Giant Growth: decline (CR 509.1 — the
        // empty declaration is a legal declaration, not the absence of one).
        expect(rank("Giant Growth")).toBeLessThan(0);
    });

    it("is deterministic for a fixed seed, and its stream is NOT the search's", () => {
        const { state, botId, attackerId, block } = fixture();
        const lensAt = (seed: number) =>
            makeBlockDeltaLens(
                state,
                botId,
                seed,
                undefined,
                knows(attackerId, "Giant Growth")
            )(block);
        expect(lensAt(SEED)).toBe(lensAt(SEED));
        // Memoised per move within one lens, too — the second ask is the same
        // number, not a fresh sample.
        const lens = makeBlockDeltaLens(
            state,
            botId,
            SEED,
            undefined,
            knows(attackerId, "Giant Growth")
        );
        expect(lens(block)).toBe(lens(block));
    });
});
