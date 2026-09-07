// OP_BENEFICENCE catalogue census guard (issue #3006, slice of #2998 Gap 1).
//
// The sibling of `opValuerCoverage.bot.test.ts`, one site over. `OP_VALUERS`
// answers "how much is this Op worth to the CASTER" and has had a coverage
// guard since issue #1426; `OP_BENEFICENCE` answers the orthogonal question
// "for the player on the RECEIVING end, is this a gift or an attack" and had
// none — `/new-op`'s own site table marked site 7b `❌ none`. It is read as
// `?? "neutral"`, so an Op nobody signed reads exactly like an Op somebody
// decided was signless, and the bot ends up handing Wild Growth to its
// opponent for want of a row.
//
// This guard closes that. Every `status: "implemented"` Op in
// `EFFECT_OP_REGISTRY` must be accounted for by ONE of:
//
//   • a static row in `OP_BENEFICENCE` (`convex/gre/ai/opValuers.ts`), OR
//   • membership of `PARAMETRIZED_BENEFICENCE_OPS` — the Ops `opBeneficence`
//     signs from their own fields (`pump`, `counters`, `addPlayerCounter`,
//     `tapUntap`, `scryReorder`), OR
//   • membership of `STRUCTURAL_CONSTRUCTS` — `if`/`forEach`/`optionChoice`/
//     `coinFlip`/`coinFlipSync`, which `collectScriptSigns`
//     (`convex/gre/ai/beneficence.ts`) recurses into rather than signing.
//
// There is deliberately NO allowlist. The `OP_VALUER_BACKFILL` shape does not
// transfer: a missing VALUER is a magnitude you can defer, while a missing
// SIGN is indistinguishable at runtime from a considered `"neutral"`, so a
// deferral row would re-create the exact ambiguity being closed. An Op that
// genuinely moves no stake its recipient could be redirected over earns a
// `"neutral"` ROW plus a comment saying why — and the last test below enforces
// the comment, because a row with no reason is the allowlist under another
// name.
//
// Census at the time of writing (branched from 4bd2e86dc): 94 implemented Ops
// = 83 static rows (59 real signs + 24 explicit `"neutral"` ones) + 6
// parametrized + 5 structural. Twenty-six of those rows are this issue's: 3
// signs and 23 neutrals. The counts are prose, not an assertion — the
// partition test below is what actually holds them together.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EFFECT_OP_REGISTRY, isRegisteredEffectOp } from "../mechanicsRegistry";
import {
    OP_BENEFICENCE,
    PARAMETRIZED_BENEFICENCE_OPS,
    STRUCTURAL_CONSTRUCTS,
} from "../../gre/ai";

const OP_VALUERS_SOURCE = fileURLToPath(
    new URL("../../gre/ai/opValuers.ts", import.meta.url)
);

/** The static-row names, as the source file spells them. */
const signedOps = Object.keys(OP_BENEFICENCE);

/** The `OP_BENEFICENCE` literal's own lines, plus one entry per `"neutral"`
 *  row with the index of the line it sits on. Source-scanning because the
 *  thing being enforced — a written REASON — exists only in the source; the
 *  caller reconciles the result against the runtime table so a row the pattern
 *  misses reds instead of going unchecked. */
function beneficenceTableRows(): {
    rows: { op: string; line: number }[];
    lines: string[];
} {
    const src = readFileSync(OP_VALUERS_SOURCE, "utf8");
    const start = src.indexOf("export const OP_BENEFICENCE: { [K in EffectOp");
    expect(start, "OP_BENEFICENCE table not found").toBeGreaterThan(-1);
    const table = src.slice(start, src.indexOf("\n};", start));
    const lines = table.split("\n");
    const rows: { op: string; line: number }[] = [];
    lines.forEach((line, i) => {
        const match = /^\s*(\w+):\s*"neutral",\s*$/.exec(line);
        if (match) rows.push({ op: match[1], line: i });
    });
    return { rows, lines };
}

/** Every `case "<op>":` label in `opBeneficence`'s switch — the reader's own
 *  list of parametrized Ops, read from the source because there is no runtime
 *  handle on a switch. Bounded at the function's closing brace so it cannot
 *  quietly start scanning whatever is appended to the file next. */
function opBeneficenceSwitchCases(): string[] {
    const src = readFileSync(OP_VALUERS_SOURCE, "utf8");
    const start = src.indexOf("export function opBeneficence(");
    expect(start, "opBeneficence not found").toBeGreaterThan(-1);
    const end = src.indexOf("\n}", start);
    const body = src.slice(start, end === -1 ? undefined : end);
    return [...body.matchAll(/^\s*case "(\w+)":/gm)].map((m) => m[1]);
}

