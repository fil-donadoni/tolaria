import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { CLAIM_STAGES, LOOP_VERDICT_STATES } from "../lib/loop-status";
import { CLAIM_VERDICT_STATES } from "../loop-doctor";
// @ts-expect-error — browser ES modules with no type declarations; the
// dashboard is deliberately plain JS with no build step (#2625). `glossary.js`
// is pure data + one lookup, so the `node` vitest project imports and CALLS it
// rather than grepping its source.
import { GLOSSARY, lookupTerm } from "../dashboard/glossary.js";
// @ts-expect-error — same, and importable under `node` only because #2629
// moved every DOM touch out of `tooltip.js`'s module scope: `#tip` resolves
// lazily and the document listeners install on first use.
import {
    installTooltipEngine,
    enhanceTerms,
    resetTooltipEngine,
    tooltipHtml,
    showTip,
    hideTip,
} from "../dashboard/tooltip.js";

/**
 * The dashboard glossary and its tooltip engine (#2629).
 *
 * ## The guard points UPSTREAM, on purpose
 *
 * The completeness suite below iterates the SERVER's vocabularies —
 * `DIMENSIONS`/`METRICS` in `telemetry-serve.ts`, `CLAIM_STAGES`,
 * `CLAIM_VERDICT_STATES`, `LOOP_VERDICT_STATES` — and asserts each token
 * resolves to a glossary entry. The tempting shape, walking the glossary's own
 * keys and checking each value is a string, passes forever and guards nothing:
 * it goes green on a glossary that is a year behind the schema, which is
 * exactly how the current unexplained labels got onto the page. Pointed the
 * other way, a dimension added server-side with no human label reds this file.
 *
 * Every list is also asserted NON-EMPTY first. A drift guard that iterates an
 * empty collection passes vacuously, and an upstream refactor that renames a
 * vocabulary would otherwise silently disarm the check rather than break it.
 *
 * ## The engine is driven, not grepped
 *
 * The DOM half runs against a real happy-dom document — dispatching real
 * pointer, focus and keyboard events — because the acceptance criteria are
 * behavioural ("keyboard-reachable", "dismissible with Esc"). Asserting that
 * the string "Escape" appears in `tooltip.js` would be satisfied by a comment.
 */

/**
 * `telemetry-serve.ts` resolves `DB_PATH` from `CLAUDE_PROJECT_DIR ?? cwd()`
 * AT IMPORT TIME and reaches for `bun:sqlite` when a store exists there — the
 * primary checkout has one, and this suite runs under Node. Pinning the var to
 * an empty temp dir before the module's first import removes the dependency on
 * the machine's ambient state entirely. Same reasoning, same shape as
 * `telemetry-serve.test.ts`; top-level rather than in a `beforeAll` because
 * module top-level code runs once, at the first `import()`.
 */
const testProjectDir = mkdtempSync(join(tmpdir(), "dashboard-glossary-test-"));
const prevProjectDir = process.env.CLAUDE_PROJECT_DIR;
process.env.CLAUDE_PROJECT_DIR = testProjectDir;

/**
 * The `node` vitest project runs with `isolate: false`, so anything installed
 * on `globalThis` here outlives this file inside its worker. Every global this
 * suite sets is recorded and removed again.
 */
