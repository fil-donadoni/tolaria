// Lobby admin gating (PRD #466, ADR 0033). The preset Edit control is shown
// only to admins; the predicate is pure and unit-tested so the gate can't
// silently regress (the server still enforces it via assertIsAdmin).
import { describe, it, expect } from "vitest";
import {
    canEditPresets,
    canSubmitVerdicts,
    canViewLimitedReviewDetail,
    canViewAdminSection,
} from "../adminGating";

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

describe("canViewLimitedReviewDetail (issue #1583)", () => {
    it("allows a user flagged isAdmin: true", () => {
        expect(canViewLimitedReviewDetail({ isAdmin: true })).toBe(true);
    });

    it("hides for a non-admin user", () => {
        expect(canViewLimitedReviewDetail({ isAdmin: false })).toBe(false);
        expect(canViewLimitedReviewDetail({})).toBe(false);
    });

    it("hides while the user is loading (undefined)", () => {
        expect(canViewLimitedReviewDetail(undefined)).toBe(false);
    });

    it("hides when signed out (null)", () => {
        expect(canViewLimitedReviewDetail(null)).toBe(false);
    });
});

describe("canViewAdminSection (ADR 0074, admin-only section)", () => {
    it("allows a user flagged isAdmin: true", () => {
        expect(canViewAdminSection({ isAdmin: true })).toBe(true);
    });

    it("hides for a non-admin user", () => {
        expect(canViewAdminSection({ isAdmin: false })).toBe(false);
        expect(canViewAdminSection({})).toBe(false);
    });

    it("hides while the user is loading (undefined)", () => {
        // Fail CLOSED while `useCurrentUser()` is in flight: an admin sees a
        // one-frame "checking access" line, a non-admin never sees a frame of
        // the workbench (and, decisively, never mounts the hooks that call
        // the admin-gated queries).
        expect(canViewAdminSection(undefined)).toBe(false);
    });

    it("hides when signed out (null)", () => {
        expect(canViewAdminSection(null)).toBe(false);
    });
});

describe("canSubmitVerdicts (issue #3402)", () => {
    it("is true for a flagged tester", () => {
        expect(canSubmitVerdicts({ isTester: true })).toBe(true);
    });

    it("is true for an admin with no tester flag", () => {
        // The fold that matters: the role is granted from the admin area, so
        // an admin who did not count as a tester would have to grant it to
        // themselves first. Mirrors `isTesterUser` (`convex/auth.ts`).
        expect(canSubmitVerdicts({ isAdmin: true })).toBe(true);
    });

    it("is false for a regular player, and for a revoked tester", () => {
        expect(canSubmitVerdicts({})).toBe(false);
        expect(canSubmitVerdicts({ isTester: false })).toBe(false);
    });

    it("fails closed while the user query is in flight, and when signed out", () => {
        expect(canSubmitVerdicts(undefined)).toBe(false);
        expect(canSubmitVerdicts(null)).toBe(false);
    });
});
