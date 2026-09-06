// The catalogue artifact's gate (issue #3052, ADR 0113 §2, ADR 0114 §2/§3).
//
// ── Why a test and not a `check:` script ───────────────────────────────────
//
// The artifact is a pure function of three COMMITTED, offline inputs — the
// module graph, the compiler's lockfile and the card index — so the strongest
// tier `scripts/check-oracle-lockfile.ts` has to tier around (regenerate and
// diff) is available unconditionally here. A vitest file also runs in the
// `engine` lane (`bunx vitest run --project node`), which is precisely the
// lane a diff touching `convex/cards/sets/**` takes; `check:oracle` does not.
// `bun run catalogue:check` is the same assertion at the CLI.
//
// ── What it proves ─────────────────────────────────────────────────────────
//
//  1. FRESHNESS. What the tree generates is what is committed, byte for byte,
//     under the file name its own content hash gives it. This is the assertion
//     that replaces the runtime backstop: ADR 0114 §2 says a hand-written card
//     added without regenerating must be CAUGHT rather than filtered away in
//     silence, and this is where it is caught.
//  2. RELOCATION IS A MOVE. Every relocated row deep-equals the live
//     definition it came from. The claim the merge makes about the 890 is
//     "these are the same bytes", and this is what makes it evidence rather
//     than an assertion.
//  3. THE DIVERGENCE GATE IS ARMED AND ITS BASELINE ONLY SHRINKS — the three
//     mechanisms named in `catalogue-divergence-baseline.ts`.
//
// Proof-of-failure (gre-development.md § Proof-of-failure) is recorded in the
// PR: each assertion below was driven red by breaking the thing it guards, and
// the breaks are named there.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    buildCatalogue,
    committedArtifacts,
    unbaselinedDivergences,
} from "../catalogue-artifact";
import {
    CATALOGUE_DIR,
    artifactFileName,
    contentHash,
    isPlainData,
    mergeCatalogue,
    relocationLoss,
    serializeCatalogue,
    twinDivergence,
} from "../lib/catalogue-merge";
import {
    BASELINE_CEILING,
    BASELINE_KEYS,
    CATALOGUE_DIVERGENCE_BASELINE,
    baselineKey,
} from "../lib/catalogue-divergence-baseline";
import { getAllRawCards } from "../../convex/cards/catalogue";
import type { CardDefinition } from "../../convex/cards/types";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BUILD = buildCatalogue(REPO_ROOT);

/** A vacuity floor, not a target: every assertion here passes trivially on an
 *  empty merge, and this is the one that would not. */
const RELOCATION_FLOOR = 800;

describe("catalogue artifact — freshness (ADR 0114 §2)", () => {
    it("the committed artifact is exactly what the tree generates", () => {
        const committed = committedArtifacts(REPO_ROOT);
        expect(committed).toEqual([BUILD.fileName]);
        expect(
            readFileSync(
                join(REPO_ROOT, CATALOGUE_DIR, BUILD.fileName),
                "utf-8"
            )
        ).toBe(BUILD.bytes);
    });

    it("the file name IS the content hash", () => {
        expect(BUILD.fileName).toBe(artifactFileName(contentHash(BUILD.bytes)));
    });

    it("is minified — the committed shape is not the prettified one", () => {
        // ~60% of `data/oracle-compiled-pool.json`'s bytes are prettier
        // whitespace (ADR 0114's measurement). A newline per row would mean
        // the generator's output had been re-formatted by something, which
        // also breaks the hash in the name.
        expect(BUILD.bytes.split("\n")).toHaveLength(2);
    });
});

