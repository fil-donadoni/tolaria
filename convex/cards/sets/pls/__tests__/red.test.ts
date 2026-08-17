// Planeshift (PLS) — red behavior tests (ADR 0043 colour split, issue #1951,
// F4 free tranche). Per the per-Op regime (ADR 0045/0046), most cards in this
// slice reuse only already-exercised Ops (dealDamage, destroy, draw,
// setSubtype, setColor, pump, grantAbility, choice/discard, the kicker
// `if { kickerCount }` / `if { kickerPaid }` branch idiom) and need no
// hand-written test — the catalogue-wide static sweep
// (`effectScripts.test.ts`) and the auto-generated canned-scenario smoke test
// (`effectScriptSmoke.test.ts`) cover them for free.
//
// This file covers the cards that DO need hand-written coverage:
//   - `resolve()` cards (mandatory full regime): Insolence, Keldon Mantle,
//     Planeswalker's Fury, Tahngarth.
//   - Magma Burst and Thunderscape Battlemage: not new Ops, but genuinely new
//     CONSTRUCT COMBINATIONS worth a confirming test — a Kicker with a
//     non-mana PERMANENT (sacrifice) leg widening the target COUNT, and the
//     first catalogue card with TWO independently payable Kickers gated by
//     `{ kickerPaid: "<id>" }` respectively.

import { describe, it, expect } from "vitest";
import {
    calderaKavu,
    insolence,
    kavuRecluse,
    keldonMantle,
    magmaBurst,
    mireKavu,
    moggJailer,
    moggSentry,
    planeswalkersFury,
    singe,
    tahngarthTalruumHero,
    thunderscapeBattlemage,
    thunderscapeFamiliar,
} from "../red";
import {
    darkRitual,
    giantGrowth,
    grizzlyBears,
    savannahLions,
    swamp,
} from "../../lea";
import { ephemerate } from "../../mh1/white";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    tapPermanent,
    emitPermanentTapped,
    getCostModifiers,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { applyOneTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";
import { kickerPaidCondition } from "../../../abilities/triggers/shared";
import { getEffectiveColors } from "../../../effectiveColors";
import type { PermanentView } from "../../../types";

/** Pushes an activated ability directly onto the stack with its cost assumed
 *  already paid, then resolves it — the `resolveActivated` shim used
 *  throughout the catalogue's per-set test files (tmp/colorless.test.ts). */
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

/** Collects triggers off pendingEvents and pushes the first one matching
 *  `triggeredAbilityId` onto the stack (the `collectAndStack` shim,
 *  `ice/__tests__/helpers.ts`). */
function collectAndStack(
    state: GameState,
    triggeredAbilityId: string
): StackItem | undefined {
    const events = state.pendingEvents ?? [];
    state.pendingEvents = undefined;
    const trig = collectTriggers(state, events).find(
        (t) => t.triggeredAbilityId === triggeredAbilityId
    );
    if (trig) state.stack.push(trig);
    return trig;
}

describe("Mogg Jailer — card-level attack restriction (CR 508.1c)", () => {
    it("can't attack while the defending player controls an untapped creature with power 2 or less", () => {
        const jailer = makeInstance(moggJailer.id, {
            id: "jailer",
            controllerId: "p1",
        });
        const small = makeInstance(savannahLions.id, {
            id: "small",
            controllerId: "p2",
            power: 2,
        });
        const restriction = moggJailer.staticEffects!.find(
            (e) => e.kind === "attack-restriction"
        ) as { predicate: (self: unknown, bf: unknown[]) => boolean };
        const smallView = {
            id: small.id,
            types: small.types,
            isTapped: false,
            power: 2,
        };
        expect(restriction.predicate(jailer, [smallView])).toBe(false);
        expect(
            restriction.predicate(jailer, [{ ...smallView, isTapped: true }])
        ).toBe(true);
        expect(
            restriction.predicate(jailer, [{ ...smallView, power: 3 }])
        ).toBe(true);
    });
});

describe("Mire Kavu — board-conditional +1/+1 (Kird Ape shape, CR 611/613)", () => {
    it("gets +1/+1 only while its controller controls a Swamp", () => {
        const kavu = makeInstance(mireKavu.id, {
            id: "kavu",
            controllerId: "p1",
        });
        const stateNoSwamp = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(stateNoSwamp, kavu)).toBe(3);
        expect(getEffectiveToughness(stateNoSwamp, kavu)).toBe(2);

        const aSwamp = makeInstance(swamp.id, {
            id: "a-swamp",
            controllerId: "p1",
        });
        const stateWithSwamp = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu, aSwamp] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(stateWithSwamp, kavu)).toBe(4);
        expect(getEffectiveToughness(stateWithSwamp, kavu)).toBe(3);

        // Wire format — the projection agrees (mandatory for staticEffects).
        const projected = projectPublicState(stateWithSwamp, 1, "p1");
        const slimKavu = projected.players[0].battlefield.find(
            (c) => c.id === "kavu"
        )!;
        expect(getEffectivePower(projected, slimKavu)).toBe(4);
        expect(getEffectiveToughness(projected, slimKavu)).toBe(3);
    });
});

