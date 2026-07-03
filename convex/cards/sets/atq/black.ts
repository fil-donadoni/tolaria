// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { abilityActivatedTrigger } from "../../abilities/triggers/abilityActivatedTrigger";

// Yawgmoth Demon — {4}{B}{B} Creature — Phyrexian Demon, 6/6 with flying +
// first strike. "At the beginning of your upkeep, you may sacrifice an
// artifact. If you don't, tap this creature and it deals 2 damage to you."
// (CR 603.6a upkeep trigger; CR 117.3a optional may; CR 701.16 sacrifice.)
// The may is gated on having an artifact to sacrifice; declining (or having no
// artifact) runs the else-branch: tap self + 2 damage to the controller.
export const yawgmothDemon: CardDefinition = {
    id: "04bbd231-0d5f-4cbf-92a7-10d2c5c4b82c",
    rarity: "rare",
    name: "Yawgmoth Demon",
    oracleText:
        "Flying\nFirst strike\nAt the beginning of your upkeep, you may sacrifice an artifact. If you don't, tap this creature and it deals 2 damage to you.",
    manaCost: { X: 4, B: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Demon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying", "first strike"],
    triggeredAbilities: [
        phaseTrigger({
            id: "yawgmoth-demon-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may sacrifice an artifact. If you don't, tap this creature and it deals 2 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, playerId) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const artifactIds = ctx.getBattlefieldIds(playerId, {
                    types: "Artifact",
                });
                if (artifactIds.length > 0) {
                    const accept = ctx.requestMayPay({
                        playerId,
                        choiceId: playerId,
                        prompt: "Sacrifice an artifact to Yawgmoth Demon?",
                    });
                    if (accept === undefined) return;
                    if (accept) {
                        const picked = ctx.requestChoice({
                            playerId,
                            choiceId: `${playerId}-sac`,
                            kind: "sacrifice-permanents",
                            zone: "battlefield",
                            filter: { types: "Artifact" },
                            count: 1,
                            prompt: "Sacrifice an artifact.",
                        });
                        if (picked === undefined) return;
                        if (picked.length > 0) ctx.sacrifice(picked[0]);
                        return;
                    }
                }
                // Declined or no artifact to sacrifice: tap + 2 damage to you.
                ctx.tap(self);
                ctx.dealDamage({ type: "player", id: playerId }, 2);
            },
        }),
    ],
};

// Priest of Yawgmoth — {1}{B} 1/2. "{T}, Sacrifice an artifact: Add an amount
// of {B} equal to the sacrificed artifact's mana value." The mana-value-derived
// effect reads the sacrificed permanent's mv via getAdditionalSacrificeMv
// (snapshotted at commit). Modeled as a stack ability (see CR 605.1a note).
export const priestOfYawgmoth: CardDefinition = {
    id: "c9fd4054-42fc-4f95-a6f7-369a5da43dd5",
    rarity: "common",
    name: "Priest of Yawgmoth",
    oracleText:
        "{T}, Sacrifice an artifact: Add an amount of {B} equal to the sacrificed artifact's mana value.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Human", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "priest-of-yawgmoth-mana",
            oracleText:
                "{T}, Sacrifice an artifact: Add an amount of {B} equal to the sacrificed artifact's mana value.",
            cost: { tap: true, sacrificeFilter: { types: "Artifact" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const mv = ctx.getAdditionalSacrificeMv() ?? 0;
                if (mv > 0) ctx.addManaTo(ctx.controller, { B: mv });
            },
        },
    ],
};

// Gate to Phyrexia — {B}{B} Enchantment. "Sacrifice a creature: Destroy target
// artifact. Activate only during your upkeep and only once each turn."
// (CR 602.5 once-per-turn + upkeep timing.)
export const gateToPhyrexia: CardDefinition = {
    id: "1f372950-6693-4838-80ef-8fd9aa3e0349",
    rarity: "uncommon",
    name: "Gate to Phyrexia",
    oracleText:
        "Sacrifice a creature: Destroy target artifact. Activate only during your upkeep and only once each turn.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "gate-to-phyrexia-destroy",
            oracleText:
                "Sacrifice a creature: Destroy target artifact. Activate only during your upkeep and only once each turn.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            oncePerTurn: true,
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster B — "ability activated" trigger event (PRD #269 / issue #285)
//
// These three punishers react to BOTH halves of "an artifact is used":
//   • the artifact becomes tapped → PERMANENT_TAPPED (CR 701.20a), and
//   • a non-{T} activated ability of the artifact is used → ABILITY_ACTIVATED
//     (CR 602.1), the complement event emitted by the engine only when the
//     ability has no {T} component (so {T}-cost abilities aren't double-counted).
// Each card therefore declares two triggered abilities — one per event — that
// share an identical resolve body. `tappedTrigger`'s `forMana` is left
// undefined so both mana taps and non-mana taps (Twiddle, combat) count, per
// the oracle wording "becomes tapped".
// ─────────────────────────────────────────────────────────────────────────────

// Haunting Wind — {3}{B} Enchantment. "Whenever an artifact becomes tapped or a
// player activates an artifact's ability without {T} in its activation cost,
// this enchantment deals 1 damage to that artifact's controller." (CR 603.2.)
// `scope: "any"` + an Artifact type filter; damage goes to the artifact's
// controller (carried on each event payload).
export const hauntingWind: CardDefinition = {
    id: "a2f6ef2f-a3a2-4e1f-b7eb-59abc8414114",
    rarity: "uncommon",
    name: "Haunting Wind",
    oracleText:
        "Whenever an artifact becomes tapped or a player activates an artifact's ability without {T} in its activation cost, this enchantment deals 1 damage to that artifact's controller.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "haunting-wind-tapped",
            oracleText:
                "Whenever an artifact becomes tapped, this enchantment deals 1 damage to that artifact's controller.",
            scope: "any",
            filter: { types: "Artifact" },
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 1);
            },
        }),
        abilityActivatedTrigger({
            id: "haunting-wind-ability",
            oracleText:
                "Whenever a player activates an artifact's ability without {T} in its activation cost, this enchantment deals 1 damage to that artifact's controller.",
            scope: "any",
            filter: { types: "Artifact" },
            resolve: (ctx, _event, activated) => {
                ctx.dealDamage(
                    { type: "player", id: activated.controllerId },
                    1
                );
            },
        }),
    ],
};

