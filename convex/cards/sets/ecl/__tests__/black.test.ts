// ECL — black card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { moonshadow, ironShieldElf, twilightDiviner } from "../black";
import { balduvianBears, aurochs } from "../../ice";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    buildSpellContext,
    removePermanentTo,
    discardToGraveyard,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type StackItem,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../../../../gre/serialize";

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

    // CR 121.6 / 614.1c (issue #1693) — a printed 7/7 that enters with six
    // -1/-1 counters is a 1/1 the first instant it is observable. As an ETB
    // TRIGGER it briefly sat on the battlefield as a real 7/7 with a
    // respondable stack item pending; as a replacement there is no such
    // window, and the layer system / SBAs see 1/1 on their first read.
    it("enters the battlefield with six -1/-1 counters already on it, nothing on the stack", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, moonshadow.id, "p1");
        resolveTopOfStack(state);

        const live = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === moonshadow.id
        )!;
        expect(live.counters?.["-1/-1"]).toBe(6);
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(1);
        // No stack item was created for the placement, before OR after the
        // engine drains the PERMANENT_ENTERED event through its trigger scan.
        expect(state.stack).toEqual([]);
        processPendingActionTriggers(state);
        expect(state.stack).toEqual([]);

        // Wire format — re-run the same assertions THROUGH the projection, so
        // a dropped field can't hide the intermediate-zero-state bug client
        // side (the board renders counters and effective P/T from this).
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === live.id
        )!;
        expect(slim.counters?.["-1/-1"]).toBe(6);
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
        expect(projected.stack).toEqual([]);
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

// Twilight Diviner — {2}{B} Elf Cleric 3/3 (ECL, issue #1533). "When this
// creature enters, surveil 2. Whenever one or more other creatures you control
// enter, if they entered or were cast from a graveyard, create a token that's
// a copy of one of them. This ability triggers only once each turn."
//
// The graveyard-entry token-copy ability rides the NEW
// `PERMANENT_ENTERED.enteredFromGraveyard` provenance flag (issue #1533),
// stamped at the graveyard reanimation chokepoints (`returnToBattlefield` from
// a graveyard) and the cast-from-graveyard chokepoint
// (`finalizeSpellResolution` → `castFromGraveyard`). These tests prove the
// flag is set on a graveyard reanimation and NOT on an exile return, and that
// the full trigger fires and creates a token copy of the entering creature.
describe("Twilight Diviner (CR 701.25 ETB surveil 2; CR 603.4 graveyard-entry token copy)", () => {
    function setup() {
        const diviner = makeInstance(twilightDiviner.id, {
            id: "diviner",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [diviner] }),
                makePlayer("p2"),
            ],
        });
        return { state, diviner };
    }

    it("stamps enteredFromGraveyard on a graveyard reanimation, not on an exile return", () => {
        const { state } = setup();
        const corpse = makeInstance(balduvianBears.id, {
            id: "corpse",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].graveyard.push(corpse);
        const exiled = makeInstance(balduvianBears.id, {
            id: "exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        state.players[0].exile.push(exiled);

        const item = pushSpell(state, balduvianBears.id, "p1");
        const ctx = buildSpellContext(state, item);

        expect(ctx.returnToBattlefield("p1", "corpse", "graveyard")).toBe(true);
        expect(ctx.returnToBattlefield("p1", "exiled", "exile")).toBe(true);

        const entered = (state.pendingEvents ?? []).filter(
            (e) => e.type === "PERMANENT_ENTERED"
        );
        const corpseEvent = entered.find((e) => e.instanceId === "corpse");
        const exiledEvent = entered.find((e) => e.instanceId === "exiled");
        expect(corpseEvent?.enteredFromGraveyard).toBe(true);
        expect(exiledEvent?.enteredFromGraveyard).toBeUndefined();
    });

    it("creates a token copy of another creature that entered from your graveyard", () => {
        const { state } = setup();
        const corpse = makeInstance(balduvianBears.id, {
            id: "corpse",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].graveyard.push(corpse);

        const item = pushSpell(state, balduvianBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        expect(ctx.returnToBattlefield("p1", "corpse", "graveyard")).toBe(true);

        // Drop the filler spell (it was only needed to build the SpellContext),
        // then drain the PERMANENT_ENTERED event through the trigger scan.
        state.stack = [];
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "twilight-diviner-graveyard-copy"
            )
        ).toBe(true);
        while (state.stack.length > 0) resolveTopOfStack(state);

        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect((tokens[0].card as { id?: string }).id).toBe(balduvianBears.id);
    });

    it("offers a choice across a simultaneous graveyard batch (CR 603.3b + 707.2, issue #2954)", () => {
        const { state } = setup();
        // Two DIFFERENT creatures reanimated at once (the Living Death shape),
        // so the token's copied card id proves which one the controller picked.
        const corpseA = makeInstance(balduvianBears.id, {
            id: "corpseA",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const corpseB = makeInstance(aurochs.id, {
            id: "corpseB",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].graveyard.push(corpseA, corpseB);

        const item = pushSpell(state, balduvianBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        const entered = ctx.returnGraveyardSetToBattlefield([
            { playerId: "p1", cardInstanceId: "corpseA" },
            { playerId: "p1", cardInstanceId: "corpseB" },
        ]);
        expect(entered).toHaveLength(2);

        // Drop the filler spell, then drain the simultaneous PERMANENT_ENTERED
        // batch through the trigger scan: ONE trigger carrying BOTH events.
        state.stack = [];
        processPendingActionTriggers(state);
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "twilight-diviner-graveyard-copy"
        );
        expect(trigger).toBeDefined();
        expect(trigger!.triggerEventBatch).toHaveLength(2);

        // Resolve: the controller must choose which entering creature to copy.
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-permanents");
        expect(head?.candidateIds).toEqual(
            expect.arrayContaining(["corpseA", "corpseB"])
        );

        // The pending-choice stable-save point must preserve the full batch, or
        // a reload collapses back to the first staged creature (CR 603.3b).
        const reloaded = expandState(compactState(state));
        const reloadedTrigger = reloaded.stack.find(
            (s) => s.triggeredAbilityId === "twilight-diviner-graveyard-copy"
        );
        expect(reloadedTrigger?.triggerEventBatch).toHaveLength(2);

        // Pick the Aurochs.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["corpseB"],
        });

        // Exactly one token, a copy of the CHOSEN creature.
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect((tokens[0].card as { id?: string }).id).toBe(aurochs.id);
    });

    it("does not trigger for a creature that enters from exile", () => {
        const { state } = setup();
        const exiled = makeInstance(balduvianBears.id, {
            id: "exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        state.players[0].exile.push(exiled);

        const item = pushSpell(state, balduvianBears.id, "p1");
        const ctx = buildSpellContext(state, item);
        expect(ctx.returnToBattlefield("p1", "exiled", "exile")).toBe(true);

        state.stack = [];
        processPendingActionTriggers(state);
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId === "twilight-diviner-graveyard-copy"
            )
        ).toBe(false);
    });
});