describe("Insolence — host-scoped becomes-tapped damage (CR 303.4b / 701.20a, resolve() justified)", () => {
    it("deals 2 damage to the enchanted creature's controller when it becomes tapped", () => {
        const host = makeInstance(savannahLions.id, {
            id: "host",
            controllerId: "p2",
        });
        const aura = makeInstance(insolence.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { life: 20, battlefield: [host] }),
            ],
        });
        tapPermanent(state, host);
        emitPermanentTapped(state, host, false);
        const trig = collectAndStack(state, "insolence-tapped");
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        // p2 (the HOST's controller) takes the damage, not p1 (Insolence's
        // own controller) — proves the resolve() reads `tapped.controllerId`.
        expect(state.players[1].life).toBe(18);
    });

    it("does NOT fire when a different permanent becomes tapped (host scope)", () => {
        const host = makeInstance(savannahLions.id, {
            id: "host2",
            controllerId: "p2",
        });
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p2",
        });
        const aura = makeInstance(insolence.id, {
            id: "aura2",
            controllerId: "p1",
            attachedTo: "host2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { life: 20, battlefield: [host, other] }),
            ],
        });
        tapPermanent(state, other);
        emitPermanentTapped(state, other, false);
        const events = state.pendingEvents ?? [];
        const trig = collectTriggers(state, events).find(
            (t) => t.triggeredAbilityId === "insolence-tapped"
        );
        expect(trig).toBeUndefined();
    });
});

describe("Keldon Mantle — three host-scoped activated abilities (getAttachedTo, resolve() justified)", () => {
    function setup() {
        const host = makeInstance(savannahLions.id, {
            id: "host",
            controllerId: "p1",
        });
        const mantle = makeInstance(keldonMantle.id, {
            id: "mantle",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mantle, host] }),
                makePlayer("p2"),
            ],
        });
        return { state, mantle };
    }

    it("{R}: pumps the ENCHANTED creature (not the Aura) +1/+0 until end of turn", () => {
        const { state, mantle } = setup();
        resolveActivated(state, mantle, "keldon-mantle-pump");
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(1);
        // Wire format — visible board state.
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(3);
    });

    it("{G}: grants the enchanted creature trample until end of turn", () => {
        const { state, mantle } = setup();
        resolveActivated(state, mantle, "keldon-mantle-trample");
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.staticAbilities).toContain("trample");
    });

    it("{B}: applies a regeneration shield to the enchanted creature", () => {
        const { state, mantle } = setup();
        resolveActivated(state, mantle, "keldon-mantle-regenerate");
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Planeswalker's Fury — random reveal → damage equal to mana value (CR 602.1 / 701.20a, resolve() justified)", () => {
    it("forced (one-card hand) reveal deals damage equal to that card's mana value", () => {
        const fury = makeInstance(planeswalkersFury.id, {
            id: "fury",
            controllerId: "p1",
        });
        const opp = makeInstance(grizzlyBears.id, {
            id: "opp-card",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fury] }),
                makePlayer("p2", { life: 20, hand: [opp] }),
            ],
        });
        resolveActivated(state, fury, "planeswalkers-fury-burn", [
            { type: "player", id: "p2" },
        ]);
        // Grizzly Bears is {1}{G} — mana value 2.
        expect(state.players[1].life).toBe(18);
        // The revealed card is only shown, never moved out of hand.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["opp-card"]);
    });

    it("empty hand: nothing is revealed, so no damage (CR 608.2b)", () => {
        const fury = makeInstance(planeswalkersFury.id, {
            id: "fury2",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fury] }),
                makePlayer("p2", { life: 20, hand: [] }),
            ],
        });
        resolveActivated(state, fury, "planeswalkers-fury-burn", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Tahngarth, Talruum Hero — mutual power-for-power damage (CR 701.14, resolve() justified, established fight() gap)", () => {
    it("deals damage equal to its power to the target, which deals its own power back", () => {
        const tahngarth = makeInstance(tahngarthTalruumHero.id, {
            id: "tahngarth",
            controllerId: "p1",
        });
        // A 2/2 target: takes 4 (lethal), deals 2 back to Tahngarth (4/4,
        // survives with 2 marked damage).
        const target = makeInstance(savannahLions.id, {
            id: "target",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tahngarth] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, tahngarth, "tahngarth-fight", [
            { type: "permanent", id: "target" },
        ]);
        // The 2/2 took 4 damage — lethal, destroyed.
        expect(
            state.players[1].battlefield.some((c) => c.id === "target")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "target")).toBe(
            true
        );
        // Tahngarth took 2 — survives (4 toughness).
        const survivor = state.players[0].battlefield.find(
            (c) => c.id === "tahngarth"
        )!;
        expect(survivor.damageMarked ?? 0).toBe(2);
    });
});

