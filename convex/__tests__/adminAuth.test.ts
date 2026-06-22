// Admin predicate (PRD #466, ADR 0033). `assertIsAdmin` wraps the pure
// `isAdminUser` so the gate is unit-testable without a Convex harness (the
// project has no convex-test harness — pure helpers are tested directly).
import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import type { Doc } from "../_generated/dataModel";

function user(overrides: Partial<Doc<"users">> = {}): Doc<"users"> {
    return {
        _id: "user_1" as Doc<"users">["_id"],
        _creationTime: 0,
        nickname: "Tester",
        ...overrides,
    };
}

describe("isAdminUser (ADR 0033)", () => {
    it("passes a user explicitly flagged isAdmin: true", () => {
        expect(isAdminUser(user({ isAdmin: true }))).toBe(true);
    });

    it("rejects a user with isAdmin: false", () => {
        expect(isAdminUser(user({ isAdmin: false }))).toBe(false);
    });

    it("rejects a user with no isAdmin flag (legacy row)", () => {
        expect(isAdminUser(user())).toBe(false);
    });

    it("rejects a missing user (unauthenticated)", () => {
        expect(isAdminUser(null)).toBe(false);
    });
});
