// Regression test for the solo viewer-swap stale-anchor bug (QA: attack
// arrows pointed at the attacker's own nameplate during DECLARE_ATTACKERS).
//
// In solo mode the viewer follows whoever owes input, so the two seats swap
// which player id they render. The DOM anchor publisher re-measures only on
// resize/scroll/stack-change — NOT on the seat→id flip — so the registry kept
// the two player anchors SWAPPED and every player-pointing arrow landed on
// the wrong nameplate. The `revision` parameter is the designed re-measure
// seam: board.tsx now bumps it with the seat assignment (`me:opponent`).
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import {
    ArrowAnchorContext,
    type ArrowAnchorContextValue,
} from "~/hooks/arrowAnchorContext";
import { useDomAnchorPublisher } from "~/hooks/useDomAnchorPublisher";
import {
    emptyAnchorMap,
    type AnchorMap,
    type AnchorPoint,
} from "~/lib/target-arrow-geometry";

function rect(x: number, y: number): DOMRect {
    return {
        left: x,
        top: y,
        width: 100,
        height: 40,
        right: x + 100,
        bottom: y + 40,
        x,
        y,
        toJSON: () => ({}),
    } as DOMRect;
}

const TOP = rect(400, 10);
const BOTTOM = rect(400, 900);

function makeRegistry() {
    const anchors: AnchorMap = emptyAnchorMap();
    const value: ArrowAnchorContextValue = {
        publish: (kind, id, point: AnchorPoint) => {
            anchors[kind][id] = point;
        },
        unpublish: (kind, id) => {
            delete anchors[kind][id];
        },
        anchors,
    };
    return { anchors, value };
}

