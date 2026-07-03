// Limited Edition Alpha (LEA), the base set of Magic, split by colour per
// ADR 0043. Every entry is a CardDefinition — LEA is the root set whose cards
// later editions (LEB, 2ED, 3ED, …) reprint via CardPrint, resolving printId →
// definitionId → the shared LEA definition (ADR 0014). Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type { CardDefinition, ManaCost, SpellContext } from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { makeLace } from "./white";
import { makeElementalBlast } from "./blue";

// Burrowing — "Enchant creature. Enchanted creature has mountainwalk." (CR
// 303.4 aura attachment, 702.13c landwalk, 611.2 keyword grant).
export const burrowing: CardDefinition = {
    id: "a14c05e4-8df3-450b-8a98-5028e73b14c1",
    rarity: "uncommon",
    name: "Burrowing",
    oracleText:
        "Enchant creature\nEnchanted creature has mountainwalk. (It can't be blocked as long as defending player controls a Mountain.)",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "mountainwalk",
        },
    ],
};

export const chaoslace: CardDefinition = makeLace({
    id: "72ea2048-57bc-43d5-8987-33ca727f1a97",
    rarity: "rare",
    name: "Chaoslace",
    oracleText:
        "Target spell or permanent becomes red. (Its mana symbols remain unchanged.)",
    manaCost: { R: 1 },
    color: "R",
});

// Dragon Whelp — "Flying. {R}: Dragon Whelp gets +1/+0 until end of turn.
// If this ability has been activated four or more times this turn, sacrifice
// Dragon Whelp at the beginning of the next end step." (CR 602.5, 603.7a)
//
// The pump is a standard addTemporaryPTBuff. After resolution, getActivationCount
// reads the per-source counter. On the 4th+ activation, a delayed end-step
// sacrifice is scheduled. Each activation past the 3rd adds a separate
// delayed trigger (all resolve independently; the creature is already gone
// by the time later ones fire, so extra triggers are no-ops).
const DRAGON_WHELP_ID = "6bbf1eab-bc32-4835-b566-8634b1fe81b0";

export const dragonWhelp: CardDefinition = {
    id: DRAGON_WHELP_ID,
    rarity: "uncommon",
    name: "Dragon Whelp",
    oracleText:
        "Flying\n{R}: Dragon Whelp gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice Dragon Whelp at the beginning of the next end step.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "dragon-whelp-pump",
            oracleText:
                "{R}: Dragon Whelp gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice Dragon Whelp at the beginning of the next end step.",
            cost: { mana: { R: 1 } },
            useStack: true,
            // NOT DSL-migratable (ADR 0045, issue #831): needs a temporary P/T
            // pump plus a conditional delayed sacrifice keyed on activation
            // count — both Ops (`pump`, `delayedTrigger`) are `planned`, not
            // implemented. Blocked on: `pump` + `delayedTrigger` Ops.
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
                // CR 602.5: activation count includes the current one
                // (already incremented before resolve).
                const count = ctx.getActivationCount("dragon-whelp-pump");
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        DRAGON_WHELP_ID,
                        "dragon-whelp-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "dragon-whelp-sacrifice",
            oracleText:
                "Sacrifice Dragon Whelp at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.destroy({ type: "permanent", id: targetId });
            },
        },
    ],
};

export const dwarvenDemolitionTeam: CardDefinition = {
    id: "03482c9c-1f25-4d73-9243-17462ea37ac4",
    rarity: "uncommon",
    name: "Dwarven Demolition Team",
    oracleText: "{T}: Destroy target Wall.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "dwarven-demolition-team-destroy",
            oracleText: "{T}: Destroy target Wall.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Wall",
            },
            // Migrated resolve() → effects[] (ADR 0045, issue #831): a single
            // `destroy` Op on the announced target (CR 701.7). Per-card test
            // ("destroys a target Wall on resolution") is the harness.
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Dwarven Warriors — "{T}: Target creature with power 2 or less can't be
// blocked this turn." (CR 113.1 grant of `unblockable` keyword via
// grantStaticAbility, 509.1b block restriction, 613 layer 7c power filter
// on target selection.)
export const dwarvenWarriors: CardDefinition = {
    id: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8",
    rarity: "common",
    name: "Dwarven Warriors",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf", "Warrior"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "dwarven-warriors-unblockable",
            oracleText:
                "{T}: Target creature with power 2 or less can't be blocked this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent")
                    ctx.grantStaticAbility(target, "unblockable", {
                        phase: "end-of-turn",
                    });
            },
        },
    ],
};