describe("Magma Burst — sacrifice-two-lands Kicker widens the target count (CR 702.33a / 601.2c)", () => {
    it("unkicked deals 3 to the single announced target only", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        pushSpell(state, magmaBurst.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
        expect(state.players[0].life).toBe(20);
    });

    it("kicked deals 3 to EACH of two announced targets", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, magmaBurst.id, "p1", [
            { type: "player", id: "p2" },
            { type: "player", id: "p1" },
        ]);
        // Simulates the sacrifice-two-lands Kicker having been paid at
        // announcement (the actual sacrifice payment is engine-wide covered
        // elsewhere — `resolveKickerPayments`/`canPayKickerLegs`); this card's
        // own behavior under test is the branch on the recorded payment.
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // target 0
        expect(state.players[0].life).toBe(17); // target 1 (kicked only)
    });
});

// Thunderscape Battlemage — the catalogue's first TWO-Kicker "and/or" card
// (ADR 0079/#1937). Each ETB trigger is gated per-Kicker at CHECK time
// (`kickerPaidCondition`, CR 603.4) and again at RESOLUTION time by the
// `if { kickerPaid: "<id>" }` branch inside its own `effects[]` (already
// exercised generically by `interpreter.test.ts`), but this is the first CARD
// exercising two INDEPENDENT Kickers gating two INDEPENDENT triggers on one
// creature — worth a confirming test per the project's "genuinely new
// construct combination" bar, even though no new Op is introduced.
const BM_ENCHANTMENT_ID = "test-pls-battlemage-enchantment";
registerTokenDefinition({
    id: BM_ENCHANTMENT_ID,
    name: BM_ENCHANTMENT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Enchantment"],
});

