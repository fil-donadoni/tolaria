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

import { describe, it, expect } from "vitest";
import {
    alabasterLeech,
    crusadingKnight,
    divinePresence,
    harshJudgment,
    liberate,
    restrain,
    ruhamDjinn,
    shackles,
} from "../white";
import { balduvianBears } from "../../ice/green";
import { psionicBlast } from "../../lea/blue";
import { blackKnight, drudgeSkeletons, savannahLions, swamp } from "../../lea";
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
} from "../../../../gre/state";
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
        expect(state.assignsNoCombatDamageThisTurn).toContain("atk");
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
