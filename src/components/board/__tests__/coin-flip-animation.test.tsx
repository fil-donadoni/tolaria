// CoinFlipAnimation reduced-motion path (#301, CR 705 / ADR 0023). Under
// `prefers-reduced-motion` the coin shows its LANDED face statically (no spin)
// for `FLIP_ANIM_MS`, then auto-acks via `onLanded` — same timing and flow as
// the animated path. We mock `motion/react` so `useReducedMotion` returns true
// and `motion.div` is a plain div (motion's animation lifecycle does not run in
// jsdom).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

let reduceMotion = true;

// Motion-only props React would warn about on a plain DOM element.
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

afterEach(cleanup);
beforeEach(() => {
    reduceMotion = true;
    vi.useFakeTimers();
});

describe("CoinFlipAnimation — reduced motion (#301)", () => {
    it("shows the landed face statically and auto-acks after FLIP_ANIM_MS", () => {
        const onLanded = vi.fn();
        const { getByText } = render(
            <CoinFlipAnimation result={1} face="WIN" onLanded={onLanded} />
        );
        // Static landed face is rendered immediately.
        expect(getByText("WIN")).toBeTruthy();
        // Nothing fires before the hold elapses.
        expect(onLanded).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(FLIP_ANIM_MS);
        });
        // Auto-ack fires exactly once after the same duration as the spin.
        expect(onLanded).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it("renders the LOSE face for a tails result", () => {
        const { getByText } = render(
            <CoinFlipAnimation result={0} face="LOSE" onLanded={vi.fn()} />
        );
        expect(getByText("LOSE")).toBeTruthy();
        vi.useRealTimers();
    });
});
