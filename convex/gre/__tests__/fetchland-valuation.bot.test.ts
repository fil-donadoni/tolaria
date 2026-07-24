// Fetchland subtree valuation (issue #1499, ADR 0070 §5).
//
// A fetchland has NO mana ability (CR 305.6 — its only ability is "search your
// library", never a mana ability). The bot's coarse mana proxy USED to count
// every untapped land as a mana source (`isLand(perm) || hasManaAbility(perm)`),
// so a Polluted Delta was scored as a usable {U} source it is not. Cracking it
// then read as a PURE 1-life loss with no offsetting gain — the phantom source
// it sacrificed was already counted, and the real land it fetched merely
// replaced that phantom — so the bot converged AWAY from a forced crack as
// search deepened (a mis-valued subtree, not a horizon/priors shortfall).
//
// The fix scores a source only if it can ACTUALLY produce mana
// (`isUntappedManaSource`). This suite pins the three levels the fix touches:
// the predicate's NARROW support (on-pattern non-zero, off-pattern exactly
// zero), the corrected LEAF value of the fetch subtree, and the SEARCH
// convergence at and above the production budget.

import { describe, expect, it } from "vitest";
import { makeInstance } from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { isLand, hasManaAbility, isUntappedManaSource } from "../constants";
import { evaluate } from "../evaluate";
import { buildBladeState } from "../ai/blade/runner";
import { findBladeScenario } from "../ai/blade/registry";
import { searchWithTrace } from "../search";
import { seatPlayerId } from "../ai/blade/matcher";
import type { CardInstanceState, GameState } from "../state";

const FETCH_LABEL =
    "charter: cracks its fetchland for the only answer to a trigger on the stack";

/** The pre-#1499 predicate, inlined, so the test can assert exactly where the
 *  new predicate DIVERGES from it (on-pattern) and where it AGREES (off). */
function oldPredicate(card: CardInstanceState): boolean {
    return !card.isTapped && (isLand(card) || hasManaAbility(card));
}

describe("isUntappedManaSource — narrow support (CR 305.6 / 605.1a, issue #1499)", () => {
    const delta = makeInstance(getCardByName("Polluted Delta").id, {
        zone: "battlefield",
        isTapped: false,
    });
    const island = makeInstance(getCardByName("Island").id, {
        zone: "battlefield",
        isTapped: false,
    });
    const plains = makeInstance(getCardByName("Plains").id, {
        zone: "battlefield",
        isTapped: false,
    });

    it("ON-PATTERN: a fetchland is NOT a mana source, and the fix DIVERGES from the old predicate", () => {
        // The new predicate excludes it (it produces no mana)…
        expect(isUntappedManaSource(delta)).toBe(false);
        // …while the old predicate counted it (isLand → true). The divergence
        // is the fix's entire, non-zero on-pattern effect.
        expect(oldPredicate(delta)).toBe(true);
        expect(isUntappedManaSource(delta)).not.toBe(oldPredicate(delta));
    });

    it("OFF-PATTERN: an ordinary land is a source, and the fix AGREES with the old predicate (exactly zero delta)", () => {
        for (const land of [island, plains]) {
            expect(isUntappedManaSource(land)).toBe(true);
            expect(isUntappedManaSource(land)).toBe(oldPredicate(land));
        }
    });

    it("a TAPPED fetchland or basic is a source for neither predicate", () => {
        const tappedDelta = { ...delta, isTapped: true };
        const tappedIsland = { ...island, isTapped: true };
        expect(isUntappedManaSource(tappedDelta)).toBe(false);
        expect(isUntappedManaSource(tappedIsland)).toBe(false);
    });
});

/** Rebuild the exact post-fetch board the issue's discriminator describes:
 *  the Polluted Delta gone, an untapped Island in its place, one life paid. */
function reconstructPostFetch(pre: GameState, botId: string): GameState {
    const post: GameState = structuredClone(pre);
    const me = post.players.find((p) => p.id === botId)!;
    const deltaId = getCardByName("Polluted Delta").id;
    const islandId = getCardByName("Island").id;
    me.battlefield = me.battlefield.filter(
        (c) => (c.card as { id?: string }).id !== deltaId
    );
    me.library = me.library.filter(
        (c) => (c.card as { id?: string }).id !== islandId
    );
    me.life -= 1;
    me.battlefield.push(
        makeInstance(islandId, {
            id: "post-fetch-island",
            zone: "battlefield",
            isTapped: false,
            controllerId: botId,
            ownerId: botId,
        })
    );
    return post;
}

describe("fetch subtree leaf value (issue #1499)", () => {
    it("cracking the fetchland is valued as a GAIN, not a pure life loss", () => {
        const scenario = findBladeScenario(FETCH_LABEL)!;
        const pre = buildBladeState(scenario);
        const botId = seatPlayerId(pre, scenario.bot);
        const post = reconstructPostFetch(pre, botId);

        const preEval = evaluate(pre, botId);
        const postEval = evaluate(post, botId);

        // The post-fetch board scores strictly HIGHER: a real mana source
        // arrives (+W_MANA) and Stifle becomes castable (+flexibility), which
        // together outweigh the 1 life paid. Before the fix the phantom Delta
        // source made this delta NEGATIVE (−W_LIFE, a pure life loss).
        expect(postEval).toBeGreaterThan(preEval);
    });
});

describe("fetch charter search convergence (issue #1499)", () => {
    const scenario = findBladeScenario(FETCH_LABEL)!;
    const registrySeeds = scenario.seeds!;

    // Monotone in budget: correct at the production budget (400) AND above it
    // (1600). The pre-fix bot converged AWAY as budget rose (0/8 at 3200) — a
    // mis-valued subtree; this asserts the residue is gone.
    for (const iterations of [400, 1600]) {
        it(`cracks the Delta on every registry seed at ${iterations} iterations`, () => {
            for (const seed of registrySeeds) {
                const state = buildBladeState(scenario);
                const botId = seatPlayerId(state, scenario.bot);
                const { move } = searchWithTrace(
                    state,
                    botId,
                    { iterations },
                    seed
                );
                expect(
                    move?.kind,
                    `seed ${seed} at ${iterations} chose ${move?.kind ?? "[no move]"}`
                ).toBe("activate-ability");
            }
        });
    }
});
