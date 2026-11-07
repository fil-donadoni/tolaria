// CoinFlipAnimation (#301, #5518; CR 705 / ADR 0023). The coin shows only its
// face: the outcome is the halo + caption, which appear on landing. Click-to-end
// (`skipped`) lands at once; under `prefers-reduced-motion` there is no toss and
// the same FLIP_ANIM_MS pacing elapses before `onLanded`. `motion/react` is
// mocked: motion's animation lifecycle does not run in jsdom.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

let reduceMotion = true;

const MOTION_PROPS = new Set([
    "initial",
    "animate",
    "transition",
    "onAnimationComplete",
]);

vi.mock("motion/react", () => ({
    useReducedMotion: () => reduceMotion,
    motion: new Proxy(
        {},
        {
            get:
                () =>
                (props: {
                    children?: React.ReactNode;
                    [k: string]: unknown;
                }) => {
                    const domProps: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(props)) {
                        if (k === "children" || MOTION_PROPS.has(k)) continue;
                        domProps[k] = v;
                    }
                    return <div {...domProps}>{props.children}</div>;
                },
        }
    ),
}));

import CoinFlipAnimation, {
    FLIP_ANIM_MS,
} from "~/components/board/coin-flip-animation";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});
beforeEach(() => {
    reduceMotion = true;
    vi.useFakeTimers();
});

describe("CoinFlipAnimation (#5518)", () => {
    it("reduced motion: no toss, caption + halo and onLanded only after FLIP_ANIM_MS", () => {
        const onLanded = vi.fn();
        const { getByTestId, queryByTestId } = render(
            <CoinFlipAnimation
                face="heads"
                tone="good"
                caption="You win the flip"
                onLanded={onLanded}
            />
        );
        expect(getByTestId("coin-3d").getAttribute("data-phase")).toBe(
            "tossing"
        );
        expect(queryByTestId("coin-halo")).toBeNull();
        expect(getByTestId("coin-caption").textContent).toBe("");
        expect(onLanded).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(FLIP_ANIM_MS);
        });
        expect(onLanded).toHaveBeenCalledTimes(1);
        expect(getByTestId("coin-3d").getAttribute("data-phase")).toBe(
            "landed"
        );
        expect(getByTestId("coin-halo").getAttribute("data-tone")).toBe("good");
        expect(getByTestId("coin-caption").textContent).toBe(
            "You win the flip"
        );
    });

    it("the lost flip lands on tails with a danger halo", () => {
        const { getByTestId } = render(
            <CoinFlipAnimation
                face="tails"
                tone="bad"
                caption="Bot loses the flip"
                onLanded={vi.fn()}
            />
        );
        act(() => {
            vi.advanceTimersByTime(FLIP_ANIM_MS);
        });
        expect(getByTestId("coin-3d").getAttribute("data-face")).toBe("tails");
        expect(getByTestId("coin-halo").getAttribute("data-tone")).toBe("bad");
        expect(getByTestId("coin-caption").getAttribute("data-tone")).toBe(
            "bad"
        );
    });

    it("skipped lands immediately, exactly once", () => {
        reduceMotion = false;
        const onLanded = vi.fn();
        const { getByTestId, rerender } = render(
            <CoinFlipAnimation
                face="heads"
                tone="good"
                caption="c"
                onLanded={onLanded}
            />
        );
        expect(onLanded).not.toHaveBeenCalled();
        rerender(
            <CoinFlipAnimation
                face="heads"
                tone="good"
                caption="c"
                skipped
                onLanded={onLanded}
            />
        );
        expect(onLanded).toHaveBeenCalledTimes(1);
        expect(getByTestId("coin-3d").getAttribute("data-phase")).toBe(
            "landed"
        );
        act(() => {
            vi.advanceTimersByTime(FLIP_ANIM_MS * 2);
        });
        expect(onLanded).toHaveBeenCalledTimes(1);
    });
});
