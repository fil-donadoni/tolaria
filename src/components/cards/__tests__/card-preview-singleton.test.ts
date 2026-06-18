import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    releasePreview,
    requestOpenPreview,
    resetPreviewSingleton,
} from "../card-preview-singleton";

// The card-preview singleton enforces the user-facing rule: hovering a card
// opens its preview and closes any other card's open preview; leaving closes
// it. Each card's `close` callback doubles as its identity token.
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
});
