import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    normalizeManaCost,
    isManaCostCovered,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { figureOfDestiny } from "../multicolor";

// Figure of Destiny (EVE, issue #1749) — the reference card for TWO engine
// capabilities: guild-hybrid pips payable with mana (CR 202.1a, issue #1738)
// and the INDEFINITE form of setSubtype / setBasePT / grantAbility
// (CR 611.2b, issue #1746), gated by the live-object `objectMatchesFilter`
// predicate (issue #1747).

const FIGURE_ID = "0da69523-cece-425a-b08a-fb27fac29374";

function setup() {
    const figure = makeInstance(FIGURE_ID, {
        id: "figure",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [figure] }),
            makePlayer("p2"),
        ],
    });
    return { state, figure };
}

/** Push the activated ability and resolve it — the post-payment shape every
 *  activated-ability card test uses (CR 602.2). */
function fire(state: GameState, source: CardInstanceState, abilityId: string) {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

function figureOnBattlefield(state: GameState): CardInstanceState {
    return state.players[0].battlefield.find((c) => c.id === "figure")!;
}

describe("Figure of Destiny — printed cost (CR 202.1a / 202.2)", () => {
    it("is a single guild-hybrid pip, payable with either colour", () => {
        const cost = normalizeManaCost(figureOfDestiny.manaCost!);
        expect(cost).toEqual({ "R/W": 1 });
        expect(isManaCostCovered({ R: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ W: 1 }, cost)).toBe(true);
        // The regression the hybrid payment core closes: never free.
        expect(isManaCostCovered({}, cost)).toBe(false);
        expect(isManaCostCovered({ G: 1 }, cost)).toBe(false);
    });

    it("prices every activation cost in hybrid pips too", () => {
        const [spirit, warrior, avatar] = figureOfDestiny.activatedAbilities!;
        expect(normalizeManaCost(spirit.cost.mana!)).toEqual({ "R/W": 1 });
        expect(normalizeManaCost(warrior.cost.mana!)).toEqual({ "R/W": 3 });
        expect(normalizeManaCost(avatar.cost.mana!)).toEqual({ "R/W": 6 });
    });
});

describe("Figure of Destiny — staged respec (CR 611.2b / 613.4b / 205.1b)", () => {
    it("first stage sets subtypes and base P/T indefinitely", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-spirit");
        const live = figureOnBattlefield(state);
        expect(live.subtypes).toEqual(["Kithkin", "Spirit"]);
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("second stage does NOTHING while the creature is not a Spirit", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-warrior");
        const live = figureOnBattlefield(state);
        expect(live.subtypes).toEqual(["Kithkin"]);
        expect(getEffectivePower(state, live)).toBe(1);
    });

    it("second stage fires once the FIRST stage made it a Spirit", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-spirit");
        fire(state, figureOnBattlefield(state), "figure-of-destiny-warrior");
        const live = figureOnBattlefield(state);
        expect(live.subtypes).toEqual(["Kithkin", "Spirit", "Warrior"]);
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(4);
    });

    it("third stage grants flying and first strike indefinitely", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-spirit");
        fire(state, figureOnBattlefield(state), "figure-of-destiny-warrior");
        fire(state, figureOnBattlefield(state), "figure-of-destiny-avatar");
        const live = figureOnBattlefield(state);
        expect(live.subtypes).toEqual([
            "Kithkin",
            "Spirit",
            "Warrior",
            "Avatar",
        ]);
        expect(getEffectivePower(state, live)).toBe(8);
        expect(getEffectiveToughness(state, live)).toBe(8);
        expect(live.staticAbilities).toContain("flying");
        expect(live.staticAbilities).toContain("first strike");
        // CR 611.2b — an indefinite grant carries no duration, so the
        // phase-boundary purge can never tick it out.
        for (const grant of live.grantedStaticAbilities ?? []) {
            expect(grant.duration).toBeUndefined();
        }
    });

    it("third stage does nothing while the creature is not a Warrior", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-spirit");
        fire(state, figureOnBattlefield(state), "figure-of-destiny-avatar");
        const live = figureOnBattlefield(state);
        expect(live.subtypes).toEqual(["Kithkin", "Spirit"]);
        expect(getEffectivePower(state, live)).toBe(2);
        expect(live.staticAbilities).not.toContain("flying");
    });
});

describe("Figure of Destiny — CR 400.7 (a new object forgets the respec)", () => {
    it("comes back a printed 1/1 Kithkin after a bounce", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-spirit");
        fire(state, figureOnBattlefield(state), "figure-of-destiny-warrior");
        fire(state, figureOnBattlefield(state), "figure-of-destiny-avatar");
        removePermanentTo(state, "figure", "hand");
        const inHand = state.players[0].hand.find((c) => c?.id === "figure")!;
        expect(inHand.subtypes).toEqual(["Kithkin"]);
        expect(inHand.temporaryPTSet).toBeUndefined();
        expect(inHand.staticAbilities).not.toContain("flying");
        expect(inHand.staticAbilities).not.toContain("first strike");
    });
});

describe("Figure of Destiny — wire format", () => {
    it("keeps the respec'd P/T after projectPublicState", () => {
        const { state, figure } = setup();
        fire(state, figure, "figure-of-destiny-spirit");
        const live = figureOnBattlefield(state);
        expect(getEffectiveToughness(state, live)).toBe(2);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "figure"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
        expect(slim.subtypes).toEqual(["Kithkin", "Spirit"]);
    });
});