export const earthElemental: CardDefinition = {
    id: "b24b5864-44c0-4bc8-8705-9504f83b2c03",
    rarity: "uncommon",
    name: "Earth Elemental",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 5,
};

// Earthbind — "Enchant creature. Enchanted creature loses flying. When
// Earthbind enters, if enchanted creature has flying, Earthbind deals 2
// damage to that creature." (CR 613.1a keyword removal, layer 6). The
// keyword-remove is always active; the ETB damage fires only if the host
// originally had flying (checked via removedKeywords record).
export const earthbind: CardDefinition = {
    id: "a6d492b7-b0b3-420e-8d00-6dacb11de77e",
    rarity: "common",
    name: "Earthbind",
    oracleText:
        "Enchant creature\nEnchanted creature loses flying.\nWhen Earthbind enters, if enchanted creature has flying, Earthbind deals 2 damage to that creature.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-remove",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "earthbind-etb",
            oracleText:
                "When Earthbind enters, if enchanted creature has flying, Earthbind deals 2 damage to that creature.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045, issue #831): the ETB damage is
            // gated on the host having originally had flying (a removed-keyword
            // read) and targets the aura's host, neither of which the `if`
            // predicate forms or EffectObjectSelector express. Blocked on:
            // host object ref + removed-keyword predicate.
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                if (!ctx.hasRemovedKeyword(hostId, "flying")) return;
                ctx.dealDamage({ type: "permanent", id: hostId }, 2);
            },
        }),
    ],
};

// CR 107.3: X chosen on cast. CR 120.3: damage respects flying at
// resolution time (creatures losing flying mid-resolution aren't affected,
// since matching creatures are snapshotted).
export const earthquake: CardDefinition = {
    id: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64",
    rarity: "rare",
    name: "Earthquake",
    oracleText:
        "Earthquake deals X damage to each creature without flying and each player.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(ctx.getX(), {
            creatures: { excludeAbility: "flying" },
            players: true,
        });
    },
};

// False Orders — "Cast only during the declare blockers step. Remove target
// creature defending player controls from combat." (CR 506.4 remove from
// combat). The optional re-assignment as blocker is deferred (not modeled
// in initial scope — the primary effect of removing from combat is complete).
export const falseOrders: CardDefinition = {
    id: "7eb71ac4-796d-4011-9002-1129bc09c284",
    rarity: "common",
    name: "False Orders",
    oracleText:
        "Cast this spell only during the declare blockers step.\nRemove target creature defending player controls from combat. Creatures it was blocking that had become blocked by only that creature this combat become unblocked.",
    manaCost: { R: 1 },
    types: ["Instant"],
    castPhaseRestriction: ["DECLARE_BLOCKERS"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "opponent",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "permanent") return;
        // CR 509.1h — capture the attackers this blocker is SOLELY responsible
        // for blocking before it leaves combat. Removing a blocker no longer
        // auto-unblocks (blocked is combat state, not blocker count), so the
        // oracle's "become unblocked" clause must be applied explicitly: only
        // attackers left with no other blocker are unblocked; an attacker still
        // blocked by another creature stays blocked.
        const blockersByAttacker = ctx.getBlockersByAttacker();
        const soleBlocked = Object.keys(blockersByAttacker).filter(
            (attackerId) =>
                blockersByAttacker[attackerId].length === 1 &&
                blockersByAttacker[attackerId][0] === target.id
        );
        ctx.removeFromCombat(target);
        for (const attackerId of soleBlocked) {
            ctx.becomeUnblocked(attackerId);
        }
    },
};

export const fireElemental: CardDefinition = {
    id: "da237992-2919-4e37-8f56-2164095f59b5",
    rarity: "uncommon",
    name: "Fire Elemental",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 4,
};

// CR 601.2f: costs {1} more per extra target. CR 120.1: damage divided
// evenly, rounded down — remainder is discarded. CR 107.3: X chosen on cast.
export const fireball: CardDefinition = {
    id: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece",
    rarity: "common",
    name: "Fireball",
    oracleText:
        "This spell costs {1} more to cast for each target beyond the first.\nFireball deals X damage divided evenly, rounded down, among any number of targets.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: { min: 1 } },
    additionalGenericPerExtraTarget: 1,
    resolve: (ctx: SpellContext) => {
        ctx.dealDividedDamage(ctx.targets, ctx.getX());
    },
};

