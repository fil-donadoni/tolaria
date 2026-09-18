/**
 * `check:targets` — the Coverage Invariant (issue #3868).
 *
 * Every red runs on a synthetic lockfile + registry fixture, because each is
 * a guard whose red has to be reachable on purpose: the committed tree has no
 * enforced Target yet, so a test over it would pass vacuously. The fixture is
 * GREEN as built; each case removes one claim (or adds one marker) and names
 * the exact red that must follow.
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { auditCoverage } from "../check-targets";
import { compilerGapCards } from "../lib/coverage-context";
import { HEALTH_SCRIPTS } from "../lib/health-step";
import type { CardRow } from "../lib/oracle-lockfile";
import {
    claimId,
    coverageVerdict,
    gapIndex,
    parseClaims,
    quarantineClass,
    targetCoverage,
    type CoverageContext,
} from "../lib/targets";

const ROOT = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
};

describe("check:targets runs in health, and nowhere else", () => {
    it("is a script of its own", () => {
        expect(pkg.scripts["check:targets"]).toBe(
            "bun scripts/check-targets.ts"
        );
    });

    it("is a health step, after check:all (lockfile drift) and check:gaps", () => {
        expect(HEALTH_SCRIPTS).toContain("check:targets");
        expect(HEALTH_SCRIPTS.indexOf("check:targets")).toBeGreaterThan(
            HEALTH_SCRIPTS.indexOf("check:gaps")
        );
        expect(HEALTH_SCRIPTS.indexOf("check:gaps")).toBeGreaterThan(
            HEALTH_SCRIPTS.indexOf("check:all")
        );
    });

    // Scanned, not enumerated: `check:all`, `check:pr` and `land` — and any
    // script composed from them — pay nothing (see check-gaps.test.ts).
    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== "check:targets" && body.includes("check:targets")
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });
});

const ROUTER = "no slot consumed the line";
const FRAGMENTS = [
    { text: "Widespread ability.", reason: ROUTER, cards: 3 },
    { text: "Unique ability.", reason: ROUTER, cards: 1 },
    { text: "Another unique ability.", reason: ROUTER, cards: 1 },
];
const MECHANIC = {
    kind: "planned-mechanic" as const,
    detail: 'keyword "horsemanship" is not implemented in the Mechanics Registry',
};
const SCENARIO = {
    kind: "smoke-scenario" as const,
    detail: "amount is chosen-cost X — depends on the value announced for {X} at cast time",
};
const row = (
    oracleId: string,
    name: string,
    state: CardRow["state"],
    extra: Partial<CardRow> = {}
): CardRow => ({ oracleId, name, state, ...extra });

const CARDS: CardRow[] = [
    row("r", "Ready", "ready"),
    row("q", "Held Mechanic", "quarantine", { quarantineReasons: [MECHANIC] }),
    row("s", "Held Scenario", "quarantine", { quarantineReasons: [SCENARIO] }),
    // Four corpus cards carry the widespread gap (with Closure Climbed): above the floor of 3.
    row("p1", "Pending One", "unparsed", { gaps: [0] }),
    row("p2", "Pending Two", "unparsed", { gaps: [0] }),
    row("p3", "Pending Mixed", "unparsed", { gaps: [0, 1] }),
    row("b", "Below Marked", "unparsed", { gaps: [1] }),
    row("t", "Below Row", "unparsed", { gaps: [2] }),
    // Not in the Target: extra rows the fixture's ADD cases pull in.
    row("mr", "Marked Ready", "ready"),
    row("cl", "Closure Ready", "ready"),
    row("cc", "Closure Climbed", "unparsed", { gaps: [0] }),
];
const lock = { cards: CARDS, fragments: FRAGMENTS };
const byOracleId = new Map(CARDS.map((c) => [c.oracleId, c] as const));
const gaps = gapIndex(lock);
const WIDESPREAD = gaps.gapKeys(byOracleId.get("p1")!)[0]!;
const IN_TARGET = ["r", "q", "s", "p1", "p2", "p3", "b", "t"];

const GREEN: CoverageContext = {
    floor: 3,
    handWritten: new Set(),
    handTail: new Set(["b"]),
    closure: new Set(),
    claims: new Set([
        claimId("mechanic", quarantineClass(MECHANIC).key),
        claimId("scenario", quarantineClass(SCENARIO).key),
        claimId("grammar", WIDESPREAD),
        claimId("hand-tail", "Below Row"),
    ]),
    byOracleId,
    ...gaps,
};

function reds(
    ctx: CoverageContext,
    ids: readonly string[] = IN_TARGET,
    enforced = true
): string[] {
    return auditCoverage([
        targetCoverage(
            {
                row: { id: "t", kind: "name-list", source: "t.txt", enforced },
                cards: ids.map((id) => ({
                    oracleId: id,
                    name: byOracleId.get(id)!.name,
                })),
            },
            ctx
        ),
    ]);
}

const without = (id: string): Set<string> =>
    new Set([...GREEN.claims].filter((c) => c !== id));

describe("the Coverage Invariant — every enforced Target card claimed", () => {
    it("is green on the fixture as built, one card per state", () => {
        expect(reds(GREEN)).toEqual([]);
        expect(
            IN_TARGET.map(
                (id) => coverageVerdict(byOracleId.get(id)!, GREEN).state
            )
        ).toEqual([
            "ready",
            "quarantine",
            "quarantine",
            "gap-pending",
            "gap-pending",
            "gap-pending",
            "hand-tail",
            "hand-tail",
        ]);
    });

    it("reds a quarantine class with no claim — no silent quarantine", () => {
        expect(
            reds({
                ...GREEN,
                claims: without(
                    claimId("mechanic", quarantineClass(MECHANIC).key)
                ),
            })
        ).toEqual([
            't: Held Mechanic — unclaimed: quarantine class `planned-mechanic › keyword "horsemanship" is not implemented in the Mechanics Registry` has no `mechanic` claim',
        ]);
        expect(
            reds({
                ...GREEN,
                claims: without(
                    claimId("scenario", quarantineClass(SCENARIO).key)
                ),
            })
        ).toEqual([
            expect.stringMatching(
                /^t: Held Scenario — unclaimed: quarantine class `smoke-scenario › .*` has no `scenario` claim$/
            ),
        ]);
    });

    it("reds a quarantine row that carries no reason — fail closed", () => {
        const bare = row("z", "Held Bare", "quarantine");
        const ctx = {
            ...GREEN,
            byOracleId: new Map([...byOracleId, ["z", bare] as const]),
        };
        expect(coverageVerdict(bare, ctx)).toEqual({
            state: "unclaimed",
            why: "quarantine row carries no reason to claim",
        });
    });

    it("reds a gap at or above the floor with no grammar claim — each card that carries it", () => {
        expect(
            reds({ ...GREEN, claims: without(claimId("grammar", WIDESPREAD)) })
        ).toEqual(
            ["Pending One", "Pending Two", "Pending Mixed"].map(
                (name) =>
                    `t: ${name} — unclaimed: gap \`${WIDESPREAD}\` (4 corpus cards, floor 3) has no \`grammar\` claim`
            )
        );
    });

    it("reds a below-floor card with neither a hand-tail claim nor a marker", () => {
        expect(reds({ ...GREEN, handTail: new Set() })).toEqual([
            "t: Below Marked — unclaimed: every gap below the floor (3) and neither a `hand-tail` claim nor a `hand-tail:` marker",
        ]);
        expect(
            reds({
                ...GREEN,
                claims: without(claimId("hand-tail", "Below Row")),
            })
        ).toEqual([
            "t: Below Row — unclaimed: every gap below the floor (3) and neither a `hand-tail` claim nor a `hand-tail:` marker",
        ]);
    });

    it("reds a hand-tail marker on a ready card — retire the hand-written twin", () => {
        expect(
            reds({ ...GREEN, handTail: new Set(["b", "mr"]) }, [
                ...IN_TARGET,
                "mr",
            ])
        ).toEqual([
            "t: Marked Ready — hand-tail marker: row is ready — retire the hand-written definition (oracle:retire)",
        ]);
    });

    it("reds a hand-tail marker on a card whose gap climbed to the floor — and the marker does not claim it", () => {
        const ctx = { ...GREEN, handTail: new Set(["b", "cc"]) };
        // A marked card whose gap climbed is gap-pending, never hand-tail.
        expect(coverageVerdict(byOracleId.get("cc")!, ctx).state).toBe(
            "gap-pending"
        );
        expect(reds(ctx, [...IN_TARGET, "cc"])).toEqual([
            expect.stringMatching(
                /^t: Closure Climbed — hand-tail marker: gap at the floor — `.*` unlocks 4 corpus cards \(floor 3\); flip the marker to compiler-gap:$/
            ),
        ]);
    });

    it("reports but never reds a Target that is not enforced", () => {
        const broken = {
            ...GREEN,
            handTail: new Set<string>(),
            claims: new Set<string>(),
        };
        expect(reds(broken).length).toBeGreaterThan(0);
        expect(reds(broken, IN_TARGET, false)).toEqual([]);
    });
});

describe("protocol cards — a closure body is Hand Tail by construction", () => {
    // Marked, closure body, and the compiler now produces a definition beside
    // it (Guard C `incomparable`): whatever its row and gaps.
    const ctx: CoverageContext = {
        ...GREEN,
        handTail: new Set(["b", "cl", "cc"]),
        closure: new Set(["cl", "cc"]),
        claims: without(claimId("grammar", WIDESPREAD)),
    };

    it("is hand-tail on a ready row, and no ready → migrate red", () => {
        expect(coverageVerdict(byOracleId.get("cl")!, ctx).state).toBe(
            "hand-tail"
        );
        expect(reds(ctx, ["cl"])).toEqual([]);
    });

    it("is hand-tail with an unclaimed gap at the floor, and no gap red", () => {
        expect(coverageVerdict(byOracleId.get("cc")!, ctx).state).toBe(
            "hand-tail"
        );
        expect(reds(ctx, ["cc"])).toEqual([]);
    });

    it("is listed for a manual behaviour comparison, marker or not", () => {
        const coverage = targetCoverage(
            {
                row: { id: "t", kind: "name-list", source: "t.txt" },
                cards: ["r", "cl"].map((id) => ({
                    oracleId: id,
                    name: byOracleId.get(id)!.name,
                })),
            },
            { ...ctx, handTail: new Set() }
        );
        expect(coverage.closureCompiles).toEqual(["Closure Ready"]);
    });
});

describe("parseClaims — the allowlist's claims, fail-closed", () => {
    it("reads claims by kind and key, and the ops rows as grammar claims", () => {
        const ids = parseClaims({
            ops: [{ key: "(op) › addMana", issue: 3820 }],
            claims: [{ kind: "hand-tail", key: "Onulet", issue: 3900 }],
        });
        expect([...ids].sort()).toEqual(
            [
                claimId("grammar", "(op) › addMana"),
                claimId("hand-tail", "Onulet"),
            ].sort()
        );
    });

    it("validates a `bot` / `migration` row but never returns it — those two settle no card's state (issue #3869)", () => {
        const ids = parseClaims({
            claims: [
                { kind: "migration", key: "activated", issue: 4100 },
                { kind: "bot", key: "some-form", issue: 4101 },
                { kind: "hand-tail", key: "Onulet", issue: 3900 },
            ],
        });
        expect([...ids]).toEqual([claimId("hand-tail", "Onulet")]);
        expect(() =>
            parseClaims({ claims: [{ kind: "migration", key: "x", issue: 0 }] })
        ).toThrow(/positive integer/);
    });

    it("throws on a key carrying a tab — `claimId` joins on one, so it would never round-trip", () => {
        // A quarantine key embeds a free-text compiler diagnostic; one tab in
        // it and the written row never matches the recomputed id, so the gap
        // is filed afresh on every run, forever (review of PR #3978).
        expect(() =>
            parseClaims({
                claims: [{ kind: "mechanic", key: "a\tb", issue: 1 }],
            })
        ).toThrow(/tab or newline/);
    });

    it.each([
        [
            "an unknown kind",
            { kind: "gramar", key: "x", issue: 1 },
            /unknown kind/,
        ],
        ["no key", { kind: "grammar", key: "", issue: 1 }, /no `key`/],
        ["no issue", { kind: "grammar", key: "x" }, /positive integer/],
        [
            "a zero issue",
            { kind: "grammar", key: "x", issue: 0 },
            /positive integer/,
        ],
    ])("throws on %s", (_, claim, message) => {
        expect(() => parseClaims({ claims: [claim] })).toThrow(message);
    });

    it("throws on a claim listed twice", () => {
        const claim = { kind: "grammar", key: "x", issue: 1 };
        expect(() => parseClaims({ claims: [claim, claim] })).toThrow(
            /listed twice/
        );
    });

    it("parses the committed allowlist", () => {
        const doc = JSON.parse(
            readFileSync(join(ROOT, "data/grammar-gaps.json"), "utf8")
        );
        expect(parseClaims(doc).size).toBeGreaterThan(0);
    });
});

describe("quarantineClass — one claim per class, never per card", () => {
    it("drops the validator's card prefix so two cards share one key", () => {
        const detail = (card: string, id: string) =>
            `${card} (${id}): effects[0]: ref "$source" references undefined binding "$source"`;
        const a = quarantineClass({
            kind: "validate-effect-script",
            detail: detail("Alpha", "c73df59d-60e5-4541-81d9-5481cf2343bd"),
        });
        const b = quarantineClass({
            kind: "validate-effect-script",
            detail: detail("Beta Two", "00000000-0000-4000-8000-000000000000"),
        });
        expect(a).toEqual(b);
        expect(a).toEqual({
            kind: "scenario",
            key: 'validate-effect-script › effects[0]: ref "$source" references undefined binding "$source"',
        });
    });

    it("sorts the engine-missing reasons under mechanic, the generated checks under scenario", () => {
        expect(quarantineClass(MECHANIC).kind).toBe("mechanic");
        expect(
            quarantineClass({ kind: "ungrantable-keyword", detail: "x" }).kind
        ).toBe("mechanic");
        expect(quarantineClass({ kind: "planned-op", detail: "x" }).kind).toBe(
            "mechanic"
        );
        expect(quarantineClass(SCENARIO).kind).toBe("scenario");
    });
});

describe("compilerGapCards — the markers `gaps:sync` reports against the floor", () => {
    /** A throwaway root with the one directory the scanner reads. */
    function fixtureRoot(source: string): string {
        const dir = mkdtempSync(join(tmpdir(), "compiler-gap-cards-"));
        const sets = join(dir, "convex", "cards", "sets");
        mkdirSync(sets, { recursive: true });
        writeFileSync(join(sets, "fixture.ts"), source);
        return dir;
    }

    it("returns the `compiler-gap:` cards and NEVER a `hand-tail:` one", () => {
        // The two marker kinds say opposite things — one that the grammar
        // still owes a rule, the other that it never will — and `gaps:sync`
        // reports only the first against the floor. The committed tree
        // carries no `hand-tail:` marker yet, so this pair is synthetic: a
        // reader that dropped the kind filter would pass over that tree.
        const root = fixtureRoot(
            [
                "// compiler-gap: draws a card for each (#1)",
                "export const OWED: CardDefinition = {",
                '    name: "Owed Card",',
                "};",
                "",
                "// hand-tail: a one-off clause (#2)",
                "export const TAIL: CardDefinition = {",
                '    name: "Tail Card",',
                "};",
                "",
            ].join("\n")
        );
        expect([...compilerGapCards(root)]).toEqual(["Owed Card"]);
    });

    it("is non-vacuous over the committed tree — the catalogue carries markers today", () => {
        // A reader that silently returned nothing would report no fallen
        // marker ever, which is the failure this assertion exists to catch.
        expect(compilerGapCards(ROOT).size).toBeGreaterThan(0);
    });
});
