import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    afterEach,
    type Mock,
} from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock the leader-line library: it touches real SVG/layout APIs that jsdom
// lacks. We only care that the hook constructs lines and calls position().
const positionSpy = vi.fn();
const setOptionsSpy = vi.fn();
const removeSpy = vi.fn();
const ctorSpy = vi.fn();

vi.mock("leader-line-new", () => ({
    default: class {
        constructor(start: Element, end: Element) {
            ctorSpy(start, end);
        }
        position = positionSpy;
        setOptions = setOptionsSpy;
        remove = removeSpy;
    },
}));

import {
    useLeaderLines,
    repositionLeaderLines,
    LEADER_LINES_REPOSITION_EVENT,
    type ArrowSpec,
} from "../use-leader-lines";

function mountAnchors(): void {
    document.body.innerHTML = `
        <div data-arrow-anchor-stack="s1"></div>
        <div data-arrow-anchor-permanent="p1"></div>
    `;
}

const ARROWS: ArrowSpec[] = [
    {
        key: "s1->permanent:p1",
        sourceSelector: '[data-arrow-anchor-stack="s1"]',
        targetSelector: '[data-arrow-anchor-permanent="p1"]',
    },
];

/** The dynamic import resolves on a microtask; flush it before asserting. */
async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe("useLeaderLines (CR n/a — UI overlay)", () => {
    beforeEach(() => {
        mountAnchors();
        (ctorSpy as Mock).mockClear();
        positionSpy.mockClear();
        setOptionsSpy.mockClear();
        removeSpy.mockClear();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("creates a line for each arrow whose anchors exist", async () => {
        renderHook(() => useLeaderLines(ARROWS));
        await flush();
        expect(ctorSpy).toHaveBeenCalledTimes(1);
    });

    it("repositions lines when the reposition event fires", async () => {
        renderHook(() => useLeaderLines(ARROWS));
        await flush();
        positionSpy.mockClear();

        act(() => {
            window.dispatchEvent(new Event(LEADER_LINES_REPOSITION_EVENT));
        });
        expect(positionSpy).toHaveBeenCalledTimes(1);

        // A second dispatch (e.g. another drag frame) repositions again.
        act(() => repositionLeaderLines());
        expect(positionSpy).toHaveBeenCalledTimes(2);
    });

    it("repositions on window resize too", async () => {
        renderHook(() => useLeaderLines(ARROWS));
        await flush();
        positionSpy.mockClear();

        act(() => window.dispatchEvent(new Event("resize")));
        expect(positionSpy).toHaveBeenCalledTimes(1);
    });

    it("stops repositioning after unmount (no stale listeners)", async () => {
        const { unmount } = renderHook(() => useLeaderLines(ARROWS));
        await flush();
        unmount();
        positionSpy.mockClear();

        act(() => repositionLeaderLines());
        expect(positionSpy).not.toHaveBeenCalled();
    });
});

describe("repositionLeaderLines", () => {
    it("dispatches the reposition event on window", () => {
        const listener = vi.fn();
        window.addEventListener(LEADER_LINES_REPOSITION_EVENT, listener);
        repositionLeaderLines();
        window.removeEventListener(LEADER_LINES_REPOSITION_EVENT, listener);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
