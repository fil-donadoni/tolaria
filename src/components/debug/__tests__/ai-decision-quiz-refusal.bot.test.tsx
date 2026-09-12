// The refusal a tester actually reads (issue #3457, PRD #3397).
//
// One render per refusal KIND — the frozen vocabulary the lowering refuses
// with plus the two sites only the browser has — because the whole point of
// the slice is that three refusals in a row are TELLABLE APART at a glance.
// Driven through the component, never through the record: a title read off
// `QUIZ_REFUSALS` in the test and asserted against itself would pass on a
// panel that renders nothing.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    render,
    cleanup,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";

import {
    QUIZ_REFUSAL_KINDS,
    QUIZ_REFUSALS,
    quizRefusal,
} from "~/lib/ai/verdict-quiz";
import AiDecisionQuizRefusal from "../ai-decision-quiz-refusal";

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

beforeEach(() => {
    cleanup();
    writeText.mockClear();
    // The clipboard is the assertion surface for Copy, and happy-dom has none
    // — so it is stubbed on the navigator the component will actually read.
    Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
        writable: true,
    });
});

describe("a verdict-quiz refusal, rendered (issue #3457)", () => {
    for (const kind of QUIZ_REFUSAL_KINDS) {
        it(`titles a "${kind}" refusal and shows its detail`, () => {
            render(
                <AiDecisionQuizRefusal
                    refusal={quizRefusal(kind, `why ${kind} happened`, [
                        "a dropped note",
                    ])}
                    decision={{ id: 12, seq: 99 }}
                    onClose={() => {}}
                />
            );

            // The KIND, as one recognisable line — and it is the kind's own
            // title, not a neighbour's.
            const title = screen.getByTestId("quiz-refusal-title");
            expect(title.textContent).toBe(QUIZ_REFUSALS[kind].title);
            expect(title.getAttribute("data-refusal-kind")).toBe(kind);
            // The prose is still there, underneath rather than instead.
            expect(screen.getByText(`why ${kind} happened`)).toBeTruthy();
        });
    }

    it("renders the dropped notes as a LIST, behind a disclosure closed by default", () => {
        render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal("different-decision", "the detail", [
                    "first note",
                    "second note",
                    "third note",
                ])}
                decision={{ id: 12 }}
                onClose={() => {}}
            />
        );

        // CLOSED: a real capture runs to twenty-odd entries, and open by
        // default they push Close off the sheet.
        const disclosure = screen.getByText(/Not captured in this position/)
            .parentElement as HTMLDetailsElement;
        expect(disclosure.tagName).toBe("DETAILS");
        expect(disclosure.open).toBe(false);
        expect(
            screen.getByText(/Not captured in this position/).textContent
        ).toContain("3");

        // One note per line — never the semicolon run-on inside a sentence
        // this slice replaced.
        const notes = disclosure.querySelectorAll("li");
        expect([...notes].map((li) => li.textContent)).toEqual([
            "first note",
            "second note",
            "third note",
        ]);
    });

    it("shows no disclosure at all when the refusal dropped nothing", () => {
        render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal("stack-not-journalled", "the detail")}
                decision={{ id: 12 }}
                onClose={() => {}}
            />
        );
        expect(screen.queryByText(/Not captured in this position/)).toBe(null);
    });

    it("copies kind, title, detail, every dropped note and the decision's identity", async () => {
        render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal("pick-not-offered", "the detail", [
                    "first note",
                    "second note",
                ])}
                decision={{ id: 12, seq: 4242 }}
                onClose={() => {}}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Copy refusal" }));

        expect(writeText).toHaveBeenCalledTimes(1);
        const text = writeText.mock.calls[0][0];
        // And the receipt only appears once the write RESOLVED.
        await screen.findByRole("button", { name: "Copied!" });
        expect(text).toContain("verdict quiz refusal: pick-not-offered");
        expect(text).toContain(QUIZ_REFUSALS["pick-not-offered"].title);
        expect(text).toContain("the detail");
        expect(text).toContain("decision #12 at seq 4242");
        expect(text).toContain("- first note");
        expect(text).toContain("- second note");
    });

    it("does not claim a copy the clipboard refused", async () => {
        // An insecure context or a denied permission rejects; "Copied!" over an
        // empty clipboard is the one failure a tester cannot see (PR review).
        writeText.mockRejectedValueOnce(new Error("denied"));
        render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal("stack-not-journalled", "the detail")}
                decision={{ id: 12 }}
                onClose={() => {}}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: "Copy refusal" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("button", { name: "Copied!" })).toBe(null);
        expect(
            screen.getByRole("button", { name: "Copy refusal" })
        ).toBeTruthy();
    });

    it("names the tracking issue for a refusal whose cause is one known spec gap", () => {
        render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal("combat-not-captured", "the detail")}
                decision={{ id: 12 }}
                onClose={() => {}}
            />
        );
        expect(screen.getByText(/tracked by issue #3458/)).toBeTruthy();
    });

    it("leaves Close outside the scrolling prose, so it is reachable however long the drop list is", () => {
        // The height bound, asserted structurally because happy-dom has no
        // layout: the notes scroll inside their own box and the buttons are
        // siblings of it, never inside it (#3457 acceptance).
        const { container } = render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal(
                    "different-decision",
                    "the detail",
                    Array.from({ length: 24 }, (_, i) => `note ${i}`)
                )}
                decision={{ id: 12 }}
                onClose={() => {}}
            />
        );

        // The MAX-HEIGHT is the bound: an `overflow-y-auto` with no ceiling
        // never scrolls, it just grows (PR review, issue #3457).
        const scroller = container.querySelector(
            ".max-h-\\[40vh\\].overflow-y-auto"
        );
        expect(scroller).toBeTruthy();
        const close = screen.getByRole("button", { name: "Close" });
        expect(scroller!.contains(close)).toBe(false);
    });

    it("closes on Close", () => {
        const onClose = vi.fn();
        render(
            <AiDecisionQuizRefusal
                refusal={quizRefusal("position-not-held", "gone")}
                decision={{ id: 12 }}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
