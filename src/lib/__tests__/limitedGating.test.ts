// Limited Events create gating (PRD #1107 story 1, ADR 0054/0055). Hosting a
// table is a normal player action: the control is offered to EVERY signed-in
// user, not only to admins — the predicate is pure and unit-tested so the gate
// can't silently regress back to admin-only (the server matches it:
// `createLimitedEvent` requires an authenticated caller, nothing more).
import { describe, it, expect } from "vitest";
import { canCreateLimitedEvents } from "../limitedGating";

describe("canCreateLimitedEvents (PRD #1107 story 1, ADR 0054/0055)", () => {
    it("allows any signed-in user, admin or not", () => {
        expect(canCreateLimitedEvents({ _id: "user1" })).toBe(true);
    });

    it("allows a user with no admin flag (the ordinary case)", () => {
        expect(canCreateLimitedEvents({})).toBe(true);
    });

    it("hides while the user is loading (undefined)", () => {
        expect(canCreateLimitedEvents(undefined)).toBe(false);
    });

    it("hides when signed out (null)", () => {
        expect(canCreateLimitedEvents(null)).toBe(false);
    });
});
