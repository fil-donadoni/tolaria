// `/admin/verdicts` — the pair filter (issue #4801, PRD #4792, ADR 0148, user
// story 35). The claims worth a DOM: each filter shows exactly its group and
// every filter says how many it holds; an entry names its role and
// Discriminant; opening one rebuilds it cold, beside its pair.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    waitFor,
    within,
} from "@testing-library/react";
import type { PairListEntry, ReviewVerdict } from "@convex/verdictReview";
import VerdictPairList from "../verdict-pair-list";

const pairList = vi.fn();
const openVerdict = vi.fn();

vi.mock("convex/react", () => ({
    useAction: (fn: { _name: string }) =>
        fn._name === "pairList"
            ? pairList
            : fn._name === "openVerdict"
              ? openVerdict
              : vi.fn(),
    useMutation: () => vi.fn(),
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

const D = { kind: "step" as const, detail: "the opponent's end step" };
const id = (c: string) => "v1-" + c.repeat(64);
const KEY = "v1-" + "9".repeat(64);

const ENTRIES: PairListEntry[] = [
    {
        verdictId: id("1"),
        positionKey: KEY,
        kind: "complete-pair",
        role: "anchor",
        discriminant: D,
        answerKind: "forbidden",
        moves: ["cast Lightning Bolt"],
    },
    {
        verdictId: id("2"),
        positionKey: "v1-" + "8".repeat(64),
        kind: "complete-pair",
        role: "half",
        discriminant: D,
        answerKind: "right",
        moves: ["cast Lightning Bolt"],
    },
    {
        verdictId: id("3"),
        positionKey: "v1-" + "7".repeat(64),
        kind: "incomplete",
        discriminant: { kind: "life", detail: "opp life 3" },
        why: 'Conditional Verdict (life: opp life 3) with no right-hand half beside it — "not now" alone is fitted as "never" (ADR 0148)',
        answerKind: "forbidden",
        moves: ["pass"],
    },
    {
        verdictId: id("4"),
        positionKey: "v1-" + "6".repeat(64),
        kind: "absolute",
        answerKind: "forbidden",
        moves: ["play Mountain"],
    },
];

const rows = () => screen.getAllByTestId("verdict-pair-row");
const kinds = () => rows().map((r) => r.getAttribute("data-pair-kind"));

beforeEach(() => {
    pairList.mockReset().mockResolvedValue(ENTRIES);
    openVerdict.mockReset();
});

describe("VerdictPairList", () => {
    it("shows every classified verdict, and a count on each filter", async () => {
        render(<VerdictPairList />);
        await screen.findAllByTestId("verdict-pair-row");
        expect(rows()).toHaveLength(4);
        const group = screen.getByRole("group", {
            name: "Filter verdicts by pair",
        });
        for (const label of [
            "All (4)",
            "Complete pairs (2)",
            "Incomplete Conditional Verdicts (1)",
            "Absolute Verdicts (1)",
        ]) {
            expect(
                within(group).getByRole("button", { name: label })
            ).toBeTruthy();
        }
    });

    it.each([
        ["Complete pairs (2)", ["complete-pair", "complete-pair"]],
        ["Incomplete Conditional Verdicts (1)", ["incomplete"]],
        ["Absolute Verdicts (1)", ["absolute"]],
    ])("the %s filter shows only its group", async (label, expected) => {
        render(<VerdictPairList />);
        await screen.findAllByTestId("verdict-pair-row");
        fireEvent.click(screen.getByRole("button", { name: label }));
        expect(kinds()).toEqual(expected);
    });

    it("names the role, the Discriminant and, for an incomplete one, why", async () => {
        render(<VerdictPairList />);
        await screen.findAllByTestId("verdict-pair-row");
        const [anchor, half, incomplete] = rows();
        expect(anchor.textContent).toContain("Anchor of a complete pair");
        expect(anchor.textContent).toContain("step: the opponent's end step");
        expect(half.textContent).toContain(
            "Right-hand half of a complete pair"
        );
        expect(incomplete.textContent).toContain(
            "Incomplete Conditional Verdict"
        );
        expect(incomplete.textContent).toContain("no right-hand half");
    });

    it("says so when a filter matches nothing", async () => {
        pairList.mockResolvedValue([ENTRIES[3]]);
        render(<VerdictPairList />);
        await screen.findAllByTestId("verdict-pair-row");
        fireEvent.click(
            screen.getByRole("button", { name: "Complete pairs (0)" })
        );
        expect(
            screen.getByText("No verdict matches this filter.")
        ).toBeTruthy();
    });

    it("opens an entry cold, beside its pair", async () => {
        const opened: ReviewVerdict = {
            verdictId: id("1"),
            positionKey: KEY,
            judgement: {
                spec: { cards: [{ name: "Mountain", owner: "me" }] },
                seat: "me",
                candidates: [
                    { key: "pass", description: "pass" },
                    { key: "bolt", description: "cast Lightning Bolt" },
                ],
                answer: { kind: "forbidden", forbiddenIndexes: [1] },
                classification: { kind: "conditional", discriminant: D },
            },
            attestations: [],
            pair: { role: "anchor", discriminant: D, anchor: null, halves: [] },
        };
        openVerdict.mockResolvedValue(opened);
        render(<VerdictPairList />);
        await screen.findAllByTestId("verdict-pair-row");
        fireEvent.click(
            within(rows()[0]).getByRole("button", { name: "Open" })
        );
        await waitFor(() =>
            expect(openVerdict).toHaveBeenCalledWith({ verdictId: id("1") })
        );
        expect(await screen.findByTestId("verdict-pair-context")).toBeTruthy();
    });
});
