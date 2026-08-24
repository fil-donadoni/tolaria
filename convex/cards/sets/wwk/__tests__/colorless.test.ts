// Per-card behavior tests for colorless cards in
// `convex/cards/sets/wwk/colorless.ts` (Worldwake, split by colour per ADR
// 0043). The manland cycle (Creeping Tar Pit, Celestial Colonnade) mirrors
// Mishra's Factory (`convex/cards/sets/atq/colorless.ts`) — see that card's
// test (`convex/cards/sets/atq/__tests__/colorless.test.ts`) for the
// `resolveActivated` push-cost-already-paid idiom this file reproduces
// locally (no shared `helpers.ts` exists yet for this set). Fixtures from
// `convex/cards/__tests__/setup.ts`. Vintage Cube free tranche (issue #675,
// ADR 0041).

import { describe, it, expect } from "vitest";
import { creepingTarPit, celestialColonnade } from "..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import { advancePhase } from "../../../../gre/phases";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";

/** Push an activated ability onto the stack with its cost assumed already
 *  paid (mirrors post-`activateAbility` state), then resolve it. Local copy
 *  of the ATQ helper of the same name — this set has no shared helpers.ts
 *  yet, and the shared fixture file (setup.ts) is fixtures-only by
 *  convention. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

function manaChoices(
    state: GameState,
    land: CardInstanceState,
    controllerId: string
): ReturnType<typeof getEffectiveManaChoices> {
    return getEffectiveManaChoices(
        land,
        controllerId,
        state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }))
    );
}

describe("Creeping Tar Pit (manland — CR 611.1 animate, CR 614.1c enters tapped)", () => {
    it("enters tapped when played (CR 614.1c)", () => {
        const land = makeInstance(creepingTarPit.id, { zone: "hand" });
        const player = makePlayer("p1", { hand: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });

        const played = applyPlayLand(state, player, land.id)!;

        expect(played.isTapped).toBe(true);
    });

    it("its mana ability offers {U} or {B} (CR 106.1/605.1a)", () => {
        const land = makeInstance(creepingTarPit.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ U: 1 }, { B: 1 }]);
    });

    it("animates into a 3/2 Elemental creature and becomes unblockable this turn", () => {
        const land = makeInstance(creepingTarPit.id, {
            id: "tarpit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [land] })],
        });
        resolveActivated(state, land, "creeping-tar-pit-animate");

        const live = state.players[0].battlefield.find(
            (c) => c.id === "tarpit"
        )!;
        expect(live.types).toEqual(
            expect.arrayContaining(["Land", "Creature"])
        );
        expect(live.subtypes).toContain("Elemental");
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(2);
        // CR 509.1b — "can't be blocked this turn" (setCantBeBlockedThisTurn).
        expect(live.cantBeBlockedThisTurn).toBe(true);
    });

    it("reverts to a non-creature with no unblockable flag at cleanup (CR 514.2)", () => {
        const land = makeInstance(creepingTarPit.id, {
            id: "tarpit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, "creeping-tar-pit-animate");

        state.activePlayerId = "p1";
        state.turn = 1;
        state.phase = "END_STEP" as GameState["phase"];
        // p1's hand is empty → no cleanup discard, so advancePhase runs
        // through CLEANUP's tickAllDurations and reverts the animation.
        advancePhase(state);

        const live = [
            ...state.players[0].battlefield,
            ...state.players[1].battlefield,
        ].find((c) => c.id === "tarpit")!;
        expect(live.types).toEqual(["Land"]);
        expect(live.animation).toBeUndefined();
        expect(live.cantBeBlockedThisTurn).toBeUndefined();
    });
});

describe("Celestial Colonnade (manland — CR 611.1 animate, CR 614.1c enters tapped)", () => {
    it("enters tapped when played (CR 614.1c)", () => {
        const land = makeInstance(celestialColonnade.id, { zone: "hand" });
        const player = makePlayer("p1", { hand: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });

        const played = applyPlayLand(state, player, land.id)!;

        expect(played.isTapped).toBe(true);
    });

    it("its mana ability offers {W} or {U} (CR 106.1/605.1a)", () => {
        const land = makeInstance(celestialColonnade.id, {
            controllerId: "p1",
        });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ W: 1 }, { U: 1 }]);
    });

    it("animates into a 4/4 Elemental creature with flying and vigilance", () => {
        const land = makeInstance(celestialColonnade.id, {
            id: "colonnade",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [land] })],
        });
        resolveActivated(state, land, "celestial-colonnade-animate");

        const live = state.players[0].battlefield.find(
            (c) => c.id === "colonnade"
        )!;
        expect(live.types).toEqual(
            expect.arrayContaining(["Land", "Creature"])
        );
        expect(live.subtypes).toContain("Elemental");
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(4);
        expect(live.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
    });

    it("reverts to a non-creature with no granted keywords at cleanup (CR 514.2)", () => {
        const land = makeInstance(celestialColonnade.id, {
            id: "colonnade",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, "celestial-colonnade-animate");

        state.activePlayerId = "p1";
        state.turn = 1;
        state.phase = "END_STEP" as GameState["phase"];
        advancePhase(state);

        const live = [
            ...state.players[0].battlefield,
            ...state.players[1].battlefield,
        ].find((c) => c.id === "colonnade")!;
        expect(live.types).toEqual(["Land"]);
        expect(live.animation).toBeUndefined();
        expect(live.staticAbilities).not.toContain("flying");
        expect(live.staticAbilities).not.toContain("vigilance");
    });
});

// --- Everflowing Chalice (Multikicker {2}, CR 702.33e, issue #692) ----------
// Enters with a charge counter per kick (`entersWith.counters` count "kicker"),
// and its {T} mana ability scales {C} with the live charge count via the
// board-conditional `manaAmount` hook. Board-visible → a wire-format assertion
// (projectPublicState) confirms the counters survive the projection.
import { everflowingChalice } from "..";
import { pushSpell } from "../../../__tests__/setup";
import { getDynamicManaProduced } from "../../../../gre/constants";
import { projectPublicState } from "../../../../gameProjections";

describe("Everflowing Chalice (Multikicker {2}, CR 702.33e)", () => {
    function enterKicked(times: number) {
        const state = makeState();
        const item = pushSpell(state, everflowingChalice.id, "p1");
        if (times > 0) item.kickerPayments = { kicker: times };
        resolveTopOfStack(state);
        return state;
    }

    it("enters with a charge counter for each time it was kicked", () => {
        const state = enterKicked(2);
        const chalice = state.players[0].battlefield.find(
            (c) => c.card.id === everflowingChalice.id
        )!;
        expect(chalice.counters?.charge).toBe(2);
    });

    it("enters with no counters when not kicked", () => {
        const state = enterKicked(0);
        const chalice = state.players[0].battlefield.find(
            (c) => c.card.id === everflowingChalice.id
        )!;
        expect(chalice.counters?.charge ?? 0).toBe(0);
    });

    it("taps for {C} equal to its charge counters (board-conditional mana)", () => {
        const state = enterKicked(3);
        const chalice = state.players[0].battlefield.find(
            (c) => c.card.id === everflowingChalice.id
        )!;
        const produced = getDynamicManaProduced(
            chalice,
            state.players[0].battlefield
        );
        expect(produced?.C).toBe(3);
    });

    it("carries the charge counters across the wire projection", () => {
        const state = enterKicked(2);
        const chalice = state.players[0].battlefield.find(
            (c) => c.card.id === everflowingChalice.id
        )!;
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === chalice.id
        )!;
        expect(slim.counters?.charge).toBe(2);
    });
});

// --- Layer-5 colour clause on the manland cycle (issue #1872) --------------
// "becomes a 3/2 BLUE AND BLACK Elemental creature" / "a 4/4 WHITE AND BLUE
// Elemental creature": `animate`'s `colors` field routes through the same
// layer-5 colour SET the `setColor` Op uses (CR 613.1e; CR 105.3 — the new
// colour replaces every colour the object had). Board-visible characteristic
// → the wire-format assertion below is mandatory (`.claude/rules/gre-
// development.md`), since `projectPublicState` reshapes the instance.
import { getEffectiveColors } from "../../../effectiveColors";
import { resetBattlefieldTransientState } from "../../../../gre/state";

describe("manland colour clause (CR 613.1e layer 5 / CR 105.3)", () => {
    function animate(
        def: typeof creepingTarPit,
        abilityId: string
    ): { state: GameState; live: CardInstanceState } {
        const land = makeInstance(def.id, {
            id: "manland",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, abilityId);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "manland"
        )!;
        return { state, live };
    }

    it("is colourless before animating (CR 105.2 — a land has no mana cost)", () => {
        const land = makeInstance(creepingTarPit.id, {
            id: "manland",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(getEffectiveColors(land)).toEqual([]);
    });

    it("Creeping Tar Pit becomes blue and black while animated", () => {
        const { live } = animate(creepingTarPit, "creeping-tar-pit-animate");
        expect(getEffectiveColors(live)).toEqual(["U", "B"]);
    });

    it("Celestial Colonnade becomes white and blue while animated", () => {
        const { live } = animate(
            celestialColonnade,
            "celestial-colonnade-animate"
        );
        expect(getEffectiveColors(live)).toEqual(["W", "U"]);
    });

    it("re-reads blue and black after the wire projection", () => {
        const { state, live } = animate(
            creepingTarPit,
            "creeping-tar-pit-animate"
        );
        expect(getEffectiveColors(live)).toEqual(["U", "B"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === live.id
        )!;
        expect(getEffectiveColors(slim)).toEqual(["U", "B"]);
    });

    it("returns to colourless when the animation expires (CR 514.2)", () => {
        const { state } = animate(creepingTarPit, "creeping-tar-pit-animate");
        state.activePlayerId = "p1";
        state.turn = 1;
        state.phase = "END_STEP" as GameState["phase"];
        advancePhase(state);

        const live = [
            ...state.players[0].battlefield,
            ...state.players[1].battlefield,
        ].find((c) => c.id === "manland")!;
        // The colour reverts at the SAME boundary the P/T and type line do.
        expect(live.animation).toBeUndefined();
        expect(getEffectiveColors(live)).toEqual([]);
        expect(live.temporaryColorOverride).toBeUndefined();
    });

    it("strands no colour override when the animated land leaves the battlefield (CR 400.7)", () => {
        const { live } = animate(creepingTarPit, "creeping-tar-pit-animate");
        expect(live.colorOverride).toEqual(["U", "B"]);
        expect(live.temporaryColorOverride).toBeDefined();

        resetBattlefieldTransientState(live);

        // Both the override AND its revert record go — a surviving record
        // would splice a stale colour back onto a NEW object at the next
        // phase boundary.
        expect(live.colorOverride).toBeUndefined();
        expect(live.temporaryColorOverride).toBeUndefined();
        expect(getEffectiveColors(live)).toEqual([]);
    });

    it("does not alias the card definition's colour array into game state", () => {
        const { live } = animate(creepingTarPit, "creeping-tar-pit-animate");
        const declared = creepingTarPit.activatedAbilities![1].effects!.find(
            (e) => e.op === "animate"
        )! as { colors?: string[] };
        expect(live.colorOverride).not.toBe(declared.colors);
    });
});
