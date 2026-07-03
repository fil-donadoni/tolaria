// Legends (LEG) — Blue (mono-U) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { isBlockingCreature } from "../../combatDamagePrevention";

// Wall of Vapor — {3}{U} 0/1 Wall, Defender. "Prevent all damage that would be
// dealt to this creature by creatures it's blocking." Source filter: the
// damage source is a creature this Wall is currently blocking (CR 509.1).
// Simplification: the Oracle says "all damage", but a creature only deals
// damage to a creature blocking it during the combat-damage step, so the
// combat-damage-prevention static covers the practical case (CR 615).
export const wallOfVapor: CardDefinition = {
    id: "6a6c0a27-d410-4ded-a842-70e1656ea21e",
    rarity: "common",
    name: "Wall of Vapor",
    oracleText:
        "Defender (This creature can't attack.)\nPrevent all damage that would be dealt to this creature by creatures it's blocking.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 1,
    staticAbilities: ["defender"],
    staticEffects: [
        {
            kind: "combat-damage-prevention",
            id: "wall-of-vapor-prevent",
            oracleText:
                "Prevent all damage that would be dealt to this creature by creatures it's blocking.",
            prevents: (self, damageSource, state) =>
                isBlockingCreature(self, damageSource, state),
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Blue free tranche (#372) — every mono-blue Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, prevention shields, SpellContext methods). Data + resolve()
// closures only; zero engine change (ADR 0014).
//
// EXCLUDED from this batch (owned by #369 feature clusters, or needing an
// unbuilt primitive — left for their owning issue):
//   • C5 named counters — Glyph of Delusion (glyph counters), Venarian Gold
//     (sleep counters).
//   • C6 shroud / can't-be-targeted — SHIPPED below (Spectral Cloak,
//     Anti-Magic Aura, Bartel Runeaxe). Tetsuo Umezawa and Wall of Shadows are
//     deferred — see the C6 section footer for the per-card reasons.
//   • C7 upkeep pay-or-sacrifice — Elder Spawn ("unless you sacrifice an
//     Island, sacrifice this and it deals 6 damage to you").
//   • C8 cast-tax counter-unless-pay — Nether Void and In the Eye of Chaos
//     (both World) SHIPPED in the C8 section at the foot of this file (#385).
//     Invoke Prejudice (counter an opponent's off-color creature spell unless
//     they pay its mana value) is the same cast-tax family but adds an off-color
//     spell filter; it stays deferred to keep #385 scoped to the two World
//     enchantments.
//   • World rule (C2) / no continuous-reveal static — Field of Dreams ("play
//     with the top card of libraries revealed": needs a continuous top-of-
//     library reveal static that does not exist yet).
//   • No primitive yet (flagged for a future batch):
//     - Juxtapose — exchange control of the greatest-MV creature/artifact
//       (no control-exchange primitive).
//     - Land Equilibrium — opponent land-drop replacement gated on land counts
//       (no land-ETB replacement primitive).
//     - Enchantment Alteration — move an Aura to another permanent (no Aura
//       re-attach primitive).
//     - Puppet Master — dies-return-to-hand + optional buy-back of the Aura.
//     - Relic Bind — modal tap-trigger on an opponent's artifact.
//     - Time Elemental — attacks/blocks → end-of-combat self-sacrifice + 5
//       damage, plus a bounce activated ability (doable, deferred to keep this
//       batch low-risk).
//     - Brine Hag — set base P/T of every creature that damaged it this turn
//       (no per-instance "damaged me this turn" tally surfaced).
//     - Reverberation — redirect a target sorcery's damage to its controller.
//     - Silhouette — prevent damage from sources that TARGET a chosen creature.
//     - Telekinesis — tap + prevent its combat damage + skip its next two untap
//       steps (no multi-step untap-skip primitive).
//     - Dream Coat — "{0}: enchanted creature becomes the color or colors of
//       your choice" (multi-color free-choice primitive).
//     - Psychic Purge — its punisher half is a from-hand discard trigger (no
//       discard-from-hand trigger); shipping only the damage half would be
//       partial.
//     - Gaseous Form — "Prevent all combat damage to and dealt by enchanted
//       creature" is a CONTINUOUS aura prevention; only a turn-scoped combat
//       shield exists, no "for as long as enchanted" prevention static.
// ─────────────────────────────────────────────────────────────────────────────

// Recall — "Discard X cards, then return a card from your graveyard to your
// hand for each card discarded this way. Exile Recall." (CR 107.3 X chosen on
// cast; CR 701.8 discard; CR 400.7 graveyard→hand; CR 608.2 self-exile.)
//
// Cost is {X}{X}{U}: the player pays twice the chosen X (`xFactor: 2`) but the
// DISCARD COUNT equals the announced X (`getX()`), not the paid generic.
//
// Two resolveSteps so the discard and the return are isolated suspension
// points (CR 608.2 stepped resolution):
//   • Step 0 — discard X chosen cards from hand (clamped to hand size). The
//     discarded cards land in the graveyard BEFORE the return step, so they
//     are themselves valid return targets — the classic Recall loop.
//   • Step 1 — return up to (number actually discarded) chosen cards from the
//     graveyard to hand. The discarded count is read back across steps via
//     `recallChoice`. Then Recall exiles itself (CR 608.2).
// X = 0 discards nothing, returns nothing, and still exiles. A graveyard with
// fewer cards than the discard count caps the return at what's available.
export const recall: CardDefinition = {
    id: "33296718-0625-4422-a65c-b21cf99c52ec",
    rarity: "rare",
    name: "Recall",
    oracleText:
        "Discard X cards, then return a card from your graveyard to your hand for each card discarded this way. Exile Recall.",
    manaCost: { X: "X", xFactor: 2, U: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        // Step 0 — discard X chosen cards (CR 701.8). Clamp to hand size so a
        // chosen X above hand count discards everything held without stalling.
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const x = ctx.getX();
            const max = Math.min(x, ctx.getHandSize(me));
            if (max <= 0) return; // X = 0 or empty hand — nothing to discard.
            const picks = ctx.requestChoice({
                playerId: me,
                choiceId: "recall-discard",
                kind: "discard-hand",
                zone: "hand",
                count: max,
                prompt: `Recall: discard ${max} ${max === 1 ? "card" : "cards"}.`,
            });
            if (picks === undefined) return; // suspended for the discard pick
            for (const id of picks) ctx.discardCard(me, id);
        },
        // Step 1 — return up to (cards actually discarded) cards from the
        // graveyard to hand (CR 400.7), then exile Recall (CR 608.2). The
        // discarded ids are read back across the step boundary; the just-
        // discarded cards are in the graveyard now, so they're valid targets.
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const discarded = ctx.recallChoice("recall-discard")?.length ?? 0;
            const graveyardIds = ctx.getGraveyardCards(me).map((c) => c.id);
            const max = Math.min(discarded, graveyardIds.length);
            if (max > 0) {
                const picks = ctx.requestChoice({
                    playerId: me,
                    choiceId: "recall-return",
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    candidateIds: graveyardIds,
                    count: { min: 0, max },
                    prompt: `Recall: return up to ${max} ${max === 1 ? "card" : "cards"} from your graveyard to your hand.`,
                });
                if (picks === undefined) return; // suspended for the return pick
                for (const id of picks) {
                    ctx.moveCardById(me, id, "graveyard", "hand");
                }
            }
            // CR 608.2 — "Exile Recall." Last instruction in the spell.
            ctx.exileSelf();
        },
    ],
};

// --- Vanilla / keyword creatures (CR 702 — pure data) ---------------------

// Azure Drake — flying (CR 702.9).
export const azureDrake: CardDefinition = {
    id: "fb5f13a2-0896-4230-8957-6ad1cb2b895b",
    rarity: "uncommon",
    name: "Azure Drake",
    oracleText: "Flying",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 2,
    toughness: 4,
    staticAbilities: ["flying"],
};

// Zephyr Falcon — flying, vigilance (CR 702.9, 702.21).
export const zephyrFalcon: CardDefinition = {
    id: "25a173fd-e10c-45f8-a6e5-ad7a747a8050",
    rarity: "common",
    name: "Zephyr Falcon",
    oracleText: "Flying, vigilance",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying", "vigilance"],
};

// Undertow — global islandwalk negation (CR 509.1b / 702.13). Twin of Great
// Wall via the shared parametric `landwalk-negation` static, differing only in
// the negated subtype (Island). Creatures with islandwalk can be blocked as
// though they didn't have it, regardless of the defender's Islands.
export const undertow: CardDefinition = {
    id: "cf05e5c9-b7e4-4bd8-ab73-b54565710527",
    rarity: "uncommon",
    name: "Undertow",
    oracleText:
        "Creatures with islandwalk can be blocked as though they didn't have islandwalk.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "landwalk-negation",
            id: "undertow-islandwalk-negation",
            subtypes: ["Island"],
            oracleText:
                "Creatures with islandwalk can be blocked as though they didn't have islandwalk.",
        },
    ],
};

