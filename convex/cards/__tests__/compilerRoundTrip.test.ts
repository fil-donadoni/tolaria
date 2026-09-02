// Guard C — a hand-written card round-trips through the Oracle compiler, or
// names the fragment that stops it (issue #2701, PRD #2693).
//
// ── Why a third guard ──────────────────────────────────────────────────────
//
// Guard A polices a keyword a card DECLARES that the engine cannot honour.
// Guard B polices a clause a card's author knowingly DROPPED. Neither can see
// the gap the Oracle compiler introduced: a card whose hand-written definition
// is perfectly correct, and whose own Oracle text the grammar cannot read back
// into that same definition. Nothing about such a card is broken — which is
// exactly why it would accumulate silently. The compiler's whole premise is
// that the 2,051 hand-written definitions are its gold standard (PRD #2693,
// "gold as oracle"); a contributor who adds a card the compiler cannot read and
// says nothing shrinks that standard's coverage by one, invisibly, and the
// fragment that beat the grammar is never recorded anywhere.
//
// So: a hand-written card must do ONE of three things.
//
//   1. ROUND-TRIP — `roundTripCard` (the single comparator, shared with the
//      gold harness) says the compiler read the card's own text back into the
//      card's own behaviour. Structural equality for a DSL card; for a card
//      whose behaviour lives in a closure, "the compiler produced a definition
//      at all" is enough at THIS guard (the issue's own wording), because an
//      Effect Script and a `resolve()` are not comparable in either direction
//      — behavioural equality for those is its own ticket.
//   2. Carry a `compiler-gap: <fragment> (#issue)` marker in its own comment
//      paragraph. The fragment is the deliverable: it is what the corpus report
//      aggregates to rank the next grammar rule by corpus count (PRD #2693 user
//      story 9). "The compiler can't do this card" is not a fragment.
//   3. Be in the one-time BASELINE (`compilerRoundTrip.baseline.ts`), which
//      only ever shrinks — see that file's header for the three mechanisms,
//      each asserted below.
//
// ── What this guard deliberately does NOT do ───────────────────────────────
//
// It does not check that the marker's issue is OPEN. That is the same split
// Guard B makes: presence is offline and cheap and belongs in the gate; a
// liveness sweep needs the network and lives outside it
// (`scripts/check-marker-liveness.ts`).
//
// Proof-of-failure (gre-development.md § Proof-of-failure) is recorded in the
// PR: each of the assertions below was driven red by breaking the thing it
// guards, and the breaks are named there.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { getAllCards } from "../catalogue";
import { roundTripCard } from "../../oracle/gold";
import {
    COMPILER_GAP,
    scanCardAnchors,
    scanCompilerGapMarkers,
    scanFilesForCompilerGaps,
} from "../../../scripts/lib/compiler-gap-markers";
import {
    SETS_DIR,
    collectSetFiles,
} from "../../../scripts/lib/divergence-markers";
import { COMPILER_ROUND_TRIP_BASELINE } from "./compilerRoundTrip.baseline";

/**
 * The size the baseline was born at. LOWER it when cards graduate; never raise
 * it. This literal is the whole "never grows" mechanism: the stale-row check
 * below already forces a graduating card OUT, and this stops a new failing card
 * being parked IN — together they make the list one-directional without
 * pinning its exact contents, which would red every unrelated grammar
 * improvement (see the baseline file's header).
 */
const BASELINE_CEILING = 1756;

/**
 * The number of cards that genuinely round-trip, as measured at the commit that
 * introduced this guard. A vacuity floor, not a target: every assertion in this
 * file passes trivially if the compiler is switched off and every card lands in
 * the baseline, and this is the one that would not.
 */
const ROUND_TRIP_FLOOR = 250;

const CARDS = getAllCards();
const SET_FILES = collectSetFiles(SETS_DIR);

/** name → verdict, computed once for the whole catalogue. */
const VERDICTS = new Map(
    CARDS.map((card) => [card.name, roundTripCard(card).verdict] as const)
);

const MARKERS = scanFilesForCompilerGaps(SET_FILES);
const WELL_FORMED = MARKERS.filter(
    (m) => m.fragment !== undefined && m.card !== ""
);
const MARKED = new Set(WELL_FORMED.map((m) => m.card));
const BASELINE = new Set(COMPILER_ROUND_TRIP_BASELINE);

const where = (m: { file: string; line: number }): string =>
    `${path.relative(SETS_DIR, m.file)}:${m.line}`;

