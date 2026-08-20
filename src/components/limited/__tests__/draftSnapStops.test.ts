// The Draft Room's phone snap model (issue #2588, PRD #2405 slice 9, ADR
// 0101 §6). Pure arithmetic, tested without a layout engine — which is the
// point of extracting it: happy-dom reports every scroller as 0x0, so a test
// that asked a MOUNTED pane where it had scrolled to would assert nothing.
import { describe, it, expect } from "vitest";
import {
    DRAFT_AUTO_SNAP_SECONDS,
    DRAFT_PANE_FRACTION,
    draftPackIdentity,
    draftStopAtOffset,
    draftStopOffset,
    draftStripFraction,
    shouldAutoSnapToPack,
} from "../draft-room/draftSnapStops";

describe("pane + strip sizing (ADR 0101 §6)", () => {
    it("is 85/15 in portrait and 80/20 in landscape, measured on the VIEWPORT", () => {
        expect(DRAFT_PANE_FRACTION.portrait).toBe(0.85);
        expect(DRAFT_PANE_FRACTION.landscape).toBe(0.8);
    });

    it("expresses the strip as a fraction of its PANE, not of the viewport", () => {
        // The band is 15% of the screen but it is drawn INSIDE an 85% pane —
        // a component writing `15%` there would draw 12.75% of the screen.
        expect(
            draftStripFraction("portrait") * DRAFT_PANE_FRACTION.portrait
        ).toBeCloseTo(0.15, 10);
        expect(
            draftStripFraction("landscape") * DRAFT_PANE_FRACTION.landscape
        ).toBeCloseTo(0.2, 10);
    });
});

describe("exactly two stops (issue #2588 AC 1)", () => {
    it("offsets are 0 and the scroller's own maximum — never the pane size", () => {
        // Two 85% panes make 1.7 viewports of content, so the far stop is at
        // 0.7 of a viewport, not 0.85. Deriving it from the element's own max
        // is what keeps that true at any rounding.
        const maxOffset = 0.7 * 844;
        expect(draftStopOffset("pack", maxOffset)).toBe(0);
        expect(draftStopOffset("pool", maxOffset)).toBe(maxOffset);
    });

    it("reads an offset back as the stop it belongs to", () => {
        const max = 590;
        expect(draftStopAtOffset(0, max)).toBe("pack");
        expect(draftStopAtOffset(max, max)).toBe("pool");
    });

    it("flips to the pool EARLY, so the strip's live tab tracks a swipe in flight", () => {
        const max = 590;
        expect(draftStopAtOffset(max * 0.05, max)).toBe("pack");
        expect(draftStopAtOffset(max * 0.2, max)).toBe("pool");
    });

    it("reads an unlaid-out scroller as the pack — the pane the room opens on", () => {
        // Every scroller in happy-dom, and the first paint in a browser.
        expect(draftStopAtOffset(0, 0)).toBe("pack");
        expect(draftStopOffset("pool", 0)).toBe(0);
    });
});

describe("pack-arrival identity (issue #2588 AC 3)", () => {
    const card = (pickId: string) => ({ pickId });

    it("is null with no pack in front of the seat", () => {
        expect(draftPackIdentity([])).toBeNull();
    });

    it("changes when the SAME pack comes back around with cards taken out of its middle", () => {
        // The front card is untouched — a first-`pickId` identity would call
        // this the same pack and never pulse the strip.
        const before = draftPackIdentity([
            card("r0-p0-c0"),
            card("r0-p0-c1"),
            card("r0-p0-c2"),
        ]);
        const after = draftPackIdentity([card("r0-p0-c0"), card("r0-p0-c2")]);
        expect(after).not.toBe(before);
    });

    it("changes between two DIFFERENT packs of the same size", () => {
        // A length-only identity would call these the same pack.
        expect(
            draftPackIdentity([card("r0-p1-c0"), card("r0-p1-c1")])
        ).not.toBe(draftPackIdentity([card("r0-p0-c0"), card("r0-p0-c1")]));
    });

    it("is stable while nothing arrives", () => {
        expect(draftPackIdentity([card("r0-p0-c0")])).toBe(
            draftPackIdentity([card("r0-p0-c0")])
        );
    });
});

describe("auto-snap back to the pack (ADR 0101 §6: only if the timer is on and <10s)", () => {
    const base = {
        stop: "pool" as const,
        hasPack: true,
        pickDeadline: 10_000,
        now: 10_000 - DRAFT_AUTO_SNAP_SECONDS * 1000 + 1,
    };

    it("pulls the player back inside the last ten seconds", () => {
        expect(shouldAutoSnapToPack(base)).toBe(true);
        expect(shouldAutoSnapToPack({ ...base, now: 10_000 - 10_000 })).toBe(
            true
        );
    });

    it("never steals the view with time to spare", () => {
        expect(shouldAutoSnapToPack({ ...base, now: 10_000 - 10_001 })).toBe(
            false
        );
    });

    it("never steals the view on a TIMER-LESS event", () => {
        expect(shouldAutoSnapToPack({ ...base, pickDeadline: null })).toBe(
            false
        );
    });

    it("does nothing once the deadline has passed — the server auto-picks there", () => {
        expect(shouldAutoSnapToPack({ ...base, now: 10_001 })).toBe(false);
    });

    it("does nothing while already on the pack, or with no pack to return to", () => {
        expect(shouldAutoSnapToPack({ ...base, stop: "pack" })).toBe(false);
        expect(shouldAutoSnapToPack({ ...base, hasPack: false })).toBe(false);
    });
});
