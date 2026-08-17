// Invasion (INV) — black behavior tests (ADR 0043 colour split, #1071).
//
// Per-Op regime (ADR 0045/0046): the 24 pure-DSL free cards + the Soul Burn
// CardPrint reuse only already-exercised Ops/keywords and need no
// hand-written test here — the catalogue-wide `validateEffectScript` sweep
// (effectScripts.test.ts) + the auto-generated canned-scenario smoke test
// (effectScriptSmoke.test.ts) cover them.
//
// Hand-written tests below cover:
//   - the 7 `resolve()` cards (Annihilate, Phyrexian Delver, Phyrexian
//     Reaper, Phyrexian Slayer, Plague Spitter, Spreading Plague, Tsabo's
//     Assassin) — mandatory per the card testing convention;
//   - the 2 bespoke `pt-cda` cards (Goham Djinn, Marauding Knight) — new
//     board-scan compute logic, with a wire-format assertion;
//   - Andradite Leech's cost-modifier (mirrors the Derelor precedent,
//     fem/black.ts) + its activated pump;
//   - Duskwalker's kicker → entersWith-counters → wasKicked-gated
//     keyword-grant chain (issue #1716), a novel-enough composition to
//     warrant its own assertion.
//
// First-printing audit (ADR 0041): some cards exercised below were first
// implemented as part of this INV tranche but are REPRINTS — their
// definitions now live in their earliest-paper-printing home sets, and INV
// keeps only a `CardPrint`. The behaviour suites stay with the tranche that
// authored them and import the definition from its home module.

