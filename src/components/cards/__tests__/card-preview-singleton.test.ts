import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    releasePreview,
    requestOpenPreview,
    resetPreviewSingleton,
} from "../card-preview-singleton";

// The card-preview singleton enforces the one-open-at-a-time rule: opening a
// card's preview closes any other card's open preview. Each card's `close`
// callback doubles as its identity token. Outside-click / Escape dismissal is
// NOT owned here (it moved into each open CardPreview when the model changed
// from hover to click, #332) — this registry is purely the single-active
// invariant.
describe("card-preview singleton (single active preview)", () => {
    beforeEach(() => {
        resetPreviewSingleton();
    });

    it("opening a second preview closes the first", () => {
        const closeA = vi.fn();
        const closeB = vi.fn();

        requestOpenPreview(closeA);
        expect(closeA).not.toHaveBeenCalled();

        // Hovering card B must close card A's preview.
        requestOpenPreview(closeB);
        expect(closeA).toHaveBeenCalledTimes(1);
        expect(closeB).not.toHaveBeenCalled();
    });

    it("re-opening the already-active preview does not close it", () => {
        const closeA = vi.fn();
        requestOpenPreview(closeA);
        // A re-enter from tilt churn re-requests the same preview — no churn.
        requestOpenPreview(closeA);
        expect(closeA).not.toHaveBeenCalled();
    });

    it("release clears the slot for its owner", () => {
        const closeA = vi.fn();
        const closeB = vi.fn();

        requestOpenPreview(closeA);
        // Mouse-out of A.
        releasePreview(closeA);

        // Now opening B must NOT call closeA again (slot already empty).
        requestOpenPreview(closeB);
        expect(closeA).toHaveBeenCalledTimes(0);
    });

    it("release by a non-owner is a no-op", () => {
        const closeA = vi.fn();
        const closeB = vi.fn();

        requestOpenPreview(closeA);
        // B was already closed by A's open; a late release from B must not
        // wipe A's ownership.
        releasePreview(closeB);

        requestOpenPreview(closeB);
        // A still owned the slot, so opening B closes A.
        expect(closeA).toHaveBeenCalledTimes(1);
    });

    it("a stale release after another preview took over does not reopen churn", () => {
        const closeA = vi.fn();
        const closeB = vi.fn();

        requestOpenPreview(closeA);
        requestOpenPreview(closeB); // closes A, B now owns
        closeA.mockClear();

        // A's deferred mouse-out fires late — B already owns the slot, so this
        // must not clear B's ownership.
        releasePreview(closeA);

        const closeC = vi.fn();
        requestOpenPreview(closeC);
        // B still owned, so opening C closes B (not A).
        expect(closeB).toHaveBeenCalledTimes(1);
        expect(closeA).not.toHaveBeenCalled();
    });

    // Self-healing: if stale handles linger (a card slid under a stationary
    // cursor without a pointermove to fire its exit watcher), the next open
    // must sweep EVERY other open preview, not just the most recent.
    it("opening a preview closes ALL other lingering previews", () => {
        // closeA/closeB are stale handles that never released themselves.
        const closeA = vi.fn();
        const closeB = vi.fn();
        const closeC = vi.fn();

        // Simulate two stale previews that never called releasePreview.
        requestOpenPreview(closeA);
        // B's open closes A; A's stale handle stays registered because the fake
        // closeA doesn't release. (In prod, close() calls releasePreview.)
        requestOpenPreview(closeB);
        closeA.mockClear();
        closeB.mockClear();

        requestOpenPreview(closeC);
        expect(closeA).toHaveBeenCalledTimes(1);
        expect(closeB).toHaveBeenCalledTimes(1);
        expect(closeC).not.toHaveBeenCalled();
    });
});