// Firebreathing — "Enchant creature. {R}: Enchanted creature gets +1/+0
// until end of turn." (CR 303.4 aura, 611.1 temp P/T mod). Same shape as
// Regeneration's host-aware activated ability.
export const firebreathing: CardDefinition = {
    id: "3eb27381-505d-4e47-bf66-9e7ba91a5075",
    rarity: "common",
    name: "Firebreathing",
    oracleText:
        "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "firebreathing-pump",
            oracleText: "{R}: Enchanted creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const flashfires: CardDefinition = {
    id: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5",
    rarity: "uncommon",
    name: "Flashfires",
    oracleText: "Destroy all Plains.",
    manaCost: { X: 3, R: 1 },
    types: ["Sorcery"],
    // Migrated resolve() → effects[] (ADR 0045, issue #831): `destroyAll` is
    // `forEach` over every player's battlefield Plains (CR 110/205) → `destroy`
    // each — same sweep shape as Day of Judgment (m11/white). A behaviour test
    // was authored first (green-before) since the card had none.
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { subtype: "Plains" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

// Fork — "Copy target instant or sorcery spell, except that the copy is red.
// You may choose new targets for the copy." (CR 707.10 copying a spell,
// 707.10b new targets, 707.10c color-change to red). The copy is put on the
// stack above the original and resolves first; it ceases to exist afterward.
export const fork: CardDefinition = {
    id: "e6b43916-fe2d-417a-a550-d7c795023297",
    rarity: "rare",
    name: "Fork",
    oracleText:
        "Copy target instant or sorcery spell, except that the copy is red. You may choose new targets for the copy.",
    manaCost: { R: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Instant", "Sorcery"],
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "spell") return;
        // CR 707.10c — the copy is red regardless of the original's color.
        const copyId = ctx.copyStackItem(target.id, { colorOverride: ["R"] });
        // copyStackItem returns null for illegal targets (e.g. a permanent
        // spell or an item that left the stack); nothing to retarget then.
        if (copyId) ctx.requestCopyRetarget(copyId);
    },
};

// Goblin Balloon Brigade — "{R}: Goblin Balloon Brigade gains flying until
// end of turn." (CR 702.9 flying, 611.1b temporary keyword grant). The grant
// targets self via `ctx.sourceInstanceId`, expires at CLEANUP.
export const goblinBalloonBrigade: CardDefinition = {
    id: "5129b422-7a35-4bc5-b14b-c814012a0d8f",
    rarity: "uncommon",
    name: "Goblin Balloon Brigade",
    oracleText: "{R}: This creature gains flying until end of turn.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-balloon-brigade-fly",
            oracleText:
                "{R}: Goblin Balloon Brigade gains flying until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "flying",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Goblin King — "Other Goblins get +1/+1 and have mountainwalk." (CR 611
// layer 7c, 702.13c landwalk). Both halves wired via lord-style static
// effects: pt-buff applied at stat-read time, keyword-grant applied
// imperatively at battlefield entry/exit (see `applyExistingGrantsTo` /
// `applySourceStaticEffects` in gre/state.ts).
export const goblinKing: CardDefinition = {
    id: "5873672d-37ea-4c0f-97f3-12b74fde112d",
    rarity: "rare",
    name: "Goblin King",
    oracleText: "Other Goblins get +1/+1 and have mountainwalk.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Goblin"),
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Goblin"),
            keyword: "mountainwalk",
        },
    ],
};

// Granite Gargoyle — flying + "{R}: This creature gets +0/+1 until end of turn."
// (CR 702.9 flying, 611.1 temp P/T mod).
export const graniteGargoyle: CardDefinition = {
    id: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc",
    rarity: "rare",
    name: "Granite Gargoyle",
    oracleText: "Flying\n{R}: This creature gets +0/+1 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Gargoyle"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "granite-gargoyle-pump",
            oracleText: "{R}: This creature gets +0/+1 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const grayOgre: CardDefinition = {
    id: "73ae5276-b607-4f23-a9d2-e8cc7b8e3693",
    rarity: "common",
    name: "Gray Ogre",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Ogre"],
    power: 2,
    toughness: 2,
};

export const hillGiant: CardDefinition = {
    id: "0ddb98e8-13fe-4786-83f7-b72c56db135a",
    rarity: "common",
    name: "Hill Giant",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
};

