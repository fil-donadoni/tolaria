// TLA — per-card behaviour tests for blue cards in `convex/cards/sets/tla/blue.cards.ts`
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
} from "../../../__tests__/setup.helper";
import {
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { compactState, expandState } from "../../../../gre/serialize";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { wanShiTongLibrarian } from "../../blue.cards";

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

// Wan Shi Tong, Librarian (issue #1993) — the ETB reads the cast-time X through
// `$source.chosenXOnCast`, surviving the save/load between the trigger going on
// the stack and it resolving, and the source leaving in response (CR 608.2h).
const WAN_SHI_TONG_LIBRARIAN_ID = wanShiTongLibrarian.id;
const LIBRARIAN_ETB_ID = "wan-shi-tong-librarian-etb";
const LIBRARIAN_SEARCH_ID = "wan-shi-tong-librarian-opponent-search";
const PATH_TO_EXILE_ID = "29b7a8b1-b98e-483a-87a4-73bd831c03d4";
const EXPRESSIVE_ITERATION_ID = "31b770cc-09e7-4c0b-b2a4-462ab4f7200d";
const REANIMATE_ID = "ae1ef31c-8ca5-444c-8f39-e1d1827318f5";
const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

preloadDefinitions([wanShiTongLibrarian]);

function libraryOf(ownerId: string, count: number): CardInstanceState[] {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(GRIZZLY_BEARS_ID, {
            id: `${ownerId}-lib-${i}`,
            ownerId,
            zone: "library",
        })
    );
}

/** Casts the Librarian for `x` and resolves it, leaving the ETB on the stack. */
function castLibrarian(x: number): {
    state: GameState;
    librarian: CardInstanceState;
} {
    const state = makeState({
        players: [
            makePlayer("p1", { library: libraryOf("p1", 6) }),
            makePlayer("p2", { library: libraryOf("p2", 6) }),
        ],
    });
    const item = pushSpell(state, WAN_SHI_TONG_LIBRARIAN_ID, "p1");
    item.chosenX = x;
    resolveTopOfStack(state);
    expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
        LIBRARIAN_ETB_ID
    );
    const librarian = state.players[0].battlefield.find(
        (c) => c.id === item.id
    )!;
    return { state, librarian };
}

/** Ephemerate's shape: the same instance id leaves and comes back a NEW object
 *  (CR 400.7), through the two production funnels. */
function blink(state: GameState, instanceId: string): void {
    const left = removePermanentTo(state, instanceId, "exile");
    expect(left).not.toBeNull();
    const owner = state.players.find((p) => p.id === left!.ownerId)!;
    const idx = owner.exile.findIndex((c) => c.id === instanceId);
    const [card] = owner.exile.splice(idx, 1);
    putReanimatedSetOnBattlefield(state, [
        { card, controllerId: card.ownerId },
    ]);
}

describe("Wan Shi Tong, Librarian — ETB (CR 400.7d / 107.1a)", () => {
    it("X=5 — five +1/+1 counters and two cards, half of 5 rounded down", () => {
        const { state, librarian } = castLibrarian(5);
        resolveTopOfStack(state);
        expect(librarian.counters?.["+1/+1"]).toBe(5);
        expect(state.players[0].hand).toHaveLength(2);
    });

    it("X=1 — one counter and no card", () => {
        const { state, librarian } = castLibrarian(1);
        resolveTopOfStack(state);
        expect(librarian.counters?.["+1/+1"]).toBe(1);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("X=0 — the trigger resolves to nothing", () => {
        const { state, librarian } = castLibrarian(0);
        resolveTopOfStack(state);
        expect(librarian.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("X=5 survives the save/load between the trigger and its resolution", () => {
        // Only the serialized `chosenXOnCast` crosses this round trip: `{ X: true }`
        // reads the trigger's own stack item, whose stray `chosenX` is dropped.
        const { state } = castLibrarian(5);
        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        expect(reloaded.players[0].battlefield[0].counters?.["+1/+1"]).toBe(5);
        expect(reloaded.players[0].hand).toHaveLength(2);
    });

    it("destroyed in response — no counters, but the draw still reads the last-known X (CR 608.2h)", () => {
        const { state, librarian } = castLibrarian(5);
        removePermanentTo(state, librarian.id, "graveyard");
        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        expect(reloaded.players[0].battlefield).toHaveLength(0);
        expect(reloaded.players[0].graveyard[0].counters).toBeUndefined();
        expect(reloaded.players[0].hand).toHaveLength(2);
    });

    it("blinked in response — the new object gets no counters and the draw reads the old X (CR 400.7)", () => {
        const { state, librarian } = castLibrarian(5);
        blink(state, librarian.id);
        resolveTopOfStack(state);
        const returned = state.players[0].battlefield.find(
            (c) => c.id === librarian.id
        )!;
        expect(returned.chosenXOnCast).toBeUndefined();
        expect(returned.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(state.players[0].hand).toHaveLength(2);
    });

    it("reanimated, never cast — X reads 0, so no counters and no card", () => {
        const card = makeInstance(WAN_SHI_TONG_LIBRARIAN_ID, {
            id: "reanimated",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [card],
                    library: libraryOf("p1", 2),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, REANIMATE_ID, "p1", [
            { type: "graveyard-card", id: card.id, playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
            LIBRARIAN_ETB_ID
        );
        resolveTopOfStack(state);
        const permanent = state.players[0].battlefield[0];
        expect(permanent.chosenXOnCast).toBeUndefined();
        expect(permanent.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(state.players[0].hand).toHaveLength(0);
    });
});

describe("Wan Shi Tong, Librarian — opponent searches (CR 701.23a)", () => {
    function withLibrarianOut(): {
        state: GameState;
        librarian: CardInstanceState;
    } {
        const librarian = makeInstance(WAN_SHI_TONG_LIBRARIAN_ID, {
            id: "librarian",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(GRIZZLY_BEARS_ID, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const basic = makeInstance(FOREST_ID, {
            id: "p2-forest",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [librarian],
                    library: libraryOf("p1", 3),
                }),
                makePlayer("p2", {
                    battlefield: [victim],
                    library: [basic, ...libraryOf("p2", 3)],
                }),
            ],
        });
        return { state, librarian };
    }

    it("your Path to Exile makes the opponent search — a counter and a card", () => {
        const { state, librarian } = withLibrarianOut();
        pushSpell(state, PATH_TO_EXILE_ID, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].playerId).toBe("p2");
        submitChoice(state, ["p2-forest"]);
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === LIBRARIAN_SEARCH_ID
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);
        expect(librarian.counters?.["+1/+1"]).toBe(1);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("an opponent's look-pick prompt (Expressive Iteration) is no search", () => {
        const { state } = withLibrarianOut();
        pushSpell(state, EXPRESSIVE_ITERATION_ID, "p2");
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("search-library");
        submitChoice(state, ["p2-forest"]);
        submitChoice(state, ["p2-lib-0"]);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === LIBRARIAN_SEARCH_ID
            )
        ).toBe(false);
    });
});
