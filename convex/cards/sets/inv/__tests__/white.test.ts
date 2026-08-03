// Invasion (INV) — white free-tranche behavior tests (issue #1069, parent
// PRD #1063). Per ADR 0045's per-Op regime, a DSL card that only reuses
// already-exercised Ops needs no hand-written test (the catalogue-wide
// `validateEffectScript` static sweep + the auto-generated canned-scenario
// smoke test cover it). This file covers the cards the "Card testing
// convention" table (.claude/rules/gre-development.md) still mandates a
// hand-written test for: `resolve()` cards (Restrain, Liberate) and
// `staticEffects[]` P/T CDAs (Crusading Knight, Ruham Djinn), plus a few
// closures (cost-modifier, replacement redirect/clamp, keyword-grant) that
// the catalogue smoke sweep can't meaningfully exercise on its own.
//
// First-printing audit (ADR 0041): some cards exercised below were first
// implemented as part of this INV tranche but are REPRINTS — their
// definitions now live in their earliest-paper-printing home sets, and INV
// keeps only a `CardPrint`. The behaviour suites stay with the tranche that
// authored them and import the definition from its home module.

import { describe, it, expect } from "vitest";
import {
    alabasterLeech,
    benalishEmissary,
    benalishLancer,
    crusadingKnight,
    deathOrGlory,
    divinePresence,
    fightOrFlight,
    harshJudgment,
    liberate,
    prisonBarricade,
    restrain,
    reyaDawnbringer,
    ruhamDjinn,
    strengthOfUnity,
    wayfaringGiant,
    winnow,
} from "../white";
import { shackles } from "../../exo/white";
import { blackVise } from "../../lea/colorless";
import { balduvianBears } from "../../ice/green";
import { psionicBlast } from "../../lea/blue";
import {
    blackKnight,
    drudgeSkeletons,
    island,
    plains,
    savannahLions,
    swamp,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTrigger } from "./helpers";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { sourcePreventionShieldApplies } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { validateAttackerEligibility } from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";

// ---------------------------------------------------------------------------
// Alabaster Leech — cost-modifier (CR 601.2f), scoped to the controller's own
// white spells only (distinct from Gloom's symmetric tax).
// ---------------------------------------------------------------------------