export const hurloonMinotaur: CardDefinition = {
    id: "78a9088f-8755-47cb-aa93-51d992ccab90",
    rarity: "common",
    name: "Hurloon Minotaur",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Minotaur"],
    power: 2,
    toughness: 3,
};

// Ironclaw Orcs — "Ironclaw Orcs can't block creatures with power 2 or
// greater." (CR 509.1b block restriction, CR 613 layer 7c for effective
// power). The combat validator enriches P/T to post-layer values before
// calling the predicate, so `opponent.power` is already effective.
export const ironclawOrcs: CardDefinition = {
    id: "d56421a8-34ae-4033-943f-c59a7bf2b6f9",
    rarity: "common",
    name: "Ironclaw Orcs",
    oracleText: "Ironclaw Orcs can't block creatures with power 2 or greater.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "ironclaw-power-bound",
            side: "blocker" as const,
            // CR 509.1b — can't block power ≥ 2 (layer 7c via enrichment)
            predicate: (_self, opponent) => (opponent.power ?? 0) < 2,
            oracleText:
                "Ironclaw Orcs can't block creatures with power 2 or greater.",
        },
    ],
};

// Keldon Warlord — "Keldon Warlord's power and toughness are each equal to
// the number of other creatures you control." (CR 604.3 CDA, layer 7b). Same
// pt-cda shape as Nightmare; counts every creature controlled by source's
// controller, excluding the Warlord itself.
export const keldonWarlord: CardDefinition = {
    id: "8fe3fd83-969c-4add-888f-86f4306b067c",
    rarity: "uncommon",
    name: "Keldon Warlord",
    oracleText:
        "Keldon Warlord's power and toughness are each equal to the number of non-Wall creatures you control.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Barbarian"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state, ctx) => {
                let count = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.id !== source.id &&
                            ctx.isCreature(p)
                        ) {
                            count++;
                        }
                    }
                }
                return { power: count, toughness: count };
            },
        },
    ],
};

// Migrated resolve() → effects[] pilot (ADR 0045, issue #809; playbook in
// docs/agents/effect-script-migration.md). The entire effect is a single
// `dealDamage` Op on the announced target (CR 120.1) — the same Op already
// proven by Lava Spike (chk/red) and Prodigal Pyromancer (m11/red). The
// pre-existing per-card behaviour test (lea/__tests__/red.test.ts, "Lightning
// Bolt … CR 608.3") is the migration harness: green before, green after, with
// the assertions untouched, proves the DSL script preserves behaviour.
export const lightningBolt: CardDefinition = {
    id: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    rarity: "common",
    name: "Lightning Bolt",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    // AI combat hint (ADR 0021, issue #229): instant-speed creature removal the
    // bot models while held — a defender holding it can remove a blocker (or an
    // attacker) in combat, so over-committing into it is discounted.
    aiCombatHint: { removal: true },
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
};

// Mana Flare — "Whenever a player taps a land for mana, that player adds one
// mana of any type that land produced." (CR 603.2 PERMANENT_TAPPED trigger,
// 605 mana ability). Doubles the land's first produced color — current
// PERMANENT_TAPPED.manaProduced carries the activated ability's output, and
// we add one mana of the first non-zero color found there. Lands with only a
// single produced color (the LEA basics) hit the canonical case exactly.
export const manaFlare: CardDefinition = {
    id: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9",
    rarity: "rare",
    name: "Mana Flare",
    oracleText:
        "Whenever a player taps a land for mana, that player adds one mana of any type that land produced.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "mana-flare-extra",
            oracleText:
                "Whenever a player taps a land for mana, that player adds one mana of any type that land produced.",
            scope: "any",
            filter: { types: "Land" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                const produced = tapped.manaProduced ?? {};
                for (const [color, amount] of Object.entries(produced)) {
                    if (
                        color === "X" ||
                        typeof amount !== "number" ||
                        amount <= 0
                    )
                        continue;
                    ctx.addManaTo(tapped.controllerId, {
                        [color]: 1,
                    } as ManaCost);
                    return;
                }
            },
        }),
    ],
};

