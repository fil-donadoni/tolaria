// TLA — colorless card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
    resolveTopOfStack,
} from "../../../__tests__/setup.helper";
import { applyPlayLand } from "../../../../gre/playLand";
import { getPlayer, removePermanentTo } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, preloadDefinitions } from "../../../index";
import { baSingSe } from "../colorless.cards";

const abandonedAirTemple = getDefinition(
    "9c0433f9-8f1e-4a19-a83f-a41925f1b1a9"
);
const island = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5");
const tundra = getDefinition("a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb");

/** Pushes an activated ability onto the stack with its cost assumed already
 *  paid (mirrors post-`activateAbility` state), then resolves it. Mirrors the
 *  established `resolveActivated` shim (`sets/atq/__tests__/set.helper.ts`). */
// Abandoned Air Temple — Land (CR 614.1c conditional tapped entry; CR 605.1a
// mana ability; CR 122 mass counter placement). "This land enters tapped
// unless you control a basic land.\n{T}: Add {W}.\n{3}{W}, {T}: Put a +1/+1
// counter on each creature you control."
describe("Abandoned Air Temple (CR 614.1c conditional tapped entry; CR 605.1a mana; CR 122 mass counters)", () => {
    it("enters UNTAPPED when you control a basic land", () => {
        const basic = makeInstance(island.id, { id: "isl" });
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [basic], hand: [temple] }),
                makePlayer("p2"),
            ],
        });
        const played = applyPlayLand(state, getPlayer(state, "p1"), "temple")!;
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED when you control no basic land", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [temple] }), makePlayer("p2")],
        });
        const played = applyPlayLand(state, getPlayer(state, "p1"), "temple")!;
        expect(played.isTapped).toBe(true);
    });

    it('enters TAPPED when you control only a Tundra — basic land TYPE (Plains/Island subtypes) without the Basic SUPERTYPE (CR 305.6) does not satisfy "control a basic land"', () => {
        // Regression for the review finding on #921: the ABUR dual lands
        // (`makeDualLand`, `sets/lea/colorless.cards.ts`) carry basic land subtypes
        // (Tundra: "Plains", "Island") but never the "Basic" supertype. "You
        // control a basic land" (CR 305.6) means the supertype, not the
        // subtype — a subtype-only check would wrongly let a lone Tundra
        // untap this land.
        const dual = makeInstance(tundra.id, { id: "tundra" });
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dual], hand: [temple] }),
                makePlayer("p2"),
            ],
        });
        const played = applyPlayLand(state, getPlayer(state, "p1"), "temple")!;
        expect(played.isTapped).toBe(true);
    });

    it("{3}{W}, {T}: puts a +1/+1 counter on each creature you control, not the opponent's", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(abandonedAirTemple.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const oppBear = makeInstance(abandonedAirTemple.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [temple, bear] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        resolveActivated(state, temple, "abandoned-air-temple-counters");
        const bearLive = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        const oppLive = state.players[1].battlefield.find(
            (c) => c.id === "opp-bear"
        )!;
        expect(bearLive.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, bearLive)).toBe(3);
        expect(oppLive.counters?.["+1/+1"]).toBeUndefined();
        // The land itself isn't a creature — no counter on it.
        const templeLive = state.players[0].battlefield.find(
            (c) => c.id === "temple"
        )!;
        expect(templeLive.counters?.["+1/+1"]).toBeUndefined();
    });

    it("wire format: the mass +1/+1 counters survive projectPublicState", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(abandonedAirTemple.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [temple, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, temple, "abandoned-air-temple-counters");
        const projected = projectPublicState(state, 1, "p1");
        const bearLive = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, bearLive)).toBe(3);
    });
});

// Ba Sing Se — Land (CR 614.1d conditional tapped entry; CR 701.66a Earthbend 2
// on an activated ability). A hand-tail card on a clean tree is not in the
// catalogue's registry yet, so the definition is preloaded.
describe("Ba Sing Se (CR 614.1d conditional tapped entry; CR 701.66a Earthbend 2)", () => {
    const city = baSingSe();
    preloadDefinitions([city]);

    function earthbent() {
        const source = makeInstance(city.id, {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
        });
        const home = makeInstance(island.id, {
            id: "home",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source, home] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "ba-sing-se-earthbend", [
            { type: "permanent", id: "home" },
        ]);
        return state;
    }

    it("enters UNTAPPED beside a basic land, TAPPED without one", () => {
        const inHand = () =>
            makeInstance(city.id, { id: "city", zone: "hand" });
        const basic = makeInstance(island.id, { id: "isl" });
        const withBasic = makeState({
            players: [
                makePlayer("p1", { battlefield: [basic], hand: [inHand()] }),
                makePlayer("p2"),
            ],
        });
        const alone = makeState({
            players: [makePlayer("p1", { hand: [inHand()] }), makePlayer("p2")],
        });
        expect(
            applyPlayLand(withBasic, getPlayer(withBasic, "p1"), "city")!
                .isTapped
        ).toBe(false);
        expect(
            applyPlayLand(alone, getPlayer(alone, "p1"), "city")!.isTapped
        ).toBe(true);
    });

    it("Earthbend 2 makes the target land a 0/0 haste creature with two +1/+1 counters, through the wire", () => {
        const state = earthbent();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "home"
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Land");
        expect(slim.staticAbilities).toContain("haste");
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    it("the earthbent land returns tapped when it dies", () => {
        const state = earthbent();
        removePermanentTo(state, "home", "graveyard");
        resolveTopOfStack(state);
        const back = state.players[0].battlefield.find((c) => c.id === "home")!;
        expect(back.isTapped).toBe(true);
        expect(state.players[0].graveyard.some((c) => c.id === "home")).toBe(
            false
        );
    });
});
