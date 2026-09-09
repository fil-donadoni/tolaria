// Issue #3299 — a LOYALTY ability granted to a CREATURE, the full path in one
// test: GRE layer-6 derivation → `convex/game.ts` activation → SBA → wire →
// the client's ability list and its loyalty display.
//
// CR 606.2 is "an activated ability with a loyalty symbol in its cost is a
// loyalty ability. Normally, only planeswalkers have loyalty abilities" —
// NORMALLY, not only. Agatha's Soul Cauldron grants "all activated abilities of
// all creature cards exiled with" it, and Grist, the Hunger Tide is a creature
// card in exile under CR 113.6c, so a creature with a +1/+1 counter holds three
// loyalty abilities and pays their costs onto ITSELF.
//
// Each single layer has its own suite; none of them can fail on this seam:
//   - the zone-resolved ability source → `convex/gre/__tests__/exileSetAbilityGrant.test.ts`
//   - the CR 606 gate itself          → `convex/gre/__tests__/loyaltyAbility.test.ts`
//   - the wire/origin plumbing        → `./exile-set-ability-grant.wire.test.ts`
// A server-only assertion passes while the button the player would press is
// absent, and the counters the button spends are invisible
// (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect } from "vitest";
import { getStackAbilities, showsLoyalty } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { GameState } from "@convex/gre/state";
import { getPlayer } from "@convex/gre/state";
import { syncLayer6 } from "@convex/gre/layer6";
import { checkStateBasedActions } from "@convex/gre/sba";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { activateAbilityOnState } from "@convex/game";

// Registry ids, not a set-module import and not `getCardByName` — the two
// swap-blind readers ADR 0046 bans.
const CAULDRON = "019b51b0-e5c6-4208-922b-7736686dddcd"; // Agatha's Soul Cauldron, WOE 242
/** Grizzly Bears — a vanilla 2/2 with no printed activated ability. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";
/** Grist, the Hunger Tide — MH2, a printed Planeswalker that is a 1/1 Insect
 *  creature card everywhere but the battlefield (CR 113.6c). */
const GRIST = "69af2825-18c2-4463-b6ba-42eaa070ccc1";
const GRIST_PLUS1 = "grist-the-hunger-tide-plus1";
const GRIST_MINUS2 = "grist-the-hunger-tide-minus2";
const GRIST_MINUS5 = "grist-the-hunger-tide-minus5";

/** p1: the Cauldron, a Bear carrying a `+1/+1` counter (and whatever else the
 *  case needs), and Grist in exile linked to the Cauldron — exactly where the
 *  Cauldron's own `{T}` ability leaves a card it exiled from a graveyard.
 *  `makeState` defaults are already the CR 606.3 window: p1 active, p1 holding
 *  priority, PRECOMBAT_MAIN, empty stack. */
