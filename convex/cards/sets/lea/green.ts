// Limited Edition Alpha (LEA), the base set of Magic, split by colour per
// ADR 0043. Every entry is a CardDefinition — LEA is the root set whose cards
// later editions (LEB, 2ED, 3ED, …) reprint via CardPrint, resolving printId →
// definitionId → the shared LEA definition (ADR 0014). Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    DelayedTriggerDef,
    SpellContext,
    StaticEffectStateView,
    TriggeredAbility,
} from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { makeTapForMana } from "../../abilities";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { damageTakenTrigger } from "../../abilities/triggers/damageTakenTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { combatPairKill } from "../../abilities/triggers/combatPairKillTrigger";
import { makeLace } from "./white";
import { makeUpkeepPayOrElse } from "./white";

export const aspectOfWolf: CardDefinition = {
    id: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29",
    rarity: "rare",
    name: "Aspect of Wolf",
    oracleText:
        "Enchant creature\nEnchanted creature gets +X/+Y, where X is half the number of Forests you control, rounded down, and Y is half the number of Forests you control, rounded up.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source, state) => {
                let forests = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.subtypes.includes("Forest")
                        ) {
                            forests++;
                        }
                    }
                }
                return {
                    power: Math.floor(forests / 2),
                    toughness: Math.ceil(forests / 2),
                };
            },
        },
    ],
};

// Berserk — "Cast this spell only before the combat damage step. Target
// creature gains trample and gets +X/+0 until end of turn, where X is its
// power. At the beginning of the next end step, destroy that creature if it
// attacked this turn." (CR 117.1b, 113.1, 611.1b, 603.7a, 514.2)
//
// "+X/+0 where X is its power" resolves at cast time: the creature's current
// power is snapshotted on resolution and added back. The delayed destroy is
// scheduled via scheduleDelayedTrigger and looked up on this card's def at
// end-step fire time.
const BERSERK_ID = "e173c8ce-2352-405e-ad00-e3bb94ced1ad";

export const berserk: CardDefinition = {
    id: BERSERK_ID,
    rarity: "uncommon",
    name: "Berserk",
    manaCost: { G: 1 },
    types: ["Instant"],
    // CR 117.1b — castable only up to (but not including) the combat damage step.
    castPhaseRestriction: [
        "UNTAP",
        "UPKEEP",
        "DRAW",
        "PRECOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
    ],
    targetRequirement: { type: "Creature", count: 1 },
    // NOT DSL-migratable (ADR 0045): the trample grant (grantAbility #843), the
    // pump (#840) and the delayed trigger (#838) Ops all now exist, but two
    // clauses remain inexpressible. (1) The +X/+0 amount is the creature's OWN
    // current power (X = getPower(target)); `EffectValue` is literal | ref |
    // count with no self-referential "this target's power" value and no bind-
    // only snapshot of an announced target to ref. (2) The delayed destroy is
    // CONDITIONAL on "if it attacked this turn" (hasAttackedThisTurn) — the `if`
    // predicate grammar has no combat-history test. Blocked on: self-power
    // EffectValue + attacked-this-turn predicate (both planned-migratable).
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "permanent") return;
        // CR 611.1b — static grant applies immediately; trample is read at
        // combat-damage assignment time.
        ctx.grantStaticAbility(target, "trample", { phase: "end-of-turn" });
        // CR 107.3 — X is the creature's power as the spell resolves.
        // CR 611.1 / 514.2 — "+X/+0 until end of turn" is a temporary buff
        // that must expire at cleanup, NOT a permanent base-stat mutation.
        const power = ctx.getPower(target);
        ctx.addTemporaryPTBuff(target, power, 0, { phase: "end-of-turn" });
        // CR 603.7a — destroy fires at the next end step. Payload holds the
        // creature id so the resolver can look it up after the scheduling
        // spell has left the stack.
        ctx.scheduleDelayedTrigger(
            BERSERK_ID,
            "destroy-if-attacked",
            "next-end-step",
            { targetId: target.id }
        );
    },
    delayedTriggers: [
        {
            id: "destroy-if-attacked",
            oracleText:
                "At the beginning of the next end step, destroy that creature if it attacked this turn.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                const target = { type: "permanent" as const, id: targetId };
                // CR 506.2 — only if the creature was declared as an attacker
                // at any point this turn. destroy() is a no-op when the
                // permanent has already left the battlefield (CR 603.7b).
                if (!ctx.hasAttackedThisTurn(target)) return;
                ctx.destroy(target);
            },
        },
    ],
};

