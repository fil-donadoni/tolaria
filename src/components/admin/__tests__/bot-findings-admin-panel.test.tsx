// `/admin/bot-findings` — the Cards tab (issue #4176, PRD #4174, ADR 0141).
//
// What a reader of the page must get from a row: the card (image + name), the
// Bot Gap class it is blocked by, that class's prose — the SEEDED text, which
// is the filer's (the parity with the issue body is pinned in
// `gaps-sync.test.ts`) — and who owes the fix. And from the header: measured
// vs total, with the unmeasured hand-written count named.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BotFindingsAdminPanel from "../bot-findings-admin-panel";
import { findingTraceText, type BotFindingTrace } from "@/lib/botFindings";

const answers: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }) => answers[query._name],
}));

vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

const NEVER = "never-chosen › Planeswalker › createToken";
const UNMODELLED = "position-unmodelled › Instant target:spell";

const FINDINGS = [
    {
        _id: "f-1",
        oracleId: "o-grist",
        source: "sweep",
        name: "Grist, the Hunger Tide",
        printId: "print-grist",
        targets: ["vintage-cube"],
        outcome: "ignored",
        cause: "never-chosen",
        gap: NEVER,
        blame: "bot",
        compileSource: "hand-written",
        measuredAt: "2026-09-23T13:17:56.829Z",
        trace: {
            cardMove: "weighed",
            search: {
                mechanism: "mean-reward",
                iterations: 48,
                weighed: 3,
                candidates: [
                    {
                        role: "chosen",
                        label: "Pass",
                        visits: 40,
                        meanReward: 0.5,
                        total: 10,
                        terms: { life: [20, 20], hand: [300, 300] },
                    },
                    {
                        role: "card",
                        label: "Cast Grist, the Hunger Tide",
                        visits: 8,
                        meanReward: 0.3,
                        total: 4,
                        // Cards fewer in hand, nothing gained for them.
                        terms: { life: [20, 20], hand: [200, 300] },
                    },
                ],
            },
        },
    },
    {
        _id: "f-2",
        oracleId: "o-spell",
        source: "sweep",
        name: "Mystic Denial",
        targets: ["premodern-metagame"],
        outcome: "ignored",
        cause: "position-unmodelled",
        gap: UNMODELLED,
        blame: "harness",
        measuredAt: "2026-09-23T13:17:56.829Z",
    },
];

const CLASSES = [
    {
        key: NEVER,
        cause: "never-chosen",
        blame: "bot",
        causeText:
            "**A card the search never picks.** Read the `DecisionTrace` first.",
        cardCount: 1,
        targetCounts: [],
    },
    {
        key: UNMODELLED,
        cause: "position-unmodelled",
        blame: "harness",
        causeText:
            "**A gap in the sweep's harness, not in the Bot's judgement.**",
        cardCount: 1,
        targetCounts: [],
    },
];

const MEASUREMENT = {
    sha: "58d9703667dc",
    botHash: "sha256:25ee",
    measuredAt: "2026-09-23T13:17:56.829Z",
    targets: ["premodern-metagame", "vintage-cube"],
    targetCardCount: 810,
    measuredCount: 644,
    unmeasuredHandWrittenCount: 1492,
};

beforeEach(() => {
    answers.listFindings = FINDINGS;
    answers.listClasses = CLASSES;
    answers.latestMeasurement = MEASUREMENT;
});

