// Blood token (CR 707.2, issue #778) — "Artifact — Blood" with "{1}, {T},
// Discard a card, Sacrifice this token: Draw a card." GRE + wire-format
// coverage for the shared `BLOOD_TOKEN_SPEC`, mirroring the Treasure e2e
// activation test (cmr/__tests__/blue.test.ts) and the discard-filter cost
// activation test (gre/__tests__/discard-filter-cost-activation.test.ts).
// Drives the token through the real `createToken` Op path (a synthetic
// sorcery, same technique `registerDrawSpell` uses for Hullbreacher) rather
// than calling `createTokenPermanents` directly, so the Op's controller
// resolution / count handling is exercised too.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../types";
import { BLOOD_TOKEN_SPEC } from "../bloodToken";
import {
    getPlayer,
    resolveTopOfStack,
    normalizeManaCost,
    type PendingActivation,
} from "../../../../gre/state";
import { getDefinition, registerTokenDefinition } from "../../../index";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../../../game";
import { handCardMatchesFilter } from "../../../../gre/alternativeCost";
import { projectPublicState } from "../../../../gameProjections";
import { grizzlyBears } from "../../../sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

const ABILITY_ID = "sacrifice-discard-draw";

function registerBloodSpell(id: string): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects: [
            {
                op: "createToken",
                token: BLOOD_TOKEN_SPEC,
                controller: "controller",
            } as EffectOp,
        ],
    });
    return id;
}

/** Mirrors `activateSurvival` (discard-filter-cost-activation.test.ts): builds
 *  the pendingActivation through the real `buildPendingActivation` and
 *  attempts the real `tryAutoCommitPendingActivation` for the Blood token's
 *  own ability. */
function activateBlood(
    state: ReturnType<typeof makeState>,
    playerId: string,
    tokenInstanceId: string
): PendingActivation {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === tokenInstanceId)!;
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities!.find((a) => a.id === ABILITY_ID)!;
    const manaCost = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana)
        : undefined;
    const pending = buildPendingActivation({
        playerId,
        cardInstanceId: card.id,
        abilityId: ability.id,
        ability,
        manaCost,
    });
    state.pendingActivation = pending;
    tryAutoCommitPendingActivation(state, playerId);
    return pending;
}

describe("Blood token (CR 707.2, issue #778)", () => {
    it("createToken produces an Artifact — Blood with the sac-discard-draw ability", () => {
        const id = registerBloodSpell("test-blood-create");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        expect(token!.types).toEqual(["Artifact"]);
        expect(token!.subtypes).toContain("Blood");
        const def = getDefinition((token!.card as { id: string }).id);
        expect(def.activatedAbilities).toHaveLength(1);
        const ability = def.activatedAbilities![0];
        expect(ability.id).toBe(ABILITY_ID);
        expect(ability.oracleText).toBe(
            "{1}, {T}, Discard a card, Sacrifice this token: Draw a card."
        );
        expect(ability.cost).toEqual({
            mana: { generic: 1 },
            tap: true,
            discardFilter: { filter: {}, count: 1 },
            sacrifice: true,
        });
    });

    it("activating the ability requires paying mana + tap + discard, then draws a card and sacrifices the token", () => {
        const id = registerBloodSpell("test-blood-activate");
        const bears = makeInstance(grizzlyBears.id, {
            id: "discard-me",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libTop = makeInstance(grizzlyBears.id, {
            id: "lib-top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bears],
                    library: [libTop],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;

        const pa = activateBlood(state, "p1", token.id);
        // Mana is covered but the discard cost isn't paid yet — commit blocked.
        expect(pa.discardFilterChoice).toEqual({ filter: {}, count: 1 });
        expect(state.stack).toHaveLength(0);

        // Pay the discard cost (CR 602.1 / 118.3) — the same
        // `discardFilterChoice` picker Survival of the Fittest uses.
        expect(
            handCardMatchesFilter(bears, pa.discardFilterChoice!.filter)
        ).toBe(true);
        pa.discardFilterChoice!.pickedCardIds = ["discard-me"];
        tryAutoCommitPendingActivation(state, "p1");

        // CR 602.1 — tap + discard + sacrifice all resolved at cost payment,
        // before the ability resolves off the stack.
        expect(
            state.players[0].battlefield.some((c) => c.id === token.id)
        ).toBe(false); // sacrificed
        expect(
            state.players[0].graveyard.some((c) => c.id === "discard-me")
        ).toBe(true);
        expect(state.stack).toHaveLength(1);

        resolveTopOfStack(state);
        expect(state.players[0].hand.some((c) => c.id === "lib-top")).toBe(
            true
        );
    });

    it("wire format: the Blood token's ability survives projectPublicState", () => {
        const id = registerBloodSpell("test-blood-wire");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slimToken.subtypes).toContain("Blood");
        const def = getDefinition((slimToken.card as { id: string }).id);
        expect(def.activatedAbilities?.[0]?.id).toBe(ABILITY_ID);
        expect(def.activatedAbilities?.[0]?.cost.discardFilter).toEqual({
            filter: {},
            count: 1,
        });
    });
});