export const birdsOfParadise: CardDefinition = {
    id: "55fe6449-1f23-43dc-adee-d144cd505b5c",
    rarity: "rare",
    name: "Birds of Paradise",
    oracleText: "Flying\n{T}: Add one mana of any color.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "birds-of-paradise-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            effect: (ctx: ActivatedAbilityContext) => {
                // Color chosen at activation time, applied by engine
                ctx.addMana({ G: 1 });
            },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// CR 605.1a — the granted ability adds mana and does not target, so it
// qualifies as a mana ability (useStack: false). CR 118.4 — paying 1 life
// requires player.life >= 1; SBA handles reaching 0 (CR 704.5a).
const CHANNEL_ID = "c1862c47-71cc-45a3-8805-a5ddc62e55ea";

export const channel: CardDefinition = {
    id: CHANNEL_ID,
    rarity: "uncommon",
    name: "Channel",
    manaCost: { G: 2 },
    types: ["Sorcery"],
    activatedAbilities: [
        {
            id: "channel-mana",
            cost: { life: 1 },
            oracleText: "Pay 1 life: Add {C}.",
            useStack: false,
            manaProduced: { C: 1 },
            effect: (ctx) => ctx.addMana({ C: 1 }),
        },
    ],
    resolve: (ctx) => {
        ctx.grantAbility(ctx.caster, CHANNEL_ID, "channel-mana", {
            phase: "end-of-turn",
        });
    },
};

// --- Combat kill pattern (Cockatrice, Thicket Basilisk) ---
// "Whenever this creature blocks or becomes blocked by a non-Wall creature,
// destroy that creature at end of combat." (CR 509.1h, CR 511.3)

// Built from the shared `combatPairKill` primitive (becomes-blocked → deferred
// end-of-combat destroy). The non-Wall gate is the only card-specific input;
// `combatant: "self"` because the trigger source IS the combatant.
function combatKillPair(
    cardId: string,
    abilityId: string
): { trigger: TriggeredAbility; delayed: DelayedTriggerDef } {
    return combatPairKill({
        cardId,
        triggerId: abilityId,
        delayedTriggerId: `${abilityId}-destroy`,
        oracleText:
            "Whenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.",
        delayedOracleText: "Destroy that creature at end of combat.",
        combatant: "self",
        opponentFilter: (opponent) => !opponent.subtypes.includes("Wall"),
    });
}

const cockatriceCombatKill = combatKillPair(
    "9cd91814-6177-4a3d-a1c1-a3be7d7c7957",
    "cockatrice-combat-kill"
);

const thicketBasiliskCombatKill = combatKillPair(
    "e92cce01-b3bd-4307-aae5-9a7c8fa386ab",
    "basilisk-combat-kill"
);

// Cockatrice — {3}{G}{G} 2/4, flying. "Whenever this creature blocks or
// becomes blocked by a non-Wall creature, destroy that creature at end of
// combat." (CR 509.1h combat pairing trigger, CR 511.3 end-of-combat timing)
const COCKATRICE_ID = "9cd91814-6177-4a3d-a1c1-a3be7d7c7957";

export const cockatrice: CardDefinition = {
    id: COCKATRICE_ID,
    rarity: "rare",
    name: "Cockatrice",
    oracleText:
        "Flying\nWhenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Cockatrice"],
    power: 2,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [cockatriceCombatKill.trigger],
    delayedTriggers: [cockatriceCombatKill.delayed],
};

export const crawWurm: CardDefinition = {
    id: "bfed1a95-bd67-4e16-a781-81866028af2f",
    rarity: "common",
    name: "Craw Wurm",
    manaCost: { X: 4, G: 2 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 6,
    toughness: 4,
};

export const elvishArchers: CardDefinition = {
    id: "1cb9d405-f2b5-4e10-a405-feafd2a87d90",
    rarity: "rare",
    name: "Elvish Archers",
    oracleText: "First strike",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Archer"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
};

// Force of Nature — "Trample. At the beginning of your upkeep, this
// creature deals 8 damage to you unless you pay {G}{G}{G}{G}." (CR 702.19
// trample, CR 603.6a phase trigger, CR 117.3a may-pay; on decline the
// source-of-damage is this creature itself, so the damage is sourced from
// the permanent's instance id — relevant for damage tracking and shields.)
export const forceOfNature: CardDefinition = {
    id: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3",
    rarity: "rare",
    name: "Force of Nature",
    oracleText:
        "Trample\nAt the beginning of your upkeep, this creature deals 8 damage to you unless you pay {G}{G}{G}{G}.",
    manaCost: { X: 2, G: 4 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 8,
    toughness: 8,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "force-of-nature-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 8 damage to you unless you pay {G}{G}{G}{G}.",
            cost: { G: 4 },
            prompt: "Pay {G}{G}{G}{G} or take 8 damage from Force of Nature?",
            onDecline: (ctx) =>
                ctx.dealDamage({ type: "player", id: ctx.controller }, 8),
        }),
    ],
};

