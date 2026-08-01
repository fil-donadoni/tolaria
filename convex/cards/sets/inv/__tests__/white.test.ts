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
    crusadingKnight,
    deathOrGlory,
    divinePresence,
    fightOrFlight,
    harshJudgment,
    liberate,
    restrain,
    reyaDawnbringer,
    ruhamDjinn,
    strengthOfUnity,
    wayfaringGiant,
} from "../white";
import { shackles } from "../../exo/white";
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