function board(counters: Record<string, number> = { "+1/+1": 1 }): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(CAULDRON, {
                        id: "cauldron",
                        controllerId: "p1",
                        staticSeq: 1,
                    }),
                    makeInstance(BEARS, {
                        id: "recipient",
                        controllerId: "p1",
                        staticSeq: 2,
                        counters,
                    }),
                ],
                exile: [
                    makeInstance(GRIST, {
                        id: "exiled-grist",
                        zone: "exile",
                        controllerId: "p1",
                        exiledBySourceId: "cauldron",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    syncLayer6(state);
    return state;
}

function recipient(state: GameState) {
    return getPlayer(state, "p1").battlefield.find(
        (c) => c.id === "recipient"
    )!;
}

function projectedRecipient(state: GameState): CardInstance {
    return projectPublicState(state, 1, "p1")
        .players.flatMap((p) => p.battlefield)
        .find((c) => c.id === "recipient") as unknown as CardInstance;
}

describe("a loyalty ability granted to a creature (CR 606.2, issue #3299)", () => {
    it("offers ONLY the non-negative cost to the client while the creature has no loyalty", () => {
        // CR 606.6 — the two negative costs cannot be paid at 0 loyalty, so the
        // client's hint list narrows to the `+1`. That the list is non-empty at
        // all is the #3299 fix: the grant reaches a card that is a creature
        // card only in exile.
        expect(
            getStackAbilities(projectedRecipient(board())).map((a) => a.id)
        ).toEqual([GRIST_PLUS1]);
    });

    it("puts the loyalty counters on THE CREATURE and locks it for the turn (CR 606.3 / 606.4)", () => {
        const state = board();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "recipient",
            abilityId: GRIST_PLUS1,
        });

        const bear = recipient(state);
        // CR 606.4 — the `+1` is paid onto the permanent whose ability it is.
        // The exiled Grist is the ability's SOURCE CARD, never the object the
        // cost touches.
        expect(bear.counters?.loyalty).toBe(1);
        expect(
            getPlayer(state, "p1").exile.find((c) => c.id === "exiled-grist")
                ?.counters?.loyalty ?? 0
        ).toBe(0);
        expect(state.stack).toHaveLength(1);

        // CR 606.3 — at most one loyalty ability of that PERMANENT per turn,
        // and the clause is type-agnostic: it says "a permanent they control".
        // Priority passed to p2 when the ability went on the stack, so hand it
        // back first: otherwise ADR 0047's expected-input gate refuses the
        // second activation before the CR 606 gate is ever consulted, and this
        // assertion would pass on the wrong rule. The stack deliberately stays
        // occupied — `loyaltyActivationViolation` checks the lock BEFORE the
        // timing window, so the lock is what must speak here.
        state.priorityPlayerId = "p1";
        refreshExpectedInput(state);
        expect(recipient(state).loyaltyActivatedThisTurn).toBe(true);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "recipient",
                abilityId: GRIST_PLUS1,
            })
        ).toThrow(/already been activated this turn/);
    });

    it("refuses a negative cost the creature cannot pay and allows it once it can (CR 606.6)", () => {
        const broke = board();
        expect(() =>
            activateAbilityOnState(broke, {
                playerId: "p1",
                cardInstanceId: "recipient",
                abilityId: GRIST_MINUS2,
            })
        ).toThrow(/Not enough loyalty/);

        const funded = board({ "+1/+1": 1, loyalty: 2 });
        // The client offers all three now — `-5` is still unaffordable.
        expect(
            getStackAbilities(projectedRecipient(funded)).map((a) => a.id)
        ).toEqual([GRIST_PLUS1, GRIST_MINUS2]);
        activateAbilityOnState(funded, {
            playerId: "p1",
            cardInstanceId: "recipient",
            abilityId: GRIST_MINUS2,
        });
        expect(recipient(funded).counters?.loyalty).toBe(0);
    });

    it("never offers a cost no amount of loyalty on hand can pay yet", () => {
        // CR 606.6 again, from the other end: `-5` stays out of the list at 2.
        expect(
            getStackAbilities(
                projectedRecipient(board({ "+1/+1": 1, loyalty: 2 }))
            ).map((a) => a.id)
        ).not.toContain(GRIST_MINUS5);
    });

    it("does NOT put the creature into a graveyard at 0 loyalty (CR 704.5i)", () => {
        const state = board({ "+1/+1": 1, loyalty: 2 });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "recipient",
            abilityId: GRIST_MINUS2,
        });
        checkStateBasedActions(state);
        // CR 704.5i is a PLANESWALKER state-based action ("if a planeswalker
        // has loyalty 0") — a 2/2 creature at 0 loyalty is untouched by it.
        expect(recipient(state).counters?.loyalty).toBe(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
    });

    it("shows the loyalty counters to the player through the projection", () => {
        const state = board();
        // Before the activation there is nothing to show ...
        expect(showsLoyalty(projectedRecipient(state))).toBe(false);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "recipient",
            abilityId: GRIST_PLUS1,
        });
        // ... and after it the badge predicate reads the counter THROUGH
        // `projectPublicState`, which is the only shape the client ever sees.
        const projected = projectedRecipient(state);
        expect(projected.counters?.loyalty).toBe(1);
        expect(showsLoyalty(projected)).toBe(true);
    });
});
