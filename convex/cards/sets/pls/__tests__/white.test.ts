// PLS (Planeshift) — white card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import {
    lashknifeBarrier,
    heroicDefiance,
    hobble,
    samiteElder,
    auroraGriffin,
    discipleOfKangee,
    dominariasJudgment,
    honorableScout,
    marchOfSouls,
    orimsChant,
    samitePilgrim,
    surpriseDeployment,
    guardDogs,
    pollenRemedy,
} from "../white";
import { crawWurm, grizzlyBears } from "../../lea/green";
import { lightningBolt, dragonWhelp } from "../../lea/red";
import { benalishHero } from "../../lea/white";
import { blackKnight } from "../../lea/black";
import { plains, island, swamp, mountain, forest } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { mostCommonColors } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
    runDamageReplacement,
    applyTargetPrevention,
} from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../../../gre/combat";
import { castProhibitionReason } from "../../../castRestrictions";
import { legalActions } from "../../../../gre/legalActions";

/** Local resolveActivated shim (mirrors `inv/__tests__/helpers.ts`'s helper of
 *  the same name) — pushes an activated ability's stack item and resolves it,
 *  for Samite Elder's `resolve()` ability. */
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

describe("Hobble ({2}{W} Aura — can't-attack + conditional can't-block, CR 508.1c/509.1)", () => {
    it("is a {2}{W} Enchantment — Aura with the modern oracle text", () => {
        expect(hobble.manaCost).toEqual({ X: 2, W: 1 });
        expect(hobble.types).toEqual(["Enchantment"]);
        expect(hobble.subtypes).toEqual(["Aura"]);
        expect(hobble.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("prevents the enchanted creature from attacking (CR 508.1c, aura-granted attack-restriction)", () => {
        // Extends `collectAttackRestrictions` (gre/combat.ts) to scan attached
        // auras, mirroring `collectBlockRestrictions`'s existing aura scan —
        // this is the new capability this card's "can't attack" clause needed.
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(hobble.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2"),
            ],
        });
        const result = validateAttackerEligibility(
            target,
            state.players[1].battlefield,
            state
        );
        expect(result.eligible).toBe(false);
        expect(result.eligible === false && result.reason).toBe(
            "Enchanted creature can't attack."
        );
    });

    it("does NOT restrict a creature attacking without Hobble attached (no false-positive from the aura scan)", () => {
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        expect(
            validateAttackerEligibility(
                target,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
    });

    it("still evaluates a card's OWN (non-aura) attack-restriction — regression check for the aura-scan extension", () => {
        // Vodalian Serpent (inv/blue.ts) restricts ITSELF via a card-own
        // `attack-restriction`, with no aura involved — confirms
        // `collectAttackRestrictions`'s new aura scan doesn't disturb the
        // pre-existing own-card path (`inv/__tests__/blue.test.ts` covers this
        // in full; this is a narrower same-file sanity check).
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        expect(
            validateAttackerEligibility(
                target,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
    });

    it("prevents the enchanted creature from blocking when IT (the enchanted creature) is black", () => {
        // "Enchanted creature can't block if it's black" — side: "blocker",
        // self = the Hobbled creature. Black Knight (LEA) is black.
        const attacker = makeInstance(crawWurm.id, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const blackBlocker = makeInstance(blackKnight.id, {
            id: "blackBlocker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(hobble.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "blackBlocker",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blackBlocker, aura] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        expect(
            validateBlockerEligibility(
                attacker,
                blackBlocker,
                [blackBlocker],
                state
            ).eligible
        ).toBe(false);
    });

    it("does NOT restrict blocking when the enchanted creature isn't black", () => {
        // Benalish Hero (LEA) — vanilla, no evasion — isolates the
        // block-restriction check from an unrelated flying/reach gate.
        const attacker = makeInstance(benalishHero.id, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const greenBlocker = makeInstance(crawWurm.id, {
            id: "greenBlocker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(hobble.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "greenBlocker",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [greenBlocker, aura] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        expect(
            validateBlockerEligibility(
                attacker,
                greenBlocker,
                [greenBlocker],
                state
            ).eligible
        ).toBe(true);
    });

    it("the attack-restriction survives the wire projection (mandatory — issue #1948 review MAJOR 6)", () => {
        // The new aura scan reads PROJECTED fields (`perm.attachedTo`,
        // `perm.card.id`) on a path the client Brain also executes
        // (`gre/ai/blade/combatSetup.ts`) — mirrors `leg/__tests__/white.test.ts`
        // ("the lock survives projection (wire format)") and
        // `ice/__tests__/colorless.test.ts`'s identical pattern.
        const target = makeInstance(crawWurm.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(hobble.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "target",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [target, aura] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as typeof state;
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "target"
        )!;
        expect(validateAttackerEligibility(slim, [], projected).eligible).toBe(
            false
        );
    });

    it("the block-restriction survives the wire projection (mandatory — issue #1948 review MAJOR 6)", () => {
        const attacker = makeInstance(benalishHero.id, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const blackBlocker = makeInstance(blackKnight.id, {
            id: "blackBlocker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(hobble.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "blackBlocker",
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [blackBlocker, aura] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as typeof state;
        const slimAttacker = projected.players[1].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        const slimBlocker = projected.players[0].battlefield.find(
            (c) => c.id === "blackBlocker"
        )!;
        expect(
            validateBlockerEligibility(
                slimAttacker,
                slimBlocker,
                [slimBlocker],
                projected
            ).eligible
        ).toBe(false);
    });
});

describe("Samite Elder ({2}{W} Creature — dynamic protection grant, CR 702.16)", () => {
    it("is a {2}{W} Human Cleric 1/2 with the modern oracle text", () => {
        expect(samiteElder.manaCost).toEqual({ X: 2, W: 1 });
        expect(samiteElder.types).toEqual(["Creature"]);
        expect(samiteElder.subtypes).toEqual(["Human", "Cleric"]);
        expect(samiteElder.power).toBe(1);
        expect(samiteElder.toughness).toBe(2);
    });

    it("grants every creature the controller controls protection from EACH of the target permanent's colours (CR 702.16)", () => {
        const elder = makeInstance(samiteElder.id, {
            id: "elder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A red-and-green multicolour permanent (Dragon Whelp is red-only in
        // this pool; use two dragon whelps' shared colour instead — simplest
        // is a single-colour source, Dragon Whelp, red).
        const source = makeInstance(dragonWhelp.id, {
            id: "source",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elder, bear, source] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elder, "samite-elder-protection", [
            { type: "permanent", id: "source" },
        ]);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain("protection from red");
        // The source itself (also the controller's own creature) is a
        // "creature you control" too, so it also gets the grant.
        const sourceAfter = state.players[0].battlefield.find(
            (c) => c.id === "source"
        )!;
        expect(sourceAfter.staticAbilities).toContain("protection from red");
    });

    it("grants nothing when the target permanent is colourless (CR 105.2a — no colour to grant)", () => {
        const elder = makeInstance(samiteElder.id, {
            id: "elder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const colorlessSource = makeInstance(plains.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [elder, bear, colorlessSource],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elder, "samite-elder-protection", [
            { type: "permanent", id: "land" },
        ]);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(
            bearAfter.staticAbilities.some((a) =>
                a.startsWith("protection from")
            )
        ).toBe(false);
    });

    it("holds through the real activation path and survives the wire projection (mandatory — visible protection grant)", () => {
        const elder = makeInstance(samiteElder.id, {
            id: "elder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const source = makeInstance(dragonWhelp.id, {
            id: "source",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elder, bear, source] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elder, "samite-elder-protection", [
            { type: "permanent", id: "source" },
        ]);
        const projected = projectPublicState(state, 0, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimBear?.staticAbilities).toContain("protection from red");
    });
});

describe("Aurora Griffin ({W}: target permanent becomes white until end of turn, CR 613.1e)", () => {
    it("is a {3}{W} 2/2 flying Griffin with the modern oracle text", () => {
        expect(auroraGriffin.manaCost).toEqual({ X: 3, W: 1 });
        expect(auroraGriffin.types).toEqual(["Creature"]);
        expect(auroraGriffin.subtypes).toEqual(["Griffin"]);
        expect(auroraGriffin.power).toBe(2);
        expect(auroraGriffin.toughness).toBe(2);
        expect(auroraGriffin.staticAbilities).toContain("flying");
        expect(auroraGriffin.oracleText).toBe(
            "Flying\n{W}: Target permanent becomes white until end of turn."
        );
    });

    it("changes a target permanent's colour to white until end of turn (setColor, CR 613.1e)", () => {
        const griffin = makeInstance(auroraGriffin.id, {
            id: "griffin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [griffin] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        resolveActivated(state, griffin, "aurora-griffin-color", [
            { type: "permanent", id: "bear" },
        ]);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.colorOverride).toEqual(["W"]);
    });
});

describe("Disciple of Kangee ({U},{T}: target creature gains flying and becomes blue until end of turn)", () => {
    it("is a {2}{W} 2/2 Human Wizard with the modern oracle text", () => {
        expect(discipleOfKangee.manaCost).toEqual({ X: 2, W: 1 });
        expect(discipleOfKangee.types).toEqual(["Creature"]);
        expect(discipleOfKangee.subtypes).toEqual(["Human", "Wizard"]);
        expect(discipleOfKangee.power).toBe(2);
        expect(discipleOfKangee.toughness).toBe(2);
    });

    it("grants flying and changes the target's colour to blue until end of turn", () => {
        const disciple = makeInstance(discipleOfKangee.id, {
            id: "disciple",
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
                makePlayer("p1", { battlefield: [disciple, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, disciple, "disciple-of-kangee-fly-blue", [
            { type: "permanent", id: "bear" },
        ]);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain("flying");
        expect(bearAfter.colorOverride).toEqual(["U"]);
    });
});

describe("Dominaria's Judgment (per-basic-land-type conditional protection, CR 702.16)", () => {
    it("is a {2}{W} Instant with the modern oracle text", () => {
        expect(dominariasJudgment.manaCost).toEqual({ X: 2, W: 1 });
        expect(dominariasJudgment.types).toEqual(["Instant"]);
    });

    it("grants protection from white and blue only, when controlling exactly a Plains and an Island", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const plainsLand = makeInstance(plains.id, {
            id: "plains1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const islandLand = makeInstance(island.id, {
            id: "island1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bear, plainsLand, islandLand],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dominariasJudgment.id, "p1");
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain("protection from white");
        expect(bearAfter.staticAbilities).toContain("protection from blue");
        expect(bearAfter.staticAbilities).not.toContain(
            "protection from black"
        );
        expect(bearAfter.staticAbilities).not.toContain("protection from red");
        expect(bearAfter.staticAbilities).not.toContain(
            "protection from green"
        );
    });

    it("grants protection from all five colours when controlling one of each basic land type (Draco-style board)", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [
            makeInstance(plains.id, {
                id: "p",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(island.id, {
                id: "i",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(swamp.id, {
                id: "s",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(mountain.id, {
                id: "m",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(forest.id, {
                id: "f",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, ...lands] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dominariasJudgment.id, "p1");
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        for (const color of ["white", "blue", "black", "red", "green"]) {
            expect(bearAfter.staticAbilities).toContain(
                `protection from ${color}`
            );
        }
    });

    it("only affects creatures the caster controls, never the opponent's", () => {
        const myBear = makeInstance(crawWurm.id, {
            id: "myBear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "oppBear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const plainsLand = makeInstance(plains.id, {
            id: "plains1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myBear, plainsLand] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        pushSpell(state, dominariasJudgment.id, "p1");
        resolveTopOfStack(state);
        const myBearAfter = state.players[0].battlefield.find(
            (c) => c.id === "myBear"
        )!;
        const oppBearAfter = state.players[1].battlefield.find(
            (c) => c.id === "oppBear"
        )!;
        expect(myBearAfter.staticAbilities).toContain("protection from white");
        expect(oppBearAfter.staticAbilities ?? []).not.toContain(
            "protection from white"
        );
    });
});

describe("Honorable Scout (ETB: gain 2 life per black/red creature target opponent controls)", () => {
    /** Pushes Honorable Scout's ETB trigger directly with the target already
     *  announced (mirrors Xantid Swarm's `resolveAttackTrigger`,
     *  `sets/scg/__tests__/green.test.ts`) — exercises the ability's own
     *  effect resolution without re-driving the generic CR 603.3d
     *  announcement pipeline every ETB trigger already shares. */
    function resolveScoutTrigger(
        state: GameState,
        source: CardInstanceState,
        opponentId: string
    ): void {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "honorable-scout-etb",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: source.id,
                controllerId: source.controllerId,
                types: source.types,
            } as StackItem["triggerEvent"],
            targets: [{ type: "player", id: opponentId }],
        } as StackItem);
        resolveTopOfStack(state);
    }

    it("is a {W} 1/1 Human Soldier Scout with the modern oracle text", () => {
        expect(honorableScout.manaCost).toEqual({ W: 1 });
        expect(honorableScout.types).toEqual(["Creature"]);
        expect(honorableScout.subtypes).toEqual(["Human", "Soldier", "Scout"]);
        expect(honorableScout.power).toBe(1);
        expect(honorableScout.toughness).toBe(1);
    });

    it("gains 2 life for each black and/or red creature the targeted opponent controls", () => {
        const scout = makeInstance(honorableScout.id, {
            id: "scout",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blackCreature = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const redCreature = makeInstance(dragonWhelp.id, {
            id: "dw",
            controllerId: "p2",
            ownerId: "p2",
        });
        const goldRedBlack = makeInstance(dragonWhelp.id, {
            id: "extra-red",
            controllerId: "p2",
            ownerId: "p2",
        });
        const greenCreature = makeInstance(crawWurm.id, {
            id: "cw",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout] }),
                makePlayer("p2", {
                    battlefield: [
                        blackCreature,
                        redCreature,
                        goldRedBlack,
                        greenCreature,
                    ],
                }),
            ],
        });
        const before = state.players[0].life;
        resolveScoutTrigger(state, scout, "p2");
        // 3 matching creatures (black knight + 2 red dragon whelps), the
        // green creature does not count — 2 life each = 6.
        expect(state.players[0].life).toBe(before + 6);
    });

    it("gains no life when the targeted opponent controls no black/red creatures", () => {
        const scout = makeInstance(honorableScout.id, {
            id: "scout",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCreature = makeInstance(crawWurm.id, {
            id: "cw",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout] }),
                makePlayer("p2", { battlefield: [greenCreature] }),
            ],
        });
        const before = state.players[0].life;
        resolveScoutTrigger(state, scout, "p2");
        expect(state.players[0].life).toBe(before);
    });
});

describe("March of Souls (destroy all creatures, token per actually-destroyed creature, CR 701.8 / 111)", () => {
    it("is a {4}{W} Sorcery with the modern oracle text", () => {
        expect(marchOfSouls.manaCost).toEqual({ X: 4, W: 1 });
        expect(marchOfSouls.types).toEqual(["Sorcery"]);
    });

    it("destroys all creatures and each controller creates their own 1/1 white flying Spirit token", () => {
        const myBear = makeInstance(crawWurm.id, {
            id: "myBear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "oppBear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myBear] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        pushSpell(state, marchOfSouls.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "myBear")
        ).toBe(false);
        expect(
            state.players[1].battlefield.some((c) => c.id === "oppBear")
        ).toBe(false);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("myBear");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            "oppBear"
        );
        const p1Spirits = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Spirit")
        );
        const p2Spirits = state.players[1].battlefield.filter((c) =>
            c.subtypes?.includes("Spirit")
        );
        expect(p1Spirits).toHaveLength(1);
        expect(p2Spirits).toHaveLength(1);
        expect(p1Spirits[0].power).toBe(1);
        expect(p1Spirits[0].toughness).toBe(1);
        expect(p1Spirits[0].staticAbilities).toContain("flying");
    });

    it("does NOT create a token for an indestructible creature that survives (CR 701.8, only ACTUALLY-destroyed creatures get one)", () => {
        const indestructibleBear = makeInstance(crawWurm.id, {
            id: "indBear",
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [indestructibleBear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, marchOfSouls.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "indBear")
        ).toBe(true);
        const spirits = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Spirit")
        );
        expect(spirits).toHaveLength(0);
    });
});

describe("Orim's Chant (Kicker {W}; target player can't cast spells this turn; if kicked, creatures can't attack this turn)", () => {
    it("is a {W} Instant with a single {W} Kicker and the modern oracle text", () => {
        expect(orimsChant.manaCost).toEqual({ W: 1 });
        expect(orimsChant.types).toEqual(["Instant"]);
        expect(orimsChant.kickers).toEqual([
            { id: "kicker", description: "Kicker {W}", mana: { W: 1 } },
        ]);
    });

    it("locks the target player out of casting spells this turn, unkicked", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, orimsChant.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
        const bolt = makeInstance(lightningBolt.id, { id: "bolt" });
        expect(castProhibitionReason("p2", bolt, state)).toBeDefined();
        expect(castProhibitionReason("p1", bolt, state)).toBeUndefined();
    });

    it("unkicked does NOT restrict any creature from attacking", () => {
        const myBear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myBear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, orimsChant.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.cantAttackThisTurn).not.toBe(true);
    });

    it("kicked ALSO makes every creature currently in play (both players') unable to attack this turn", () => {
        const myBear = makeInstance(crawWurm.id, {
            id: "myBear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(grizzlyBears.id, {
            id: "oppBear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myBear] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        const item = pushSpell(state, orimsChant.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        const myBearAfter = state.players[0].battlefield.find(
            (c) => c.id === "myBear"
        )!;
        const oppBearAfter = state.players[1].battlefield.find(
            (c) => c.id === "oppBear"
        )!;
        expect(myBearAfter.cantAttackThisTurn).toBe(true);
        expect(oppBearAfter.cantAttackThisTurn).toBe(true);
        // The base "can't cast spells" clause still applies when kicked too.
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
    });
});

describe("Samite Pilgrim (Domain — {T}: prevent the next X damage to target creature this turn)", () => {
    it("is a {1}{W} 1/1 Human Cleric with the modern oracle text", () => {
        expect(samitePilgrim.manaCost).toEqual({ X: 1, W: 1 });
        expect(samitePilgrim.types).toEqual(["Creature"]);
        expect(samitePilgrim.subtypes).toEqual(["Human", "Cleric"]);
        expect(samitePilgrim.power).toBe(1);
        expect(samitePilgrim.toughness).toBe(1);
    });

    it("prevents damage equal to the Domain count (basic land types among lands the controller controls)", () => {
        const pilgrim = makeInstance(samitePilgrim.id, {
            id: "pilgrim",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [
            makeInstance(plains.id, {
                id: "p",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(island.id, {
                id: "i",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(swamp.id, {
                id: "s",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pilgrim, bear, ...lands] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, pilgrim, "samite-pilgrim-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        // Domain = 3 (Plains/Island/Swamp) — Lightning Bolt's 3 damage is
        // fully absorbed.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.damageMarked ?? 0).toBe(0);
    });

    it("prevents nothing with Domain 0 (no basic land types among lands controlled)", () => {
        const pilgrim = makeInstance(samitePilgrim.id, {
            id: "pilgrim",
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
                makePlayer("p1", { battlefield: [pilgrim, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, pilgrim, "samite-pilgrim-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.damageMarked ?? 0).toBe(3);
    });
});

describe("Surprise Deployment (combat-only instant; put a nonwhite creature from hand onto the battlefield, return it at next end step)", () => {
    it("is a {3}{W} Instant restricted to every combat step, with the modern oracle text", () => {
        expect(surpriseDeployment.manaCost).toEqual({ X: 3, W: 1 });
        expect(surpriseDeployment.types).toEqual(["Instant"]);
        expect(surpriseDeployment.castPhaseRestriction).toEqual([
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
        ]);
    });

    it("puts the chosen nonwhite creature onto the battlefield, then returns EXACTLY that creature to hand at the next end step", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "deployed-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [bear] }), makePlayer("p2")],
        });
        pushSpell(state, surpriseDeployment.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["deployed-bear"],
        });
        expect(
            state.players[0].battlefield.some((c) => c.id === "deployed-bear")
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.delayedTriggers).toHaveLength(1);
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "deployed-bear")
        ).toBe(false);
        expect(state.players[0].hand.map((c) => c.id)).toContain(
            "deployed-bear"
        );
    });

    it("declining the optional put is a safe no-op (CR 608.2b — nothing on the battlefield to return)", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "declined-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [bear] }), makePlayer("p2")],
        });
        pushSpell(state, surpriseDeployment.id, "p1");
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain(
            "declined-bear"
        );
        // The delayed trigger is still SCHEDULED (the script has no branch
        // construct to skip it), but its capture never bound anything (no
        // creature entered) — firing it at the next end step is a no-op
        // rather than an error (CR 608.2b — the effect does as much as it
        // can), exactly the "if you do" idiom Spinal Embrace already relies
        // on (`inv/multicolor.ts`).
        expect(state.delayedTriggers).toHaveLength(1);
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain(
            "declined-bear"
        );
    });
});

// ===========================================================================
// Guard Dogs (CR 615 / 105.2 / 202.2) — issue #1955
// ===========================================================================
//
// The colour comparison happens ONCE, ON RESOLUTION (the card's own ruling:
// "You only check colors on resolution and not later when the damage
// prevention actually is applied"), so these tests drive the choice through
// the real pending-choice pipeline and then assert the OUTCOME through the
// shared damage funnel — never by reading the shield list.
describe("Guard Dogs ({3}{W} Creature — conditional source-scoped prevention, CR 615)", () => {
    /** p1 controls Guard Dogs + one extra permanent; p2 controls one attacker. */
    function board(opts: {
        /** Card id of the permanent p1 will choose for the colour comparison. */
        chosenCardId: string;
        /** Card id of p2's creature — the announced prevention target. */
        attackerCardId: string;
    }): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(guardDogs.id, {
                            id: "dogs",
                            controllerId: "p1",
                            ownerId: "p1",
                            isSummoningSick: false,
                        }),
                        makeInstance(opts.chosenCardId, {
                            id: "chosen",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(opts.attackerCardId, {
                            id: "atk",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    /** Resolves the ability, submitting `chosen` as the permanent pick. */
    function activate(state: GameState): void {
        const dogs = state.players[0].battlefield.find((c) => c.id === "dogs")!;
        state.stack.push({
            ...dogs,
            zone: "stack",
            castById: "p1",
            abilityId: "guard-dogs-prevent",
            targets: [{ type: "permanent", id: "atk" }],
        });
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-permanents");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["chosen"],
        });
    }

    function preventsCombat(state: GameState): boolean {
        return (
            runDamageReplacement(
                state,
                "atk",
                "p2",
                { type: "player", id: "p1" },
                2,
                true
            ) === null
        );
    }

    it("prevents when the target creature SHARES a colour with the chosen permanent", () => {
        // Black Knight (B) vs. Swamp — no shared colour; use two black objects
        // instead: the chosen permanent is a black creature.
        const state = board({
            chosenCardId: blackKnight.id,
            attackerCardId: blackKnight.id,
        });
        activate(state);
        expect(preventsCombat(state)).toBe(true);
    });

    it("prevents NOTHING when the two share no colour (tested both ways)", () => {
        const state = board({
            chosenCardId: benalishHero.id, // white
            attackerCardId: blackKnight.id, // black
        });
        activate(state);
        expect(preventsCombat(state)).toBe(false);
    });

    it("reads colour through the LAYER pipeline, not the printed mana cost (CR 613 layer 5)", () => {
        // A white Benalish Hero painted BLACK by a layer-5 override now shares
        // a colour with the black attacker — the printed {W} cost does not.
        const state = board({
            chosenCardId: benalishHero.id,
            attackerCardId: blackKnight.id,
        });
        const chosen = state.players[0].battlefield.find(
            (c) => c.id === "chosen"
        )!;
        chosen.colorOverride = ["B"];
        expect(STATIC_EFFECT_CTX.getColors(chosen)).toEqual(["B"]);
        activate(state);
        expect(preventsCombat(state)).toBe(true);
    });

    it("a colourless object shares no colour with anything (CR 202.2)", () => {
        const state = board({
            chosenCardId: blackKnight.id,
            attackerCardId: blackKnight.id,
        });
        const atk = state.players[1].battlefield.find((c) => c.id === "atk")!;
        atk.colorOverride = [];
        activate(state);
        expect(preventsCombat(state)).toBe(false);
    });

    it("is a {3}{W} 2/2 Dog whose ability costs {2}{W} and a tap", () => {
        expect(guardDogs.manaCost).toEqual({ X: 3, W: 1 });
        expect(guardDogs.subtypes).toEqual(["Dog"]);
        expect(guardDogs.power).toBe(2);
        expect(guardDogs.toughness).toBe(2);
        expect(guardDogs.activatedAbilities?.[0]?.cost).toEqual({
            mana: { X: 2, W: 1 },
            tap: true,
        });
    });
});

// ===========================================================================
// Pollen Remedy (CR 615.1 / 601.2d / 120.4 / 702.33a) — issue #1955
// ===========================================================================
describe("Pollen Remedy ({W} Instant — divided prevention shields, CR 615.1)", () => {
    /** p1 + two of p1's creatures, all candidate prevention recipients. */
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(crawWurm.id, {
                            id: "wurmA",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(crawWurm.id, {
                            id: "wurmB",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("installs one shield per target sized by the announced split (CR 601.2d)", () => {
        const state = board();
        const item = pushSpell(state, pollenRemedy.id, "p1", [
            { type: "permanent", id: "wurmA" },
            { type: "player", id: "p1" },
        ]);
        item.targetAmounts = { "permanent:wurmA": 1, "player:p1": 2 };
        resolveTopOfStack(state);
        expect(state.targetPreventionShields).toEqual([
            expect.objectContaining({
                targetType: "permanent",
                targetId: "wurmA",
                remaining: 1,
            }),
            expect.objectContaining({
                targetType: "player",
                targetId: "p1",
                remaining: 2,
            }),
        ]);
    });

    it("the shields actually absorb the allocated damage and no more (CR 615.1)", () => {
        const state = board();
        const item = pushSpell(state, pollenRemedy.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.targetAmounts = { "player:p1": 3 };
        resolveTopOfStack(state);
        expect(applyTargetPrevention(state, "player", "p1", 5)).toBe(2);
        // Spent — the next event is unprotected.
        expect(applyTargetPrevention(state, "player", "p1", 5)).toBe(5);
    });

    it("kicked, the total is 6 rather than 3 (CR 702.33a)", () => {
        const state = board();
        const item = pushSpell(state, pollenRemedy.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.kickerPayments = { kicker: 1 };
        item.targetAmounts = { "player:p1": 6 };
        resolveTopOfStack(state);
        expect(applyTargetPrevention(state, "player", "p1", 10)).toBe(4);
    });

    it("with NO explicit split recorded (the bot's amount-free selectTargets) it still divides ≥1 each", () => {
        const state = board();
        pushSpell(state, pollenRemedy.id, "p1", [
            { type: "permanent", id: "wurmA" },
            { type: "permanent", id: "wurmB" },
        ]);
        resolveTopOfStack(state);
        const shields = state.targetPreventionShields ?? [];
        expect(shields).toHaveLength(2);
        // Every chosen target gets at least 1, and the total is exactly 3.
        expect(shields.every((s) => s.remaining >= 1)).toBe(true);
        expect(shields.reduce((n, s) => n + s.remaining, 0)).toBe(3);
    });

    it("declares the divide-as-chosen requirement on BOTH the base and kicked target sets", () => {
        expect(pollenRemedy.targetRequirement).toEqual({
            type: "any",
            count: { min: 1 },
            divideAsChosen: { total: 3 },
        });
        expect(pollenRemedy.kickedTargetRequirement).toEqual({
            type: "any",
            count: { min: 1 },
            divideAsChosen: { total: 6 },
        });
        // The resolution-time totals MUST mirror the announcement-time ones,
        // or the caster allocates 6 and only 3 is honoured.
        expect(pollenRemedy.effects).toEqual([
            {
                op: "if",
                predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
                then: [
                    {
                        op: "preventDamage",
                        mode: "next-n-divided",
                        total: 6,
                        duration: { phase: "end-of-turn" },
                    },
                ],
                else: [
                    {
                        op: "preventDamage",
                        mode: "next-n-divided",
                        total: 3,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
    });

    it("the shields survive the wire projection (wire format)", () => {
        const state = board();
        const item = pushSpell(state, pollenRemedy.id, "p1", [
            { type: "permanent", id: "wurmA" },
        ]);
        item.targetAmounts = { "permanent:wurmA": 3 };
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.targetPreventionShields).toEqual(
            state.targetPreventionShields
        );
    });
});

// ===========================================================================
// Bot: Pollen Remedy's divided allocation must be enumerable (#1955)
// ===========================================================================
//
// "The bot must not stall casting Pollen Remedy." It does not need a new
// `BotAction` kind: divide-as-you-choose is announced through the ORDINARY
// pending-target flow, so it rides the already-compile-time-exhaustive
// `botActionRealisation` `"worker"` branch (`src/lib/ai/brain.ts`) — the same
// path Arc Lightning / Fiery Justice have used since the divided-damage Op
// shipped. What this test pins is the half that could actually break: that the
// enumerator offers select-target actions carrying an `amount`, and a confirm
// once the minimum is met, for THIS card's requirement.
describe("Pollen Remedy — bot-enumerable divided allocation (CR 601.2d, #1955)", () => {
    function pendingState(divideTotal: number): GameState {
        const wurm = makeInstance(crawWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wurm] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, pollenRemedy.id, "p1", []);
        state.priorityPlayerId = "p1";
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: item.id,
            kind: "cast",
            targetType: "any",
            count: { min: 1, max: divideTotal },
            selected: [],
            divideTotal,
        };
        return state;
    }

    it("offers a select-target action per legal target, each carrying amount 1", () => {
        const state = pendingState(3);
        const picks = legalActions(state).filter(
            (a) => a.expect === "target" && a.action.kind === "select-target"
        );
        expect(picks.length).toBeGreaterThan(0);
        for (const p of picks) {
            expect((p.action as { amount?: number }).amount).toBe(1);
        }
    });

    it("offers confirm-targets once the minimum is met, so the cast can finish", () => {
        const state = pendingState(3);
        state.pendingTarget!.selected = [{ type: "permanent", id: "wurm" }];
        state.pendingTarget!.divideAmounts = { "permanent:wurm": 1 };
        expect(
            legalActions(state).some(
                (a) =>
                    a.expect === "target" && a.action.kind === "confirm-targets"
            )
        ).toBe(true);
    });

    it("stops offering further targets once the whole budget is allocated", () => {
        const state = pendingState(3);
        state.pendingTarget!.selected = [{ type: "permanent", id: "wurm" }];
        state.pendingTarget!.divideAmounts = { "permanent:wurm": 3 };
        expect(
            legalActions(state).some(
                (a) =>
                    a.expect === "target" && a.action.kind === "select-target"
            )
        ).toBe(false);
        expect(
            legalActions(state).some(
                (a) =>
                    a.expect === "target" && a.action.kind === "confirm-targets"
            )
        ).toBe(true);
    });
});
