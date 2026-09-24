/**
 * Target Lists — `data/targets.json`, the fail-closed resolver and the five
 * coverage states (issue #3867, wayfinder issue #3848).
 *
 * The registry test runs against the COMMITTED lockfile: every registered
 * Target must resolve, card for card, to oracle ids of the pinned corpus. The
 * rest runs on fixtures, because each rule is a denominator guard whose red
 * has to be reachable on purpose.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseLockfile, type CardRow } from "../lib/oracle-lockfile";
import {
    claimId,
    coverageState,
    coverageVerdict,
    quarantineClass,
    gapIndex,
    parseNameList,
    parseTargetRegistry,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
    targetCoverage,
    type CoverageContext,
    type TargetRow,
} from "../lib/targets";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function row(
    oracleId: string,
    name: string,
    state: CardRow["state"],
    extra: Partial<CardRow> = {}
): CardRow {
    return { oracleId, name, state, ...extra };
}

describe("data/targets.json — the registered Target Lists", () => {
    const registry = readTargetRegistry(ROOT);
    const lock = parseLockfile(
        readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
    );
    const ctx = resolveContext(ROOT, lock);

    it("carries the seed rows and the registry-level fields", () => {
        expect(registry.handTailFloor).toBe(3);
        expect(registry.handTailFiling).toBe(true);
        const ids = registry.targets.map((t) => t.id);
        for (const id of [
            "premodern-metagame",
            "vintage-cube",
            "tier1-goblin",
            "tier1-psychatog",
            "tier1-parallax-replenish",
            "tier1-landstill",
            "tier1-oath-ponza",
            "tier1-aluren",
            "format-premodern",
            "format-commander",
            "set-apc",
        ])
            expect(ids).toContain(id);
        expect(
            registry.targets
                .filter((t) => t.priority !== undefined)
                .sort((a, b) => a.priority! - b.priority!)
                .map((t) => t.id)
        ).toEqual(["premodern-metagame", "vintage-cube", "format-premodern"]);
    });

    it("flags premodern-metagame as a `ready` Target and no other (issue #4519)", () => {
        expect(
            registry.targets
                .filter((t) => t.completion === "ready")
                .map((t) => t.id)
        ).toEqual(["premodern-metagame"]);
    });

    it("resolves every registered Target to 100% oracle ids of the pinned corpus", () => {
        for (const target of registry.targets) {
            const resolved = resolveTarget(target, ctx);
            expect(resolved.cards.length, target.id).toBeGreaterThan(0);
            const missing = resolved.cards.filter(
                (c) => !ctx.byOracleId.has(c.oracleId)
            );
            expect(missing, target.id).toEqual([]);
        }
    });

    it("resolves a whole list, not a subset: the cube's 542 names are 542 cards", () => {
        const cube = registry.targets.find((t) => t.id === "vintage-cube")!;
        const names = parseNameList(
            readFileSync(join(ROOT, cube.source), "utf8"),
            cube.id
        );
        expect(resolveTarget(cube, ctx).cards).toHaveLength(names.length);
    });
});

describe("the resolver is fail-closed", () => {
    const LOCK = {
        cards: [
            row("id-bolt", "Lightning Bolt", "ready", { poolIn: ["legacy"] }),
            row(
                "id-ajani",
                "Ajani, Nacatl Pariah // Ajani, Nacatl Avenger",
                "unparsed"
            ),
            row("id-bear", "Grizzly Bears", "ready"),
        ],
    };
    const root = mkdtempSync(join(tmpdir(), "targets-"));
    const ctx = resolveContext(root, LOCK);
    const nameList = (id: string, text: string): TargetRow => {
        writeFileSync(join(root, `${id}.txt`), text);
        return { id, kind: "name-list", source: `${id}.txt` };
    };

    it("resolves exact names and front faces", () => {
        const resolved = resolveTarget(
            nameList("ok", "# comment\nLightning Bolt\nAjani, Nacatl Pariah\n"),
            ctx
        );
        expect(resolved.cards.map((c) => c.oracleId)).toEqual([
            "id-ajani",
            "id-bolt",
        ]);
    });

    it("throws on a name the lockfile does not carry", () => {
        expect(() =>
            resolveTarget(nameList("typo", "Lightning Blot\n"), ctx)
        ).toThrow(/Lightning Blot.*not carried by the Oracle lockfile/);
    });

    it("throws on a name listed twice, and on two spellings of one card", () => {
        expect(() =>
            resolveTarget(
                nameList("dup", "Grizzly Bears\ngrizzly bears\n"),
                ctx
            )
        ).toThrow(/listed twice/);
        expect(() =>
            resolveTarget(
                nameList(
                    "alias",
                    "Ajani, Nacatl Pariah\nAjani, Nacatl Pariah // Ajani, Nacatl Avenger\n"
                ),
                ctx
            )
        ).toThrow(/already names/);
    });

    it("throws on a deck slug the file does not hold", () => {
        expect(() =>
            resolveTarget(
                {
                    id: "tier1-nope",
                    kind: "deck-list",
                    source: "data/premodern-tier1-decks.json#nope",
                },
                resolveContext(ROOT, LOCK)
            )
        ).toThrow(/names deck `nope`/);
    });

    it("resolves a set card by name when MTGJSON's oracle id is not the corpus's, and throws when neither resolves", () => {
        const set = (id: string, cards: unknown[]): TargetRow => {
            writeFileSync(
                join(root, `${id}.json`),
                JSON.stringify({ data: { cards } })
            );
            return { id, kind: "set", source: `${id}.json` };
        };
        const wrongId = {
            name: "Grizzly Bears",
            identifiers: { scryfallOracleId: "a-printing-id" },
        };
        expect(
            resolveTarget(set("fallback", [wrongId]), ctx).cards.map(
                (c) => c.oracleId
            )
        ).toEqual(["id-bear"]);
        expect(() =>
            resolveTarget(
                set("unknown", [
                    {
                        name: "Nonexistent",
                        identifiers: { scryfallOracleId: "nope" },
                    },
                ]),
                ctx
            )
        ).toThrow(/Nonexistent/);
    });

    it("throws on a format pool that resolves to no cards", () => {
        expect(() =>
            resolveTarget(
                { id: "format-pauper", kind: "format", source: "pauper" },
                ctx
            )
        ).toThrow(/resolves to no cards/);
        expect(
            resolveTarget(
                { id: "format-legacy", kind: "format", source: "legacy" },
                ctx
            ).cards.map((c) => c.name)
        ).toEqual(["Lightning Bolt"]);
    });
});

describe("parseTargetRegistry rejects a malformed registry", () => {
    const doc = (patch: object): string =>
        JSON.stringify({
            handTailFloor: 3,
            handTailFiling: false,
            targets: [
                { id: "a", kind: "format", source: "premodern", priority: 1 },
                { id: "b", kind: "set", source: "data/json/APC.json" },
            ],
            ...patch,
        });

    it("accepts the well-formed shape", () => {
        expect(parseTargetRegistry(doc({})).targets).toHaveLength(2);
    });

    it.each(["playable", "ready"])("accepts `completion: %s`", (completion) => {
        const registry = parseTargetRegistry(
            doc({
                targets: [{ id: "a", kind: "set", source: "x", completion }],
            })
        );
        expect(registry.targets[0]!.completion).toBe(completion);
    });

    it("rejects an unknown `completion`, naming the row", () => {
        expect(() =>
            parseTargetRegistry(
                doc({
                    targets: [
                        {
                            id: "a",
                            kind: "set",
                            source: "x",
                            completion: "all",
                        },
                    ],
                })
            )
        ).toThrow(/a: unknown `completion` `all`/);
    });

    it.each([
        ["a non-positive floor", { handTailFloor: 0 }, /handTailFloor/],
        [
            "a non-boolean filing switch",
            { handTailFiling: "no" },
            /handTailFiling/,
        ],
        ["no targets", { targets: [] }, /non-empty/],
        [
            "a duplicate id",
            {
                targets: [
                    { id: "a", kind: "set", source: "x" },
                    { id: "a", kind: "set", source: "y" },
                ],
            },
            /duplicate target id/,
        ],
        [
            "an unknown kind",
            { targets: [{ id: "a", kind: "cube", source: "x" }] },
            /unknown kind/,
        ],
        [
            "an unknown format",
            { targets: [{ id: "a", kind: "format", source: "standard" }] },
            /unknown format/,
        ],
        [
            "a shared priority",
            {
                targets: [
                    { id: "a", kind: "set", source: "x", priority: 1 },
                    { id: "b", kind: "set", source: "y", priority: 1 },
                ],
            },
            /share priority/,
        ],
    ])("%s", (_, patch, message) => {
        expect(() => parseTargetRegistry(doc(patch))).toThrow(message);
    });
});

describe("coverage states — exactly one per card", () => {
    const ROUTER = "no slot consumed the line";
    const FRAGMENTS = [
        { text: "Widespread ability.", reason: ROUTER, cards: 3 },
        { text: "Unique ability.", reason: ROUTER, cards: 1 },
        { text: "Another unique ability.", reason: ROUTER, cards: 1 },
    ];
    const HELD = { kind: "planned-mechanic" as const, detail: "keyword" };
    const cards: CardRow[] = [
        row("r", "Ready", "ready"),
        row("q", "Held", "quarantine", { quarantineReasons: [HELD] }),
        // Four corpus cards carry the widespread gap: above the floor of 3.
        row("p1", "Pending One", "unparsed", { gaps: [0] }),
        row("p2", "Pending Two", "unparsed", { gaps: [0] }),
        row("u", "Mixed", "unparsed", { gaps: [0, 1] }),
        row("h", "Declared", "unparsed", { gaps: [1] }),
        row("b", "Below", "unparsed", { gaps: [2] }),
        row("hr", "Declared Ready", "ready"),
        row("hc", "Declared Climbed", "unparsed", { gaps: [0] }),
    ];
    const lock = { cards, fragments: FRAGMENTS };
    const byOracleId = new Map(cards.map((c) => [c.oracleId, c] as const));
    const gaps = gapIndex(lock);
    const [WIDESPREAD] = gaps.gapKeys(byOracleId.get("p1")!);
    const ctx: CoverageContext = {
        floor: 3,
        handWritten: new Set(["h", "u"]),
        handTail: new Set(["h", "hr", "hc"]),
        closure: new Set(),
        // The widespread gap has its grammar issue; nothing else is claimed.
        claims: new Set([
            claimId("grammar", WIDESPREAD!),
            claimId("mechanic", quarantineClass(HELD).key),
        ]),
        byOracleId,
        ...gaps,
    };
    const stateOf = (id: string): string =>
        coverageState(byOracleId.get(id)!, ctx);

    it("sorts each card into its state", () => {
        expect(
            ["r", "q", "p1", "u", "b", "h", "hr", "hc"].map((id) => [
                id,
                stateOf(id),
            ])
        ).toEqual([
            ["r", "ready"],
            ["q", "quarantine"],
            ["p1", "gap-pending"],
            ["u", "gap-pending"],
            ["b", "unclaimed"],
            ["h", "hand-tail"],
            ["hr", "ready"],
            // The marker never outranks a gap (issue #3868): the gap climbed.
            ["hc", "gap-pending"],
        ]);
    });

    it("a `ready` Target has no floor: a below-floor gap owes a grammar claim, and Hand Tail never settles the card (issue #4519)", () => {
        const verdict = (id: string, over: Partial<CoverageContext> = {}) =>
            coverageVerdict(byOracleId.get(id)!, { ...ctx, ...over }, "ready");
        // "Below" carries a gap of 1 card (floor 3): Hand Tail under `playable`,
        // unclaimed under `ready` until its `grammar` claim exists.
        expect(coverageState(byOracleId.get("b")!, ctx)).toBe("unclaimed");
        const [BELOW] = gaps.gapKeys(byOracleId.get("b")!);
        expect(verdict("b").state).toBe("unclaimed");
        expect(verdict("b").why).toContain("`grammar` claim");
        expect(
            verdict("b", {
                claims: new Set([...ctx.claims, claimId("grammar", BELOW!)]),
            }).state
        ).toBe("gap-pending");
        // "Declared" has a marker and a gap of 2 corpus cards: the marker
        // settles it under `playable`, but under `ready` the gap is grammar owed.
        expect(coverageState(byOracleId.get("h")!, ctx)).toBe("hand-tail");
        expect(verdict("h").state).toBe("unclaimed");
        expect(verdict("h").why).toContain("no `grammar` claim");
        // A gapless card cannot be owed a grammar claim; its `hand-tail` claim
        // or marker is reported as not satisfying a `ready` Target.
        const bare = row("g", "Gapless", "unparsed", { gaps: [] });
        for (const over of [
            { handTail: new Set(["g"]) },
            {
                claims: new Set([
                    ...ctx.claims,
                    claimId("hand-tail", "Gapless"),
                ]),
            },
        ])
            expect(coverageVerdict(bare, { ...ctx, ...over }, "ready")).toEqual(
                {
                    state: "unclaimed",
                    why: expect.stringContaining(
                        "does not satisfy a `ready` Target"
                    ),
                }
            );
    });

    it("raises the floor and gap-pending falls to unclaimed", () => {
        expect(coverageState(byOracleId.get("p1")!, { ...ctx, floor: 5 })).toBe(
            "unclaimed"
        );
    });

    it("reports playable as ready ∪ hand-written, and the migrable hand-tail cards", () => {
        const coverage = targetCoverage(
            {
                row: { id: "t", kind: "name-list", source: "t.txt" },
                cards: cards.map((c) => ({
                    oracleId: c.oracleId,
                    name: c.name,
                })),
            },
            ctx
        );
        expect(coverage.total).toBe(9);
        // ready: Ready, Declared Ready; hand-written: Declared, Mixed.
        expect(coverage.playable).toBe(4);
        expect(coverage.byState["hand-tail"]).toEqual(["Declared"]);
        expect(coverage.migrable.map((m) => m.name)).toEqual([
            "Declared Ready",
            "Declared Climbed",
        ]);
        expect(coverage.migrable[0]!.why).toMatch(/oracle:retire/);
        expect(coverage.migrable[1]!.why).toMatch(/unlocks 4 corpus cards/);
    });
});