import { describe, it, expect } from "vitest";
import {
    addle,
    andraditeLeech,
    annihilate,
    bogInitiate,
    cremate,
    cryptAngel,
    desperateResearch,
    doOrDie,
    dredge,
    duskwalker,
    exoticCurse,
    gohamDjinn,
    hypnoticCloud,
    maraudingKnight,
    mourning,
    phyrexianBattleflies,
    phyrexianDelver,
    phyrexianInfiltrator,
    phyrexianReaper,
    phyrexianSlayer,
    plagueSpitter,
    scavengedWeaponry,
    spreadingPlague,
    taintedWell,
    tsabosAssassin,
    urborgShambler,
    urborgSkeleton,
} from "../black";
import { getCardByName } from "../../../index";
import {
    plains,
    island,
    savannahLions,
    grizzlyBears,
    hillGiant,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getCostModifiers,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
} from "../../../../gre/state";
import {
    applyNameCardSubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

/** Resolves a triggered ability directly (bypasses `matches` — same shim
 *  every other set's local `__tests__/helpers.ts` defines; inlined here
 *  since this file is the sole consumer in `sets/inv/`). */
function resolveTrigger(
    state: GameState,
    source: ReturnType<typeof makeInstance>,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

/** Resolves an activated ability directly, mirroring the same per-set shim. */
function resolveActivated(
    state: GameState,
    source: ReturnType<typeof makeInstance>,
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

describe("Andradite Leech (controller's black spells cost {B} more, CR 601.2f)", () => {
    it("taxes the controller's OWN black spell by {B}", () => {
        const leech = makeInstance(andraditeLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = makeInstance(cremate.id, {
            id: "cremate-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const mods = getCostModifiers(state, blackSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(1);
    });

    it("does NOT tax the opponent's black spell", () => {
        const leech = makeInstance(andraditeLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2"),
            ],
        });
        const oppSpell = makeInstance(cremate.id, {
            id: "cremate-opp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const mods = getCostModifiers(state, oppSpell, "spell");
        expect(mods.increase.B ?? 0).toBe(0);
    });

    it("{B}: pumps itself +1/+1 until end of turn", () => {
        const leech = makeInstance(andraditeLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, leech, "andradite-leech-pump");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "leech"
        )!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Annihilate (destroy nonblack, can't regen, draw; CR 701.8 / 701.19c / 121.1)", () => {
    it("destroys the target and draws a card", () => {
        const target = makeInstance(getCardByName("Elvish Archers").id, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [makeInstance(annihilate.id, { zone: "library" })],
                }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        pushSpell(state, annihilate.id, "p1", [
            { type: "permanent", id: "target" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.some((c) => c.id === "target")).toBe(
            true
        );
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Phyrexian Reaper / Phyrexian Slayer (becomes-blocked-by-color → destroy, can't regen; CR 509.1h / 701.8 / 701.19c)", () => {
    it("Reaper's trigger fires only when blocked by a GREEN creature", () => {
        const reaper = makeInstance(phyrexianReaper.id, {
            id: "reaper",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenBlocker = makeInstance(getCardByName("Elvish Archers").id, {
            id: "green-blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [reaper] }),
                makePlayer("p2", { battlefield: [greenBlocker] }),
            ],
        });
        const trigger = phyrexianReaper.triggeredAbilities![0]!;
        const stateView = {
            players: state.players.map((p) => ({
                id: p.id,
                life: p.life,
                battlefield: p.battlefield.map((c) => ({
                    ...c,
                    colors: c.id === "green-blk" ? (["G"] as const) : undefined,
                })),
            })),
        };
        const matches = trigger.matches(
            {
                type: "BLOCKERS_CONFIRMED",
                attackerId: "reaper",
                attackerControllerId: "p1",
                attackerTypes: ["Creature"],
                attackerSubtypes: [],
                blockerId: "green-blk",
                blockerControllerId: "p2",
                blockerTypes: ["Creature"],
                blockerSubtypes: [],
            },
            reaper as never,
            stateView as never
        );
        expect(matches).toBe(true);

        resolveTrigger(state, reaper, "phyrexian-reaper-blocked", {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "reaper",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "green-blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "green-blk")
        ).toBe(true);
    });

    it("Reaper's trigger does NOT match a non-green blocker", () => {
        const reaper = makeInstance(phyrexianReaper.id, {
            id: "reaper",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteBlocker = makeInstance(getCardByName("Benalish Hero").id, {
            id: "white-blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [reaper] }),
                makePlayer("p2", { battlefield: [whiteBlocker] }),
            ],
        });
        const trigger = phyrexianReaper.triggeredAbilities![0]!;
        const stateView = {
            players: state.players.map((p) => ({
                id: p.id,
                life: p.life,
                battlefield: p.battlefield.map((c) => ({
                    ...c,
                    colors: c.id === "white-blk" ? (["W"] as const) : undefined,
                })),
            })),
        };
        const matches = trigger.matches(
            {
                type: "BLOCKERS_CONFIRMED",
                attackerId: "reaper",
                attackerControllerId: "p1",
                attackerTypes: ["Creature"],
                attackerSubtypes: [],
                blockerId: "white-blk",
                blockerControllerId: "p2",
                blockerTypes: ["Creature"],
                blockerSubtypes: [],
            },
            reaper as never,
            stateView as never
        );
        expect(matches).toBe(false);
    });

    it("Slayer destroys a WHITE blocker", () => {
        const slayer = makeInstance(phyrexianSlayer.id, {
            id: "slayer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteBlocker = makeInstance(getCardByName("Benalish Hero").id, {
            id: "white-blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [slayer] }),
                makePlayer("p2", { battlefield: [whiteBlocker] }),
            ],
        });
        resolveTrigger(state, slayer, "phyrexian-slayer-blocked", {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "slayer",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "white-blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        } as StackItem["triggerEvent"]);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Spreading Plague (ETB → destroy other same-color creatures, can't regen; CR 603.6a / 701.8 / 701.19c)", () => {
    it("destroys other creatures sharing a color with the entrant, spares different colors", () => {
        const plague = makeInstance(spreadingPlague.id, {
            id: "plague",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blackCreature = makeInstance(andraditeLeech.id, {
            id: "black-c",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCreature = makeInstance(getCardByName("Elvish Archers").id, {
            id: "green-c",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague, blackCreature] }),
                makePlayer("p2", { battlefield: [greenCreature] }),
            ],
        });
        // A second black creature enters — Spreading Plague fires and should
        // destroy the OTHER black creature (shares color) but spare the green one.
        const entrant = makeInstance(bogInitiate.id, {
            id: "entrant",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(entrant);
        resolveTrigger(state, plague, "spreading-plague-enters", {
            type: "PERMANENT_ENTERED",
            instanceId: "entrant",
            controllerId: "p1",
            types: ["Creature"],
        });
        const p1Ids = state.players[0].battlefield.map((c) => c.id);
        expect(p1Ids).not.toContain("black-c");
        expect(p1Ids).toContain("entrant"); // the entrant itself is never "other"
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "green-c"
        );
    });
});

describe("Phyrexian Delver (ETB → reanimate + lose life equal to MV; CR 603.6a / 603.3d / 400.7 / 202.3 / 119.3)", () => {
    /** Puts Phyrexian Delver's ETB trigger on the stack with its target slot
     *  UNSET (`targets` intentionally left `undefined`) so
     *  `raiseTriggerTargetSelection` (CR 603.3d) treats it as a targeted
     *  trigger owed an announcement-time choice — the target is no longer a
     *  resolution-time `requestChoice`. `triggerSourceId` pins the source
     *  permanent (also the `spellTargetsSelfSource`/`excludeSource` anchor). */
    function delverEtbOnStack(
        state: GameState,
        delver: ReturnType<typeof makeInstance>
    ) {
        state.stack.push({
            ...delver,
            zone: "stack",
            castById: delver.controllerId,
            triggeredAbilityId: "phyrexian-delver-etb",
            triggerSourceId: delver.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: delver.id,
                controllerId: "p1",
                types: ["Creature"],
            },
        });
    }

    /** Drives the CR 603.3d target choice through the real machinery:
     *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget,
     *  then `finalizeTargetSelection` writes the chosen graveyard-card target
     *  onto the on-stack trigger before it resolves. */
    function chooseDelverTarget(
        state: GameState,
        id: string,
        playerId: string
    ) {
        const raised = raiseTriggerTargetSelection(state);
        expect(raised).toBe(true);
        state.pendingTarget!.selected = [
            { type: "graveyard-card", id, playerId },
        ];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
    }

    it("returns the chosen graveyard creature to the battlefield and loses life equal to THAT card's mana value", () => {
        const delver = makeInstance(phyrexianDelver.id, {
            id: "delver",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Elvish Archers — {1}{G}, mana value 2 (CR 202.3) — the chosen card.
        const gyCreature = makeInstance(getCardByName("Elvish Archers").id, {
            id: "gy-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // Benalish Hero — {W}, mana value 1 — a second legal target, so a REAL
        // choice is owed (a lone legal target would auto-select, CR 603.3d).
        const decoy = makeInstance(getCardByName("Benalish Hero").id, {
            id: "gy-decoy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [delver],
                    graveyard: [gyCreature, decoy],
                }),
                makePlayer("p2", {}),
            ],
        });
        delverEtbOnStack(state, delver);
        chooseDelverTarget(state, "gy-creature", "p1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "gy-creature")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "gy-creature")).toBe(false);
        // The decoy stays in the graveyard — only the announced target moved.
        expect(p1.graveyard.some((c) => c.id === "gy-decoy")).toBe(true);
        expect(p1.life).toBe(18); // 20 - Elvish Archers' mana value (2)

        // Wire format: the reanimated creature + life total survive the
        // projection the client actually reads.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "gy-creature")
        ).toBe(true);
        expect(projected.players[0].life).toBe(18);
    });

    it("removes the trigger with no life loss when your graveyard has no creature to return (CR 603.3c)", () => {
        const delver = makeInstance(phyrexianDelver.id, {
            id: "delver",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [delver] }),
                makePlayer("p2", {}),
            ],
        });
        delverEtbOnStack(state, delver);
        // No legal creature in the controller's graveyard — the mandatory
        // single-target trigger is removed from the stack (CR 603.3c); no
        // PendingTarget is raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });
});

describe("Plague Spitter (dies → 1 damage to each creature and each player; CR 700.4 / 603.2 / 120.3)", () => {
    it("deals 1 damage to each creature and each player when it dies", () => {
        const spitter = makeInstance(plagueSpitter.id, {
            id: "spitter",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard", // already dead by the time the trigger resolves
        });
        const ourBear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "our-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ourBear],
                    graveyard: [spitter],
                }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        const beforeP1 = state.players[0].life;
        const beforeP2 = state.players[1].life;
        resolveTrigger(state, spitter, "plague-spitter-dies", {
            type: "CREATURE_DIED",
            creatureInstanceId: "spitter",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        });
        const live1 = state.players[0].battlefield.find(
            (c) => c.id === "our-bear"
        )!;
        const live2 = state.players[1].battlefield.find(
            (c) => c.id === "opp-bear"
        )!;
        expect(live1.damageMarked).toBe(1);
        expect(live2.damageMarked).toBe(1);
        expect(state.players[0].life).toBe(beforeP1 - 1);
        expect(state.players[1].life).toBe(beforeP2 - 1);
    });
});

describe("Tsabo's Assassin ({T}: destroy target creature sharing the board's most common color; CR 701.8 destroy / 701.19c regeneration)", () => {
    function setup() {
        const assassin = makeInstance(tsabosAssassin.id, {
            id: "assassin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const anotherBlack = makeInstance(andraditeLeech.id, {
            id: "black-2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenTarget = makeInstance(getCardByName("Elvish Archers").id, {
            id: "green-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Black count = 2 (assassin + black-2), green count = 1 — black is
        // the sole most-common color.
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [assassin, anotherBlack] }),
                makePlayer("p2", { battlefield: [greenTarget] }),
            ],
        });
        return { state, assassin };
    }

    it("does NOT destroy a creature of a non-most-common color", () => {
        const { state, assassin } = setup();
        resolveActivated(state, assassin, "tsabos-assassin-destroy", [
            { type: "permanent", id: "green-target" },
        ]);
        expect(state.players[1].battlefield).toHaveLength(1);
    });

    it("destroys a creature sharing the most-common color", () => {
        const { state, assassin } = setup();
        resolveActivated(state, assassin, "tsabos-assassin-destroy", [
            { type: "permanent", id: "black-2" },
        ]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "black-2")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "black-2")).toBe(
            true
        );
    });
});

describe("Goham Djinn (-2/-2 while black is most common color or tied; CR 613.4a CDA)", () => {
    function setup(greenCount: number) {
        const djinn = makeInstance(gohamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greens = Array.from({ length: greenCount }, (_, i) =>
            makeInstance(getCardByName("Elvish Archers").id, {
                id: `green-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn] }),
                makePlayer("p2", { battlefield: greens }),
            ],
        });
        return { state, djinn };
    }

    it("sole black permanent on the board → -2/-2", () => {
        const { state, djinn } = setup(0);
        expect(getEffectivePower(state, djinn)).toBe(3);
        expect(getEffectiveToughness(state, djinn)).toBe(3);
    });

    it("tied with green (1 vs 1) → still -2/-2", () => {
        const { state, djinn } = setup(1);
        expect(getEffectivePower(state, djinn)).toBe(3);
        expect(getEffectiveToughness(state, djinn)).toBe(3);
    });

    it("green strictly more common (2 vs 1) → unaffected", () => {
        const { state, djinn } = setup(2);
        expect(getEffectivePower(state, djinn)).toBe(5);
        expect(getEffectiveToughness(state, djinn)).toBe(5);
    });

    it("wire format: derived P/T survives projectPublicState", () => {
        const { state } = setup(0);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "djinn"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{1}{B}: regenerates itself", () => {
        const { state, djinn } = setup(0);
        resolveActivated(state, djinn, "goham-djinn-regen");
        // Applying a regeneration shield is a no-op observable event unless a
        // destroy follows; assert the ability at least resolves cleanly.
        expect(state.players[0].battlefield.some((c) => c.id === "djinn")).toBe(
            true
        );
    });
});

describe("Marauding Knight (+1/+1 per opponents' Plains; CR 613.4a CDA)", () => {
    it("scales with the OPPONENT's Plains, not the controller's own", () => {
        const knight = makeInstance(maraudingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ownPlains = makeInstance(getCardByName("Plains").id, {
            id: "own-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppPlains = [0, 1, 2].map((i) =>
            makeInstance(getCardByName("Plains").id, {
                id: `opp-plains-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight, ownPlains] }),
                makePlayer("p2", { battlefield: oppPlains }),
            ],
        });
        expect(getEffectivePower(state, knight)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, knight)).toBe(5);
    });

    it("wire format: derived P/T survives projectPublicState", () => {
        const knight = makeInstance(maraudingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppPlains = makeInstance(getCardByName("Plains").id, {
            id: "opp-plains",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2", { battlefield: [oppPlains] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "knight"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3); // 2 + 1
    });
});

describe("Duskwalker (Kicker → two +1/+1 counters + fear; CR 702.33 / 122.1 / 702.36)", () => {
    function enterKicked(kicked: boolean) {
        const state = makeState();
        const item = pushSpell(state, duskwalker.id, "p1");
        if (kicked) item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        return state;
    }

    it("kicked: enters with two +1/+1 counters and fear", () => {
        const state = enterKicked(true);
        const dw = state.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(dw.counters?.["+1/+1"]).toBe(2);
        expect(dw.wasKicked).toBe(true);
        expect(dw.staticAbilities).toContain("fear");
    });

    it("not kicked: no counters, no fear, wasKicked unset", () => {
        const state = enterKicked(false);
        const dw = state.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(dw.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(dw.wasKicked).toBeUndefined();
        expect(dw.staticAbilities).not.toContain("fear");
    });

    // Revert-sensitive regressions (issue #1716): before the fix, the
    // `keyword-grant` gated on `(target.counters?.["+1/+1"] ?? 0) >= 2` — an
    // exact proxy for "was kicked" ONLY at the instant `entersWith` placed the
    // counters. Forcing a re-materialization (`unapplySourceStaticEffects` +
    // `applySourceStaticEffects`, what `refreshCounterGatedStatics` does
    // internally for any counter-dependent grant) exposes the proxy's two
    // failure modes directly against the real production apply path — these
    // fail if the `applies` predicate is reverted to read `target.counters`.
    it("(regression) unkicked, later pumped to 2+ +1/+1 counters externally: still does not gain fear", () => {
        const state = enterKicked(false);
        const dw = state.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(dw.staticAbilities).not.toContain("fear");
        // Simulate an unrelated pump spell (one of 40+ catalogue "+1/+1"
        // sources) landing 2 counters on the never-kicked Duskwalker post-ETB.
        dw.counters = { "+1/+1": 2 };
        unapplySourceStaticEffects(state, dw);
        applySourceStaticEffects(state, dw);
        expect(dw.staticAbilities).not.toContain("fear");
    });

    it("(regression) kicked, then all +1/+1 counters annihilated (CR 704.5q): keeps fear", () => {
        const state = enterKicked(true);
        const dw = state.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(dw.staticAbilities).toContain("fear");
        // Simulate -1/-1 counter annihilation wiping the +1/+1 counters.
        delete dw.counters?.["+1/+1"];
        unapplySourceStaticEffects(state, dw);
        applySourceStaticEffects(state, dw);
        expect(dw.staticAbilities).toContain("fear");
    });

    // Wire format (mandatory for a new CardInstanceState field, issue #1716,
    // `.claude/rules/gre-development.md` § Frontend wiring analysis): the
    // materialized "fear" keyword — the client-visible effect of
    // `wasKicked` — must survive `projectPublicState`'s slim reshape.
    it("kicked fear grant survives projectPublicState (wire format)", () => {
        const state = enterKicked(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === duskwalker.id
        )!;
        expect(slim.wasKicked).toBe(true);
        expect(slim.staticAbilities).toContain("fear");
    });
});

describe("Urborg Skeleton (Kicker → a single +1/+1 counter; CR 702.33 / 122.1)", () => {
    it("kicked: enters with exactly one +1/+1 counter", () => {
        const state = makeState();
        const item = pushSpell(state, urborgSkeleton.id, "p1");
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        const skel = state.players[0].battlefield.find(
            (c) => c.card.id === urborgSkeleton.id
        )!;
        expect(skel.counters?.["+1/+1"]).toBe(1);
    });

    it("not kicked: no counters", () => {
        const state = makeState();
        pushSpell(state, urborgSkeleton.id, "p1");
        resolveTopOfStack(state);
        const skel = state.players[0].battlefield.find(
            (c) => c.card.id === urborgSkeleton.id
        )!;
        expect(skel.counters?.["+1/+1"] ?? 0).toBe(0);
    });
});

describe("Mourning (Aura -2/-0 pt-buff + {B}: return to owner's hand; CR 613.4c / 400.7)", () => {
    it("gives the enchanted creature -2/-0 while attached, and nothing when detached", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bears] }),
            ],
        });
        // WITHOUT Mourning on the battlefield: unaffected.
        expect(getEffectivePower(state, bears)).toBe(2);
        expect(getEffectiveToughness(state, bears)).toBe(2);

        // WITH Mourning attached: -2/-0.
        const aura = makeInstance(mourning.id, {
            id: "mourning-aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bears",
        });
        state.players[0].battlefield.push(aura);
        expect(getEffectivePower(state, bears)).toBe(0); // 2 - 2
        expect(getEffectiveToughness(state, bears)).toBe(2); // untouched
    });

    it("wire format: the -2/-0 buff survives projectPublicState", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(mourning.id, {
            id: "mourning-aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bears",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [bears] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p2");
        const slimBears = projected.players[1].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(getEffectivePower(projected, slimBears)).toBe(0);
        expect(getEffectiveToughness(projected, slimBears)).toBe(2);
    });

    it("{B}: returns the Aura to its OWNER's hand, lifting the debuff", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(mourning.id, {
            id: "mourning-aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bears",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [bears] }),
            ],
        });
        expect(getEffectivePower(state, bears)).toBe(0);

        resolveActivated(state, aura, "mourning-return");

        expect(
            state.players[0].battlefield.some((c) => c.id === "mourning-aura")
        ).toBe(false);
        expect(
            state.players[0].hand.some((c) => c.id === "mourning-aura")
        ).toBe(true);
        expect(getEffectivePower(state, bears)).toBe(2); // debuff lifted
    });
});

describe("Scavenged Weaponry (Aura +1/+1 pt-buff; CR 613.4c)", () => {
    it("gives the enchanted creature +1/+1 while attached, and nothing when detached", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bears] }),
                makePlayer("p2"),
            ],
        });
        // WITHOUT the Aura on the battlefield: unaffected.
        expect(getEffectivePower(state, bears)).toBe(2);
        expect(getEffectiveToughness(state, bears)).toBe(2);

        // WITH the Aura attached: +1/+1.
        const aura = makeInstance(scavengedWeaponry.id, {
            id: "weaponry-aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bears",
        });
        state.players[0].battlefield.push(aura);
        expect(getEffectivePower(state, bears)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, bears)).toBe(3); // 2 + 1
    });

    it("wire format: the +1/+1 buff survives projectPublicState", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(scavengedWeaponry.id, {
            id: "weaponry-aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bears",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bears, aura] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBears = projected.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(getEffectivePower(projected, slimBears)).toBe(3);
        expect(getEffectiveToughness(projected, slimBears)).toBe(3);
    });
});