// Fungusaur — "Whenever this creature is dealt damage, put a +1/+1 counter
// on it." (CR 603.2 damage trigger, CR 122.1 counter, CR 117.5 SBA-before-
// triggers ordering — lethal damage kills Fungusaur before the counter is
// applied, matching the official ruling).
export const fungusaur: CardDefinition = {
    id: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23",
    rarity: "rare",
    name: "Fungusaur",
    oracleText:
        "Whenever this creature is dealt damage, put a +1/+1 counter on it.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Fungus", "Dinosaur"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        damageTakenTrigger({
            id: "fungusaur-counter",
            oracleText:
                "Whenever this creature is dealt damage, put a +1/+1 counter on it.",
            target: {
                kind: "permanent",
                filter: { controllerRelation: "self" },
            },
            // NOT DSL-migratable (ADR 0045): built via the `damageTakenTrigger`
            // factory, which owns the `resolve` closure and exposes no
            // `effects[]` site. The body is a clean `counters` add on
            // `$source`, but the factory wrapper blocks it. Stays resolve()
            // until the trigger factories accept effects.
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        }),
    ],
};

// Gaea's Liege — "As long as Gaea's Liege isn't attacking, its power and
// toughness are each equal to the number of Forests you control. As long as
// Gaea's Liege is attacking, its power and toughness are each equal to the
// number of Forests defending player controls.\n{T}: Target land becomes a
// Forest until this creature leaves the battlefield."
// P/T via a layer 7c characteristic-defining ability (CR 604.3, 613.4c) that
// reads `isAttacking` (W14) to switch which player's Forests are counted.
// The {T} ability marks the target land with a `gaea-forest` counter; a
// counter-driven subtype-set (CR 305.7, layer 4) turns it into a Forest while
// Gaea's Liege is on the battlefield — when Gaea's Liege leaves,
// `unapplySourceStaticEffects` reverts the land (CR 611.2), satisfying "until
// this creature leaves the battlefield".
const countForestsControlledBy = (
    controllerId: string,
    state: StaticEffectStateView
): number => {
    let n = 0;
    for (const player of state.players) {
        for (const p of player.battlefield) {
            if (
                p.controllerId === controllerId &&
                p.subtypes.includes("Forest")
            ) {
                n++;
            }
        }
    }
    return n;
};

