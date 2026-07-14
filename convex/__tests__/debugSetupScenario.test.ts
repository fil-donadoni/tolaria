// debugSetupScenario admin gate (issue #768). The mutation
// (`convex/game.ts`) calls `assertIsAdmin(ctx)` as the FIRST statement of its
// handler, before any board state is touched — an arbitrary logged-in caller
// must not be able to overwrite another user's game (clear hands/battlefield,
// reseat cards, set life/mana). The project has no convex-test harness (see
// `convex/__tests__/adminAuth.test.ts`, `convex/__tests__/decks.test.ts`), so
// this asserts the same pure decision `assertIsAdmin` is built from —
// `isAdminUser` — mirroring the `deletePreset` admin-gate test convention.
import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import type { Doc } from "../_generated/dataModel";

function user(isAdmin?: boolean): Doc<"users"> {
    return {
        _id: "user_1" as Doc<"users">["_id"],
        _creationTime: 0,
        nickname: "Tester",
        isAdmin,
    } as Doc<"users">;
}

describe("debugSetupScenario — admin gate (issue #768)", () => {
    it("rejects a non-admin caller (assertIsAdmin throws before state is touched)", () => {
        expect(isAdminUser(user(false))).toBe(false);
        expect(isAdminUser(user(undefined))).toBe(false);
    });

    it("rejects an unauthenticated caller", () => {
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin caller through the gate (scenario setup proceeds unchanged)", () => {
        expect(isAdminUser(user(true))).toBe(true);
    });
});
