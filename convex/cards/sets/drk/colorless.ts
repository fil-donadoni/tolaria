// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

// ═════════════════════════════════════════════════════════════════════════════
// Free tranche — Artifacts, Lands & colorless (#417). Every card here is data +
// resolve()/effect() closures over existing SpellContext primitives. Four small,
// orthogonal engine primitives were added for this batch (all reusable, none
// card-shaped): `skipNextUntap` (Barl's Cage), `addPlayerDamagePreventionShield`
// (Dark Sphere half-from-source + Scarecrow flying-source-all), and the
// `manaAmount`-from-counters read (City of Shadows). Costs/types/subtypes/P/T
// validated against MTGJSON data/json/DRK.json; modern Scryfall oracle text is
// authoritative (ADR 0004). Two cards are deferred at the foot of this section
// (Runesword, War Barge) — they need a "note a creature, destroy it if THIS
// leaves the battlefield this turn" delayed-self-LTB mechanism the engine lacks.
// ═════════════════════════════════════════════════════════════════════════════

// Barl's Cage — "{3}: Target creature doesn't untap during its controller's next
// untap step." (CR 605 activated ability; CR 302.6 / 502.1 one-shot
// untap-prevention via the `skipNextUntap` Op, cleared after exactly one untap
// step. DSL-first, ADR 0045 — announced-slot skin over SpellContext.skipNextUntap.)
export const barlsCage: CardDefinition = {
    id: "6768a307-da2e-435e-8efd-72d82b4d4a2b",
    rarity: "rare",
    name: "Barl's Cage",
    oracleText:
        "{3}: Target creature doesn't untap during its controller's next untap step.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "barls-cage-lock",
            oracleText:
                "{3}: Target creature doesn't untap during its controller's next untap step.",
            cost: { mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "skipNextUntap", target: { target: 0 } }],
        },
    ],
};

