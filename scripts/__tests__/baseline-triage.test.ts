// The Guard C baseline's direction-of-defect triage (issue #3050, ADR 0114 §5).
//
// Driven with SYNTHETIC cards rather than the real catalogue on purpose. The
// live baseline holds no `undetermined`-vs-`unparsed` pairing today, and a
// classification rule exercised only by whatever the catalogue happens to
// contain is a rule that goes untested the moment the catalogue moves. Guard C
// itself (`convex/cards/__tests__/compilerRoundTrip.test.ts`) is where the real
// 1,719 rows are checked; here the TABLE is checked, one kind at a time.
//
// Proof-of-failure is recorded in the PR (gre-development.md § Proof-of-failure).

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../convex/cards/types";
import { roundTripCard } from "../../convex/oracle/gold";
import {
    BASELINE_DIRECTIONS,
    DIRECTION_ALLOWED_KINDS,
    describeInconsistent,
    triageBaseline,
    type BaselineRow,
} from "../lib/baseline-triage";

/** A minimal hand-written definition. `oracleText` is what the compiler reads,
 *  so each fixture below differs only in that field and in the behaviour the
 *  hand-written side claims. */
function card(overrides: Partial<CardDefinition> & { name: string }) {
    return {
        id: `synthetic-${overrides.name.toLowerCase().replace(/\s+/g, "-")}`,
        rarity: "common",
        manaCost: { X: 1, G: 1 },
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
        ...overrides,
    } as CardDefinition;
}

/** No `oracleText` at all — the compiler's input is missing, not empty. */
const NO_TEXT = card({ name: "Synthetic Textless" });

/** Rules text grammar v0 cannot read. */
const UNPARSED = card({
    name: "Synthetic Unparsed",
    oracleText:
        "Whenever a player untaps a land, that player mills half their library, rounded up, unless a Yeti attacked this turn.",
});

/** Text the compiler reads correctly, against a hand-written side that claims
 *  something else — the "compiler produced a definition and the two disagree"
 *  shape, and the ONLY kind a person has to adjudicate. */
const MISMATCH = card({
    name: "Synthetic Mismatch",
    oracleText: "Flying",
    staticAbilities: ["first strike"],
});

const CARDS = [NO_TEXT, UNPARSED, MISMATCH];

const rows = (...pairs: [CardDefinition, BaselineRow["direction"]][]) =>
    pairs.map(([c, direction]) => ({ name: c.name, direction }));

describe("the triage fixtures really do produce the three failing kinds", () => {
    // Without this the whole file could be asserting against `unparsed` three
    // times over and every table row below would pass vacuously.
    it.each([
        [NO_TEXT, "no-oracle-text"],
        [UNPARSED, "unparsed"],
        [MISMATCH, "mismatch"],
    ])("%s", (subject, kind) => {
        const verdict = roundTripCard(subject as CardDefinition).verdict;
        expect(verdict.ok).toBe(false);
        expect(verdict.ok === false && verdict.kind).toBe(kind);
    });
});