// Devouring Deep — islandwalk (CR 702.19 landwalk variant).
export const devouringDeep: CardDefinition = {
    id: "0855a5a8-8c40-4396-9ad1-8fa0fc6a0c59",
    rarity: "common",
    name: "Devouring Deep",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 1,
    toughness: 2,
    staticAbilities: ["islandwalk"],
};

// Segovian Leviathan — islandwalk (CR 702.19).
export const segovianLeviathan: CardDefinition = {
    id: "e5a814f1-7f8d-4c2c-b706-ee0ed5892f7b",
    rarity: "uncommon",
    name: "Segovian Leviathan",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Leviathan"],
    power: 3,
    toughness: 3,
    staticAbilities: ["islandwalk"],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Psionic Entity — "{T}: This creature deals 2 damage to any target and 3
// damage to itself." (CR 120.1 / 115.4 — self-damage is a normal damage event
// to the source permanent.)
export const psionicEntity: CardDefinition = {
    id: "ec082062-5394-4340-bc29-0efd2af4b822",
    rarity: "rare",
    name: "Psionic Entity",
    oracleText:
        "{T}: This creature deals 2 damage to any target and 3 damage to itself.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "psionic-entity-zap",
            oracleText:
                "{T}: This creature deals 2 damage to any target and 3 damage to itself.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 2);
                ctx.dealDamage(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    3
                );
            },
        },
    ],
};

