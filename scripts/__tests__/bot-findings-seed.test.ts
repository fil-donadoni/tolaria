// The Bot Findings seed payload (ADR 0141 § 4, issue #4176): which artifact
// rows become findings, one class per Bot Gap key with the filer's prose and
// claimed issue, and the measured-vs-total numbers the page states.
import { describe, expect, it } from "vitest";
import {
    buildBotFindingsPayload,
    handWrittenPrintIds,
} from "../lib/bot-findings-seed";
import { botCauseText } from "../lib/gap-kinds";
import type { FindingsArtifact } from "../lib/oracle-bot-reach";

const NEVER = "never-chosen › Creature › (no Ops)";
const UNMODELLED = "position-unmodelled › Instant target:spell";

const ARTIFACT: FindingsArtifact = {
    generator: "test",
    header: {
        sha: "sha-1",
        botHash: "bot-1",
        measuredAt: "2026-09-23T00:00:00Z",
    },
    targets: ["cube", "premodern"],
    findings: [
        {
            oracleId: "o-played",
            name: "Played",
            targets: ["cube"],
            source: "hand-written",
            outcome: "played",
        },
        {
            oracleId: "o-none",
            name: "No Definition",
            targets: ["premodern"],
            outcome: "unplayable",
        },
        {
            oracleId: "o-a",
            name: "Alpha",
            targets: ["cube", "premodern"],
            source: "hand-written",
            outcome: "ignored",
            cause: "never-chosen",
            form: "Creature",
            gap: NEVER,
            blame: "bot",
        },
        {
            oracleId: "o-b",
            name: "Beta",
            targets: ["cube"],
            source: "compiled",
            outcome: "frozen",
            cause: "never-chosen",
            form: "Creature",
            gap: NEVER,
            blame: "bot",
        },
        {
            oracleId: "o-c",
            name: "Gamma",
            targets: ["premodern"],
            source: "hand-written",
            outcome: "ignored",
            cause: "position-unmodelled",
            form: "Instant target:spell",
            gap: UNMODELLED,
            blame: "harness",
        },
    ],
};

function payload() {
    return buildBotFindingsPayload({
        artifact: ARTIFACT,
        claims: [
            { kind: "bot", key: NEVER, issue: 4279 },
            // A claim of another kind on the same text is not this class's.
            { kind: "grammar", key: UNMODELLED, issue: 9999 },
        ],
        cardIndex: [
            { oracleId: "o-a", firstPrintId: "p-a" },
            { oracleId: "o-c", firstPrintId: "p-c" },
        ],
        handWritten: new Set(["o-played", "o-a", "o-c", "o-far-1", "o-far-2"]),
    });
}

describe("buildBotFindingsPayload (issue #4176)", () => {
    it("makes a finding of every non-played, playable row — played by id, unplayable not at all", () => {
        const p = payload();
        expect(p.findings.map((f) => f.oracleId)).toEqual([
            "o-a",
            "o-b",
            "o-c",
        ]);
        expect(p.played).toEqual(["o-played"]);
        const alpha = p.findings[0]!;
        expect(alpha).toEqual({
            oracleId: "o-a",
            name: "Alpha",
            printId: "p-a",
            targets: ["cube", "premodern"],
            outcome: "ignored",
            cause: "never-chosen",
            form: "Creature",
            gap: NEVER,
            blame: "bot",
            compileSource: "hand-written",
        });
        expect(p.findings[1]!.printId).toBeUndefined();
    });

    it("builds one class per key, with the filer's prose, per-Target counts and the bot claim's issue", () => {
        const [never, unmodelled] = payload().classes;
        expect(never).toEqual({
            key: NEVER,
            cause: "never-chosen",
            blame: "bot",
            causeText: botCauseText("never-chosen"),
            cardCount: 2,
            targetCounts: [
                { target: "cube", count: 2 },
                { target: "premodern", count: 1 },
            ],
            issue: 4279,
        });
        expect(unmodelled!.blame).toBe("harness");
        expect(unmodelled!.causeText).toBe(botCauseText("position-unmodelled"));
        expect(unmodelled!.issue).toBeUndefined();
    });

    it("states measured vs total, and the hand-written cards no Target measures", () => {
        expect(payload().measurement).toEqual({
            sha: "sha-1",
            botHash: "bot-1",
            measuredAt: "2026-09-23T00:00:00Z",
            targets: ["cube", "premodern"],
            targetCardCount: 5,
            measuredCount: 4,
            unmeasuredHandWrittenCount: 2,
        });
    });
});

describe("handWrittenPrintIds — the sweep's hand-written join", () => {
    it("joins a non-compiled index row to a registered definition through its first print", () => {
        const joined = handWrittenPrintIds(
            [
                { oracleId: "o-1", firstPrintId: "p-1" },
                { oracleId: "o-2", firstPrintId: "p-2", source: "compiled" },
                { oracleId: "o-3", firstPrintId: "p-3" },
            ],
            ["p-1", "p-2", "p-9"]
        );
        expect([...joined]).toEqual([["o-1", "p-1"]]);
    });
});
