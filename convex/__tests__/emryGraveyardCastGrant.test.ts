/**
 * Emry, Lurker of the Loch — the FULL GRE → `game.ts` → wire path for her
 * `{T}: Choose target artifact card in your graveyard. You may cast that card
 * this turn.` ability (issue #1650, CR 601.2c / 601.3).
 *
 * The per-colour card test (`convex/cards/sets/eld/__tests__/blue.test.ts`)
 * asserts the ability's own behaviour by pushing it straight on the stack. This
 * file asserts the pieces in BETWEEN — the ones a card test cannot reach and
 * where a targeting-into-a-non-battlefield-zone ability historically breaks:
 *
 *   1. `activateAbilityOnState` routes a targeted ability into `pendingTarget`
 *      rather than the stack, and LOWERS the graveyard requirement onto it
 *      (`zone` / `controller` / `targetType`) — those are exactly the fields
 *      `selectTarget`'s graveyard branch and the client's graveyard pile /
 *      dialog gate on;
 *   2. `finalizeTargetSelection` commits the pick, pays {T} and puts the
 *      ability on the stack with a `graveyard-card` target;
 *   3. resolution stamps the grant, and the SAME cast-cost function the real
 *      cast site uses (`castRawManaCost`) still charges the card's printed
 *      cost — i.e. "You still pay its costs."
 *
 * Same harness convention as `activateAbilityOnState.test.ts`: the project has
 * no Convex mutation test harness, so the extracted pure functions the
 * mutations delegate to are the integration seam.
 */

import { describe, expect, it } from "vitest";
import {
    activateAbilityOnState,
    castRawManaCost,
    finalizeTargetSelection,
} from "../game";
import { buildStateFromScenario } from "../gre/scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../gre/setup";
import { getCardByName } from "../cards";
import { getLegalActions } from "../gre/rules";
import { resolveTopOfStack, type GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import type { ScenarioSpec } from "../debugScenarioSpec";

const EMRY_GRANT_ABILITY = "emry-lurker-of-the-loch-graveyard-cast";

function player(id: string): PlayerInput {
    const filler = getCardByName("Island");
    return {
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: `deck-${id}`,
            name: "test",
            format: "freeform",
            cards: Array.from({ length: 60 }, () => ({
                cardId: filler.id,
                cardName: filler.name,
            })),
        },
    };
}

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(
        createInitialGameState([player("p1"), player("p2")], 0x1650),
        spec
    );
}

/** Emry untapped on p1's battlefield, Sol Ring + a Grizzly Bears decoy in
 *  p1's graveyard, one Island untapped for the follow-up cast. */
