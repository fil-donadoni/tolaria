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
