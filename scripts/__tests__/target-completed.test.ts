/**
 * `targetCompleted()` — the v1 gate's three clauses as one verdict
 * (issue #4208, ADR 0143 § The v1 gate).
 *
 * The fixture is GREEN as built (all three clauses hold); each case breaks
 * exactly one clause and names the one failing clause that must follow, so a
 * clause that stopped reading its input goes red here and not silently green.
 * The `CoverageContext` is synthetic, like `check-targets.test.ts`'s.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CardRow } from "../lib/oracle-lockfile";
import {
    formatCompletion,
    mustCoveredCards,
    targetCompleted,
    type BotPlayCard,
    type BotPlayVerdicts,
} from "../lib/target-completed";
import {
    claimId,
    gapIndex,
    quarantineClass,
    targetCoverage,
    type CoverageContext,
} from "../lib/targets";

const MECHANIC = {
    kind: "planned-mechanic" as const,
    detail: 'keyword "horsemanship" is not implemented in the Mechanics Registry',
};
const row = (
    oracleId: string,
    name: string,
    state: CardRow["state"],
    extra: Partial<CardRow> = {}
): CardRow => ({ oracleId, name, state, ...extra });

const CARDS: CardRow[] = [
    row("r", "Ready", "ready"),
    row("r2", "Ready Two", "ready"),
    // Held for a mechanic, claimed, and hand-written: playable, declared.
    row("q", "Held Hand-Written", "quarantine", {
        quarantineReasons: [MECHANIC],
    }),
    // A grammar gap at the floor with its claim: covered, not yet playable.
    row("p", "Grammar Pending", "unparsed", { gaps: [0] }),
    // Hand-written (playable) but neither claimed nor marked: the invariant's red.
    row("u", "Bare Hand-Written", "unparsed", { gaps: [] }),
];
const FRAGMENTS = [
    {
        text: "Widespread ability.",
        reason: "no slot consumed the line",
        cards: 1,
    },
];
const byOracleId = new Map(CARDS.map((c) => [c.oracleId, c] as const));
const gaps = gapIndex({ cards: CARDS, fragments: FRAGMENTS });
const GAP_KEY = gaps.gapKeys(byOracleId.get("p")!)[0]!;

const CTX: CoverageContext = {
    floor: 1,
    handWritten: new Set(["q", "u"]),
    handTail: new Set(),
    closure: new Set(),
    claims: new Set([
        claimId("mechanic", quarantineClass(MECHANIC).key),
        claimId("grammar", GAP_KEY),
    ]),
    byOracleId,
    ...gaps,
};

function coverage(ids: readonly string[], ctx: CoverageContext = CTX) {
    return targetCoverage(
        {
            row: { id: "t", kind: "name-list", source: "t.txt" },
            cards: ids.map((id) => ({
                oracleId: id,
                name: byOracleId.get(id)!.name,
            })),
        },
        ctx
    );
}

const played = (name: string): BotPlayCard => ({ name, outcome: "played" });
const NEVER = "never-chosen › cast-spell(instant) › (no Ops)";
const verdicts = (
    cards: readonly BotPlayCard[],
    mustCovered: readonly string[] = []
): BotPlayVerdicts => ({ cards, mustCovered: new Set(mustCovered) });

const GREEN_IDS = ["r", "q"];
const GREEN_BOT = verdicts([played("Ready"), played("Held Hand-Written")]);

describe("targetCompleted — the three clauses of the v1 gate", () => {
    it("is `completed` when all three clauses hold", () => {
        const completion = targetCompleted(coverage(GREEN_IDS), GREEN_BOT);
        expect(completion.failing).toEqual([]);
        expect(completion.completed).toBe(true);
        expect(formatCompletion(completion)).toBe("  completed: yes\n");
    });

    it("clause 1 alone red: a card neither ready nor hand-written", () => {
        const completion = targetCompleted(
            coverage([...GREEN_IDS, "p"]),
            verdicts([
                played("Ready"),
                played("Held Hand-Written"),
                { name: "Grammar Pending", outcome: "unplayable" },
            ])
        );
        expect(completion.failing).toEqual(["playable"]);
        expect(completion.completed).toBe(false);
        expect(completion.playable.missing).toEqual(["Grammar Pending"]);
        expect(completion.coverageInvariant.green).toBe(true);
        expect(completion.botPlay.green).toBe(true);
    });

    it("clause 2 alone red: a playable card the Coverage Invariant leaves unclaimed", () => {
        const completion = targetCompleted(
            coverage([...GREEN_IDS, "u"]),
            verdicts([
                played("Ready"),
                played("Held Hand-Written"),
                played("Bare Hand-Written"),
            ])
        );
        expect(completion.failing).toEqual(["coverage-invariant"]);
        expect(completion.playable.green).toBe(true);
        expect(completion.botPlay.green).toBe(true);
        expect(completion.coverageInvariant.reds).toEqual([
            expect.stringMatching(/^t: Bare Hand-Written — unclaimed: /),
        ]);
    });

    describe("clause 3 alone red", () => {
        const others = [played("Held Hand-Written")];

        it("a frozen card — hard, whatever its cause", () => {
            const completion = targetCompleted(
                coverage(GREEN_IDS),
                verdicts([
                    {
                        name: "Ready",
                        outcome: "frozen",
                        gap: "no-legal-move › cast-spell(instant)",
                    },
                    ...others,
                ])
            );
            expect(completion.failing).toEqual(["bot-play"]);
            expect(completion.botPlay.frozen).toEqual(["Ready"]);
        });

        it("a never-chosen card with no fix and no must Test Position", () => {
            const completion = targetCompleted(
                coverage(GREEN_IDS),
                verdicts([
                    { name: "Ready", outcome: "ignored", gap: NEVER },
                    ...others,
                ])
            );
            expect(completion.failing).toEqual(["bot-play"]);
            expect(completion.botPlay.neverChosen).toEqual(["Ready"]);
        });

        it("a Target card the report has no verdict for (a stale report is red, not green)", () => {
            const completion = targetCompleted(
                coverage(GREEN_IDS),
                verdicts(others)
            );
            expect(completion.failing).toEqual(["bot-play"]);
            expect(completion.botPlay.unmeasured).toEqual(["Ready"]);
        });

        it("an ignored card whose cause the ADR does not classify (harness-error proves nothing)", () => {
            const completion = targetCompleted(
                coverage(GREEN_IDS),
                verdicts([
                    {
                        name: "Ready",
                        outcome: "ignored",
                        gap: "harness-error › boom",
                    },
                    ...others,
                ])
            );
            expect(completion.failing).toEqual(["bot-play"]);
            expect(completion.botPlay.unmeasured).toEqual(["Ready"]);
        });

        it("no verdicts at all — the clause cannot be proved, and says why", () => {
            const completion = targetCompleted(coverage(GREEN_IDS), {
                missing: "no Bot-play report supplied",
            });
            expect(completion.failing).toEqual(["bot-play"]);
            expect(formatCompletion(completion)).toContain(
                "red: bot-play — no Bot-play report supplied"
            );
        });
    });

    it("a never-chosen card covered by a `must` Test Position does not block", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts(
                [
                    { name: "Ready", outcome: "ignored", gap: NEVER },
                    played("Held Hand-Written"),
                ],
                ["Ready"]
            )
        );
        expect(completion.failing).toEqual([]);
        expect(completion.completed).toBe(true);
    });

    it("an `unplayable` verdict for a card coverage calls playable is not proof (fail-open closed)", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts([
                { name: "Ready", outcome: "unplayable" },
                played("Held Hand-Written"),
            ])
        );
        expect(completion.failing).toEqual(["bot-play"]);
        expect(completion.botPlay.unmeasured).toEqual(["Ready"]);
    });

    it("a covered never-chosen card is listed by name, never silently discharged", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts(
                [
                    { name: "Ready", outcome: "ignored", gap: NEVER },
                    played("Held Hand-Written"),
                ],
                ["Ready"]
            )
        );
        expect(completion.botPlay.coveredByMust).toEqual(["Ready"]);
        expect(formatCompletion(completion)).toBe(
            "  completed: yes\n" +
                "  never-chosen, covered by a must Test Position (1): Ready\n"
        );
    });

    it("joins a split card's `Front // Back` row name to a blade entry's face name", () => {
        const split = row("s2", "Fire // Ice", "ready");
        const ctx = {
            ...CTX,
            byOracleId: new Map([...byOracleId, ["s2", split] as const]),
        };
        const cov = targetCoverage(
            {
                row: { id: "t", kind: "name-list", source: "t.txt" },
                cards: [{ oracleId: "s2", name: "Fire // Ice" }],
            },
            ctx
        );
        const never = {
            name: "Fire // Ice",
            outcome: "ignored" as const,
            gap: NEVER,
        };
        expect(
            targetCompleted(cov, verdicts([never], ["Fire"])).completed
        ).toBe(true);
        expect(targetCompleted(cov, verdicts([never], ["Ice"])).completed).toBe(
            true
        );
        expect(
            targetCompleted(cov, verdicts([never], ["Fireball"])).completed
        ).toBe(false);
    });

    it("harness-bound cards never fail the predicate by themselves — they are listed by name", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts([
                {
                    name: "Ready",
                    outcome: "ignored",
                    gap: "position-unmodelled › cast-spell(instant)",
                },
                {
                    name: "Held Hand-Written",
                    outcome: "ignored",
                    gap: "no-progress › follow-through",
                },
            ])
        );
        expect(completion.failing).toEqual([]);
        expect(completion.completed).toBe(true);
        expect(completion.botPlay.harnessBound).toEqual([
            { name: "Ready", cause: "position-unmodelled" },
            { name: "Held Hand-Written", cause: "no-progress" },
        ]);
        expect(formatCompletion(completion)).toBe(
            "  completed: yes\n" +
                "  harness-bound, listed and not blocking (2): " +
                "Ready (position-unmodelled), Held Hand-Written (no-progress)\n"
        );
    });

    it("a harness-bound card beside a real red still leaves the real red failing", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts([
                {
                    name: "Ready",
                    outcome: "ignored",
                    gap: "no-progress › follow-through",
                },
                {
                    name: "Held Hand-Written",
                    outcome: "frozen",
                    gap: "unanswerable-input › x",
                },
            ])
        );
        expect(completion.failing).toEqual(["bot-play"]);
        expect(completion.botPlay.frozen).toEqual(["Held Hand-Written"]);
    });

    it("reads only the Target's own cards — a verdict for a card outside it is inert", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts([
                ...GREEN_BOT.cards,
                {
                    name: "Elsewhere",
                    outcome: "frozen",
                    gap: "no-legal-move › x",
                },
            ])
        );
        expect(completion.completed).toBe(true);
    });

    it("names every red clause, in gate order, when several fail", () => {
        const completion = targetCompleted(
            coverage(["r", "p"]),
            verdicts([
                { name: "Ready", outcome: "frozen", gap: "no-legal-move › x" },
                { name: "Grammar Pending", outcome: "unplayable" },
            ])
        );
        expect(completion.failing).toEqual(["playable", "bot-play"]);
        const text = formatCompletion(completion);
        expect(text).toContain("completed: no — playable, bot-play");
        expect(text).toContain(
            "red: playable — 1 card(s) neither ready nor hand-written: Grammar Pending"
        );
        expect(text).toContain("red: bot-play — frozen 1: Ready");
        expect(text).not.toContain("covered by a must Test Position");
    });

    it("a red Target still lists the never-chosen cards a must Test Position covers", () => {
        const completion = targetCompleted(
            coverage(GREEN_IDS),
            verdicts(
                [
                    { name: "Ready", outcome: "ignored", gap: NEVER },
                    {
                        name: "Held Hand-Written",
                        outcome: "frozen",
                        gap: "no-legal-move › x",
                    },
                ],
                ["Ready"]
            )
        );
        expect(formatCompletion(completion)).toContain(
            "never-chosen, covered by a must Test Position (1): Ready"
        );
    });
});

describe("mustCoveredCards — what a `must` Test Position covers", () => {
    const moves = (
        ...matchers: { kind: string; card?: string; cards?: string[] }[]
    ) => ({
        moves: matchers,
    });

    it("takes the cards a must entry's positive expectation plays", () => {
        expect(
            mustCoveredCards([
                {
                    tier: "must",
                    expect: moves({ kind: "cast-spell", card: "Wrath of God" }),
                },
                {
                    tier: "must",
                    expect: moves({
                        kind: "activate-ability",
                        card: "Rishadan Port",
                    }),
                },
                {
                    tier: "must",
                    expect: moves({
                        kind: "play-land",
                        cards: ["Volcanic Island"],
                    }),
                },
            ])
        ).toEqual(
            new Set(["Wrath of God", "Rishadan Port", "Volcanic Island"])
        );
    });

    it("an any-of list covers only the card EVERY alternative plays", () => {
        expect(
            mustCoveredCards([
                {
                    tier: "must",
                    expect: moves(
                        { kind: "cast-spell", card: "A" },
                        { kind: "cast-spell", card: "B" }
                    ),
                },
                {
                    tier: "must",
                    expect: moves(
                        { kind: "cast-spell", card: "C", cards: ["D"] },
                        { kind: "cast-spell", card: "C" }
                    ),
                },
                {
                    tier: "must",
                    expect: moves(
                        { kind: "cast-spell", card: "E" },
                        { kind: "pass" }
                    ),
                },
            ])
        ).toEqual(new Set(["C"]));
    });

    it("ignores a stretch entry, a forbidden or predicate expectation, and a matcher that plays nothing", () => {
        expect(
            mustCoveredCards([
                {
                    tier: "stretch",
                    expect: moves({ kind: "cast-spell", card: "Stretch Card" }),
                },
                { tier: "must", expect: {} },
                {
                    tier: "must",
                    expect: moves(
                        { kind: "pass" },
                        { kind: "declare-blockers", cards: ["Blocker"] },
                        { kind: "submit-target", card: "Target Only" }
                    ),
                },
            ])
        ).toEqual(new Set());
    });
});

describe("oracle:report --targets <id> prints the `completed:` verdict", () => {
    const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
    // `spawnSync` carries its own `timeout`: a blocked worker is a hang
    // vitest's `testTimeout` cannot interrupt.
    function report(...args: string[]): { code: number; out: string } {
        const r = spawnSync("bun", ["scripts/oracle-report.ts", ...args], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 120_000,
        });
        return {
            code: r.status ?? -1,
            out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
        };
    }
    const reportFile = (body: unknown): string => {
        const path = join(mkdtempSync(join(tmpdir(), "bot-reach-")), "r.json");
        writeFileSync(path, JSON.stringify(body));
        return path;
    };
    /** A minimal, well-formed Findings artifact — `header` unread by this
     *  reader, so it is never asserted on here. */
    const findings = (rows: readonly Record<string, unknown>[]): unknown => ({
        generator: "test fixture",
        header: { sha: "0".repeat(40), botHash: "sha256:x", measuredAt: "" },
        targets: ["vintage-cube"],
        findings: rows,
    });

    it("reads the committed report by default — no `--bot-reach` needed (issue #4406)", () => {
        const { code, out } = report("--targets", "vintage-cube");
        expect(code).toBe(0);
        // The real committed artifact measures `vintage-cube` (ADR 0141 §4),
        // so the third clause is never reported as unproved for want of one.
        expect(out).not.toContain("no Bot-play report supplied");
        expect(out).toMatch(/completed: (yes|no)/);
    }, 180_000);

    it("with a report that has verdicts for no card of the Target, every card is unmeasured", () => {
        // A row IS associated with `vintage-cube`, but names no real card of
        // it — every actual card of the Target stays unmeasured.
        const path = reportFile(
            findings([
                {
                    oracleId: "zzz",
                    name: "Not A Real Card",
                    outcome: "ignored",
                    targets: ["vintage-cube"],
                },
            ])
        );
        const { code, out } = report(
            "--targets",
            "vintage-cube",
            "--bot-reach",
            path
        );
        expect(code).toBe(0);
        expect(out).toMatch(/red: bot-play — no classifiable verdict \d+ /);
    }, 180_000);

    it("a report with no verdicts for the named Target says so", () => {
        const path = reportFile(findings([]));
        const { out } = report(
            "--targets",
            "vintage-cube",
            "--bot-reach",
            path
        );
        expect(out).toContain("carries no verdicts for Target `vintage-cube`");
    }, 180_000);

    it("a row with no `targets` array groups into no Target, reported missing, not thrown on", () => {
        const path = reportFile(
            findings([{ oracleId: "x", name: "Weird Row", outcome: "ignored" }])
        );
        const { code, out } = report(
            "--targets",
            "vintage-cube",
            "--bot-reach",
            path
        );
        expect(code).toBe(0);
        expect(out).toContain("carries no verdicts for Target `vintage-cube`");
    }, 180_000);

    it("fails closed on a file that is not a Bot Reach Findings report", () => {
        const path = reportFile({ nope: true });
        const { code, out } = report(
            "--targets",
            "vintage-cube",
            "--bot-reach",
            path
        );
        expect(code).toBe(1);
        expect(out).toContain("has no `findings`");
    }, 180_000);
});
