// The Oracle lockfile: determinism, internal consistency, and the offline half
// of the drift guard.
//
// The guard script (`bun run check:oracle`) is the enforcement; these are the
// assertions that hold WITHOUT the 24 MB corpus cache, so a clean checkout
// still catches a stale lockfile.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    buildLockfile,
    poolOracleIds,
    poolOracleIdsFromIndex,
} from "../oracle-compile";
import { headerHashDrift } from "../check-oracle-lockfile";
import type { CorpusCard } from "../oracle-corpus";
import {
    compilerHash,
    compilerSourceFiles,
    parseLockfile,
    POOL_PROJECTION_SOURCE,
    poolHash,
    registryHash,
    serializeLockfile,
    type HeaderHashes,
    type Lockfile,
} from "../lib/oracle-lockfile";

const ROOT = join(import.meta.dirname, "..", "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");

function corpusCard(overrides: Partial<CorpusCard> = {}): CorpusCard {
    const legalIn = overrides.legalIn ?? ["premodern", "legacy"];
    return {
        oracleId: "00000000-0000-0000-0000-000000000001",
        name: "Test Bear",
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
        layout: "normal",
        legalIn,
        // Unread by this file's assertions (oracle-compile.ts only folds
        // `legalIn` into aggregate counts) — mirrors `legalIn` so this fixture
        // stays a valid `CorpusCard` after `poolIn` was added (issue #2695).
        poolIn: legalIn,
        ...overrides,
    };
}

const SYNTHETIC: CorpusCard[] = [
    corpusCard(),
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000002",
        name: "Test Faerie",
        oracleText: "Flying",
        typeLine: "Creature — Faerie",
        power: "1",
        toughness: "1",
    }),
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000003",
        name: "Test Elf",
        oracleText: "{T}: Add {G}.",
        typeLine: "Creature — Elf",
        power: "1",
        toughness: "1",
    }),
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000004",
        name: "Test Bolt",
        oracleText: "Test Bolt deals 3 damage to any target.",
        typeLine: "Instant",
        manaCost: "{R}",
        power: undefined,
        toughness: undefined,
        legalIn: ["premodern", "legacy", "modern"],
    }),
    // Issue #2699 shipped the spell slot, so "Test Bolt" above is now `ready`
    // and something else has to carry the UNPARSED-row invariants (no
    // definition, a recorded fragment, the format tally). A mass-destruction
    // sentence is the honest choice: the grammar has no "all <descriptor>"
    // subject, so this fails for a reason of its own rather than because a
    // slot is switched off — which is what makes it a stable fixture.
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000005",
        name: "Test Wrath",
        oracleText: "Destroy all green creatures.",
        typeLine: "Sorcery",
        manaCost: "{2}{B}",
        power: undefined,
        toughness: undefined,
    }),
];

/**
 * Two cards blocked by the SAME fragment text for DIFFERENT reasons, each
 * blocking one card — a tie on (cards, text). Interning is keyed on
 * (text, reason), so this is the pair whose order the sort has to decide
 * itself instead of inheriting from insertion order. 7 such pairs exist in the
 * shipped corpus.
 */
const LAYOUT_TIE: CorpusCard[] = [
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000005",
        name: "Test Meld",
        typeLine: "Creature — Human Soldier",
        layout: "meld",
    }),
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000006",
        name: "Test Leveler",
        typeLine: "Creature — Human Soldier",
        layout: "leveler",
    }),
];

/** One card whose text trips the SAME fragment on two lines. */
const DOUBLE_TRIP: CorpusCard[] = [
    corpusCard({
        oracleId: "00000000-0000-0000-0000-000000000007",
        name: "Test Echo",
        typeLine: "Instant",
        manaCost: "{R}",
        power: undefined,
        toughness: undefined,
        oracleText:
            "Test Echo deals 3 damage to any target.\n" +
            "Test Echo deals 3 damage to any target.",
    }),
];

/** `sum(fragments.cards)` and the distinct (card, fragment) pair count. */
function fragmentTallies(lock: Lockfile): {
    declared: number;
    distinctPairs: number;
    mismatched: {
        text: string;
        reason: string;
        declared: number;
        actual: number;
    }[];
} {
    const actual = new Array<number>(lock.fragments.length).fill(0);
    let distinctPairs = 0;
    for (const card of lock.cards) {
        // Deduped HERE too, so a row that carried a fragment twice could not
        // make the identity hold by inflating both sides at once.
        for (const index of new Set(card.gaps ?? [])) {
            actual[index]! += 1;
            distinctPairs += 1;
        }
    }
    return {
        declared: lock.fragments.reduce((sum, f) => sum + f.cards, 0),
        distinctPairs,
        mismatched: lock.fragments
            .map((f, i) => ({
                text: f.text,
                reason: f.reason,
                declared: f.cards,
                actual: actual[i]!,
            }))
            .filter((r) => r.declared !== r.actual),
    };
}

