import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardImage from "../card-image";

const CARD_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

/**
 * A devicePixelRatio change with NO slot resize re-derives the floor (issue
 * #6940): the window dragged from a 1x to a 2x display, or the browser
 * zoomed. happy-dom has no displays, so the change is the one signal a real
 * browser gives — the `change` event of a `(resolution: Ndppx)` media query
 * pinned to the ratio at arm time — fired by hand against a captured listener.
 */

type Listener = () => void;

function stubEnvironment(width: number, dpr: number) {
    const originalWidth = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "offsetWidth"
    );
    const originalDpr = window.devicePixelRatio;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get: () => width,
    });
    const setDpr = (value: number) =>
        Object.defineProperty(window, "devicePixelRatio", {
            configurable: true,
            value,
        });
    setDpr(dpr);
    const queries: { media: string; listeners: Set<Listener> }[] = [];
    window.matchMedia = ((media: string) => {
        const listeners = new Set<Listener>();
        queries.push({ media, listeners });
        return {
            media,
            matches: true,
            addEventListener: (_: string, l: Listener) => listeners.add(l),
            removeEventListener: (_: string, l: Listener) =>
                listeners.delete(l),
        } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    const restore = () => {
        if (originalWidth)
            Object.defineProperty(
                HTMLElement.prototype,
                "offsetWidth",
                originalWidth
            );
        else
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)
                .offsetWidth;
        setDpr(originalDpr);
        window.matchMedia = originalMatchMedia;
    };
    return { queries, setDpr, restore };
}

describe("CardImage re-derives its floor on a devicePixelRatio change (issue #6940)", () => {
    let restore: (() => void) | null = null;
    beforeEach(() => cleanup());
    afterEach(() => {
        restore?.();
        restore = null;
    });

    it("arms a media query on the current ratio and drops thumb once the ratio doubles, with no resize", () => {
        const env = stubEnvironment(100, 1);
        restore = env.restore;
        const { container } = render(<CardImage card={{ id: CARD_ID }} />);
        const img = () => container.querySelector("img")!;
        // 100 CSS px at 1x → declared 112px, 112 device px ≤ 146: thumb stays.
        expect(img().getAttribute("sizes")).toBe("112px");
        expect(img().getAttribute("srcset")).toContain("/thumb/");
        const armed = env.queries.filter((q) => q.listeners.size > 0);
        expect(armed.map((q) => q.media)).toEqual(["(resolution: 1dppx)"]);

        env.setDpr(2);
        act(() => {
            for (const l of [...armed[0].listeners]) l();
        });
        // Same 112px slot, 224 device px > 146: thumb is no longer a candidate.
        expect(img().getAttribute("sizes")).toBe("112px");
        expect(img().getAttribute("srcset")).not.toContain("/thumb/");
        // Re-armed on the new ratio, so the drag back is seen too.
        const rearmed = env.queries.filter((q) => q.listeners.size > 0);
        expect(rearmed.map((q) => q.media)).toEqual(["(resolution: 2dppx)"]);
    });

    it("stops listening on unmount", () => {
        const env = stubEnvironment(100, 1);
        restore = env.restore;
        const { unmount } = render(<CardImage card={{ id: CARD_ID }} />);
        expect(env.queries.some((q) => q.listeners.size > 0)).toBe(true);
        unmount();
        expect(env.queries.some((q) => q.listeners.size > 0)).toBe(false);
    });
});
