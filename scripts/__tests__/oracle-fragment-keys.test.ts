// Fragment Keys (issue #6169): a lockfile row cites the lines it fails on by a
// key derived from each fragment's content, never by the fragment's index in
// the table. Five properties, each proven over SYNTHETIC corpora compiled by
// the real driver:
//
//  1. every reader resolves `gaps` by key: shuffling the table changes no
//     reader's output;
//  2. no module outside the lockfile's own reads the table at all;
//  3. a fragment entering or leaving the table changes no other card's row;
//  4. two branches moving two different cards merge with `git merge-file`
//     into exactly the lockfile a regeneration writes, and a clean merge that
//     is NOT one is caught by the structure check and the merge driver;
//  5. the compiler refuses two fragments sharing one key.

import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    buildLockfile as buildLockfileRaw,
    type BuildLockfileOptions,
} from "../oracle-compile";
import type { CorpusCard } from "../oracle-corpus";
import { emptyRetirementLedger } from "../lib/oracle-retirements";
import {
    fragmentKey,
    parseLockfile,
    serializeLockfile,
    type CardRow,
    type Lockfile,
} from "../lib/oracle-lockfile";
import {
    indexFragments,
    lockfileStructureProblems,
} from "../lib/oracle-fragments";
import {
    findGapKeys,
    gapCards,
    rankClauseFamilies,
    rankGrammarGaps,
} from "../lib/grammar-gaps";
import { gapIndex } from "../lib/targets";
import {
    buildFragmentGapFilings,
    buildHandTailFilings,
    computedGapKeys,
    type KindInputs,
} from "../lib/gap-kinds";
import { deckReport } from "../lib/tier1-decks";
import { corpusNameIndex } from "../lib/card-names";
import { REGENERATE_MARKER } from "../lib/generated-artifacts";

const ROOT = join(import.meta.dirname, "..", "..");
const DRIVER = join(ROOT, "scripts", "merge-driver-regenerated.ts");
const LOCKFILE_REL = "data/oracle-compiled.json";

// Synthetic corpora must not stamp against the real retirement ledger (issue
// #4027) — see `oracle-compile.test.ts`.
function buildLockfile(
    corpus: readonly CorpusCard[],
    options: BuildLockfileOptions = {}
): Lockfile {
    return buildLockfileRaw(corpus, {
        retirements: emptyRetirementLedger(),
        ...options,
    });
}

