/**
 * Whole-Target Bot-play measurement (issue #4149) — the pure half: the
 * per-Target aggregation. The play itself is `playBotReach`, tested where it lives.
 */

import { describe, expect, it } from "vitest";
import {
    blameFor,
    botGapKey,
    botVerdictOf,
    buildFindings,
    definitionHash,
    findingRow,
    findingsCache,
    findingsHeader,
    parseFindings,
    serializeFindings,
    type FindingRow,
    type FindingsHeader,
    type MeasuredVerdict,
} from "../lib/oracle-bot-reach";
import { aggregate, type CardMeasure } from "../target-bot-reach";

describe("aggregate", () => {
    const card = (
        name: string,
        outcome: CardMeasure["outcome"],
        source?: CardMeasure["source"],
        gap?: string
    ): CardMeasure => ({
        name,
        oracleId: name,
        outcome,
        ...(source ? { source } : {}),
        ...(gap ? { gap } : {}),
    });

    it("splits counts by shipped source and ranks gaps by card count", () => {
        const m = aggregate("t", [
            card("A", "played", "hand-written"),
            card("B", "ignored", "hand-written", "never-chosen › x › draw"),
            card("C", "ignored", "compiled", "never-chosen › x › draw"),
            card("D", "frozen", "compiled", "no-progress › y"),
            card("E", "unplayable"),
        ]);
        expect(m.total).toBe(5);
        expect(m.counts.all).toEqual({ played: 1, ignored: 2, frozen: 1 });
        expect(m.counts["hand-written"]).toEqual({
            played: 1,
            ignored: 1,
            frozen: 0,
        });
        expect(m.counts.unplayable).toBe(1);
        expect(m.gaps.map((g) => [g.key, g.cards])).toEqual([
            ["never-chosen › x › draw", ["B", "C"]],
            ["no-progress › y", ["D"]],
        ]);
    });
});

// ── The measurement artifact (ADR 0141 § 4, issue #4175) ──────────────────

const header = (over: Partial<FindingsHeader> = {}): FindingsHeader => ({
    sha: "0".repeat(40),
    botHash: "sha256:bot",
    measuredAt: "2026-09-20T10:00:00.000Z",
    ...over,
});

const row = (over: Partial<FindingRow> = {}): FindingRow =>
    findingRow(
        {
            oracleId: over.oracleId ?? "o-1",
            name: over.name ?? "A",
            targets: over.targets ?? ["premodern-metagame"],
        },
        {
            source: "hand-written",
            defHash: "sha256:def",
            outcome: "ignored",
            cause: "never-chosen",
            form: "instant",
            ...over,
        },
        ["draw"],
        "instant"
    );

describe("findingRow", () => {
    it("records the outcome, the cause, the derived form, the gap, the blame and the source", () => {
        expect(row()).toEqual({
            oracleId: "o-1",
            name: "A",
            targets: ["premodern-metagame"],
            source: "hand-written",
            outcome: "ignored",
            cause: "never-chosen",
            form: "instant",
            gap: "never-chosen › instant › draw",
            blame: "bot",
            defHash: "sha256:def",
        });
    });

    it("keys the gap with the compiler's own helper — the cast shape OVERRIDES the played form", () => {
        const verdict = {
            source: "compiled",
            defHash: "sha256:d",
            outcome: "ignored",
            cause: "never-chosen",
            // What the sweep saw when it played, months and a `botReachForm`
            // edit ago. The key must come from the shape recomputed NOW.
            form: "stale-shape",
        } as const;
        const built = findingRow(
            { oracleId: "o", name: "N", targets: ["t"] },
            verdict,
            ["draw", "destroy"],
            "sorcery"
        );
        expect(built.form).toBe("sorcery");
        expect(built.gap).toBe(
            botGapKey(botVerdictOf(verdict), ["draw", "destroy"], "sorcery")
        );
        expect(built.gap).toBe("never-chosen › sorcery › draw+destroy");
    });

    it("a follow-through cause keeps the verdict's own form, cast shape or not", () => {
        const built = row({ cause: "no-progress", form: "choice:mode" });
        expect(built.form).toBe("choice:mode");
        expect(built.gap).toBe("no-progress › choice:mode");
        expect(built.blame).toBe("harness");
    });

    it("a played or unplayable card carries no gap, no form and no blame", () => {
        const played = row({
            outcome: "played",
            cause: undefined,
            form: undefined,
        });
        expect(played.gap).toBeUndefined();
        expect(played.form).toBeUndefined();
        expect(played.blame).toBeUndefined();
        const none = findingRow(
            { oracleId: "o", name: "N", targets: ["t"] },
            { outcome: "unplayable" },
            []
        );
        expect(none).toEqual({
            oracleId: "o",
            name: "N",
            targets: ["t"],
            outcome: "unplayable",
        });
    });

    it("sorts the targets, so a card's row does not depend on the order the Targets were walked", () => {
        expect(
            row({ targets: ["vintage-cube", "premodern-metagame"] }).targets
        ).toEqual(["premodern-metagame", "vintage-cube"]);
    });
});

describe("blameFor", () => {
    it("splits the causes that judge the Bot from the bounds of the sweep's harness", () => {
        expect(
            Object.fromEntries(
                (
                    [
                        "no-legal-move",
                        "never-chosen",
                        "unanswerable-input",
                        "position-unmodelled",
                        "no-progress",
                        "harness-error",
                    ] as const
                ).map((cause) => [cause, blameFor(cause)])
            )
        ).toEqual({
            "no-legal-move": "bot",
            "never-chosen": "bot",
            "unanswerable-input": "bot",
            "position-unmodelled": "harness",
            "no-progress": "harness",
            "harness-error": "harness",
        });
    });
});