describe("BotFindingsAdminPanel — the Cards tab (issue #4176)", () => {
    it("states measured vs total and names the unmeasured hand-written count", () => {
        render(<BotFindingsAdminPanel />);
        const line = document.querySelector("[data-bot-findings-measurement]")!;
        expect(line.textContent).toContain(
            "Measured 644 of 810 cards in premodern-metagame + vintage-cube (166 ship no definition)"
        );
        expect(line.textContent).toContain("1492 hand-written cards");
    });

    it("renders one row per finding: image, name, class, the class's prose and blame", () => {
        render(<BotFindingsAdminPanel />);
        const grist = document.querySelector(
            '[data-bot-finding-row="o-grist"]'
        ) as HTMLElement;
        const row = within(grist);
        expect(row.getByRole("heading", { name: "Grist, the Hunger Tide" }));
        expect(
            row
                .getByRole("img", { name: "Grist, the Hunger Tide" })
                .getAttribute("src")
        ).toContain("print-grist");
        expect(row.getByText(NEVER)).toBeTruthy();
        expect(row.getByText(/Bot owes a fix/)).toBeTruthy();
        // The prose is the seeded class text, markup dropped, words kept.
        const cause = grist.querySelector("[data-bot-finding-cause]")!;
        expect(cause.textContent).toBe(
            "A card the search never picks. Read the DecisionTrace first."
        );
        expect(cause.querySelector("code")!.textContent).toBe("DecisionTrace");

        const spell = within(
            document.querySelector(
                '[data-bot-finding-row="o-spell"]'
            ) as HTMLElement
        );
        expect(
            spell.getByText(/Sweep harness owes a better position/)
        ).toBeTruthy();
        expect(spell.getByText(/A gap in the sweep's harness/)).toBeTruthy();
        expect(spell.queryByRole("img")).toBeNull();
    });

    // Issue #4179 — a refused card answers WHY: the search's decision, the
    // card's own move beside the chosen one, their terms, and the difference
    // in words from the in-game decision box's phrase table.
    it("renders the decision behind a refusal, and only where one was recorded", () => {
        render(<BotFindingsAdminPanel />);
        const grist = document.querySelector(
            '[data-bot-finding-row="o-grist"]'
        ) as HTMLElement;
        const trace = grist.querySelector("[data-bot-finding-trace]")!;
        expect(
            trace.querySelector("[data-bot-finding-card-move]")!.textContent
        ).toBe("The search weighed its move and preferred another.");
        expect(trace.textContent).toContain("48 iterations");
        const chosen = trace.querySelector(
            '[data-bot-finding-trace-role="chosen"]'
        )!;
        const card = trace.querySelector(
            '[data-bot-finding-trace-role="card"]'
        )!;
        expect(chosen.textContent).toContain("Pass");
        expect(chosen.textContent).not.toContain("vs chosen");
        expect(card.textContent).toContain("Cast Grist, the Hunger Tide");
        expect(card.textContent).toContain("vs chosen: spends a card");
        expect(card.textContent).toContain("L20/20 H200/300");

        expect(
            document
                .querySelector('[data-bot-finding-row="o-spell"]')!
                .querySelector("[data-bot-finding-trace]")
        ).toBeNull();
    });

    it("renders the trace as text for the copy-to-session payload", () => {
        const text = findingTraceText(FINDINGS[0]!.trace as BotFindingTrace);
        expect(text.split("\n")).toEqual([
            "The search weighed its move and preferred another.",
            "Search: 48 iterations, 3 root moves weighed, mechanism `mean-reward`: The search preferred it — it won more of the games it played out.",
            "- [chosen] Pass — visits 40, reward 0.5, eval 10",
            "  terms (self/opp): L20/20 H300/300",
            "- [this card] Cast Grist, the Hunger Tide — visits 8, reward 0.3, eval 4; vs chosen: spends a card",
            "  terms (self/opp): L20/20 H200/300",
        ]);
        expect(findingTraceText({ cardMove: "pruned" })).toBe(
            "Its move was pruned before the search: dominance proved using it changes nothing.\nNo search ran: a single move was left to make."
        );
    });

    it("says so when the deployment was never seeded, rather than rendering nothing", () => {
        answers.listFindings = [];
        answers.listClasses = [];
        answers.latestMeasurement = null;
        render(<BotFindingsAdminPanel />);
        expect(
            document.querySelector("[data-bot-findings-measurement]")!
                .textContent
        ).toContain("No measurement seeded");
        expect(screen.getByText("No findings on this deployment")).toBeTruthy();
    });
});
