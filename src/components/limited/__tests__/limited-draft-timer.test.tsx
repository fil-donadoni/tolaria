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
        // The READOUT (and, below, the fraction it stands for) is the TRUE
        // remaining time — 30s / 40s = 0.75. The BAR's `scaleX` TARGET,
        // however, is one tick further ahead (issue #2238 fixup round 2,
        // blocking finding #2 — see the component's comment on
        // `barRemainingMs`): 29s / 40s = 0.725. In a real browser the 1s CSS
        // transition then interpolates from the previous tick's target to
        // this one over the following second, landing exactly on the true
        // curve instead of a uniform tick behind it. jsdom never runs that
        // transition, so this assertion proves the TARGET is correct — it
        // cannot prove what a real browser paints mid-transition.
        expect(scaleXOf(fillEl(container))).toBeCloseTo(0.725, 5);
        expect(readoutText(container)).toBe("30s left");
    });

    it("(bug-fix, blocking finding #2) targets one tick further ahead than the true remaining time once ticking, so a real browser's transition arrives in sync instead of trailing a uniform 1s behind", () => {
        const { container } = render(
            <LimitedDraftTimer pickDeadline={5_000} cardsRemaining={4} />
        );
        // Before any tick has fired, the bar is NOT projected ahead — it
        // reads the true fraction (1, full) so a fresh Pick still starts
        // full.
        expect(scaleXOf(fillEl(container))).toBe(1);
        act(() => vi.advanceTimersByTime(1_000)); // one tick: 4s of true time left
        // True remaining is 4s (0.8 of the 5s allowance). The bar's target
        // is one tick further ahead: 3s / 5s = 0.6.
        expect(scaleXOf(fillEl(container))).toBeCloseTo(0.6, 5);
        expect(readoutText(container)).toBe("4s left");
        act(() => vi.advanceTimersByTime(3_000)); // 3 more ticks: true time now 1s left
        // barRemainingMs = max(0, 1000 - 1000) = 0 -> the bar reaches EMPTY
        // one tick before the readout says "Auto-picking…" is due — this is
        // the fix: in a real browser the transition toward 0 completes
        // exactly at the true deadline, instead of the bar still reading
        // ~20% full when the Auto-Pick actually fires.
        expect(scaleXOf(fillEl(container))).toBe(0);
        expect(readoutText(container)).toBe("1s left");
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

    it("(bug-fix, blocking finding #1) re-syncs the live region when a NEW PICK starts even if the phase doesn't change across the boundary — catches the frozen-across-picks case, not just a phase transition", () => {
        // Pick A: 15 cards remaining (40s allowance) — starts "normal".
        const { container, getByRole, rerender } = render(
            <LimitedDraftTimer pickDeadline={40_000} cardsRemaining={15} />
        );
        act(() => vi.advanceTimersByTime(32_000)); // 8s left -> enters "urgent"
        expect(getByRole("timer").textContent).toBe("8s left");

        // Pick B starts right away: 4 cards remaining -> a fresh 5s
        // allowance, born "urgent" (5s <= URGENT_THRESHOLD_SECONDS). The
        // PHASE stays "urgent" across this boundary (urgent -> urgent), so a
        // fix that re-syncs only on a phase change would never fire here —
        // this is exactly the schedule's ≤10s-allowance run at 6/5/4/3/2
        // cards remaining (picks 10-14 of a 15-card Booster), which is
        // "most cards spent below the urgent threshold, most of every
        // Booster". The live region must still report Pick B's own fresh
        // 5s, not Pick A's stale "8s left".
        rerender(
            <LimitedDraftTimer pickDeadline={37_000} cardsRemaining={4} />
        );
        expect(readoutText(container)).toBe("5s left"); // the visible readout is always correct
        expect(getByRole("timer").textContent).toBe("5s left"); // and now the live region matches it
    });
});