describe("Guard C — hand-written cards round-trip or declare a compiler gap (issue #2701)", () => {
    it("every card that does not round-trip carries a compiler-gap marker or a baseline row", () => {
        const offenders: string[] = [];
        for (const card of CARDS) {
            const verdict = VERDICTS.get(card.name)!;
            if (verdict.ok) continue;
            if (MARKED.has(card.name) || BASELINE.has(card.name)) continue;
            offenders.push(`${card.name}: ${verdict.kind} — ${verdict.detail}`);
        }
        expect(
            offenders,
            "hand-written cards whose own Oracle text the compiler cannot read back into " +
                "their own definition, with nothing said about it. Either make the card " +
                "round-trip, or add a `// compiler-gap: <fragment> (#issue)` line to the " +
                "card's own doc comment naming the exact Oracle fragment the grammar " +
                "cannot consume (see .claude/rules/gre-development.md § Guard C). The " +
                "baseline cannot be appended to — see its header."
        ).toEqual([]);
    });

    it("every compiler-gap marker is well-formed and attached to a card", () => {
        const offenders: string[] = [];
        for (const marker of MARKERS) {
            if (marker.fragment === undefined) {
                offenders.push(`${where(marker)}: malformed — ${marker.text}`);
                continue;
            }
            if (marker.card === "") {
                offenders.push(
                    `${where(marker)}: attached to no card — ${marker.text}`
                );
            }
        }
        expect(
            offenders,
            "compiler-gap markers that exempt nothing. The accepted shape is exactly " +
                "`// compiler-gap: <fragment> (#issue)` — a non-empty fragment and a " +
                "parenthesised issue ref, both on the marker's own line — and it must sit " +
                "in the comment paragraph directly above the card's `export const … : " +
                "CardDefinition` anchor. A marker inside the object literal, or two " +
                "paragraphs up, vouches for nothing."
        ).toEqual([]);
    });

    it("no compiler-gap marker outlives the gap it names", () => {
        const stale = WELL_FORMED.filter(
            (m) => VERDICTS.get(m.card)?.ok === true
        ).map((m) => `${where(m)}: ${m.card} round-trips now — ${m.text}`);
        expect(
            stale,
            "compiler-gap markers on cards the compiler now reads correctly. The grammar " +
                "caught up: delete the marker (and close its issue if that was the last " +
                "card holding it open)."
        ).toEqual([]);
    });

    it("the baseline holds no stale row: every row is a card that still fails and is not already documented", () => {
        const stale: string[] = [];
        for (const name of COMPILER_ROUND_TRIP_BASELINE) {
            const verdict = VERDICTS.get(name);
            if (verdict === undefined) {
                stale.push(`${name}: no such card (renamed or removed)`);
                continue;
            }
            if (verdict.ok) {
                stale.push(`${name}: round-trips now (${verdict.kind})`);
                continue;
            }
            if (MARKED.has(name)) {
                stale.push(
                    `${name}: has a compiler-gap marker — the marker supersedes the baseline row`
                );
            }
        }
        expect(
            stale,
            "baseline rows that no longer describe anything. The baseline is SHRINK-ONLY " +
                "(convex/cards/__tests__/compilerRoundTrip.baseline.ts): a card that starts " +
                "round-tripping, or whose gap gets documented with a marker, leaves the " +
                "list in the same change — and BASELINE_CEILING comes down with it."
        ).toEqual([]);
    });

    it("the baseline never grows", () => {
        expect(
            COMPILER_ROUND_TRIP_BASELINE.length,
            "the baseline gained rows. It is a one-time amnesty for the cards that predate " +
                "Guard C, not a parking space: a new failing card carries a compiler-gap " +
                "marker instead. BASELINE_CEILING is lowered as cards graduate, never raised."
        ).toBeLessThanOrEqual(BASELINE_CEILING);
        expect(
            [...COMPILER_ROUND_TRIP_BASELINE].sort(),
            "the baseline is kept sorted so a diff reads as the cards a change graduated"
        ).toEqual([...COMPILER_ROUND_TRIP_BASELINE]);
        expect(
            new Set(COMPILER_ROUND_TRIP_BASELINE).size,
            "the baseline holds a duplicate row"
        ).toBe(COMPILER_ROUND_TRIP_BASELINE.length);
    });

    it("catalogue card names are unique — every exemption is looked up by name", () => {
        // `VERDICTS`, `MARKED` and `BASELINE` are all keyed by name, and a
        // `Map`/`Set` is last-write-wins: two hand-written cards sharing a name
        // would make one inherit the other's verdict and let one marker exempt
        // both — the guard failing OPEN, silently, which is the one outcome it
        // exists to prevent. MTG has genuine same-name pairs (Brothers
        // Yamazaki), so this is a real future event, not a hypothetical: when
        // it happens this assertion reds and the fix is to re-key the three
        // lookups by `card.id`, keeping the name for the offender messages.
        const counts = new Map<string, number>();
        for (const card of CARDS) {
            counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
        }
        expect(
            [...counts]
                .filter(([, n]) => n > 1)
                .map(([name, n]) => `${name} x${n}`),
            "hand-written cards sharing a name. Guard C keys every lookup by name — " +
                "re-key VERDICTS/MARKED/BASELINE by `card.id` before shipping the pair."
        ).toEqual([]);
    });

    it("is not vacuous: the compiler really does read a large slice of the catalogue", () => {
        // Without this, switching the grammar off entirely and dropping every
        // card into the baseline would satisfy every assertion above.
        const passing = CARDS.filter((c) => VERDICTS.get(c.name)!.ok);
        expect(passing.length).toBeGreaterThanOrEqual(ROUND_TRIP_FLOOR);
        // And the guard must be able to SEE the whole catalogue: a card whose
        // source anchor the scanner cannot find could never carry a marker, so
        // it would be baseline-or-nothing forever.
        const anchored = new Set<string>();
        for (const file of SET_FILES) {
            const source = readFileSync(file, "utf8");
            for (const anchor of scanCardAnchors(source.split("\n")).anchors) {
                anchored.add(anchor.name);
            }
        }
        expect(
            CARDS.filter((c) => !anchored.has(c.name)).map((c) => c.name),
            "hand-written cards whose `export const … : CardDefinition` anchor the marker " +
                "scanner cannot find — such a card can never carry a compiler-gap marker, " +
                "so Guard C could only ever baseline it. Fix the scanner, not the card."
        ).toEqual([]);
    });
});