describe("definitionHash", () => {
    it("separates two definitions that differ only in a resolve() body", () => {
        const a = { name: "X", resolve: (): number => 1 };
        const b = { name: "X", resolve: (): number => 2 };
        expect(definitionHash(a)).not.toBe(definitionHash(b));
        expect(definitionHash(a)).toBe(
            definitionHash({ name: "X", resolve: (): number => 1 })
        );
    });
});

describe("buildFindings / serializeFindings", () => {
    const artifact = buildFindings(
        header(),
        ["vintage-cube", "premodern-metagame"],
        [
            row({ oracleId: "o-2", name: "B" }),
            row({ oracleId: "o-1", name: "A" }),
        ]
    );

    it("sorts rows by oracle id and the scope by Target id", () => {
        expect(artifact.findings.map((f) => f.oracleId)).toEqual([
            "o-1",
            "o-2",
        ]);
        expect(artifact.targets).toEqual([
            "premodern-metagame",
            "vintage-cube",
        ]);
    });

    it("writes one row per line and round-trips byte for byte", () => {
        const text = serializeFindings(artifact);
        expect(
            text.split("\n").filter((l) => l.startsWith('        {"oracleId"'))
                .length
        ).toBe(2);
        expect(serializeFindings(parseFindings(text))).toBe(text);
        expect(parseFindings(text).header).toEqual(header());
    });
});

describe("findingsCache", () => {
    const previous = buildFindings(header(), ["t"], [row({ oracleId: "o-1" })]);
    const key = { source: "hand-written", defHash: "sha256:def" } as const;
    const fresh = (): MeasuredVerdict => ({
        ...key,
        outcome: "played",
    });

    it("reuses a verdict when the definition and the Bot hash are unchanged", () => {
        const cache = findingsCache(previous, "sha256:bot");
        expect(cache.verdictFor("o-1", key, fresh)).toEqual({
            ...key,
            outcome: "ignored",
            cause: "never-chosen",
            form: "instant",
        });
        expect(cache.replayed()).toBe(0);
    });

    it("replays the card when the definition changed", () => {
        const cache = findingsCache(previous, "sha256:bot");
        expect(
            cache.verdictFor("o-1", { ...key, defHash: "sha256:other" }, fresh)
        ).toEqual(fresh());
        expect(cache.replayed()).toBe(1);
    });

    it("replays the card when the shipped source changed", () => {
        const cache = findingsCache(previous, "sha256:bot");
        cache.verdictFor("o-1", { ...key, source: "compiled" }, fresh);
        expect(cache.replayed()).toBe(1);
    });

    it("replays EVERY card when the Bot hash changed", () => {
        const cache = findingsCache(previous, "sha256:other-bot");
        expect(cache.verdictFor("o-1", key, fresh)).toEqual(fresh());
        expect(cache.replayed()).toBe(1);
    });

    it("--replay ignores the cache", () => {
        const cache = findingsCache(previous, "sha256:bot", { replay: true });
        expect(cache.verdictFor("o-1", key, fresh)).toEqual(fresh());
        expect(cache.replayed()).toBe(1);
    });

    it("replays a card this tree has never measured", () => {
        const cache = findingsCache(previous, "sha256:bot");
        cache.verdictFor("o-new", key, fresh);
        expect(cache.replayed()).toBe(1);
    });

    it("replays a row whose cause this tree no longer produces", () => {
        const stale = buildFindings(
            header(),
            ["t"],
            [{ ...row({ oracleId: "o-1" }), cause: "bot-blocked" as never }]
        );
        const cache = findingsCache(stale, "sha256:bot");
        expect(cache.verdictFor("o-1", key, fresh)).toEqual(fresh());
        expect(cache.replayed()).toBe(1);
    });

    it("replays a non-played row that carries no cause at all", () => {
        const broken = buildFindings(
            header(),
            ["t"],
            [{ ...row({ oracleId: "o-1" }), cause: undefined }]
        );
        const cache = findingsCache(broken, "sha256:bot");
        expect(cache.verdictFor("o-1", key, fresh)).toEqual(fresh());
        expect(cache.replayed()).toBe(1);
    });

    it("reuses an `unplayable` row — no definition then, none now", () => {
        const none = buildFindings(
            header(),
            ["t"],
            [
                findingRow(
                    { oracleId: "o-1", name: "A", targets: ["t"] },
                    { outcome: "unplayable" },
                    []
                ),
            ]
        );
        const cache = findingsCache(none, "sha256:bot");
        expect(cache.verdictFor("o-1", {}, fresh)).toEqual({
            outcome: "unplayable",
        });
        expect(cache.replayed()).toBe(0);
    });

    it("has no cache at all on a first run", () => {
        const cache = findingsCache(null, "sha256:bot");
        expect(cache.verdictFor("o-1", key, fresh)).toEqual(fresh());
        expect(cache.replayed()).toBe(1);
    });
});

describe("findingsHeader", () => {
    const previous = buildFindings(header(), ["t"], [row()]);
    const now = header({
        sha: "1".repeat(40),
        measuredAt: "2026-09-23T00:00:00.000Z",
    });

    it("keeps the header a run that replayed nothing measured nothing new under", () => {
        expect(findingsHeader(previous, now, 0)).toEqual(header());
    });

    it("stamps a fresh header as soon as one card was replayed", () => {
        expect(findingsHeader(previous, now, 1)).toEqual(now);
    });

    it("stamps a fresh header when the Bot hash moved, replay count or not", () => {
        const otherBot = header({ botHash: "sha256:other-bot" });
        expect(findingsHeader(previous, otherBot, 0)).toEqual(otherBot);
    });

    it("stamps a fresh header on a first run", () => {
        expect(findingsHeader(null, now, 0)).toEqual(now);
    });
});
