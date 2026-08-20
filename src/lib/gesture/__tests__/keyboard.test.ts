// Keyboard equivalents of the editing-surface touch model (PRD #2405 story
// 52, ADR 0101, issue #2583).
import { describe, it, expect } from "vitest";
import { editingKeyAction } from "../keyboard";

describe("editingKeyAction (issue #2583)", () => {
    it("maps the arrows to selection movement", () => {
        expect(editingKeyAction({ key: "ArrowLeft" })).toBe("select-previous");
        expect(editingKeyAction({ key: "ArrowRight" })).toBe("select-next");
        expect(editingKeyAction({ key: "ArrowUp" })).toBe("select-up");
        expect(editingKeyAction({ key: "ArrowDown" })).toBe("select-down");
    });

    it("maps Enter to the primary CTA, S to the secondary, / to search", () => {
        expect(editingKeyAction({ key: "Enter" })).toBe("primary");
        expect(editingKeyAction({ key: "s" })).toBe("secondary");
        expect(editingKeyAction({ key: "S" })).toBe("secondary");
        expect(editingKeyAction({ key: "/" })).toBe("search");
        expect(editingKeyAction({ key: "Escape" })).toBe("dismiss");
    });

    // The important half of the contract: a modified chord belongs to the
    // browser or the OS. Claiming ⌘S / ⌃S would break Save on every editing
    // surface at once.
    it("leaves every modified chord alone", () => {
        expect(editingKeyAction({ key: "s", metaKey: true })).toBeNull();
        expect(editingKeyAction({ key: "s", ctrlKey: true })).toBeNull();
        expect(editingKeyAction({ key: "s", altKey: true })).toBeNull();
        expect(
            editingKeyAction({ key: "ArrowRight", metaKey: true })
        ).toBeNull();
    });

    it("claims no key it has no meaning for", () => {
        for (const key of ["a", "Tab", " ", "F5", "PageDown", "Home"]) {
            expect(editingKeyAction({ key })).toBeNull();
        }
    });
});
