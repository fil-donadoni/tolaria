import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
// @ts-expect-error — browser ES modules with no type declarations; the
// dashboard is deliberately plain JS with no build step (#2625), same as
// `dashboard-glossary.test.ts`'s imports of sibling dashboard/*.js files.
import {
    state,
    stateToParams,
    paramsToState,
} from "../dashboard/history-state.js";
// @ts-expect-error — same.
import { viewFromParams } from "../dashboard/tabs.js";
import { subscribeToView } from "../../dashboard/lib/view";
import { resetOverlays, setOverlayOpen } from "../../dashboard/lib/overlays";

/**
 * `shortcuts.js` itself is imported DYNAMICALLY, inside `beforeAll` below,
 * rather than at the top of this file — it statically imports
 * `now-loop-status.js`, which registers a `visibilitychange` listener at
 * MODULE scope (`document.addEventListener(...)` with no function wrapper).
 * A top-of-file `import` is hoisted ahead of every other statement in this
 * file, including the one that would install `globalThis.document`, so the
 * module would evaluate against no `document` at all and throw before a
 * single test ran. Same shape, same reason, as
 * `loop-status-dashboard.test.ts`'s "keyboard focus survives a poll" suite.
 */
// `globalThis` is cast once, here, and reused as `g` everywhere in this file
// — the same convention `dashboard-glossary.test.ts`/`history-filters.test.ts`
// use, rather than a fresh `as any` at every call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

interface KeyLike {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    preventDefault: () => void;
}

let isTypingTarget: (el: unknown) => boolean,
    handleKeydown: (e: KeyLike, doc?: Document) => void,
    sheetOpen: () => boolean,
    openSheet: () => void,
    closeSheet: () => void;

/**
 * WHAT MOVED (PRD #3148 S2). The keyboard layer is now
 * `dashboard/lib/shortcuts.ts`, and `scripts/dashboard/shortcuts.js` is a
 * BRIDGE onto it — the same shape `tabs.js` and `theme.js` took in S1. This
 * file keeps driving the DECISION TABLE, which is still pure and still the
 * thing worth guarding here; what left is everything about the SHEET's own
 * DOM (`installShortcuts`, `resetShortcuts`, the hand-built backdrop, its Tab
 * trap and the `[hidden]` cascade its CSS needed). That is a shadcn dialog
 * now, so those assertions moved to a component test —
 * `dashboard/components/__tests__/ShortcutsSheet.test.tsx` — where the
 * behaviour, rather than the hand-rolled mechanism, is what gets asserted.
 *
 * The import stays DYNAMIC and inside `beforeAll` for the original reason: the
 * module graph reads `document` at evaluation time, and a top-of-file import
 * is hoisted ahead of the statement that installs one.
 */
beforeAll(async () => {
    const bootWin = new Window({ url: "http://localhost/" });
    g.document = bootWin.document;
    const mod: {
        isTypingTarget: (el: unknown) => boolean;
        handleKeydown: (e: KeyLike, doc?: Document) => void;
        sheetOpen: () => boolean;
        openSheet: () => void;
        closeSheet: () => void;
    } = await import(
        // @ts-expect-error — plain browser JS, no type declarations.
        "../dashboard/shortcuts.js"
    );
    ({ isTypingTarget, handleKeydown, sheetOpen, openSheet, closeSheet } = mod);
    delete g.document;
});

/**
 * The dashboard's keyboard layer, shortcut sheet and URL round trip (#2635).
 *
 * ## The hard part is the URL round trip, not the keyboard
 *
 * `history-state.js`'s `state` is a structured object (eight fields, one of
 * them a nested `filters` map), not a scalar — a serializer that names the
 * fields it happens to know about passes every test written against today's
 * shape and silently drops the NEXT field somebody adds, or one that is
 * currently set to a non-default value nobody thought to try. The guard
 * against both is the same: drive the round trip through `Object.keys(state)`
 * at call time (which `stateToParams`/`paramsToState` do — see
 * `history-state.js`) and prove it with a test that sets EVERY field to a
 * non-default value at once, including the nested `filters` object, and
 * `structuredClone`s the ORIGINAL before the restore path mutates the same
 * singleton back — the mutate-in-place hazard this repo's own testing rules
 * call out by name (`.claude/rules/gre-development.md` § Proof-of-failure).
 * A second test proves the genericity claim directly: a field added to
 * `state` AFTER this file was written still round-trips, with no edit here.
 *
 * ## The keyboard layer
 *
 * Driven through real `keydown`/`click` events on a real happy-dom
 * `document`, the same shape `dashboard-glossary.test.ts` uses for
 * `tooltip.js` — the acceptance criteria are behavioural ("must not fire
 * while typing", "Esc closes the sheet"), and grepping the source for the
 * string "Escape" would be satisfied by a comment.
 */