function Harness({
    revision,
    bottomId,
    topId,
}: {
    revision: string;
    bottomId: string;
    topId: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useDomAnchorPublisher(ref, ["player"], revision);
    return (
        <div
            data-board-root
            ref={(el) => {
                if (el) el.getBoundingClientRect = () => rect(0, 0) as DOMRect;
            }}
        >
            <div ref={ref} />
            <div
                data-testid="bottom"
                data-arrow-anchor-player={bottomId}
                ref={(el) => {
                    if (el) el.getBoundingClientRect = () => BOTTOM;
                }}
            />
            <div
                data-testid="top"
                data-arrow-anchor-player={topId}
                ref={(el) => {
                    if (el) el.getBoundingClientRect = () => TOP;
                }}
            />
        </div>
    );
}

describe("useDomAnchorPublisher — revision re-measure (solo seat swap)", () => {
    it("publishes player anchors keyed by the seat elements' ids", () => {
        const { value } = makeRegistry();
        render(
            <ArrowAnchorContext.Provider value={value}>
                <Harness revision="a" bottomId="p1" topId="p2" />
            </ArrowAnchorContext.Provider>
        );
        // centers: x + width/2, y + height/2
        expect(value.anchors.player.p1).toEqual({ x: 450, y: 920 });
        expect(value.anchors.player.p2).toEqual({ x: 450, y: 30 });
    });

    it("a revision bump re-measures after the seats swap ids (the stale-anchor bug)", () => {
        const { value } = makeRegistry();
        const { rerender } = render(
            <ArrowAnchorContext.Provider value={value}>
                <Harness revision="p1:p2" bottomId="p1" topId="p2" />
            </ArrowAnchorContext.Provider>
        );
        expect(value.anchors.player.p1).toEqual({ x: 450, y: 920 });

        // The solo viewer swaps: the seats now render the opposite ids, but
        // the SAME revision keeps the registry stale (documents the bug).
        rerender(
            <ArrowAnchorContext.Provider value={value}>
                <Harness revision="p1:p2" bottomId="p2" topId="p1" />
            </ArrowAnchorContext.Provider>
        );
        expect(value.anchors.player.p2).toEqual({ x: 450, y: 30 });

        // Bumping the revision (board.tsx passes `me:opponent`) re-measures:
        // the registry follows the swap and arrows land on the right plates.
        rerender(
            <ArrowAnchorContext.Provider value={value}>
                <Harness revision="p2:p1" bottomId="p2" topId="p1" />
            </ArrowAnchorContext.Provider>
        );
        expect(value.anchors.player.p2).toEqual({ x: 450, y: 920 });
        expect(value.anchors.player.p1).toEqual({ x: 450, y: 30 });
    });
});

// Regression test for the second #1766 fixup round: BoardPileChips mounts the
// real PlayerGraveyard inside a `hidden` (display:none) wrapper, which
// collapses its `data-arrow-anchor-graveyard` element to an all-zero rect —
// jsdom returns all-zero rects by default anyway, which is exactly the shape
// a real `display:none` ancestor produces. Publishing that zero rect drew
// graveyard-card target arrows (Regrowth, Raise Dead, Animate Dead) to the
// board's top-left corner. The fix: `measure()` skips a `width === 0 && height
// === 0` rect instead of publishing it, so a real (non-degenerate) anchor for
// the same id — the now-visible PileChip — wins instead.
function ZeroRect(): DOMRect {
    return {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    } as DOMRect;
}

function DegenerateHarness({ visibleRect }: { visibleRect: DOMRect | null }) {
    const ref = useRef<HTMLDivElement>(null);
    useDomAnchorPublisher(ref, ["graveyard"], "rev");
    return (
        <div
            data-board-root
            ref={(el) => {
                if (el) el.getBoundingClientRect = () => rect(0, 0) as DOMRect;
            }}
        >
            <div ref={ref} />
            {visibleRect && (
                <div
                    data-testid="visible-chip"
                    data-arrow-anchor-graveyard="me"
                    ref={(el) => {
                        if (el) el.getBoundingClientRect = () => visibleRect;
                    }}
                />
            )}
            <div
                data-testid="hidden-wrapper"
                data-arrow-anchor-graveyard="me"
                ref={(el) => {
                    if (el) el.getBoundingClientRect = ZeroRect;
                }}
            />
        </div>
    );
}

describe("useDomAnchorPublisher — degenerate rect skip (#1766 fixup)", () => {
    it("does not publish a zero-rect anchor when no other element supplies a real one", () => {
        const { value } = makeRegistry();
        render(
            <ArrowAnchorContext.Provider value={value}>
                <DegenerateHarness visibleRect={null} />
            </ArrowAnchorContext.Provider>
        );
        expect(value.anchors.graveyard.me).toBeUndefined();
    });

    it("prefers the real rect over the degenerate one for the same anchor id", () => {
        const { value } = makeRegistry();
        render(
            <ArrowAnchorContext.Provider value={value}>
                <DegenerateHarness visibleRect={rect(100, 200)} />
            </ArrowAnchorContext.Provider>
        );
        // centers: x + width/2, y + height/2 — never the (0,0) top-left corner.
        expect(value.anchors.graveyard.me).toEqual({ x: 150, y: 220 });
    });
});

// Regression test for #1815 review fixup round 2: `ControllerBottomBar`
// mounts as a SIBLING of `data-board-root` in `board.tsx` (outside both the
// root div and `ArrowAnchorProvider`), so the viewer's inline compact zone
// chip's `data-arrow-anchor-graveyard` was never actually published — a scan
// scoped to the board root alone never reaches it. `board-arrows.tsx` now
// passes `extraRootSelector="[data-controller-bottom-bar]"`, resolved against
// `document` and merged into the SAME board-relative coordinate space.
function SecondRootHarness({
    mountBar,
}: {
    /** Whether the bar sibling (and its anchor chip) is mounted at all — the
     *  `false` case models "no extra root selector matched anything". */
    mountBar: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useDomAnchorPublisher(
        ref,
        ["graveyard"],
        "rev",
        "[data-controller-bottom-bar]"
    );
    return (
        <>
            <div
                data-board-root
                ref={(el) => {
                    if (el)
                        el.getBoundingClientRect = () => rect(0, 0) as DOMRect;
                }}
            >
                <div ref={ref} />
            </div>
            {/* A SIBLING of `data-board-root`, not a descendant — exactly the
                shape `ControllerBottomBar` mounts in `board.tsx`. */}
            {mountBar && (
                <div data-controller-bottom-bar>
                    <div
                        data-testid="bar-graveyard-chip"
                        data-arrow-anchor-graveyard="me"
                        ref={(el) => {
                            if (el)
                                el.getBoundingClientRect = () => rect(50, 60);
                        }}
                    />
                </div>
            )}
        </>
    );
}

describe("useDomAnchorPublisher — second root (#1815 review fixup round 2)", () => {
    it("publishes an anchor mounted OUTSIDE the board root via the extra root selector", () => {
        const { value } = makeRegistry();
        render(
            <ArrowAnchorContext.Provider value={value}>
                <SecondRootHarness mountBar />
            </ArrowAnchorContext.Provider>
        );
        // Board root rect is (0,0) — center of the (50,60)+100x40 chip rect
        // is (100, 80), unaffected by which root it was found under.
        expect(value.anchors.graveyard.me).toEqual({ x: 100, y: 80 });
    });

    it("publishes nothing extra when the second root isn't mounted (no crash, no stale anchor)", () => {
        const { value } = makeRegistry();
        render(
            <ArrowAnchorContext.Provider value={value}>
                <SecondRootHarness mountBar={false} />
            </ArrowAnchorContext.Provider>
        );
        expect(value.anchors.graveyard.me).toBeUndefined();
    });
});
