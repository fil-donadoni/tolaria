// CR 701.43a / 508.1g — exert status read from projected state.
import { describe, it, expect } from "vitest";
import { exertStatus } from "../exert-status";

describe("exertStatus", () => {
    it("is pending while chosen for an unconfirmed declaration", () => {
        expect(
            exertStatus({ id: "a" }, { exertedIds: ["a"], confirmed: false })
        ).toBe("pending");
    });
    it("is paid once the permanent's skip-untap flag is armed", () => {
        expect(
            exertStatus(
                { id: "a", skipNextUntap: true },
                { exertedIds: ["a"], confirmed: true }
            )
        ).toBe("paid");
    });
    it("is null for an unexerted permanent or after confirmation without the flag", () => {
        expect(
            exertStatus({ id: "a" }, { exertedIds: ["b"], confirmed: false })
        ).toBeNull();
        expect(
            exertStatus({ id: "a" }, { exertedIds: ["a"], confirmed: true })
        ).toBeNull();
        expect(exertStatus({ id: "a" }, undefined)).toBeNull();
    });
});
