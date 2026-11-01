// Shared fixture for the issue #2072 suites (GRE/wire in
// `manifestDread.test.ts`, Bot seam in `manifestDread.bot.test.ts`): a
// manifested permanent with lands to turn it up, and Abhorrent Oculus in hand
// over a graveyard of exilable cards.
import { getCardByName, registerTokenDefinition } from "../../cards";
import { abhorrentOculus } from "../../cards/sets/dsk/blue.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { turnFaceDown } from "../faceDown";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import type { CardInstanceState, GameState } from "../state";

export const BEARS = getCardByName("Grizzly Bears").id; // {1}{G} 2/2
export const FOREST = getCardByName("Forest").id;
export const ISLAND = getCardByName("Island").id;
// Registered through the definition seam rather than looked up by name, so the
// suites run on a tree whose derived Definition Index is still the base's
// (ADR 0157 — `derive:regenerate` repacks it in the lane).
export const OCULUS = abhorrentOculus();
registerTokenDefinition(OCULUS);

export function card(
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"],
    owner = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

export function lands(
    cardId: string,
    n: number,
    owner = "p1"
): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        card(cardId, `land${i}`, "battlefield", owner)
    );
}

/** p1 controls a MANIFESTED `realId` plus `landCount` untapped `landId`. */
export function manifestedBoard(
    realId: string,
    landId: string,
    landCount: number
): { state: GameState; permanent: CardInstanceState } {
    const permanent = card(realId, "manifested", "battlefield");
    turnFaceDown(NO_BOARD_LAYER_VIEW, permanent, "manifest");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [permanent, ...lands(landId, landCount)],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, permanent: state.players[0].battlefield[0] };
}

/** p1 holds Abhorrent Oculus over `graveyardSize` Bears and three Islands. */
export function oculusBoard(graveyardSize: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [card(OCULUS.id, "oculus", "hand")],
                graveyard: Array.from({ length: graveyardSize }, (_, i) =>
                    card(BEARS, `gy${i}`, "graveyard")
                ),
                battlefield: lands(ISLAND, 3),
            }),
            makePlayer("p2"),
        ],
    });
}
