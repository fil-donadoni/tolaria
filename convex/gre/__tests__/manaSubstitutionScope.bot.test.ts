/**
 * Bot reachability for the activation-scoped mana substitution (CR 609.4b /
 * 602.1, issue #2944). Split from `manaSubstitutionScope.test.ts` because it
 * imports `convex/gre/moves` and so belongs to the bot suite
 * (`bot-suite-boundary.test.ts`); both halves drive the same probe definitions
 * from `fixtures/manaSubstitutionScopeProbe`.
 *
 * A card the GRE pays correctly but the Bot never enumerates is unshipped, and
 * nothing else in the suite goes red on it: the censuses cover VALUATION only.
 */

import { describe, expect, it } from "vitest";
import { enumerateMoves, planManaPayment } from "../moves";
import { getPlayer } from "../state";
import { normalizeManaCost } from "../state";
import type { ManaCost } from "../../cards/types";
import { makeInstance } from "../../cards/__tests__/setup";
import { forest } from "../../cards/sets/lea";
import { board } from "./fixtures/manaSubstitutionScopeProbe";

describe("Bot reachability — the planner sees the same permission", () => {
    it("plans a {R} ability cost off a Forest, and only for the scoped source", () => {
        const { state, creature, artifact } = board();
        const player = getPlayer(state, "p1");
        player.battlefield.push(makeInstance(forest.id, { id: "forest-1" }));
        const cost = normalizeManaCost({ R: 1 } as ManaCost);

        expect(
            planManaPayment(state, player, cost, undefined, creature)
        ).toEqual([{ cardInstanceId: "forest-1" }]);
        // The artifact's identical ability is outside the permission, and a
        // caller naming no source (morph, a special action) is too.
        expect(
            planManaPayment(state, player, cost, undefined, artifact)
        ).toBeNull();
        expect(planManaPayment(state, player, cost)).toBeNull();
    });

    it("ENUMERATES the activation, so the Brain can actually play it", () => {
        // The seam the planner is reached THROUGH (`enumerateMoves` ->
        // `enumerateActivateAbilityMoves`): a plan the planner could make but
        // the enumerator never asks for is a move the Bot never sees, and no
        // suite goes red on it.
        const { state } = board();
        const player = getPlayer(state, "p1");
        player.battlefield.push(makeInstance(forest.id, { id: "forest-1" }));

        const abilityMoves = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "activate-ability"
        );
        // The creature's {R} ability is reachable off a Forest ...
        expect(
            abilityMoves.some((m) => m.cardInstanceId === "creature-1")
        ).toBe(true);
        // ... the artifact's identical one is not (outside the permission).
        expect(
            abilityMoves.some((m) => m.cardInstanceId === "artifact-1")
        ).toBe(false);
    });
});
