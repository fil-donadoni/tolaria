// PLS (Planeshift) — white card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { lashknifeBarrier, heroicDefiance } from "../white";
import { crawWurm } from "../../lea/green";
import { lightningBolt, dragonWhelp } from "../../lea/red";
import { benalishHero } from "../../lea/white";
import { blackKnight } from "../../lea/black";
import { plains } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { mostCommonColors } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack, runDamageReplacement } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";

describe("Lashknife Barrier ({2}{W} Enchantment — damage reduction, CR 614)", () => {
    it("is a {2}{W} Enchantment with the modern oracle text", () => {
        expect(lashknifeBarrier.manaCost).toEqual({ X: 2, W: 1 });
        expect(lashknifeBarrier.types).toEqual(["Enchantment"]);
        expect(lashknifeBarrier.oracleText).toBe(
            "When this enchantment enters, draw a card.\nIf a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead."
        );
    });

    it("declares a single ETB trigger that draws a card (per-Op regime — draw is already exercised)", () => {
        expect(lashknifeBarrier.triggeredAbilities).toHaveLength(1);
        expect(lashknifeBarrier.triggeredAbilities?.[0]?.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("reduces damage from any source to a creature its controller controls by 1 (CR 614)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier, bear] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p2",
            { type: "permanent", id: "bear" },
            3,
            false
        );
        expect(res?.amount).toBe(2);
    });

    it("floors the reduction at 0 — a 1-damage source deals none", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier, bear] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p2",
            { type: "permanent", id: "bear" },
            1,
            false
        );
        expect(res?.amount).toBe(0);
    });

    it("does not apply to a creature the barrier's controller doesn't control", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(crawWurm.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p1",
            { type: "permanent", id: "opp-bear" },
            3,
            false
        );
        expect(res?.amount).toBe(3);
    });

    it("does not apply to damage dealt to a player (only creatures)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p2",
            { type: "player", id: "p1" },
            3,
            false
        );
        expect(res?.amount).toBe(3);
    });

    it("holds through the real damage pipeline and survives the wire projection (CR 614)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier, bear] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        // Lightning Bolt (LEA): "deals 3 damage to any target" — the real DSL
        // dealDamage Op path (SpellContext.dealDamage -> runDamageReplacement)
        // that every damage source in the engine funnels through.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.damageMarked).toBe(2); // 3 - 1

        const projected = projectPublicState(state, 0, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimBear?.damageMarked).toBe(2);
    });
});

