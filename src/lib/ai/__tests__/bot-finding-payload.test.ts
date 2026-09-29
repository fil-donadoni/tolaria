// The Bot Findings copy-to-session payload (ADR 0141 § 9, issue #4178): both
// branches (class carries an issue / does not), the cause prose read from the
// FILER rather than restated, and one brief per class naming every card.
import { describe, it, expect } from "vitest";
import {
    classPayload,
    findingPayload,
    findingReproducers,
    LOOP_CLOSE_LINE,
} from "../bot-finding-payload";
import type {
    BotFindingClassRow,
    BotFindingMeasurement,
    BotFindingRow,
} from "@/lib/botFindings";
import { botCauseText } from "../../../../scripts/lib/gap-kinds";

const KEY = "never-chosen › Planeswalker › createToken";

function cls(over: Partial<BotFindingClassRow> = {}): BotFindingClassRow {
    return {
        key: KEY,
        cause: "never-chosen",
        blame: "bot",
        // Seeded from the filer, exactly as `bot-findings-seed.ts` does.
        causeText: botCauseText("never-chosen"),
        cardCount: 2,
        targetCounts: [],
        ...over,
    } as BotFindingClassRow;
}

function finding(over: Partial<BotFindingRow> = {}): BotFindingRow {
    return {
        _id: "f-1",
        oracleId: "o-grist",
        source: "sweep",
        name: "Grist, the Hunger Tide",
        targets: ["vintage-cube"],
        outcome: "ignored",
        cause: "never-chosen",
        gap: KEY,
        blame: "bot",
        botHash: "sha256:25ee",
        measuredAt: "2026-09-23T13:17:56.829Z",
        status: "open",
        ...over,
    } as BotFindingRow;
}

const MEASUREMENT = {
    sha: "58d9703667dc",
    botHash: "sha256:25ee",
    measuredAt: "2026-09-23T13:17:56.829Z",
    targets: ["vintage-cube"],
    targetCardCount: 10,
    measuredCount: 9,
    unmeasuredHandWrittenCount: 3,
} as BotFindingMeasurement;

describe("findingPayload", () => {
    it("with an issue: opens with /next-issue N and carries the context the issue cannot", () => {
        const text = findingPayload(
            finding({ reproducers: ["saved position A"] }),
            cls({ issue: 4321, provingEntry: "blade entry X" }),
            MEASUREMENT
        );
        expect(text.startsWith("/next-issue 4321\n")).toBe(true);
        expect(text).toContain("Grist, the Hunger Tide");
        expect(text).toContain("Reproducer: saved position A");
        expect(text).toContain("Reproducer: blade entry X");
        expect(text).toContain("sha 58d9703667dc");
        expect(text).toContain("Bot hash sha256:25ee");
        expect(text.endsWith(LOOP_CLOSE_LINE)).toBe(true);
    });

    it("without an issue: a filing-ready brief, not a /next-issue command", () => {
        const text = findingPayload(finding(), cls(), MEASUREMENT);
        expect(text).not.toContain("/next-issue");
        expect(text).toContain(`\`${KEY}\``);
        expect(text).toContain("Reproducer: none attached.");
        expect(text.endsWith(LOOP_CLOSE_LINE)).toBe(true);
    });

    it("reads the cause prose from the filer module, in the brief", () => {
        const text = findingPayload(finding(), cls(), MEASUREMENT);
        expect(text).toContain(botCauseText("never-chosen"));
    });

    it("includes the search's own evidence for a never-chosen card", () => {
        const text = findingPayload(
            finding({
                trace: { cardMove: "weighed" } as BotFindingRow["trace"],
            }),
            cls({ issue: 1 }),
            MEASUREMENT
        );
        expect(text).toContain("The search weighed its move");
    });

    it("says so when no measurement is seeded, rather than inventing a sha", () => {
        expect(findingPayload(finding(), cls({ issue: 1 }), null)).toContain(
            "Measurement: none seeded"
        );
    });
});

describe("classPayload", () => {
    const cards = [
        finding({ _id: "f-2", oracleId: "o-b", name: "Zed Card" }),
        finding({ _id: "f-1", name: "Alpha Card" }),
        finding({
            _id: "f-3",
            oracleId: "o-c",
            name: "Other Class Card",
            gap: "no-legal-move › X",
        }),
    ];

    it("names every card of the class — and only that class — in ONE brief", () => {
        const text = classPayload(cls({ issue: 7 }), cards, MEASUREMENT);
        expect(text.startsWith("/next-issue 7\n")).toBe(true);
        expect(text).toContain("Cards (2):");
        expect(text.indexOf("Alpha Card")).toBeLessThan(
            text.indexOf("Zed Card")
        );
        expect(text).not.toContain("Other Class Card");
    });

    it("without an issue: filing-ready, with the filer's prose", () => {
        const text = classPayload(cls(), cards, MEASUREMENT);
        expect(text).not.toContain("/next-issue");
        expect(text).toContain(botCauseText("never-chosen"));
        expect(text.endsWith(LOOP_CLOSE_LINE)).toBe(true);
    });
});

describe("findingReproducers", () => {
    it("lists the attached labels first, then the class's proof, without repeats", () => {
        expect(
            findingReproducers(
                { reproducers: ["a", "proof"] },
                { provingEntry: "proof" }
            )
        ).toEqual(["a", "proof"]);
        expect(findingReproducers({}, undefined)).toEqual([]);
    });
});