describe("Thunderscape Battlemage — two independent Kickers, two independently gated ETB triggers", () => {
    function bmTrigger(
        state: GameState,
        battlemage: CardInstanceState,
        triggeredAbilityId: string,
        targets: StackItem["targets"]
    ): StackItem {
        const trig: StackItem = {
            ...battlemage,
            id: `${triggeredAbilityId}-item`,
            zone: "stack",
            castById: battlemage.controllerId,
            triggeredAbilityId,
            triggerSourceId: battlemage.id,
            // `resolveTopOfStackInner` (`gre/state.ts`) only dispatches a
            // triggered-ability stack item when `triggerEvent` is present
            // (the Fury precedent, `mh2/__tests__/red.test.ts`'s
            // `furyEtbOnStack`) — without it the item falls through to a
            // fallback path that re-resolves the source as a fresh permanent
            // spell, refiring BOTH ETB triggers.
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: battlemage.id,
                controllerId: battlemage.controllerId,
                types: battlemage.types,
            } as StackItem["triggerEvent"],
            targets,
        };
        state.stack.push(trig);
        return trig;
    }

    it("unkicked: neither trigger does anything even though both still announce a target", () => {
        const bm = makeInstance(thunderscapeBattlemage.id, {
            id: "bm",
            controllerId: "p1",
        });
        const enchantment = makeInstance(BM_ENCHANTMENT_ID, {
            id: "ench",
            controllerId: "p2",
        });
        const filler = makeInstance(grizzlyBears.id, {
            id: "filler",
            controllerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm] }),
                makePlayer("p2", {
                    battlefield: [enchantment],
                    hand: [filler],
                }),
            ],
        });
        bmTrigger(state, bm, "thunderscape-battlemage-discard", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(1);

        bmTrigger(state, bm, "thunderscape-battlemage-destroy", [
            { type: "permanent", id: "ench" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.some((c) => c.id === "ench")).toBe(
            true
        );
    });

    it("kicked with the {1}{B} kicker only: the discard trigger fires, the destroy trigger does not", () => {
        const bm = makeInstance(thunderscapeBattlemage.id, {
            id: "bm2",
            controllerId: "p1",
        });
        // `kickerPayments` lives on `StackItem`/`PendingCast`, not on the
        // plain `CardInstanceState` base type — assigned via the same
        // type-widened precedent `inv/__tests__/red.test.ts` uses to simulate
        // "this permanent's spell was cast kicked" on an already-resolved
        // permanent (the real path copies it via `buildTriggerItem`'s
        // `...self` spread, `gre/triggers.ts`).
        (
            bm as CardInstanceState & {
                kickerPayments?: Record<string, number>;
            }
        ).kickerPayments = { "kicker-b": 1 };
        const enchantment = makeInstance(BM_ENCHANTMENT_ID, {
            id: "ench2",
            controllerId: "p2",
        });
        const filler1 = makeInstance(grizzlyBears.id, {
            id: "filler2a",
            controllerId: "p2",
            zone: "hand",
        });
        const filler2 = makeInstance(grizzlyBears.id, {
            id: "filler2b",
            controllerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm] }),
                makePlayer("p2", {
                    battlefield: [enchantment],
                    hand: [filler1, filler2],
                }),
            ],
        });
        bmTrigger(state, bm, "thunderscape-battlemage-discard", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["filler2a", "filler2b"],
        });
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual(
            ["filler2a", "filler2b"].sort()
        );

        bmTrigger(state, bm, "thunderscape-battlemage-destroy", [
            { type: "permanent", id: "ench2" },
        ]);
        resolveTopOfStack(state);
        // The {G} kicker was never paid — the enchantment survives.
        expect(state.players[1].battlefield.some((c) => c.id === "ench2")).toBe(
            true
        );
    });

    it("kicked with the {G} kicker only: the destroy trigger fires, the discard trigger does not", () => {
        const bm = makeInstance(thunderscapeBattlemage.id, {
            id: "bm3",
            controllerId: "p1",
        });
        (
            bm as CardInstanceState & {
                kickerPayments?: Record<string, number>;
            }
        ).kickerPayments = { "kicker-g": 1 };
        const enchantment = makeInstance(BM_ENCHANTMENT_ID, {
            id: "ench3",
            controllerId: "p2",
        });
        const filler = makeInstance(grizzlyBears.id, {
            id: "filler3",
            controllerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm] }),
                makePlayer("p2", {
                    battlefield: [enchantment],
                    hand: [filler],
                }),
            ],
        });
        bmTrigger(state, bm, "thunderscape-battlemage-discard", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(1); // never discarded

        bmTrigger(state, bm, "thunderscape-battlemage-destroy", [
            { type: "permanent", id: "ench3" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.some((c) => c.id === "ench3")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "ench3")).toBe(
            true
        );
    });

    it("CR 603.4 check-time gate: cast fully unkicked through the REAL cast/ETB path, neither trigger ever hits the stack", () => {
        // Unlike the manually-constructed-trigger tests above, this pushes
        // the CREATURE SPELL itself and lets the real engine path
        // (resolveTopOfStack -> battlefield entry -> collectTriggers via
        // processPendingActionTriggers) decide whether each trigger's
        // `condition` lets it onto the stack at all — the thing the
        // per-Kicker `conditionOnSelf` gate changes (issue #2015).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, thunderscapeBattlemage.id, "p1");
        // No `kickerPayments` set on the stack item — cast fully unkicked.
        resolveTopOfStack(state); // creature resolves, enters, triggers scanned
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    // ── CR 603.10 LKI across a blink (PR #2039 review) ────────────────────
    //
    // Why this test exists: the per-Kicker predicate is CHECK-TIME ONLY. It
    // was briefly ALSO declared as each ability's `interveningIf`, on the
    // (false) reasoning that a one-shot cast fact can never change, so the
    // re-check "can only agree". It can disagree, and this is the case where
    // it does. `resolveTopOfStackInner` (`gre/state.ts`) resolves an
    // `interveningIf` against the LIVE battlefield permanent located by
    // `triggerSourceId`, falling back to the stack item's own last known
    // information ONLY when the source is not on the battlefield. Instance ids
    // survive a CR 400.7 return (`stageReanimatedOnBattlefield` mutates the
    // same object), and that path runs `resetBattlefieldTransientState`, which
    // deletes `kickerPayments`. So a Battlemage blinked while its ETB trigger
    // sits on the stack is re-found by id with a CLEARED record, and the
    // re-check fizzles a trigger CR 603.10 says must resolve off LKI.
    //
    // Removing a predicate is invisible to a suite that never blinks the
    // source, which is what this test fixes. To confirm it is load-bearing,
    // add an `interveningIf` back to Thunderscape Battlemage's
    // `thunderscape-battlemage-destroy` ability in `pls/red.ts` — either
    // `interveningIf: kickerPaidCondition("kicker-g")` (the shared check-time
    // predicate, re-wired at the wrong seam) or the hand-rolled
    // `(_event, self) => (self.kickerPayments?.["kicker-g"] ?? 0) > 0`. Both
    // make this test fail: the re-check reads the blinked permanent's cleared
    // record, the trigger fizzles, and the enchantment survives.
    it("CR 603.10: a kicked Battlemage blinked while its ETB trigger is on the stack still resolves that trigger off LKI", () => {
        const bm = makeInstance(thunderscapeBattlemage.id, {
            id: "blink-bm",
            controllerId: "p1",
            ownerId: "p1",
        });
        (
            bm as CardInstanceState & {
                kickerPayments?: Record<string, number>;
            }
        ).kickerPayments = { "kicker-g": 1 };
        const enchantment = makeInstance(BM_ENCHANTMENT_ID, {
            id: "blink-ench",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bm] }),
                makePlayer("p2", { battlefield: [enchantment] }),
            ],
        });

        // The {G} destroy trigger is on the stack, target already announced…
        bmTrigger(state, bm, "thunderscape-battlemage-destroy", [
            { type: "permanent", id: "blink-ench" },
        ]);
        // …and Ephemerate ("Exile target creature you control, then return it
        // to the battlefield", `mh1/white.ts`) resolves ON TOP of it.
        pushSpell(state, ephemerate.id, "p1", [
            { type: "permanent", id: "blink-bm" },
        ]);
        resolveTopOfStack(state);

        // The blink brought the SAME instance id back (CR 400.7 makes it a new
        // OBJECT, but the engine reuses the row) with its per-Kicker record
        // wiped — the exact state an `interveningIf` would misread.
        const returned = state.players[0].battlefield.find(
            (c) => c.id === "blink-bm"
        );
        expect(returned).toBeDefined();
        expect(
            (returned as CardInstanceState & { kickerPayments?: unknown })
                .kickerPayments
        ).toBeUndefined();
        // The returned permanent is unkicked, so the CHECK-TIME gate correctly
        // raises no fresh ETB trigger for it.
        expect(
            state.stack.filter((s) => s.triggeredAbilityId !== undefined)
        ).toHaveLength(1);

        resolveTopOfStack(state);

        // The trigger resolved off its own last known information — the
        // enchantment is destroyed, and nothing fizzled.
        expect(
            state.players[1].battlefield.some((c) => c.id === "blink-ench")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "blink-ench")
        ).toBe(true);
        expect(
            (state.pendingEvents ?? []).some(
                (e) => e.type === "TRIGGER_FIZZLED"
            )
        ).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// CR 603.4 per-Kicker check-time gate (issue #2015).
