// The Oracle lockfile: determinism, internal consistency, and the offline half
// of the drift guard.
//
// The guard script (`bun run check:oracle`) is the enforcement; these are the
// assertions that hold WITHOUT the 24 MB corpus cache, so a clean checkout
// still catches a stale lockfile.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLockfile } from "../oracle-compile";
import type { CorpusCard } from "../oracle-corpus";
import {
    grammarHash,
    parseLockfile,
    registryHash,
    serializeLockfile,
} from "../lib/oracle-lockfile";

const ROOT = join(import.meta.dirname, "..", "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");

function corpusCard(overrides: Partial<CorpusCard> = {}): CorpusCard {
    return {
        oracleId: "00000000-0000-0000-0000-000000000001",
        name: "Test Bear",
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
        layout: "normal",
        legalIn: ["premodern", "legacy"],
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
];

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

    it("spell text is unparsed, with the fragment recorded and NO definition", () => {
        const row = byName.get("Test Bolt")!;
        expect(row.state).toBe("unparsed");
        expect(row.definition).toBeUndefined();
        expect(row.gaps).toHaveLength(1);
        expect(lock.fragments[row.gaps![0]!]?.text).toBe(
            "{self} deals 3 damage to any target."
        );
    });

    it("counts each card in every format it is legal in", () => {
        expect(lock.formats.premodern.total).toBe(4);
        expect(lock.formats.modern.total).toBe(1);
        expect(lock.formats.premodern.ready).toBe(3);
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

    it("matches the grammar and registry in this tree (offline drift guard)", () => {
        // The same comparison `bun run check:oracle` makes, asserted here so the
        // suite catches it too. If this is red, run: bun run oracle:compile
        expect(lock!.header.grammarHash).toBe(grammarHash(ROOT));
        expect(lock!.header.registryHash).toBe(registryHash());
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

    it("reproduces PRD #2693's Premodern corpus size", () => {
        // The PRD's measured baseline (2026-08-23) is 5,375 Premodern-legal
        // oracle ids, of which 1,303 were covered by a hand-written definition.
        // The corpus size is Scryfall's and must match exactly; the pool grows
        // as cards ship, so it is asserted as a floor.
        expect(lock!.formats.premodern.total).toBe(5375);
        expect(lock!.formats.premodern.pool).toBeGreaterThanOrEqual(1303);
    });
});