// Wall of Wonder — Defender; "{2}{U}{U}: This creature gets +4/-4 until end of
// turn and can attack this turn as though it didn't have defender." (CR 702.3
// defender + 611.1 temporary P/T + a temporary attack-enable via the can-attack
// grant.) Modeled by granting the keyword `can-attack-with-defender` for the
// turn — combat eligibility honours it the same way Wall of Wonder's text
// suspends defender.
export const wallOfWonder: CardDefinition = {
    id: "bcd9af40-b46c-44b4-878e-8eb026c96b51",
    rarity: "uncommon",
    name: "Wall of Wonder",
    oracleText:
        "Defender (This creature can't attack.)\n{2}{U}{U}: This creature gets +4/-4 until end of turn and can attack this turn as though it didn't have defender.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-wonder-animate",
            oracleText:
                "{2}{U}{U}: This creature gets +4/-4 until end of turn and can attack this turn as though it didn't have defender.",
            cost: { mana: { X: 2, U: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, 4, -4, { phase: "end-of-turn" });
                // "can attack as though it didn't have defender" — grant the
                // attack-enable keyword the combat validator checks for
                // defender suspension (CR 508.1a).
                ctx.grantStaticAbility(self, "can-attack-with-defender", {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// --- Auras (CR 303 — Enchant creature) ------------------------------------

// Backfire — "Whenever enchanted creature deals damage to you, this Aura deals
// that much damage to that creature's controller." (CR 303.4 host trigger →
// CR 120.1 damage.)
export const backfire: CardDefinition = {
    id: "04bc57aa-d4d9-4bd9-ba09-984370c7e23b",
    rarity: "uncommon",
    name: "Backfire",
    oracleText:
        "Enchant creature\nWhenever enchanted creature deals damage to you, this Aura deals that much damage to that creature's controller.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        damageDealtTrigger({
            id: "backfire-reflect",
            oracleText:
                "Whenever enchanted creature deals damage to you, this Aura deals that much damage to that creature's controller.",
            source: "any",
            // Fire only when the damage source is the host AND the damage was
            // dealt to the aura's controller (CR 303.4b "to you").
            condition: (event, self) =>
                event.sourceInstanceId === self.attachedTo &&
                event.target.type === "player" &&
                event.target.id === self.controllerId,
            resolve: (ctx, event) => {
                const host = ctx.getAttachedToId();
                if (!host) return;
                const hostController = ctx.getController({
                    type: "permanent",
                    id: host,
                });
                ctx.dealDamage(
                    { type: "player", id: hostController },
                    event.amount
                );
            },
        }),
    ],
};

// --- Counterspells (CR 701.5a) ---------------------------------------------

// Mana Drain — "Counter target spell. At the beginning of your next main phase,
// add an amount of {C} equal to that spell's mana value." (CR 701.5a counter +
// CR 603.7 / 505 next-main-phase delayed trigger + CR 107.4c {C} colorless mana.)
// The countered spell's mana value (CR 202.3, including any chosen X via
// `getManaValue`) is snapshotted at resolution and carried on the delayed
// trigger's payload; the {C} is added to the caster's pool when their next main
// phase begins.
export const manaDrain: CardDefinition = {
    id: "e691adef-3027-4e6a-889f-9f4e2df36a7c",
    rarity: "uncommon",
    name: "Mana Drain",
    oracleText:
        "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "spell") return;
        // Snapshot the spell's mana value before countering it (CR 202.3 /
        // 603.10 last-known information) — once countered it leaves the stack.
        const mv = ctx.getManaValue(target);
        ctx.counter(target);
        // CR 603.7 — schedule the {C} payoff for the caster's next main phase.
        // `targetPlayerId` gates firing to the caster's own main phase (CR 505).
        ctx.scheduleDelayedTrigger(
            manaDrain.id,
            "mana-drain-add",
            "next-main-phase",
            { controller: ctx.caster, mv: String(mv) },
            ctx.caster
        );
    },
    delayedTriggers: [
        {
            id: "mana-drain-add",
            oracleText:
                "At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
            timing: "next-main-phase",
            resolve: (ctx, payload) => {
                const mv = Number(payload.mv ?? "0");
                const controller = payload.controller;
                if (mv > 0 && controller) {
                    // CR 107.4c — {C} is colorless mana, added to the pool.
                    ctx.addManaTo(controller, { C: mv });
                }
            },
        },
    ],
};