//
// The gate the issue is about lives in `matches`, so it is only observable
// through the REAL cast path: push the creature SPELL, let it resolve and
// enter, and let `collectTriggers` decide which of the two ETB abilities is
// allowed onto the stack. The rows below are the producer census turned into
// tests — one per (kickers paid) × (trigger) cell, INCLUDING the must-NOT
// cells, which are the whole point: a trigger whose Kicker was not paid must
// never reach the stack, never announce a target, and therefore never emit a
// `BECAME_TARGET` event (`emitBecameTargetEvents`, `gre/rules.ts`) for an
// ability CR 603.4 says never came into being.
//
// `BECAME_TARGET` is witnessed END-TO-END rather than by inspecting
// `state.pendingEvents` (which the engine drains as it goes): a witness
// creature on the opponent's board carries a "whenever a player becomes the
// target of an ability" trigger that gains its controller 5 life. That is
// exactly the harm the issue describes — a ward / became-target effect taxing
// a controller for a phantom announcement — expressed as an assertion.
// ─────────────────────────────────────────────────────────────────────────
const BM_WITNESS_ID = "test-pls-battlemage-target-witness";
registerTokenDefinition({
    id: BM_WITNESS_ID,
    name: BM_WITNESS_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "bm-witness-player-became-target",
            oracleText:
                "Whenever a player becomes the target of an ability, you gain 5 life.",
            event: "BECAME_TARGET",
            matches: (event) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "player",
            effects: [{ op: "gainLife", player: "controller", amount: 5 }],
        },
    ],
});

