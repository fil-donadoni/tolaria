// `/admin/bot-findings` — the Cards tab (issue #4176, PRD #4174, ADR 0141).
//
// What a reader of the page must get from a row: the card (image + name), the
// Bot Gap class it is blocked by, that class's prose — the SEEDED text, which
// is the filer's (the parity with the issue body is pinned in
// `gaps-sync.test.ts`) — and who owes the fix. And from the header: measured
// vs total, with the unmeasured hand-written count named.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import BotFindingsCardsPanel from "../bot-findings-cards-panel";
import { findingTraceText, type BotFindingTrace } from "@/lib/botFindings";
import type { FindingLaunchActions } from "@/lib/ai/bot-finding-launch";

const answers: Record<string, unknown> = {};
const onLaunch = vi.fn();
const ACTIONS: FindingLaunchActions = {
    savedScenarios: [],
    launchingId: null,
    onLaunch,
};

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
        botHash: "sha256:25ee",
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
        status: "open",
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
        botHash: "sha256:25ee",
        measuredAt: "2026-09-23T13:17:56.829Z",
        status: "harness-bound",
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

describe("BotFindingsCardsPanel — the Cards tab (issue #4176/#4177)", () => {
    it("states measured vs total and names the unmeasured hand-written count", () => {
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
        const line = document.querySelector("[data-bot-findings-measurement]")!;
        expect(line.textContent).toContain(
            "Measured 644 of 810 cards in premodern-metagame + vintage-cube (166 ship no definition)"
        );
        expect(line.textContent).toContain("1492 hand-written cards");
    });

    it("renders one row per finding: image, name, class, the class's prose and blame", () => {
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
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
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
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

    // Issue #4181 — a page that stays current on its own says plainly when it
    // is not: rows measured under an older Bot are FLAGGED and filterable,
    // never hidden, and each class shows its delta.
    describe("staleness and the class delta (issue #4181)", () => {
        const rowIds = () =>
            [...document.querySelectorAll("[data-bot-finding-row]")].map((el) =>
                el.getAttribute("data-bot-finding-row")
            );

        it("flags nothing while every row was measured under the current Bot", () => {
            render(<BotFindingsCardsPanel actions={ACTIONS} />);
            expect(
                document.querySelector("[data-bot-finding-stale]")
            ).toBeNull();
            expect(
                document.querySelector("[data-bot-findings-stale-banner]")
            ).toBeNull();
        });

        it("flags a row measured under an older Bot, says so in the header, and still renders EVERY row", () => {
            answers.latestMeasurement = {
                ...MEASUREMENT,
                currentBotHash: "sha256:new",
            };
            answers.listFindings = [
                FINDINGS[0],
                { ...FINDINGS[1]!, botHash: "sha256:new" },
            ];
            render(<BotFindingsCardsPanel actions={ACTIONS} />);
            expect(rowIds()).toEqual(["o-grist", "o-spell"]);
            const stale = document.querySelectorAll("[data-bot-finding-stale]");
            expect(stale).toHaveLength(1);
            expect(
                stale[0]!
                    .closest("[data-bot-finding-row]")!
                    .getAttribute("data-bot-finding-row")
            ).toBe("o-grist");
            expect(
                document.querySelector("[data-bot-findings-stale-banner]")!
                    .textContent
            ).toContain("1 of 2 rows were measured under an older Bot");
            // The date the measurement ran is in the header either way.
            expect(
                document.querySelector("[data-bot-findings-measurement]")!
                    .textContent
            ).toContain("2026-09-23T13:17:56.829Z");
        });

        it("filters to stale rows and to current ones — and back to all", () => {
            answers.latestMeasurement = {
                ...MEASUREMENT,
                currentBotHash: "sha256:new",
            };
            answers.listFindings = [
                FINDINGS[0],
                { ...FINDINGS[1]!, botHash: "sha256:new" },
            ];
            render(<BotFindingsCardsPanel actions={ACTIONS} />);
            fireEvent.click(screen.getByRole("radio", { name: "Stale" }));
            expect(rowIds()).toEqual(["o-grist"]);
            fireEvent.click(screen.getByRole("radio", { name: "Current" }));
            expect(rowIds()).toEqual(["o-spell"]);
            fireEvent.click(screen.getByRole("radio", { name: "All" }));
            expect(rowIds()).toEqual(["o-grist", "o-spell"]);
        });

        it("shows each class's cards now against the previous measurement", () => {
            answers.listClasses = [
                { ...CLASSES[0]!, cardCount: 3, previousCardCount: 5 },
                CLASSES[1],
            ];
            render(<BotFindingsCardsPanel actions={ACTIONS} />);
            const delta = (id: string) =>
                document
                    .querySelector(`[data-bot-finding-row="${id}"]`)!
                    .querySelector("[data-bot-finding-class-delta]")!
                    .textContent;
            expect(delta("o-grist")).toBe(
                "3 cards now, 5 at the previous measurement (−2)"
            );
            expect(delta("o-spell")).toBe(
                "1 card now, no earlier measurement to compare"
            );
        });
    });

    it("says so when the deployment was never seeded, rather than rendering nothing", () => {
        answers.listFindings = [];
        answers.listClasses = [];
        answers.latestMeasurement = null;
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
        expect(
            document.querySelector("[data-bot-findings-measurement]")!
                .textContent
        ).toContain("No measurement seeded");
        expect(screen.getByText("No findings on this deployment")).toBeTruthy();
    });

    it("renders a distinct status badge per row (issue #4177)", () => {
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
        const grist = document.querySelector(
            '[data-bot-finding-row="o-grist"]'
        )!;
        expect(
            grist.querySelector('[data-bot-finding-status="open"]')
        ).toBeTruthy();
        const spell = document.querySelector(
            '[data-bot-finding-row="o-spell"]'
        )!;
        expect(
            spell.querySelector('[data-bot-finding-status="harness-bound"]')
        ).toBeTruthy();
    });

    it("narrows the rows by card name, Target List, cause, blame and status (issue #4177)", () => {
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
        expect(screen.getByLabelText("Filter by card name")).toBeTruthy();

        fireEvent.change(screen.getByLabelText("Filter by card name"), {
            target: { value: "grist" },
        });
        expect(
            document.querySelector('[data-bot-finding-row="o-grist"]')
        ).toBeTruthy();
        expect(
            document.querySelector('[data-bot-finding-row="o-spell"]')
        ).toBeNull();

        fireEvent.change(screen.getByLabelText("Filter by card name"), {
            target: { value: "" },
        });
        fireEvent.change(screen.getByLabelText("Filter by status"), {
            target: { value: "harness-bound" },
        });
        expect(
            document.querySelector('[data-bot-finding-row="o-grist"]')
        ).toBeNull();
        expect(
            document.querySelector('[data-bot-finding-row="o-spell"]')
        ).toBeTruthy();
    });
});

describe("BotFindingsCardsPanel — copy and launch (issue #4178)", () => {
    // Real committed blade labels: one plain board, one needing setup steps.
    const PLAIN =
        "symmetric sweep: casts Armageddon when the opponent holds the land surplus and the Bot the board";
    const SETUP =
        "keep mana open: casts Accumulated Knowledge at the opponent's end step";
    const writeText = vi.fn(() => Promise.resolve());

    beforeEach(() => {
        onLaunch.mockClear();
        writeText.mockClear();
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        answers.listFindings = [
            {
                ...FINDINGS[1],
                reproducers: [PLAIN, SETUP, "saved position"],
            },
        ];
        answers.listClasses = [{ ...CLASSES[1], issue: 4400 }];
    });

    const rowOf = () =>
        document.querySelector('[data-bot-finding-row="o-spell"]')!;

    it("a plain-board blade entry and a saved scenario each launch in one click", () => {
        const saved = { _id: "s1", label: "saved position", spec: {} };
        render(
            <BotFindingsCardsPanel
                actions={{ ...ACTIONS, savedScenarios: [saved] }}
            />
        );
        const rows = rowOf().querySelectorAll(
            '[data-bot-finding-reproducer="launch"]'
        );
        expect(rows).toHaveLength(2);
        for (const li of rows)
            fireEvent.click(li.querySelector("[data-bot-finding-launch]")!);
        expect(onLaunch.mock.calls.map(([l]) => l._id)).toEqual([
            `blade:${PLAIN}`,
            "s1",
        ]);
    });

    it("a blade entry with setup steps shows a copy-command and NO launch button", () => {
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
        const li = rowOf().querySelector(
            '[data-bot-finding-reproducer="command"]'
        )!;
        expect(li.textContent).toContain(SETUP);
        expect(li.querySelector("[data-bot-finding-launch]")).toBeNull();
        fireEvent.click(li.querySelector("[data-bot-finding-copy]")!);
        expect(writeText).toHaveBeenCalledWith(
            expect.stringContaining("vitest.blade.config.ts -t '")
        );
    });

    it("the card's copy button puts the /next-issue payload on the clipboard", () => {
        render(<BotFindingsCardsPanel actions={ACTIONS} />);
        fireEvent.click(
            rowOf().querySelector(
                '[aria-label="Copy a Claude Code brief for Mystic Denial"]'
            )!
        );
        expect(writeText).toHaveBeenCalledTimes(1);
        const text = (writeText.mock.calls[0] as unknown as [string])[0];
        expect(text.startsWith("/next-issue 4400\n")).toBe(true);
        expect(text).toContain("Mystic Denial");
    });
});