// Flash Counter — "Counter target instant spell." (CR 701.5a + spellTypeFilter
// for the instant-only restriction, CR 114.1.)
export const flashCounter: CardDefinition = {
    id: "3c3cd450-f1cd-416b-9271-37d95815c089",
    rarity: "common",
    name: "Flash Counter",
    oracleText: "Counter target instant spell.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Instant",
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Remove Soul — "Counter target creature spell." (CR 701.5a, CR 114.1.)
export const removeSoul: CardDefinition = {
    id: "63de147c-2e62-41b9-8ada-93406387f08b",
    rarity: "common",
    name: "Remove Soul",
    oracleText: "Counter target creature spell.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Creature",
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Force Spike — "Counter target spell unless its controller pays {1}."
// (CR 701.5a counter-unless-pay, CR 117.3a may-pay against the spell's
// controller.)
//
// DSL-only (ADR 0045, issue #806) — the canonical "unless pays" card, migrated
// off `resolve()` to prove the counter/punisher pattern composes from frozen
// constructs: a `mayPay` Op offers the spell's controller the {1} payment and
// binds the boolean outcome; the `if` construct fires the `counter` consequence
// only when the payment went unpaid (`{ not: { binding: "$paid" } }`). The
// existing per-card test (`leg/blue.test.ts`) stays green as the migration
// harness — identical behaviour, no `resolve()`.
export const forceSpike: CardDefinition = {
    id: "70e64028-ae96-4950-aa6c-9d347409fad3",
    rarity: "common",
    name: "Force Spike",
    oracleText: "Counter target spell unless its controller pays {1}.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 1 },
            prompt: "Pay {1} to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.5a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

// --- Bounce / removal spells -----------------------------------------------

// Boomerang — "Return target permanent to its owner's hand." (CR 701.10.)
export const boomerang: CardDefinition = {
    id: "b8286edd-644b-4135-8dca-af97f3920de3",
    rarity: "common",
    name: "Boomerang",
    oracleText: "Return target permanent to its owner's hand.",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") ctx.returnToHand(target);
    },
};

// Acid Rain — "Destroy all Forests." (CR 701.7 mass destroy filtered on the
// Forest land subtype, CR 205.3.)
export const acidRain: CardDefinition = {
    id: "ba93c50a-2440-4e92-9cba-d97e20b1d29c",
    rarity: "rare",
    name: "Acid Rain",
    oracleText: "Destroy all Forests.",
    manaCost: { X: 3, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { subtype: "Forest" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

// Flash Flood — modal: "Destroy target red permanent." OR "Return target
// Mountain to its owner's hand." (CR 700.2 modal spell.)
export const flashFlood: CardDefinition = {
    id: "5ae88c06-f28c-4fbc-a28c-5eb203a04722",
    rarity: "common",
    name: "Flash Flood",
    oracleText:
        "Choose one —\n• Destroy target red permanent.\n• Return target Mountain to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "destroy-red",
            label: "Destroy target red permanent",
            oracleText: "Destroy target red permanent.",
            targetRequirement: { type: "any", count: 1, colorFilter: "R" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
        {
            id: "return-mountain",
            label: "Return target Mountain to its owner's hand",
            oracleText: "Return target Mountain to its owner's hand.",
            targetRequirement: {
                type: "Land",
                count: 1,
                subtypeFilter: "Mountain",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.returnToHand(target);
            },
        },
    ],
};

// --- Evasion / pump spells (CR 611.1, end-of-turn duration) ----------------

// Sea Kings' Blessing — "One or more target creatures become blue until end of
// turn." (CR 305.7 layer 5 colour override, end-of-turn duration; "one or
// more" = a variable-count target requirement, CR 601.2c.)
export const seaKingsBlessing: CardDefinition = {
    id: "11d1f02d-533e-4b77-a72a-ff5f91ae0626",
    rarity: "uncommon",
    name: "Sea Kings' Blessing",
    oracleText: "One or more target creatures become blue until end of turn.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.setColorOverride(target, ["U"]);
            }
        }
    },
};

// Part Water — "X target creatures gain islandwalk until end of turn."
// (CR 107.3 X count + 702.19 keyword grant, end-of-turn duration.)
export const partWater: CardDefinition = {
    id: "4b659475-c8b7-493d-af63-04f34d8cc3b1",
    rarity: "uncommon",
    name: "Part Water",
    oracleText:
        "X target creatures gain islandwalk until end of turn. (They can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: "X", U: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: "X" },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.grantStaticAbility(target, "islandwalk", {
                    phase: "end-of-turn",
                });
            }
        }
    },
};

