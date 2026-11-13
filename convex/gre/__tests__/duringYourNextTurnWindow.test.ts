// Galvanic Relay (issue #8619): "Exile the top card of your library. During
// your next turn, you may play that card." The `"during-your-next-turn"` exile
// play window is closed for the rest of this turn and on every opponent turn,
// open for exactly the grantee's next turn, then revoked at its cleanup
// (CR 514.2 / 611.2a).
//   - GRE: the stamps, the permission authority, the legal "play" action.
//   - Wire format: `castPermitted` / `legalActions` through `projectPublicState`.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, preloadDefinitions } from "../../cards";
import { galvanicRelay } from "../../cards/sets/mh2/red.cards";
import { projectPublicState } from "../../gameProjections";
import { exileCastPermitted } from "../castCost";
import { finalizeCleanup } from "../phases";
import { getLegalActions } from "../rules";
import { compactState, expandState } from "../serialize";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

preloadDefinitions([galvanicRelay()]);
const RELAY = galvanicRelay().id;
const FOREST = getCardByName("Forest").id;

/** p1 (three turns taken so far) resolves the spell over a one-card library. */
function afterResolution(): GameState {
    const top = makeInstance(FOREST, {
        id: "top",
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { library: [top], turnsTaken: 3 }),
            makePlayer("p2", { turnsTaken: 3 }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "POSTCOMBAT_MAIN",
        turn: 7,
    });
    pushSpell(state, RELAY, "p1");
    resolveTopOfStack(state);
    return state;
}

const exiled = (state: GameState): CardInstanceState =>
    getPlayer(state, "p1").exile.find((c) => c.id === "top")!;

/** Moves to p1's next turn: p2's turn is taken, then p1's begins. */
function toOpponentTurn(state: GameState): void {
    finalizeCleanup(state);
    state.turn += 1;
    state.activePlayerId = "p2";
    state.priorityPlayerId = "p2";
    getPlayer(state, "p2").turnsTaken = 4;
    state.phase = "PRECOMBAT_MAIN";
}

function toOwnNextTurn(state: GameState): void {
    state.turn += 1;
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    getPlayer(state, "p1").turnsTaken = 4;
    state.phase = "PRECOMBAT_MAIN";
}

describe("Galvanic Relay — during-your-next-turn window (CR 514.2 / 611.2a)", () => {
    it("exiles the top card and stamps the own-turn lower AND upper bound", () => {
        const state = afterResolution();
        const card = exiled(state);
        expect(card.castableFromExileBy).toBe("p1");
        expect(card.castableFromExileIncludesLand).toBe(true);
        // p1 has taken three turns: "your next turn" is their fourth.
        expect(card.castableFromExileFromOwnTurn).toBe(4);
        expect(card.castableFromExileUntilOwnTurn).toBe(4);
    });

    it("is closed for the rest of this turn: no land play, no permission", () => {
        const state = afterResolution();
        const p1 = getPlayer(state, "p1");
        expect(exileCastPermitted(state, exiled(state), "p1")).toBe(false);
        expect(getLegalActions(state, p1, exiled(state))).not.toContain("play");
    });

    it("stays closed on the opponent's turn", () => {
        const state = afterResolution();
        toOpponentTurn(state);
        expect(exiled(state).castableFromExileBy).toBe("p1");
        expect(exileCastPermitted(state, exiled(state), "p1")).toBe(false);
    });

    it("opens on the grantee's next turn and offers the land play", () => {
        const state = afterResolution();
        toOpponentTurn(state);
        toOwnNextTurn(state);
        expect(exileCastPermitted(state, exiled(state), "p1")).toBe(true);
        expect(
            getLegalActions(state, getPlayer(state, "p1"), exiled(state))
        ).toContain("play");
    });

    it("is revoked at that turn's cleanup", () => {
        const state = afterResolution();
        toOpponentTurn(state);
        toOwnNextTurn(state);
        finalizeCleanup(state);
        const card = exiled(state);
        expect(card.castableFromExileBy).toBeUndefined();
        expect(card.castableFromExileFromOwnTurn).toBeUndefined();
        expect(card.castableFromExileUntilOwnTurn).toBeUndefined();
    });

    it("survives a persistence round-trip with the bound intact", () => {
        const state = afterResolution();
        const card = exiled(expandState(compactState(state)));
        expect(card.castableFromExileFromOwnTurn).toBe(4);
        expect(card.castableFromExileUntilOwnTurn).toBe(4);
    });

    it("wire format: the exile card's cast gate follows the window", () => {
        const state = afterResolution();
        const closed = projectPublicState(state, 0, "p1").players[0].exile.find(
            (c) => c.id === "top"
        )!;
        expect(closed.legalActions ?? []).not.toContain("play");

        toOpponentTurn(state);
        toOwnNextTurn(state);
        const open = projectPublicState(state, 1, "p1").players[0].exile.find(
            (c) => c.id === "top"
        )!;
        expect(open.legalActions).toContain("play");
    });
});
