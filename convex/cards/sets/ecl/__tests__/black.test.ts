// ECL — black card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { moonshadow, ironShieldElf } from "../black";
import { balduvianBears } from "../../ice";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    removePermanentTo,
    discardToGraveyard,
    emitPermanentEntered,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type StackItem,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

// Moonshadow — {B} Creature — Elemental (CR 702.111 menace; CR 122.1
// -1/-1 counters; CR 603.2 zone-change triggers).
describe("Moonshadow (CR 702.111 menace; CR 122.1 counters; CR 603.2 graveyard-from-anywhere trigger)", () => {
    function setup() {
        const shadow = makeInstance(moonshadow.id, {
            id: "shadow",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = makeInstance(balduvianBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [shadow, other],
                    hand: [
                        makeInstance(balduvianBears.id, {
                            id: "hand-permanent",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        return { state, shadow, other };
    }

    it("shape: 7/7 for {B} with menace and two triggered abilities declared", () => {
        expect(moonshadow.manaCost).toEqual({ B: 1 });
        expect(moonshadow.power).toBe(7);
        expect(moonshadow.toughness).toBe(7);
        expect(moonshadow.staticAbilities).toContain("menace");
        // The enters-with-counters trigger + ONE "put into graveyard from
        // anywhere" trigger listening on both PERMANENT_LEFT and CARD_DISCARDED
        // via an array `event` (CR 603.2) — not two near-duplicate entries.
        expect(moonshadow.triggeredAbilities).toHaveLength(2);
        const removeCounter = moonshadow.triggeredAbilities!.find(
            (a) => a.id === "moonshadow-remove-counter"
        )!;
        expect(removeCounter.event).toEqual([
            "PERMANENT_LEFT",
            "CARD_DISCARDED",
        ]);
    });

    it("enters the battlefield with six -1/-1 counters", () => {
        const { state, shadow } = setup();
        emitPermanentEntered(state, shadow);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(6);
    });

    it("removes a -1/-1 counter when a permanent card it owns dies (battlefield → graveyard)", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(5);
    });

    it("does NOT fire for a permanent leaving to a non-graveyard zone (e.g. bounce)", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        removePermanentTo(state, "other", "hand");
        processPendingActionTriggers(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(6);
    });

    it("removes a -1/-1 counter when the controller discards a permanent card from hand", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        discardToGraveyard(state, "p1", "hand-permanent");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(5);
    });

    it("CR 603.3b — removes exactly ONE -1/-1 counter when two permanent cards die simultaneously in the same batch (issue #928)", () => {
        const { state, shadow } = setup();
        shadow.counters = { "-1/-1": 6 };
        const third = makeInstance(balduvianBears.id, {
            id: "third",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(third);
        // Both departures are queued to `pendingEvents` BEFORE the drain, the
        // same shape a board wipe produces: one action, N simultaneous
        // PERMANENT_LEFT events, drained together by a single
        // `processPendingActionTriggers` call.
        removePermanentTo(state, "other", "graveyard");
        removePermanentTo(state, "third", "graveyard");
        processPendingActionTriggers(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        // "One or more permanent cards" triggers once per batch, not once per
        // card (CR 603.3b) — 6 - 1 = 5, NOT 6 - 2 = 4.
        expect(live.counters?.["-1/-1"]).toBe(5);
    });

    it("clamps at zero (no counter to remove) instead of going negative", () => {
        const { state } = setup();
        // No counters seeded — the trigger's remove is a safe no-op.
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"] ?? 0).toBe(0);
    });

    it("wire format: the remaining -1/-1 counter count survives projectPublicState", () => {
        const { state } = setup();
        state.players[0].battlefield.find((c) => c.id === "shadow")!.counters =
            { "-1/-1": 6 };
        removePermanentTo(state, "other", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find(
            (c) => c.id === "shadow"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(5);
    });
});

// Iron-Shield Elf — {1}{B} Creature — Elf Warrior, 3/1 (CR 702.12
// indestructible, CR 701.26 tap, CR 602.1/118.3 discard cost). The
// discard-cost payment machinery itself (`discardFilter`, deferred
// pendingActivation) is already exercised generically by
// `gre/__tests__/discard-filter-cost-activation.test.ts` (Survival of the
// Fittest); this describe block is the card's own per-card test the DSL
// smoke sweep asked for (`grantAbility` targeting `$source` — the sweep
// can't auto-derive a scenario for a self-targeted temporary keyword grant,
// per-Op regime, ADR 0046) — so the cost is paid directly via
// `discardToGraveyard` before pushing the stack item, mirroring
// `sacrificeSelfActivated` (nem/__tests__/red.test.ts) for a cost that
// isn't "sacrifice this source".
describe("Iron-Shield Elf (CR 702.12 indestructible grant + CR 701.26 tap, discard-filter cost)", () => {
    function setup() {
        const elf = makeInstance(ironShieldElf.id, {
            id: "elf",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
        const discardMe = makeInstance(balduvianBears.id, {
            id: "discard-me",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf], hand: [discardMe] }),
                makePlayer("p2"),
            ],
        });
        return { state, elf };
    }

    function activateDiscardFilterAbility(
        state: ReturnType<typeof makeState>,
        source: CardInstanceState,
        abilityId: string,
        discardedCardId: string
    ): void {
        expect(
            discardToGraveyard(state, source.controllerId, discardedCardId)
        ).toBe(true);
        const stackItem: StackItem = {
            ...structuredClone(source),
            zone: "stack",
            castById: source.controllerId,
            abilityId,
            targets: [],
        };
        state.stack.push(stackItem);
        resolveTopOfStack(state);
    }

    it("definitional: a no-mana discard-a-card activated ability", () => {
        const ability = ironShieldElf.activatedAbilities![0];
        expect(ability.cost.mana).toBeUndefined();
        expect(ability.cost.tap).toBeUndefined();
        expect(ability.cost.discardFilter).toEqual({ filter: {}, count: 1 });
    });

    it("grants indestructible until end of turn and taps itself", () => {
        const { state, elf } = setup();
        activateDiscardFilterAbility(
            state,
            elf,
            "iron-shield-elf-discard",
            "discard-me"
        );
        const live = state.players[0].battlefield.find((c) => c.id === "elf")!;
        expect(live.staticAbilities).toContain("indestructible");
        expect(live.isTapped).toBe(true);
        // The discard cost was actually paid (CR 118.3).
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "discard-me")
        ).toBe(true);
    });

    it("wire format: the temporary indestructible grant survives projectPublicState", () => {
        const { state, elf } = setup();
        activateDiscardFilterAbility(
            state,
            elf,
            "iron-shield-elf-discard",
            "discard-me"
        );
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(live.staticAbilities).toContain("indestructible");
        expect(live.isTapped).toBe(true);
    });
});
