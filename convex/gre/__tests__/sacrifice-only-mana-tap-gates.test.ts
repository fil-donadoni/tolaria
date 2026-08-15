// CR 302.6 — a mana ability paid PURELY by sacrificing its source has no {T}
// leg, so neither of the two tap gates applies to it:
//
//   • summoning sickness ("A creature's activated ability with the tap symbol
//     or the untap symbol in its activation cost can't be activated unless…"),
//     so a freshly-created Eldrazi Spawn may be sacrificed for mana the turn it
//     arrives;
//   • "already tapped", which is a statement about paying {T} — a tapped
//     permanent can still be sacrificed.
//
// Both gates sat unconditionally at the top of `tapSourceIntoPayment`
// (`convex/game.ts`), so Malevolent Rumble's Eldrazi Spawn — a 0/1 CREATURE
// token whose only ability is "Sacrifice this token: Add {C}." — was unusable
// on the turn it was created, which is the only turn its "ramp now" purpose
// exists for.
//
// The tests drive the REAL production entry points (`tapSourceIntoPayment` for
// the payment, `getLegalActions` for the auto-tap castability census), so the
// deliberate ASYMMETRY between them is pinned as well: the explicit payment
// takes a sacrifice-only source, the auto-tap planner never does.
//
// Basal Thrull is the CONTROL: its ability is "{T}, Sacrifice this creature:
// Add {B}{B}." — it HAS a tap leg, so CR 302.6 still refuses it while sick.

import { describe, it, expect } from "vitest";
import { tapSourceIntoPayment } from "../../game";
import { getLegalActions } from "../rules";
import { getPlayer, createTokenPermanents } from "../state";
import { ELDRAZI_SPAWN_TOKEN } from "../../cards/sharedTokens";
import { basalThrull } from "../../cards/sets/fem";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

/** A board with one Eldrazi Spawn token under p1's control, created through the
 *  real token path so it carries whatever `createTokenPermanents` stamps —
 *  including `isSummoningSick: true`, the state under test. */
function withSpawn(): { state: GameState; tokenId: string } {
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    state.activePlayerId = "p1";
    const [tokenId] = createTokenPermanents(
        state,
        ELDRAZI_SPAWN_TOKEN as never,
        "p1"
    );
    return { state, tokenId };
}

describe("sacrifice-only mana abilities ignore the tap gates (CR 302.6)", () => {
    it("a summoning-sick Eldrazi Spawn can be sacrificed for {C} the turn it is created", () => {
        const { state, tokenId } = withSpawn();
        const p1 = getPlayer(state, "p1");
        const token = p1.battlefield.find((c) => c.id === tokenId)!;
        // The state under test — a token enters summoning sick like any creature.
        expect(token.isSummoningSick).toBe(true);

        tapSourceIntoPayment(state, p1, token, undefined, []);

        expect(p1.manaPool.C).toBe(1);
        // CR 603.6 / 700.4 — the sacrifice leg still moves it off the battlefield.
        expect(p1.battlefield.some((c) => c.id === tokenId)).toBe(false);
    });

    it("an ALREADY TAPPED sacrifice-only source is still sacrificeable for mana", () => {
        const { state, tokenId } = withSpawn();
        const p1 = getPlayer(state, "p1");
        const token = p1.battlefield.find((c) => c.id === tokenId)!;
        token.isTapped = true;

        tapSourceIntoPayment(state, p1, token, undefined, []);

        expect(p1.manaPool.C).toBe(1);
        expect(p1.battlefield.some((c) => c.id === tokenId)).toBe(false);
    });

    it("the AUTO-tap castability census still does NOT count it (requireTap, by design)", () => {
        // The complement of the two tests above, pinned so the payment-path
        // exception is never widened into the planner by accident: the
        // castability census asks `getProducibleManaOptions` /
        // `getProducibleManaUnits` with `requireTap: true` precisely so the
        // auto-tap planner cannot sacrifice a permanent on the player's behalf
        // (the Lion's Eye Diamond hazard — its cost discards the hand). A
        // sacrifice-only source is therefore reachable only when the player
        // explicitly picks it.
        const { state, tokenId } = withSpawn();
        const p1 = getPlayer(state, "p1");
        const spell = makeInstance(getCardByName("Sol Ring").id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        p1.hand.push(spell);
        const token = p1.battlefield.find((c) => c.id === tokenId)!;
        expect(token.isSummoningSick).toBe(true);

        expect(getLegalActions(state, p1, spell)).not.toContain("cast");
        // …and the exclusion is about the SACRIFICE cost, not about the token
        // being unable to make mana: the explicit payment path takes it.
        tapSourceIntoPayment(state, p1, token, undefined, []);
        expect(p1.manaPool.C).toBe(1);
    });

    it("CONTROL — a {T}+Sacrifice mana ability is still refused while summoning sick", () => {
        const thrull = makeInstance(basalThrull.id, {
            id: "thrull",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull] }),
                makePlayer("p2"),
            ],
        });
        const p1 = getPlayer(state, "p1");
        expect(() =>
            tapSourceIntoPayment(state, p1, thrull, undefined, [])
        ).toThrow(/summoning sickness/);
    });
});