// Teleport — "Target creature can't be blocked this turn." Cast only during
// the declare attackers step (CR 117.1b cast-phase restriction; CR 509.1b
// can't-be-blocked on the attacker side).
export const teleport: CardDefinition = {
    id: "18f86e13-f942-423e-b175-930d768cb811",
    rarity: "rare",
    name: "Teleport",
    oracleText:
        "Cast this spell only during the declare attackers step.\nTarget creature can't be blocked this turn.",
    manaCost: { U: 3 },
    types: ["Instant"],
    castPhaseRestriction: ["DECLARE_ATTACKERS"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") {
            ctx.setCantBeBlockedThisTurn(target);
        }
    },
};

// --- Mana / untap utility --------------------------------------------------

// Energy Tap — "Tap target untapped creature you control. If you do, add an
// amount of {C} equal to that creature's mana value." (CR 701.20a tap +
// CR 106.1 mana, snapshotting the MV before the tap.)
export const energyTap: CardDefinition = {
    id: "37e69940-bdc8-48ff-a296-540343910adf",
    rarity: "common",
    name: "Energy Tap",
    oracleText:
        "Tap target untapped creature you control. If you do, add an amount of {C} equal to that creature's mana value.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "you",
        tappedFilter: "untapped",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const mv = ctx.getManaValue(target);
        ctx.tap(target);
        if (mv > 0) ctx.addManaTo(ctx.caster, { C: mv });
    },
};

