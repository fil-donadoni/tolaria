// Manual Board drag → drop resolution (PRD #2162, issue #2169).
//
// The acceptance criteria name three outcomes a drag must produce: a zone MOVE
// verb, the combat-row LANE set by a vertical drag, and an ATTACH when the drop
// lands on another permanent. Each is asserted here twice — once on the pure
// decision (`resolveManualDrop`) and once on the dispatch it produces
// (`applyManualDrop`) — because a decision nobody dispatches and a dispatch
// nobody decided are two different bugs.
import { describe, expect, it } from "vitest";
import { applyManualDrop, resolveManualDrop } from "~/lib/manual-drop";
import { manualCard, spyDispatch } from "./manual-test-fixtures";

const NO_PROBE = { permanentId: null, zone: null, zoneOwnerId: null };

describe("manual drop resolution (#2169)", () => {
    it("dropping a hand card on a battlefield band dispatches the move verb", () => {
        const card = manualCard("c1", { zone: "hand" });
        const drop = resolveManualDrop({
            card,
            probe: {
                permanentId: null,
                zone: "battlefield",
                zoneOwnerId: "me",
            },
            dx: 30,
            dy: -120,
        });
        expect(drop).toEqual({
            kind: "move",
            instanceId: "c1",
            toZone: "battlefield",
        });

        const dispatch = spyDispatch();
        applyManualDrop(drop, dispatch);
        expect(dispatch.moveCard).toHaveBeenCalledWith({
            instanceId: "c1",
            toZone: "battlefield",
        });
    });

    it("dropping a permanent on a pile tile dispatches the move verb for that zone", () => {
        const card = manualCard("c1");
        const drop = resolveManualDrop({
            card,
            probe: { permanentId: null, zone: "graveyard", zoneOwnerId: "me" },
            dx: 80,
            dy: 10,
        });
        expect(drop).toEqual({
            kind: "move",
            instanceId: "c1",
            toZone: "graveyard",
        });
    });

    it("a vertical drag up inside the battlefield sets the combat row", () => {
        const card = manualCard("c1", { lane: "main" });
        const drop = resolveManualDrop({
            card,
            probe: {
                permanentId: null,
                zone: "battlefield",
                zoneOwnerId: "me",
            },
            dx: 5,
            dy: -90,
        });
        expect(drop).toEqual({
            kind: "lane",
            instanceId: "c1",
            lane: "combat",
        });

        const dispatch = spyDispatch();
        applyManualDrop(drop, dispatch);
        expect(dispatch.setLane).toHaveBeenCalledWith({
            instanceId: "c1",
            lane: "combat",
        });
        expect(dispatch.moveCard).not.toHaveBeenCalled();
    });

    it("a vertical drag DOWN inside the battlefield returns the card to the main row", () => {
        const drop = resolveManualDrop({
            card: manualCard("c1", { lane: "combat" }),
            probe: {
                permanentId: null,
                zone: "battlefield",
                zoneOwnerId: "me",
            },
            dx: 5,
            dy: 90,
        });
        expect(drop).toEqual({ kind: "lane", instanceId: "c1", lane: "main" });
    });

    it("dropping onto another permanent attaches instead of moving", () => {
        const card = manualCard("aura");
        const drop = resolveManualDrop({
            card,
            probe: {
                permanentId: "host",
                zone: "battlefield",
                zoneOwnerId: "me",
            },
            dx: 40,
            dy: -10,
        });
        expect(drop).toEqual({
            kind: "attach",
            instanceId: "aura",
            targetId: "host",
        });

        const dispatch = spyDispatch();
        applyManualDrop(drop, dispatch);
        expect(dispatch.attach).toHaveBeenCalledWith({
            instanceId: "aura",
            targetId: "host",
        });
    });

    it("dropping a permanent on ITSELF does nothing", () => {
        expect(
            resolveManualDrop({
                card: manualCard("c1"),
                probe: {
                    permanentId: "c1",
                    zone: "battlefield",
                    zoneOwnerId: "me",
                },
                dx: 2,
                dy: 2,
            })
        ).toBeNull();
    });

    it("a drop over nothing at all resolves to nothing", () => {
        expect(
            resolveManualDrop({
                card: manualCard("c1", { zone: "hand" }),
                probe: NO_PROBE,
                dx: 60,
                dy: 4,
            })
        ).toBeNull();
    });

    it("a card may never be dropped into ANOTHER seat's non-battlefield zone", () => {
        expect(
            resolveManualDrop({
                card: manualCard("c1", { ownerId: "me", zone: "hand" }),
                probe: {
                    permanentId: null,
                    zone: "graveyard",
                    zoneOwnerId: "opp",
                },
                dx: 60,
                dy: 4,
            })
        ).toBeNull();
    });
});