// Manabarbs — "Whenever a player taps a land for mana, this enchantment
// deals 1 damage to that player." (CR 603.2 PERMANENT_TAPPED trigger,
// 120.1 damage). The mana itself was already added when the tap fired —
// this is a pure penalty on top.
export const manabarbs: CardDefinition = {
    id: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8",
    rarity: "rare",
    name: "Manabarbs",
    oracleText:
        "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "manabarbs-damage",
            oracleText:
                "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
            scope: "any",
            filter: { types: "Land" },
            forMana: true,
            // NOT DSL-migratable (ADR 0045, issue #831): the damaged player is
            // read from the PERMANENT_TAPPED event (the tapping player), not the
            // ability's controller/opponent, so no EffectPlayerRef targets it.
            // Blocked on: event-player ref for tapped-land triggers.
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 1);
            },
        }),
    ],
};

export const monssGoblinRaiders: CardDefinition = {
    id: "b4eb3db3-6a7c-488a-9433-d5d1d3133816",
    rarity: "common",
    name: "Mons's Goblin Raiders",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
};

// Orcish Artillery — "{T}: Orcish Artillery deals 2 damage to any target and
// 3 damage to you." (CR 605 activated ability, 120.1 damage). Both damage
// events resolve in the same effect call — the self-damage is a normal
// damage to a player target (preventable / redirectable per CR 615), not
// life loss.
export const orcishArtillery: CardDefinition = {
    id: "a97208b1-a91b-4129-8a00-2f97b418accc",
    rarity: "uncommon",
    name: "Orcish Artillery",
    oracleText:
        "{T}: This creature deals 2 damage to any target and 3 damage to you.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "orcish-artillery-shoot",
            oracleText:
                "{T}: Orcish Artillery deals 2 damage to any target and 3 damage to you.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // Migrated resolve() → effects[] (ADR 0045, issue #831): two
            // `dealDamage` Ops (CR 120.1) — 2 to the announced target, then 3
            // to the ability's controller ("you"). Per-card test is the harness.
            effects: [
                { op: "dealDamage", amount: 2, to: { target: 0 } },
                { op: "dealDamage", amount: 3, to: { player: "controller" } },
            ],
        },
    ],
};

export const orcishOriflamme: CardDefinition = {
    id: "911538ea-322c-4c40-a9c3-35e47fe60fce",
    rarity: "uncommon",
    name: "Orcish Oriflamme",
    oracleText: "Attacking creatures you control get +1/+0.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                !!target.isAttacking &&
                target.controllerId === source.controllerId,
            power: 1,
            toughness: 0,
        },
    ],
};

// Power Surge — "At the beginning of each player's upkeep, Power Surge
// deals damage to that player equal to the number of untapped lands they
// control." (CR 603.6a phase trigger, 120.1 damage). APNAP not modeled —
// per-trigger event identifies the upkeep player via `activePlayerId`.
export const powerSurge: CardDefinition = {
    id: "62858604-ca5a-4f69-a045-a7515ebfabf2",
    rarity: "rare",
    name: "Power Surge",
    oracleText:
        "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn.",
    manaCost: { R: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "power-surge-damage",
            oracleText:
                "At the beginning of each player's upkeep, Power Surge deals damage to that player equal to the number of untapped lands they control.",
            phase: "UPKEEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045, issue #831): the damaged player is
            // the upkeep player (each-scope, event-derived), and the amount is a
            // count of that player's untapped lands — neither the dynamic player
            // nor an "untapped" filter is expressible. Blocked on: event-player
            // ref + tapped-state count filter.
            resolve: (ctx, _event, playerId) => {
                const landIds = ctx.getBattlefieldIds(playerId, {
                    types: "Land",
                });
                let untapped = 0;
                for (const id of landIds) {
                    if (!ctx.getIsTapped({ type: "permanent", id })) untapped++;
                }
                if (untapped > 0)
                    ctx.dealDamage({ type: "player", id: playerId }, untapped);
            },
        }),
    ],
};