describe("triageBaseline — direction against live verdict (issue #3050)", () => {
    it("accepts every direction its own table allows", () => {
        const triage = triageBaseline(
            CARDS,
            rows(
                [UNPARSED, "compiler-gap"],
                [NO_TEXT, "card-defect"],
                [MISMATCH, "card-defect"]
            )
        );
        expect(triage.inconsistent).toEqual([]);
        expect(triage.counts).toEqual({
            "compiler-gap": 1,
            "card-defect": 2,
            undetermined: 0,
        });
        expect(triage.total).toBe(3);
    });

    it("also accepts a mismatch parked as undetermined — the queue is a legal terminal state", () => {
        const triage = triageBaseline(CARDS, rows([MISMATCH, "undetermined"]));
        expect(triage.inconsistent).toEqual([]);
        expect(triage.counts.undetermined).toBe(1);
    });

    it("reds a card the compiler REFUSED that is filed as a card defect — there is no twin to blame the card with", () => {
        const triage = triageBaseline(CARDS, rows([UNPARSED, "card-defect"]));
        expect(triage.inconsistent.map(describeInconsistent)).toEqual([
            'Synthetic Unparsed: declared "card-defect", but the compiler\'s verdict is ' +
                '"unparsed" — that direction accepts only "no-oracle-text" / "mismatch"',
        ]);
    });

    it("still accepts an UNPARSED row filed as a compiler gap", () => {
        const triage = triageBaseline(CARDS, rows([UNPARSED, "compiler-gap"]));
        expect(triage.inconsistent).toEqual([]);
    });

    it("reds a card the compiler refused that is filed as undetermined — nothing is undetermined about it", () => {
        const triage = triageBaseline(CARDS, rows([UNPARSED, "undetermined"]));
        expect(triage.inconsistent.map((r) => r.name)).toEqual([
            "Synthetic Unparsed",
        ]);
    });

    it("reds a card with no oracleText filed as a compiler gap — no grammar was ever involved", () => {
        const triage = triageBaseline(CARDS, rows([NO_TEXT, "compiler-gap"]));
        expect(triage.inconsistent.map((r) => r.kind)).toEqual([
            "no-oracle-text",
        ]);
    });

    it("accepts a MISMATCH under every direction, including compiler-gap — a misread is a real outcome", () => {
        // Deliberately permissive, and the header says why: forbidding
        // `mismatch` under `compiler-gap` would leave a genuine compiler
        // MISREAD with nowhere to go but `card-defect`, which is the exact
        // mislabel this slice exists to kill. The ruling itself is forced by
        // `KNOWN_DIVERGENCES` in `convex/oracle/__tests__/gold.test.ts`, not
        // here.
        for (const direction of BASELINE_DIRECTIONS) {
            const triage = triageBaseline(CARDS, rows([MISMATCH, direction]));
            expect(triage.inconsistent, direction).toEqual([]);
            expect(triage.counts[direction]).toBe(1);
        }
    });

    it("counts a row it cannot classify as stale rather than silently dropping it", () => {
        const triage = triageBaseline(CARDS, [
            { name: "No Such Card", direction: "compiler-gap" },
            { name: UNPARSED.name, direction: "compiler-gap" },
        ]);
        expect(triage.stale).toEqual([
            "No Such Card: no such card (renamed or removed)",
        ]);
        expect(triage.total).toBe(1);
        expect(triage.counts["compiler-gap"]).toBe(1);
    });

    it("counts a row that now round-trips as stale — the baseline is shrink-only", () => {
        const vanilla = card({ name: "Synthetic Vanilla", oracleText: "" });
        const triage = triageBaseline(
            [vanilla],
            rows([vanilla, "compiler-gap"])
        );
        expect(triage.stale).toEqual([
            "Synthetic Vanilla: round-trips now (equal)",
        ]);
        expect(triage.total).toBe(0);
    });
});

describe("the direction table itself", () => {
    it("keeps the two unrulable kinds one-to-one — that is where the table has force", () => {
        // `mismatch` is deliberately allowed everywhere (a ruling, policed by
        // `KNOWN_DIVERGENCES`). The table's whole force is on the two kinds
        // where no ruling is POSSIBLE, so each must be reachable from exactly
        // one direction — widen either and the classification stops asserting
        // anything at all.
        const directions = Object.keys(
            DIRECTION_ALLOWED_KINDS
        ) as (keyof typeof DIRECTION_ALLOWED_KINDS)[];
        const supporters = (kind: string) =>
            directions.filter((d) =>
                (DIRECTION_ALLOWED_KINDS[d] as readonly string[]).includes(kind)
            );
        expect(supporters("unparsed")).toEqual(["compiler-gap"]);
        expect(supporters("no-oracle-text")).toEqual(["card-defect"]);
        for (const direction of directions) {
            expect(
                DIRECTION_ALLOWED_KINDS[direction].length,
                `${direction} accepts no verdict kind at all`
            ).toBeGreaterThan(0);
        }
    });
});