const INSTALLED_GLOBALS = [
    "document",
    "MutationObserver",
    "innerWidth",
    "innerHeight",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

afterAll(() => {
    resetTooltipEngine();
    for (const key of INSTALLED_GLOBALS) delete g[key];
    if (prevProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prevProjectDir;
    rmSync(testProjectDir, { recursive: true, force: true });
});

/** A fresh page per test: the engine latches its listeners and its `#tip`
 *  reference module-globally, so a swapped document needs a matching reset. */
function mountPage(bodyHtml: string) {
    const win = new Window({ url: "http://localhost/" });
    win.document.body.innerHTML = `<div id="tip"></div>${bodyHtml}`;
    g.document = win.document;
    g.MutationObserver = win.MutationObserver;
    g.innerWidth = 1440;
    g.innerHeight = 900;
    resetTooltipEngine();
    return win;
}

const tipOf = (win: Window) => win.document.getElementById("tip")!;

function fire(win: Window, target: Element, type: string, init = {}) {
    const Ctor =
        type === "keydown"
            ? win.KeyboardEvent
            : type.startsWith("focus")
              ? win.FocusEvent
              : win.MouseEvent;
    target.dispatchEvent(
        new Ctor(type, { bubbles: true, cancelable: true, ...init })
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Completeness — the drift guard, pointed at the server's vocabularies
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard glossary — completeness against the server vocabularies (#2629)", () => {
    it("every dimension the server whitelists has a human label", async () => {
        const { DIMENSIONS } = await import("../telemetry-serve");
        const tables = Object.keys(DIMENSIONS);
        expect(tables.length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const [table, dims] of Object.entries(DIMENSIONS)) {
            expect(dims.length).toBeGreaterThan(0);
            for (const dim of dims) {
                if (!lookupTerm(`${table}.${dim}`))
                    missing.push(`${table}.${dim}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("every metric the server whitelists has a human label", async () => {
        const { METRICS } = await import("../telemetry-serve");
        expect(Object.keys(METRICS).length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const [table, mets] of Object.entries(METRICS)) {
            const names = Object.keys(mets);
            expect(names.length).toBeGreaterThan(0);
            for (const metric of names) {
                if (!lookupTerm(`${table}.${metric}`))
                    missing.push(`${table}.${metric}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("every fact table the server exposes has a human label", async () => {
        const { DIMENSIONS, METRICS } = await import("../telemetry-serve");
        const tables = new Set([
            ...Object.keys(DIMENSIONS),
            ...Object.keys(METRICS),
        ]);
        expect(tables.size).toBeGreaterThan(0);
        expect([...tables].filter((t) => !lookupTerm(t))).toEqual([]);
    });

    it("every claim stage has a human label", () => {
        expect(CLAIM_STAGES.length).toBeGreaterThan(0);
        expect(CLAIM_STAGES.filter((s) => !lookupTerm(`stage.${s}`))).toEqual(
            []
        );
    });

    it("every claim verdict state has a human label", () => {
        expect(CLAIM_VERDICT_STATES.length).toBeGreaterThan(0);
        expect(
            CLAIM_VERDICT_STATES.filter((s) => !lookupTerm(`claim.${s}`))
        ).toEqual([]);
    });

    it("every loop verdict state has a human label", () => {
        expect(LOOP_VERDICT_STATES.length).toBeGreaterThan(0);
        expect(
            LOOP_VERDICT_STATES.filter((s) => !lookupTerm(`loop.${s}`))
        ).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Entry quality — a tooltip must SAY something
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard glossary — entries explain rather than restate (#2629)", () => {
    const normalise = (s: string) =>
        s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();

    it("no tooltip is a restatement of the term or of its own label", () => {
        const restatements: string[] = [];
        for (const [key, entry] of Object.entries(
            GLOSSARY as Record<string, { label: string; tip: string }>
        )) {
            const bare = key.includes(".")
                ? key.slice(key.indexOf(".") + 1)
                : key;
            const tip = normalise(entry.tip);
            if (
                tip === normalise(entry.label) ||
                tip === normalise(bare) ||
                tip === `the ${normalise(bare)}` ||
                entry.tip.trim().length < 30
            ) {
                restatements.push(key);
            }
        }
        expect(restatements).toEqual([]);
    });

    it("every entry carries both a label and a tooltip sentence", () => {
        const malformed: string[] = [];
        for (const [key, entry] of Object.entries(
            GLOSSARY as Record<string, { label: string; tip: string }>
        )) {
            if (
                typeof entry?.label !== "string" ||
                entry.label.trim() === "" ||
                typeof entry?.tip !== "string" ||
                entry.tip.trim() === ""
            ) {
                malformed.push(key);
            }
        }
        expect(malformed).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Qualified lookup
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard glossary — qualified term resolution (#2629)", () => {
    it("falls back from a qualified term to the bare one", () => {
        // `spans.day` has no entry of its own: a date is a date in every table.
        expect(lookupTerm("spans.day")).toBe(lookupTerm("day"));
    });

    it("prefers a table-specific entry when the term means different things", () => {
        // `messages` is count(*) of assistant messages in `llm` and sum(msgs)
        // in `agent_runs` — identical token, different quantity. A flat map
        // would hand both surfaces the same wrong sentence.
        const llm = lookupTerm("llm.messages");
        const runs = lookupTerm("agent_runs.messages");
        expect(llm).toBeDefined();
        expect(runs).toBeDefined();
        expect(runs.tip).not.toBe(llm.tip);
    });

    it("returns nothing for a term that was never declared", () => {
        expect(lookupTerm("not_a_real_dimension")).toBeUndefined();
        expect(lookupTerm("spans.not_a_real_dimension")).toBeUndefined();
        expect(lookupTerm("")).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard tooltip engine — declared terms (#2629)", () => {
    beforeEach(() => resetTooltipEngine());

    it("labels and explains an element that only DECLARES a term", () => {
        const win = mountPage(
            `<table><thead><tr><th id="c" data-term="cmd_bucket"></th></tr></thead></table>`
        );
        installTooltipEngine();
        const th = win.document.getElementById("c")!;

        // Declared, not wired: no handler was attached at the call site.
        expect(th.textContent).toBe("command family");
        expect(th.getAttribute("tabindex")).toBe("0");
        expect(th.getAttribute("aria-describedby")).toBe("tip");
        expect(th.classList.contains("term")).toBe(true);

        fire(win, th, "mouseover");
        const tip = tipOf(win);
        expect(tip.style.opacity).toBe("1");
        expect(tip.innerHTML).toContain("command family");
        expect(tip.innerHTML).toContain("gate, test, git");
        expect(tip.getAttribute("aria-hidden")).toBe("false");

        fire(win, th, "mouseout");
        expect(tipOf(win).style.opacity).toBe("0");
    });

    it("is reachable by keyboard and dismissible with Escape", () => {
        const win = mountPage(`<span id="c" data-term="pct"></span>`);
        installTooltipEngine();
        const el = win.document.getElementById("c")!;

        fire(win, el, "focusin");
        expect(tipOf(win).style.opacity).toBe("1");
        expect(tipOf(win).innerHTML).toContain("budget used");

        fire(win, win.document.body, "keydown", { key: "Escape" });
        expect(tipOf(win).style.opacity).toBe("0");
        expect(tipOf(win).getAttribute("aria-hidden")).toBe("true");

        // …and blur closes it too, so tabbing through never leaves one open.
        fire(win, el, "focusin");
        expect(tipOf(win).style.opacity).toBe("1");
        fire(win, el, "focusout");
        expect(tipOf(win).style.opacity).toBe("0");
    });

    it("keeps an element's own text and only adds the explanation", () => {
        const win = mountPage(
            `<table><thead><tr><th id="c" data-term="cmd_bucket">cmd</th></tr></thead></table>`
        );
        installTooltipEngine();
        const th = win.document.getElementById("c")!;
        expect(th.textContent).toBe("cmd");
        fire(win, th, "mouseover");
        expect(tipOf(win).innerHTML).toContain("command family");
    });

    it("picks up a term rendered AFTER install — the innerHTML re-render case", async () => {
        const win = mountPage(`<div id="host"></div>`);
        installTooltipEngine();
        const host = win.document.getElementById("host")!;

        // Exactly what every table on this dashboard does on refresh.
        host.innerHTML = `<table><thead><tr><th id="late" data-term="model_req"></th></tr></thead></table>`;
        await new Promise((r) => setTimeout(r, 0));

        const late = win.document.getElementById("late")!;
        expect(late.textContent).toBe("model requested");
        expect(late.getAttribute("tabindex")).toBe("0");
        fire(win, late, "mouseover");
        expect(tipOf(win).innerHTML).toContain("inherited");
    });

    it("reports a term it cannot resolve instead of rendering it plain and silent", () => {
        const win = mountPage(
            `<span id="c" data-term="totally_made_up"></span>`
        );
        const { enhanced, unknown } = installTooltipEngine();
        expect(unknown).toEqual(["totally_made_up"]);
        expect(enhanced).toHaveLength(0);
        const el = win.document.getElementById("c")!;
        expect(el.hasAttribute("tabindex")).toBe(false);
    });

    it("enhances the same element only once", () => {
        const win = mountPage(`<span id="c" data-term="pri"></span>`);
        installTooltipEngine();
        const first = win.document.getElementById("c")!.textContent;
        expect(enhanceTerms(win.document).enhanced).toHaveLength(0);
        expect(win.document.getElementById("c")!.textContent).toBe(first);
    });

    it("escapes glossary text rather than injecting it as markup", () => {
        const html = tooltipHtml({
            label: "a<b>",
            tip: "counts <script>alert(1)</script> things",
        });
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });
});

describe("dashboard tooltip engine — the imperative chart path still works (#2625)", () => {
    beforeEach(() => resetTooltipEngine());

    it("showTip/hideTip keep their #2625 signatures for the chart surfaces", () => {
        // `history-timeline.js` and `history-ranking.js` call exactly this
        // pair with per-datum HTML. #2629 evolved the module around them; if
        // this breaks, both charts lose their tooltips.
        const win = mountPage(`<div id="anchor"></div>`);
        showTip({ clientX: 100, clientY: 200 }, "<b>x</b> 12 calls");
        const tip = tipOf(win);
        expect(tip.style.opacity).toBe("1");
        expect(tip.innerHTML).toBe("<b>x</b> 12 calls");
        expect(tip.style.left).toBe("114px");
        expect(tip.style.top).toBe("214px");
        hideTip();
        expect(tipOf(win).style.opacity).toBe("0");
    });
});