// Raging River — pile combat (CR 509.2 variant, ADR 0012). When the
// controller's creatures attack, the defender divides their non-flying
// creatures into a "left" and "right" pile, then the attacker labels each
// attacker "left" or "right"; a labelled attacker can be blocked only by
// flying creatures or creatures in the matching pile. Modelled as two
// sequential `partition` choices (selected set = "left", complement =
// "right"): the defender's non-flying creatures, then the attackers. Each
// attacker's chosen label becomes a transient combatBlockRestriction consumed
// generically by the block validator. Single defending player, matching the
// rest of combat.
export const ragingRiver: CardDefinition = {
    id: "61e4f56d-1f4f-49f2-8534-0d09196a3327",
    rarity: "rare",
    name: "Raging River",
    oracleText:
        'Whenever one or more creatures you control attack, each defending player divides all creatures without flying they control into a "left" pile and a "right" pile. Then, for each attacking creature you control, choose "left" or "right." That creature can\'t be blocked this combat except by creatures with flying and creatures in a pile with the chosen label.',
    manaCost: { R: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "raging-river-piles",
            oracleText:
                'Whenever one or more creatures you control attack, each defending player divides all creatures without flying they control into a "left" pile and a "right" pile. Then, for each attacking creature you control, choose "left" or "right."',
            event: "ATTACKERS_DECLARED",
            matches: (event, self) => {
                if (event.type !== "ATTACKERS_DECLARED") return false;
                return (
                    event.attackingPlayerId === self.controllerId &&
                    event.attackerIds.length > 0
                );
            },
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKERS_DECLARED") return;
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!defenderId) return;

                // 1) Defender divides their non-flying creatures into piles
                //    (selected = "left", the rest = "right"). Flying creatures
                //    are not divided — they can block any pile anyway.
                const nonFlying = ctx.getBattlefieldIds(defenderId, {
                    types: "Creature",
                    excludeAbility: "flying",
                });
                if (nonFlying.length > 0) {
                    const leftPile = ctx.requestChoice({
                        playerId: defenderId,
                        choiceId: "partition-defenders",
                        kind: "partition",
                        zone: "battlefield",
                        zoneOwnerId: defenderId,
                        filter: { types: "Creature", excludeAbility: "flying" },
                        count: { min: 0, max: nonFlying.length },
                        prompt: 'Divide your non-flying creatures: select the "left" pile (the rest go "right").',
                    });
                    if (leftPile === undefined) return; // suspended
                    for (const id of nonFlying) {
                        ctx.setPileLabel(
                            id,
                            leftPile.includes(id) ? "left" : "right"
                        );
                    }
                }

                // 2) Attacker labels each attacking creature "left"/"right".
                const leftAttackers = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "label-attackers",
                    kind: "partition",
                    zone: "battlefield",
                    zoneOwnerId: ctx.controller,
                    filter: { types: "Creature", isAttacking: true },
                    count: { min: 0, max: event.attackerIds.length },
                    prompt: 'Label your attackers: select the "left" attackers (the rest are "right").',
                });
                if (leftAttackers === undefined) return; // suspended
                for (const attackerId of event.attackerIds) {
                    ctx.addCombatBlockRestriction(
                        attackerId,
                        leftAttackers.includes(attackerId) ? "left" : "right"
                    );
                }
            },
        },
    ],
};

export const redElementalBlast: CardDefinition = makeElementalBlast({
    id: "776ad9be-3309-4f1d-9f27-6219d9477662",
    rarity: "common",
    name: "Red Elemental Blast",
    oracleColor: "blue",
    castColor: "R",
    targetColor: "U",
});

export const rocOfKherRidges: CardDefinition = {
    id: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1",
    rarity: "rare",
    name: "Roc of Kher Ridges",
    oracleText: "Flying",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
};

export const rockHydra: CardDefinition = {
    id: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97",
    rarity: "rare",
    name: "Rock Hydra",
    oracleText:
        "This creature enters with X +1/+1 counters on it.\nFor each 1 damage that would be dealt to this creature, if it has a +1/+1 counter on it, remove a +1/+1 counter from it and prevent that 1 damage.\n{R}: Prevent the next 1 damage that would be dealt to this creature this turn.\n{R}{R}{R}: Put a +1/+1 counter on this creature. Activate only during your upkeep.",
    manaCost: { X: "X", R: 2 },
    types: ["Creature"],
    subtypes: ["Hydra"],
    power: 0,
    toughness: 0,
    entersWith: { counters: [{ type: "+1/+1", count: "X" }] },
    replacementEffects: [
        {
            id: "rock-hydra-counter-prevent",
            oracleText:
                "For each 1 damage that would be dealt to Rock Hydra, if it has a +1/+1 counter on it, remove a +1/+1 counter from it and prevent that 1 damage.",
            eventKind: "damage",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "permanent") return false;
                if (event.target.id !== self.id) return false;
                return (self.counters?.["+1/+1"] ?? 0) > 0;
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                const prevented = ctx.removeCounter("+1/+1", event.amount);
                if (prevented >= event.amount) {
                    return { kind: "consumed" };
                }
                return {
                    kind: "modified",
                    event: { ...event, amount: event.amount - prevented },
                };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "rock-hydra-prevent",
            oracleText:
                "{R}: Prevent the next 1 damage that would be dealt to Rock Hydra this turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventNextNDamageToTarget(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "rock-hydra-grow",
            oracleText:
                "{R}{R}{R}: Put a +1/+1 counter on Rock Hydra. Activate only during your upkeep.",
            cost: { mana: { R: 3 } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        },
    ],
};

