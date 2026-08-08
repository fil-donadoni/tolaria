// Issue #2238: the Pick Timer used to render nothing (no hand-written
// component test existed at all) as a `text-xs` badge indistinguishable from
// its siblings in the meta row. Redesigned as a full-width bar whose fill is
// relative to THIS Pick's own allowance (full at every Pick, empty at
// expiry) and whose drain rate is itself the urgency signal. These tests
// drive the component directly with fake timers — a continuous CSS
// transition is opaque to vitest (jsdom doesn't run it), so the assertions
// exercise the once-a-second JS tick that both full-motion and
// reduced-motion share, and check reduced motion drops the CSS transition
// class rather than freezing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

let reduceMotion = false;
vi.mock("motion/react", () => ({
    useReducedMotion: () => reduceMotion,
}));

import LimitedDraftTimer from "../limited-draft-timer";

function fillEl(container: HTMLElement): HTMLElement {
    return container.querySelector("[data-pick-timer-fill]") as HTMLElement;
}

function readoutText(container: HTMLElement): string {
    return (
        container.querySelector("[data-pick-timer-readout]")?.textContent ?? ""
    );
}

function scaleXOf(el: HTMLElement): number {
    const match = /scaleX\(([\d.]+)\)/.exec(el.style.transform);
    if (!match)
        throw new Error(`no scaleX() on transform: ${el.style.transform}`);
    return Number(match[1]);
}

beforeEach(() => {
    reduceMotion = false;
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("LimitedDraftTimer — absent timer (issue #2238)", () => {
    it("renders nothing and reserves no layout space when pickDeadline is null", () => {
        const { container, queryByRole } = render(
            <LimitedDraftTimer pickDeadline={null} cardsRemaining={15} />
        );
        expect(queryByRole("timer")).toBeNull();
        expect(container.firstChild).toBeNull();
    });
});

describe("LimitedDraftTimer — bar fill relative to THIS Pick's allowance", () => {
    // 15 cards remaining -> 40s allowance (pickTimerSecondsForCardsRemaining).
    it("starts full at the beginning of the Pick", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        expect(scaleXOf(fillEl(container))).toBe(1);
        expect(readoutText(container)).toBe("40s left");
    });

    it("drains proportionally to elapsed time against the 40s allowance, not the schedule max", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        act(() => vi.advanceTimersByTime(10_000));
        expect(scaleXOf(fillEl(container))).toBeCloseTo(0.75, 5);
        expect(readoutText(container)).toBe("30s left");
    });

    it("reads empty and shows the expiry text once the deadline passes", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        act(() => vi.advanceTimersByTime(40_000));
        expect(scaleXOf(fillEl(container))).toBe(0);
        expect(readoutText(container)).toBe("Auto-picking…");
    });

    it("a short Pick (4 cards remaining -> 5s) starts full too — full always means 'just started'", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={5_000} cardsRemaining={4} />
        );
        expect(scaleXOf(fillEl(container))).toBe(1);
        expect(readoutText(container)).toBe("5s left");
    });
});

describe("LimitedDraftTimer — urgent tone at the unchanged 10s threshold", () => {
    it("is NOT urgent just above the threshold", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        act(() => vi.advanceTimersByTime(29_000)); // 11s left
        expect(fillEl(container).className).not.toContain("bg-danger");
        const readout = container.querySelector(
            "[data-pick-timer-readout]"
        ) as HTMLElement;
        expect(readout.className).not.toContain("text-danger");
    });

    it("flips both bar and readout to the danger tone at <=10s left", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        act(() => vi.advanceTimersByTime(30_000)); // exactly 10s left
        expect(fillEl(container).className).toContain("bg-danger");
        const readout = container.querySelector(
            "[data-pick-timer-readout]"
        ) as HTMLElement;
        expect(readout.className).toContain("text-danger-strong");
    });

    it("a Pick whose whole allowance is <=10s is urgent from its first instant (born urgent)", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={5_000} cardsRemaining={4} />
        );
        expect(fillEl(container).className).toContain("bg-danger");
    });
});

describe("LimitedDraftTimer — motion (transform only, never a layout property)", () => {
    it("full motion applies a CSS transition on transform", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        expect(fillEl(container).className).toContain("transition-transform");
    });

    it("reduced motion drops the transition and advances in discrete 1s steps instead — never frozen, never hidden", () => {
        reduceMotion = true;
        const { container } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        expect(fillEl(container).className).not.toContain(
            "transition-transform"
        );
        expect(scaleXOf(fillEl(container))).toBe(1);

        act(() => vi.advanceTimersByTime(1_000));
        expect(scaleXOf(fillEl(container))).toBeCloseTo(39 / 40, 5);

        act(() => vi.advanceTimersByTime(1_000));
        expect(scaleXOf(fillEl(container))).toBeCloseTo(38 / 40, 5);
    });
});

describe("LimitedDraftTimer — accessible live region does not spam every tick", () => {
    it("the role=timer live region text stays put through a run of ticks that don't cross a phase boundary", () => {
        const { getByRole } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        expect(getByRole("timer").textContent).toBe("40s left");
        act(() => vi.advanceTimersByTime(5_000)); // still "normal" phase
        expect(getByRole("timer").textContent).toBe("40s left");
    });

    it("the live region DOES update once the phase actually changes (urgent, then expiry)", () => {
        const { getByRole } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        act(() => vi.advanceTimersByTime(30_000));
        expect(getByRole("timer").textContent).toBe("10s left");
        act(() => vi.advanceTimersByTime(10_000));
        expect(getByRole("timer").textContent).toBe("Auto-picking…");
    });
});
