// mh1 (Modern Horizons) — multicolor behavior tests (ADR 0043 colour split).
//
// Wrenn and Six (issue #2358). All three loyalty abilities run through the real
// GRE resolution path (`resolveTopOfStack`), mirroring the Teferi, Hero of
// Dominaria harness (`sets/dom/__tests__/multicolor.test.ts`): the +1 is the
// "up to one target land card from your graveyard" bounce, the −1 is the "any
// target" ping, and the −7 creates the emblem whose grant is the ONLY producer
// of Retrace (CR 702.81) in the pool. The keyword's own behaviour lives in
// `convex/gre/__tests__/retrace.test.ts`; what this file owns is that the
// ultimate actually reaches it.

import { describe, it, expect } from "vitest";
import { fallenShinobi, wrennAndSix } from "../multicolor";
import { island, mountain } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import type { GameState, StackItem } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { WRENN_AND_SIX_EMBLEM_ID } from "../../../emblems";
import { hasRetrace } from "../../../../gre/retrace";
import type { TargetSelection } from "../../../types";

const PLUS1 = "wrenn-and-six-plus1";
const MINUS1 = "wrenn-and-six-minus1";
const MINUS7 = "wrenn-and-six-minus7";

function wrennOnBattlefield(loyalty = 3) {
    return makeInstance(wrennAndSix.id, {
        id: "wrenn1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Wrenn's loyalty abilities on the stack and resolves it through
 *  the real path (the loyalty framework's cost payment is exercised in game.ts;
 *  the card test asserts the EFFECT — the Teferi harness shape). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const wrenn = getPlayer(state, "p1").battlefield.find(
        (c) => c.id === "wrenn1"
    )!;
    state.stack.push({
        ...wrenn,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Wrenn and Six — +1 (return up to one target land card from your graveyard, CR 601.2c)", () => {
    it("returns the targeted land card from the graveyard to hand", () => {
        const land = makeInstance(mountain.id, {
            id: "gyLand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wrennOnBattlefield()],
                    graveyard: [land],
                }),
                makePlayer("p2"),
            ],
        });

        activate(state, PLUS1, [
            { type: "graveyard-card", id: "gyLand", playerId: "p1" },
        ]);

        const p1 = getPlayer(state, "p1");
        expect(p1.hand.some((c) => c.id === "gyLand")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "gyLand")).toBe(false);
    });

    it("resolves as a no-op when the controller declines the up-to-one target", () => {
        // CR 601.2c — `count: { min: 0, max: 1 }` permits an EMPTY announced
        // set; the ability still resolves and simply moves nothing.
        const land = makeInstance(mountain.id, {
            id: "gyLand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wrennOnBattlefield()],
                    graveyard: [land],
                }),
                makePlayer("p2"),
            ],
        });

        activate(state, PLUS1, []);

        const p1 = getPlayer(state, "p1");
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard.some((c) => c.id === "gyLand")).toBe(true);
    });
});

describe("Wrenn and Six — −1 (1 damage to any target, CR 115.4)", () => {
    it("deals 1 damage to a targeted player", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wrennOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });

        activate(state, MINUS1, [{ type: "player", id: "p2" }]);

        expect(getPlayer(state, "p2").life).toBe(19);
    });

    it("marks 1 damage on a targeted creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wrennOnBattlefield()] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });

        activate(state, MINUS1, [{ type: "permanent", id: "bear" }]);

        // CR 119.3 / 704.5g — a 2/2 survives 1 damage, which is marked on it.
        const target = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear"
        );
        expect(target?.damageMarked).toBe(1);
    });
});

describe("Wrenn and Six — −7 (emblem granting retrace, CR 114 / 702.81)", () => {
    it("creates the emblem, which grants retrace to instants and sorceries in the graveyard", () => {
        const bolt = makeInstance(lightningBolt.id, {
            id: "gyBolt",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wrennOnBattlefield(7)],
                    graveyard: [bolt],
                }),
                makePlayer("p2"),
            ],
        });
        // Before the ultimate nothing in the graveyard has retrace.
        expect(hasRetrace(state, bolt)).toBe(false);

        activate(state, MINUS7);

        expect(state.emblems ?? []).toHaveLength(1);
        expect(state.emblems![0].emblemId).toBe(WRENN_AND_SIX_EMBLEM_ID);
        expect(state.emblems![0].ownerId).toBe("p1");

        const gyBolt = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "gyBolt"
        )!;
        expect(hasRetrace(state, gyBolt)).toBe(true);
        // …and the emblem survives the wire projection so the client can render
        // it in the command zone.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.emblems?.[0]?.emblemId).toBe(WRENN_AND_SIX_EMBLEM_ID);
    });
});

