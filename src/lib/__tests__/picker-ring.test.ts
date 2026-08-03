import { describe, expect, it } from "vitest";
import { pickerRingClass } from "../picker-ring";

describe("pickerRingClass", () => {
    it("candidate (unselected) reads the yellow signal-pending ring", () => {
        const cls = pickerRingClass(false);
        expect(cls).toContain("ring-signal-pending");
        expect(cls).not.toContain("ring-signal-self");
    });

    it("selected reads the green signal-self ring", () => {
        const cls = pickerRingClass(true);
        expect(cls).toContain("ring-signal-self");
        expect(cls).not.toContain("ring-signal-pending");
    });
});
