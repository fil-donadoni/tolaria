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
//  4. IDENTITY (issue #3055). ADR 0113 §2 delivers the same definitions two
//     ways and names the price: "the server module and the client asset could
//     disagree, which is the worst bug class available here (the client is
//     only a view, but the Brain decides moves)". Since #3055 both renderings
//     come out of ONE generator carrying ONE source hash, and the assertions
//     below compare the BYTES the two sides actually hold — the server's
//     bundled `compiledReadyDefinitions`, imported through the real module
//     seam, against the committed artifact minus its hand-written rows.
//
// Proof-of-failure (gre-development.md § Proof-of-failure) is recorded in the
// PR: each assertion below was driven red by breaking the thing it guards, and
// the breaks are named there.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    POOL_PATH,
    buildCatalogue,
    committedArtifacts,
    committedIdentityDrift,
    sharedClientRows,
    unbaselinedDivergences,
} from "../catalogue-artifact";
import {
    CATALOGUE_DIR,
    SOURCE_HASH_FILE,
    artifactFileName,
    contentHash,
    describeIdentityDrift,
    firstIdentityDrift,
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
import { getAllCards, getAllRawCards } from "../../convex/cards/catalogue";
import {
    CATALOGUE_SOURCE_HASH,
    excludeHandWritten,
} from "../../convex/cards/compiledCatalogue";
import { compiledReadyDefinitions } from "../../convex/cards/compiledPool";
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

    it("the OTHER two renderings are current too (issue #3055)", () => {
        // One generator writes three files; freshness that covered only one of
        // them would let a regeneration reach the client and not the server,
        // which is the exact drift ADR 0113 §2 prices.
        expect(readFileSync(join(REPO_ROOT, POOL_PATH), "utf-8")).toBe(
            BUILD.poolBytes
        );
        expect(
            readFileSync(
                join(REPO_ROOT, CATALOGUE_DIR, SOURCE_HASH_FILE),
                "utf-8"
            )
        ).toBe(BUILD.sourceHashBytes);
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

    it("no compiled `ready` row is dropped by an incomplete join", () => {
        // A row the join cannot complete is a card missing from the artifact
        // AND a twin nobody checked, so it is pinned at zero rather than
        // reported as a tally the way the retired `scripts/oracle-pool.ts`
        // reported its own.
        expect(BUILD.unjoinable).toBe(0);
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
        // A conditional array element: JSON renders the hole as `null` on BOTH
        // sides, so `relocationLoss` cannot see it and only this can.
        expect(isPlainData({ effects: [1, undefined] })).toBe(false);
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
        expect(twinDivergence(hand, hand, "o")).toEqual([]);
        expect(twinDivergence(hand, twin, "o").map((d) => d.field)).toEqual([
            "effects",
        ]);
    });

    it("reports EVERY differing field, so a baseline row cannot cover a second one", () => {
        // The property the baseline's `card|field` key depends on. No card
        // diverges on two fields today, so without this unit the whole
        // mechanism is untested: reporting only the first differing key leaves
        // the suite green while a second divergence rides in on the first
        // card's baseline row.
        const hand = {
            id: "x",
            name: "X",
            rarity: "common",
            types: ["Creature"],
            effects: [{ op: "draw", count: 1 }],
            targetRequirement: { type: "Creature", count: 1 },
        } as unknown as CardDefinition;
        const twin = {
            ...hand,
            effects: [{ op: "draw", count: 2 }],
            targetRequirement: { type: "any", count: 1 },
        } as unknown as CardDefinition;
        expect(twinDivergence(hand, twin, "o").map((d) => d.field)).toEqual([
            "effects",
            "targetRequirement",
        ]);
    });

    it("a closure BODY is incomparable; everything else on that card is not", () => {
        // gold.ts's rule, and the review finding that produced this test: a
        // whole-card exemption on the sentinel is how Desert Twister's target
        // defect hid behind its `effect: "destroy-target"` shorthand body.
        const hand = {
            id: "x",
            name: "X",
            rarity: "common",
            types: ["Instant"],
            effect: "destroy-target",
            targetRequirement: { type: "any", count: 1 },
        } as unknown as CardDefinition;
        const sameTarget = { ...hand, effects: [{ op: "destroy" }] };
        expect(twinDivergence(hand, sameTarget as CardDefinition, "o")).toEqual(
            []
        );
        const otherTarget = {
            ...sameTarget,
            targetRequirement: { type: "Creature", count: 1 },
        };
        expect(
            twinDivergence(hand, otherTarget as CardDefinition, "o").map(
                (d) => d.field
            )
        ).toEqual(["targetRequirement"]);
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

describe("catalogue artifact — the runtime backstop never fires", () => {
    it("the compiled pool and the hand-written definitions are disjoint", () => {
        // ADR 0114 §2's claim, stated where a failure is DIAGNOSABLE. The same
        // assertion inside `excludeHandWritten` would throw at module load of
        // `convex/cards/catalogue.ts` — every mutation, the browser bundle and
        // every suite's collection — on a tree that, filtered, runs correctly.
        // Here it names the card and stays one red test.
        const handWrittenIds = new Set(getAllCards().map((c) => c.id));
        expect(
            compiledReadyDefinitions
                .filter((c) => handWrittenIds.has(c.id))
                .map((c) => `${c.name} (${c.id})`)
        ).toEqual([]);
        expect(
            excludeHandWritten(compiledReadyDefinitions, handWrittenIds)
        ).toHaveLength(compiledReadyDefinitions.length);
    });
});

describe("catalogue artifact — the two renderings are byte-identical (issue #3055)", () => {
    // ADR 0113 §2's asymmetry has ONE price: the server reads the compiled
    // rows from the module graph (`data/oracle-compiled-pool.json`) and the
    // client fetches the artifact and drops its hand-written rows. Until
    // issue #3055 those two populations had two GENERATORS joining the same
    // sources by slightly different rules, and only their `id` sequence was
    // asserted — so a compiled row could carry different EFFECTS on the two
    // sides with no red anywhere. The client is only a view, but the Brain
    // decides moves off this registry.
    //
    // `compiledReadyDefinitions` is imported through the real module seam, so
    // this is what a Convex mutation actually holds, not a rebuild of it.
    const clientRows = () => {
        const handWrittenIds = new Set(getAllRawCards().map((c) => c.id));
        return excludeHandWritten(BUILD.merge.rows, handWrittenIds);
    };

    it("every shared definition agrees BYTE for byte, and the check names the card", () => {
        const drift = firstIdentityDrift(
            compiledReadyDefinitions,
            clientRows()
        );
        expect(drift === null ? null : describeIdentityDrift(drift)).toBeNull();
    });

    it("the COMMITTED files agree too, not just a regeneration of them", () => {
        // Freshness already proves each committed file equals a rebuild, which
        // implies this. Asked directly anyway, because it is the question
        // ADR 0113 §2 poses — "the bytes agree NOW" — and it survives a future
        // generator change that made one rendering a second derivation again.
        const drift = committedIdentityDrift(REPO_ROOT);
        expect(drift === null ? null : describeIdentityDrift(drift)).toBeNull();
    });

    it("both renderings carry the SAME source hash", () => {
        // The server's copy is bundled through `compiledCatalogue.ts`; the
        // client's is the artifact's file NAME. Two independently written
        // records of one generation, so a merge or an edit that takes one side
        // reds here before any row has to be compared.
        expect(CATALOGUE_SOURCE_HASH).toBe(BUILD.hash);
        expect(BUILD.fileName).toBe(artifactFileName(CATALOGUE_SOURCE_HASH));
    });

    it("`firstIdentityDrift` actually compares — a changed field is a drift", () => {
        // Vacuity guard: a comparator returning `null` unconditionally would
        // make all three assertions above pass on a fully drifted tree. Same
        // role `twinDivergence`'s unit plays for the divergence gate.
        const server = [
            { id: "a", name: "A", effects: [{ op: "draw", count: 1 }] },
            { id: "b", name: "B" },
        ] as unknown as CardDefinition[];
        const bytes = [
            { id: "a", name: "A", effects: [{ op: "draw", count: 2 }] },
            { id: "b", name: "B" },
        ] as unknown as CardDefinition[];
        expect(firstIdentityDrift(server, server)).toBeNull();
        expect(firstIdentityDrift(server, bytes)).toMatchObject({
            kind: "bytes",
            at: 0,
            card: "A (a)",
        });
        // Key ORDER is a difference the wire sees and `toEqual` does not.
        const reordered = [
            { name: "A", id: "a", effects: [{ op: "draw", count: 1 }] },
            { id: "b", name: "B" },
        ] as unknown as CardDefinition[];
        expect(firstIdentityDrift(server, reordered)?.kind).toBe("bytes");
        // Membership and length, reported on the FIRST row that differs.
        const swapped = [server[1]!, server[0]!];
        expect(firstIdentityDrift(server, swapped)).toMatchObject({
            kind: "id",
            at: 0,
        });
        expect(firstIdentityDrift(server, [server[0]!])).toMatchObject({
            kind: "count",
            at: 1,
            card: "B (b)",
        });
    });

    it("`sharedClientRows` drops the relocated rows and nothing else", () => {
        // What the browser does at hydration, and the only reason the two
        // populations are comparable at all. A filter that dropped everything
        // would make the comparison vacuous in the safe direction.
        const shared = sharedClientRows(BUILD.merge.rows);
        expect(shared.length).toBe(BUILD.merge.compiledOnly);
        expect(shared.length).toBe(
            BUILD.merge.rows.length - BUILD.merge.relocated
        );
        expect(shared.length).toBeGreaterThan(RELOCATION_FLOOR);
    });

    it("compiled names are unique, which is what makes first-write-wins safe", () => {
        // `registerCompiledDefinitions` seeds `nameRegistry` from the
        // hand-written cards and never overwrites a key, so among COMPILED
        // rows the FIRST name wins where the old Map construction let the LAST
        // win. Equivalent only while no two compiled rows share a name.
        const seen = new Map<string, string>();
        const collisions: string[] = [];
        for (const card of clientRows()) {
            const key = card.name.toLowerCase();
            const first = seen.get(key);
            if (first) collisions.push(`${card.name}: ${first} vs ${card.id}`);
            else seen.set(key, card.id);
        }
        expect(collisions).toEqual([]);
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