export const sedgeTroll: CardDefinition = {
    id: "b13bf496-f3c0-4c13-8282-e7abfab6a198",
    rarity: "rare",
    name: "Sedge Troll",
    oracleText:
        "Sedge Troll gets +1/+1 as long as you control a Swamp.\n{B}: Regenerate Sedge Troll.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.subtypes.includes("Swamp")
                        ) {
                            return { power: 1, toughness: 1 };
                        }
                    }
                }
                return { power: 0, toughness: 0 };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "sedge-troll-regenerate",
            oracleText: "{B}: Regenerate Sedge Troll.",
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Shatter — "Destroy target artifact." (CR 701.7). Declarative shorthand via
// the shared destroy-target effect, same shape as Sinkhole / Disenchant.
export const shatter: CardDefinition = {
    id: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e",
    rarity: "common",
    name: "Shatter",
    oracleText: "Destroy target artifact.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    effect: "destroy-target",
};

// Shivan Dragon — flying + "{R}: This creature gets +1/+0 until end of turn."
// (CR 702.9 flying, 611.1 temp P/T mod).
export const shivanDragon: CardDefinition = {
    id: "fefbf149-f988-4f8b-9f53-56f5878116a6",
    rarity: "rare",
    name: "Shivan Dragon",
    oracleText: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, R: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 5,
    toughness: 5,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "shivan-dragon-pump",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Smoke — modern Oracle (Scryfall, ADR 0004): "Players can't untap more
// than one creature during their untap steps." (CR 502.1). Encoded as a
// data-driven `untapRestriction` (ADR 0002 / 0005) on the Creature filter
// with `maxUntap: 1`: the engine dispatcher collects the cap, computes the
// active player's tapped-creature eligible set, and either auto-resolves
// or enqueues an `untap-pick` `PendingChoice` ({ min: 0, max: 1 }) routed
// to the active player. Land and non-creature permanents are unaffected.
// Composes with Winter Orb's land cap — both restrictions fire
// independently in FIFO order during the same untap step.
export const smoke: CardDefinition = {
    id: "7c67788e-d713-47c3-ab9f-b8a6212ae24f",
    rarity: "rare",
    name: "Smoke",
    oracleText:
        "Players can't untap more than one creature during their untap steps.",
    manaCost: { R: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "smoke-creature-cap",
            oracleText: "Untap up to one creature (Smoke).",
            filter: { types: "Creature" },
            maxUntap: 1,
        }),
    ],
};

// Stone Giant — "{T}: Target creature you control with toughness less than
// Stone Giant's power gains flying until end of turn. Destroy that creature
// at the beginning of the next end step." (CR 113.1, 611.1b, 603.7a)
//
// getTargetRequirement computes a dynamic toughnessFilter from the source's
// current power. resolve grants flying EOT and schedules a delayed destroy.
const STONE_GIANT_ID = "7ffaedb9-25f8-4304-9085-e12505b93312";

export const stoneGiant: CardDefinition = {
    id: STONE_GIANT_ID,
    rarity: "uncommon",
    name: "Stone Giant",
    oracleText:
        "{T}: Target creature you control with toughness less than Stone Giant's power gains flying until end of turn. Destroy that creature at the beginning of the next end step.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 4,
    activatedAbilities: [
        {
            id: "stone-giant-fling",
            oracleText:
                "{T}: Target creature you control with toughness less than Stone Giant's power gains flying until end of turn. Destroy that creature at the beginning of the next end step.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                controller: "you" as const,
                toughnessFilter: { max: (source.power ?? 0) - 1 },
            }),
            // NOT DSL-migratable (ADR 0045, issue #831): grants flying until EOT
            // and schedules a delayed end-step destroy — both Ops
            // (`grantAbility`, `delayedTrigger`) are `planned`, not implemented.
            // Blocked on: `grantAbility` + `delayedTrigger` Ops.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "permanent") return;
                ctx.grantStaticAbility(target, "flying", {
                    phase: "end-of-turn",
                });
                ctx.scheduleDelayedTrigger(
                    STONE_GIANT_ID,
                    "stone-giant-destroy",
                    "next-end-step",
                    { targetId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "stone-giant-destroy",
            oracleText:
                "Destroy that creature at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.destroy({ type: "permanent", id: targetId });
            },
        },
    ],
};