describe("catalogue artifact — relocation is a MOVE, not a recompile", () => {
    it("every relocated row deep-equals the live hand-written definition", () => {
        const live = new Map(getAllRawCards().map((c) => [c.id, c]));
        const parsed = JSON.parse(BUILD.bytes) as CardDefinition[];
        let checked = 0;
        for (const row of parsed) {
            const original = live.get(row.id);
            if (original === undefined) continue; // compiled-only row
            expect({ [row.name]: row }).toEqual({
                [row.name]: JSON.parse(JSON.stringify(original)),
            });
            checked++;
        }
        expect(checked).toBe(BUILD.merge.relocated);
        expect(checked).toBeGreaterThan(RELOCATION_FLOOR);
    });

    it("no relocation lost anything in the JSON round-trip", () => {
        expect(BUILD.merge.lossy).toEqual([]);
    });

    it("`isPlainData` refuses what JSON would silently swallow", () => {
        // The vacuity guard for the check above: a predicate that answered
        // `true` for everything would relocate a closure card and the
        // round-trip check alone would not always catch it (`JSON.stringify`
        // drops a function-valued key on BOTH sides).
        expect(isPlainData({ a: [1, "x", null], b: { c: true } })).toBe(true);
        expect(isPlainData({ resolve: () => undefined })).toBe(false);
        expect(isPlainData({ when: new Date(0) })).toBe(false);
        expect(isPlainData({ seen: new Set([1]) })).toBe(false);
        expect(isPlainData({ n: NaN })).toBe(false);
        expect(isPlainData({ n: Infinity })).toBe(false);
    });

    it("`relocationLoss` reports a dropped closure rather than calling it equal", () => {
        const lossy = {
            id: "x",
            name: "X",
            resolve: () => undefined,
        } as unknown as CardDefinition;
        expect(relocationLoss(lossy)).not.toBeNull();
        expect(
            relocationLoss({ id: "x", name: "X" } as CardDefinition)
        ).toBeNull();
    });

    it("a hand-written definition carrying code stays a module, and so does its twin", () => {
        expect(BUILD.merge.unrelocatable.length).toBeGreaterThan(0);
        const relocatedIds = new Set(
            JSON.parse(BUILD.bytes).map((r: CardDefinition) => r.id)
        );
        for (const card of getAllRawCards()) {
            if (isPlainData(card)) continue;
            // The module is what the engine runs; a compiled row under the
            // same id would be a SECOND definition, which is the collision
            // this merge exists to delete rather than to move.
            expect([card.name, relocatedIds.has(card.id)]).toEqual([
                card.name,
                false,
            ]);
        }
    });
});

describe("catalogue artifact — divergence is a RED (ADR 0114 §3)", () => {
    it("no card diverges from its compiled twin outside the baseline", () => {
        expect(
            unbaselinedDivergences(BUILD).map(
                (d) => `${d.card} — ${d.field}: ${d.expected} vs ${d.actual}`
            )
        ).toEqual([]);
    });

    it("the comparator actually compares — a changed field is a divergence", () => {
        // Vacuity guard for the gate above: `twinDivergence` returning `null`
        // unconditionally would make every assertion in this describe pass.
        const hand = {
            id: "x",
            name: "X",
            rarity: "common",
            types: ["Creature"],
            effects: [{ op: "draw", count: 1 }],
        } as unknown as CardDefinition;
        const twin = {
            ...hand,
            effects: [{ op: "draw", count: 2 }],
        } as unknown as CardDefinition;
        expect(twinDivergence(hand, hand, "o")).toBeNull();
        expect(twinDivergence(hand, twin, "o")?.field).toBe("effects");
    });

    it("a twin is checked, never allowed to supply the row", () => {
        // ADR 0114 §3 forbids a silent winner. The hand-written row is the
        // one written BECAUSE it is the copy the deep-equality claim covers —
        // so an agreeing twin must change nothing about the output.
        const hand = {
            id: "x",
            name: "X",
            rarity: "common",
            types: ["Creature"],
            oracleText: "hand-written wording",
        } as unknown as CardDefinition;
        const twin = { ...hand, oracleText: "compiled wording" };
        const merged = mergeCatalogue(
            [{ raw: hand, oracleId: "o" }],
            [{ oracleId: "o", definition: twin }]
        );
        expect(merged.rows).toEqual([hand]);
        expect([merged.twins, merged.compiledOnly]).toEqual([1, 0]);
    });

    it("the baseline only shrinks: no stale row", () => {
        const live = new Set(BUILD.merge.divergences.map(baselineKey));
        const stale = CATALOGUE_DIVERGENCE_BASELINE.filter(
            (row) => !live.has(baselineKey(row))
        ).map(baselineKey);
        expect(stale).toEqual([]);
    });

    it("the baseline only shrinks: the ceiling is not raised", () => {
        expect(CATALOGUE_DIVERGENCE_BASELINE.length).toBeLessThanOrEqual(
            BASELINE_CEILING
        );
        expect(BASELINE_KEYS.size).toBe(CATALOGUE_DIVERGENCE_BASELINE.length);
    });

    it("every baseline row states its direction, and a card defect names its ticket", () => {
        for (const row of CATALOGUE_DIVERGENCE_BASELINE) {
            expect([row.card, row.why.length > 40]).toEqual([row.card, true]);
            if (row.direction === "card-defect") {
                expect([row.card, typeof row.issue]).toEqual([
                    row.card,
                    "number",
                ]);
            }
        }
    });
});

describe("catalogue artifact — the merge is deterministic", () => {
    it("re-serialising the same inputs yields the same bytes", () => {
        expect(serializeCatalogue(BUILD.merge.rows)).toBe(BUILD.bytes);
    });

    it("rows are sorted by id and every id is unique", () => {
        const ids = BUILD.merge.rows.map((r) => r.id);
        expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
        expect(new Set(ids).size).toBe(ids.length);
    });
});
