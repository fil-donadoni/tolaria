import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    closeSheet,
    handleKeydown,
    isTypingTarget,
    openSheet,
    sheetOpen,
} from "../shortcuts";
import { subscribeToView, viewFromParams } from "../view";
import { resetOverlays, setOverlayOpen } from "../overlays";
import { resetLoopStatus } from "../loopStatus";

/**
 * The dashboard's keyboard layer (#2635), migrated with its subject in
 * PRD #3148 S4.
 *
 * It lived in `scripts/__tests__/dashboard-shortcuts.test.ts` and drove
 * `scripts/dashboard/shortcuts.js`, which S2 had already reduced to a BRIDGE
 * onto `dashboard/lib/shortcuts.ts`. S4 deletes the bridge, so the suite moves
 * to the `dom` project beside the module it actually tests. Every assertion is
 * the one it made there; what went away is the plumbing the `node` project
 * needed — a hand-installed happy-dom `Window` on `globalThis`, the dynamic
 * `beforeAll` import that kept a module-scope `document` read from throwing,
 * and an `@ts-expect-error` on every import.
 *
 * The decision table is driven DIRECTLY: `handleKeydown` takes the document it
 * should read `activeElement` from, so a test hands it an event-like object
 * and reads back whether the handler claimed the key. `preventDefault` is how
 * a shortcut says "mine", and it is the only signal that separates "the
 * shortcut ran" from "the shortcut correctly declined".
 *
 * The SHEET's own behaviour — focus, Escape, modality — is a shadcn dialog and
 * is asserted in `dashboard/components/__tests__/ShortcutsSheet.test.tsx`,
 * where the behaviour rather than a hand-rolled mechanism is what gets tested.
 */

interface KeyLike {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
}

const SHELL_HTML = `
    <header>
        <button id="shortcuts-btn" type="button"></button>
    </header>
    <nav>
        <button id="tab-now" data-view="now" aria-selected="true"></button>
        <button id="tab-history" data-view="history" aria-selected="false"></button>
    </nav>
    <div id="view-now"><input id="if-text" type="search"></div>
    <div id="view-history" hidden></div>
`;

function mountPage(html = SHELL_HTML): void {
    document.body.innerHTML = html;
}

/** One keystroke, as the decision table sees it. Returns whether the handler
 *  claimed the key. */
function fireKey(
    key: string,
    init: Partial<KeyLike> = {}
): {
    prevented: boolean;
} {
    let prevented = false;
    handleKeydown(
        {
            key,
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            ...init,
            preventDefault: () => {
                prevented = true;
            },
        },
        document
    );
    return { prevented };
}

const viewParam = (): string | null =>
    new URLSearchParams(location.search).get("view");

const el = (html: string): Element => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
};

beforeEach(() => {
    resetOverlays();
    resetLoopStatus();
    // The URL is the view store, and it survives a test — a leftover `?view=`
    // would make the next case's "did the keystroke change it" vacuous.
    history.replaceState(null, "", "/");
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("test: no network")))
    );
});

