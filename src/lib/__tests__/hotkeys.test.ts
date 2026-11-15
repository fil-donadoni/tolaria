// The hotkey declarations (issue #9833): one row per binding, read by the
// keydown handlers (`matchesHotkey`), the keycaps, `aria-keyshortcuts` and the
// hotkeys legend (`hotkeysForScope`).
import { describe, expect, it } from "vitest";
import {
    HOTKEYS,
    ariaKeyShortcuts,
    hotkeysForScope,
    matchesHotkey,
    type Hotkey,
} from "../hotkeys";

/** The two fields the matcher reads — this suite runs in the node project,
 *  which has no `KeyboardEvent`. */
function key(init: { key?: string; code?: string }) {
    return { key: "", code: "", ...init };
}

describe("matchesHotkey", () => {
    it("Space matches by code or by key — the controller read one, the Manual Board the other", () => {
        expect(
            matchesHotkey(key({ code: "Space" }), HOTKEYS.passPriority)
        ).toBe(true);
        expect(matchesHotkey(key({ key: " " }), HOTKEYS.manualNextPhase)).toBe(
            true
        );
        expect(matchesHotkey(key({ key: "Enter" }), HOTKEYS.passPriority)).toBe(
            false
        );
    });

    it("Enter and Escape match their keys", () => {
        expect(
            matchesHotkey(key({ key: "Enter" }), HOTKEYS.passUntilAction)
        ).toBe(true);
        expect(matchesHotkey(key({ code: "Enter" }), HOTKEYS.draftPick)).toBe(
            true
        );
        expect(matchesHotkey(key({ key: "Escape" }), HOTKEYS.pauseMenu)).toBe(
            true
        );
        expect(matchesHotkey(key({ key: "Esc" }), HOTKEYS.pauseMenu)).toBe(
            false
        );
    });

    it("letters match case-insensitively, and only their own letter", () => {
        expect(matchesHotkey(key({ key: "p" }), HOTKEYS.passTurn)).toBe(true);
        expect(matchesHotkey(key({ key: "P" }), HOTKEYS.passTurn)).toBe(true);
        expect(matchesHotkey(key({ key: "u" }), HOTKEYS.passTurn)).toBe(false);
        expect(matchesHotkey(key({ key: "`" }), HOTKEYS.toggleDebugSheet)).toBe(
            true
        );
    });

    it("a chord or a pointer gesture never matches a bare keystroke", () => {
        expect(matchesHotkey(key({ key: "Meta" }), HOTKEYS.keepPriority)).toBe(
            false
        );
        expect(
            matchesHotkey(key({ key: "Control" }), HOTKEYS.draftResizePack)
        ).toBe(false);
    });
});

describe("ariaKeyShortcuts (WAI-ARIA 1.2 § 6.7)", () => {
    it("names the declared key", () => {
        expect(ariaKeyShortcuts(HOTKEYS.passTurn)).toBe("P");
        expect(ariaKeyShortcuts(HOTKEYS.passPriority)).toBe("Space");
        expect(ariaKeyShortcuts(HOTKEYS.passUntilAction)).toBe("Enter");
        expect(ariaKeyShortcuts(HOTKEYS.pauseMenu)).toBe("Escape");
    });

    it("is absent for a binding completed with the pointer", () => {
        expect(ariaKeyShortcuts(HOTKEYS.keepPriority)).toBeUndefined();
    });
});

describe("hotkeysForScope — the legend's rows", () => {
    it("lists every declared row of the scope, in declaration order", () => {
        const board = hotkeysForScope("board");
        expect(board).toEqual(
            Object.values(HOTKEYS).filter((h) =>
                (h.scopes as readonly string[]).includes("board")
            )
        );
        expect(board[0]).toBe(HOTKEYS.passPriority);
        expect(board).toContain(HOTKEYS.pauseMenu);
        expect(board).not.toContain(HOTKEYS.manualNextPhase);
    });

    it("a binding added to the table reaches its scope's rows", () => {
        const added: Hotkey = {
            keys: ["S"],
            label: "A binding declared once",
            scopes: ["board"],
        };
        const rows = hotkeysForScope("board", { ...HOTKEYS, added });
        expect(rows.at(-1)).toBe(added);
        expect(hotkeysForScope("manual", { ...HOTKEYS, added })).not.toContain(
            added
        );
    });
});
