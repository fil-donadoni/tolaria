import { describe, it, expect, afterAll } from "vitest";
import { CLAIM_STAGES, LOOP_VERDICT_STATES } from "../lib/loop-status";
import { CLAIM_VERDICT_STATES } from "../loop-doctor";
import { pinEmptyProjectDir } from "../lib/pin-empty-project-dir";
import { GLOSSARY, lookupTerm } from "../../dashboard/glossary";

/**
 * The dashboard glossary's DRIFT GUARD (#2629), pointed upstream.
 *
 * ## Why it stayed in the `node` project (PRD #3148 S4)
 *
 * S4 moved the dashboard's tests to the `dom` project beside the components
 * they render. This file did not move, and the reason is its other half: it
 * iterates the SERVER's vocabularies — `DIMENSIONS`/`METRICS` in
 * `telemetry-serve.ts`, `CLAIM_STAGES`, `CLAIM_VERDICT_STATES`,
 * `LOOP_VERDICT_STATES` — which live in Node-typed modules that
 * `tsconfig.dashboard.json` (a browser program, no `@types/node`) cannot
 * check. There is no component here to render; the subject is a table and a
 * schema. What DID go with the components is the tooltip ENGINE half, which
 * had eleven cases against `scripts/dashboard/tooltip.js`: those are now
 * `dashboard/components/__tests__/Term.test.tsx` and `DynamicTerm.test.tsx`,
 * asserting the same behaviour against the render site that replaced the
 * `data-term` scanner.
 *
 * What changed here is only the import: the glossary is
 * `dashboard/glossary.ts`, typed, so the `@ts-expect-error` this file carried
 * on every import is gone.
 *
 * ## The guard points UPSTREAM, on purpose
 *
 * The completeness suite asserts each SERVER token resolves to a glossary
 * entry. The tempting shape, walking the glossary's own keys and checking each
 * value is a string, passes forever and guards nothing: it goes green on a
 * glossary that is a year behind the schema, which is exactly how the current
 * unexplained labels got onto the page. Pointed the other way, a dimension
 * added server-side with no human label reds this file.
 *
 * Every list is also asserted NON-EMPTY first. A drift guard that iterates an
 * empty collection passes vacuously, and an upstream refactor that renames a
 * vocabulary would otherwise silently disarm the check rather than break it.
 */

// See pin-empty-project-dir.ts — top-level, not a `beforeAll`, because
// module top-level code runs once, at this file's first import.
const restoreProjectDir = pinEmptyProjectDir("dashboard-glossary-test");

afterAll(restoreProjectDir);

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
        expect(runs!.tip).not.toBe(llm!.tip);
    });

    it("returns nothing for a term that was never declared", () => {
        expect(lookupTerm("not_a_real_dimension")).toBeUndefined();
        expect(lookupTerm("spans.not_a_real_dimension")).toBeUndefined();
        expect(lookupTerm("")).toBeUndefined();
    });
});