// ─────────────────────────────────────────────────────────────────────────────
// URL round trip — the hard part
// ─────────────────────────────────────────────────────────────────────────────

/** `state`'s own declared shape, snapshotted once so a test can always get
 *  back to a known baseline regardless of what an earlier test in this file
 *  (or `history-filters.test.ts`, sharing the same singleton under the
 *  `node` project's `isolate: false`) left behind. */
const DEFAULT_STATE = {
    table: "agent_runs",
    metric: "total_seconds",
    split: "role",
    from: "",
    to: "",
    filters: {},
    sort: null,
    sortDir: -1,
};

function resetState() {
    // `state` is an untyped import (`@ts-expect-error` above, no `.d.ts` for
    // a plain browser JS module) and so is already `any` — no cast needed.
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, structuredClone(DEFAULT_STATE));
}

beforeEach(resetState);
afterEach(resetState);

describe("History URL round trip (#2635 AC: 'loading a produced URL restores exactly that state')", () => {
    it("round-trips EVERY field at once, including the nested filters object, through a serialize→reset→restore cycle", () => {
        // Every one of `state`'s eight fields set to something OTHER than its
        // default — the exact case the brief calls out: a hand-listed
        // serializer passes on today's fields and loses the one nobody set
        // non-default in a hand-written test.
        Object.assign(state, {
            table: "llm",
            metric: "cost_usd",
            split: "model",
            from: "2026-01-01",
            to: "2026-02-15",
            filters: { role: ["review", "fixup"], model: ["opus", "sonnet"] },
            sort: "cost_usd",
            sortDir: 1,
        });
        // Snapshot BEFORE the round trip — `paramsToState` mutates the SAME
        // singleton `stateToParams` just read, so comparing against a live
        // reference of `state` after the restore would compare the object to
        // itself and pass vacuously no matter what the restore actually did.
        const original = structuredClone(state);

        const query = stateToParams(new URLSearchParams()).toString();

        // Simulate "a fresh page load": state back to its defaults, as if
        // this were a brand new tab that had never touched the filter bar.
        resetState();
        expect(state).toEqual(DEFAULT_STATE); // sanity: the reset really reset

        paramsToState(new URLSearchParams(query));

        expect(state).toEqual(original);
    });

    it("a field added to `state` AFTER this test was written still round-trips — no edit here required", () => {
        // Proves the genericity claim: the serializer walks `state`'s OWN
        // keys, so it does not need to know this field exists.
        state.newlyAddedField = "z";
        try {
            const original = structuredClone(state);
            const query = stateToParams(new URLSearchParams()).toString();
            expect(query).toContain("newlyAddedField=z");

            state.newlyAddedField = "stale — should be overwritten";
            paramsToState(new URLSearchParams(query));

            expect(state).toEqual(original);
        } finally {
            delete state.newlyAddedField;
        }
    });

    it("omits a default/empty field from the URL rather than writing it as noise", () => {
        // `sort: null` and `filters: {}` are the two defaults most likely to
        // round-trip as visible garbage (`sort=null`, `filters=%7B%7D`) if
        // the null-vs-object distinction below were dropped.
        const params = stateToParams(new URLSearchParams());
        expect(params.has("sort")).toBe(false);
        expect(params.has("filters")).toBe(false);
        expect(params.has("from")).toBe(false);
        expect(params.has("to")).toBe(false);
    });

    it("restoring from a malformed filters value keeps the current value instead of throwing", () => {
        const before = structuredClone(state.filters);
        const params = new URLSearchParams({ filters: "{not json" });
        expect(() => paramsToState(params)).not.toThrow();
        expect(state.filters).toEqual(before);
    });

    it("preserves every OTHER param on the URL (view, theme) — stateToParams only ever touches state's own keys", () => {
        const params = new URLSearchParams("?view=history&theme=dark");
        state.table = "llm";
        stateToParams(params);
        expect(params.get("view")).toBe("history");
        expect(params.get("theme")).toBe("dark");
        expect(params.get("table")).toBe("llm");
    });

    it("restores sortDir as a NUMBER, not the string URLSearchParams handed back — every read site compares with ===", () => {
        state.sortDir = 1;
        const query = stateToParams(new URLSearchParams()).toString();
        resetState();
        paramsToState(new URLSearchParams(query));
        expect(state.sortDir).toBe(1);
        expect(typeof state.sortDir).toBe("number");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Typing suppression
// ─────────────────────────────────────────────────────────────────────────────

describe("shortcuts.js — isTypingTarget (#2635 AC: 'no shortcut fires while a text input or textarea has focus')", () => {
    let win: Window;
    beforeEach(() => {
        win = new Window({ url: "http://localhost/" });
    });

    const el = (html: string) => {
        win.document.body.innerHTML = html;
        return win.document.body.firstElementChild!;
    };

    it("is true for a text input, a search input, a date input and a textarea", () => {
        expect(isTypingTarget(el(`<input type="text">`))).toBe(true);
        expect(isTypingTarget(el(`<input type="search">`))).toBe(true);
        expect(isTypingTarget(el(`<input type="date">`))).toBe(true);
        expect(isTypingTarget(el(`<input>`))).toBe(true); // no type = text
        expect(isTypingTarget(el(`<textarea></textarea>`))).toBe(true);
    });

    it("is true for a contenteditable element", () => {
        // `isTypingTarget`'s parameter is `unknown` — a real `Element`
        // widens to it with no cast needed.
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

    it("is false for a merely-focusable [tabindex] host that is not a typing widget — the tooltip engine's glossary terms (#2629) give nearly every table header and claim-stage cell a tabindex purely to open a tooltip on focus, and none of them consume a keystroke as text", () => {
        expect(
            isTypingTarget(el(`<th tabindex="0" data-term="cost"></th>`))
        ).toBe(false);
        expect(isTypingTarget(el(`<span tabindex="0"></span>`))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The keyboard layer's DECISION TABLE, driven directly.
//
// `handleKeydown` takes the document it should read `activeElement` and the
// visible view's search box from, so a test drives it with a hand-built
// event-like object against a swapped happy-dom document — no listener to
// install, and no ordering hazard between installing one and swapping the
// globals underneath it.
// ─────────────────────────────────────────────────────────────────────────────

const SHELL_HTML = `
    <header>
        <button class="shortcuts-btn" id="shortcuts-btn" type="button"></button>
    </header>
    <nav>
        <button id="tab-now" data-view="now" aria-selected="true"></button>
        <button id="tab-history" data-view="history" aria-selected="false"></button>
    </nav>
    <div id="view-now"><input id="if-text" type="search"></div>
    <div id="view-history" hidden></div>
`;

const INSTALLED_GLOBALS = ["document", "location", "history", "fetch"];

function mountPage(html = SHELL_HTML) {
    const win = new Window({ url: "http://localhost/" });
    win.document.body.innerHTML = html;
    g.document = win.document;
    g.location = win.location;
    g.history = win.history;
    g.fetch = () => Promise.reject(new Error("test: no network"));
    resetOverlays();
    return win;
}

/** One keystroke, as the decision table sees it. Returns whether the handler
 *  claimed the key — `preventDefault` is how a shortcut says "mine". */
function fireKey(
    win: Window,
    key: string,
    init: Partial<KeyLike> = {}
): { prevented: boolean } {
    let prevented = false;
    handleKeydown(
        {
            key,
            ...init,
            preventDefault: () => {
                prevented = true;
            },
        },
        win.document as unknown as Document
    );
    return { prevented };
}

afterEach(() => {
    resetOverlays();
    for (const key of INSTALLED_GLOBALS) delete g[key];
});

describe("shortcuts — 1/2 switch views (#2635)", () => {
    it("'1' switches to Now and '2' switches to History, updating ?view= and notifying the store", () => {
        const win = mountPage();
        // WHAT MOVED (PRD #3148 S1): `switchView` no longer sets `hidden` on
        // the panels — React does, from the store. What the keystroke owns is
        // the URL and the notification.
        const seen: string[] = [];
        const unsubscribe = subscribeToView(() =>
            seen.push(new URLSearchParams(g.location.search).get("view") ?? "")
        );

        expect(fireKey(win, "2").prevented).toBe(true);
        expect(new URLSearchParams(g.location.search).get("view")).toBe(
            "history"
        );
        expect(viewFromParams(new URLSearchParams(g.location.search))).toBe(
            "history"
        );

        expect(fireKey(win, "1").prevented).toBe(true);
        expect(new URLSearchParams(g.location.search).get("view")).toBe("now");

        expect(seen).toEqual(["history", "now"]);
        unsubscribe();
    });

    it("does NOT switch views while a text input has focus — the AC's own example ('1' typed into search)", () => {
        const win = mountPage();
        const box = win.document.getElementById("if-text") as HTMLInputElement;
        box.focus();
        expect(fireKey(win, "1").prevented).toBe(false);
        expect(new URLSearchParams(g.location.search).get("view")).toBeNull();
    });

    it("does NOT switch views while a <select> has focus — round 2 review's exact repro: History's comboboxes use digit keys as native typeahead", () => {
        const win = mountPage(
            `${SHELL_HTML}<select id="if-family"><option>a</option></select>`
        );
        (win.document.getElementById("if-family") as HTMLElement).focus();
        expect(fireKey(win, "1").prevented).toBe(false);
        expect(new URLSearchParams(g.location.search).get("view")).toBeNull();
    });

    it("ignores a modified keypress (Cmd/Ctrl/Alt+key) — those are the browser's own shortcuts", () => {
        const win = mountPage();
        for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
            expect(fireKey(win, "2", { [mod]: true }).prevented).toBe(false);
        }
        expect(new URLSearchParams(g.location.search).get("view")).toBeNull();
    });
});

describe("shortcuts — '/' focuses the visible view's search box (#2635)", () => {
    it("focuses the search input inside the current view", () => {
        const win = mountPage();
        expect(fireKey(win, "/").prevented).toBe(true);
        expect(win.document.activeElement?.id).toBe("if-text");
    });

    it("is a silent no-op when the visible view has no search box", () => {
        const win = mountPage(`<div id="view-now"></div>`);
        expect(() => fireKey(win, "/")).not.toThrow();
    });
});

describe("shortcuts — 'r' refreshes the visible view (#2635 AC)", () => {
    it("on the Now view, calls the loop-status endpoint the transport reads from", async () => {
        const win = mountPage();
        const calls: string[] = [];
        g.fetch = (url: string) => {
            calls.push(String(url));
            return Promise.reject(new Error("test: no network"));
        };
        expect(fireKey(win, "r").prevented).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(calls[0]).toBe("/api/loop-status");
    });

    it("does NOT fire while a text input has focus", () => {
        const win = mountPage();
        let called = false;
        g.fetch = () => {
            called = true;
            return Promise.reject(new Error("test: no network"));
        };
        (win.document.getElementById("if-text") as HTMLElement).focus();
        expect(fireKey(win, "r").prevented).toBe(false);
        expect(called).toBe(false);
    });
});

describe("shortcuts — the '?' key and the sheet's own store (#2635)", () => {
    it("'?' opens the sheet, and '?' again closes it", () => {
        const win = mountPage();
        expect(sheetOpen()).toBe(false);
        expect(fireKey(win, "?").prevented).toBe(true);
        expect(sheetOpen()).toBe(true);
        expect(fireKey(win, "?").prevented).toBe(true);
        expect(sheetOpen()).toBe(false);
    });

    it("makes 1/2/r// inert while open — a modal that still let the view change underneath it would not be modal", () => {
        const win = mountPage();
        openSheet();
        for (const key of ["1", "2", "r", "/"]) {
            expect(fireKey(win, key).prevented).toBe(false);
        }
        expect(new URLSearchParams(g.location.search).get("view")).toBeNull();
        expect(win.document.activeElement?.id).not.toBe("if-text");
        closeSheet();
        expect(fireKey(win, "2").prevented).toBe(true);
    });

    it("leaves Escape to the dialog primitive — the layer no longer arbitrates it, so it can never swallow one meant for an overlay", () => {
        const win = mountPage();
        openSheet();
        // Not claimed here: base-ui binds Escape on the document itself, which
        // is what makes it work from wherever focus has drifted to — including
        // onto a text input behind the sheet, the round-2 review's exact
        // repro, where this module's own `isTypingTarget` guard used to
        // swallow it.
        expect(fireKey(win, "Escape").prevented).toBe(false);
        expect(sheetOpen()).toBe(true);
    });
});

describe("shortcuts — a modal overlay makes every other shortcut inert (#2636 review round 1, finding 2)", () => {
    it("'2' does NOT switch the view while the action-confirmation dialog is open", () => {
        const win = mountPage();
        setOverlayOpen("confirm", true);
        expect(fireKey(win, "2").prevented).toBe(false);
        expect(new URLSearchParams(g.location.search).get("view")).toBeNull();
    });

    it("'?' does NOT stack the shortcut sheet on top of an open confirmation dialog", () => {
        const win = mountPage();
        setOverlayOpen("confirm", true);
        expect(fireKey(win, "?").prevented).toBe(false);
        expect(sheetOpen()).toBe(false);
    });

    it("the tail drawer is NOT one of them — it is non-modal, and a keystroke beside it still works", () => {
        const win = mountPage();
        setOverlayOpen("tail", true);
        expect(fireKey(win, "2").prevented).toBe(true);
        expect(new URLSearchParams(g.location.search).get("view")).toBe(
            "history"
        );
    });

    it("view-switch and sheet shortcuts work normally again once the dialog is closed", () => {
        const win = mountPage();
        setOverlayOpen("confirm", true);
        setOverlayOpen("confirm", false);
        expect(fireKey(win, "2").prevented).toBe(true);
        expect(new URLSearchParams(g.location.search).get("view")).toBe(
            "history"
        );
    });
});
