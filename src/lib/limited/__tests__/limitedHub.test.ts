// The hub's pure rules (issue #5388): which events are "yours", the tile
// layout and the Pack Source an event maps back to.
import { describe, it, expect } from "vitest";
import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import { buildHub, hubTileClasses, packSourceForEvent } from "../limitedHub";

function source(key: string, setCodes: string[]): PackSourceInfo {
    return {
        key,
        name: key,
        description: "",
        featureCardId: null,
        draftOnly: false,
        draftable: true,
        sets: setCodes.map((setCode) => ({
            setCode,
            draftable: true,
            missingCardCount: 0,
            sheets: [],
        })),
    };
}

function event(
    overrides: Partial<LimitedEventSummaryView>
): LimitedEventSummaryView {
    return {
        _id: "e",
        type: "draft",
        status: "started",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        packSlots: ["lea"],
        seats: [{ seatIndex: 0, userId: "me", isBot: false, isViewer: true }],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventSummaryView;
}

describe("packSourceForEvent", () => {
    const sources = [
        source("lea", ["lea"]),
        source("invasion-block", ["inv", "pls", "apc"]),
    ];

    it("matches the single-set source an event drafts three boosters of", () => {
        expect(
            packSourceForEvent({ packSlots: ["lea", "lea", "lea"] }, sources)
                ?.key
        ).toBe("lea");
    });

    it("matches a block by its distinct sets in pack order", () => {
        expect(
            packSourceForEvent({ packSlots: ["inv", "pls", "apc"] }, sources)
                ?.key
        ).toBe("invasion-block");
    });

    it("has no source for a set order the catalogue does not hold", () => {
        expect(
            packSourceForEvent({ packSlots: ["apc", "pls", "inv"] }, sources)
        ).toBeUndefined();
    });
});

describe("buildHub", () => {
    it("keeps finished events out of yours, in history only", () => {
        const hub = buildHub(
            [event({ _id: "a" }), event({ _id: "b", status: "finished" })],
            "me",
            undefined,
            undefined
        );
        expect(hub.yours.map((e) => e._id)).toEqual(["a"]);
        expect(hub.history.map((e) => e._id)).toEqual(["b"]);
        expect(hub.counts.history).toBe(1);
    });

    it("counts a table the viewer can join under waiting", () => {
        const hub = buildHub(
            [
                event({
                    _id: "t",
                    status: "open",
                    seats: [
                        { seatIndex: 0, userId: "x", isBot: false },
                        { seatIndex: 1, isBot: false },
                    ] as LimitedEventSummaryView["seats"],
                }),
            ],
            "me",
            undefined,
            undefined
        );
        expect(hub.joinable.map((e) => e._id)).toEqual(["t"]);
        expect(hub.counts.waiting).toBe(1);
    });
});

describe("hubTileClasses", () => {
    it("gives one event half a row, with the New event tile the other half", () => {
        expect(hubTileClasses(0, 1)).toContain("lg:col-span-2");
        expect(hubTileClasses(1, 1)).toContain("lg:col-span-2");
    });

    it("makes the first of several events the 2×2 lead", () => {
        expect(hubTileClasses(0, 3)).toContain("lg:row-span-2");
    });

    it("gives New event half a row beside 1 or 3 events… and the one cell left beside 2", () => {
        expect(hubTileClasses(3, 3)).toContain("lg:col-span-2");
        expect(hubTileClasses(2, 2)).not.toContain("lg:col-span-2");
    });
});