// Bone Flute — "{2}, {T}: All creatures get -1/-0 until end of turn." (CR 605
// activated ability; CR 611.2 / 613 layer 7c temporary P/T mod on every
// creature, scoped to end of turn. Mirrors Marsh Gas' all-creatures pump.)
export const boneFlute: CardDefinition = {
    id: "63a31de0-d764-4ff6-a85f-027e1e58d86c",
    rarity: "uncommon",
    name: "Bone Flute",
    oracleText: "{2}, {T}: All creatures get -1/-0 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "bone-flute-shrink",
            oracleText: "{2}, {T}: All creatures get -1/-0 until end of turn.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #840): all-creatures pump
            // → forEach over every battlefield's creatures, pump each -1/0 EOT
            // (CR 611.2).
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: -1,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Book of Rass — "{2}, Pay 2 life: Draw a card." (CR 605 activated ability;
// CR 118.4 life payment as part of the cost; CR 121.1 draw. Same shape as
// Greed.)
export const bookOfRass: CardDefinition = {
    id: "5a391ada-e9e3-45db-ae84-17421ac6b44d",
    rarity: "uncommon",
    name: "Book of Rass",
    oracleText: "{2}, Pay 2 life: Draw a card.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    subtypes: ["Book"],
    activatedAbilities: [
        {
            id: "book-of-rass-draw",
            oracleText: "{2}, Pay 2 life: Draw a card.",
            cost: { mana: { X: 2 }, life: 2 },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #832): controller draws
            // one card (CR 121.1).
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Dark Sphere — "{T}, Sacrifice this artifact: The next time a source of your
// choice would deal damage to you this turn, prevent half that damage, rounded
// down." (CR 605 activated ability; CR 615.1 one-shot, source-matched
// prevent-half shield via the new `addPlayerDamagePreventionShield`. The "source
// of your choice" is a permanent target — typically the attacker/burn source —
// scoped to the activating player.)
export const darkSphere: CardDefinition = {
    id: "72cfe9b9-677d-4ecb-83ab-67fb6481371d",
    rarity: "uncommon",
    name: "Dark Sphere",
    oracleText:
        "{T}, Sacrifice this artifact: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "dark-sphere-prevent-half",
            oracleText:
                "{T}, Sacrifice this artifact: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            // "A source of your choice" — any permanent (CR 609.7). The shield
            // matches that source instance and prevents half its next hit to
            // the activating player.
            targetRequirement: {
                type: "any",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                ctx.addPlayerDamagePreventionShield(
                    ctx.controller,
                    { sourceInstanceId: t.id },
                    "half-down",
                    { phase: "end-of-turn" },
                    1
                );
            },
        },
    ],
};

// Diabolic Machine — "{3}: Regenerate this creature." (CR 702.9 flying: n/a; CR 605
// activated ability; CR 701.19a regenerate via a shield consumed by the next
// destroy. Same shape as Clay Statue.)
export const diabolicMachine: CardDefinition = {
    id: "c3b0f228-6b06-4426-a557-1225d547b908",
    rarity: "uncommon",
    name: "Diabolic Machine",
    oracleText: "{3}: Regenerate this creature.",
    manaCost: { X: 7 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "diabolic-machine-regenerate",
            oracleText: "{3}: Regenerate this creature.",
            cost: { mana: { X: 3 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.19a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Fountain of Youth — "{2}, {T}: You gain 1 life." (CR 605 activated ability;
// CR 119.3 lifegain.)
export const fountainOfYouth: CardDefinition = {
    id: "2b60eb23-cb9a-4203-86fb-60e47dbd870b",
    rarity: "uncommon",
    name: "Fountain of Youth",
    oracleText: "{2}, {T}: You gain 1 life.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "fountain-of-youth-gain",
            oracleText: "{2}, {T}: You gain 1 life.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #832): controller gains
            // 1 life (CR 119.3).
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};

// Living Armor — "{T}, Sacrifice this artifact: Put X +0/+1 counters on target
// creature, where X is that creature's mana value." (CR 605 activated ability;
// CR 122.1 counters; CR 202.3 mana value of the targeted permanent. +0/+1 is a
// layer-7d P/T-modifying counter.)
export const livingArmor: CardDefinition = {
    id: "3c31a957-ad1e-40cc-b3c4-2f4caa492b77",
    rarity: "uncommon",
    name: "Living Armor",
    oracleText:
        "{T}, Sacrifice this artifact: Put X +0/+1 counters on target creature, where X is that creature's mana value.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "living-armor-counters",
            oracleText:
                "{T}, Sacrifice this artifact: Put X +0/+1 counters on target creature, where X is that creature's mana value.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // NOT DSL-migratable (ADR 0045): planned-migratable, blocked on a
            // value construct. The counter count X is the TARGET's mana value
            // (`getManaValue`), which the `count` grammar (battlefield/graveyard
            // card-set cardinality only) cannot express. Stays resolve() until
            // a mana-value value member exists.
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "permanent") return;
                const x = ctx.getManaValue(t);
                if (x > 0) ctx.addCounter(t, "+0/+1", x);
            },
        },
    ],
};

// Necropolis — "Defender\nExile a creature card from your graveyard: Put X +0/+1
// counters on this creature, where X is the exiled card's mana value." (CR 702.3 defender;
// CR 605 activated ability. `getManaValue` returns 0 for graveyard
// cards, so X is read from `getGraveyardCards`. CR 122.1 counters; +0/+1 is a
// layer-7d counter.)
//
// DIVERGENCE (flagged, tracked-by: #2232): "exile a creature card from your
// graveyard" is a COST (CR 118.1 / 601.2h) but is modeled here as a
// graveyard-card TARGET, so it is announced, re-checked on resolution, and can
// be made illegal in response. The old note claimed "the cost union has no
// graveyard-exile-as-cost field" — FALSE, corrected in the 2026-08-05 #1212
// audit: `cost.exileFromGraveyard` ships (Grim Lavamancer, Night Soil). What is
// genuinely missing is a snapshot of the cards that cost exiles, so the effect
// can read the exiled card's mana value — the mirror of
// `sacrificeSnapshotFromSelection` / `StackItem.additionalSacrificeSnapshot`.
export const necropolis: CardDefinition = {
    id: "893e8e9c-983e-4db1-8d93-10637025a559",
    rarity: "uncommon",
    name: "Necropolis",
    oracleText:
        "Defender (This creature can't attack.)\nExile a creature card from your graveyard: Put X +0/+1 counters on this creature, where X is the exiled card's mana value.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 1,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "necropolis-counters",
            oracleText:
                "Exile a creature card from your graveyard: Put X +0/+1 counters on this creature, where X is the exiled card's mana value.",
            cost: {},
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            // NOT DSL-migratable (ADR 0045): planned-migratable, blocked on a
            // value construct. The counter count X is the exiled graveyard
            // card's mana value (`getGraveyardCards` → `manaValue`), which the
            // `count` grammar cannot express. Stays resolve() until a mana-value
            // value member exists.
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "graveyard-card" || !t.playerId) return;
                const gc = ctx
                    .getGraveyardCards(t.playerId)
                    .find((c) => c.id === t.id);
                const x = gc?.manaValue ?? 0;
                ctx.moveCardById(t.playerId, t.id, "graveyard", "exile");
                if (x > 0) {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "+0/+1",
                        x
                    );
                }
            },
        },
    ],
};