// Reset — "Untap all lands you control." Cast only during an opponent's turn
// after their upkeep step (CR 117.1b — opponent-turn restriction; the
// post-upkeep window is approximated by excluding the opponent's UPKEEP).
export const reset: CardDefinition = {
    id: "1c829d83-d5b8-4be7-80f7-55b42f52b309",
    rarity: "uncommon",
    name: "Reset",
    oracleText:
        "Cast this spell only during an opponent's turn after their upkeep step.\nUntap all lands you control.",
    manaCost: { U: 2 },
    types: ["Instant"],
    castTurnRestriction: "opponent",
    castPhaseRestriction: [
        "DRAW",
        "PRECOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
        "POSTCOMBAT_MAIN",
        "END_STEP",
    ],
    resolve: (ctx: SpellContext) => {
        for (const id of ctx.getBattlefieldIds(ctx.caster, { types: "Land" })) {
            ctx.untap({ type: "permanent", id });
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Shroud / "can't be the target" static (#382)
//
// CR 702.18 (Shroud): a permanent with shroud "can't be the target of spells or
// abilities" — including its controller's own (unlike hexproof, which only bars
// opponents). CR 115 governs targets; CR 113.3 distinguishes spells from
// abilities; CR 109.5 fixes a source's characteristics (types/subtypes) for the
// "Aura spells" / "spells only" variants.
//
// All variants reuse the live `permanent-guard` machinery (gre/permanentGuard.ts,
// CR 611 continuous effect): `cantBeTargeted: true` with an `applies` predicate,
// optionally narrowed by `targetSourceSubtypeFilter` (Aura) and/or
// `targetSourceMustBeSpell`. The guard is queried at both targeting gates
// (getLegalTargets — excluded from legal targets; selectTarget — server-side
// rejection), so a guarded permanent is unclickable in the UI and a hand-rolled
// target is rejected authoritatively.
// ─────────────────────────────────────────────────────────────────────────────

// Spectral Cloak — "Enchant creature\nEnchanted creature has shroud as long as
// it's untapped." (CR 702.18 shroud, conditional on the host being untapped —
// the live guard reads the host's tap state at each targeting gate, so the
// shroud blinks off the moment the creature taps.)
export const spectralCloak: CardDefinition = {
    id: "7524fd0d-a675-41d6-bc99-bd3ba336893b",
    rarity: "uncommon",
    name: "Spectral Cloak",
    oracleText:
        "Enchant creature\nEnchanted creature has shroud as long as it's untapped. (It can't be the target of spells or abilities.)",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "spectral-cloak-shroud",
            // CR 702.18 shroud (all sources, spells AND abilities) — but only
            // while the host is untapped (CR 611 live read of the host's state).
            cantBeTargeted: true,
            applies: (target, source) =>
                target.id === source.attachedTo && !target.isTapped,
        },
    ],
};

// Anti-Magic Aura — "Enchant creature\nEnchanted creature can't be the target of
// spells and can't be enchanted by other Auras." (CR 113.3 — "spells" excludes
// abilities, so a `targetSourceMustBeSpell` guard; plus a `cantBeEnchanted`
// guard, CR 303.4, blocking further Auras from attaching.)
export const antiMagicAura: CardDefinition = {
    id: "ff78eef1-efaa-4a12-bf5d-fec83c14aff8",
    rarity: "common",
    name: "Anti-Magic Aura",
    oracleText:
        "Enchant creature\nEnchanted creature can't be the target of spells and can't be enchanted by other Auras.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "anti-magic-aura-no-spell-target",
            // CR 113.3 — barred from SPELLS only; abilities can still target.
            cantBeTargeted: true,
            targetSourceMustBeSpell: true,
            applies: (target, source) => target.id === source.attachedTo,
        },
        {
            kind: "permanent-guard",
            id: "anti-magic-aura-no-enchant",
            // CR 303.4 — no further Aura may be cast at / attach to the host.
            cantBeEnchanted: true,
            applies: (target, source) => target.id === source.attachedTo,
        },
    ],
};