function oracleId(n: number): string {
    return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

function card(
    n: number,
    name: string,
    overrides: Partial<CorpusCard>
): CorpusCard {
    return {
        oracleId: oracleId(n),
        name,
        manaCost: "{1}",
        typeLine: "Artifact",
        oracleText: "",
        layout: "normal",
        legalIn: ["premodern", "legacy"],
        poolIn: ["premodern", "legacy"],
        ...overrides,
    };
}

/** An unparsed card: no slot consumes an invented sentence. */
function refused(n: number, ...lines: string[]): CorpusCard {
    return card(n, `Test Card ${n}`, { oracleText: lines.join("\n") });
}

// Shared fragments, one grammar gap folding two of them (Equip {N}), and an
// attributed spell line — every reader's grouping has something to group.
const READERS_CORPUS: CorpusCard[] = [
    card(1, "Test Sword", {
        typeLine: "Artifact — Equipment",
        oracleText: "Equip {2}",
    }),
    card(2, "Test Axe", {
        typeLine: "Artifact — Equipment",
        oracleText: "Equip {3}",
    }),
    card(3, "Test Spear", {
        typeLine: "Artifact — Equipment",
        oracleText: "Equip {2}\nThe spear hums a tune nobody remembers.",
    }),
    refused(4, "The spear hums a tune nobody remembers."),
    refused(5, "A lantern counts the stars twice.", "Equip {3}"),
    card(6, "Test Bear", {
        typeLine: "Creature — Bear",
        manaCost: "{1}{G}",
        power: "2",
        toughness: "2",
    }),
    card(7, "Test Wrath", {
        typeLine: "Sorcery",
        manaCost: "{2}{B}",
        oracleText: "Destroy all creatures with flying.",
    }),
    // Its WIDER fragment (Equip {3}, three cards) has the LARGER key: the
    // row's sorted keys put the narrow line first, rank order the wide one.
    refused(8, "Equip {3}", "The mirror forgets faces."),
];

/** Everything a reader derives from a lockfile, as one comparable value. */
function readerOutputs(lock: Lockfile): unknown {
    const index = indexFragments(lock);
    const { gapKeys, leverage } = gapIndex(lock);
    const ids = new Set(lock.cards.map((c) => c.oracleId));
    const inputs: KindInputs = {
        lock,
        slices: [
            { id: "t", kind: "name-list", priority: 1, setCode: null, ids },
        ],
        ranked: ids,
        filed: new Map(),
        floor: 2,
        handTailFiling: true,
        enforced: ids,
        handTail: new Set(),
        gapKeys,
        leverage,
    };
    const filings = (
        fs: readonly {
            key: string;
            title: string;
            body: (n: number) => string;
        }[]
    ) => fs.map((f) => [f.key, f.title, f.body(1)]);
    const handTail = buildHandTailFilings(inputs);
    const deck = {
        slug: "all",
        name: "All",
        main: lock.cards.map((c) => ({ count: 1, name: c.name })),
        sideboard: [],
    };
    return {
        of: lock.cards.map((c) => index.of(c).map((f) => f.key)),
        ranked: rankGrammarGaps(lock, null),
        families: rankClauseFamilies(lock, null),
        keys: findGapKeys(lock, ""),
        cards: findGapKeys(lock, "").map((k) => gapCards(lock, k, null)),
        gapKeys: lock.cards.map(gapKeys),
        leverage: [...leverage],
        computed: [...computedGapKeys(lock, null).grammar],
        grammarFilings: filings(buildFragmentGapFilings(inputs)),
        handTail: [filings(handTail.filings), filings(handTail.held)],
        deck: deckReport(deck, corpusNameIndex(lock), index, new Set()),
    };
}

describe("every reader resolves gaps by key (issue #6169)", () => {
    const lock = buildLockfile(READERS_CORPUS);

    it("the fixture exercises the readers: shared fragments, a folded gap, every reader non-empty", () => {
        expect(lock.fragments.length).toBeGreaterThanOrEqual(5);
        expect(lock.fragments.some((f) => f.cards > 1)).toBe(true);
        const out = readerOutputs(lock) as Record<string, unknown[]>;
        for (const name of [
            "ranked",
            "families",
            "keys",
            "computed",
            "grammarFilings",
        ])
            expect(out[name]!.length, name).toBeGreaterThan(0);
    });

    it("a lockfile whose fragments table is shuffled yields the same output from every reader", () => {
        const baseline = readerOutputs(lock);
        const rotated = [
            ...lock.fragments.slice(2),
            ...lock.fragments.slice(0, 2),
        ];
        for (const fragments of [[...lock.fragments].reverse(), rotated]) {
            expect(fragments.map((f) => f.key)).not.toEqual(
                lock.fragments.map((f) => f.key)
            );
            expect(readerOutputs({ ...lock, fragments })).toEqual(baseline);
        }
    });

    it("resolving a key the table does not hold throws rather than guess", () => {
        const row = lock.cards.find((c) => c.state === "unparsed")!;
        const orphan: CardRow = { ...row, gaps: ["000000000000"] };
        expect(() => indexFragments(lock).of(orphan)).toThrow(/does not hold/);
    });
});

describe("a card's first fragment is its widest, whatever its keys' order", () => {
    const lock = buildLockfile(READERS_CORPUS);
    const row = lock.cards.find((c) => c.name === "Test Card 8")!;
    it("the fixture discriminates: the row's first KEY is the narrow line", () => {
        const first = lock.fragments.find((f) => f.key === row.gaps![0])!;
        expect(first.text).toBe("The mirror forgets faces.");
        expect(first.cards).toBe(1);
    });

    it("the resolver, the Tier 1 blocker and the gap's card line all take the widest", () => {
        expect(
            indexFragments(lock)
                .of(row)
                .map((f) => f.text)
        ).toEqual(["Equip {3}", "The mirror forgets faces."]);
        const deck = {
            slug: "one",
            name: "One",
            main: [{ count: 1, name: row.name }],
            sideboard: [],
        };
        const report = deckReport(
            deck,
            corpusNameIndex(lock),
            indexFragments(lock),
            new Set()
        );
        expect(report.cards[0]!.blocker).toBe("Equip {3}");
        const [equip] = findGapKeys(lock, "Equip");
        const line = gapCards(lock, equip!, null).find(
            (c) => c.name === row.name
        )!.line;
        expect(line).toBe("Equip {3}");
    });
});

describe("a lockfile written before Fragment Keys is upgraded on read", () => {
    it("index-format rows parse into the keyed lockfile a compile writes", () => {
        // The pre-#6169 encoding: the table in rank order, rows citing
        // ascending indices into it, no `key` on a fragment row.
        const lock = buildLockfile(READERS_CORPUS);
        const ranked = indexFragments(lock).ranked;
        const position = new Map(ranked.map((f, i) => [f.key, i]));
        const legacy = {
            ...lock,
            fragments: ranked.map((f) => ({
                text: f.text,
                reason: f.reason,
                cards: f.cards,
                ...(f.attribution !== undefined
                    ? { attribution: f.attribution }
                    : {}),
            })),
            cards: lock.cards.map((c) =>
                c.gaps === undefined
                    ? c
                    : {
                          ...c,
                          gaps: c.gaps
                              .map((k) => position.get(k)!)
                              .sort((a, b) => a - b),
                      }
            ),
        };
        expect(parseLockfile(JSON.stringify(legacy))).toEqual(
            JSON.parse(JSON.stringify(lock))
        );
    });
});

describe("no module reads the fragment table except its two owners", () => {
    it("no non-test script but oracle-lockfile.ts and oracle-fragments.ts reads `fragments` off a lockfile", () => {
        const OWNERS = new Set([
            "scripts/lib/oracle-lockfile.ts",
            "scripts/lib/oracle-fragments.ts",
        ]);
        // A member read, an index by name, or a destructuring assignment.
        const READS_FRAGMENTS =
            /\.fragments\b|\[["']fragments["']\]|\{[^}]*\bfragments\b[^}]*\}\s*=[^=>]/;
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                const path = join(dir, entry);
                if (statSync(path).isDirectory()) {
                    if (entry !== "__tests__" && entry !== "node_modules")
                        walk(path);
                } else if (entry.endsWith(".ts")) {
                    const rel = relative(ROOT, path);
                    if (OWNERS.has(rel)) continue;
                    readFileSync(path, "utf8")
                        .split("\n")
                        .forEach((line, i) => {
                            if (READS_FRAGMENTS.test(line))
                                offenders.push(
                                    `${rel}:${i + 1}: ${line.trim()}`
                                );
                        });
                }
            }
        };
        walk(join(ROOT, "scripts"));
        // A reader goes through `indexFragments`; a position is never a key.
        expect(offenders).toEqual([]);
    });
});

describe("lockfileStructureProblems — what a lockfile owes on its own", () => {
    const lock = buildLockfile(READERS_CORPUS);
    const unparsedAt = lock.cards.findIndex((c) => c.state === "unparsed");
    const withCard = (i: number, row: CardRow): Lockfile => ({
        ...lock,
        cards: lock.cards.map((c, j) => (j === i ? row : c)),
    });

    it("a compiled lockfile has none", () => {
        expect(lockfileStructureProblems(lock)).toEqual([]);
    });

    it("names a key that is not its row's content key", () => {
        const fragments = lock.fragments.map((f, i) =>
            i === 0 ? { ...f, text: `${f.text} (edited)` } : f
        );
        expect(
            lockfileStructureProblems({ ...lock, fragments }).join("\n")
        ).toMatch(/carries key .* its content's key is/);
    });

    it("names a fragment declaring more cards than cite it — the identical-edit merge", () => {
        const fragments = lock.fragments.map((f, i) =>
            i === 0 ? { ...f, cards: f.cards + 1 } : f
        );
        expect(
            lockfileStructureProblems({ ...lock, fragments }).join("\n")
        ).toMatch(/declares \d+ card\(s\), \d+ cite it/);
    });

    it("names a table out of content order", () => {
        const fragments = [...lock.fragments].reverse();
        expect(
            lockfileStructureProblems({ ...lock, fragments }).join("\n")
        ).toMatch(/out of table order/);
    });

    it("names a gap the table does not hold, and gaps out of order", () => {
        const row = lock.cards[unparsedAt]!;
        const dangling = withCard(unparsedAt, {
            ...row,
            gaps: ["ffffffffffff"],
        });
        expect(lockfileStructureProblems(dangling).join("\n")).toMatch(
            /which the table does not hold/
        );
        const twice = withCard(unparsedAt, {
            ...row,
            gaps: [row.gaps![0]!, row.gaps![0]!],
        });
        expect(lockfileStructureProblems(twice).join("\n")).toMatch(
            /not sorted and distinct/
        );
    });

    it("names a row's state against its gaps", () => {
        const row = lock.cards[unparsedAt]!;
        const gapless = withCard(unparsedAt, { ...row, gaps: [] });
        expect(lockfileStructureProblems(gapless).join("\n")).toMatch(
            /is unparsed with 0 gap/
        );
    });
});

describe("a fragment entering or leaving the table changes no other card's row", () => {
    // Twelve cards, each on its own line: every fragment blocks one card.
    const FILLER = Array.from({ length: 12 }, (_, i) =>
        refused(10 + i, `Filler line ${String(i + 1).padStart(2, "0")} hums.`)
    );
    const rowsById = (lock: Lockfile) =>
        new Map(lock.cards.map((c) => [c.oracleId, JSON.stringify(c)]));

    it("two new cards on one NEW line — the widest fragment — leave every existing row byte-identical", () => {
        // Under the index format a fragment blocking two cards ranked FIRST
        // and renumbered every row; this is the shape of PR #6138, inverted.
        const before = buildLockfile(FILLER);
        const after = buildLockfile([
            ...FILLER,
            refused(30, "Aardvark line both share."),
            refused(31, "Aardvark line both share."),
        ]);
        const was = rowsById(before);
        for (const [id, row] of rowsById(after))
            if (was.has(id)) expect(row, id).toBe(was.get(id));
        const keys = new Set(after.fragments.map((f) => JSON.stringify(f)));
        for (const f of before.fragments)
            expect(keys.has(JSON.stringify(f))).toBe(true);
    });

    it("a card leaving `unparsed` removes its fragment and touches no other row", () => {
        const before = buildLockfile(FILLER);
        const after = buildLockfile(
            FILLER.map((c, i) => (i === 0 ? { ...c, oracleText: "" } : c))
        );
        const was = rowsById(before);
        let changed = 0;
        for (const [id, row] of rowsById(after))
            if (row !== was.get(id)) changed++;
        expect(changed).toBe(1);
        expect(after.fragments).toHaveLength(before.fragments.length - 1);
    });
});

describe("two branches moving two cards merge into the regenerated lockfile (git merge-file)", () => {
    // Content order puts Aardvark first, the fillers in the middle, Zebra
    // last; oracle-id order puts the two moved cards ten rows apart. Each
    // branch moves one card from its own unique line onto a filler's line:
    // it deletes one fragment row and bumps one filler's count IN PLACE.
    const FILLER = Array.from({ length: 12 }, (_, i) =>
        refused(10 + i, `Filler line ${String(i + 1).padStart(2, "0")} hums.`)
    );
    const X = refused(3, "Aardvark line hums alone.");
    const Y = refused(40, "Zebra line hums alone.");
    const moved = (c: CorpusCard, line: string): CorpusCard => ({
        ...c,
        oracleText: line,
    });
    const corpus = (x: CorpusCard, y: CorpusCard) => [x, ...FILLER, y];

    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-fragment-merge-"));
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    function mergeFile(base: Lockfile, ours: Lockfile, theirs: Lockfile) {
        for (const [name, lock] of [
            ["base", base],
            ["ours", ours],
            ["theirs", theirs],
        ] as const)
            writeFileSync(join(dir, name), serializeLockfile(lock));
        const r = spawnSync(
            "git",
            [
                "merge-file",
                "-p",
                join(dir, "ours"),
                join(dir, "base"),
                join(dir, "theirs"),
            ],
            { encoding: "utf8" }
        );
        return { status: r.status, merged: r.stdout };
    }

    it("merges cleanly, byte-identical to a compile of the merged corpus, structure intact", () => {
        const base = buildLockfile(corpus(X, Y));
        const ours = buildLockfile(corpus(moved(X, "Filler line 05 hums."), Y));
        const theirs = buildLockfile(
            corpus(X, moved(Y, "Filler line 09 hums."))
        );
        const expected = serializeLockfile(
            buildLockfile(
                corpus(
                    moved(X, "Filler line 05 hums."),
                    moved(Y, "Filler line 09 hums.")
                )
            )
        );
        const { status, merged } = mergeFile(base, ours, theirs);
        expect(status).toBe(0);
        expect(merged).toBe(expected);
        expect(lockfileStructureProblems(parseLockfile(merged))).toEqual([]);
    });

    it("both branches moving a card onto ONE line merge cleanly into a count the structure check rejects", () => {
        // Both bump Filler 05 from 1 to 2 — the same edit, kept once; the
        // true count is 3. Only the structure check can tell.
        const base = buildLockfile(corpus(X, Y));
        const ours = buildLockfile(corpus(moved(X, "Filler line 05 hums."), Y));
        const theirs = buildLockfile(
            corpus(X, moved(Y, "Filler line 05 hums."))
        );
        const { status, merged } = mergeFile(base, ours, theirs);
        expect(status).toBe(0);
        expect(
            lockfileStructureProblems(parseLockfile(merged)).join("\n")
        ).toMatch(/declares 2 card\(s\), 3 cite it/);
    });

    describe("the merge driver", () => {
        function runDriver(base: Lockfile, ours: Lockfile, theirs: Lockfile) {
            const repo = join(dir, "repo");
            spawnSync("git", ["init", "-q", repo]);
            for (const [name, lock] of [
                ["base", base],
                ["ours", ours],
                ["theirs", theirs],
            ] as const)
                writeFileSync(join(repo, name), serializeLockfile(lock));
            const r = spawnSync(
                "bun",
                [
                    DRIVER,
                    join(repo, "base"),
                    join(repo, "ours"),
                    join(repo, "theirs"),
                    LOCKFILE_REL,
                ],
                { cwd: repo, encoding: "utf8" }
            );
            const marker = spawnSync(
                "git",
                ["rev-parse", "--git-path", REGENERATE_MARKER],
                {
                    cwd: repo,
                    encoding: "utf8",
                }
            ).stdout.trim();
            let marked = "";
            try {
                marked = readFileSync(join(repo, marker), "utf8");
            } catch {
                marked = "";
            }
            return {
                status: r.status,
                result: readFileSync(join(repo, "ours"), "utf8"),
                marked,
            };
        }

        it("keeps a clean merge that IS the regenerated lockfile, marking nothing", () => {
            const base = buildLockfile(corpus(X, Y));
            const ours = buildLockfile(
                corpus(moved(X, "Filler line 05 hums."), Y)
            );
            const theirs = buildLockfile(
                corpus(X, moved(Y, "Filler line 09 hums."))
            );
            const { status, result, marked } = runDriver(base, ours, theirs);
            expect(status).toBe(0);
            expect(marked).toBe("");
            expect(lockfileStructureProblems(parseLockfile(result))).toEqual(
                []
            );
        });

        it("takes OURS and marks the lockfile for regeneration when the clean merge breaks its structure", () => {
            const base = buildLockfile(corpus(X, Y));
            const ours = buildLockfile(
                corpus(moved(X, "Filler line 05 hums."), Y)
            );
            const theirs = buildLockfile(
                corpus(X, moved(Y, "Filler line 05 hums."))
            );
            const { status, result, marked } = runDriver(base, ours, theirs);
            expect(status).toBe(0);
            expect(marked).toBe(`${LOCKFILE_REL}\n`);
            expect(result).toBe(serializeLockfile(ours));
        });
    });
});

describe("the compiler refuses two fragments sharing one key", () => {
    it("throws naming both lines and the constant to raise", () => {
        expect(() =>
            buildLockfile(
                [
                    refused(1, "One line hums."),
                    refused(2, "Another line hums."),
                ],
                { fragmentKey: () => "000000000000" }
            )
        ).toThrow(
            /share the Fragment Key 000000000000 — raise FRAGMENT_KEY_HEX/
        );
    });

    it("the real key separates them", () => {
        expect(fragmentKey({ text: "One line hums.", reason: "r" })).not.toBe(
            fragmentKey({ text: "Another line hums.", reason: "r" })
        );
    });
});