afterEach(() => {
    resetOverlays();
    resetLoopStatus();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

// ─────────────────────────────────────────────────────────────────────────────
// Typing suppression
// ─────────────────────────────────────────────────────────────────────────────

describe("shortcuts — isTypingTarget (#2635 AC: 'no shortcut fires while a text input or textarea has focus')", () => {
    it("is true for a text input, a search input, a date input and a textarea", () => {
        expect(isTypingTarget(el(`<input type="text">`))).toBe(true);
        expect(isTypingTarget(el(`<input type="search">`))).toBe(true);
        expect(isTypingTarget(el(`<input type="date">`))).toBe(true);
        expect(isTypingTarget(el(`<input>`))).toBe(true); // no type = text
        expect(isTypingTarget(el(`<textarea></textarea>`))).toBe(true);
    });

    it("is true for a contenteditable element", () => {
        expect(isTypingTarget(el(`<div contenteditable="true"></div>`))).toBe(
            true
        );
    });

    it("is true for a <select> — round 2 review: History's five comboboxes (family/tier/state/cmd/dataset pickers) use letter/digit keys as native typeahead, not shortcuts", () => {
        expect(
            isTypingTarget(
                el(`<select><option>a</option><option>b</option></select>`)
            )
        ).toBe(true);
    });

    it('is true for a role="textbox" host — defensive: no such widget exists in this dashboard today, but a future custom text-entry host built without a real <input> must not ship silently broken', () => {
        expect(
            isTypingTarget(el(`<div role="textbox" contenteditable="true">`))
        ).toBe(true);
        // The ARIA role alone is enough, independent of contenteditable.
        expect(isTypingTarget(el(`<div role="textbox"></div>`))).toBe(true);
    });

    it("is false for a button, a checkbox, or nothing focused", () => {
        expect(isTypingTarget(el(`<button></button>`))).toBe(false);
        expect(isTypingTarget(el(`<input type="checkbox">`))).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
    });

    it("is false for a merely-focusable [tabindex] host that is not a typing widget — a glossary term is given a tabindex purely to open a tooltip on focus, and none of them consume a keystroke as text", () => {
        expect(
            isTypingTarget(el(`<th tabindex="0" data-term="cost"></th>`))
        ).toBe(false);
        expect(isTypingTarget(el(`<span tabindex="0"></span>`))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The decision table
// ─────────────────────────────────────────────────────────────────────────────

describe("shortcuts — 1/2 switch views (#2635)", () => {
    it("'1' switches to Now and '2' switches to History, updating ?view= and notifying the store", () => {
        mountPage();
        // WHAT MOVED (PRD #3148 S1): `switchView` no longer sets `hidden` on
        // the panels — React does, from the store. What the keystroke owns is
        // the URL and the notification.
        const seen: string[] = [];
        const unsubscribe = subscribeToView(() => seen.push(viewParam() ?? ""));

        expect(fireKey("2").prevented).toBe(true);
        expect(viewParam()).toBe("history");
        expect(viewFromParams(new URLSearchParams(location.search))).toBe(
            "history"
        );

        expect(fireKey("1").prevented).toBe(true);
        expect(viewParam()).toBe("now");

        expect(seen).toEqual(["history", "now"]);
        unsubscribe();
    });

    it("does NOT switch views while a text input has focus — the AC's own example ('1' typed into search)", () => {
        mountPage();
        (document.getElementById("if-text") as HTMLInputElement).focus();
        expect(fireKey("1").prevented).toBe(false);
        expect(viewParam()).toBeNull();
    });

    it("does NOT switch views while a <select> has focus — round 2 review's exact repro: History's comboboxes use digit keys as native typeahead", () => {
        mountPage(
            `${SHELL_HTML}<select id="if-family"><option>a</option></select>`
        );
        (document.getElementById("if-family") as HTMLElement).focus();
        expect(fireKey("1").prevented).toBe(false);
        expect(viewParam()).toBeNull();
    });

    it("ignores a modified keypress (Cmd/Ctrl/Alt+key) — those are the browser's own shortcuts", () => {
        mountPage();
        for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
            expect(fireKey("2", { [mod]: true }).prevented).toBe(false);
        }
        expect(viewParam()).toBeNull();
    });
});

describe("shortcuts — '/' focuses the visible view's search box (#2635)", () => {
    it("focuses the search input inside the current view", () => {
        mountPage();
        expect(fireKey("/").prevented).toBe(true);
        expect(document.activeElement?.id).toBe("if-text");
    });

    it("is a silent no-op when the visible view has no search box", () => {
        mountPage(`<div id="view-now"></div>`);
        expect(() => fireKey("/")).not.toThrow();
    });
});

describe("shortcuts — 'r' refreshes the visible view (#2635 AC)", () => {
    it("on the Now view, calls the loop-status endpoint the transport reads from", async () => {
        mountPage();
        const calls: string[] = [];
        vi.stubGlobal("fetch", (url: string) => {
            calls.push(String(url));
            return Promise.reject(new Error("test: no network"));
        });
        expect(fireKey("r").prevented).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(calls[0]).toBe("/api/loop-status");
    });

    it("does NOT fire while a text input has focus", () => {
        mountPage();
        let called = false;
        vi.stubGlobal("fetch", () => {
            called = true;
            return Promise.reject(new Error("test: no network"));
        });
        (document.getElementById("if-text") as HTMLElement).focus();
        expect(fireKey("r").prevented).toBe(false);
        expect(called).toBe(false);
    });

    it("on the History view, refreshes NOTHING until the store has answered — a refresh before /api/meta resolves would query a slice nothing validated", async () => {
        mountPage();
        history.replaceState(null, "", "?view=history");
        const calls: string[] = [];
        vi.stubGlobal("fetch", (url: string) => {
            calls.push(String(url));
            return Promise.reject(new Error("test: no network"));
        });
        expect(fireKey("r").prevented).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toEqual([]);
    });
});

describe("shortcuts — the '?' key and the sheet's own store (#2635)", () => {
    it("'?' opens the sheet, and '?' again closes it", () => {
        mountPage();
        expect(sheetOpen()).toBe(false);
        expect(fireKey("?").prevented).toBe(true);
        expect(sheetOpen()).toBe(true);
        expect(fireKey("?").prevented).toBe(true);
        expect(sheetOpen()).toBe(false);
    });

    it("makes 1/2/r// inert while open — a modal that still let the view change underneath it would not be modal", () => {
        mountPage();
        openSheet();
        for (const key of ["1", "2", "r", "/"]) {
            expect(fireKey(key).prevented).toBe(false);
        }
        expect(viewParam()).toBeNull();
        expect(document.activeElement?.id).not.toBe("if-text");
        closeSheet();
        expect(fireKey("2").prevented).toBe(true);
    });

    it("leaves Escape to the dialog primitive — the layer no longer arbitrates it, so it can never swallow one meant for an overlay", () => {
        mountPage();
        openSheet();
        // Not claimed here: base-ui binds Escape on the document itself, which
        // is what makes it work from wherever focus has drifted to — including
        // onto a text input behind the sheet, the round-2 review's exact
        // repro, where this module's own `isTypingTarget` guard used to
        // swallow it.
        expect(fireKey("Escape").prevented).toBe(false);
        expect(sheetOpen()).toBe(true);
    });
});

describe("shortcuts — a modal overlay makes every other shortcut inert (#2636 review round 1, finding 2)", () => {
    it("'2' does NOT switch the view while the action-confirmation dialog is open", () => {
        mountPage();
        setOverlayOpen("confirm", true);
        expect(fireKey("2").prevented).toBe(false);
        expect(viewParam()).toBeNull();
    });

    it("'?' does NOT stack the shortcut sheet on top of an open confirmation dialog", () => {
        mountPage();
        setOverlayOpen("confirm", true);
        expect(fireKey("?").prevented).toBe(false);
        expect(sheetOpen()).toBe(false);
    });

    it("the tail drawer is NOT one of them — it is non-modal, and a keystroke beside it still works", () => {
        mountPage();
        setOverlayOpen("tail", true);
        expect(fireKey("2").prevented).toBe(true);
        expect(viewParam()).toBe("history");
    });

    it("view-switch and sheet shortcuts work normally again once the dialog is closed", () => {
        mountPage();
        setOverlayOpen("confirm", true);
        setOverlayOpen("confirm", false);
        expect(fireKey("2").prevented).toBe(true);
        expect(viewParam()).toBe("history");
    });
});