// Fallen Shinobi (MH1 199, issue #2390) — the COMBAT-DAMAGE half.
//
// The Ninjutsu keyword itself is engine infrastructure and is exercised end to
// end in `convex/gre/__tests__/ninjutsu.test.ts`; what this file owns is the
// card's own `resolve()` closure, which no per-Op sweep covers: it is a
// cross-player impulse draw (exile off the DAMAGED player's library, grant the
// permission to THIS card's controller) with two riders Ragavan's otherwise
// identical trigger does not carry.
describe("Fallen Shinobi (combat-damage impulse, CR 601.3 / 305.9 / 118.9)", () => {
    /** Fires the trigger the way the engine does — a real stack item carrying
     *  the DAMAGE_DEALT event, resolved through `resolveTopOfStack`. */
    function shinobiDealsDamage(state: GameState): void {
        const trig: StackItem = {
            ...state.players[0].battlefield[0],
            id: "shinobi-trig",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "fallen-shinobi-combat-damage",
            triggerSourceId: "shinobi",
            triggerEvent: {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "shinobi",
                sourceControllerId: "p1",
                target: { type: "player", id: "p2" },
                amount: 5,
                isCombat: true,
            } as StackItem["triggerEvent"],
            targets: [],
        };
        state.stack.push(trig);
        resolveTopOfStack(state);
    }

    function boardWithLibrary(
        library: GameState["players"][number]["library"]
    ) {
        const shinobi = makeInstance(fallenShinobi.id, {
            id: "shinobi",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            turn: 4,
            players: [
                makePlayer("p1", { battlefield: [shinobi] }),
                makePlayer("p2", { library }),
            ],
        });
    }

    it("exiles the DAMAGED player's top TWO cards and grants their controller a free this-turn PLAY", () => {
        const state = boardWithLibrary([
            makeInstance(lightningBolt.id, {
                id: "opp-1",
                ownerId: "p2",
                zone: "library",
            }),
            makeInstance(grizzlyBears.id, {
                id: "opp-2",
                ownerId: "p2",
                zone: "library",
            }),
        ]);

        shinobiDealsDamage(state);

        // CR 400.7 — the cards stay OWNED by p2 and land in p2's own exile.
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(2);

        for (const exiled of state.players[1].exile) {
            // Cross-player grant: the SHINOBI's controller may play them.
            expect(exiled.castableFromExileBy).toBe("p1");
            expect(exiled.castableFromExileUntilTurn).toBe(4);
            // "without paying their mana costs" (CR 118.9) — the rider Ragavan
            // does not carry.
            expect(exiled.castFromExileWithoutPayingManaCost).toBe(true);
            // "you may PLAY those cards" (CR 305.9) — the second rider: a land
            // exiled this way is a legal land drop, where Ragavan's "cast"
            // wording leaves one dead.
            expect(exiled.castableFromExileIncludesLand).toBe(true);
            // CR 406.3 — hidden from the cards' own owner's side, known to the
            // player who may play them.
            expect(exiled.knownTo).toEqual(["p1"]);
        }
    });

    it("takes what is there when the library holds fewer than two (CR 608.2b)", () => {
        const state = boardWithLibrary([
            makeInstance(island.id, {
                id: "opp-only",
                ownerId: "p2",
                zone: "library",
            }),
        ]);

        shinobiDealsDamage(state);

        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(1);
        // The LAND branch of the "play" grant, the reason `includesLand` is set.
        expect(state.players[1].exile[0].castableFromExileIncludesLand).toBe(
            true
        );
    });

    it("does nothing on an empty library, and never touches the damaged player's own view", () => {
        const state = boardWithLibrary([]);

        expect(() => shinobiDealsDamage(state)).not.toThrow();
        expect(state.players[1].exile).toHaveLength(0);
    });

    // The wire format (mandatory for an outcome visible on the board): the
    // exiled cards are projected into the OWNER's exile zone, and the identity
    // is revealed only to the player who may play them (ADR 0026).
    it("projects the exiled pile to p2's zone, identity visible only to p1", () => {
        const state = boardWithLibrary([
            makeInstance(lightningBolt.id, {
                id: "opp-1",
                ownerId: "p2",
                zone: "library",
            }),
            makeInstance(grizzlyBears.id, {
                id: "opp-2",
                ownerId: "p2",
                zone: "library",
            }),
        ]);
        shinobiDealsDamage(state);

        const forP1 = projectPublicState(state, 1, "p1");
        const p2ExileForP1 = forP1.players.find((p) => p.id === "p2")!.exile;
        expect(p2ExileForP1).toHaveLength(2);
        expect(p2ExileForP1.map((c) => c.card.id)).toEqual([
            lightningBolt.id,
            grizzlyBears.id,
        ]);

        const forP2 = projectPublicState(state, 1, "p2");
        const p2ExileForP2 = forP2.players.find((p) => p.id === "p2")!.exile;
        expect(p2ExileForP2).toHaveLength(2);
        // Face-down to its own owner (CR 406.3) — the projection must not leak
        // the identity of a card only p1 is allowed to see.
        expect(p2ExileForP2.map((c) => c.card.id)).not.toEqual([
            lightningBolt.id,
            grizzlyBears.id,
        ]);
    });
});