describe("OP_BENEFICENCE census (issue #3006)", () => {
    const implementedOps = EFFECT_OP_REGISTRY.filter(
        (r) => r.status === "implemented"
    ).map((r) => r.op);

    it('every implemented Op is signed, parametrized, or structural — nothing falls through to the `?? "neutral"` fallback', () => {
        const offenders = implementedOps.filter(
            (op) =>
                !(op in OP_BENEFICENCE) &&
                !PARAMETRIZED_BENEFICENCE_OPS.has(op) &&
                !STRUCTURAL_CONSTRUCTS.has(op as never)
        );
        expect(
            offenders,
            "implemented Ops with NO beneficence sign — they read `neutral` " +
                "indistinguishably from a considered signless Op. Add a row to " +
                "OP_BENEFICENCE (convex/gre/ai/opValuers.ts): a real sign, or " +
                '`"neutral"` with a one-line comment saying why the Op moves no ' +
                "stake. There is no allowlist here on purpose."
        ).toEqual([]);
    });

    it("the parametrized set is disjoint from the static table (a listed neutral Op that later gains a sign reds)", () => {
        const doubled = [...PARAMETRIZED_BENEFICENCE_OPS].filter(
            (op) => op in OP_BENEFICENCE
        );
        expect(
            doubled,
            "these Ops are BOTH in OP_BENEFICENCE and in " +
                "PARAMETRIZED_BENEFICENCE_OPS — `opBeneficence`'s switch wins, so " +
                "the static row is dead text claiming a sign the reader never " +
                "consults. Delete one of the two."
        ).toEqual([]);
    });

    it("structural constructs are recursed into, never signed", () => {
        for (const op of STRUCTURAL_CONSTRUCTS) {
            expect(op in OP_BENEFICENCE).toBe(false);
            expect(PARAMETRIZED_BENEFICENCE_OPS.has(op)).toBe(false);
        }
    });

    it("every signed Op is a real, still-implemented Op (no stale rows)", () => {
        for (const op of [...signedOps, ...PARAMETRIZED_BENEFICENCE_OPS]) {
            expect(
                isRegisteredEffectOp(op),
                `${op} carries a beneficence sign but is not an implemented Op — remove the stale row`
            ).toBe(true);
        }
    });

    it("the signed + parametrized + structural sets exactly partition the implemented Ops", () => {
        const covered = new Set<string>([
            ...signedOps,
            ...PARAMETRIZED_BENEFICENCE_OPS,
            ...STRUCTURAL_CONSTRUCTS,
        ]);
        for (const op of implementedOps) expect(covered.has(op)).toBe(true);
        for (const op of covered) expect(implementedOps).toContain(op);
    });

    it("`PARAMETRIZED_BENEFICENCE_OPS` and `opBeneficence`'s switch name exactly the same Ops, in both directions", () => {
        const cases = opBeneficenceSwitchCases();
        // Set → switch: a name the reader does not handle would fall to
        // `OP_BENEFICENCE[op] ?? "neutral"` while the census counted it signed.
        expect(
            [...PARAMETRIZED_BENEFICENCE_OPS].filter(
                (op) => !cases.includes(op)
            ),
            "in PARAMETRIZED_BENEFICENCE_OPS with no `case` in opBeneficence"
        ).toEqual([]);
        // Switch → set, and switch → table: a `case` for an Op that ALSO has a
        // static row makes that row dead text claiming a sign nobody reads.
        expect(
            cases.filter((op) => !PARAMETRIZED_BENEFICENCE_OPS.has(op)),
            "handled by opBeneficence's switch but missing from PARAMETRIZED_BENEFICENCE_OPS"
        ).toEqual([]);
        expect(
            cases.filter((op) => op in OP_BENEFICENCE),
            "handled by opBeneficence's switch AND carrying a static OP_BENEFICENCE row — the switch wins, so the row is dead text"
        ).toEqual([]);
    });

    // The row-with-no-reason check. This is the one that keeps the census
    // honest: without it, closing a coverage red is a one-word edit
    // (`op: "neutral",`) that reads as a decision and records nothing — which
    // is the pre-seeded allowlist the ticket explicitly ruled out.
    //
    // It demands a comment DIRECTLY above each row. An earlier draft allowed
    // one comment to cover a contiguous run of rows, and review showed that
    // handed every new row its neighbour's reason for free — appending
    // `brandNewOp: "neutral",` under an explained row passed. Grouping is gone;
    // rows that shared a reason each carry their own.
    it('every `"neutral"` row carries a comment of its own saying why the Op moves no stake', () => {
        const { rows, lines } = beneficenceTableRows();

        // Reconcile the SCAN against the runtime table first. Without this the
        // regex is a fail-open: a row the pattern misses (a reflow changing the
        // indent, a value written on the next line) is silently unchecked
        // rather than flagged.
        const neutralAtRuntime = Object.entries(OP_BENEFICENCE)
            .filter(([, sign]) => sign === "neutral")
            .map(([op]) => op)
            .sort();
        expect(
            rows.map((r) => r.op).sort(),
            "the source scan and the runtime table disagree about which rows are " +
                '`"neutral"` — the scan is what enforces the reasons, so a row it ' +
                "cannot see is a row nobody has to explain. Fix the regex, not this assertion."
        ).toEqual(neutralAtRuntime);

        const unexplained = rows
            .filter(({ line }) => {
                const above = line > 0 ? lines[line - 1].trimStart() : "";
                // A SECTION DIVIDER (`// ── Binds a value … ──`) is not a
                // reason — it says what the group is about, not why THIS Op
                // moves no stake. Proving this test could fail is what surfaced
                // the difference: deleting a row's real comment left the
                // divider above it and the check stayed green.
                return !above.startsWith("//") || above.startsWith("// ─");
            })
            .map((r) => r.op);

        expect(
            unexplained,
            'these OP_BENEFICENCE rows are `"neutral"` with no comment directly ' +
                "above them. A neutral sign is a DECISION: write the one line " +
                "saying why this Op moves no stake its recipient could be " +
                'redirected over. "Deferred" and a tracking issue are not reasons ' +
                "(issue #3006) — the guard cannot read prose, so that part is on " +
                "the author and the reviewer."
        ).toEqual([]);
    });
});
