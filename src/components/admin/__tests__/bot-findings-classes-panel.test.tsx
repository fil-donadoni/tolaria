// `/admin/bot-findings` — the Classes tab (ADR 0141, issue #4177): one row
// per Bot Gap class, ranked by the server, filterable by Target List, cause,
// blame and the Ops/keywords carried in the class key.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BotFindingsClassesPanel from "../bot-findings-classes-panel";
import type { FindingLaunchActions } from "@/lib/ai/bot-finding-launch";

const answers: Record<string, unknown> = {};
const ACTIONS: FindingLaunchActions = {
    savedScenarios: [],
    launchingId: null,
    onLaunch: vi.fn(),
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

const CLASSES = [
    {
        key: "never-chosen › Sorcery › draw",
        cause: "never-chosen",
        blame: "bot",
        causeText: "prose one",
        cardCount: 4,
        targetCounts: [
            { target: "premodern-metagame", count: 4 },
            { target: "vintage-cube", count: 0 },
        ],
        issue: 4279,
        provingEntry: "draw spell payoff",
    },
    {
        key: "position-unmodelled › Instant target:spell",
        cause: "position-unmodelled",
        blame: "harness",
        causeText: "prose two",
        cardCount: 2,
        targetCounts: [
            { target: "premodern-metagame", count: 0 },
            { target: "vintage-cube", count: 2 },
        ],
        provingEntry: undefined,
    },
];

beforeEach(() => {
    answers.listClasses = CLASSES;
    answers.listFindings = [];
    answers.latestMeasurement = null;
});

describe("BotFindingsClassesPanel", () => {
    it("renders one row per class: key, blame, per-Target counts, issue and its proof", () => {
        render(<BotFindingsClassesPanel actions={ACTIONS} />);
        const row = document.querySelector(
            '[data-bot-finding-class-row="never-chosen › Sorcery › draw"]'
        )!;
        expect(row.textContent).toContain("premodern-metagame: 4");
        expect(row.textContent).not.toContain("vintage-cube: 0");
        expect(row.querySelector("a")!.textContent).toBe("issue #4279");
        expect(
            row.querySelector("[data-bot-finding-class-proof]")!.textContent
        ).toBe("proven by: draw spell payoff");

        const other = document.querySelector(
            '[data-bot-finding-class-row="position-unmodelled › Instant target:spell"]'
        )!;
        expect(
            other.querySelector("[data-bot-finding-class-proof]")!.textContent
        ).toBe("no proof yet");
        expect(other.querySelector("a")).toBeNull();
    });

    it("narrows by Target List — requires a positive count on that Target", () => {
        render(<BotFindingsClassesPanel actions={ACTIONS} />);
        fireEvent.change(screen.getByLabelText("Filter by Target List"), {
            target: { value: "vintage-cube" },
        });
        expect(
            document.querySelector(
                '[data-bot-finding-class-row="never-chosen › Sorcery › draw"]'
            )
        ).toBeNull();
        expect(
            document.querySelector(
                '[data-bot-finding-class-row="position-unmodelled › Instant target:spell"]'
            )
        ).toBeTruthy();
    });

    it("narrows by the Ops/keywords substring carried in the class key", () => {
        render(<BotFindingsClassesPanel actions={ACTIONS} />);
        fireEvent.change(
            screen.getByLabelText("Filter by Ops or keywords in the class key"),
            { target: { value: "draw" } }
        );
        expect(
            document.querySelector(
                '[data-bot-finding-class-row="never-chosen › Sorcery › draw"]'
            )
        ).toBeTruthy();
        expect(
            document.querySelector(
                '[data-bot-finding-class-row="position-unmodelled › Instant target:spell"]'
            )
        ).toBeNull();
    });

    it("shows each class's cards now against the previous measurement (issue #4181)", () => {
        answers.listClasses = [
            { ...CLASSES[0]!, previousCardCount: CLASSES[0]!.cardCount + 2 },
            CLASSES[1],
        ];
        render(<BotFindingsClassesPanel actions={ACTIONS} />);
        const deltas = [
            ...document.querySelectorAll("[data-bot-finding-class-delta]"),
        ].map((el) => el.textContent);
        expect(deltas).toHaveLength(2);
        expect(deltas.some((t) => t!.endsWith("(−2)"))).toBe(true);
        expect(
            deltas.some((t) => t!.endsWith("no earlier measurement to compare"))
        ).toBe(true);
    });

    it("says so when the deployment carries no classes", () => {
        answers.listClasses = [];
        render(<BotFindingsClassesPanel actions={ACTIONS} />);
        expect(
            screen.getByText("No Bot Gap classes on this deployment")
        ).toBeTruthy();
    });
});

describe("BotFindingsClassesPanel — copy (issue #4178)", () => {
    it("copying a class yields ONE brief naming every card of that class", () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        const key = CLASSES[0]!.key;
        answers.listFindings = ["Alpha Card", "Beta Card"].map((name, i) => ({
            _id: `f-${i}`,
            oracleId: `o-${i}`,
            name,
            gap: key,
            outcome: "ignored",
            targets: [],
        }));
        answers.latestMeasurement = null;
        render(<BotFindingsClassesPanel actions={ACTIONS} />);
        const row = document.querySelector(
            `[data-bot-finding-class-row="${key}"]`
        )!;
        fireEvent.click(row.querySelector("[data-bot-finding-copy]")!);
        expect(writeText).toHaveBeenCalledTimes(1);
        const text = (writeText.mock.calls[0] as unknown as [string])[0];
        expect(text.startsWith("/next-issue 4279\n")).toBe(true);
        expect(text).toContain("Alpha Card");
        expect(text).toContain("Beta Card");
    });
});
