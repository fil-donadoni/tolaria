// The state-based actions the sweep narrows to what can apply (issue #10025),
// each driven to apply through the real entry point, `checkStateBasedActions`:
//
//   - CR 704.5d — a zone holding no token is skipped, so a token tucked into a
//     LIBRARY must still be seen there;
//   - CR 704.5j — a controller with fewer than two legendary permanents is
//     skipped, so exactly two must still form a group;
//   - CR 704.5k / 205.4a — the World supertype is read without building the
//     supertype list, so a PRINTED World supertype must still count.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { checkStateBasedActions } from "../sba";
import { removePermanentTo } from "../state";

const BEARS = getCardByName("Grizzly Bears").id;
const CROSSROADS = getCardByName("Concordant Crossroads").id; // printed World
const RASPUTIN = getCardByName("Rasputin Dreamweaver").id; // printed Legendary

describe("token existence (CR 704.5d)", () => {
    it("a token put into its owner's library ceases to exist", () => {
        const token = makeInstance(BEARS, { id: "token", isToken: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [token] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "token", "library");
        expect(state.players[0].library.map((c) => c.id)).toContain("token");

        checkStateBasedActions(state);

        expect(state.players[0].library.map((c) => c.id)).not.toContain(
            "token"
        );
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("legend rule (CR 704.5j)", () => {
    it("two legendary permanents with the same name under one controller form a group", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(RASPUTIN, { id: "first" }),
                        makeInstance(BEARS, { id: "bears" }),
                        makeInstance(RASPUTIN, { id: "second" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("legend-keep");
        expect(choice?.playerId).toBe("p1");
        expect(choice?.candidateIds).toEqual(["first", "second"]);
    });
});

describe("world rule (CR 704.5k)", () => {
    it("a printed World permanent arriving puts the older one into its owner's graveyard", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(CROSSROADS, { id: "older", worldSeq: 1 }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(CROSSROADS, {
                            id: "newer",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        state.nextWorldSeq = 1;

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["older"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "newer",
        ]);
        expect(state.players[1].battlefield[0].worldSeq).toBe(2);
    });
});