describe("Tainted Well (Aura — enchanted land is ALSO a Swamp, additively; CR 305.7 / 611 layer 4)", () => {
    it("adds Swamp to the enchanted land's subtypes WITHOUT replacing the printed type", () => {
        const land = makeInstance(plains.id, {
            id: "the-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const well = makeInstance(taintedWell.id, {
            id: "well",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "the-plains",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, well] }),
                makePlayer("p2"),
            ],
        });

        applySourceStaticEffects(state, well);

        expect(land.subtypes).toContain("Plains");
        expect(land.subtypes).toContain("Swamp");
    });

    it("wire format: the additive Swamp subtype survives projectPublicState", () => {
        const land = makeInstance(plains.id, {
            id: "the-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const well = makeInstance(taintedWell.id, {
            id: "well",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "the-plains",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, well] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, well);

        const projected = projectPublicState(state, 1, "p1");
        const slimLand = projected.players[0].battlefield.find(
            (c) => c.id === "the-plains"
        )!;
        expect(slimLand.subtypes).toContain("Plains");
        expect(slimLand.subtypes).toContain("Swamp");
    });

    it("reverts the additive Swamp grant when the Aura leaves the battlefield", () => {
        const land = makeInstance(plains.id, {
            id: "the-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const well = makeInstance(taintedWell.id, {
            id: "well",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "the-plains",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, well] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, well);
        expect(land.subtypes).toContain("Swamp");

        unapplySourceStaticEffects(state, well);

        expect(land.subtypes).toEqual(["Plains"]);
        expect(land.subtypes).not.toContain("Swamp");
    });
});

