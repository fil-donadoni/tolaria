// Per-user Settings store (issue #2595, PRD #2405 slice 16/16): density,
// motion, and the card-preview Oracle/Printed default. The project has no
// convex-test harness (see `decks.test.ts`'s header note), so this drives
// the two pure functions the `query`/`mutation` handlers in `../userSettings`
// are thin passthroughs to.
import { describe, it, expect } from "vitest";
import { projectUserSettings, resolveUserSettingsWrite } from "../userSettings";
import type { Doc, Id } from "../_generated/dataModel";

const USER_ID = "user-1" as Id<"users">;

function makeRow(
    patch: Partial<Doc<"userSettings">> = {}
): Doc<"userSettings"> {
    return {
        _id: "settings-1" as Id<"userSettings">,
        _creationTime: 0,
        userId: USER_ID,
        density: "compact",
        motion: "reduced",
        previewPreference: "printed",
        ...patch,
    };
}

describe("projectUserSettings", () => {
    it("returns null for a user who has never saved", () => {
        expect(projectUserSettings(null)).toBeNull();
    });

    it("strips _id/_creationTime/userId down to the wire shape", () => {
        const row = makeRow();
        expect(projectUserSettings(row)).toEqual({
            density: "compact",
            motion: "reduced",
            previewPreference: "printed",
        });
    });

    it("passes through an unset field as undefined (partial save)", () => {
        const row = makeRow({
            motion: undefined,
            previewPreference: undefined,
        });
        expect(projectUserSettings(row)).toEqual({
            density: "compact",
            motion: undefined,
            previewPreference: undefined,
        });
    });
});

describe("resolveUserSettingsWrite", () => {
    it("inserts a new row (with userId) when the caller has none yet", () => {
        const write = resolveUserSettingsWrite(null, USER_ID, {
            density: "roomy",
        });
        expect(write).toEqual({
            kind: "insert",
            row: { userId: USER_ID, density: "roomy" },
        });
    });

    it("patches the caller's existing row in place, never inserting a second one", () => {
        const existing = makeRow();
        const write = resolveUserSettingsWrite(existing, USER_ID, {
            motion: "system",
        });
        expect(write).toEqual({
            kind: "patch",
            id: existing._id,
            patch: { motion: "system" },
        });
    });

    it("a partial patch carries only the changed field — the other two are left alone", () => {
        const existing = makeRow();
        const write = resolveUserSettingsWrite(existing, USER_ID, {
            previewPreference: "computed",
        });
        expect(write.kind).toBe("patch");
        if (write.kind === "patch") {
            expect(write.patch).toEqual({ previewPreference: "computed" });
            expect(write.patch).not.toHaveProperty("density");
            expect(write.patch).not.toHaveProperty("motion");
        }
    });
});