export const gaeasLiege: CardDefinition = {
    id: "e2b15221-c8b0-4861-9f8b-8a65834ad499",
    rarity: "rare",
    name: "Gaea's Liege",
    oracleText:
        "As long as Gaea's Liege isn't attacking, its power and toughness are each equal to the number of Forests you control. As long as Gaea's Liege is attacking, its power and toughness are each equal to the number of Forests defending player controls.\n{T}: Target land becomes a Forest until this creature leaves the battlefield.",
    manaCost: { X: 3, G: 3 },
    types: ["Creature"],
    subtypes: ["Avatar"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let n: number;
                if (source.isAttacking) {
                    // CR 509.1 — in a 2-player game the defending player is the
                    // attacker's sole opponent. The static-effect state view
                    // exposes no player ids, so derive the opponent's id from
                    // any permanent it controls; if it controls none it has no
                    // Forests either, so the count is 0.
                    const defenderId = state.players
                        .flatMap((pl) => pl.battlefield)
                        .find(
                            (c) => c.controllerId !== source.controllerId
                        )?.controllerId;
                    n = defenderId
                        ? countForestsControlledBy(defenderId, state)
                        : 0;
                } else {
                    n = countForestsControlledBy(source.controllerId, state);
                }
                return { power: n, toughness: n };
            },
        },
        {
            kind: "subtype-set",
            applies: (target) => (target.counters?.["gaea-forest"] ?? 0) > 0,
            subtypes: ["Forest"],
        },
    ],
    activatedAbilities: [
        {
            id: "gaeas-liege-make-forest",
            oracleText:
                "{T}: Target land becomes a Forest until this creature leaves the battlefield.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            // CR 122 (issue #841) — mark the targeted land with a gaea-forest
            // counter; the counter-driven subtype-set (layer 4) makes it a
            // Forest while Gaea's Liege is on the battlefield.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "gaea-forest",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};

export const giantGrowth: CardDefinition = {
    id: "367dbefe-3366-408e-9fcf-7dc00f8cc201",
    rarity: "common",
    name: "Giant Growth",
    oracleText: "Target creature gets +3/+3 until end of turn.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // AI combat hint (ADR 0021, issue #229): a +3/+3 combat trick the bot models
    // while held — the attacker's ambush pump (a bait attacker is no longer
    // pre-judged dead) and the threat a defender must respect.
    aiCombatHint: { pump: { power: 3, toughness: 3 } },
    // CR 611.1 / 514.2: "+3/+3 until end of turn" is a temporary P/T buff that
    // must expire at the cleanup step — NOT a permanent base-stat mutation.
    // `addTemporaryPTBuff` records it in `temporaryPTMods` with an end-of-turn
    // duration, which the cleanup duration tick purges.
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: 3,
            toughness: 3,
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Giant Spider — vanilla 2/4 with reach. (CR 702.17 reach: a creature with
// reach can block a creature with flying.) Combat validator already honors
// "reach" alongside "flying" in `block.ts`.
export const giantSpider: CardDefinition = {
    id: "77636b4c-faea-4bf5-b88c-dd5bb88dc930",
    rarity: "common",
    name: "Giant Spider",
    oracleText: "Reach (This creature can block creatures with flying.)",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 4,
    staticAbilities: ["reach"],
};

export const grizzlyBears: CardDefinition = {
    id: "ce2d603a-3231-4a8c-bf39-1617586ea870",
    rarity: "common",
    name: "Grizzly Bears",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

// CR 107.3: X chosen on cast. CR 120.3: mirrors Earthquake but targets
// fliers instead.
export const hurricane: CardDefinition = {
    id: "52f5a19f-16e4-4d35-89e1-969ac8202f88",
    rarity: "uncommon",
    name: "Hurricane",
    oracleText:
        "Hurricane deals X damage to each creature with flying and each player.",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(ctx.getX(), {
            creatures: { requireAbility: "flying" },
            players: true,
        });
    },
};

// Ice Storm — "Destroy target land." (CR 701.7). Identical shape to Sinkhole
// / Stone Rain, distinct only in cost / color.
export const iceStorm: CardDefinition = {
    id: "9914836e-2fa6-4390-94b2-431427848a54",
    rarity: "uncommon",
    name: "Ice Storm",
    oracleText: "Destroy target land.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effect: "destroy-target",
};

// Instill Energy — "Enchant creature. Enchanted creature can attack as
// though it had haste. {0}: Untap enchanted creature. Activate only during
// your turn and only once each turn." (CR 303.4 aura, CR 702.10 haste
// surrogate, CR 602.5b activation timing.) Pseudo-haste is modeled by
// granting the host the regular "haste" keyword — slightly broader than the
// printed text (LEA pseudo-haste only allows attacking, not abilities) but
// adequate for the engine's binary summoning-sickness model. The {0}: untap
// uses `controllerTurnOnly` + `oncePerTurn` to enforce both timing
// restrictions without an open infinite-untap loop.
export const instillEnergy: CardDefinition = {
    id: "5bd38716-874c-4e3c-a315-837839a6258c",
    rarity: "uncommon",
    name: "Instill Energy",
    oracleText:
        "Enchant creature\nEnchanted creature can attack as though it had haste.\n{0}: Untap enchanted creature. Activate only during your turn and only once each turn.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
    ],
    activatedAbilities: [
        {
            id: "instill-energy-untap",
            oracleText:
                "{0}: Untap enchanted creature. Activate only during your turn and only once each turn.",
            cost: { mana: {} },
            useStack: true,
            controllerTurnOnly: true,
            oncePerTurn: true,
            // NOT DSL-migratable (ADR 0045): untaps the ENCHANTED creature —
            // the Aura's attached host, read via `getAttachedTo`. The
            // EffectObjectSelector grammar has no "$host"/attached-object
            // member (only announced slots, `$source`, and forEach `$each`).
            // Blocked on: an attached-object EffectObjectSelector.
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.untap({ type: "permanent", id: hostId });
            },
        },
    ],
};

export const ironrootTreefolk: CardDefinition = {
    id: "b93c5869-7777-44bb-967a-e9439b25ced4",
    rarity: "common",
    name: "Ironroot Treefolk",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 3,
    toughness: 5,
};

// Kudzu — "Enchant land. When enchanted land becomes tapped, destroy it. That
// land's controller may attach this Aura to a land of their choice." (CR
// 701.20a becomes-tapped trigger, 701.3d attach, 704.5n orphan-aura SBA.)
//
// Resolution ordering note: the host is destroyed first, then the controller
// is asked (CR 117.3a "may") and chooses a new land (CR 608.2 mid-resolution
// choice). `ctx.destroy` is idempotent, so the replay-from-top that follows
// each choice suspension re-runs it harmlessly. Destroying before the choice
// keeps the dead host out of the candidate set without needing an exclusion
// filter. If the controller has no other land — or declines — Kudzu is left
// orphaned and SBA 704.5n moves it to the graveyard.
export const kudzu: CardDefinition = {
    id: "b2b72dcd-9ea1-4729-baae-ecd262fdff67",
    rarity: "rare",
    name: "Kudzu",
    oracleText:
        "Enchant land\nWhen enchanted land becomes tapped, destroy it. That land's controller may attach this Aura to a land of their choice.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "kudzu-tapped",
            oracleText:
                "When enchanted land becomes tapped, destroy it. That land's controller may attach this Aura to a land of their choice.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.destroy({ type: "permanent", id: tapped.id });
                const hostController = tapped.controllerId;
                const lands = ctx.getBattlefieldIds(hostController, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: `kudzu-may-${ctx.sourceInstanceId}`,
                    prompt: "Attach Kudzu to a land you control?",
                });
                if (accept === undefined) return;
                if (!accept) return;
                const picks = ctx.requestChoice({
                    playerId: hostController,
                    choiceId: `kudzu-reattach-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Choose a land to attach Kudzu to.",
                });
                if (picks === undefined) return;
                ctx.reattachAura(ctx.sourceInstanceId, picks[0]);
            },
        }),
    ],
};

// Ley Druid — "{T}: Untap target land." (CR 605 activated ability, 701.20a
// untap). Stack-using ability (not a mana ability per CR 605.1a — produces no
// mana directly).
export const leyDruid: CardDefinition = {
    id: "f9232508-d363-4ef3-987a-741f6bff331f",
    rarity: "uncommon",
    name: "Ley Druid",
    oracleText: "{T}: Untap target land.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "ley-druid-untap",
            oracleText: "{T}: Untap target land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the
            // announced land target (CR 701.26b).
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        },
    ],
};

// Lifeforce — "{G}, Sacrifice Lifeforce: Counter target black spell." (CR
// 701.5a counter, 202.2 color filter on stack target). Mirror of Deathgrip.
export const lifeforce: CardDefinition = {
    id: "e292577e-6232-44fa-a9c2-cc09949c6ed3",
    rarity: "uncommon",
    name: "Lifeforce",
    oracleText: "{G}{G}: Counter target black spell.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "lifeforce-counter",
            oracleText: "{G}, Sacrifice Lifeforce: Counter target black spell.",
            cost: { mana: { G: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                colorFilter: "B",
            },
            // Migrated resolve() → effects[] (ADR 0045, issue #831): a single
            // `counter` Op on the announced target spell (CR 701.5a). A
            // behaviour test was authored first (green-before) since the card
            // had none.
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

export const lifelace: CardDefinition = makeLace({
    id: "38cb601b-a35c-412e-b386-e77dad3daa54",
    rarity: "rare",
    name: "Lifelace",
    oracleText:
        "Target spell or permanent becomes green. (Mana symbols on that permanent remain unchanged.)",
    manaCost: { G: 1 },
    color: "G",
});

export const livingArtifact: CardDefinition = {
    id: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e",
    rarity: "rare",
    name: "Living Artifact",
    oracleText:
        "Enchant artifact\nWhenever you're dealt damage, put that many vitality counters on this Aura.\nAt the beginning of your upkeep, you may remove a vitality counter from this Aura. If you do, you gain 1 life.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        damageTakenTrigger({
            id: "living-artifact-vitality",
            oracleText:
                "Whenever you're dealt damage, put that many vitality counters on Living Artifact.",
            target: {
                kind: "player",
                player: { relation: "controller" },
            },
            // NOT DSL-migratable (ADR 0045): built via the `damageTakenTrigger`
            // factory (no `effects[]` site) AND the counter count is the
            // event's damage amount (`damage.amount`), a trigger-event field the
            // `count` value grammar cannot express. Stays resolve().
            resolve: (ctx, _event, damage) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "vitality",
                    damage.amount
                );
            },
        }),
        phaseTrigger({
            id: "living-artifact-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may remove a vitality counter from Living Artifact. If you do, you gain 1 life.",
            phase: "UPKEEP",
            scope: "your",
            interveningIf: (_event, self) => {
                return (self.counters?.["vitality"] ?? 0) > 0;
            },
            // NOT DSL-migratable (ADR 0045): the "you may remove a counter"
            // choice is a COST-FREE yes/no gate, but the `mayPay` Op requires a
            // mana `cost`; and "if you do, gain 1 life" is gated on the
            // `removeCounter` return value (whether a counter was actually
            // removed), which the declarative `counters` Op does not expose.
            // Stays resolve() until a cost-free "may" construct exists.
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    prompt: "Remove a vitality counter from Living Artifact to gain 1 life?",
                });
                if (accept === undefined) return;
                if (accept) {
                    const removed = ctx.removeCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "vitality",
                        1
                    );
                    if (removed > 0) {
                        ctx.gainLife(ctx.controller, 1);
                    }
                }
            },
        }),
    ],
};

// Living Lands — "All Forests are 1/1 creatures that are still lands."
// (CR 305.7 type-add + pt-cda). Global static: type-add Creature to all
// permanents with Forest subtype, pt-cda sets 1/1. Summoning sickness
// applies to newly-animated lands.
export const livingLands: CardDefinition = {
    id: "80be0580-7948-4d8e-8c0f-5e2797ac411b",
    rarity: "rare",
    name: "Living Lands",
    oracleText: "All Forests are 1/1 creatures that are still lands.",
    manaCost: { X: 3, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "type-add",
            applies: (target) => target.subtypes.includes("Forest"),
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target) => target.subtypes.includes("Forest"),
            compute: () => ({ power: 1, toughness: 1 }),
        },
    ],
};

export const llanowarElves: CardDefinition = {
    id: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb",
    rarity: "common",
    name: "Llanowar Elves",
    oracleText: "{T}: Add {G}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "llanowar-elves-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};

// Lure — "Enchant creature. All creatures able to block enchanted creature
// do so." (CR 509.1c — block requirement, scope "all-able"). The
// StaticBlockRequirement is collected from attached auras at
// block-confirmation time; the combat validator auto-assigns every
// eligible defender creature to block the enchanted attacker.
export const lure: CardDefinition = {
    id: "2a87b26e-0431-42e9-b44f-94ba8546111a",
    rarity: "uncommon",
    name: "Lure",
    oracleText:
        "Enchant creature\nAll creatures able to block enchanted creature do so.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-requirement",
            id: "lure-must-block",
            oracleText: "All creatures able to block enchanted creature do so.",
            scope: "all-able",
        },
    ],
};

// Natural Selection — {G} Instant. "Look at the top three cards of target
// player's library, then put them back in any order. You may have that
// player shuffle." (CR 401.4 — peek; CR 701.20 — shuffle)
export const naturalSelection: CardDefinition = {
    id: "a8917dc8-01c0-4e72-9310-c4d501775411",
    rarity: "rare",
    name: "Natural Selection",
    oracleText:
        "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        // Step 0: peek top 3, request reorder
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            const topIds = ctx.peekLibraryTop(target.id, 3);
            const count = Math.min(topIds.length, 3);
            if (count === 0) return;
            const ordered = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                kind: "reorder-library",
                zone: "library",
                count,
                zoneOwnerId: target.id,
                prompt: "Put these cards back in any order (first = top).",
            });
            if (!ordered) return;
            ctx.reorderLibraryTop(target.id, ordered);
            // ADR 0026 / PRD #338: the chooser precisely positioned these top
            // cards, so they become known to the chooser only — persisting
            // after the choice resolves, until a shuffle clears the library.
            ctx.markKnown(target.id, ordered, ctx.controller);
        },
        // Step 1: optional shuffle
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            const doShuffle = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                prompt: "Shuffle target player's library?",
            });
            if (doShuffle === undefined) return;
            if (doShuffle) ctx.shuffleLibrary(target.id);
        },
    ],
};

// Regeneration — "Enchant creature. {G}: Regenerate enchanted creature."
// (CR 303.4 aura attachment, 701.15a regenerate, 614.5 destroy replacement,
// 506.4 remove from combat). The activated ability does not target — the
// affected creature is determined by the aura's `attachedTo` host. The
// regen rider is implemented engine-side via regenerateOrDestroy: each
// shield consumed heals damage, taps, and removes from combat.
export const regeneration: CardDefinition = {
    id: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4",
    rarity: "common",
    name: "Regeneration",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\n{G}: Regenerate enchanted creature. (The next time that creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "regeneration-regenerate",
            cost: { mana: { G: 1 } },
            oracleText: "{G}: Regenerate enchanted creature.",
            useStack: true,
            // NOT DSL-migratable (ADR 0045): regenerates the Aura's enchanted
            // host, read via getAttachedTo — the object-selector grammar has no
            // attached-host ("enchanted permanent") ref (same block as Fylgja,
            // #845). The `regenerate` Op itself is available; only the target
            // selector is missing.
            // Blocked on: an attached-host object selector (planned-migratable).
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: hostId,
                });
            },
        },
    ],
};

// Regrowth — "Return target card from your graveyard to your hand."
// CR 601.2c (target chosen at cast); CR 608.2b (illegal target on resolution
// → effect does nothing); CR 400.7 (zone change to hand). The
// `targetRequirement.zone: "graveyard"` + `controller: "you"` + `type: "card"`
// triple narrows legal targets to any card type sitting in the caster's own
// graveyard. `moveCardById` is a silent no-op if the card has left the
// graveyard before resolution, so the legality recheck on resolve is implicit.
export const regrowth: CardDefinition = {
    id: "badc73ec-3728-4246-90c7-5f4eb7051ed5",
    rarity: "uncommon",
    name: "Regrowth",
    oracleText: "Return target card from your graveyard to your hand.",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "card",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    // Migrated resolve()→effects[] (ADR 0045, #839): return the targeted
    // graveyard card to its owner's hand (CR 400.7).
    effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
};

export const scrybSprites: CardDefinition = {
    id: "6d929c38-91e6-457c-937a-d1884f4bba44",
    rarity: "common",
    name: "Scryb Sprites",
    oracleText: "Flying",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
};

export const shanodinDryads: CardDefinition = {
    id: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8",
    rarity: "common",
    name: "Shanodin Dryads",
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Nymph", "Dryad"],
    power: 1,
    toughness: 1,
    staticAbilities: ["forestwalk"],
};

// Stream of Life — "Target player gains X life." (CR 107.3 X cost, 118.3
// life gain).
export const streamOfLife: CardDefinition = {
    id: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9",
    rarity: "common",
    name: "Stream of Life",
    oracleText: "Target player gains X life.",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") ctx.gainLife(target.id, ctx.getX());
    },
};

// Thicket Basilisk — {3}{G}{G} 2/4. Same combat kill as Cockatrice, no flying.
const THICKET_BASILISK_ID = "e92cce01-b3bd-4307-aae5-9a7c8fa386ab";

export const thicketBasilisk: CardDefinition = {
    id: THICKET_BASILISK_ID,
    rarity: "uncommon",
    name: "Thicket Basilisk",
    oracleText:
        "Whenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Basilisk"],
    power: 2,
    toughness: 4,
    triggeredAbilities: [thicketBasiliskCombatKill.trigger],
    delayedTriggers: [thicketBasiliskCombatKill.delayed],
};

// Timber Wolves — vanilla 1/1 Wolf with banding (CR 702.21).
export const timberWolves: CardDefinition = {
    id: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01",
    rarity: "rare",
    name: "Timber Wolves",
    oracleText:
        "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 1,
    toughness: 1,
    staticAbilities: ["banding"],
};

export const tranquility: CardDefinition = {
    id: "774cc5a6-3a69-4812-add4-eb5eb6389238",
    rarity: "common",
    name: "Tranquility",
    oracleText: "Destroy all enchantments.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    // Migrated resolve() → effects[] (ADR 0045, issue #831): `destroyAll` is
    // `forEach` over every player's battlefield Enchantments (CR 110) →
    // `destroy` each — same sweep shape as Day of Judgment (m11/white). A
    // behaviour test was authored first (green-before) since the card had none.
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Enchantment" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

export const tsunami: CardDefinition = {
    id: "9ed67d61-cf47-446b-b454-eb404a8686b7",
    rarity: "uncommon",
    name: "Tsunami",
    oracleText: "Destroy all Islands.",
    manaCost: { X: 3, G: 1 },
    types: ["Sorcery"],
    // Migrated resolve() → effects[] (ADR 0045, issue #831): `destroyAll` is
    // `forEach` over every player's battlefield Islands (CR 110/205) →
    // `destroy` each — same sweep shape as Day of Judgment (m11/white). A
    // behaviour test was authored first (green-before) since the card had none.
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { subtype: "Island" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

// Verduran Enchantress — "Whenever you cast an enchantment spell, you may
// draw a card." (CR 603.2 spell-cast trigger; CR 117.3a optional). The
// trigger goes on top of the casting spell and resolves before it.
export const verduranEnchantress: CardDefinition = {
    id: "9f87178b-1221-4d7a-a7a5-20d7f01b8089",
    rarity: "rare",
    name: "Verduran Enchantress",
    oracleText: "Whenever you cast an enchantment spell, you may draw a card.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 0,
    toughness: 2,
    triggeredAbilities: [
        spellCastTrigger({
            id: "verduran-enchantress-draw",
            oracleText:
                "Whenever you cast an enchantment spell, you may draw a card.",
            scope: "you",
            filter: { types: "Enchantment" },
            // NOT DSL-migratable (ADR 0045, issue #831): "you may draw a card"
            // is an optional (no-cost) yes/no effect; `mayPay` models paying a
            // cost, not a bare optional, and the optional-choice Op is `planned`.
            // Blocked on: `optionChoice` (cost-free may) Op.
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    prompt: "Draw a card?",
                });
                if (accept === undefined) return;
                if (accept) ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
};

// Wall of Brambles — vanilla 2/3 Plant Wall with defender (CR 702.3).
export const wallOfBrambles: CardDefinition = {
    id: "af2a4558-db6e-41b2-aff6-b164d93282a0",
    rarity: "uncommon",
    name: "Wall of Brambles",
    oracleText:
        "Defender (This creature can't attack.)\n{G}: Regenerate this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 2,
    toughness: 3,
    staticAbilities: ["defender"],
};

export const wallOfIce: CardDefinition = {
    id: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756",
    rarity: "uncommon",
    name: "Wall of Ice",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 7,
    staticAbilities: ["defender"],
};

export const wallOfWood: CardDefinition = {
    id: "8df80424-3bd9-4982-ad79-e55d9ba3b43d",
    rarity: "common",
    name: "Wall of Wood",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender"],
};

// Wanderlust — "Enchant creature. At the beginning of the upkeep of
// enchanted creature's controller, this Aura deals 1 damage to that
// player." (CR 303.4 aura, CR 603.6a phase trigger keyed on the host's
// controller, CR 120.3 source = this Aura instance.) The damage source is
// the Aura itself, so death triggers on the Aura key from its
// `sourceInstanceId`, not from the host's controller.
export const wanderlust: CardDefinition = {
    id: "220a03ca-8c9b-4acb-821d-f6577fbb20fb",
    rarity: "uncommon",
    name: "Wanderlust",
    oracleText:
        "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, this Aura deals 1 damage to that player.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "wanderlust-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, this Aura deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045, issue #831): the damaged player is
            // the enchanted creature's controller (host-controller scope), which
            // no EffectPlayerRef expresses. Blocked on: host-controller player ref.
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 1);
            },
        }),
    ],
};

export const warMammoth: CardDefinition = {
    id: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb",
    rarity: "common",
    name: "War Mammoth",
    oracleText: "Trample",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
};

// Web — "Enchant creature. Enchanted creature gets +0/+2 and has reach."
// (CR 303.4 aura, 611 layer 7c, 702.17 reach grant via static effect).
export const web: CardDefinition = {
    id: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0",
    rarity: "rare",
    name: "Web",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nEnchanted creature gets +0/+2 and has reach. (It can block creatures with flying.)",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 0,
            toughness: 2,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "reach",
        },
    ],
};

// Wild Growth — "Enchant land. Whenever enchanted land is tapped for mana,
// its controller adds an additional {G}." (CR 303.4 aura attachment, 603.2
// PERMANENT_TAPPED trigger, 605 mana ability). The aura's host is the
// "enchanted land"; the trigger fires only on for-mana taps of that host.
export const wildGrowth: CardDefinition = {
    id: "fd896dfa-66c0-4327-8e5b-489bbe350c95",
    rarity: "common",
    name: "Wild Growth",
    oracleText:
        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): a `tappedTrigger` FACTORY hardcodes its
        // `resolve` and exposes no `effects[]` site, and the recipient is read
        // from the trigger event (the tapped land's controller — tapped.controllerId,
        // an event field). Blocked on: factory-trigger effects[] site + an
        // event-field player ref.
        tappedTrigger({
            id: "wild-growth-extra-green",
            oracleText:
                "Whenever enchanted land is tapped for mana, its controller adds an additional {G}.",
            scope: "any",
            forMana: true,
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.addManaTo(tapped.controllerId, { G: 1 });
            },
        }),
    ],
};

// Fog — {G} Instant. "Prevent all combat damage that would be dealt this
// turn." (CR 615)
export const fog: CardDefinition = {
    id: "cfba606d-bb55-43ba-aa0c-299649958788",
    rarity: "common",
    name: "Fog",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { G: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, #845): the "all-combat" mode of
    // preventDamage is a turn-scoped global Fog (CR 615).
    effects: [{ op: "preventDamage", mode: "all-combat" }],
};

// Fastbond — {G} Enchantment. "You may play any number of lands on each of
// your turns. Whenever you play a land, if it wasn't the first land you played
// this turn, Fastbond deals 1 damage to you." (CR 305.2 — extra land drops)
export const fastbond: CardDefinition = {
    id: "a575a9af-e1de-4a1d-91d8-440585377e4f",
    rarity: "rare",
    name: "Fastbond",
    oracleText:
        "You may play any number of lands on each of your turns.\nWhenever you play a land, if it wasn't the first land you played this turn, this enchantment deals 1 damage to you.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    extraLandDrops: 999,
    triggeredAbilities: [
        enteredTrigger({
            id: "fastbond-land-etb",
            oracleText:
                "Whenever you play a land, if it wasn't the first land you played this turn, Fastbond deals 1 damage to you.",
            scope: "yours",
            filter: { types: "Land" },
            condition: (_event, self, state) => {
                if (!state) return false;
                const player = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return (player?.landsPlayedThisTurn ?? 0) > 1;
            },
            // NOT DSL-migratable (ADR 0045, issue #831): the ETB damage is gated
            // on an intervening-if over landsPlayedThisTurn — a game-state read
            // no `if` predicate form expresses. Blocked on: state-read predicate
            // (landsPlayedThisTurn).
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        }),
    ],
};
