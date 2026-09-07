import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    coerceSlice,
    DEFAULT_SLICE,
    getSlice,
    paramsToSlice,
    resetHistoryState,
    setSlice,
    SLICE_KEYS,
    sliceToParams,
    type HistorySlice,
} from "../historyState";
import type { HistoryMeta } from "../historyPayload";

/**
 * History's shared slice and its URL round trip (#2635 AC: "loading a produced
 * URL restores exactly that state"), ported with the module in PRD #3148 S3.
 *
 * ── WHY THE ROUND TRIP IS THE HARD PART ───────────────────────────────────
 *
 * The slice is a structured object — eight fields, one of them a nested map —
 * not a scalar. A serializer that names the fields it happens to know about
 * passes every test written against today's shape and silently drops the NEXT
 * field somebody adds, or one currently set to a non-default value nobody
 * thought to try. So the first test below sets EVERY field non-default AT
 * ONCE, including `filters`, and snapshots the original with `structuredClone`
 * BEFORE the restore path writes the same store back — comparing against a
 * live reference would compare the object to itself and pass vacuously
 * whatever the restore did.
 *
 * ── WHAT REPLACED THE "GENERICITY" TEST ───────────────────────────────────
 *
 * The vanilla module walked `Object.keys(state)` at call time, and its suite
 * proved that by adding a field at runtime and watching it round-trip. It also
 * documented that walk's own footgun: the TYPE to restore as was inferred from
 * the field's live value, so a field whose default is `null` but which is
 * meant to hold an object restored as a plain string on its very first load.
 *
 * The port declares the codecs instead (`CODECS`, a
 * `Record<keyof HistorySlice, …>`), which removes the ambiguity and makes a
 * field added without a codec a COMPILE error rather than a silently dropped
 * parameter. A runtime test cannot observe a compile error, so what stands in
 * its place is the second test below: the walked key set IS the slice's key
 * set, which is the assertion that goes red if the two ever diverge in the one
 * direction `tsc` cannot see (a codec for a field the slice no longer has).
 */

beforeEach(resetHistoryState);
afterEach(resetHistoryState);

const FULLY_SET: HistorySlice = {
    table: "llm",
    metric: "cost_usd",
    split: "model",
    from: "2026-01-01",
    to: "2026-02-15",
    filters: { role: ["review", "fixup"], model: ["opus", "sonnet"] },
    sort: "cost_usd",
    sortDir: 1,
};

describe("History URL round trip (#2635)", () => {
    it("round-trips EVERY field at once, including the nested filters object, through a serialize → reset → restore cycle", () => {
        setSlice(FULLY_SET);
        const original = structuredClone(getSlice());

        const query = sliceToParams(new URLSearchParams()).toString();

        // "A fresh page load": the store back to its defaults, as if this were
        // a brand new tab that had never touched the filter bar.
        resetHistoryState();
        expect(getSlice()).toEqual(DEFAULT_SLICE);

        setSlice(paramsToSlice(new URLSearchParams(query)));
        expect(getSlice()).toEqual(original);
    });

    it("the walked key set IS the slice's key set — a field the round trip does not know about cannot exist", () => {
        expect([...SLICE_KEYS].sort()).toEqual(
            Object.keys(DEFAULT_SLICE).sort()
        );
    });

    it("omits a default/empty field from the URL rather than writing it as noise", () => {
        // `sort: null` and `filters: {}` are the two defaults most likely to
        // round-trip as visible garbage (`sort=null`, `filters=%7B%7D`).
        const params = sliceToParams(new URLSearchParams());
        expect(params.has("sort")).toBe(false);
        expect(params.has("filters")).toBe(false);
        expect(params.has("from")).toBe(false);
        expect(params.has("to")).toBe(false);
    });

    it("restoring from a malformed filters value keeps the current value instead of throwing", () => {
        setSlice({ filters: { role: ["review"] } });
        const before = structuredClone(getSlice().filters);
        expect(() =>
            setSlice(
                paramsToSlice(new URLSearchParams({ filters: "{not json" }))
            )
        ).not.toThrow();
        expect(getSlice().filters).toEqual(before);
    });

    it("preserves every OTHER param on the URL (view, theme) — the serializer only ever touches the slice's own keys", () => {
        const params = new URLSearchParams("?view=history&theme=dark");
        setSlice({ table: "llm" });
        sliceToParams(params);
        expect(params.get("view")).toBe("history");
        expect(params.get("theme")).toBe("dark");
        expect(params.get("table")).toBe("llm");
    });

    it("restores sortDir as a NUMBER, not the string URLSearchParams hands back — every read site compares with ===", () => {
        setSlice({ sortDir: 1 });
        const query = sliceToParams(new URLSearchParams()).toString();
        resetHistoryState();
        setSlice(paramsToSlice(new URLSearchParams(query)));
        expect(getSlice().sortDir).toBe(1);
        expect(typeof getSlice().sortDir).toBe("number");
    });

    it("leaves a field the URL is silent about at its current value", () => {
        setSlice({ metric: "cost_usd", split: "model" });
        setSlice(paramsToSlice(new URLSearchParams("?table=llm")));
        expect(getSlice().table).toBe("llm");
        expect(getSlice().metric).toBe("cost_usd");
        expect(getSlice().split).toBe("model");
    });
});

/**
 * `coerceSlice` is what stops a STALE LINK from wedging the page: a bookmark
 * naming a dataset, metric or split this store does not have must land on
 * something real rather than on a query that returns an error for a reason
 * nothing on screen explains.
 */
const META: HistoryMeta = {
    dimensions: {
        agent_runs: ["day", "agent_id", "role", "model"],
        llm: ["day", "session", "model"],
    },
    metrics: {
        agent_runs: { runs: "count(*)", total_seconds: "sum(sec)" },
        llm: { messages: "count(*)", cost_usd: "sum(cost)" },
    },
    values: {},
    counts: { spans: 1, llm: 1, agent_runs: 1 },
    range: { min_day: "2026-01-01", max_day: "2026-02-01" },
    lastIngest: 0,
} as unknown as HistoryMeta;

describe("coerceSlice — a stale link degrades, it never wedges", () => {
    it("falls back to agent_runs for a dataset this store does not have", () => {
        const out = coerceSlice({ ...DEFAULT_SLICE, table: "gone" }, META);
        expect(out.table).toBe("agent_runs");
    });

    it("falls back to the dataset's FIRST metric when the named one is not one of its own", () => {
        const out = coerceSlice(
            { ...DEFAULT_SLICE, table: "llm", metric: "total_seconds" },
            META
        );
        expect(out.metric).toBe("messages");
    });

    it("falls back to the dataset's third dimension for the split — `day` is the x-axis and the id column is per-row", () => {
        const out = coerceSlice(
            { ...DEFAULT_SLICE, table: "llm", split: "role" },
            META
        );
        expect(out.split).toBe("model");
    });

    it("returns the SAME object when nothing needed correcting — a caller may publish unconditionally without looping the store", () => {
        const valid: HistorySlice = {
            ...DEFAULT_SLICE,
            table: "llm",
            metric: "cost_usd",
            split: "model",
        };
        expect(coerceSlice(valid, META)).toBe(valid);
    });
});