describe("oracle:compile is deterministic", () => {
    it("two builds of the same corpus serialize byte-identically", () => {
        const first = serializeLockfile(buildLockfile(SYNTHETIC));
        const second = serializeLockfile(buildLockfile(SYNTHETIC));
        expect(second).toBe(first);
    });

    it("does not depend on the corpus's own ordering beyond the row order it fixes", () => {
        // Fragment INDEXES are assigned by first sight, then remapped by count
        // — so a reordered corpus must still produce the same fragment table.
        const forward = buildLockfile(SYNTHETIC);
        const reversed = buildLockfile([...SYNTHETIC].reverse());
        expect(reversed.fragments).toEqual(forward.fragments);
        expect(reversed.header.counts).toEqual(forward.header.counts);
    });

    it("orders fragments tying on (cards, text) by reason, not by insertion", () => {
        // The sort key must be the whole INTERN key. These two rows carry the
        // same text and the same count; only `reason` separates them, so with
        // (cards, text) alone their order is whatever `Array.prototype.sort`
        // stability makes of insertion order — deterministic by accident.
        const forward = buildLockfile(LAYOUT_TIE);
        expect(new Set(forward.fragments.map((f) => f.text)).size).toBe(1);
        expect(forward.fragments.map((f) => f.cards)).toEqual([1, 1]);
        expect(forward.fragments.map((f) => f.reason)).toEqual([
            'layout "leveler" is not in grammar v0 (multi-faced cards)',
            'layout "meld" is not in grammar v0 (multi-faced cards)',
        ]);
        expect(buildLockfile([...LAYOUT_TIE].reverse()).fragments).toEqual(
            forward.fragments
        );
    });

    it("serializes one row per line, so a state change is one diff line", () => {
        const text = serializeLockfile(buildLockfile(SYNTHETIC));
        const cardLines = text
            .split("\n")
            .filter((l) => l.trimStart().startsWith('{"oracleId"'));
        expect(cardLines).toHaveLength(SYNTHETIC.length);
    });

    it("round-trips through JSON.parse unchanged", () => {
        const lock = buildLockfile(SYNTHETIC);
        expect(parseLockfile(serializeLockfile(lock))).toEqual(
            JSON.parse(JSON.stringify(lock))
        );
    });
});

describe("oracle:compile classifies the synthetic corpus as expected", () => {
    const lock = buildLockfile(SYNTHETIC);
    const byName = new Map(lock.cards.map((c) => [c.name, c]));

    it("a vanilla creature is ready with no abilities", () => {
        const row = byName.get("Test Bear")!;
        expect(row.state).toBe("ready");
        expect(row.definition?.staticAbilities).toBeUndefined();
        expect(row.definition?.power).toBe(2);
    });

    it("a keyword creature is ready with the keyword lowered", () => {
        const row = byName.get("Test Faerie")!;
        expect(row.state).toBe("ready");
        expect(row.definition?.staticAbilities).toEqual(["flying"]);
        expect(row.slots).toEqual(["keyword-line"]);
    });

    it("a mana ability is ready with useStack false (CR 605.3b)", () => {
        const row = byName.get("Test Elf")!;
        expect(row.state).toBe("ready");
        expect(row.definition?.activatedAbilities?.[0]?.useStack).toBe(false);
        expect(row.definition?.activatedAbilities?.[0]?.manaProduced).toEqual({
            G: 1,
        });
    });

    it("spell text is ready with the effect lowered onto the CARD (#2699)", () => {
        const row = byName.get("Test Bolt")!;
        expect(row.state).toBe("ready");
        expect(row.slots).toEqual(["spell"]);
        // The spell site hangs on the definition itself, not in an ability —
        // an instant has no permanent to carry one (CR 113.3a).
        expect(row.definition?.effects).toEqual([
            { op: "dealDamage", amount: 3, to: { target: 0 } },
        ]);
        expect(row.definition?.targetRequirement).toEqual({
            type: "any",
            count: 1,
        });
        expect(row.definition?.activatedAbilities).toBeUndefined();
    });

    it("an unread line is unparsed, with the fragment recorded and NO definition", () => {
        const row = byName.get("Test Wrath")!;
        expect(row.state).toBe("unparsed");
        expect(row.definition).toBeUndefined();
        expect(row.gaps).toHaveLength(1);
        expect(lock.fragments[row.gaps![0]!]?.text).toBe(
            "Destroy all green creatures."
        );
    });

    it("counts each card in every format it is legal in", () => {
        expect(lock.formats.premodern.total).toBe(5);
        expect(lock.formats.modern.total).toBe(1);
        expect(lock.formats.premodern.ready).toBe(4);
        expect(lock.formats.premodern.unparsed).toBe(1);
    });
});

