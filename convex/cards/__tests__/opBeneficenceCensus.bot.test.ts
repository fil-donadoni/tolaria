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
// Census at the time of writing (HEAD 4bd2e86dc): 94 implemented Ops, 61
// static rows, 5 parametrized, 5 structural, 23 explicit neutral rows.

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

    it("every parametrized Op is actually handled by `opBeneficence`'s switch (the set cannot claim a sign the reader does not give)", () => {
        const src = readFileSync(OP_VALUERS_SOURCE, "utf8");
        const body = src.slice(src.indexOf("export function opBeneficence("));
        for (const op of PARAMETRIZED_BENEFICENCE_OPS) {
            expect(
                body.includes(`case "${op}":`) ||
                    body.includes(`case "${op}": {`),
                `${op} is in PARAMETRIZED_BENEFICENCE_OPS but has no \`case "${op}"\` in ` +
                    "opBeneficence — it silently reads `neutral` while the census counts it as signed"
            ).toBe(true);
        }
    });

    // The row-with-no-reason check. This is the one that keeps the census
    // honest: without it, closing a coverage red is a one-word edit
    // (`op: "neutral",`) that reads as a decision and records nothing — which
    // is the pre-seeded allowlist the ticket explicitly ruled out.
    it('every `"neutral"` row carries a comment saying why the Op moves no stake', () => {
        const src = readFileSync(OP_VALUERS_SOURCE, "utf8");
        const start = src.indexOf(
            "export const OP_BENEFICENCE: { [K in EffectOp"
        );
        expect(start, "OP_BENEFICENCE table not found").toBeGreaterThan(-1);
        const table = src.slice(start, src.indexOf("\n};", start));
        const lines = table.split("\n");

        const unexplained: string[] = [];
        lines.forEach((line, i) => {
            const match = /^\s{4}(\w+):\s*"neutral",/.exec(line);
            if (!match) return;
            // Walk back over any contiguous run of sibling `"neutral"` rows —
            // one comment may legitimately cover a group (`delayedTrigger` /
            // `reflexiveTrigger` share a reason) — then require a comment.
            let j = i - 1;
            while (j >= 0 && /^\s{4}\w+:\s*"neutral",/.test(lines[j])) j--;
            if (j < 0 || !lines[j].trimStart().startsWith("//")) {
                unexplained.push(match[1]);
            }
        });

        expect(
            unexplained,
            'these OP_BENEFICENCE rows are `"neutral"` with no comment above ' +
                "them. A neutral sign is a DECISION: write the one line saying " +
                "why this Op moves no stake its recipient could be redirected " +
                'over. "Deferred" and a tracking issue are not reasons (issue #3006).'
        ).toEqual([]);
    });
});