// Reflecting Mirror — "{X}, {T}: Change the target of target spell with a single
// target if that target is you. The new target must be a player. X is twice the
// mana value of that spell." (CR 605 activated ability; CR 115.7 changing the
// target of a spell already on the stack — the ORIGINAL object, not a copy
// (distinct from Fork's copy-retarget). The ability targets the spell (which
// must be single-target and currently target you, CR 115.10), and {X} is forced
// to twice the targeted spell's mana value via `xFromTargetSpellMv` rather than
// player-chosen (CR 107.3). On resolution the new player target is chosen and
// written onto the original stack item via `requestRetarget`.)
export const reflectingMirror: CardDefinition = {
    id: "d551ff93-d8da-4c21-bc3c-6451c0dde07e",
    rarity: "uncommon",
    name: "Reflecting Mirror",
    oracleText:
        "{X}, {T}: Change the target of target spell with a single target if that target is you. The new target must be a player. X is twice the mana value of that spell.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "reflecting-mirror-retarget",
            oracleText:
                "{X}, {T}: Change the target of target spell with a single target if that target is you. The new target must be a player. X is twice the mana value of that spell.",
            cost: {
                mana: { X: "X" },
                tap: true,
                xFromTargetSpellMv: { multiplier: 2 },
            },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellSingleTargetingController: true,
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "spell") return;
                // CR 115.7 — the new target must be a player; the change is
                // applied to the original spell on the stack (not a copy).
                ctx.requestRetarget(target.id, { type: "player", count: 1 });
            },
        },
    ],
};

// Scarecrow — "{6}, {T}: Prevent all damage that would be dealt to you this turn
// by creatures with flying." (CR 605 activated ability; CR 615.1 per-player,
// source-keyword-matched prevent-all shield via `addPlayerDamagePreventionShield`
// matching the "flying" static ability, lasting the rest of the turn — high
// `remaining` so it prevents every flyer's hit, not just the first.)
export const scarecrow: CardDefinition = {
    id: "93850e74-744c-4261-a84e-01eaced6e49a",
    rarity: "uncommon",
    name: "Scarecrow",
    oracleText:
        "{6}, {T}: Prevent all damage that would be dealt to you this turn by creatures with flying.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Scarecrow"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "scarecrow-prevent-flying",
            oracleText:
                "{6}, {T}: Prevent all damage that would be dealt to you this turn by creatures with flying.",
            cost: { mana: { X: 6 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addPlayerDamagePreventionShield(
                    ctx.controller,
                    { sourceStaticAbility: "flying" },
                    "all",
                    { phase: "end-of-turn" },
                    // Prevents every flying-source damage event this turn.
                    999
                );
            },
        },
    ],
};

