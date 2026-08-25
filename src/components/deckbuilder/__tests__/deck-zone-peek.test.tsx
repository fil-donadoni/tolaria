// `DeckZonePeek` (issue #2584) — the deckbuilder's Peek Panel / Inspect
// Overlay pairing, and (issue #2667) the SAME component the Draft Room's Pool
// and Sideboard now reuse byte-for-byte rather than a second copy of the
// CTA-appending logic. This file only had catalogue-wide coverage through its
// two callers (`deck-zones-surface.tsx`, `limited-draft-table.tsx`) — no test
// exercised the component directly, which is how `inspectTapAnywhereCloses`
// (added by #2667, forwarded to `InspectOverlay`'s own `tapAnywhereCloses` at
// `deck-zone-peek.tsx:134`) shipped with 351 deckbuilder tests + 31 draft
// table tests staying green even with the forwarding deleted entirely (review
// finding, PR #2797 round 1). Pins the divergence directly: the deckbuilder's
// own overlay must NOT tap-anywhere-close (issue #2584's original contract —
// the player is reading, nothing should whisk it away), while the Draft
// Room's must (PRD #2405 D15, issue #2667) — same component, two callers,
// opposite defaults.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import DeckZonePeek from "../deck-zone-peek";
import type { DeckZoneSelection } from "../deckZoneSelection";

afterEach(() => cleanup());

const BOLT: DeckZoneSelection = {
    zone: "maindeck",
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // Lightning Bolt
    cardName: "Lightning Bolt",
    pinKey: "0",
    tileKey: "0",
    columns: [],
};

const inspectPanel = () =>
    document.querySelector("[data-inspect-panel]") as HTMLElement;

describe("DeckZonePeek inspectTapAnywhereCloses forwarding (issue #2667)", () => {
    it("off by default (the deckbuilder's own read): a tap inside the Inspect Overlay does NOT close it", () => {
        const onCloseInspect = vi.fn();
        render(
            <DeckZonePeek
                selection={null}
                onClose={() => {}}
                actions={[]}
                inspecting={BOLT}
                inspectActions={[]}
                onInspect={() => {}}
                onCloseInspect={onCloseInspect}
                // `inspectTapAnywhereCloses` deliberately omitted — this is
                // `deck-zones-surface.tsx`'s own call shape.
            />
        );

        expect(inspectPanel()).toBeTruthy();
        fireEvent.click(inspectPanel());
        expect(onCloseInspect).not.toHaveBeenCalled();
    });

    it("on for the Draft Room's Pool/Sideboard: a tap inside the Inspect Overlay DOES close it", () => {
        const onCloseInspect = vi.fn();
        render(
            <DeckZonePeek
                selection={null}
                onClose={() => {}}
                actions={[]}
                inspecting={BOLT}
                inspectActions={[]}
                onInspect={() => {}}
                onCloseInspect={onCloseInspect}
                inspectTapAnywhereCloses
            />
        );

        expect(inspectPanel()).toBeTruthy();
        fireEvent.click(inspectPanel());
        expect(onCloseInspect).toHaveBeenCalledTimes(1);
    });
});
