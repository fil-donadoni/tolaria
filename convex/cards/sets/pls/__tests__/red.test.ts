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
    deadapult,
    implode,
    insolence,
    kavuRecluse,
    keldonMantle,
    magmaBurst,
    mireKavu,
    moggJailer,
    moggSentry,
    planeswalkersFury,
    singe,
    slingshotGoblin,
    strafe,
    tahngarthTalruumHero,
    tahngarthTalruumHeroAlt,
    thunderscapeBattlemage,
    thunderscapeFamiliar,
} from "../red";
import { grizzlyBears, savannahLions, swamp } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    tapPermanent,
    emitPermanentTapped,
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
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

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

describe("PLS red free tranche — definitions (issue #1951)", () => {
    it("pins mana cost / types for the DSL-only cards (no hand-written behavior test needed)", () => {
        expect(calderaKavu.manaCost).toEqual({ X: 2, R: 1 });
        expect(deadapult.manaCost).toEqual({ X: 2, R: 1 });
        expect(implode.manaCost).toEqual({ X: 4, R: 1 });
        expect(kavuRecluse.manaCost).toEqual({ X: 2, R: 1 });
        expect(mireKavu.manaCost).toEqual({ X: 3, R: 1 });
        expect(moggJailer.manaCost).toEqual({ X: 1, R: 1 });
        expect(moggSentry.manaCost).toEqual({ R: 1 });
        expect(singe.manaCost).toEqual({ R: 1 });
        expect(slingshotGoblin.manaCost).toEqual({ X: 2, R: 1 });
        expect(strafe.manaCost).toEqual({ R: 1 });
        expect(thunderscapeFamiliar.manaCost).toEqual({ X: 1, R: 1 });
        expect(thunderscapeFamiliar.staticAbilities).toContain("first strike");
    });
});

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

describe("Tahngarth, Talruum Hero — mutual power-for-power damage (CR 701.12, resolve() justified, established fight() gap)", () => {
    it("is a 4/4 vigilance Legendary Minotaur Warrior with two printings (ADR 0014)", () => {
        expect(tahngarthTalruumHero.power).toBe(4);
        expect(tahngarthTalruumHero.toughness).toBe(4);
        expect(tahngarthTalruumHero.staticAbilities).toContain("vigilance");
        expect(tahngarthTalruumHeroAlt.definitionId).toBe(
            tahngarthTalruumHero.id
        );
        expect(tahngarthTalruumHeroAlt.setCode).toBe("pls");
        expect(tahngarthTalruumHeroAlt.printId).not.toBe(
            tahngarthTalruumHero.id
        );
    });

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
// (ADR 0079/#1937). Each ETB trigger's own intervening-if is a per-Kicker
// `{ kickerPaid: "<id>" }` read (already exercised generically by
// `interpreter.test.ts`), but this is the first CARD exercising two
// INDEPENDENT Kickers gating two INDEPENDENT triggers on one creature — worth
// a confirming test per the project's "genuinely new construct combination"
// bar, even though no new Op is introduced.
const BM_ENCHANTMENT_ID = "test-pls-battlemage-enchantment";
registerTokenDefinition({
    id: BM_ENCHANTMENT_ID,
    name: BM_ENCHANTMENT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Enchantment"],
});

describe("Thunderscape Battlemage — two independent Kickers, two independent intervening-if ETB triggers", () => {
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
});