describe("the committed lockfile", () => {
    const text = existsSync(LOCKFILE_PATH)
        ? readFileSync(LOCKFILE_PATH, "utf8")
        : null;

    it("exists", () => {
        expect(text).not.toBeNull();
    });

    const lock = text === null ? null : parseLockfile(text);

    it("pins its corpus source and date", () => {
        expect(lock!.header.corpus.downloadUri).toMatch(
            /^https:\/\/data\.scryfall\.io\//
        );
        expect(lock!.header.corpus.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(lock!.header.corpus.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("matches the compiler, registry and pool in this tree (offline drift guard)", () => {
        // The same comparison `bun run check:oracle` makes, asserted here so the
        // suite catches it too. If this is red, run: bun run oracle:compile
        //
        // `poolHash` is here because the card index was the one lockfile input
        // no offline tier saw (issue #3068): shipping a card moved the true
        // per-format `pool` while the committed lockfile kept the old number,
        // and only the corpus-dependent tier noticed — on a machine that
        // happened to have the gitignored 24 MB cache.
        expect(lock!.header.compilerHash).toBe(compilerHash(ROOT));
        expect(lock!.header.registryHash).toBe(registryHash());
        expect(lock!.header.poolHash).toBe(poolHash(poolOracleIds()));
    });

    it("has one row per corpus card, sorted by oracle id, with no duplicates", () => {
        const ids = lock!.cards.map((c) => c.oracleId);
        expect(ids).toHaveLength(lock!.header.counts.total);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual(ids);
    });

    it("has counts that agree with the rows", () => {
        const tally = { ready: 0, quarantine: 0, unparsed: 0 };
        for (const card of lock!.cards) tally[card.state] += 1;
        expect(tally).toEqual({
            ready: lock!.header.counts.ready,
            quarantine: lock!.header.counts.quarantine,
            unparsed: lock!.header.counts.unparsed,
        });
    });

    it("never carries a definition on an unparsed row, nor a gap on a ready one", () => {
        for (const card of lock!.cards) {
            if (card.state === "unparsed") {
                expect(card.definition).toBeUndefined();
                expect(card.gaps?.length ?? 0).toBeGreaterThan(0);
            } else {
                expect(card.definition).toBeDefined();
                expect(card.gaps).toBeUndefined();
            }
            if (card.state === "ready")
                expect(card.quarantineReasons).toBeUndefined();
            if (card.state === "quarantine") {
                expect(card.quarantineReasons?.length ?? 0).toBeGreaterThan(0);
            }
        }
    });

    it("has in-range gap indexes and a fragment table sorted by blast radius", () => {
        for (const card of lock!.cards) {
            for (const index of card.gaps ?? []) {
                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThan(lock!.fragments.length);
            }
        }
        const counts = lock!.fragments.map((f) => f.cards);
        expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    });

    it("declares, per fragment, exactly the cards that reference it", () => {
        // `cards` is the blast radius that ranks the grammar backlog (PRD #2693
        // user story 9) — #2697–#2700 are prioritised off these numbers, so a
        // count that is not the number of cards actually blocked is a wrong
        // priority, not a cosmetic slip. The pre-fix table overstated 3 rows,
        // one of them declaring 5 cards blocked where it blocks 3.
        const { declared, distinctPairs, mismatched } = fragmentTallies(lock!);
        expect(mismatched).toEqual([]);
        expect(declared).toBe(distinctPairs);
    });

    it("reproduces PRD #2693's Premodern corpus size", () => {
        // The PRD's measured baseline (2026-08-23) is 5,375 Premodern-legal
        // oracle ids, of which 1,303 were covered by a hand-written definition.
        // The corpus size is Scryfall's and must match exactly; the pool grows
        // as cards ship, so it is asserted as a floor.
        expect(lock!.formats.premodern.total).toBe(5375);
        expect(lock!.formats.premodern.pool).toBeGreaterThanOrEqual(1303);
    });
});

describe("fragment counts are per CARD, not per gap occurrence", () => {
    it("counts a card that trips the same fragment twice exactly once", () => {
        const lock = buildLockfile(DOUBLE_TRIP);
        const row = lock.cards[0]!;
        expect(row.state).toBe("unparsed");
        expect(row.gaps).toEqual([0]);
        expect(lock.fragments).toHaveLength(1);
        expect(lock.fragments[0]!.cards).toBe(1);
        const { declared, distinctPairs, mismatched } = fragmentTallies(lock);
        expect(mismatched).toEqual([]);
        expect(declared).toBe(distinctPairs);
    });
});

// #2702 round 2 fixup: `poolOracleIdsFromIndex` feeds the committed
// per-format `pool` metric (PRD #2693 M1 progress). A `source: "compiled"`
// row is the compiler's own output, not a hand-written CardDefinition — it
// must never count toward its own progress metric.
describe("poolOracleIdsFromIndex excludes source: compiled rows", () => {
    it("counts only hand-written oracle ids toward the pool", () => {
        const index = [
            { oracleId: "hand-written-1" },
            { oracleId: "compiled-1", source: "compiled" },
        ];
        const pool = poolOracleIdsFromIndex(index);
        expect(pool.has("hand-written-1")).toBe(true);
        expect(pool.has("compiled-1")).toBe(false);
    });
});

describe("the offline hash covers the whole compiler", () => {
    it("hashes the driver and the serializer, not just convex/oracle/**", () => {
        // Tier 1 is the ONLY tier that runs on a clean checkout (the corpus is
        // gitignored), so anything it does not hash is unguarded exactly where
        // the guard is the whole enforcement. Hashing `convex/oracle/**` alone
        // let a `buildLockfile` change that alters the output pass tier 1.
        const files = compilerSourceFiles(ROOT);
        expect(files).toContain("scripts/oracle-corpus.ts");
        expect(files).toContain("scripts/oracle-compile.ts");
        expect(files).toContain("scripts/lib/oracle-lockfile.ts");
        expect(files.some((f) => f.startsWith("convex/oracle/"))).toBe(true);
        expect(files.filter((f) => f.includes("__tests__"))).toEqual([]);
        expect(new Set(files).size).toBe(files.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// The pool projection and the offline tier that compares it (issue #3068)
// ─────────────────────────────────────────────────────────────────────────

describe("poolHash — the card index as the lockfile sees it", () => {
    const idsOf = (
        index: readonly { oracleId?: string; source?: string }[]
    ): string => poolHash(poolOracleIdsFromIndex(index));

    it("changes when a hand-written definition is added or removed", () => {
        // The whole point: this is the movement that shifts every per-format
        // `pool` figure and used to leave the committed lockfile stale with
        // every offline tier green.
        const before = idsOf([{ oracleId: "a" }, { oracleId: "b" }]);
        expect(
            idsOf([{ oracleId: "a" }, { oracleId: "b" }, { oracleId: "c" }])
        ).not.toBe(before);
        expect(idsOf([{ oracleId: "a" }])).not.toBe(before);
    });

    it("ignores a card-index change that cannot move a pool figure", () => {
        // A `source: "compiled"` row is the compiler's own output and a
        // `firstPrintId` correction touches no oracle id — neither changes what
        // `pool` counts. Hashing the FILE would red both, and the only way to
        // clear that red is a corpus download for a lockfile whose bytes would
        // not change: exactly the unsatisfiable-offline red the tiering exists
        // to avoid.
        const base = [{ oracleId: "a" }, { oracleId: "b" }];
        expect(idsOf([...base, { oracleId: "c", source: "compiled" }])).toBe(
            idsOf(base)
        );
        expect(
            idsOf([{ oracleId: "a", firstPrintId: "x" }, { oracleId: "b" }] as {
                oracleId?: string;
                source?: string;
            }[])
        ).toBe(idsOf(base));
    });

    it("depends on the pool's MEMBERSHIP, not on the index's row order", () => {
        // A `Set` iterates in insertion order, so hashing it raw would make a
        // pure reordering of `data/card-index.json` red a lockfile whose bytes
        // do not change.
        expect(idsOf([{ oracleId: "b" }, { oracleId: "a" }])).toBe(
            idsOf([{ oracleId: "a" }, { oracleId: "b" }])
        );
    });
});

describe("headerHashDrift — the offline tier of check:oracle", () => {
    const TREE: HeaderHashes = {
        compilerHash: "sha256:compiler",
        registryHash: "sha256:registry",
        poolHash: "sha256:pool",
    };

    it("passes when the header agrees with the tree on all three", () => {
        expect(headerHashDrift({ ...TREE }, TREE)).toBeNull();
    });

    it("reds on pool drift, naming the card index and the fix", () => {
        // The acceptance criterion of issue #3068: a reader who shipped a card
        // and forgot to regenerate must be sent to the file they touched. The
        // fix command comes from `fail()`, which always names
        // `bun run oracle:compile` (plus the corpus bootstrap when the cache
        // is absent).
        const drift = headerHashDrift(
            { ...TREE, poolHash: "sha256:stale" },
            TREE
        );
        expect(drift).toContain(POOL_PROJECTION_SOURCE);
        expect(drift).toContain("pool drift");
        expect(drift).toContain("sha256:stale");
        expect(drift).toContain("sha256:pool");
    });

    it("still reds on the two hashes it already covered", () => {
        expect(
            headerHashDrift({ ...TREE, compilerHash: "sha256:x" }, TREE)
        ).toContain("compiler hash drift");
        expect(
            headerHashDrift({ ...TREE, registryHash: "sha256:x" }, TREE)
        ).toContain("registry hash drift");
    });
});