describe("Urborg Shambler (other black creatures get -1/-1, self and nonblack excluded; CR 613.4c)", () => {
    it("debuffs another black creature regardless of controller", () => {
        const shambler = makeInstance(urborgShambler.id, {
            id: "shambler",
            controllerId: "p1",
            ownerId: "p1",
        });
        const skeleton = makeInstance(urborgSkeleton.id, {
            id: "skeleton",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shambler] }),
                makePlayer("p2", { battlefield: [skeleton] }),
            ],
        });
        expect(getEffectivePower(state, skeleton)).toBe(-1); // 0 - 1
        expect(getEffectiveToughness(state, skeleton)).toBe(0); // 1 - 1
    });

    it("does NOT debuff itself", () => {
        const shambler = makeInstance(urborgShambler.id, {
            id: "shambler",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shambler] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, shambler)).toBe(4);
        expect(getEffectiveToughness(state, shambler)).toBe(3);
    });

    it("does NOT debuff a nonblack creature", () => {
        const shambler = makeInstance(urborgShambler.id, {
            id: "shambler",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shambler, bears] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bears)).toBe(2);
        expect(getEffectiveToughness(state, bears)).toBe(2);
    });

    it("wire format: the -1/-1 debuff survives projectPublicState", () => {
        const shambler = makeInstance(urborgShambler.id, {
            id: "shambler",
            controllerId: "p1",
            ownerId: "p1",
        });
        const skeleton = makeInstance(urborgSkeleton.id, {
            id: "skeleton",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shambler] }),
                makePlayer("p2", { battlefield: [skeleton] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimSkeleton = projected.players[1].battlefield.find(
            (c) => c.id === "skeleton"
        )!;
        expect(getEffectivePower(projected, slimSkeleton)).toBe(-1);
        expect(getEffectiveToughness(projected, slimSkeleton)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Exotic Curse — Domain-scaled `pt-cda` Aura (CR 303.4 / 604.3 / 702
// preamble, issue #1066). Mirrors Strength of Unity (`inv/white.ts`) with a
// NEGATED delta; the wire-format re-assertion after `projectPublicState` is
// mandatory per the Card testing convention for staticEffects[] (layer 7c).
// ---------------------------------------------------------------------------

describe("Exotic Curse (CR 303.4 aura / 604.3 CDA — -1/-1 per Domain, issue #1066)", () => {
    it("gives the enchanted creature -1/-1 for each of the AURA CONTROLLER's basic land types", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const curse = makeInstance(exoticCurse.id, {
            id: "curse",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "lion",
        });
        const lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `ec-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [curse, ...lands] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        // Savannah Lions is a 2/1; the AURA controller (p1) has Domain 2.
        expect(getEffectivePower(state, lion)).toBe(0); // 2 - 2
        expect(getEffectiveToughness(state, lion)).toBe(-1); // 1 - 2
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const curse = makeInstance(exoticCurse.id, {
            id: "curse",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "lion",
        });
        const land = makeInstance(plains.id, {
            id: "ec-wire-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, curse, land] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slimLion)).toBe(1); // 2 - 1
        expect(getEffectiveToughness(projected, slimLion)).toBe(0); // 1 - 1
    });
});

describe("Do or Die (CR 701.8 destroy / 701.19c regeneration, ADR 0053 pile division, issue #1067)", () => {
    it("the caster divides the target player's creatures; the target player chooses the destroyed pile, unregenerable", () => {
        const creatures = ["dod-1", "dod-2", "dod-3"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
        pushSpell(state, doOrDie.id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended

        const divide = state.pendingChoices![0];
        expect(divide.kind).toBe("divide-piles");
        expect(divide.playerId).toBe("p1"); // the caster divides
        expect(divide.zoneOwnerId).toBe("p2"); // the target player's creatures
        expect(divide.candidateIds?.slice().sort()).toEqual([
            "dod-1",
            "dod-2",
            "dod-3",
        ]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["dod-1"],
        });

        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");
        expect(pick.playerId).toBe("p2"); // the target player chooses
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"],
        });

        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "dod-2",
            "dod-3",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["dod-1"]);
    });

    it("destroyed creatures can't be regenerated (CR 701.19c)", () => {
        const doomed = makeInstance(savannahLions.id, {
            id: "dod-regen",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [doomed] }),
            ],
        });
        pushSpell(state, doOrDie.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["dod-regen"],
        });
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"],
        });
        // The regeneration shield did NOT save the creature — it's in the
        // graveyard despite carrying a shield.
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "dod-regen")
        ).toBe(true);
    });

    it("the other pile survives untouched", () => {
        const creatures = ["dod-a", "dod-b"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
        pushSpell(state, doOrDie.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["dod-a"],
        });
        const pick = state.pendingChoices![0];
        // Choose pile B this time — the OTHER pile (dod-a) survives.
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["B"],
        });
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "dod-a",
        ]);
        expect(state.players[1].graveyard.some((c) => c.id === "dod-b")).toBe(
            true
        );
    });

    it("survives the wire projection (the pick-pile choice's piles cross the wire)", () => {
        const creatures = ["dod-w1", "dod-w2"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
        pushSpell(state, doOrDie.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["dod-w1"],
        });
        const projected = projectPublicState(state, 1, "p2");
        const pick = projected.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");
        expect(pick.pileA).toEqual(["dod-w1"]);
        expect(pick.pileB).toEqual(["dod-w2"]);
    });
});

// The scenario generator (scenarioGenerator.ts) unconditionally skips any
// script containing a `gainControl` Op (it needs a seeded permanent the
// generic canned scenario doesn't set up) — an explicit, documented skip, per
// gre-development.md "never a silent pass, the signal to add a hand-written
// test for that card after all". Hence this hand-written describe block even
// though `gainControl` itself is an already-shipped, individually-tested Op
// (issue #848) — it's the SMOKE COVERAGE gap that earns the test, not a new
// construct.
describe("Phyrexian Infiltrator ({2}{U}{U}: exchange control indefinitely, CR 701.12e / 611.2b / 613.1b, issue #1068)", () => {
    it("exchanges control: the target creature comes to the activator, Infiltrator goes to the target's controller", () => {
        const infiltrator = makeInstance(phyrexianInfiltrator.id, {
            id: "inf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const enemy = makeInstance(savannahLions.id, {
            id: "enemy",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [infiltrator] }),
                makePlayer("p2", { battlefield: [enemy] }),
            ],
        });
        resolveActivated(state, infiltrator, "phyrexian-infiltrator-exchange", [
            { type: "permanent", id: "enemy" },
        ]);

        // The target creature is now under p1's control...
        const swappedEnemy = state.players[0].battlefield.find(
            (c) => c.id === "enemy"
        );
        expect(swappedEnemy?.controllerId).toBe("p1");
        expect(state.players[1].battlefield.some((c) => c.id === "enemy")).toBe(
            false
        );
        // ...and Phyrexian Infiltrator is now under p2's control — a true
        // two-way exchange, not a one-way gainControl.
        const swappedInfiltrator = state.players[1].battlefield.find(
            (c) => c.id === "inf"
        );
        expect(swappedInfiltrator?.controllerId).toBe("p2");
        expect(state.players[0].battlefield.some((c) => c.id === "inf")).toBe(
            false
        );
        // Ownership is untouched by a control change (CR 108.3).
        expect(swappedEnemy?.ownerId).toBe("p2");
        expect(swappedInfiltrator?.ownerId).toBe("p1");
    });

    it("is a no-op when the activator already controls the target creature (printed ruling)", () => {
        const infiltrator = makeInstance(phyrexianInfiltrator.id, {
            id: "inf2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const own = makeInstance(savannahLions.id, {
            id: "own",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [infiltrator, own] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, infiltrator, "phyrexian-infiltrator-exchange", [
            { type: "permanent", id: "own" },
        ]);
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "inf2",
            "own",
        ]);
    });

    it("the control exchange lasts indefinitely and survives the wire projection", () => {
        const infiltrator = makeInstance(phyrexianInfiltrator.id, {
            id: "inf3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const enemy = makeInstance(savannahLions.id, {
            id: "enemy3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [infiltrator] }),
                makePlayer("p2", { battlefield: [enemy] }),
            ],
        });
        resolveActivated(state, infiltrator, "phyrexian-infiltrator-exchange", [
            { type: "permanent", id: "enemy3" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "enemy3")
        ).toBe(true);
        expect(
            projected.players[1].battlefield.some((c) => c.id === "inf3")
        ).toBe(true);
    });

    // CR 701.12e — an exchange must happen for BOTH permanents or NEITHER
    // (the Gilded Drake / Legerdemain precedent). The target creature staying
    // a legal target does not guarantee `$source` survives to resolution: the
    // opponent can remove the Infiltrator in response. Before the fix, op1
    // ($source -> target's controller) silently no-op'd on the vanished
    // source while op2 (target -> activator) still fired unconditionally,
    // stealing the target one-way with no exchange back.
    it("does NOT steal the target when the Infiltrator is removed from the battlefield in response (CR 701.12e atomicity)", () => {
        const infiltrator = makeInstance(phyrexianInfiltrator.id, {
            id: "inf4",
            controllerId: "p1",
            ownerId: "p1",
        });
        const enemy = makeInstance(savannahLions.id, {
            id: "enemy4",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [infiltrator] }),
                makePlayer("p2", { battlefield: [enemy] }),
            ],
        });
        // Activate targeting the opponent's creature...
        state.stack.push({
            ...infiltrator,
            zone: "stack",
            castById: infiltrator.controllerId,
            abilityId: "phyrexian-infiltrator-exchange",
            targets: [{ type: "permanent", id: "enemy4" }],
        });
        // ...then the opponent removes the Infiltrator in response (e.g.
        // destroy/sacrifice) BEFORE the ability resolves.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "inf4"
        );
        state.players[0].graveyard = [
            ...state.players[0].graveyard,
            { ...infiltrator, zone: "graveyard" },
        ];

        resolveTopOfStack(state);

        // The target creature's controller is UNCHANGED — no one-way steal.
        const target = state.players[1].battlefield.find(
            (c) => c.id === "enemy4"
        );
        expect(target?.controllerId).toBe("p2");
        expect(
            state.players[0].battlefield.some((c) => c.id === "enemy4")
        ).toBe(false);
        // The Infiltrator stays dead in its owner's graveyard — the guard
        // didn't resurrect it either.
        expect(state.players[0].graveyard.some((c) => c.id === "inf4")).toBe(
            true
        );
    });
});

// Desperate Research (CR 201.3 / 701.20a / 401.4, issue #1085) — the
// `nameCard` + `digMatchingToHand` Ops this card surfaced are new, so the
// auto-generated canned-scenario smoke test skips it (nameCard suspends for
// a live open-ended name choice, digMatchingToHand depends on a filter
// match against library contents) — a hand-written test is the signal-of-
// intent here (per the DSL testing regime's own escape hatch).
describe("Desperate Research ({1}{B} Sorcery — choose a card name, reveal 7, split on the name, CR 201.3 / 701.20a)", () => {
    const libOf = (owner: "p1" | "p2", cardIds: string[]) =>
        cardIds.map((cardId, i) =>
            makeInstance(cardId, {
                id: `desperate-research-${owner}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );

    it("suspends on the name choice, then splits the top 7 on the chosen name — matches to hand, the rest exiled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [
                        grizzlyBears.id,
                        hillGiant.id,
                        grizzlyBears.id,
                        hillGiant.id,
                        grizzlyBears.id,
                        hillGiant.id,
                        hillGiant.id,
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, desperateResearch.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on nameCard
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("name-card");
        expect(head.playerId).toBe("p1");

        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].hand.every((c) => c.card.id === grizzlyBears.id)
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].exile).toHaveLength(4);
        expect(state.players[0].library).toHaveLength(0);
    });

    it("rejects a basic land name (CR 201.3 'other than a basic land card name') — the chooser must resubmit", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [grizzlyBears.id, hillGiant.id]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, desperateResearch.id, "p1");
        resolveTopOfStack(state);
        expect(() =>
            applyNameCardSubmit(state, { playerId: "p1", cardName: "Forest" })
        ).toThrow(/basic land/i);
        expect(state.pendingChoices).toHaveLength(1);
    });

    it("wire format: the suspended name choice and the post-resolution hand/exile counts cross the projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf("p1", [grizzlyBears.id, hillGiant.id]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, desperateResearch.id, "p1");
        resolveTopOfStack(state);
        const projectedSuspended = projectPublicState(state, 1, "p1");
        expect(projectedSuspended.pendingChoices?.[0]?.kind).toBe("name-card");

        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Grizzly Bears",
        });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(1);
        expect(projected.players[0].exile).toHaveLength(1);
    });
});

