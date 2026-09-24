// TLA — per-card behaviour tests for blue cards in `convex/cards/sets/tla/blue.ts`
// (set split by colour, ADR 0043).
//
// Wan Shi Tong, All-Knowing (issue #3242): the ETB's choice belongs to the
// target's OWNER (CR 108.3) and the permanent goes to that owner's library
// (CR 400.3); its own move is a card put into a library, so the second ability
// triggers off it and makes two Spirit tokens whose CR 509.1b restriction binds
// both sides of a block. The emission plumbing itself is proven generically in
// `convex/gre/__tests__/cardsPutIntoLibrary.test.ts`.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const wanShiTongAllKnowing = getDefinition(
    "777fcc21-2856-4181-8ecd-c272f9769e36"
);
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";
const ETB_ID = "wan-shi-tong-all-knowing-etb-tuck";
const UNEXPECTEDLY_ABSENT_ID = "6dff437b-ef68-48f7-afd3-3b72d3c56187";

/** Wan Shi Tong under p1, a Grizzly Bears p1 STOLE from p2, and a two-card
 *  library for p2 — the ETB trigger, targeting the stolen Bears, on the stack. */
function etbOnTheStack(): { state: GameState; wanShiTong: CardInstanceState } {
    const wanShiTong = makeInstance(wanShiTongAllKnowing.id, {
        id: "wst",
        controllerId: "p1",
        ownerId: "p1",
    });
    const stolen = makeInstance(GRIZZLY_BEARS_ID, {
        id: "stolen",
        controllerId: "p1",
        ownerId: "p2",
    });
    const library = ["libA", "libB"].map((id) =>
        makeInstance(GRIZZLY_BEARS_ID, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [wanShiTong, stolen] }),
            makePlayer("p2", { library }),
        ],
    });
    state.stack.push({
        ...wanShiTong,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: ETB_ID,
        triggerSourceId: wanShiTong.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: wanShiTong.id,
            controllerId: "p1",
            types: ["Creature"],
        },
        targets: [{ type: "permanent", id: "stolen" }],
    });
    return { state, wanShiTong };
}

function spiritTokens(state: GameState): CardInstanceState[] {
    return state.players[0].battlefield.filter(
        (c) => c.id !== "wst" && c.subtypes.includes("Spirit")
    );
}

describe("Wan Shi Tong, All-Knowing (issue #3242)", () => {
    it("routes the ETB choice to the target's OWNER, and the owner's library receives it second from the top", () => {
        const { state } = etbOnTheStack();
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        // CR 108.3 — p1 controls the Bears, p2 owns them and chooses.
        expect(head.playerId).toBe("p2");
        expect(head.options?.map((o) => o.id)).toEqual([
            "second-from-top",
            "bottom",
        ]);

        submitChoice(state, ["second-from-top"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "stolen")
        ).toBe(false);
        // CR 400.3 — the OWNER's library, not the controller's.
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "libA",
            "stolen",
            "libB",
        ]);
        expect(state.players[0].library).toHaveLength(0);
    });

    it("puts it on the bottom when the owner picks the bottom", () => {
        const { state } = etbOnTheStack();
        resolveTopOfStack(state);
        submitChoice(state, ["bottom"]);
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "libA",
            "libB",
            "stolen",
        ]);
    });

    it("the non-chooser's projection offers only the two public position labels (#1982)", () => {
        const { state } = etbOnTheStack();
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        // Nothing hidden rides the offer: no card ids, only the two labels a
        // player at the table hears anyway.
        expect(head.candidateIds ?? []).toEqual([]);
        expect(head.options?.map((o) => o.label)).toEqual([
            "Second from the top",
            "On the bottom",
        ]);
    });

    it("its own ETB move triggers the library ability once: two 1/1 colorless Spirit tokens", () => {
        const { state } = etbOnTheStack();
        resolveTopOfStack(state);
        submitChoice(state, ["second-from-top"]);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const spirits = spiritTokens(state);
        expect(spirits).toHaveLength(2);
        for (const spirit of spirits) {
            expect(spirit.controllerId).toBe("p1");
            expect(spirit.power).toBe(1);
            expect(spirit.toughness).toBe(1);
        }
    });

    it("put into its own library, it still sees itself go (CR 603.10a look-back): two Spirits", () => {
        const wanShiTong = makeInstance(wanShiTongAllKnowing.id, {
            id: "wst",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wanShiTong] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, UNEXPECTEDLY_ABSENT_ID, "p2", [
            { type: "permanent", id: "wst" },
        ]);
        item.chosenX = 0;
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["wst"]);
        expect(spiritTokens(state)).toHaveLength(2);
    });

    it("the Spirit token can't block or be blocked by non-Spirit creatures, but Spirits fight Spirits (CR 509.1b)", () => {
        const { state } = etbOnTheStack();
        resolveTopOfStack(state);
        submitChoice(state, ["bottom"]);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const [spirit, otherSpirit] = spiritTokens(state);
        const bears = makeInstance(GRIZZLY_BEARS_ID, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bears);

        expect(
            validateBlockerEligibility(bears, spirit, [spirit], state).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(spirit, bears, [bears], state).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(
                spirit,
                otherSpirit,
                [otherSpirit],
                state
            ).eligible
        ).toBe(true);
    });
});
