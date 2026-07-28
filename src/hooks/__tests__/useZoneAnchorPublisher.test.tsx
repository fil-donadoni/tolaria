// A spatial slot is not always one card, but a target arrow always points at
// ONE card instance.
//
// A fanned permanent stack (PRD #621) renders N interchangeable copies in a
// single slot keyed `stack:<identityKey>`; a phased slot is keyed
// `phased:<id>`; a host slot also carries its attached auras. Publishing only
// the slot key left every one of those instances anchorless, so a spell
// targeting them (Arc Lightning's divided damage into a fan) silently drew no
// arrow. `SpatialItem.anchorIds` declares the instances a slot covers.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import {
    ArrowAnchorContext,
    type ArrowAnchorContextValue,
} from "~/hooks/arrowAnchorContext";
import { useZoneAnchorPublisher } from "~/hooks/useZoneAnchorPublisher";
import { emptyAnchorMap, type AnchorMap } from "~/lib/target-arrow-geometry";
import type { SpatialItem } from "~/components/board/spatial-zone";
import type { Placement } from "~/lib/board-layout";

function makeRegistry() {
    const anchors: AnchorMap = emptyAnchorMap();
    const value: ArrowAnchorContextValue = {
        publish: (kind, id, point) => {
            anchors[kind][id] = point;
        },
        unpublish: (kind, id) => {
            delete anchors[kind][id];
        },
        anchors,
    };
    return { anchors, value };
}

function placement(x: number, y: number): Placement {
    return { x, y, rotation: 0, scale: 1 } as Placement;
}

function Harness({
    items,
    placements,
}: {
    items: SpatialItem[];
    placements: Placement[];
}) {
    const ref = useRef<HTMLDivElement>(null);
    useZoneAnchorPublisher({
        kind: "permanent",
        zoneRef: ref,
        items,
        placements,
        width: 800,
        height: 300,
    });
    return (
        <div data-board-root>
            <div ref={ref} />
        </div>
    );
}

function renderZone(items: SpatialItem[], placements: Placement[]) {
    const { anchors, value } = makeRegistry();
    render(
        <ArrowAnchorContext.Provider value={value}>
            <Harness items={items} placements={placements} />
        </ArrowAnchorContext.Provider>
    );
    return anchors;
}

describe("useZoneAnchorPublisher — one slot, many anchorable instances", () => {
    it("publishes the slot key when no anchorIds are declared", () => {
        const anchors = renderZone(
            [{ key: "perm-1", node: null }],
            [placement(40, 60)]
        );
        expect(anchors.permanent["perm-1"]).toEqual({ x: 40, y: 60 });
    });

    it("publishes every member of a fanned permanent stack at the slot center", () => {
        const anchors = renderZone(
            [
                {
                    key: "stack:goblin|0|0",
                    anchorIds: ["gob-a", "gob-b", "gob-c"],
                    node: null,
                },
            ],
            [placement(120, 80)]
        );
        for (const id of ["gob-a", "gob-b", "gob-c"]) {
            expect(anchors.permanent[id]).toEqual({ x: 120, y: 80 });
        }
        // The layout key is not a card instance, so it is NOT an anchor id.
        expect(anchors.permanent["stack:goblin|0|0"]).toBeUndefined();
    });

    it("publishes a host and its attached auras at the host slot", () => {
        const anchors = renderZone(
            [{ key: "bears", anchorIds: ["bears", "aura-1"], node: null }],
            [placement(10, 20)]
        );
        expect(anchors.permanent["bears"]).toEqual({ x: 10, y: 20 });
        expect(anchors.permanent["aura-1"]).toEqual({ x: 10, y: 20 });
    });
});