describe("Heroic Defiance ({1}{W} Enchantment — Aura, most-common-colour census, CR 613)", () => {
    it("is a {1}{W} Enchantment — Aura with the modern oracle text", () => {
        expect(heroicDefiance.manaCost).toEqual({ X: 1, W: 1 });
        expect(heroicDefiance.types).toEqual(["Enchantment"]);
        expect(heroicDefiance.subtypes).toEqual(["Aura"]);
        expect(heroicDefiance.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        expect(heroicDefiance.oracleText).toBe(
            "Enchant creature\nEnchanted creature gets +3/+3 unless it shares a color with the most common color among all permanents or a color tied for most common."
        );
    });

    it("grants +3/+3 when the enchanted creature's colour is NOT among the most common (CR 613 census)", () => {
        // Census: aura W=1, target (Craw Wurm) G=1, three Dragon Whelps R=3 —
        // plus an inert colourless Plains, proving a colourless permanent
        // contributes to no colour and cannot skew the count. Red alone is
        // most common (3); green (the target's colour) is not tied — bonus
        // applies.
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(dragonWhelp.id, {
                            id: "dw1",
                            controllerId: "p2",
                        }),
                        makeInstance(dragonWhelp.id, {
                            id: "dw2",
                            controllerId: "p2",
                        }),
                        makeInstance(dragonWhelp.id, {
                            id: "dw3",
                            controllerId: "p2",
                        }),
                        makeInstance(plains.id, {
                            id: "land",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(9); // 6 + 3
        expect(getEffectiveToughness(state, target)).toBe(7); // 4 + 3
    });

    it("holds through the real layer pipeline and survives the wire projection (mandatory)", () => {
        // Deliberately the SUPPRESSED case (Benalish Hero, W=2 alone, shares
        // the target's own colour — bonus off, 1/1), NOT the bonus-applies
        // case. A census that silently reads nothing (`mostCommonColors`
        // stubbed to `[]`) would make `.some()` on `[]` false and the bonus
        // would incorrectly APPLY (4/4) — this scenario is the only one that
        // can catch that class of wire-projection bug; the bonus-applies
        // case can't (an empty census also produces "bonus applies" there,
        // so it can't distinguish a working census from a broken one).
        const target = makeInstance(benalishHero.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(1); // no bonus

        const projected = projectPublicState(state, 0, "p1");
        const slimTarget = projected.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(getEffectivePower(projected, slimTarget)).toBe(1);
        expect(getEffectiveToughness(projected, slimTarget)).toBe(1);
    });

    it("suppresses the bonus when the enchanted creature shares the SOLE most common colour", () => {
        // Census: aura W=1, target (Benalish Hero) W=1 — white alone is most
        // common (2), and it's the target's own colour.
        const target = makeInstance(benalishHero.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(1); // no bonus
        expect(getEffectiveToughness(state, target)).toBe(1);
    });

    it("suppresses the bonus when the enchanted creature's colour is TIED for most common", () => {
        // Census: aura W=1, target + a second Craw Wurm G=2, two Dragon
        // Whelps R=2 — green and red are tied at 2; the target's colour
        // (green) is one of the tied colours, so the bonus is suppressed.
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const secondWurm = makeInstance(crawWurm.id, {
            id: "second-wurm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura, secondWurm] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(dragonWhelp.id, {
                            id: "dw1",
                            controllerId: "p2",
                        }),
                        makeInstance(dragonWhelp.id, {
                            id: "dw2",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(6); // no bonus
        expect(getEffectiveToughness(state, target)).toBe(4);
    });

    it("still applies the bonus when OTHER colours are tied for most common (neither is the target's)", () => {
        // Census: aura W=1, target (Craw Wurm) G=1, two Dragon Whelps R=2,
        // two Black Knights B=2 — red and black are tied at 2, but the
        // target's colour (green) is not among them — bonus applies.
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(dragonWhelp.id, {
                            id: "dw1",
                            controllerId: "p2",
                        }),
                        makeInstance(dragonWhelp.id, {
                            id: "dw2",
                            controllerId: "p2",
                        }),
                        makeInstance(blackKnight.id, {
                            id: "bk1",
                            controllerId: "p2",
                        }),
                        makeInstance(blackKnight.id, {
                            id: "bk2",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(9); // 6 + 3
        expect(getEffectiveToughness(state, target)).toBe(7); // 4 + 3
    });

    it("re-evaluates continuously as the board changes, with no event or prompt", () => {
        // Starts with the bonus suppressed (white tied/dominant matching the
        // target); adding a permanent to the SAME already-built state (no
        // event, no re-cast) shifts the census and the bonus turns on, purely
        // because getEffectivePower re-reads the board at call time.
        const target = makeInstance(benalishHero.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(getEffectivePower(state, target)).toBe(1); // W=2 alone, shares — no bonus

        // A new green permanent enters (no event fired here — this is a pure
        // read-time re-evaluation, mirroring how the layer system already
        // works for every other continuous static effect).
        state.players[1].battlefield.push(
            makeInstance(crawWurm.id, { id: "green1", controllerId: "p2" }),
            makeInstance(crawWurm.id, { id: "green2", controllerId: "p2" }),
            makeInstance(crawWurm.id, { id: "green3", controllerId: "p2" })
        );
        expect(getEffectivePower(state, target)).toBe(4); // 1 + 3, bonus now applies
    });

    it("colour-changing effect shifts the census (effective colour, CR 613.1d layer 5)", () => {
        // Without an override, two Dragon Whelps count as RED (2) and the
        // green target is not tied — bonus applies. With `colorOverride`
        // (a layer-5 colour-change effect) turning both GREEN instead, green
        // becomes the census leader tied with the target's own colour —
        // bonus is suppressed. Same board, only the override differs.
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
        });
        const aura = makeInstance(heroicDefiance.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "target",
        });
        const overriddenWhelps = [
            makeInstance(dragonWhelp.id, {
                id: "dw1",
                controllerId: "p2",
                colorOverride: ["G"],
            }),
            makeInstance(dragonWhelp.id, {
                id: "dw2",
                controllerId: "p2",
                colorOverride: ["G"],
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2", { battlefield: overriddenWhelps }),
            ],
        });
        // Census: W=1, G=1(target)+2(overridden whelps)=3 — green alone is
        // most common and it's the target's colour — bonus suppressed.
        expect(getEffectivePower(state, target)).toBe(6); // no bonus
        expect(getEffectiveToughness(state, target)).toBe(4);
    });

    it("with no coloured permanents in play, the census is empty — the bonus's 'unless' condition can never hold (CR 613)", () => {
        // Heroic Defiance's own Aura is always white while its static effect
        // is live, so a fully colourless board can never be observed WITH
        // this card attached — this exercises the shared census helper
        // (`mostCommonColors`, `cards/types.ts`) directly, the same helper
        // the card's `compute` calls, against a colourless-only battlefield.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "land1",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        expect(mostCommonColors(state, STATIC_EFFECT_CTX)).toEqual([]);
        // .some(...) on an empty tied-colour set is always false, so the
        // card's `sharesColor` check is false and the +3/+3 bonus applies —
        // exactly the "no coloured permanents ⇒ bonus applies" rule.
    });
});