describe("the compiler-gap marker format", () => {
    it("accepts the documented shape and reads the fragment and the issue out of it", () => {
        const m = COMPILER_GAP.exec(
            '// compiler-gap: "Whenever this creature deals combat damage" (#2698)'
        );
        expect(m?.[1]).toBe('"Whenever this creature deals combat damage"');
        expect(m?.[2]).toBe("2698");
    });

    it("rejects a marker with no issue ref and one with no fragment", () => {
        expect(COMPILER_GAP.test("// compiler-gap: the trigger slot")).toBe(
            false
        );
        expect(COMPILER_GAP.test("// compiler-gap: (#2698)")).toBe(false);
    });

    it("attaches a marker to the card whose doc paragraph it sits in, and to no other", () => {
        const lines = [
            "// Alpha — a card with a documented gap.",
            "// compiler-gap: some fragment (#2698)",
            "export const alpha: CardDefinition = {",
            '    name: "Alpha",',
            "};",
            "",
            "// Beta — no gap of its own.",
            "export const beta: CardDefinition = {",
            '    name: "Beta",',
            "};",
        ];
        const markers = scanCompilerGapMarkers(lines);
        expect(markers).toHaveLength(1);
        expect(markers[0].card).toBe("Alpha");
    });

    it("attaches nothing when the marker sits inside the object literal rather than in the doc paragraph", () => {
        const lines = [
            "// Gamma — a card.",
            "export const gamma: CardDefinition = {",
            '    name: "Gamma",',
            "    // compiler-gap: some fragment (#2698)",
            "};",
        ];
        const markers = scanCompilerGapMarkers(lines);
        expect(markers).toHaveLength(1);
        expect(markers[0].card).toBe("");
    });

    it("does not let one card's doc paragraph vouch for the next card", () => {
        const lines = [
            "// Delta — a card with a gap.",
            "// compiler-gap: some fragment (#2698)",
            "export const delta: CardDefinition = {",
            '    name: "Delta",',
            "};",
            "// Epsilon — a different card, no marker.",
            "export const epsilon: CardDefinition = {",
            '    name: "Epsilon",',
            "};",
        ];
        const markers = scanCompilerGapMarkers(lines);
        expect(markers.map((m) => m.card)).toEqual(["Delta"]);
    });

    it("sees a marker written in a JSDoc block, so it reds as unattached instead of vanishing", () => {
        // A block comment can never BE a doc paragraph (`isParagraphBreak` ends
        // one at any non-`//` line), so this marker legitimately owns no card —
        // the point is that the guard says so out loud rather than never
        // mentioning the marker at all.
        const lines = [
            "/**",
            " * Zeta — a card.",
            " * compiler-gap: some fragment (#2698)",
            " */",
            "export const zeta: CardDefinition = {",
            '    name: "Zeta",',
            "};",
        ];
        const markers = scanCompilerGapMarkers(lines);
        expect(markers).toHaveLength(1);
        expect(markers[0].card).toBe("");
    });

    it("finds a card's name past a long intra-literal comment (the Lutri shape)", () => {
        const lines = [
            "export const lutri: CardDefinition = {",
            ...Array.from({ length: 14 }, (_, i) => `    // note ${i}`),
            '    id: "fb1189c9",',
            '    name: "Lutri, the Spellchaser",',
            "};",
        ];
        expect(scanCardAnchors(lines).anchors.map((a) => a.name)).toEqual([
            "Lutri, the Spellchaser",
        ]);
    });
});
