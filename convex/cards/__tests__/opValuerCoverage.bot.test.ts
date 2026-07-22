// OP_VALUERS catalogue coverage guard (PRD #1423, issues #1426/#1430). Mirrors
// the `mechanicsRegistry.test.ts` Guard A / `divergenceMarkers.test.ts` style:
// a catalogue-wide assertion that EVERY `status:"implemented"` Op in the Op
// registry (`EFFECT_OP_REGISTRY`, queried via `isRegisteredEffectOp`) is
// accounted for by the per-Op value model — either
//
//   • it has a leaf valuer in `OP_VALUERS`, OR
//   • it is a structural construct the walker handles (`STRUCTURAL_CONSTRUCTS`
//     — `if`/`forEach`/`optionChoice`/`coinFlip`), OR
//   • it sits on the explicit, append-only backfill allowlist
//     `OP_VALUER_BACKFILL` below.
//
// The guard is the exhaustiveness mechanism: a new implemented Op that is
// neither valued nor backfilled fails CI, so no Op silently lacks AI valuation
// (PRD #1423 story 17).
//
// ─────────────────────────────────────────────────────────────────────────
// Issue #1430 emptied the allowlist: every Op issue #1426 deferred now has an
// `OP_VALUERS` entry (`convex/gre/ai/opValuers.ts`). The allowlist stays
// declared (empty) rather than removed — several hygiene tests below
// reference it directly, and a future Op that ships without a valuer has
// exactly the same two-edit fix (add the `OP_VALUERS` entry, or append a new
// backfill row with a note) that emptied it the first time.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { EFFECT_OP_REGISTRY, isRegisteredEffectOp } from "../mechanicsRegistry";
import {
    OP_VALUERS,
    STRUCTURAL_CONSTRUCTS,
    VALUED_OR_STRUCTURAL,
} from "../../gre/ai";

/** Implemented Ops that DO NOT YET have a value model — the backfill
 *  allowlist (issue #1426 shipped the charter Ops only; issue #1430 emptied
 *  this to `[]`). APPEND-ONLY and alphabetically sorted. Each entry is an
 *  implemented Op name whose valuer is deferred; removing a name here +
 *  adding its `OP_VALUERS` entry is the whole of the per-Op backfill work.
 *  Keep this the single source of "known-unvalued" — the guard below
 *  cross-checks it against the live registry so a stale entry (an Op that has
 *  since gained a valuer, or is no longer implemented) also fails CI. */
export const OP_VALUER_BACKFILL: readonly string[] = [
    // castDuringResolution (CR 608.2f, issue #1477): resolve-time free/paid
    // mini-cast of a discarded/exiled card. Its value is the recursive value of
    // casting that card, which the flat OP_VALUERS heuristic can't size without
    // spell-level lookahead — deferred to the bot-AI valuation track (#1254).
    "castDuringResolution",
];

describe("OP_VALUERS coverage guard (PRD #1423, issue #1426)", () => {
    const implementedOps = EFFECT_OP_REGISTRY.filter(
        (r) => r.status === "implemented"
    ).map((r) => r.op);

    it("every implemented Op is valued, structural, or on the backfill allowlist", () => {
        const backfill = new Set(OP_VALUER_BACKFILL);
        const offenders = implementedOps.filter(
            (op) => !VALUED_OR_STRUCTURAL.has(op) && !backfill.has(op)
        );
        expect(
            offenders,
            "implemented Ops with NO value model — add a valuer to OP_VALUERS " +
                "(convex/gre/ai/opValuers.ts) or, if deferred, append the Op to " +
                "OP_VALUER_BACKFILL in this file with a note"
        ).toEqual([]);
    });

    it("the backfill allowlist is disjoint from the valued/structural sets (removing a row is #1430's only change)", () => {
        const doubled = OP_VALUER_BACKFILL.filter((op) =>
            VALUED_OR_STRUCTURAL.has(op)
        );
        expect(
            doubled,
            "these Ops are BOTH valued/structural AND on the backfill allowlist " +
                "— delete their OP_VALUER_BACKFILL rows"
        ).toEqual([]);
    });

    it("every backfill entry is a real, still-implemented Op (no stale rows)", () => {
        for (const op of OP_VALUER_BACKFILL) {
            expect(
                isRegisteredEffectOp(op),
                `${op} is on the backfill allowlist but is not an implemented Op — remove the stale row`
            ).toBe(true);
        }
    });

    it("the backfill allowlist is sorted and free of duplicates (append-only hygiene)", () => {
        const sorted = [...OP_VALUER_BACKFILL].sort();
        expect(OP_VALUER_BACKFILL).toEqual(sorted);
        expect(new Set(OP_VALUER_BACKFILL).size).toBe(
            OP_VALUER_BACKFILL.length
        );
    });

    it("the valued + structural + backfill sets exactly partition the implemented Ops", () => {
        const covered = new Set<string>([
            ...VALUED_OR_STRUCTURAL,
            ...OP_VALUER_BACKFILL,
        ]);
        // Every implemented Op is covered …
        for (const op of implementedOps) expect(covered.has(op)).toBe(true);
        // … and nothing covered is NOT an implemented Op (no phantom names,
        // excluding the structural constructs which are always implemented).
        for (const op of OP_VALUER_BACKFILL) {
            expect(implementedOps).toContain(op);
        }
    });

    it("the charter Ops (issue #1426) are all valued, not backfilled", () => {
        const charter = [
            "dealDamage",
            "draw",
            "gainLife",
            "loseLife",
            "destroy",
            "exile",
            "counter",
            "mayPay",
            "sacrifice",
            "moveZone",
            "createToken",
            "pump",
            "counters",
        ];
        for (const op of charter) {
            expect(Object.keys(OP_VALUERS)).toContain(op);
            expect(OP_VALUER_BACKFILL).not.toContain(op);
        }
    });

    it("structural constructs are handled by the walker, never on OP_VALUERS or the allowlist", () => {
        for (const op of STRUCTURAL_CONSTRUCTS) {
            expect(Object.keys(OP_VALUERS)).not.toContain(op);
            expect(OP_VALUER_BACKFILL).not.toContain(op);
        }
    });
});