// Stone Rain — "Destroy target land." (CR 701.7). Identical shape to Sinkhole
// modulo cost / type.
export const stoneRain: CardDefinition = {
    id: "57ff74cb-a2ed-4123-ac42-f72f9820049e",
    rarity: "common",
    name: "Stone Rain",
    oracleText: "Destroy target land.",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effect: "destroy-target",
};

// Tunnel — "Destroy target Wall." (CR 205.3 subtype filter, 701.7 destroy).
export const tunnel: CardDefinition = {
    id: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31",
    rarity: "uncommon",
    name: "Tunnel",
    oracleText: "Destroy target Wall. It can't be regenerated.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        subtypeFilter: "Wall",
    },
    effect: "destroy-target",
};

// Two-Headed Giant of Foriys — "Trample. Two-Headed Giant of Foriys can
// block an additional creature each combat." (CR 509.1a — multi-block).
// canBlockAdditional: 1 lets the combat validator allow blocking 2 attackers.
export const twoHeadedGiantOfForiys: CardDefinition = {
    id: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245",
    rarity: "rare",
    name: "Two-Headed Giant of Foriys",
    oracleText:
        "Trample\nTwo-Headed Giant of Foriys can block an additional creature each combat.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 4,
    staticAbilities: ["trample"],
    canBlockAdditional: 1,
};

// Uthden Troll — "{R}: Regenerate Uthden Troll." Same self-regen shape as
// Drudge Skeletons / Wall of Bone / Will-o'-the-Wisp.
export const uthdenTroll: CardDefinition = {
    id: "2ff21a6f-83a7-4bf3-a078-294e303232cc",
    rarity: "uncommon",
    name: "Uthden Troll",
    oracleText: "{R}: Regenerate this creature.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "uthden-troll-regenerate",
            oracleText: "{R}: Regenerate Uthden Troll.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Wall of Fire — defender + "{R}: This creature gets +1/+0 until end of turn."
// (CR 702.3 defender, 611.1 temp P/T mod).
export const wallOfFire: CardDefinition = {
    id: "efcf12cd-fb70-444e-9641-73ffa0e8f16e",
    rarity: "uncommon",
    name: "Wall of Fire",
    oracleText:
        "Defender (This creature can't attack.)\n{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 5,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-fire-pump",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const wallOfStone: CardDefinition = {
    id: "140e567c-6e4a-42b0-8084-d6c9695ae802",
    rarity: "uncommon",
    name: "Wall of Stone",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 8,
    staticAbilities: ["defender"],
};

// Wheel of Fortune — "Each player discards their hand, then draws seven
// cards." (CR 701.8, 121.1)
// Wheel of Fortune itself is on the stack during resolution, so it's not in
// the caster's hand to be discarded; after resolve() it goes to its owner's
// graveyard normally.
export const wheelOfFortune: CardDefinition = {
    id: "67b369c4-faa8-45c8-a1b9-98f228b69682",
    rarity: "rare",
    name: "Wheel of Fortune",
    oracleText: "Each player discards their hand, then draws seven cards.",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.forEachPlayer((pid) => {
            for (const cardId of ctx.getHandIds(pid)) {
                ctx.discardCard(pid, cardId);
            }
            ctx.drawCards(pid, 7);
        });
    },
};

// Disintegrate — {X}{R} Sorcery. "Disintegrate deals X damage to any target.
// If it's a creature, it can't be regenerated this turn, and if it would die
// this turn, exile it instead." (CR 614.1a — exile-on-death replacement)
export const disintegrate: CardDefinition = {
    id: "8712c49e-f171-4669-bed9-87575a37af11",
    rarity: "common",
    name: "Disintegrate",
    oracleText:
        "Disintegrate deals X damage to any target. If it's a creature, it can't be regenerated this turn, and if it would die this turn, exile it instead.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t) return;
        if (t.type === "permanent") {
            ctx.setExileOnDeath(t);
        }
        ctx.dealDamage(t, ctx.getX());
    },
};
