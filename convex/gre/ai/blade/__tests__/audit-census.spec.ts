// Issue #4925 — the audit census (ADR 0149 §5).
//
//  1. Always-on: the census on a fixture registry of two themes, once per
//     pair source (the `pairOf` field, the `PAIRED WITH` prose).
//  2. Opt-in RUNNER (BLADE_AUDIT_CENSUS=<out.json>) — reads the real registry
//     and writes the rows; `bun run blade:audit-census` sets it and prints
//     the table. A registry read, no `runBladeScenario`.
//
// It lives HERE for the reason `verdict-coverage.spec.ts` gives: importing the
// registry pulls `convex/game.ts` and with it `lib.dom`, which reds an
// unrelated script in the `scripts` project.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import {
    auditCensus,
    formatAuditCensus,
    type CensusScenario,
} from "../auditCensus";
import { AUDIT_THEME_LIST } from "../auditThemes";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

const BLINK = "cast × blink";
const TAPPED = "land-drop × enters-tapped";
const BARE = "targeting × any";
const THEMES = [BLINK, TAPPED, BARE] as const;

/** Three themes: blink has one red anchor + one green half (issue #111);
 *  enters-tapped one all-green pair; targeting no pair at all. */
const BY_FIELD: CensusScenario[] = [
    {
        label: "blink anchor",
        tier: "stretch",
        audit: { theme: BLINK },
        beyondBudget: { cause: "search-depth", note: "issue #111 open" },
    },
    {
        label: "blink half",
        tier: "must",
        audit: { theme: BLINK },
        pairOf: {
            anchor: "blink anchor",
            discriminant: { kind: "other", detail: "flicker target" },
        },
    },
    { label: "tapped anchor", tier: "must", audit: { theme: TAPPED } },
    {
        label: "tapped half",
        tier: "must",
        pairOf: {
            anchor: "tapped anchor",
            discriminant: { kind: "other", detail: "tapped land" },
        },
    },
    { label: "unrelated", tier: "must" },
];

const BY_PROSE: CensusScenario[] = [
    { label: "blink anchor", tier: "stretch", audit: { theme: BLINK } },
    {
        label: "blink half",
        tier: "must",
        audit: { theme: BLINK },
        note: 'Half 2 — PAIRED WITH "blink anchor". Guards issue #111.',
    },
];

describe("audit census (issue #4925)", () => {
    it("counts pairs and red/green per theme, from the pair field", () => {
        expect(auditCensus(BY_FIELD, THEMES)).toEqual([
            { theme: BLINK, pairs: 1, red: 1, green: 1, issues: [111] },
            { theme: TAPPED, pairs: 1, red: 0, green: 2, issues: [] },
            { theme: BARE, pairs: 0, red: 0, green: 0, issues: [] },
        ]);
    });

    it("counts them from the PAIRED WITH prose when no field is set", () => {
        expect(auditCensus(BY_PROSE, THEMES)).toEqual([
            { theme: BLINK, pairs: 1, red: 1, green: 1, issues: [111] },
            { theme: TAPPED, pairs: 0, red: 0, green: 0, issues: [] },
            { theme: BARE, pairs: 0, red: 0, green: 0, issues: [] },
        ]);
    });

    it("counts a pair declared from both sides once", () => {
        const both: CensusScenario[] = [
            ...BY_PROSE,
            { ...BY_PROSE[0]!, note: 'PAIRED WITH "blink half"' },
        ];
        expect(auditCensus(both, THEMES)[0]!.pairs).toBe(1);
    });

    it("lists every theme of the closed list, zero-pair ones included", () => {
        const rows = auditCensus([]);
        expect(rows.map((r) => r.theme)).toEqual(AUDIT_THEME_LIST);
        expect(rows.every((r) => r.pairs === 0)).toBe(true);
    });

    it("drops a theme row when the theme is dropped from the list", () => {
        const rows = auditCensus(BY_FIELD, [BLINK]);
        expect(rows.map((r) => r.theme)).toEqual([BLINK]);
        expect(formatAuditCensus(rows)).not.toContain(BARE);
    });

    it("prints a row per theme with its issues", () => {
        const text = formatAuditCensus(auditCensus(BY_FIELD, THEMES));
        expect(text).toContain(`${BLINK}`);
        expect(text).toContain("#111");
        expect(text).toContain("1/3 themes have no pair");
    });
});

const OUT = ENV.BLADE_AUDIT_CENSUS;

describe.runIf(OUT !== undefined && OUT !== "")("audit census (runner)", () => {
    it("reads the real registry", async () => {
        const rows = auditCensus(BLADE_SCENARIOS);
        const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
            writeFileSync: (p: string, d: string) => void;
        };
        fs.writeFileSync(OUT!, JSON.stringify(rows));
        expect(rows).toHaveLength(AUDIT_THEME_LIST.length);
    });
});