// Artifact Possession — {2}{B} Enchantment — Aura. "Enchant artifact. Whenever
// enchanted artifact becomes tapped or a player activates an ability of
// enchanted artifact without {T} in its activation cost, this Aura deals 2
// damage to that artifact's controller." (CR 303.4 aura attachment, 603.2.)
// As with Psychic Venom, there is no `host` scope (ADR 0002) — `scope: "any"`
// plus a `self.attachedTo` host-check condition is the idiomatic expression.
export const artifactPossession: CardDefinition = {
    id: "587d6ac8-fad8-49e0-862e-636e06628ff9",
    rarity: "common",
    name: "Artifact Possession",
    oracleText:
        "Enchant artifact\nWhenever enchanted artifact becomes tapped or a player activates an ability of enchanted artifact without {T} in its activation cost, this Aura deals 2 damage to that artifact's controller.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "artifact-possession-tapped",
            oracleText:
                "Whenever enchanted artifact becomes tapped, this Aura deals 2 damage to that artifact's controller.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 2);
            },
        }),
        abilityActivatedTrigger({
            id: "artifact-possession-ability",
            oracleText:
                "Whenever a player activates an ability of enchanted artifact without {T} in its activation cost, this Aura deals 2 damage to that artifact's controller.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, activated) => {
                ctx.dealDamage(
                    { type: "player", id: activated.controllerId },
                    2
                );
            },
        }),
    ],
};

// Phyrexian Gremlins — {2}{B} Creature — Phyrexian Gremlin, 1/1. "{T}: Tap
// target artifact. It doesn't untap during its controller's untap step for as
// long as this creature remains tapped." (CR 611.2 untap-lock tied to the
// source's tapped state via `lockUntapWhileSourceTapped`; CR 502.1 optional
// untap.) The Gremlin taps the artifact AND records the lock; the artifact
// stays tapped through its controller's untap steps until the Gremlin untaps.
export const phyrexianGremlins: CardDefinition = {
    id: "21a985a9-5612-4844-982e-fd1aa6249770",
    rarity: "common",
    name: "Phyrexian Gremlins",
    oracleText:
        "You may choose not to untap this creature during your untap step.\n{T}: Tap target artifact. It doesn't untap during its controller's untap step for as long as this creature remains tapped.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Gremlin"],
    power: 1,
    toughness: 1,
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "phyrexian-gremlins-tap-lock",
            oracleText:
                "{T}: Tap target artifact. It doesn't untap during its controller's untap step for as long as this creature remains tapped.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.tap(target);
                    ctx.lockUntapWhileSourceTapped(target);
                }
            },
        },
    ],
};

// Xenic Poltergeist — {1}{B}{B} Creature — Spirit, 1/1. "{T}: Until your next
// upkeep, target noncreature artifact becomes an artifact creature with power
// and toughness each equal to its mana value." (CR 605 activated ability + CR
// 205 animate + CR 604.3 mana-value P/T + CR 500.2 "until your next upkeep"
// duration.) Single-target one-shot animation that ends as the controller's
// upkeep begins. Does NOT strip abilities (unlike Titania's Song). The animated
// artifact's P/T is its mana value, snapshotted at resolution via
// `ctx.getManaValue` and stored as the animation's base P/T.
//
// DIVERGENCE (flagged, no engine change): `animateAsCreature` adds the Creature
// type only — the target is already an artifact, so the resulting "artifact
// creature" type line is correct without an Artifact type-add.
export const xenicPoltergeist: CardDefinition = {
    id: "5149ffff-d38f-458e-bcfa-a4b6b332a0b4",
    rarity: "uncommon",
    name: "Xenic Poltergeist",
    oracleText:
        "{T}: Until your next upkeep, target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "xenic-poltergeist-animate",
            oracleText:
                "{T}: Until your next upkeep, target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                excludeTypes: "Creature",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                const mv = ctx.getManaValue(target);
                ctx.animateAsCreature(target, {
                    power: mv,
                    toughness: mv,
                    // CR 500.2 — ends as the controller's next upkeep begins.
                    duration: { phase: "upkeep", player: "controller" },
                });
            },
        },
    ],
};
