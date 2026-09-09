// Issue #2945 — Agatha's Soul Cauldron, the FULL PATH in one test:
// GRE derivation → `convex/game.ts` activation → wire → the client ability
// views. Two clauses of one card meet only here, and each half already has its
// own single-layer suite:
//
//   - the grant derivation      → `convex/gre/__tests__/exileSetAbilityGrant.test.ts`
//   - the substitution scope    → `convex/gre/__tests__/manaSubstitutionScope.test.ts`
//   - the card's own {T} clause → `convex/cards/sets/woe/__tests__/colorless.test.ts`
//   - the wire/origin plumbing  → `./exile-set-ability-grant.wire.test.ts`
//
// None of them can fail on the seam this file guards: an ability the Cauldron
// GRANTS, whose coloured pip is paid with off-colour mana by the Cauldron's OWN
// fixing, and which the client must offer before any of that can happen. A
// server-only assertion passes while the button the player would press is
// absent (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect } from "vitest";
import { getDisplayAbilities, getStackAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { GameState } from "@convex/gre/state";
import { getPlayer, resolveTopOfStack } from "@convex/gre/state";
import { getEffectivePower, getEffectiveToughness } from "@convex/gre/layers";
import { syncLayer6 } from "@convex/gre/layer6";
import { activateAbilityOnState } from "@convex/game";
import { agathasSoulCauldron } from "@convex/cards/sets/woe/colorless";

const BEARS = getCardByName("Grizzly Bears").id;
/** `{B}: This creature gets +1/+1 until end of turn.` — the granted ability. */
const SHADE = getCardByName("Frozen Shade").id;
const SHADE_PUMP = "frozen-shade-pump";

/** p1: the Cauldron, a Bear carrying a `+1/+1` counter, a Frozen Shade card in
 *  exile linked to the Cauldron (as its own `{T}` ability would have left it),
 *  and one floating `{G}` — the WRONG colour for the granted `{B}`. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(agathasSoulCauldron.id, {
                        id: "cauldron",
                        controllerId: "p1",
                        staticSeq: 1,
                    }),
                    makeInstance(BEARS, {
                        id: "recipient",
                        controllerId: "p1",
                        staticSeq: 2,
                        counters: { "+1/+1": 1 },
                    }),
                ],
                exile: [
                    makeInstance(SHADE, {
                        id: "exiled-shade",
                        zone: "exile",
                        controllerId: "p1",
                        exiledBySourceId: "cauldron",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
    syncLayer6(state);
    return state;
}

function projectedRecipient(state: GameState): CardInstance {
    return projectPublicState(state, 1, "p1")
        .players.flatMap((p) => p.battlefield)
        .find((c) => c.id === "recipient") as unknown as CardInstance;
}

describe("Agatha's Soul Cauldron — granted ability paid with substituted mana, GRE → game.ts → UI (issue #2945)", () => {
    it("offers the granted ability to the client", () => {
        const card = projectedRecipient(board());
        // The zoom panel's list (what the ability IS) ...
        expect(getDisplayAbilities(BEARS, card).activated).toEqual([
            {
                id: SHADE_PUMP,
                oracleText: "{B}: This creature gets +1/+1 until end of turn.",
                state: "granted",
            },
        ]);
        // ... and the activation list (what the player can PRESS). Grizzly
        // Bears has no printed activated ability, so every row here is the
        // Cauldron's doing.
        expect(getStackAbilities(card).map((a) => a.id)).toEqual([SHADE_PUMP]);
    });

    it("pays the granted {B} with the floating {G} and resolves the pump", () => {
        const state = board();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "recipient",
            abilityId: SHADE_PUMP,
        });

        // CR 609.4b — the cost was not changed, only how it was paid: the
        // activation committed inline rather than parking for {B}, and the {G}
        // is gone. Without the scope reaching an ability GRANTED to this
        // creature, this is a `pendingActivation` awaiting mana it never gets.
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").manaPool.G ?? 0).toBe(0);
        expect(getPlayer(state, "p1").manaPool.B ?? 0).toBe(0);

        resolveTopOfStack(state);
        const bear = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "recipient"
        )!;
        // 2/2 Bear + the +1/+1 counter + the granted pump.
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("refuses the same payment for a creature with no +1/+1 counter", () => {
        const state = board();
        const bear = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "recipient"
        )!;
        delete bear.counters;
        syncLayer6(state);

        // The grant is gone, so there is no ability to press — client-side ...
        expect(getStackAbilities(projectedRecipient(state))).toEqual([]);
        // ... and server-side, which is the authority (ADR 0074).
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "recipient",
                abilityId: SHADE_PUMP,
            })
        ).toThrow();
    });
});