describe("Thunderscape Battlemage — CR 603.4 per-Kicker check-time gate (issue #2015)", () => {
    /** Every queued `BECAME_TARGET` naming a PLAYER — the exact event a phantom
     *  discard-trigger announcement fires (`emitBecameTargetEvents`). Read
     *  before the engine drains `pendingEvents`; the witness creature covers
     *  the already-drained case. */
    function playerBecameTargetEvents(state: GameState) {
        return (state.pendingEvents ?? []).filter(
            (e) => e.type === "BECAME_TARGET" && e.target.type === "player"
        );
    }

    /** Resolves everything left on the stack, answering any pending choice
     *  with the supplied cards, so a trigger collected from a DRAINED event
     *  (the witness) actually resolves. */
    function drainStack(state: GameState, cardInstanceIds: string[]): void {
        let guard = 0;
        while (
            (state.stack.length > 0 ||
                (state.pendingChoices?.length ?? 0) > 0) &&
            guard++ < 10
        ) {
            const head = state.pendingChoices?.[0];
            if (head) {
                applyPendingChoiceSubmit(state, {
                    playerId: head.playerId,
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: head.candidateIds ?? cardInstanceIds,
                });
                continue;
            }
            resolveTopOfStack(state);
        }
    }

    /** Casts the Battlemage through the real path with the given per-Kicker
     *  payment record, resolves the creature spell, and reports which ETB
     *  triggers the engine actually allowed onto the stack. */
    function castKickedWith(payments?: Record<string, number>): {
        state: GameState;
        triggersOnStack: string[];
    } {
        const enchantment = makeInstance(BM_ENCHANTMENT_ID, {
            id: "gate-ench",
            controllerId: "p2",
            ownerId: "p2",
        });
        const witness = makeInstance(BM_WITNESS_ID, {
            id: "gate-witness",
            controllerId: "p2",
            ownerId: "p2",
        });
        const filler1 = makeInstance(grizzlyBears.id, {
            id: "gate-hand-a",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const filler2 = makeInstance(grizzlyBears.id, {
            id: "gate-hand-b",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [enchantment, witness],
                    hand: [filler1, filler2],
                    life: 20,
                }),
            ],
        });
        const item = pushSpell(state, thunderscapeBattlemage.id, "p1");
        if (payments) item.kickerPayments = payments;
        resolveTopOfStack(state);
        // CR 603.3b — when BOTH triggers fire from the same event the engine
        // suspends on a `trigger-order` PendingChoice and holds the batch
        // off-stack; submit the ordering so the census below sees the stack.
        // (Which is itself a gate assertion: with only one Kicker paid there
        // is only one trigger, so no ordering choice is ever raised.)
        resolveTriggerOrder(state);
        return {
            state,
            triggersOnStack: state.stack
                .map((s) => s.triggeredAbilityId)
                .filter((id): id is string => id !== undefined),
        };
    }

    it("unkicked: NEITHER trigger reaches the stack (no target announced at all)", () => {
        const { state, triggersOnStack } = castKickedWith();
        expect(triggersOnStack).toEqual([]);
        expect(state.pendingTarget).toBeUndefined();
        expect(playerBecameTargetEvents(state)).toEqual([]);
        expect(state.players[1].life).toBe(20); // no BECAME_TARGET witnessed
    });

    it("kicked with {G} ONLY: the destroy trigger reaches the stack; the {1}{B} discard trigger does NOT, and announces no player target", () => {
        const { state, triggersOnStack } = castKickedWith({ "kicker-g": 1 });
        expect(triggersOnStack).toEqual(["thunderscape-battlemage-destroy"]);
        expect(triggersOnStack).not.toContain(
            "thunderscape-battlemage-discard"
        );
        // The regression this issue exists for: the discard trigger used to
        // ride onto the stack on the aggregate `wasKicked` flag and prompt for
        // "target player", firing a real BECAME_TARGET on the chosen player.
        expect(state.pendingTarget?.targetType).not.toBe("player");
        expect(playerBecameTargetEvents(state)).toEqual([]);
        expect(state.players[1].life).toBe(20);
        // The {G} trigger's own target IS announced (sole legal enchantment,
        // auto-selected per CR 603.3d) — the gate suppresses only the unpaid
        // Kicker's trigger, never the paid one.
        const destroyItem = state.stack.find(
            (s) => s.triggeredAbilityId === "thunderscape-battlemage-destroy"
        );
        expect(destroyItem?.targets).toEqual([
            { type: "permanent", id: "gate-ench" },
        ]);
    });

    it("kicked with {1}{B} ONLY: the discard trigger reaches the stack and announces a player target; the {G} destroy trigger does NOT", () => {
        const { state, triggersOnStack } = castKickedWith({ "kicker-b": 1 });
        expect(triggersOnStack).toEqual(["thunderscape-battlemage-discard"]);
        expect(triggersOnStack).not.toContain(
            "thunderscape-battlemage-destroy"
        );
        // Both players are legal "target player" candidates, so a real
        // PendingTarget is raised (CR 603.3d does not auto-select here).
        expect(state.pendingTarget?.targetType).toBe("player");
        // Choosing a player DOES fire BECAME_TARGET — the witness proves the
        // event path is live, so the must-NOT rows above are meaningful
        // absence, not a dead observation.
        applyOneTargetSelection(state, "p1", {
            targetType: "player",
            targetId: "p2",
        });
        expect(playerBecameTargetEvents(state)).toHaveLength(1);
        // …and the witness actually collects it once the stack drains, which
        // is what makes its SILENCE in the must-NOT rows above meaningful.
        drainStack(state, ["gate-hand-a", "gate-hand-b"]);
        expect(state.players[1].life).toBe(25);
    });

    it("kicked with BOTH Kickers: both triggers reach the stack", () => {
        const { triggersOnStack } = castKickedWith({
            "kicker-b": 1,
            "kicker-g": 1,
        });
        expect(triggersOnStack.sort()).toEqual([
            "thunderscape-battlemage-destroy",
            "thunderscape-battlemage-discard",
        ]);
    });

    it("wire format: the per-Kicker record survives projectPublicState, so the gate reads the same answer client-side", () => {
        const { state } = castKickedWith({ "kicker-g": 1 });
        const bm = state.players[0].battlefield.find(
            (c) => c.card.id === thunderscapeBattlemage.id
        )!;
        expect(
            kickerPaidCondition("kicker-g")(bm as unknown as PermanentView)
        ).toBe(true);
        expect(
            kickerPaidCondition("kicker-b")(bm as unknown as PermanentView)
        ).toBe(false);

        // `projectPublicState` strips `card.card` to `{ id }` and reshapes the
        // hidden zones; re-run the same assertion on the projected permanent,
        // since the client-side Brain evaluates the very same gate predicate.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === bm.id
        )!;
        expect(
            kickerPaidCondition("kicker-g")(slim as unknown as PermanentView)
        ).toBe(true);
        expect(
            kickerPaidCondition("kicker-b")(slim as unknown as PermanentView)
        ).toBe(false);
    });
});

