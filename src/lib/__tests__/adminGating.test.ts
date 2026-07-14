// Lobby admin gating (PRD #466, ADR 0033). The preset Edit control is shown
// only to admins; the predicate is pure and unit-tested so the gate can't
// silently regress (the server still enforces it via assertIsAdmin).
import { describe, it, expect } from "vitest";
import { canCreateLimitedEvents, canEditPresets } from "../adminGating";

describe("canEditPresets (ADR 0033)", () => {
    it("allows a user flagged isAdmin: true", () => {
        expect(canEditPresets({ isAdmin: true })).toBe(true);
    });

    it("hides for a non-admin user", () => {
        expect(canEditPresets({ isAdmin: false })).toBe(false);
        expect(canEditPresets({})).toBe(false);
    });

    it("hides while the user is loading (undefined)", () => {
        expect(canEditPresets(undefined)).toBe(false);
    });

    it("hides when signed out (null)", () => {
        expect(canEditPresets(null)).toBe(false);
    });
});

describe("canCreateLimitedEvents (PRD #1107 story 1, ADR 0054/0055)", () => {
    it("allows a user flagged isAdmin: true", () => {
        expect(canCreateLimitedEvents({ isAdmin: true })).toBe(true);
    });

    it("hides for a non-admin user", () => {
        expect(canCreateLimitedEvents({ isAdmin: false })).toBe(false);
        expect(canCreateLimitedEvents({})).toBe(false);
    });

    it("hides while the user is loading (undefined)", () => {
        expect(canCreateLimitedEvents(undefined)).toBe(false);
    });

    it("hides when signed out (null)", () => {
        expect(canCreateLimitedEvents(null)).toBe(false);
    });
});
