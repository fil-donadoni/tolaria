import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
// @ts-expect-error — browser ES modules with no type declarations; the
// dashboard is deliberately plain JS with no build step (#2625).
import { GLOSSARY } from "../dashboard/glossary.js";
// @ts-expect-error — same.
import { state, setMeta } from "../dashboard/history-state.js";
// @ts-expect-error — same. `renderFilters()` and `syncMetricLabelTerm()`
// touch no network (only `refresh()`, from history-refresh.js, does); safe
// to call directly.
import {
    renderFilters,
    syncMetricLabelTerm,
} from "../dashboard/history-filters.js";

/**
 * History's filter bar (#2633) — every dataset/dimension/metric name it
 * renders must come from the glossary, never a raw column name.
 *
 * The failure mode this guards: inlining the raw→label table from the issue
 * body straight into the view (passes every visual check, forks the
 * vocabulary the moment glossary.js changes). So these assertions read the
 * REAL rendered DOM through the real `renderFilters()` — never a hand-built
 * fixture — and check it against `GLOSSARY` itself, so a relabel in
 * glossary.js is automatically reflected here with no test edit.
 *
 * `history-state.js`'s `state`/`META` are module-level singletons (the `node`
 * vitest project runs `isolate: false`, sharing one module registry per
 * worker — documented in vitest.config.ts), so every test mutates the SAME
 * `state` object rather than re-importing a fresh one, and `beforeEach`
 * resets it to a known slice.
 */

/** A realistic `/api/meta` slice: three datasets, each with its own
 *  dimensions/metrics, mirroring `DIMENSIONS`/`METRICS` in
 *  `telemetry-serve.ts` closely enough to exercise every qualified-key path
 *  (`agent_runs.model`, `agent_runs.messages`, …). */
const META = {
    dimensions: {
        spans: [
            "day",
            "hour",
            "tool",
            "kind",
            "role",
            "agent_type",
            "model_req",
            "skill",
            "cmd_bucket",
            "session",
        ],
        llm: ["day", "hour", "model", "effort", "surface", "role", "session"],
        agent_runs: ["day", "hour", "model", "agent_type", "role", "session"],
    },
    metrics: {
        spans: {
            calls: "count(*)",
            total_seconds: "sum(dur_s)",
            avg_seconds: "avg(dur_s)",
            max_seconds: "max(dur_s)",
        },
        llm: {
            messages: "count(*)",
            cost_usd: "sum(cost)",
            output_tokens: "sum(out_tok)",
        },
        agent_runs: {
            runs: "count(*)",
            messages: "sum(msgs)",
            max_seconds: "max(dur_s)",
        },
    },
    values: {
        spans: { cmd_bucket: ["gate", "test", "bash"] },
        llm: { role: ["implement", "review"] },
        agent_runs: { role: ["implement", "review", "fixup"] },
    },
};

const INSTALLED_GLOBALS = [
    "document",
    "innerWidth",
    "innerHeight",
    "fetch",
] as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
let win: Window;

/** Point `state` at a given (table, metric, split) slice, filters cleared —
 *  the shape `renderFilters()` reads at the top of its own body. */
function setSlice(table: string, metric: string, split: string) {
    Object.assign(state, { table, metric, split, filters: {} });
}

beforeEach(() => {
    win = new Window({ url: "http://localhost/" });
    win.document.body.innerHTML = `<div id="filters"></div><div id="tip"></div>`;
    g.document = win.document;
    g.innerWidth = 1440;
    g.innerHeight = 900;
    setMeta(META);
});

afterEach(() => {
    for (const key of INSTALLED_GLOBALS) delete g[key];
});

