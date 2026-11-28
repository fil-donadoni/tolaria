// Issue #10973: the controller's centre pill morphs under the cursor ("Pass"
// becomes "Attack with all" / "No Blockers"), so a reflex click aimed at the
// previous action used to fire the new one. The arming guard drops a pointer
// click landing within PRIMARY_ARMING_WINDOW_MS of the pill's identity change.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
    PRIMARY_ARMING_WINDOW_MS,
    isPrimaryClickArmed,
    usePrimaryClickGuard,
} from "../usePrimaryClickGuard";

describe("usePrimaryClickGuard (issue #10973)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function setup(initial: string | undefined) {
        const onClick = vi.fn();
        const hook = renderHook(
            ({ k }: { k: string | undefined }) => usePrimaryClickGuard(k),
            { initialProps: { k: initial } }
        );
        const click = () => hook.result.current(onClick)!();
        return { hook, onClick, click };
    }

    it("honours a click on a pill that has not changed since mount", () => {
        const { onClick, click } = setup("pass");
        click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("drops a click inside the window after the key changes, honours one after it", () => {
        const { hook, onClick, click } = setup("pass");
        hook.rerender({ k: "attack-with-all" });

        vi.advanceTimersByTime(PRIMARY_ARMING_WINDOW_MS - 1);
        click();
        expect(onClick).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("re-arms on a status → action change (waiting → No Blockers)", () => {
        const { hook, onClick, click } = setup(undefined);
        hook.rerender({ k: "confirm-blockers" });
        click();
        expect(onClick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(PRIMARY_ARMING_WINDOW_MS);
        click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("a re-render with the SAME key does not re-arm", () => {
        const { hook, onClick, click } = setup("pass");
        hook.rerender({ k: "pass" });
        click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("passes an absent handler through as absent", () => {
        const { hook } = setup("pass");
        expect(hook.result.current(undefined)).toBeUndefined();
    });

    it("isPrimaryClickArmed: the pure rule", () => {
        expect(isPrimaryClickArmed(null, 0)).toBe(true);
        expect(
            isPrimaryClickArmed(1000, 1000 + PRIMARY_ARMING_WINDOW_MS - 1)
        ).toBe(false);
        expect(isPrimaryClickArmed(1000, 1000 + PRIMARY_ARMING_WINDOW_MS)).toBe(
            true
        );
    });
});