describe("Alabaster Leech (CR 601.2f cost-modifier — your white spells only)", () => {
    it("your own white spell costs {W} more", () => {
        const leech = makeInstance(alabasterLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ownWhiteSpell = makeInstance(savannahLions.id, {
            id: "lions-own",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [leech],
                    hand: [ownWhiteSpell],
                }),
                makePlayer("p2"),
            ],
        });
        const mods = getCostModifiers(state, ownWhiteSpell, "spell");
        expect(mods.increase).toEqual({ W: 1 });
        const baseCost = normalizeManaCost(savannahLions.manaCost!);
        applyCostModifiers(baseCost, mods);
        expect(baseCost).toEqual({ W: 2 });
    });

    it("an opponent's white spell is unaffected", () => {
        const leech = makeInstance(alabasterLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const opponentWhiteSpell = makeInstance(savannahLions.id, {
            id: "lions-opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [leech] }),
                makePlayer("p2", { hand: [opponentWhiteSpell] }),
            ],
        });
        const mods = getCostModifiers(state, opponentWhiteSpell, "spell");
        expect(mods.increase).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// Crusading Knight — CDA P/T (CR 604.3, layer 7a): +1/+1 per opponents' Swamp
// ---------------------------------------------------------------------------

describe("Crusading Knight (CR 604.3 CDA — +1/+1 per opponents' Swamp)", () => {
    it("gets +1/+1 for each opponent's Swamp", () => {
        const knight = makeInstance(crusadingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const swamps = Array.from({ length: 3 }, (_, i) =>
            makeInstance(swamp.id, {
                id: `swamp-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2", { battlefield: swamps }),
            ],
        });
        expect(getEffectivePower(state, knight)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, knight)).toBe(5);
    });

    it("ignores the controller's own Swamps", () => {
        const knight = makeInstance(crusadingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ownSwamp = makeInstance(swamp.id, {
            id: "own-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight, ownSwamp] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, knight)).toBe(2);
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const knight = makeInstance(crusadingKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const swamps = Array.from({ length: 2 }, (_, i) =>
            makeInstance(swamp.id, {
                id: `swamp-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2", { battlefield: swamps }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "knight"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Wayfaring Giant / Strength of Unity — Domain-scaled `pt-cda` (CR 604.3 /
// 702 preamble, issue #1066). Both share the `countDomain` helper; the wire
// format re-assertion after `projectPublicState` is mandatory per the Card
// testing convention for staticEffects[] (layer 7c).
// ---------------------------------------------------------------------------

describe("Wayfaring Giant (CR 604.3 CDA — +1/+1 per Domain, issue #1066)", () => {
    it("gets +1/+1 for each basic land type controlled (printed 1/3 base)", () => {
        const giant = makeInstance(wayfaringGiant.id, {
            id: "giant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [plains, island, swamp].map((def, i) =>
            makeInstance(def.id, {
                id: `wg-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant, ...lands] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, giant)).toBe(4); // 1 + 3
        expect(getEffectiveToughness(state, giant)).toBe(6); // 3 + 3
    });

    it("is the printed 1/3 with no basic lands (Domain 0)", () => {
        const giant = makeInstance(wayfaringGiant.id, {
            id: "giant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, giant)).toBe(1);
        expect(getEffectiveToughness(state, giant)).toBe(3);
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const giant = makeInstance(wayfaringGiant.id, {
            id: "giant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `wg-wire-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant, ...lands] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "giant"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3); // 1 + 2
        expect(getEffectiveToughness(projected, slim)).toBe(5); // 3 + 2
    });
});

describe("Strength of Unity (CR 303.4 aura / 604.3 CDA — +1/+1 per Domain, issue #1066)", () => {
    it("gives the enchanted creature +1/+1 for each of the AURA CONTROLLER's basic land types", () => {
        const bear = makeInstance(savannahLions.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(strengthOfUnity.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const lands = [plains, island, swamp].map((def, i) =>
            makeInstance(def.id, {
                id: `su-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura, ...lands] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Savannah Lions is a 2/1; the AURA controller (p1) has Domain 3, not
        // the enchanted creature's controller (p2, who has none).
        expect(getEffectivePower(state, bear)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, bear)).toBe(4); // 1 + 3
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const bear = makeInstance(savannahLions.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(strengthOfUnity.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `su-wire-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura, ...lands] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slimBear)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(projected, slimBear)).toBe(3); // 1 + 2
    });
});

// ---------------------------------------------------------------------------
// Ruham Djinn — CDA P/T (CR 604.3): -2/-2 while white is the (tied-)most
// common color among all permanents.
// ---------------------------------------------------------------------------

describe("Ruham Djinn (CR 604.3 CDA — -2/-2 while white is most common)", () => {
    it("is -2/-2 when white is the sole most common color", () => {
        const djinn = makeInstance(ruhamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteExtra = makeInstance(savannahLions.id, {
            id: "lions",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn, whiteExtra] }),
                makePlayer("p2"),
            ],
        });
        // Ruham Djinn (W) + Savannah Lions (W) = 2 white vs 0 of everything
        // else — white is strictly most common.
        expect(getEffectivePower(state, djinn)).toBe(3); // 5 - 2
        expect(getEffectiveToughness(state, djinn)).toBe(3);
    });

    it("stays full-sized when white is not the (tied-)most common color", () => {
        const djinn = makeInstance(ruhamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Two black permanents (no colors field on the fixture creature id,
        // so use two copies of a black card) outnumber Ruham Djinn's lone
        // white pip.
        const blackOne = makeInstance(blackKnight.id, {
            id: "bk1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blackTwo = makeInstance(drudgeSkeletons.id, {
            id: "bk2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn] }),
                makePlayer("p2", { battlefield: [blackOne, blackTwo] }),
            ],
        });
        expect(getEffectivePower(state, djinn)).toBe(5);
        expect(getEffectiveToughness(state, djinn)).toBe(5);
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const djinn = makeInstance(ruhamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteExtra = makeInstance(savannahLions.id, {
            id: "lions",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn, whiteExtra] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "djinn"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Divine Presence — damage replacement clamp (CR 614, ADR 0020)
// ---------------------------------------------------------------------------

describe("Divine Presence (CR 614 damage clamp — 4+ becomes 3)", () => {
    it("clamps 4 damage to a player down to 3", () => {
        const presence = makeInstance(divinePresence.id, {
            id: "presence",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [presence], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        pushSpell(state, psionicBlast.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        // Psionic Blast: 4 to any target (clamped to 3) + 2 to its own
        // caster (unaffected — not dealt "to a permanent or player" other
        // than the caster themself, but Divine Presence has no controller
        // restriction, so the self-damage clause is also 2 < 4, unclamped).
        expect(state.players[0].life).toBe(17); // 20 - 3
        expect(state.players[1].life).toBe(18); // 20 - 2 (self damage)
    });
});

// ---------------------------------------------------------------------------
// Harsh Judgment — chosen-color redirect (CR 614, modes/chosenModeId)
// ---------------------------------------------------------------------------

describe("Harsh Judgment (CR 614 redirect — chosen-color instant/sorcery damage)", () => {
    it("redirects damage from a chosen-color instant to its controller", () => {
        const judgment = makeInstance(harshJudgment.id, {
            id: "judgment",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: "U",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [judgment], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        pushSpell(state, psionicBlast.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        // The 4-damage clause (blue instant, targets p1) redirects to its
        // controller (p2); the 2-damage self-clause targets p2 directly and
        // is unaffected (already p2, not p1).
        expect(state.players[0].life).toBe(20); // p1 untouched
        expect(state.players[1].life).toBe(14); // 20 - 4 (redirected) - 2 (self)
    });

    it("does not redirect an off-color spell", () => {
        const judgment = makeInstance(harshJudgment.id, {
            id: "judgment",
            controllerId: "p1",
            ownerId: "p1",
            chosenModeId: "R", // Psionic Blast is blue, not red
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [judgment], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        pushSpell(state, psionicBlast.id, "p2", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(16); // 20 - 4, not redirected
        expect(state.players[1].life).toBe(18); // 20 - 2 self damage
    });
});

// ---------------------------------------------------------------------------
// Shackles — keyword-grant does-not-untap (CR 502.1) + return-to-hand ability
// ---------------------------------------------------------------------------

describe("Shackles (CR 502.1 does-not-untap Aura + return-to-hand ability)", () => {
    it("declares the does-not-untap host-grant", () => {
        const grant = shackles.staticEffects?.[0];
        expect(grant?.kind).toBe("keyword-grant");
        if (grant?.kind === "keyword-grant") {
            expect(grant.keyword).toBe("does-not-untap");
        }
    });

    it("grants does-not-untap to the enchanted host on resolution", () => {
        const bears = makeInstance(balduvianBears.id, {
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
        pushSpell(state, shackles.id, "p1", [
            { type: "permanent", id: "bears" },
        ]);
        resolveTopOfStack(state);
        const host = state.players[1].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(host.staticAbilities).toContain("does-not-untap");
    });

    it("returns itself to its owner's hand for {W}", () => {
        const ability = shackles.activatedAbilities!.find(
            (a) => a.id === "shackles-return"
        )!;
        expect(ability.cost.mana).toEqual({ W: 1 });
        expect(ability.effects).toEqual([
            { op: "moveZone", target: { ref: "$source" }, to: "hand" },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Restrain — resolve() protocol card (precedent: Warning, ice/white.ts)
// ---------------------------------------------------------------------------

describe("Restrain (CR 510.1c assigns-no-combat-damage + draw)", () => {
    it("marks the attacker and draws a card", () => {
        const attacker = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const topOfLibrary = makeInstance(savannahLions.id, {
            id: "lib-top",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [topOfLibrary] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        pushSpell(state, restrain.id, "p1", [{ type: "permanent", id: "atk" }]);
        resolveTopOfStack(state);
        expect(sourcePreventionShieldApplies(state, "atk", true)).toBe(true);
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-top");
    });
});

// ---------------------------------------------------------------------------
// Liberate — resolve() protocol card (precedent: Flickerwisp, eve/white.ts)
// ---------------------------------------------------------------------------

describe("Liberate (CR 603.7a exile + next-end-step return, flicker idiom)", () => {
    it("exiles the target creature you control and schedules a return", () => {
        const creature = makeInstance(balduvianBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, liberate.id, "p1", [
            { type: "permanent", id: "mine" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")
        ).toBeUndefined();
        expect(state.players[0].exile.map((c) => c.id)).toContain("mine");
        expect(state.delayedTriggers?.length).toBeGreaterThanOrEqual(1);
    });

    it("returns the exiled creature to the battlefield under its owner's control at the next end step", () => {
        const creature = makeInstance(balduvianBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, liberate.id, "p1", [
            { type: "permanent", id: "mine" },
        ]);
        resolveTopOfStack(state);
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")
        ).toBeDefined();
        expect(
            state.players[0].exile.find((c) => c.id === "mine")
        ).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Reya Dawnbringer — CR 603.3d targeted upkeep trigger (issue #1193): "you may
// return target creature card from your graveyard to the battlefield". The
// target is announced when the trigger goes on the stack (real
// `targetRequirement` + `raiseTriggerTargetSelection`), not a resolution-time
// choice — up-to-one, `zone: "graveyard"`, `controller: "you"`.
// ---------------------------------------------------------------------------

/** Puts Reya's upkeep trigger on the stack (PHASE_BEGIN / UPKEEP, CR 603.6a).
 *  Leaves `targets` unset so `raiseTriggerTargetSelection` picks it up. */
function reyaUpkeepTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "reya-upkeep-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "reya-dawnbringer-upkeep",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: source.controllerId,
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d graveyard-target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen
 *  graveyard-card (or the empty "decline" set) onto the on-stack trigger. */
function chooseReyaTarget(
    state: GameState,
    target: { id: string; playerId: string } | null
) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = target
        ? [{ type: "graveyard-card", id: target.id, playerId: target.playerId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Reya Dawnbringer (CR 603.3d targeted upkeep reanimation, issue #1193)", () => {
    it("declares the CR 603.3d target requirement: up to one graveyard creature you control", () => {
        expect(
            reyaDawnbringer.triggeredAbilities?.[0]?.targetRequirement
        ).toEqual({
            type: "Creature",
            count: { min: 0, max: 1 },
            zone: "graveyard",
            controller: "you",
        });
    });

    it("returns the targeted graveyard creature to the battlefield", () => {
        const reya = makeInstance(reyaDawnbringer.id, {
            id: "reya",
            controllerId: "p1",
            ownerId: "p1",
        });
        const deadCreature = makeInstance(savannahLions.id, {
            id: "dead-lion",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [reya],
                    graveyard: [deadCreature],
                }),
                makePlayer("p2"),
            ],
        });
        reyaUpkeepTriggerOnStack(state, reya);
        chooseReyaTarget(state, { id: "dead-lion", playerId: "p1" });
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(
            state.players[0].battlefield.find((c) => c.id === "dead-lion")
        ).toBeDefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "dead-lion")
        ).toBeUndefined();
    });

    it("declines (up-to-one, empty target set) — the creature stays in the graveyard", () => {
        const reya = makeInstance(reyaDawnbringer.id, {
            id: "reya",
            controllerId: "p1",
            ownerId: "p1",
        });
        const deadCreature = makeInstance(savannahLions.id, {
            id: "dead-lion",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [reya],
                    graveyard: [deadCreature],
                }),
                makePlayer("p2"),
            ],
        });
        reyaUpkeepTriggerOnStack(state, reya);
        chooseReyaTarget(state, null);
        resolveTopOfStack(state);

        expect(
            state.players[0].graveyard.find((c) => c.id === "dead-lion")
        ).toBeDefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead-lion")
        ).toBeUndefined();
    });
});

describe("Death or Glory (CR 406 exile / 400.7 reanimation, ADR 0053 pile division, issue #1067)", () => {
    it("divides the caster's own graveyard creatures; an opponent chooses the exiled pile; the other returns to the battlefield", () => {
        const graveyard = ["dg-1", "dg-2", "dg-3"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
        });
        pushSpell(state, deathOrGlory.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended

        const divide = state.pendingChoices![0];
        expect(divide.kind).toBe("divide-piles");
        expect(divide.playerId).toBe("p1"); // the caster divides their OWN graveyard
        expect(divide.zone).toBe("graveyard");
        expect(divide.candidateIds?.slice().sort()).toEqual([
            "dg-1",
            "dg-2",
            "dg-3",
        ]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["dg-1"],
        });

        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");
        expect(pick.playerId).toBe("p2"); // an opponent chooses
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"],
        });

        expect(state.players[0].exile.map((c) => c.id)).toEqual(["dg-1"]);
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "dg-2",
            "dg-3",
        ]);
        expect(
            state.players[0].graveyard.some(
                (c) => c.id === "dg-2" || c.id === "dg-3"
            )
        ).toBe(false);
    });

    it("only creature cards in the graveyard are divided (a noncreature card is untouched)", () => {
        const creature = makeInstance(savannahLions.id, {
            id: "dg-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const land = makeInstance(plains.id, {
            id: "dg-land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [creature, land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, deathOrGlory.id, "p1");
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        expect(divide.candidateIds).toEqual(["dg-creature"]);
    });
});

describe("Fight or Flight (CR 603.6a combat-begin trigger / 508.1a attack restriction, ADR 0053 pile division, issue #1067)", () => {
    function fireCombatBegin(
        state: GameState,
        source: ReturnType<typeof makeInstance>,
        activePlayerId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "fight-or-flight-divide",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId,
            },
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("divides the OPPONENT's creatures on their combat (scope: opponents); the opponent chooses; the OTHER pile can't attack", () => {
        const enchantment = makeInstance(fightOrFlight.id, {
            id: "fof",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creatures = ["fof-1", "fof-2"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchantment] }),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
        fireCombatBegin(state, enchantment, "p2");
        const divide = state.pendingChoices![0];
        expect(divide.kind).toBe("divide-piles");
        // Divider stays the enchantment's controller (`"controller"`, fixed)
        // regardless of scope; the object set is the ACTIVE player's (p2's)
        // creatures.
        expect(divide.playerId).toBe("p1");
        expect(divide.zoneOwnerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["fof-1"],
        });

        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");
        // The chooser is the active player (p2), read via $event, not a
        // plain "opponent" (which would wrongly resolve to p1 here).
        expect(pick.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"], // choose pile A (fof-1) — may attack
        });

        const chosen = state.players[1].battlefield.find(
            (c) => c.id === "fof-1"
        )!;
        const other = state.players[1].battlefield.find(
            (c) => c.id === "fof-2"
        )!;
        expect(chosen.cantAttackThisTurn).toBeUndefined();
        expect(validateAttackerEligibility(chosen).eligible).toBe(true);
        expect(other.cantAttackThisTurn).toBe(true);
        expect(validateAttackerEligibility(other).eligible).toBe(false);
    });

    it("survives the wire projection (cantAttackThisTurn crosses the wire)", () => {
        const enchantment = makeInstance(fightOrFlight.id, {
            id: "fof-wire",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creature = makeInstance(savannahLions.id, {
            id: "fof-wire-creature",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchantment] }),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        fireCombatBegin(state, enchantment, "p2");
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: [], // pile A empty — the creature lands in pile B
        });
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"], // choose the (empty) pile A — B can't attack
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "fof-wire-creature"
        );
        expect(slim?.cantAttackThisTurn).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Benalish Emissary — single Kicker, ETB destroy-target-land (issue #1328,
// decomposed from #1086). The auto-generated DSL smoke sweep explicitly
// SKIPS this card's ability ("construct 'if' branches on a runtime
// predicate — covered by the card's own tests"), so per
// `.claude/rules/gre-development.md` this hand-written suite is the required
// proof obligation, not optional per-Op coverage. Uses the Waterspout
// Elemental (`pls/blue.ts`) / Thunderscape Battlemage (`pls/red.ts`)
// template: `conditionOnSelf: kickerPaidCondition` at CR 603.4 check time
// (exercised via the REAL cast path below), `if { kickerPaid }` inside
// `effects[]` at resolution time (exercised via `resolveTrigger`, which
// bypasses CR 603.3d target ANNOUNCEMENT itself — a separate,
// already-tested engine concern, same precedent comment as
// `pls/__tests__/blue.test.ts`).
// ---------------------------------------------------------------------------

describe("Benalish Emissary (single Kicker ETB — destroy target land, issue #1328)", () => {
    it("unkicked: the ETB trigger never even reaches the stack (CR 603.4 check-time gate)", () => {
        const targetLand = makeInstance(plains.id, {
            id: "be-target-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [targetLand] }),
            ],
        });
        pushSpell(state, benalishEmissary.id, "p1"); // no kickerPayments — unkicked
        resolveTopOfStack(state); // creature resolves, enters, triggers scanned
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[1].battlefield.some((c) => c.id === "be-target-land")
        ).toBe(true);
    });

    it("kicked: the ETB trigger destroys the announced target land", () => {
        const emissary = makeInstance(benalishEmissary.id, {
            id: "be-kicked",
            controllerId: "p1",
            ownerId: "p1",
        });
        const targetLand = makeInstance(plains.id, {
            id: "be-target-land-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [emissary] }),
                makePlayer("p2", { battlefield: [targetLand] }),
            ],
        });
        (
            emissary as CardInstanceState & {
                kickerPayments?: Record<string, number>;
            }
        ).kickerPayments = { kicker: 1 };
        resolveTrigger(
            state,
            emissary,
            "benalish-emissary-kicked",
            {
                type: "PERMANENT_ENTERED",
                instanceId: emissary.id,
                controllerId: emissary.controllerId,
                types: emissary.types,
            } as StackItem["triggerEvent"],
            [{ type: "permanent", id: "be-target-land-2" }]
        );
        expect(
            state.players[1].battlefield.some(
                (c) => c.id === "be-target-land-2"
            )
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "be-target-land-2")
        ).toBe(true);
    });

    // Defense in depth (CR 707.10 — an ability copy could reach the stack
    // without re-running `matches`): even manually forced onto the stack
    // without a paid kicker, the resolution-time `if { kickerPaid }` branch
    // inside `effects[]` still blocks the destroy. Same precedent as
    // Thunderscape Battlemage's "unkicked: neither trigger does anything
    // even though both still announce a target" (`pls/__tests__/red.test.ts`).
    it("resolution-time gate: forced onto the stack unkicked, the destroy still does not fire", () => {
        const emissary = makeInstance(benalishEmissary.id, {
            id: "be-unkicked-forced",
            controllerId: "p1",
            ownerId: "p1",
        });
        const targetLand = makeInstance(plains.id, {
            id: "be-target-land-3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [emissary] }),
                makePlayer("p2", { battlefield: [targetLand] }),
            ],
        });
        resolveTrigger(
            state,
            emissary,
            "benalish-emissary-kicked",
            {
                type: "PERMANENT_ENTERED",
                instanceId: emissary.id,
                controllerId: emissary.controllerId,
                types: emissary.types,
            } as StackItem["triggerEvent"],
            [{ type: "permanent", id: "be-target-land-3" }]
        );
        expect(
            state.players[1].battlefield.some(
                (c) => c.id === "be-target-land-3"
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Benalish Lancer — single Kicker, entersWith two +1/+1 counters + a
// `keyword-grant` of first strike gated on `wasKicked` (issue #1328). Exact
// Pouncing Kavu / Duskwalker template (`inv/red.ts` / `inv/black.ts`) —
// already-exercised composition, so this is a confirming test of THIS
// card's specific outcome (per-Op regime), not a re-proof of the underlying
// `wasKicked` mechanism (which carries its own regression suite on Pouncing
// Kavu).
// ---------------------------------------------------------------------------

describe("Benalish Lancer (Kicker -> two +1/+1 counters + first strike, issue #1328)", () => {
    function enterKicked(kicked: boolean) {
        const state = makeState();
        const item = pushSpell(state, benalishLancer.id, "p1");
        if (kicked) item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        return state;
    }

    it("kicked: enters with two +1/+1 counters and first strike", () => {
        const state = enterKicked(true);
        const lancer = state.players[0].battlefield.find(
            (c) => c.card.id === benalishLancer.id
        )!;
        expect(lancer.counters?.["+1/+1"]).toBe(2);
        expect(lancer.wasKicked).toBe(true);
        expect(lancer.staticAbilities).toContain("first strike");
    });

    it("not kicked: no counters, no first strike, wasKicked unset", () => {
        const state = enterKicked(false);
        const lancer = state.players[0].battlefield.find(
            (c) => c.card.id === benalishLancer.id
        )!;
        expect(lancer.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(lancer.wasKicked).toBeUndefined();
        expect(lancer.staticAbilities).not.toContain("first strike");
    });

    // Wire format (mandatory for a `staticEffects[]` card, per the "Card
    // testing convention" table) — the materialized "first strike" keyword
    // must survive `projectPublicState`'s slim reshape.
    it("kicked first strike grant survives projectPublicState (wire format)", () => {
        const state = enterKicked(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === benalishLancer.id
        )!;
        expect(slim.wasKicked).toBe(true);
        expect(slim.staticAbilities).toContain("first strike");
    });
});

// ---------------------------------------------------------------------------
// Prison Barricade — single Kicker, entersWith a +1/+1 counter + a
// `keyword-remove` of "defender" gated on `wasKicked` (issue #1328). Sibling
// of the keyword-grant shape above, using `StaticKeywordRemove` instead
// (`cards/types.ts`) — CR 702.3a's entire effect of defender is "can't
// attack", so stripping the printed keyword IS "can attack as though it
// didn't have defender": `evaluateAttackerKeywords`
// (`gre/combatRegistry.ts`) only ever consults the DEFENDER_RULE when
// `staticAbilities.includes("defender")`.
// ---------------------------------------------------------------------------

describe("Prison Barricade (Kicker -> +1/+1 counter + loses defender, issue #1328)", () => {
    function enterKicked(kicked: boolean) {
        const state = makeState();
        const item = pushSpell(state, prisonBarricade.id, "p1");
        if (kicked) item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        return state;
    }

    it("unkicked: still has defender, cannot attack", () => {
        const state = enterKicked(false);
        const barricade = state.players[0].battlefield.find(
            (c) => c.card.id === prisonBarricade.id
        )!;
        expect(barricade.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(barricade.wasKicked).toBeUndefined();
        expect(barricade.staticAbilities).toContain("defender");
        // Isolate from CR 302.6 summoning sickness (see the kicked case
        // below) so this assertion is specifically about defender, not a
        // coincidentally-false result from two independent restrictions.
        barricade.isSummoningSick = false;
        const attackCheck = validateAttackerEligibility(barricade);
        expect(attackCheck.eligible).toBe(false);
        if (!attackCheck.eligible) {
            expect(attackCheck.reason).toMatch(/defender/i);
        }
    });

    it("kicked: enters with a +1/+1 counter, loses defender, can attack", () => {
        const state = enterKicked(true);
        const barricade = state.players[0].battlefield.find(
            (c) => c.card.id === prisonBarricade.id
        )!;
        expect(barricade.counters?.["+1/+1"]).toBe(1);
        expect(barricade.wasKicked).toBe(true);
        expect(barricade.staticAbilities).not.toContain("defender");
        // Isolate the defender-removal check from CR 302.6 summoning
        // sickness (a separate, unrelated attack restriction every fresh
        // permanent has regardless of this card's ability).
        barricade.isSummoningSick = false;
        const attackCheck = validateAttackerEligibility(barricade);
        expect(attackCheck.eligible).toBe(true);
    });

    // Wire format (mandatory for a `staticEffects[]` card) — the removed
    // "defender" keyword must survive `projectPublicState`'s slim reshape.
    it("kicked defender removal survives projectPublicState (wire format)", () => {
        const state = enterKicked(true);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === prisonBarricade.id
        )!;
        expect(slim.wasKicked).toBe(true);
        expect(slim.staticAbilities).not.toContain("defender");
    });
});

// ---------------------------------------------------------------------------
// Winnow — "Destroy target nonland permanent if another permanent with the
// same name is on the battlefield. Draw a card." (issue #2065)
//
// The same-name condition is a CR 608.2 RESOLUTION check, not a targeting
// restriction: Winnow legally targets any nonland permanent and simply fails
// its condition (and still draws) when the name is unique on resolution.
// ---------------------------------------------------------------------------

describe("Winnow (CR 608.2 resolution condition + CR 201.2 same name, issue #2065)", () => {
    /** Two seats, `p2` holding the intended target; `p1` has a library so the
     *  unconditional draw is observable. */
    const winnowState = (
        p1Battlefield: CardInstanceState[],
        p2Battlefield: CardInstanceState[]
    ): GameState =>
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: p1Battlefield,
                    library: [
                        makeInstance(plains.id, {
                            id: "draw-me",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
        });

    it("destroys the target when another permanent shares its name", () => {
        const target = makeInstance(balduvianBears.id, {
            id: "bears-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const twin = makeInstance(balduvianBears.id, {
            id: "bears-twin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = winnowState([twin], [target]);
        pushSpell(state, winnow.id, "p1", [
            { type: "permanent", id: "bears-target" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "bears-target")
        ).toBe(false);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "bears-target"
        );
        // The permanent that SATISFIED the condition is not itself destroyed.
        expect(
            state.players[0].battlefield.some((c) => c.id === "bears-twin")
        ).toBe(true);
        // Second Oracle sentence — unconditional.
        expect(state.players[0].hand.map((c) => c.id)).toContain("draw-me");
    });

    it("destroys nothing when the target's name is unique, and still draws (CR 608.2)", () => {
        // Three permanents, three distinct names: were the name constraint
        // dropped, the board count would be 3 (>= 2) and the target would die.
        const target = makeInstance(balduvianBears.id, {
            id: "solo-bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const lions = makeInstance(savannahLions.id, {
            id: "solo-lions",
            controllerId: "p2",
            ownerId: "p2",
        });
        const knight = makeInstance(blackKnight.id, {
            id: "solo-knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = winnowState([knight], [target, lions]);
        pushSpell(state, winnow.id, "p1", [
            { type: "permanent", id: "solo-bears" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "solo-bears")
        ).toBe(true);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("draw-me");
    });

    it("counts NONCREATURE permanents too — the count is not type-scoped", () => {
        // The Oracle says "another permanent", not "another creature": a
        // same-named ARTIFACT pair satisfies the condition exactly as a
        // creature pair does (and the `nonland` word lives on the targeting
        // requirement only).
        const target = makeInstance(blackVise.id, {
            id: "vise-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const twin = makeInstance(blackVise.id, {
            id: "vise-twin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = winnowState([twin], [target]);
        pushSpell(state, winnow.id, "p1", [
            { type: "permanent", id: "vise-target" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "vise-target")
        ).toBe(false);
        expect(state.players[0].hand.map((c) => c.id)).toContain("draw-me");
    });

    it("targets any nonland permanent — the condition is NOT a targeting restriction", () => {
        expect(winnow.targetRequirement?.excludeTypes).toBe("Land");
        expect(winnow.targetRequirement?.count).toBe(1);
        // No name/condition field on the requirement: legality at announcement
        // (CR 601.2c) is name-blind, so Winnow can be cast on a lone permanent
        // and simply do nothing on resolution.
        expect(JSON.stringify(winnow.targetRequirement)).not.toMatch(/name/);
    });

    it("the destroy survives projection (wire format)", () => {
        const target = makeInstance(balduvianBears.id, {
            id: "wire-target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const twin = makeInstance(balduvianBears.id, {
            id: "wire-twin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = winnowState([twin], [target]);
        // The name read is `card.card.id` on both sides — the field the
        // projection slims to `{ id }`.
        const before = projectPublicState(state, 1, "p1");
        expect(
            (
                before.players[0].battlefield.find((c) => c.id === "wire-twin")!
                    .card as { id?: string }
            ).id
        ).toBe(balduvianBears.id);
        pushSpell(state, winnow.id, "p1", [
            { type: "permanent", id: "wire-target" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].battlefield.some((c) => c.id === "wire-target")
        ).toBe(false);
        expect(
            projected.players[1].graveyard.some((c) => c.id === "wire-target")
        ).toBe(true);
    });
});