describe("History filter bar — glossary-sourced labels (#2633)", () => {
    it("renders the Dataset select's options as glossary labels, never raw table names", () => {
        setSlice("agent_runs", "messages", "role");
        renderFilters();

        const options = [
            ...win.document.querySelectorAll("#f-table option"),
        ] as unknown as HTMLOptionElement[];
        expect(options.length).toBe(3);
        for (const o of options) {
            const raw = o.getAttribute("value")!;
            const expectedLabel = GLOSSARY[raw]?.label;
            expect(expectedLabel).toBeTruthy();
            expect(o.textContent).toBe(expectedLabel);
            // Never the raw name itself, verbatim, as the visible text.
            expect(o.textContent).not.toBe(raw);
        }
    });

    it("renders the Metric select's options as glossary labels, qualified by the current dataset", () => {
        setSlice("agent_runs", "messages", "role");
        renderFilters();

        const options = [
            ...win.document.querySelectorAll("#f-metric option"),
        ] as unknown as HTMLOptionElement[];
        expect(options.length).toBe(3);
        const maxOpt = options.find(
            (o) => o.getAttribute("value") === "max_seconds"
        )!;
        // `agent_runs.max_seconds` has its OWN glossary entry ("longest
        // run"), distinct from the bare `max_seconds` entry ("slowest") a
        // per-call table like `spans` resolves to — the qualified-key case
        // this test exists to pin.
        expect(maxOpt.textContent).toBe(
            GLOSSARY["agent_runs.max_seconds"].label
        );
        expect(maxOpt.textContent).not.toBe(GLOSSARY["max_seconds"].label);
    });

    it("renders the Split-by select's options as glossary labels, excluding 'day'", () => {
        setSlice("spans", "calls", "cmd_bucket");
        renderFilters();

        const options = [
            ...win.document.querySelectorAll("#f-split option"),
        ] as unknown as HTMLOptionElement[];
        expect(options.some((o) => o.getAttribute("value") === "day")).toBe(
            false
        );
        const cmdBucketOpt = options.find(
            (o) => o.getAttribute("value") === "cmd_bucket"
        )!;
        expect(cmdBucketOpt.textContent).toBe(GLOSSARY["cmd_bucket"].label);
    });

    it("the 'Filter · <dimension>' header reads the split's glossary label, not its raw key", () => {
        setSlice("spans", "calls", "cmd_bucket");
        renderFilters();

        const field = win.document
            .querySelector("#f-chips")!
            .closest(".field")!;
        const label = field.querySelector("label")!;
        expect(label.textContent).toContain(GLOSSARY["cmd_bucket"].label);
        expect(label.textContent).not.toContain("cmd_bucket");
    });

    it("the Dataset/Metric/Split-by captions carry a resolvable data-term for the CURRENT selection", () => {
        setSlice("agent_runs", "messages", "role");
        renderFilters();

        const tableTerm = win.document
            .querySelector('label[for="f-table"]')!
            .getAttribute("data-term");
        const metricTerm = win.document
            .querySelector('label[for="f-metric"]')!
            .getAttribute("data-term");
        const splitTerm = win.document
            .querySelector('label[for="f-split"]')!
            .getAttribute("data-term");

        expect(tableTerm).toBe("agent_runs");
        expect(metricTerm).toBe("agent_runs.messages");
        expect(splitTerm).toBe("agent_runs.role");
        expect(GLOSSARY[tableTerm!]).toBeTruthy();
        expect(GLOSSARY["agent_runs.messages"]).toBeTruthy();
    });

    it("a metric-only change (no full re-render) keeps the Metric caption's data-term in sync", () => {
        setSlice("agent_runs", "messages", "role");
        renderFilters();
        expect(
            win.document
                .querySelector('label[for="f-metric"]')!
                .getAttribute("data-term")
        ).toBe("agent_runs.messages");

        // The real `f-metric` change handler mutates `state.metric` then
        // calls `syncMetricLabelTerm()` WITHOUT a full `renderFilters()` —
        // reproduce exactly that, not a hand-built substitute.
        state.metric = "max_seconds";
        syncMetricLabelTerm();

        const metricTerm = win.document
            .querySelector('label[for="f-metric"]')!
            .getAttribute("data-term");
        expect(metricTerm).toBe("agent_runs.max_seconds");
    });

    /**
     * Proof-of-wiring (#2839): the prior test drives `syncMetricLabelTerm()`
     * directly and would stay green even if `bind()`'s `f-metric` handler
     * stopped calling it — it never exercises the call SITE, only the
     * function in isolation. This one dispatches a real DOM `change` event
     * on `#f-metric`, the same way a user's select does, so it can only pass
     * if `bind("f-metric", "metric", false)` in `renderFilters()` still
     * wires `syncMetricLabelTerm()` into the handler.
     *
     * `refresh()` (history-refresh.js) also runs on every change — real
     * wiring, not a mock of it — so this stubs `fetch` to reject and gives
     * it just enough DOM (the ids `refresh()` writes before/after its
     * `try`) to land in its own catch branches instead of throwing on a
     * missing element.
     */
    it("the f-metric 'change' handler actually calls syncMetricLabelTerm() (proof-of-wiring)", () => {
        setSlice("agent_runs", "messages", "role");
        renderFilters();
        for (const id of [
            "ts-title",
            "rank-title",
            "rank-sub",
            "tbl-sub",
            "tbl",
            "issues-sub",
        ]) {
            const div = win.document.createElement("div");
            div.id = id;
            win.document.body.appendChild(div);
        }
        g.fetch = () => Promise.reject(new Error("test: no network"));

        const select = win.document.getElementById(
            "f-metric"
        ) as unknown as HTMLSelectElement;
        select.value = "max_seconds";
        select.dispatchEvent(
            new win.Event("change", { bubbles: true, cancelable: true })
        );

        // `syncMetricLabelTerm()` runs synchronously inside the handler,
        // before the (unawaited) `refresh()` call — no await needed.
        const metricTerm = win.document
            .querySelector('label[for="f-metric"]')!
            .getAttribute("data-term");
        expect(metricTerm).toBe("agent_runs.max_seconds");
    });
});