// Skull of Orm — "{5}, {T}: Return target enchantment card from your graveyard
// to your hand." (CR 605 activated ability; CR 400.7 graveyard→hand zone move.
// Same shape as Raise Dead, filtered to Enchantment cards in your graveyard.)
export const skullOfOrm: CardDefinition = {
    id: "aa1d9bb5-972a-4705-bf22-0fa1e974dd26",
    rarity: "uncommon",
    name: "Skull of Orm",
    oracleText:
        "{5}, {T}: Return target enchantment card from your graveyard to your hand.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "skull-of-orm-return",
            oracleText:
                "{5}, {T}: Return target enchantment card from your graveyard to your hand.",
            cost: { mana: { X: 5 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): return the
            // targeted graveyard enchantment card to its owner's hand
            // (CR 400.7).
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Standing Stones — "{1}, {T}, Pay 1 life: Add one mana of any color." (CR 605.1
// mana ability — resolves immediately, useStack: false, CR 605.3a; CR 106.1 mana
// of any color via `manaChoices`; CR 118.4 life payment as part of the cost.)
export const standingStones: CardDefinition = {
    id: "6d4c853e-2231-4af2-bcb0-1781c18ec3be",
    rarity: "uncommon",
    name: "Standing Stones",
    oracleText: "{1}, {T}, Pay 1 life: Add one mana of any color.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "standing-stones-mana",
            oracleText: "{1}, {T}, Pay 1 life: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Stone Calendar — "Spells you cast cost {1} less to cast." (CR 601.2f cost
// reduction; CR 118.7 generic-only reduction. A `cost-modifier` static scoped to
// the controller's own spells via `card.controllerId === effectSource.controllerId`.)
export const stoneCalendar: CardDefinition = {
    id: "a49ba1a5-33b1-40f2-9780-26139ed829d7",
    rarity: "rare",
    name: "Stone Calendar",
    oracleText: "Spells you cast cost {1} less to cast.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            // CR 601.2f — only the caster's own spells are reduced. The
            // effectSource is Stone Calendar; the spell's controllerId is the
            // caster.
            appliesToSpell: (card, _ctx, effectSource) =>
                !!effectSource &&
                card.controllerId === effectSource.controllerId,
            costReduction: { X: 1 },
        },
    ],
};

// Tormod's Crypt — "{T}, Sacrifice this artifact: Exile target player's
// graveyard." (CR 605 activated ability; CR 406 / 400.7 — move the whole target
// player's graveyard to exile via `moveZone`.)
export const tormodsCrypt: CardDefinition = {
    id: "0f9668ba-d26d-4484-b4b8-6fb91fbfb617",
    rarity: "uncommon",
    name: "Tormod's Crypt",
    oracleText:
        "{T}, Sacrifice this artifact: Exile target player's graveyard.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "tormods-crypt-exile-graveyard",
            oracleText:
                "{T}, Sacrifice this artifact: Exile target player's graveyard.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                ctx.moveZone(t.id, "graveyard", "exile");
            },
        },
    ],
};

// Tower of Coireall — "{T}: Target creature can't be blocked by Walls this turn."
// (CR 605 activated ability; CR 509.1b block restriction. The shipped
// `cant-be-blocked-by-subtype` until-EOT marker — same family as Tawnos's Wand's
// can't-be-blocked. Scoped to the Wall subtype.)
export const towerOfCoireall: CardDefinition = {
    id: "64c19977-ac7d-4ce7-925c-33a7503420f5",
    rarity: "uncommon",
    name: "Tower of Coireall",
    oracleText: "{T}: Target creature can't be blocked by Walls this turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "tower-of-coireall-evasion",
            oracleText:
                "{T}: Target creature can't be blocked by Walls this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.setCantBeBlockedBySubtypeThisTurn(t, "Wall");
                }
            },
        },
    ],
};

