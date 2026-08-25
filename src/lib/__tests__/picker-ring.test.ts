import { describe, expect, it } from "vitest";
import { pickerRingClass } from "../picker-ring";

/** Issue #2724 remapped the pickers onto the two SHARED card-ring roles
 *  (ADR 0103 §8): before, a picker said "you may click this" in amber and
 *  "you picked this" in emerald, while the battlefield said the same two
 *  things in a different pair — the assertions below are on the role, which
 *  is the thing that must not drift, not on the hue it currently resolves to
 *  (that lives in `src/index.css` and is covered by `design-tokens.test.ts`). */
describe("pickerRingClass", () => {
    it("candidate (unselected) reads the shared candidate role", () => {
        const cls = pickerRingClass(false);
        expect(cls).toContain("card-ring-candidate");
        expect(cls).not.toContain("card-ring-selected");
    });

    it("selected reads the shared selected role", () => {
        const cls = pickerRingClass(true);
        expect(cls).toContain("card-ring-selected");
        expect(cls).not.toContain("card-ring-candidate");
    });

    it("both roles carry the inset ring recipe, which also sets the card corner", () => {
        // The recipe is what makes the ring INSET and clipped to the printed
        // corner; a role class alone is just a colour variable and would paint
        // nothing at all.
        expect(pickerRingClass(false)).toContain("card-ring ");
        expect(pickerRingClass(true)).toContain("card-ring ");
    });
});