function emryScenario(): GameState {
    return build({
        cards: [
            {
                name: "Emry, Lurker of the Loch",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Sol Ring", owner: "me", zone: "graveyard" },
            { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
            { name: "Island", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
    });
}

function findByName(state: GameState, name: string, zone: "battlefield") {
    const def = getCardByName(name);
    const card = state.players[0][zone].find(
        (c) => (c.card as { id?: string }).id === def.id
    );
    if (!card) throw new Error(`${name} not found in ${zone}`);
    return card;
}

function graveyardCard(state: GameState, name: string) {
    const def = getCardByName(name);
    const card = state.players[0].graveyard.find(
        (c) => (c.card as { id?: string }).id === def.id
    );
    if (!card) throw new Error(`${name} not in graveyard`);
    return card;
}

describe("Emry {T} ability — activation lowers a graveyard target requirement (CR 602.2b / 601.2c)", () => {
    it("enters pendingTarget carrying zone/controller/type, not the stack", () => {
        const state = emryScenario();
        const emry = findByName(
            state,
            "Emry, Lurker of the Loch",
            "battlefield"
        );

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: emry.id,
            abilityId: EMRY_GRANT_ABILITY,
        });

        expect(state.stack).toHaveLength(0);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("ability");
        expect(pt.abilityId).toBe(EMRY_GRANT_ABILITY);
        // These three fields are what `selectTarget`'s graveyard branch AND
        // the client's graveyard pile / dialog both gate on — a drop here is
        // the "nothing is clickable" bug.
        expect(pt.zone).toBe("graveyard");
        expect(pt.controller).toBe("you");
        expect(pt.targetType).toBe("Artifact");
        // {T} is DEFERRED until the target is committed.
        expect(emry.isTapped).toBe(false);
    });
});

describe("Emry {T} ability — full activate → select → resolve → cast path (issue #1650)", () => {
    it("commits the graveyard pick, taps Emry, and stamps the this-turn grant", () => {
        const state = emryScenario();
        const emry = findByName(
            state,
            "Emry, Lurker of the Loch",
            "battlefield"
        );
        const solRing = graveyardCard(state, "Sol Ring");

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: emry.id,
            abilityId: EMRY_GRANT_ABILITY,
        });

        const pt = state.pendingTarget!;
        pt.selected = [
            {
                type: "graveyard-card",
                id: solRing.id,
                playerId: state.players[0].id,
            },
        ];
        finalizeTargetSelection(state, pt, state.players[0].id);

        // The ability is on the stack with the graveyard target, {T} paid.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(EMRY_GRANT_ABILITY);
        expect(state.stack[0].targets?.[0]).toMatchObject({
            type: "graveyard-card",
            id: solRing.id,
        });
        expect(emry.isTapped).toBe(true);

        resolveTopOfStack(state);

        const granted = graveyardCard(state, "Sol Ring");
        expect(granted.castableFromGraveyardBy).toBe(state.players[0].id);
        expect(granted.castableFromGraveyardUntilTurn).toBe(state.turn);
        // The Grizzly Bears decoy is untouched — the grant is per-CARD.
        expect(
            graveyardCard(state, "Grizzly Bears").castableFromGraveyardBy
        ).toBeUndefined();
    });

    it("the granted card is castable from the graveyard for its OWN printed cost", () => {
        const state = emryScenario();
        const emry = findByName(
            state,
            "Emry, Lurker of the Loch",
            "battlefield"
        );
        const solRing = graveyardCard(state, "Sol Ring");

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: emry.id,
            abilityId: EMRY_GRANT_ABILITY,
        });
        const pt = state.pendingTarget!;
        pt.selected = [
            {
                type: "graveyard-card",
                id: solRing.id,
                playerId: state.players[0].id,
            },
        ];
        finalizeTargetSelection(state, pt, state.players[0].id);
        resolveTopOfStack(state);

        // The ability's resolution handed priority to the non-active player;
        // the impulse cast happens once p1 gets it back (CR 117.3b) — model
        // that rather than asserting from the opponent's priority window.
        state.priorityPlayerId = state.players[0].id;

        const granted = graveyardCard(state, "Sol Ring");
        expect(getLegalActions(state, state.players[0], granted)).toContain(
            "cast"
        );

        // "You still pay its costs." — the ONE function the real cast site
        // uses to price a cast returns Sol Ring's printed {1}, not {0}.
        expect(castRawManaCost(state, granted, "graveyard")).toEqual(
            getCardByName("Sol Ring").manaCost
        );
    });

    it("the affordance survives the wire projection (castKind graveyard-grant)", () => {
        const state = emryScenario();
        const emry = findByName(
            state,
            "Emry, Lurker of the Loch",
            "battlefield"
        );
        const solRing = graveyardCard(state, "Sol Ring");

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: emry.id,
            abilityId: EMRY_GRANT_ABILITY,
        });
        const pt = state.pendingTarget!;
        pt.selected = [
            {
                type: "graveyard-card",
                id: solRing.id,
                playerId: state.players[0].id,
            },
        ];
        finalizeTargetSelection(state, pt, state.players[0].id);
        resolveTopOfStack(state);
        // See above — assert from p1's own priority window.
        state.priorityPlayerId = state.players[0].id;

        const projected = projectPublicState(state, 1, state.players[0].id);
        const slimSolRing = projected.players[0].graveyard.find(
            (c) => c.id === solRing.id
        )!;
        expect(slimSolRing.castKind).toBe("graveyard-grant");
        expect(slimSolRing.legalActions).toContain("cast");
        // The decoy carries no affordance.
        const slimBears = projected.players[0].graveyard.find(
            (c) => c.id === graveyardCard(state, "Grizzly Bears").id
        )!;
        expect(slimBears.castKind).toBeUndefined();
    });
});
