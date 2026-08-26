import {
    describe,
    it,
    expect,
    vi,
    beforeAll,
    beforeEach,
    afterEach,
} from "vitest";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
// @ts-expect-error — browser ES modules with no type declarations; the
// dashboard is deliberately plain JS with no build step (#2625), same as
// `dashboard-glossary.test.ts`'s imports of sibling dashboard/*.js files.
import {
    state,
    stateToParams,
    paramsToState,
    setMeta,
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
    sheetOpen: () => boolean,
    openSheet: () => void,
    closeSheet: () => void;

beforeAll(async () => {
    const bootWin = new Window({ url: "http://localhost/" });
    g.document = bootWin.document;
    const mod: {
        isTypingTarget: (el: unknown) => boolean;
        installShortcuts: () => void;
        resetShortcuts: () => void;
        sheetOpen: () => boolean;
        openSheet: () => void;
        closeSheet: () => void;
    } = await import(
        // @ts-expect-error — plain browser JS, no type declarations.
        "../dashboard/shortcuts.js"
    );
    ({
        isTypingTarget,
        installShortcuts,
        resetShortcuts,
        sheetOpen,
        openSheet,
        closeSheet,
    } = mod);
    delete g.document;
});

/**
 * `dashboard.css`'s own text, read once — the cascade regression below (round
 * 2 review, blocker) loads it into a REAL happy-dom `<style>` element rather
 * than asserting on the property `shortcuts.js` sets, because the bug it
 * guards lives entirely in the cascade: `closeSheet()` only ever sets
 * `sheetEl.hidden = true` (an IDL property, always `true` after the call,
 * fix or no fix), while what a browser actually PAINTS depends on which CSS
 * rule wins. `import.meta.url` goes through a local first, the same
 * indirection `board-portrait-chips.test.tsx` uses for `index.css` — Vite's
 * import-analysis plugin pattern-matches the literal
 * `new URL("../dashboard/dashboard.css", import.meta.url)` shape and rewrites
 * it to a dev-server URL, which then makes `readFileSync` throw.
 */
const dashboardCssUrl = new URL("../dashboard/dashboard.css", import.meta.url);
const dashboardCss = readFileSync(dashboardCssUrl, "utf8");

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

    it("does NOT switch views while a History filter combobox has focus — round 2 review's exact repro: focus #if-family, press '1', the view must not jump to Now underneath the still-focused dropdown", () => {
        const win = mountPage(
            `${SHELL_HTML}<select id="if-family"><option>a</option><option>b</option></select>`
        );
        installShortcuts();
        fireKey(win, "2"); // start from History, so "1" is the distinguishing key
        (
            win.document.getElementById("if-family") as unknown as HTMLElement
        ).focus();

        fireKey(win, "1");

        expect(viewFromParams(new URLSearchParams(win.location.search))).toBe(
            "history"
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

// ─────────────────────────────────────────────────────────────────────────────
// 'r' refreshes the visible view (round 2 review, medium: zero behavioural
// coverage — deleting `case "r"` AND its SHORTCUTS row left all 18 tests
// green, because the only assertion touching the key was
// `backdrop.textContent.toContain("r")`, vacuous for a single letter that
// also occurs inside other rows' descriptions)
// ─────────────────────────────────────────────────────────────────────────────

describe("shortcuts.js — 'r' refreshes the visible view (#2635 AC)", () => {
    it("on the Now view, calls the loop-status endpoint `refreshLoopStatus` reads from", () => {
        // `refreshVisibleView`'s Now branch is a direct, unawaited call to
        // `refreshLoopStatus()` — no dynamic `import()` in the way — so the
        // `fetch` it issues happens synchronously within `fireKey` itself,
        // same as `now-loop-status.js`'s own `refreshLoopStatus` does on a
        // poll tick. `#loop-status-sub` must exist for the promise's own
        // catch branch (a rejected fetch, same shape as this suite's default
        // stub) to have somewhere to write the error — a missing target
        // there would throw inside an unhandled rejection instead of failing
        // this test where the assertion actually lives.
        const win = mountPage(`${SHELL_HTML}<div id="loop-status-sub"></div>`);
        installShortcuts();
        const fetchSpy = vi.fn(() => Promise.reject(new Error("test stub")));
        g.fetch = fetchSpy;

        fireKey(win, "r");

        expect(fetchSpy).toHaveBeenCalledWith("/api/loop-status");
    });

    it("on the History view, is a no-op while getMeta() is null — history-refresh.js dereferences getMeta() unconditionally and would throw against an unset store", async () => {
        setMeta(null); // deterministic regardless of test order elsewhere
        const win = mountPage();
        installShortcuts();
        fireKey(win, "2"); // switch to History
        const fetchSpy = vi.fn();
        g.fetch = fetchSpy;

        fireKey(win, "r");
        // The History branch's first step is a dynamic `import()`, which is
        // ALWAYS asynchronous even for an already-loaded module — unlike the
        // Now branch above, nothing runs synchronously here. Give the
        // microtask queue a few turns to reach (and stop at) the
        // `getMeta()` check.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does NOT fire while a text input has focus", () => {
        const win = mountPage(`${SHELL_HTML}<div id="loop-status-sub"></div>`);
        installShortcuts();
        const fetchSpy = vi.fn(() => Promise.reject(new Error("test stub")));
        g.fetch = fetchSpy;
        (
            win.document.getElementById("if-text") as unknown as HTMLElement
        ).focus();

        fireKey(win, "r");

        expect(fetchSpy).not.toHaveBeenCalled();
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

    it("Escape closes the sheet even after focus has left it onto a text input behind it (round 2 review, medium) — before this fix `isTypingTarget`'s early return sat AHEAD of the Escape branch, so this exact sequence left the sheet wedged open with no keyboard way out", () => {
        const win = mountPage();
        installShortcuts();
        fireKey(win, "?");
        expect(sheetOpen()).toBe(true);

        // Simulates Tab having walked focus off the sheet's close button —
        // the scenario the missing focus trap used to allow.
        (
            win.document.getElementById("if-text") as unknown as HTMLElement
        ).focus();

        fireKey(win, "Escape");

        expect(sheetOpen()).toBe(false);
    });

    it("traps BOTH Tab and Shift+Tab back onto the close button — its only focusable descendant — after focus has left the sheet onto the page behind the backdrop", () => {
        // happy-dom's synthetic `keydown` dispatch never moves focus on its
        // own the way a real browser's native Tab handling would — a
        // version of this test that dispatched Tab WITHOUT first moving
        // focus away passed even with the trap fully disabled (confirmed by
        // running it: `trapFocus` short-circuited to a no-op and this still
        // stayed green, the exact vacuous shape proof-of-failure exists to
        // catch). Moving focus to `#if-text` first, exactly as the missing
        // trap used to allow, is what makes each assertion load-bearing.
        const win = mountPage();
        installShortcuts();
        fireKey(win, "?");
        const closeBtn = win.document.querySelector(".shortcuts-close");
        const ifText = win.document.getElementById(
            "if-text"
        ) as unknown as HTMLElement;

        ifText.focus();
        fireKey(win, "Tab");
        expect(win.document.activeElement).toBe(closeBtn);

        ifText.focus();
        fireKey(win, "Tab", { shiftKey: true });
        expect(win.document.activeElement).toBe(closeBtn);
    });

    it("re-traps focus back onto the close button even if something moved it off the sheet by other means (e.g. a programmatic .focus() call), proving the trap is not merely 'never lose focus in the first place'", () => {
        const win = mountPage();
        installShortcuts();
        fireKey(win, "?");
        (
            win.document.getElementById("if-text") as unknown as HTMLElement
        ).focus();
        expect(win.document.activeElement).not.toBe(
            win.document.querySelector(".shortcuts-close")
        );

        fireKey(win, "Tab");

        expect(win.document.activeElement).toBe(
            win.document.querySelector(".shortcuts-close")
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The backdrop cascade against the REAL stylesheet (round 2 review, blocker)
// ─────────────────────────────────────────────────────────────────────────────

describe("shortcuts.js — the shortcuts-backdrop cascade against dashboard.css's own text", () => {
    /**
     * `closeSheet()` only ever does `sheetEl.hidden = true` — an IDL
     * property that reads back `true` whether or not the fix is in place, so
     * every OTHER test in this file that asserts `backdrop.hidden` or
     * `sheetOpen()` stays green even if `dashboard.css` reintroduces the
     * cascade bug (`.shortcuts-backdrop { display: flex }`, an author
     * declaration, outranking the plain `[hidden]` attribute with no rule of
     * its own — happy-dom's UA stylesheet, unlike a real browser's, does not
     * even supply `[hidden] { display: none }` for free; verified directly:
     * a bare `hidden` div with NO stylesheet loaded computes `display:
     * block` here). The only way to see what a real browser would actually
     * PAINT is to load `dashboard.css`'s own text into a real `<style>`
     * element and read `getComputedStyle` back — which is exactly how the
     * round-2 review found this bug in the first place.
     */
    function backdropWithRealCss() {
        const win = mountPage();
        win.document.head.innerHTML = `<style>${dashboardCss}</style>`;
        installShortcuts();
        const backdrop = win.document.getElementById(
            "shortcuts-backdrop"
        ) as unknown as HTMLElement | null;
        return { win, backdrop };
    }

    it("computes display:none on the CLOSED backdrop before it is ever opened", () => {
        // `sheet()` is built lazily on first use, so open once to force the
        // element to exist, then close it — the steady state every page load
        // not currently showing the sheet is actually in.
        const { win, backdrop } = backdropWithRealCss();
        expect(backdrop).toBeNull(); // not built yet — nothing painted at all
        openSheet();
        closeSheet();
        const built = win.document.getElementById("shortcuts-backdrop")!;
        expect(built.hidden).toBe(true); // the property side — always true
        // The cascade side — what a real browser paints. Pre-fix this was
        // "flex": a full-viewport layer sitting over the whole dashboard,
        // swallowing every click, with `sheetOpen()` reporting `false`
        // underneath it.
        expect(win.getComputedStyle(built).display).toBe("none");
    });

    it("computes display:flex on the OPEN backdrop — the fix must not simply always hide it", () => {
        const { win } = backdropWithRealCss();
        openSheet();
        const built = win.document.getElementById("shortcuts-backdrop")!;
        expect(built.hidden).toBe(false);
        expect(win.getComputedStyle(built).display).toBe("flex");
    });

    it("closing an already-open sheet flips the cascade back to none, not just the property", () => {
        const { win } = backdropWithRealCss();
        openSheet();
        const built = win.document.getElementById("shortcuts-backdrop")!;
        expect(win.getComputedStyle(built).display).toBe("flex");

        closeSheet();
        expect(win.getComputedStyle(built).display).toBe("none");
    });
});