// Thunderscape Familiar — a `cost-modifier` static effect scoped to TWO
// colours (CR 601.2f), the same static-effect kind as Nightscape Familiar
// (`pls/__tests__/black.test.ts`) and Derelor (`fem/__tests__/black.test.ts`).
describe("Thunderscape Familiar (CR 601.2f cost reduction for black AND green spells, PLS 76)", () => {
    it("reduces the controller's own black and green spells by {1}, but not red or an opponent's", () => {
        const familiar = makeInstance(thunderscapeFamiliar.id, { id: "fam" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const myBlackSpell = makeInstance(darkRitual.id, {
            id: "my-black",
            zone: "hand",
        });
        const myGreenSpell = makeInstance(giantGrowth.id, {
            id: "my-green",
            zone: "hand",
        });
        const myRedSpell = makeInstance(magmaBurst.id, {
            id: "my-red",
            zone: "hand",
        });
        const oppBlackSpell = makeInstance(darkRitual.id, {
            id: "opp-black",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        expect(
            getCostModifiers(state, myBlackSpell, "spell").reductionGeneric
        ).toBe(1);
        expect(
            getCostModifiers(state, myGreenSpell, "spell").reductionGeneric
        ).toBe(1);
        expect(
            getCostModifiers(state, myRedSpell, "spell").reductionGeneric
        ).toBe(0);
        expect(
            getCostModifiers(state, oppBlackSpell, "spell").reductionGeneric
        ).toBe(0);
    });

    it("wire format: the reduction still applies once the source's card is stripped to { id } by projectPublicState", () => {
        const familiar = makeInstance(thunderscapeFamiliar.id, { id: "fam" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [familiar] }),
                makePlayer("p2"),
            ],
        });
        const myGreenSpell = makeInstance(giantGrowth.id, {
            id: "my-green",
            zone: "hand",
        });
        const projected = projectPublicState(state, 1, "p1");
        expect(
            getCostModifiers(
                projected as unknown as GameState,
                myGreenSpell,
                "spell"
            ).reductionGeneric
        ).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Four cards whose scripts the DSL smoke sweep SKIPS individually (a target/
// source shape the canned-scenario generator can't pre-seed or drive to
// completion), even though the Ops themselves are exercised elsewhere in the
// catalogue: Mogg Sentry (`pump` targets `$source` from a TRIGGER, not an
// activated ability), Singe (`setColor` in the same script as `dealDamage`),
// Kavu Recluse (`setSubtype` on an announced Land target), Caldera Kavu
// (`pump` targets `$source` AND a separate `optionChoice` suspends on a mode
// pick, both off the SAME card).
// ---------------------------------------------------------------------------

/** Submits an option-pick answer through the same seam the generic
 *  `submitResolutionChoice` mutation drives (mirrors
 *  `interpreter.test.ts`'s `submitOptionPick`). */
function submitOptionPick(state: GameState, optionId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [optionId],
    });
}

describe("Mogg Sentry (opponent-spell-cast trigger, pump targets $source, CR 603.2 / 611)", () => {
    it("gets +2/+2 until end of turn whenever an opponent casts a spell", () => {
        const sentry = makeInstance(moggSentry.id, {
            id: "sentry",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sentry] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, sentry)).toBe(1);
        expect(getEffectiveToughness(state, sentry)).toBe(1);

        state.stack.push({
            ...sentry,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "mogg-sentry-pump",
            triggerSourceId: sentry.id,
            triggerEvent: {
                type: "SPELL_CAST",
                casterId: "p2",
                spellInstanceId: "s",
                spellCardId: "c",
                spellTypes: ["Instant"],
                spellSubtypes: [],
                spellColors: [],
            },
            targets: undefined,
        } as unknown as StackItem);
        resolveTopOfStack(state);

        const after = state.players[0].battlefield.find(
            (c) => c.id === "sentry"
        )!;
        expect(getEffectivePower(state, after)).toBe(3); // 1 + 2
        expect(getEffectiveToughness(state, after)).toBe(3); // 1 + 2

        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sentry"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Singe (dealDamage + setColor same script, CR 120.1 / 613.1e)", () => {
    it("deals 1 damage to the target creature and turns it black until end of turn", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, singe.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        const after = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.damageMarked).toBe(1);
        expect(after.colorOverride).toEqual(["B"]);

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.damageMarked).toBe(1);
        expect(slim.colorOverride).toEqual(["B"]);
    });
});

describe("Kavu Recluse (setSubtype on an announced Land target, CR 305.7)", () => {
    it("turns the target land into a Forest until end of turn", () => {
        const recluse = makeInstance(kavuRecluse.id, {
            id: "recluse",
            controllerId: "p1",
            ownerId: "p1",
        });
        const targetSwamp = makeInstance(swamp.id, {
            id: "target-swamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [recluse] }),
                makePlayer("p2", { battlefield: [targetSwamp] }),
            ],
        });
        state.stack.push({
            ...recluse,
            zone: "stack",
            castById: "p1",
            abilityId: "kavu-recluse-forest",
            targets: [{ type: "permanent", id: "target-swamp" }],
        } as StackItem);
        resolveTopOfStack(state);

        const after = state.players[1].battlefield.find(
            (c) => c.id === "target-swamp"
        )!;
        expect(after.subtypes).toEqual(["Forest"]);

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "target-swamp"
        )!;
        expect(slim.subtypes).toEqual(["Forest"]);
    });
});

describe("Caldera Kavu (self-pump activated ability + optionChoice color change, CR 611 / 613.1e)", () => {
    it("gets +1/+1 until end of turn from its {1}{B} ability", () => {
        const kavu = makeInstance(calderaKavu.id, {
            id: "kavu",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, kavu)).toBe(2);
        expect(getEffectiveToughness(state, kavu)).toBe(2);

        state.stack.push({
            ...kavu,
            zone: "stack",
            castById: "p1",
            abilityId: "caldera-kavu-pump",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);

        const after = state.players[0].battlefield.find(
            (c) => c.id === "kavu"
        )!;
        expect(getEffectivePower(state, after)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, after)).toBe(3); // 2 + 1

        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "kavu"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("becomes the chosen color until end of turn from its {G} ability", () => {
        const kavu = makeInstance(calderaKavu.id, {
            id: "kavu2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kavu] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...kavu,
            zone: "stack",
            castById: "p1",
            abilityId: "caldera-kavu-color",
            targets: [],
        } as StackItem);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the mode pick

        submitOptionPick(state, "G");

        const after = state.players[0].battlefield.find(
            (c) => c.id === "kavu2"
        )!;
        expect(after.colorOverride).toEqual(["G"]);

        // Re-assert the colour change through the wire projection: the client
        // reads the slim battlefield entry, not the raw fat state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "kavu2"
        )!;
        expect(getEffectiveColors(slim)).toEqual(["G"]);
    });
});
