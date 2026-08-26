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

let isTypingTarget: (el: unknown) => boolean,
    installShortcuts: () => void,
    resetShortcuts: () => void,
    sheetOpen: () => boolean;

beforeAll(async () => {
    const bootWin = new Window({ url: "http://localhost/" });
    g.document = bootWin.document;
    const mod: {
        isTypingTarget: (el: unknown) => boolean;
        installShortcuts: () => void;
        resetShortcuts: () => void;
        sheetOpen: () => boolean;
    } = await import(
        // @ts-expect-error — plain browser JS, no type declarations.
        "../dashboard/shortcuts.js"
    );
    ({ isTypingTarget, installShortcuts, resetShortcuts, sheetOpen } = mod);
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

    it("is false for a button, a checkbox, or nothing focused", () => {
        expect(isTypingTarget(el(`<button></button>`))).toBe(false);
        expect(isTypingTarget(el(`<input type="checkbox">`))).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The keyboard layer + shortcut sheet, driven end to end
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
    resetShortcuts();
    return win;
}

function fireKey(win: Window, key: string, init: Record<string, unknown> = {}) {
    win.document.dispatchEvent(
        new win.KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
        })
    );
}

afterEach(() => {
    for (const key of INSTALLED_GLOBALS) delete g[key];
});

describe("shortcuts.js — 1/2 switch views (#2635)", () => {
    it("'1' switches to Now and '2' switches to History, updating ?view=", () => {
        const win = mountPage();
        installShortcuts();

        fireKey(win, "2");
        expect(viewFromParams(new URLSearchParams(win.location.search))).toBe(
            "history"
        );
        expect(win.document.getElementById("view-history")!.hidden).toBe(false);
        expect(win.document.getElementById("view-now")!.hidden).toBe(true);

        fireKey(win, "1");
        expect(viewFromParams(new URLSearchParams(win.location.search))).toBe(
            "now"
        );
        expect(win.document.getElementById("view-now")!.hidden).toBe(false);
    });

    it("does NOT switch views while a text input has focus — the AC's own example ('1' typed into search)", () => {
        const win = mountPage();
        installShortcuts();
        const input = win.document.getElementById(
            "if-text"
        ) as unknown as HTMLInputElement;
        input.focus();

        // The default view is already "now" — pressing "1" would look
        // identical whether or not suppression fired, which is exactly the
        // vacuous-test shape proof-of-failure exists to catch (confirmed by
        // running it: disabling the guard left this assertion green). "2"
        // is the one that actually distinguishes "suppressed" from "not".
        fireKey(win, "2");

        expect(viewFromParams(new URLSearchParams(win.location.search))).toBe(
            "now"
        );
    });

    it("ignores a modified keypress (Cmd/Ctrl/Alt+key) — those are the browser's own shortcuts", () => {
        const win = mountPage();
        installShortcuts();
        fireKey(win, "2", { ctrlKey: true });
        expect(viewFromParams(new URLSearchParams(win.location.search))).toBe(
            "now"
        );
    });
});

describe("shortcuts.js — '/' focuses the visible view's search box (#2635)", () => {
    it("focuses the search input inside the current view", () => {
        const win = mountPage();
        installShortcuts();
        expect(win.document.activeElement).not.toBe(
            win.document.getElementById("if-text")
        );

        fireKey(win, "/");

        expect(win.document.activeElement).toBe(
            win.document.getElementById("if-text")
        );
    });

    it("is a silent no-op when the visible view has no search box", () => {
        const win = mountPage(
            `<div id="view-now"></div><div id="view-history" hidden></div>`
        );
        installShortcuts();
        expect(() => fireKey(win, "/")).not.toThrow();
    });
});

describe("shortcuts.js — the '?' sheet (#2635 AC: 'a sheet listing every shortcut', 'Esc closes it', 'reachable without already knowing a shortcut')", () => {
    it("'?' opens a sheet listing every shortcut, and Esc closes it", () => {
        const win = mountPage();
        installShortcuts();
        expect(sheetOpen()).toBe(false);

        fireKey(win, "?");
        expect(sheetOpen()).toBe(true);
        const backdrop = win.document.getElementById("shortcuts-backdrop")!;
        expect(backdrop.hidden).toBe(false);
        // Every key this module dispatches on is documented in the sheet —
        // proof it lists all of them, not a hand-picked subset.
        for (const key of ["1", "2", "r", "/", "?", "Esc"]) {
            expect(backdrop.textContent).toContain(key);
        }

        fireKey(win, "Escape");
        expect(sheetOpen()).toBe(false);
        expect(backdrop.hidden).toBe(true);
    });

    it("is reachable by clicking the header button — no shortcut knowledge required", () => {
        const win = mountPage();
        installShortcuts();
        expect(sheetOpen()).toBe(false);

        win.document
            .getElementById("shortcuts-btn")!
            .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

        expect(sheetOpen()).toBe(true);
    });

    it("moves focus into the sheet when opened, and returns it to the opener on close — focus stays visible throughout", () => {
        const win = mountPage();
        installShortcuts();
        const btn = win.document.getElementById(
            "shortcuts-btn"
        ) as unknown as HTMLElement;
        btn.focus();

        btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
        const closeBtn = win.document.querySelector(".shortcuts-close");
        expect(win.document.activeElement).toBe(closeBtn);

        fireKey(win, "Escape");
        expect(win.document.activeElement).toBe(btn);
    });

    it("makes 1/2/r// inert while open — a modal that still let the view change underneath it would not be modal", () => {
        const win = mountPage();
        installShortcuts();
        fireKey(win, "?");
        expect(sheetOpen()).toBe(true);

        fireKey(win, "2");
        expect(sheetOpen()).toBe(true); // still open
        expect(viewFromParams(new URLSearchParams(win.location.search))).toBe(
            "now"
        ); // unchanged
    });
});