describe("Hypnotic Cloud (Kicker {4} → discard 1 card, or 3 if kicked; CR 702.33 / 701.9)", () => {
    it("unkicked: the target player discards a single chosen card", () => {
        const keep = makeInstance(savannahLions.id, {
            id: "hc-keep",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const drop = makeInstance(grizzlyBears.id, {
            id: "hc-drop",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [keep, drop] }),
            ],
        });
        pushSpell(state, hypnoticCloud.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the discard choice
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2"); // the TARGET player chooses (CR 701.9)
        expect(head.count).toEqual({ min: 0, max: 1 });
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hc-drop"],
        });
        expect(state.players[1].graveyard.some((c) => c.id === "hc-drop")).toBe(
            true
        );
        expect(state.players[1].hand.some((c) => c.id === "hc-keep")).toBe(
            true
        );

        // Wire projection: the discarding player's own view sees the kept
        // card still in hand and the discard land publicly in the graveyard.
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].hand.some((c) => c?.id === "hc-keep")).toBe(
            true
        );
        expect(projected.players[1].hand.length).toBe(1);
        expect(
            projected.players[1].graveyard.some((c) => c.id === "hc-drop")
        ).toBe(true);
    });

    it("kicked: the target player discards up to three chosen cards instead", () => {
        const cards = ["a", "b", "c", "d"].map((id) =>
            makeInstance(savannahLions.id, {
                id: `hc-${id}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: cards })],
        });
        const item = pushSpell(state, hypnoticCloud.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerPayments = { kicker: 1 };
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.count).toEqual({ min: 0, max: 3 });
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hc-a", "hc-b", "hc-c"],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["hc-d"]);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "hc-a",
            "hc-b",
            "hc-c",
        ]);

        // Wire projection: from the discarding player's own viewpoint the
        // remaining hand card is still visible and the three discards
        // land in the (public) graveyard.
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].hand.map((c) => c?.id)).toEqual(["hc-d"]);
        expect(projected.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "hc-a",
            "hc-b",
            "hc-c",
        ]);
    });
});

describe("Crypt Angel (ETB → return target blue or red creature card from graveyard to hand; CR 702.9 / 702.16 / 603.6a)", () => {
    it("offers only blue/red graveyard creatures and returns the chosen one to hand", () => {
        const angel = makeInstance(cryptAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Hill Giant — red, a legal target.
        const redCreature = makeInstance(hillGiant.id, {
            id: "gy-red",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // Grizzly Bears — green, NOT a legal target (filter is blue/red only).
        const offColor = makeInstance(grizzlyBears.id, {
            id: "gy-green",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [angel],
                    graveyard: [redCreature, offColor],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, angel, "crypt-angel-etb", {
            type: "PERMANENT_ENTERED",
            instanceId: "angel",
            controllerId: "p1",
            types: ["Creature"],
        });
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-graveyard-card");
        expect(head.candidateIds).toEqual(["gy-red"]); // the off-color card is filtered out
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["gy-red"],
        });
        expect(state.players[0].hand.some((c) => c.id === "gy-red")).toBe(true);
        expect(state.players[0].graveyard.some((c) => c.id === "gy-red")).toBe(
            false
        );
        expect(
            state.players[0].graveyard.some((c) => c.id === "gy-green")
        ).toBe(true);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.some((c) => c?.id === "gy-red")).toBe(
            true
        );
    });
});

describe("Dredge (Instant — sacrifice a creature or land, draw a card; CR 701.21 / 121.1)", () => {
    it("sacrifices the chosen permanent, then draws a card", () => {
        const creature = makeInstance(savannahLions.id, {
            id: "dredge-creature",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(plains.id, {
            id: "dredge-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(grizzlyBears.id, {
            id: "dredge-draw",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [creature, land],
                    library: [topCard],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dredge.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.zone).toBe("battlefield");
        expect(head.count).toBe(1); // exactly one, not "up to"
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["dredge-land"],
        });
        expect(
            state.players[0].battlefield.some((c) => c.id === "dredge-land")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "dredge-land")
        ).toBe(true);
        // The un-sacrificed creature stays.
        expect(
            state.players[0].battlefield.some((c) => c.id === "dredge-creature")
        ).toBe(true);
        expect(state.players[0].hand.some((c) => c.id === "dredge-draw")).toBe(
            true
        );

        // Wire format — the sacrificed permanent must actually disappear from
        // the projected battlefield the client renders.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "dredge-land")
        ).toBe(false);
        expect(
            projected.players[0].battlefield.some(
                (c) => c.id === "dredge-creature"
            )
        ).toBe(true);
    });

    it("auto-clamps to zero sacrifices with nothing to sacrifice (CR 608.2b), still draws", () => {
        const topCard = makeInstance(grizzlyBears.id, {
            id: "dredge-draw-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [topCard] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dredge.id, "p1");
        expect(resolveTopOfStack(state)).not.toBeNull(); // no suspension at all
        expect(
            state.players[0].hand.some((c) => c.id === "dredge-draw-2")
        ).toBe(true);
    });
});

describe("Phyrexian Battleflies ({B}: +1/+0 EOT, activate no more than twice each turn; CR 702.9 / 602.5)", () => {
    it("pumps power by 1 per activation, cumulative across two activations", () => {
        const bug = makeInstance(phyrexianBattleflies.id, {
            id: "bug",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bug] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bug, "phyrexian-battleflies-pump");
        const afterOne = state.players[0].battlefield.find(
            (c) => c.id === "bug"
        )!;
        expect(getEffectivePower(state, afterOne)).toBe(1);

        resolveActivated(state, afterOne, "phyrexian-battleflies-pump");
        const afterTwo = state.players[0].battlefield.find(
            (c) => c.id === "bug"
        )!;
        expect(getEffectivePower(state, afterTwo)).toBe(2);
        expect(getEffectiveToughness(state, afterTwo)).toBe(1); // toughness untouched

        // Wire format — the pumped power survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bug"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
    });

    it("canActivate rejects a third activation this turn (CR 602.5 activation cap), through the real server gate", () => {
        const ability = phyrexianBattleflies.activatedAbilities!.find(
            (a) => a.id === "phyrexian-battleflies-pump"
        )!;
        // Mirrors the production gate in game.ts:
        // `if (ability.canActivate && !ability.canActivate(card, state)) throw`.
        const cappedOut = makeInstance(phyrexianBattleflies.id, {
            id: "bug-capped",
            controllerId: "p1",
            activationsThisTurn: { "phyrexian-battleflies-pump": 2 },
        });
        expect(ability.canActivate!(cappedOut as never, {} as never)).toBe(
            false
        );

        const oneUsed = makeInstance(phyrexianBattleflies.id, {
            id: "bug-one-used",
            controllerId: "p1",
            activationsThisTurn: { "phyrexian-battleflies-pump": 1 },
        });
        expect(ability.canActivate!(oneUsed as never, {} as never)).toBe(true);
    });
});

describe("Addle (choose a color; target player reveals hand, you choose a card of that color, they discard it; CR 701.20a / 701.9)", () => {
    it("reveals the target player's hand, then discards the chosen-color card, leaving the rest", () => {
        const blackCard = makeInstance(bogInitiate.id, {
            id: "p2-black",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const whiteCard = makeInstance(savannahLions.id, {
            id: "p2-white",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [blackCard, whiteCard] }),
            ],
        });
        pushSpell(state, addle.id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on "choose a color"
        const colorPick = state.pendingChoices![0];
        expect(colorPick.kind).toBe("option-pick");
        // addleMode has no explicit `id`, so the option id is its position:
        // 0=W, 1=U, 2=B, 3=R, 4=G.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: colorPick.stackItemId,
            step: colorPick.step,
            choiceId: colorPick.choiceId,
            cardInstanceIds: ["2"],
        });

        const cardPick = state.pendingChoices![0];
        expect(cardPick.kind).toBe("choose-hand-card");
        expect(cardPick.candidateIds).toEqual(["p2-black"]); // the white card is filtered out
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: cardPick.stackItemId,
            step: cardPick.step,
            choiceId: cardPick.choiceId,
            cardInstanceIds: ["p2-black"],
        });

        expect(
            state.players[1].graveyard.some((c) => c.id === "p2-black")
        ).toBe(true);
        expect(state.players[1].hand.some((c) => c.id === "p2-white")).toBe(
            true
        );
    });

    it("wire format: the reveal keeps the opponent's remaining hand visible to the caster after resolution", () => {
        const blackCard = makeInstance(bogInitiate.id, {
            id: "p2-black-wire",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const whiteCard = makeInstance(savannahLions.id, {
            id: "p2-white-wire",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [blackCard, whiteCard] }),
            ],
        });
        pushSpell(state, addle.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const colorPick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: colorPick.stackItemId,
            step: colorPick.step,
            choiceId: colorPick.choiceId,
            cardInstanceIds: ["2"],
        });
        const cardPick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: cardPick.stackItemId,
            step: cardPick.step,
            choiceId: cardPick.choiceId,
            cardInstanceIds: ["p2-black-wire"],
        });

        // Before Addle, an opponent's hand card is null in a viewer's own
        // projection; the reveal's `knownTo` stamp makes the surviving card
        // visible to p1 even after the spell has fully resolved.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].hand.some((c) => c?.id === "p2-white-wire")
        ).toBe(true);
    });
});