// Venarian Gold — {X}{U}{U} Aura. ETB taps the host and puts X sleep counters
// on it; the host doesn't untap while it carries a sleep counter; at the
// controller's upkeep one sleep counter is removed. CR 122 named counters,
// CR 502.1 untap skip via a counter-gated `does-not-untap` grant, CR 603.6a
// upkeep removal. Sleep counters live on the ENCHANTED CREATURE (oracle:
// "put X sleep counters on it" / "if it has a sleep counter on it").
export const venarianGold: CardDefinition = {
    id: "11fb92c0-bb1e-463a-a6b6-887a5d0cb873",
    rarity: "common",
    name: "Venarian Gold",
    oracleText:
        "Enchant creature\nWhen this Aura enters, tap enchanted creature and put X sleep counters on it.\nEnchanted creature doesn't untap during its controller's untap step if it has a sleep counter on it.\nAt the beginning of the upkeep of enchanted creature's controller, remove a sleep counter from that creature.",
    manaCost: { X: 0, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            // CR 502.1 — grant the host "does-not-untap" only while it carries
            // at least one sleep counter. The untap step reads this keyword.
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id === source.attachedTo &&
                (target.counters?.sleep ?? 0) > 0,
            keyword: "does-not-untap",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "venarian-gold-etb",
            oracleText:
                "When this Aura enters, tap enchanted creature and put X sleep counters on it.",
            scope: "self",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                const host: TargetSelection = { type: "permanent", id: hostId };
                ctx.tap(host);
                // CR 122.1 — X is the value chosen as the Aura was cast.
                const x = ctx.getX();
                if (x > 0) ctx.addCounter(host, "sleep", x);
            },
        }),
        phaseTrigger({
            id: "venarian-gold-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, remove a sleep counter from that creature.",
            phase: "UPKEEP",
            // CR 603.6a — fires at the upkeep of the enchanted creature's
            // controller, looked up at resolve time (host-controller scope).
            scope: "host-controller",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.removeCounter(
                    { type: "permanent", id: hostId },
                    "sleep",
                    1
                );
            },
        }),
    ],
};

// In the Eye of Chaos — {2}{U} World Enchantment. "Whenever a player casts an
// instant spell, counter it unless that player pays {X}, where X is its mana
// value." (CR 601.2i cast trigger restricted to instants → CR 117.3a may-pay
// taxed at the cast spell's mana value → CR 701.5a counter on decline.)
export const inTheEyeOfChaos: CardDefinition = {
    id: "733933dd-c871-4f75-8b08-d7c010dddbe6",
    rarity: "rare",
    name: "In the Eye of Chaos",
    oracleText:
        "Whenever a player casts an instant spell, counter it unless that player pays {X}, where X is its mana value.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "in-the-eye-of-chaos-tax",
            oracleText:
                "Whenever a player casts an instant spell, counter it unless that player pays {X}, where X is its mana value.",
            scope: "any",
            filter: { types: ["Instant"] },
            resolve: (ctx, _event, spell) => {
                // CR 202.3 / 601.2b — the tax equals the cast spell's mana
                // value, read from the still-on-stack spell (getManaValue folds
                // in any chosen X). An MV-0 instant taxes {0}: a zero cost is
                // trivially paid, so the may-pay resolves with no real choice.
                const mv = ctx.getManaValue({
                    type: "spell",
                    id: spell.instanceId,
                });
                const paid = ctx.requestMayPay({
                    playerId: spell.casterId,
                    choiceId: `in-the-eye-of-chaos-pay-${spell.instanceId}`,
                    cost: { X: mv },
                    prompt: `Pay {${mv}} or your instant is countered (In the Eye of Chaos)?`,
                });
                if (paid === undefined) return; // suspended on the may-pay
                if (!paid) ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};
