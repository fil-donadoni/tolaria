// The three battlefield sweeps behind a graveyard cast (issue #10755) pass
// over a permanent whose definition declares no graveyard-cast grant, asking
// the registry's derived index instead of resolving the definition. Each is
// driven here through a board that MUST still produce its grant:
//
//   - CR 702.138a — escape granted to the graveyard's nonland cards;
//   - CR 702.81a — retrace granted to the graveyard's permanent cards;
//   - ADR 0093 — a graveyard play permission read off its source;
//
// and the index is held to the catalogue: no definition declaring one of the
// three fields may be missing from it, expanded or not.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    catalogueDefinitions,
    declaresGraveyardCastGrant,
} from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getGrantedEscape } from "../escape";
import { hasGrantedRetrace } from "../retrace";
import { getGraveyardPlayPermissions } from "../rules";
import type { GameState } from "../state";

const BREACH = getCardByName("Underworld Breach").id;
const SIX = getCardByName("Six").id;
const CRUCIBLE = getCardByName("Crucible of Worlds").id;
const BEARS = getCardByName("Grizzly Bears").id;
const BOLT = getCardByName("Lightning Bolt").id;

/** `p1` controls a vanilla creature beside `granterId`, and owns the two
 *  graveyard cards the grants are asked about. */
function boardWith(granterId: string): GameState {
    const own = { controllerId: "p1", ownerId: "p1" };
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(BEARS, { id: "bears", ...own }),
                    makeInstance(granterId, { id: "granter", ...own }),
                ],
                graveyard: [
                    makeInstance(BOLT, { id: "bolt", ...own }),
                    makeInstance(BEARS, { id: "dead-bears", ...own }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

const graveyardCard = (state: GameState, id: string) =>
    state.players[0].graveyard.find((c) => c.id === id)!;

describe("graveyard-cast grant sweeps (issue #10755)", () => {
    it("CR 702.138a — a battlefield granter gives a nonland graveyard card its escape cost", () => {
        const state = boardWith(BREACH);
        expect(
            getGrantedEscape(state, graveyardCard(state, "bolt"))?.exile
        ).toEqual({ count: 3 });
        expect(
            getGrantedEscape(boardWith(BEARS), graveyardCard(state, "bolt"))
        ).toBeUndefined();
    });

    it("CR 702.81a — a battlefield granter gives a permanent card in the graveyard retrace on its controller's turn", () => {
        const state = boardWith(SIX);
        expect(
            hasGrantedRetrace(state, graveyardCard(state, "dead-bears"))
        ).toBe(true);
        expect(
            hasGrantedRetrace(
                boardWith(BEARS),
                graveyardCard(state, "dead-bears")
            )
        ).toBe(false);
    });

    it("ADR 0093 — a continuous graveyard play permission is read off its source", () => {
        const state = boardWith(CRUCIBLE);
        expect(
            getGraveyardPlayPermissions(state, state.players[0]).map(
                (p) => p.sourceId
            )
        ).toEqual(["granter"]);
        const none = boardWith(BEARS);
        expect(getGraveyardPlayPermissions(none, none.players[0])).toEqual([]);
    });

    it("the index holds every catalogue definition declaring one of the three grants", () => {
        const missing: string[] = [];
        let declaring = 0;
        // eslint-disable-next-line no-restricted-syntax -- a generator, not an array (issue #10126)
        for (const def of catalogueDefinitions()) {
            if (
                !def.graveyardPlayPermission &&
                !def.grantsRetraceToOwnGraveyard &&
                !def.grantsEscapeToOwnGraveyard
            ) {
                continue;
            }
            declaring++;
            if (!declaresGraveyardCastGrant(def.id)) missing.push(def.name);
        }
        expect(declaring).toBeGreaterThan(0);
        expect(missing).toEqual([]);
    });
});