// Wand of Ith — DEFERRED (TODO(#417)). "{3}, {T}: Target player reveals a card
// at random from their hand. If it's a land card, that player discards it unless
// they pay 1 life. If it isn't a land card, the player discards it unless they
// pay life equal to its mana value. Activate only during your turn." Needs two
// primitives the engine does not ship: (a) a "reveal a card chosen AT RANDOM
// from a hand" pick using the seeded PRNG (the only random-from-hand surface is
// the `discardAtRandom` COST, which discards rather than reveals and targets the
// activating player's own hand), and (b) a may-PAY-LIFE prompt (`requestMayPay`
// only offers a mana cost; there is no life-payment prompt — every shipped
// "unless you pay N life" is a fixed-amount upkeep tax, not a per-card,
// mana-value-scaled prompt during resolution). Both are general primitives, not
// card-shaped; deferred until they land. NOT registered to keep the pool honest.

// City of Shadows — "{T}, Exile a creature you control: Put a storage counter on
// this land.\n{T}: Add {C} for each storage counter on this land." (CR 605
// activated abilities. The first's "Exile a creature you control" is modeled as
// a creature TARGET you control (benign timing simplification, flagged: the cost
// union has no exile-a-permanent cost). The second is a mana ability whose
// colorless output is computed from the source's storage counters via
// `manaAmount`, CR 106.1 / 605.1a.)
export const cityOfShadows: CardDefinition = {
    id: "76e5ee8a-34e5-4a2e-a04e-9fcdc7e53dda",
    rarity: "rare",
    name: "City of Shadows",
    oracleText:
        "{T}, Exile a creature you control: Put a storage counter on this land.\n{T}: Add {C} for each storage counter on this land.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "city-of-shadows-store",
            oracleText:
                "{T}, Exile a creature you control: Put a storage counter on this land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            // CR 701.13 exile the target creature, then CR 122 put one storage
            // counter on the source (issue #841).
            effects: [
                { op: "exile", target: { target: 0 } },
                {
                    op: "counters",
                    action: "add",
                    counter: "storage",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
        {
            id: "city-of-shadows-mana",
            oracleText: "{T}: Add {C} for each storage counter on this land.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
            // CR 106.1 — colorless equal to the number of storage counters,
            // read off the source PermanentView's counters at activation.
            manaAmount: (source) => ({
                C: source.counters?.storage ?? 0,
            }),
        },
    ],
};

// Maze of Ith — "{T}: Untap target attacking creature. Prevent all combat damage
// that would be dealt to and dealt by that creature this turn." (CR 605 activated
// ability; CR 701.26b untap; CR 615.1 / Ebony Horse-style
// `preventAllCombatDamageToAndBy`. Untapping an attacker does NOT remove it from
// combat, CR 506.4c — the prevention is what neutralizes it.)
export const mazeOfIth: CardDefinition = {
    id: "42dcceee-2a47-4eaa-a6a3-2931b3d50244",
    rarity: "uncommon",
    name: "Maze of Ith",
    oracleText:
        "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "maze-of-ith-neutralize",
            oracleText:
                "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            // Migrated resolve()→effects[] (ADR 0045, #845): untap the target
            // (tapUntap) then arm the two-way combat-damage prevention shield
            // (preventDamage "combat-to-and-by", CR 615). Two Ops, same order.
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                {
                    op: "preventDamage",
                    mode: "combat-to-and-by",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Safe Haven — "{2}, {T}: Exile target creature you control.\nAt the beginning of
// your upkeep, you may sacrifice this land. If you do, return each card exiled
// with this land to the battlefield under its owner's control." (CR 605 activated
// ability that exiles a creature you control with an exile-and-return bundle
// keyed to the source via `exileForSource`; CR 603 upkeep trigger that, on
// sacrifice, returns the bundled cards via `returnExiledForSource`.)
export const safeHaven: CardDefinition = {
    id: "0d48fb47-1bed-4791-a014-504515f3d36f",
    rarity: "rare",
    name: "Safe Haven",
    oracleText:
        "{2}, {T}: Exile target creature you control.\nAt the beginning of your upkeep, you may sacrifice this land. If you do, return each card exiled with this land to the battlefield under its owner's control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "safe-haven-exile",
            oracleText: "{2}, {T}: Exile target creature you control.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            // CR 603.7a / ADR 0028 — exile the announced creature keyed to
            // `$source`; the upkeep trigger returns each bundled card via
            // `returnExiledForSource`. `includeAttachments: true` (the primitive
            // default this closure relied on) bundles the creature's Auras/
            // Equipment; `returnTapped` defaults false — Safe Haven returns
            // creatures untapped (no "tapped" clause).
            effects: [
                {
                    op: "exileWithAttachments",
                    target: { target: 0 },
                    includeAttachments: true,
                },
            ],
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "safe-haven-return",
            oracleText:
                "At the beginning of your upkeep, you may sacrifice this land. If you do, return each card exiled with this land to the battlefield under its owner's control.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 603.3 — "you may sacrifice"; on yes, sacrifice and return
                // the bundled cards (CR 110.2 — under each owner's control).
                const doIt = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `safe-haven-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice Safe Haven to return the exiled creatures?",
                });
                if (doIt === undefined) return; // suspended
                if (!doIt) return;
                ctx.returnExiledForSource(ctx.sourceInstanceId);
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Deferred — these four DRK White cards each need a genuinely new engine
// capability that the free tranche does NOT ship. They are intentionally NOT
// registered yet (no exported CardDefinition) to keep the card pool honest; the
// definitions land with their mechanic. Flagged in the PR. TODO(#411):
//
//   • Brainwash (Aura) — "Enchanted creature can't attack unless its controller
//     pays {3}." Needs an ATTACK TAX (an optional mana cost to declare a
//     creature as an attacker), sourced from an aura attached to the creature.
//     The shipped `attack-restriction` static is a hard predicate, not a cost,
//     and is read only from the creature's own definition (not its auras).
//
//   • Blood of the Martyr (Instant) — "Until end of turn, if damage would be
//     dealt to any creature, you may have that damage dealt to you instead."
//     Needs a turn-wide, ANY-creature, OPTIONAL damage-redirection shield. The
//     shipped redirect shields are one-shot and bound to a specific target
//     instance; none covers "every creature, repeatedly, may-redirect".
//
//   • Festival (Instant) — "Cast this spell only during an opponent's upkeep.
//     Creatures can't attack this turn." Needs (a) a CAST-TIMING restriction
//     ("only during an opponent's upkeep" — no casting-timing mechanism exists)
//     and (b) a turn-scoped GLOBAL "creatures can't attack" flag.
//
//   • Cleansing (Sorcery) — "For each land, destroy that land unless any player
//     pays 1 life." Needs a per-land loop offering EVERY player (APNAP) the
//     option to PAY LIFE to save it. `requestMayPay` pays mana for a single
//     player; there is no life-payment option primitive and no any-player loop.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Deferred — two DRK BLUE cards (#412) each need an unbuilt engine capability
// that the free tranche does NOT ship. Intentionally NOT registered (no exported
// CardDefinition) to keep the pool honest; flagged in the PR. TODO(#412):
//
//   • Leviathan (Creature) — "Trample\nThis creature enters tapped and doesn't
//     untap during your untap step.\nAt the beginning of your upkeep, you may
//     sacrifice two Islands. If you do, untap this creature.\nThis creature
//     can't attack unless you sacrifice two Islands. (This cost is paid as
//     attackers are declared.)" Every clause but the last is free-tranche
//     (entersTapped + `does-not-untap` keyword + may-pay-to-untap upkeep
//     trigger — the Island Fish Jasconius template). The last clause is an
//     ATTACK COST: sacrificing two Islands as a cost paid WHEN attackers are
//     declared. `attack-restriction` is a pure board predicate (no cost
//     payment), and `validateAttackerEligibility` has no cost-payment plumbing
//     at declaration. Shipping Leviathan without an enforced attack cost would
//     be a free attacker — defer the whole card until the attack-cost primitive
//     lands.
//
//   • Tangle Kelp (Aura) — "Enchant creature\nWhen this Aura enters, tap
//     enchanted creature.\nEnchanted creature doesn't untap during its
//     controller's untap step if it attacked during its controller's last
//     turn." The ETB tap is free-tranche, but the untap-prevention is
//     CONDITIONAL on "attacked during its controller's LAST turn" — a
//     cross-turn attack history that the engine does not persist
//     (`hasAttackedThisTurn` is cleared at every CLEANUP) — AND it must be a
//     conditional, host-scoped untap restriction re-evaluated each untap step
//     (the `does-not-untap` keyword is unconditional; `keyword-grant` applies
//     once at attach, not per-step). Both are unbuilt; defer the whole card.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// C3 — Mana-production lookup / replacement (#420). Three cards that read or
// rewrite mana production rather than producing fixed mana. They reuse the
// existing mana-ability machinery generalized along two new, orthogonal axes:
//   • board-conditional mana CHOICES (`getManaChoices`) — the choice analog of
//     the shipped board-conditional `manaAmount` (Urza lands). Fellwar Stone.
//   • a per-turn land-mana TYPE replacement (`replaceLandManaWithBlue`, CR 614)
//     funnelled through the single `applyLandManaReplacement` hook every tap
//     path already routes its produced mana through. Deep Water.
//   • a generic hand → battlefield zone move (`putFromHandOntoBattlefield`,
//     CR 400.7), mirroring `putFromLibraryOntoBattlefield`. Gaea's Touch.
// ─────────────────────────────────────────────────────────────────────────────

// Fellwar Stone — "{T}: Add one mana of any color that a land an opponent
// controls could produce." (CR 605.1a mana ability; CR 106.4 "could produce".
// The colour set is board-derived, so the ability declares a `manaColorSource`
// descriptor — the DATA form of the `getManaChoices` hook, itself the choice
// analog of the Urza lands' `manaAmount` — evaluated by the engine at every
// activation against every opponent's lands. The static `manaChoices` is the
// representative / fallback list for best-effort callers without a board
// snapshot (affordability, autoTap).)
export const fellwarStone: CardDefinition = {
    id: "dc47e322-f8b8-4685-b035-fda0cc433e6b",
    rarity: "uncommon",
    name: "Fellwar Stone",
    oracleText:
        "{T}: Add one mana of any color that a land an opponent controls could produce.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "fellwar-stone-mana",
            oracleText:
                "{T}: Add one mana of any color that a land an opponent controls could produce.",
            cost: { tap: true },
            useStack: false,
            // Fallback / representative options (any single colour). The engine
            // overrides this with `manaColorSource` when a board snapshot exists.
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // CR 106.4 — "any color a land an opponent controls could produce":
            // union the producible colours of every LAND controlled by a player
            // other than Fellwar Stone's controller, then offer one mana of each
            // (colourless {C} is not a colour and never contributes, CR 202.2).
            // Empty when no opponent controls a colour-producing land — the
            // ability stays activatable per CR 605.1a but yields no legal
            // choice, so no false affordance is offered.
            manaColorSource: {
                filter: { types: "Land", controllerRelation: "opponents" },
                colors: "produces",
            },
        },
    ],
};

// Coal Golem — "{3}, Sacrifice this creature: Add {R}{R}{R}." (CR 605.1a mana
// ability with a {3} + self-sacrifice cost — the Gaea's Touch sacrifice-for-mana
// shape, resolves immediately.)
export const coalGolem: CardDefinition = {
    id: "1ad7692d-5a51-493f-a322-7b615446ea8e",
    rarity: "uncommon",
    name: "Coal Golem",
    oracleText: "{3}, Sacrifice this creature: Add {R}{R}{R}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "coal-golem-sacrifice-mana",
            oracleText: "{3}, Sacrifice this creature: Add {R}{R}{R}.",
            cost: { mana: { X: 3 }, sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 3 }),
            manaProduced: { R: 3 },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C9 — Swap blockers (Sorrow's Path, PRD #409 / issue #426)
// ─────────────────────────────────────────────────────────────────────────────
//
// Sorrow's Path — "{T}: Choose two target blocking creatures controlled by the
// same opponent. If each of those creatures could block all creatures that the
// other is blocking, remove both of them from combat. Each one then blocks all
// creatures the other was blocking.\nWhenever this land becomes tapped, it deals
// 2 damage to you and each creature you control."
//
// Two abilities, both reusing shipped primitives — no Sorrow's-Path-shaped
// engine code:
//
//   1. Block reassignment (activated, {T}). The "two blocking creatures" choice
//      is a plain `targetRequirement` (count 2, `combatRoleFilter: "blocking"`,
//      `controller: "opponent"`). In a 2-player game there is exactly one
//      opponent, so "controlled by the same opponent" is already guaranteed by
//      `controller: "opponent"` (no cross-target same-controller constraint
//      needed). The swap-and-legality clause is the generic
//      `ctx.reassignBlocks(a, b)` combat primitive (CR 509.1 / 506.4): it reads
//      each blocker's assigned attacker set, verifies — via the same
//      `validateBlockerEligibility` the declare-blockers step uses — that each
//      could legally block the OTHER's set, and only then swaps. If the legality
//      gate fails it is a no-op, matching the card's "if each ... could block
//      all creatures the other is blocking" hard condition.
//
//   2. On-tap drawback (triggered, becomes-tapped). `tappedTrigger` scoped to
//      `self` (CR 701.20a). The "2 damage to you and each creature you control"
//      decomposes into `dealDamage` to the controller plus a loop over the
//      controller's creatures (`getBattlefieldIds` filtered to Creatures) —
//      reuse, no new sweep primitive. CR 120 damage path so prevention /
//      replacement effects apply. NB: tapping for the activated ability ALSO
//      fires this trigger (the cost taps the land → PERMANENT_TAPPED), which is
//      exactly the printed self-punishing interaction.
export const sorrowsPath: CardDefinition = {
    id: "6f75946b-1690-43cc-993c-d4e451a1a41c",
    rarity: "rare",
    name: "Sorrow's Path",
    oracleText:
        "{T}: Choose two target blocking creatures controlled by the same opponent. If each of those creatures could block all creatures that the other is blocking, remove both of them from combat. Each one then blocks all creatures the other was blocking.\nWhenever this land becomes tapped, it deals 2 damage to you and each creature you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "sorrows-path-swap-blockers",
            oracleText:
                "{T}: Choose two target blocking creatures controlled by the same opponent. If each of those creatures could block all creatures that the other is blocking, remove both of them from combat. Each one then blocks all creatures the other was blocking.",
            cost: { tap: true },
            useStack: true,
            // CR 509.1 — both targets must be blocking; `controller: "opponent"`
            // covers "controlled by the same opponent" in 2-player (one opp).
            targetRequirement: {
                type: "Creature",
                count: 2,
                combatRoleFilter: "blocking",
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const [a, b] = ctx.targets;
                if (a?.type !== "permanent" || b?.type !== "permanent") return;
                // The whole legality gate + atomic swap lives in the primitive
                // (CR 509.1 / 506.4); a failed gate is a clean no-op.
                ctx.reassignBlocks(a.id, b.id);
            },
        },
    ],
    triggeredAbilities: [
        tappedTrigger({
            id: "sorrows-path-tap-drawback",
            oracleText:
                "Whenever this land becomes tapped, it deals 2 damage to you and each creature you control.",
            // CR 701.26a — fires when THIS permanent becomes tapped (including
            // when its own {T} cost taps it).
            scope: "self",
            // NOT DSL-migratable (ADR 0045): built via the `tappedTrigger`
            // factory, which owns the `resolve` closure and exposes no
            // `effects[]` site. The body itself is a clean forEach + dealDamage,
            // but the factory wrapper blocks it. Stays resolve() until the
            // trigger factories accept effects.
            resolve: (ctx) => {
                // CR 120 — "you" = the controller; then each creature the
                // controller controls. Both go through the normal damage path.
                ctx.dealDamage({ type: "player", id: ctx.controller }, 2);
                const myCreatures = ctx.getBattlefieldIds(ctx.controller, {
                    types: "Creature",
                });
                for (const id of myCreatures) {
                    ctx.dealDamage({ type: "permanent", id }, 2);
                }
            },
        }),
    ],
};
