// Phase stops Settings section (issue #2595) — THE load-bearing contract:
// "phase stops edited here equal the board pod's (same store)". This file
// proves it three ways, from weakest to strongest:
//   1. A toggle in Settings lands in the real `localStorage` key the board
//      pod's store uses (`SKIP_PREFS_KEY`), verified via the raw storage API
//      — no shared code path involved, so this can't be fooled by both sides
//      accidentally sharing a bug.
//   2. `loadSkipPrefs()` — the exact function `useSkipPhasePrefsState` calls
//      to initialize — reflects the toggle.
//   3. A FRESH `useSkipPhasePrefsState()` mount (a stand-in for the board
//      pod's own provider instance, e.g. `board.tsx`), created strictly
//      AFTER the Settings toggle, boots with the toggled value — i.e. a
//      player who edits a phase stop in Settings and then starts/resumes a
//      game sees the same stop, without any explicit sync code.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import SettingsPhaseStopsSection from "../settings-phase-stops-section";
import { useSkipPhasePrefsState } from "~/hooks/useSkipPhasePreferences";
import {
    DEFAULT_SKIP_PREFS,
    SKIP_PREFS_KEY,
    loadSkipPrefs,
} from "~/lib/skip-phase-prefs";

// The real stop dot renders a Base UI Tooltip — irrelevant to the store
// contract and flaky in jsdom/happy-dom. Stood in with a plain button that
// surfaces the aria-label + click, same substitution
// `controller-phase-list.test.tsx` uses for the identical component.
vi.mock("~/components/board/phase-stop-dot", () => ({
    default: ({
        active,
        onClick,
        ariaLabel,
    }: {
        active: boolean;
        onClick: () => void;
        ariaLabel: string;
    }) => (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
        />
    ),
}));

/** A stand-in for a board-pod provider instance (`board.tsx` /
 *  `manual-board-view.tsx` both do exactly this: `useSkipPhasePrefsState()`
 *  called fresh, with no relation to the Settings page's own instance other
 *  than the shared `localStorage` key). Exposes what it booted with via a
 *  data attribute so the test can assert on it without any extra plumbing. */
function BoardPodStandIn() {
    const { prefs } = useSkipPhasePrefsState();
    return (
        <div
            data-testid="board-pod-stand-in"
            data-upkeep-self={String(prefs.UPKEEP?.self)}
        />
    );
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe("SettingsPhaseStopsSection — same store as the board pod", () => {
    it("toggling a stop writes the exact localStorage key the board pod's store reads", () => {
        const { getByRole } = render(<SettingsPhaseStopsSection />);

        // UPKEEP defaults to { self: true, opponent: true } (auto-pass) —
        // ControllerPhaseRow's "stop" dot is active when NOT skipped, so it
        // starts inactive here.
        const youUpkeepStop = getByRole("button", {
            name: /stop on my turn \(upkeep\)/i,
        });
        // jest-dom's `toHaveAttribute` isn't type-checked in this project
        // (`tsconfig.app.json`'s restricted `types` array — see
        // `draft-lab-term-breakdown.test.tsx`), so this reads the native
        // attribute directly.
        expect(youUpkeepStop.getAttribute("aria-pressed")).toBe("false");

        fireEvent.click(youUpkeepStop);

        expect(youUpkeepStop.getAttribute("aria-pressed")).toBe("true");

        // 1. Raw storage — bypasses every helper.
        const raw = JSON.parse(localStorage.getItem(SKIP_PREFS_KEY)!);
        expect(raw.UPKEEP).toEqual({ self: false, opponent: true });

        // 2. The exact loader `useSkipPhasePrefsState` initializes from.
        expect(loadSkipPrefs().UPKEEP).toEqual({
            self: false,
            opponent: true,
        });
    });

    it("a fresh board-pod-shaped provider mounted AFTER the Settings toggle boots with the same value", () => {
        const { getByRole } = render(<SettingsPhaseStopsSection />);
        fireEvent.click(
            getByRole("button", { name: /stop on my turn \(upkeep\)/i })
        );

        // The default is self:true (auto-pass); after the toggle it's false.
        expect(DEFAULT_SKIP_PREFS.UPKEEP).toEqual({
            self: true,
            opponent: true,
        });

        const { getByTestId } = render(<BoardPodStandIn />);
        expect(
            getByTestId("board-pod-stand-in").getAttribute("data-upkeep-self")
        ).toBe("false");
    });

    it("Reset to defaults restores what a fresh board-pod mount boots with", () => {
        const { getByRole } = render(<SettingsPhaseStopsSection />);
        fireEvent.click(
            getByRole("button", { name: /stop on my turn \(upkeep\)/i })
        );
        expect(loadSkipPrefs().UPKEEP?.self).toBe(false);

        fireEvent.click(getByRole("button", { name: /reset to defaults/i }));

        expect(loadSkipPrefs()).toEqual(DEFAULT_SKIP_PREFS);

        const { getByTestId } = render(<BoardPodStandIn />);
        expect(
            getByTestId("board-pod-stand-in").getAttribute("data-upkeep-self")
        ).toBe("true");
    });

    it("cross-tab sync: a write from elsewhere to the same key resyncs an already-mounted board-pod-shaped consumer", () => {
        const { getByTestId } = render(<BoardPodStandIn />);
        expect(
            getByTestId("board-pod-stand-in").getAttribute("data-upkeep-self")
        ).toBe("true");

        // Simulate the Settings page's write landing (localStorage.setItem in
        // the SAME tab doesn't fire "storage" — that only fires cross-document
        // — so this dispatches the event by hand, exactly like a second tab
        // would, to prove the listener `useSkipPhasePrefsState` installs
        // (`src/hooks/useSkipPhasePreferences.ts`) actually resyncs).
        const next = {
            ...DEFAULT_SKIP_PREFS,
            UPKEEP: { self: false, opponent: true },
        };
        localStorage.setItem(SKIP_PREFS_KEY, JSON.stringify(next));
        act(() => {
            window.dispatchEvent(
                new StorageEvent("storage", {
                    key: SKIP_PREFS_KEY,
                    newValue: JSON.stringify(next),
                })
            );
        });

        expect(
            getByTestId("board-pod-stand-in").getAttribute("data-upkeep-self")
        ).toBe("false");
    });
});
