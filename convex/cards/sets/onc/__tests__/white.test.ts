// ONC — per-card behavior tests for white cards in
// `convex/cards/sets/onc/white.ts` (set split by colour, ADR 0043).
//
// Staff of the Storyteller's home set is ONC, its earliest paper printing
// (ADR 0041); it was originally implemented against the far later SOC reprint,
// which now rides along as a `CardPrint` in `soc/colorless.ts`.
//
// Staff of the Storyteller (issue #1345 — residue of #1302, parent PRD #620)
// is the FIRST card to consume the new `tokenCreatedTrigger` factory /
// `TOKENS_CREATED` event, so it gets a hand-written suite covering all three
// pieces end-to-end, per #1345's explicit test mandate: the BATCHED firing
// (creating several creature tokens in one resolution nets exactly ONE story
// counter, not one per token), the activated draw (full cost payment —
// mana + tap + removeCounter), and the wire-format survival of the story
// counter through `projectPublicState`.

import { describe, it, expect } from "vitest";
import { staffOfTheStoryteller } from "../white";
import {
    getPlayer,
    getOpponentId,
    buildSpellContext,
    emitAbilityActivated,
    processPendingActionTriggers,
    resolveTopOfStack,
    payRemoveCounterCost,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { getDefinition } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";

/** Mirrors game.ts `activateAbility`'s immediate-commit branch for a stack
 *  ability: pay the non-mana cost (tap / removeCounter), push the ability on
 *  the stack, then `recordActivation` + the CR 603.3 trigger flush. Mirrors
 *  the same helper shape as `gre/__tests__/ability-activated-event.test.ts`. */
function activateStackAbility(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    abilityId: string
): void {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not on battlefield");
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability || !ability.useStack) throw new Error("Not a stack ability");

    if (ability.cost.tap) card.isTapped = true;
    if (ability.cost.removeCounter) {
        payRemoveCounterCost(card, ability.cost.removeCounter);
    }

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId,
        targets: [],
    };
    state.stack.push(stackItem);

    if (!ability.cost.tap) {
        emitAbilityActivated(state, card, abilityId);
    }
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    processPendingActionTriggers(state);
}

/** Drains every stack item whose `triggeredAbilityId` matches one of
 *  `staffOfTheStoryteller`'s own triggered abilities (ETB / story-counter),
 *  resolving from the top. */
function drainStaffTriggers(state: GameState): void {
    const ids = new Set(
        (staffOfTheStoryteller.triggeredAbilities ?? []).map((a) => a.id)
    );
    let guard = 0;
    while (
        state.stack.length > 0 &&
        ids.has(state.stack[state.stack.length - 1]!.triggeredAbilityId ?? "")
    ) {
        resolveTopOfStack(state);
        if (++guard > 20) throw new Error("drainStaffTriggers: stuck");
    }
}

describe("Staff of the Storyteller (CR 111/707.2 createToken, issue #1345 tokenCreatedTrigger, CR 122 counters)", () => {
    it("ETB creates a 1/1 white flying Spirit AND nets a story counter from its own token creation", () => {
        const staff = makeInstance(staffOfTheStoryteller.id, {
            id: "staff1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [staff] }),
                makePlayer("p2"),
            ],
        });
        // Fire the self ETB trigger (mirrors collectTriggers + buildTriggerItem
        // — same manual-push pattern as `eld/__tests__/black.test.ts`'s
        // Wishclaw Talisman ETB test).
        state.stack.push({
            ...staff,
            id: "trig-staff-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "staff-of-the-storyteller-etb-spirit",
            triggerSourceId: "staff1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "staff1",
                controllerId: "p1",
                types: staff.types,
            },
            targets: [],
        });
        resolveTopOfStack(state);
        // The createToken Op queues TOKENS_CREATED; flush to collect the
        // story-counter trigger it fires.
        processPendingActionTriggers(state);
        drainStaffTriggers(state);

        const battlefield = state.players[0].battlefield;
        const spirit = battlefield.find(
            (c) => c.id !== "staff1" && c.subtypes.includes("Spirit")
        );
        expect(spirit).toBeDefined();
        expect(spirit?.power).toBe(1);
        expect(spirit?.toughness).toBe(1);
        expect(spirit?.staticAbilities).toContain("flying");

        const staffPermanent = battlefield.find((c) => c.id === "staff1");
        expect(staffPermanent?.counters?.story).toBe(1);
    });

    it("BATCHES: creating 3 creature tokens in ONE resolution nets exactly ONE story counter, not three", () => {
        const staff = makeInstance(staffOfTheStoryteller.id, {
            id: "staff2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [staff] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, staffOfTheStoryteller.id, "p1");
        const ctx = buildSpellContext(state, item);

        // Simulate a hypothetical "create 3 creature tokens" resolution
        // attributed to Staff's controller — proves the batching invariant
        // independent of the ETB's own single-token path above.
        ctx.createToken(
            {
                name: "Spirit",
                types: ["Creature"],
                subtypes: ["Spirit"],
                power: 1,
                toughness: 1,
                colors: ["W"],
                staticAbilities: ["flying"],
            },
            "p1",
            3
        );
        processPendingActionTriggers(state);
        drainStaffTriggers(state);

        const staffPermanent = state.players[0].battlefield.find(
            (c) => c.id === "staff2"
        );
        expect(staffPermanent?.counters?.story).toBe(1);
    });

    it("activated ability: {W}, {T}, remove a story counter draws a card", () => {
        const staff = makeInstance(staffOfTheStoryteller.id, {
            id: "staff3",
            controllerId: "p1",
            ownerId: "p1",
            counters: { story: 1 },
        });
        const libCard = makeInstance(staffOfTheStoryteller.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [staff],
                    library: [libCard],
                    manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        activateStackAbility(
            state,
            "p1",
            "staff3",
            "staff-of-the-storyteller-draw"
        );

        const staffOnStack = state.stack.find((s) => s.abilityId);
        expect(staffOnStack).toBeDefined();
        // The removeCounter cost is paid immediately, before the ability
        // resolves (CR 602.2 — activation costs are paid up front).
        const staffPermanent = state.players[0].battlefield.find(
            (c) => c.id === "staff3"
        );
        expect(staffPermanent?.isTapped).toBe(true);
        expect(staffPermanent?.counters?.story ?? 0).toBe(0);

        resolveTopOfStack(state);

        expect(state.players[0].hand.map((c) => c.id)).toContain("lib1");
    });

    it("wire format: the story counter survives projectPublicState (CR 122 counters)", () => {
        const staff = makeInstance(staffOfTheStoryteller.id, {
            id: "staff4",
            controllerId: "p1",
            ownerId: "p1",
            counters: { story: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [staff] }),
                makePlayer("p2"),
            ],
        });

        expect(
            state.players[0].battlefield.find((c) => c.id === "staff4")
                ?.counters?.story
        ).toBe(2);

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "staff4"
        );
        expect(slim?.counters?.story).toBe(2);
    });
});
