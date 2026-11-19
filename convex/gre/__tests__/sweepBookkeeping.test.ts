// The non-SBA bookkeeping the state-based-action sweep runs at every check
// (issue #10097), each now passing over what cannot contribute, each driven
// here through a board that MUST still produce its output:
//
//   - CR 603.8 — the state-trigger scan skips a permanent with no source of a
//     state-triggered ability, so a printed one must still trigger;
//   - CR 702.79a / 702.154d — the live keyword-trigger read returns early when
//     the multiset holds none of its keywords, so a keyword that is not the
//     first in the list must still yield its instances;
//   - CR 614 — the land-play lock scan skips a permanent whose definition
//     declares no lock, so Worms of the Earth must still lock;
//   - CR 113.6c — the hidden-zone refresh asks its precheck once, so a
//     zone-conditional card in a library must still read its zone types.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { liveKeywordTriggerInstances } from "../../cards/abilities/liveKeywordTriggers";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { checkStateBasedActions } from "../sba";
import { canLandEnterBattlefield } from "../state";

const DANDAN = getCardByName("Dandân").id; // "When you control no Islands, sacrifice"
const WORMS = getCardByName("Worms of the Earth").id;
const GRIST = getCardByName("Grist, the Hunger Tide").id;
const BEARS = getCardByName("Grizzly Bears").id;

describe("state-trigger scan (CR 603.8)", () => {
    it("a printed state-triggered ability whose state holds is put on the stack", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BEARS, { id: "bears" }),
                        makeInstance(DANDAN, { id: "dandan" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.stack.map((item) => item.triggerSourceId)).toContain(
            "dandan"
        );
    });
});

describe("live keyword triggers (CR 702.79a, CR 702.154d)", () => {
    it("each occurrence of a keyword after another keyword is one instance", () => {
        const persist = liveKeywordTriggerInstances([
            "flying",
            "persist",
            "persist",
        ]);
        expect(persist.map((a) => a.id)).toHaveLength(2);
    });

    it("a per-permanent keyword after another keyword is one instance however many occurrences", () => {
        const enlist = liveKeywordTriggerInstances([
            "trample",
            "enlist",
            "enlist",
        ]);
        expect(enlist).toHaveLength(1);
    });

    it("a multiset with none of the keywords has none", () => {
        expect(liveKeywordTriggerInstances(["flying", "trample"])).toEqual([]);
    });
});

describe("land-play lock (CR 614)", () => {
    it("Worms of the Earth among other permanents locks land entry at the check", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(BEARS, { id: "bears" })],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(WORMS, {
                            id: "worms",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
        });

        checkStateBasedActions(state);

        expect(state.landPlayLocked).toBe(true);
        expect(canLandEnterBattlefield(state, ["Land"])).toBe(false);
    });
});

describe("off-battlefield characteristics (CR 113.6c)", () => {
    it("a zone-conditional card in a library reads its zone types after the check", () => {
        const grist = makeInstance(GRIST, {
            id: "grist",
            zone: "library",
            types: ["Planeswalker"],
            subtypes: ["Grist"],
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [grist] }), makePlayer("p2")],
        });

        checkStateBasedActions(state);

        expect(state.players[0].library[0].types).toContain("Creature");
    });
});
