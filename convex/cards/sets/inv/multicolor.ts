// Invasion (INV) — multicolour (gold) cards, split by colour per ADR 0043.
// The registry's `import * as inv from "./sets/inv"` resolves through
// inv/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004).
//
// Invasion is the set that introduced the heavy multicolour theme (Domain,
// gold-card cycles); the walking-skeleton slice (parent PRD #1063) left this
// module empty ("sparse modules are accepted", ADR 0043). The Domain
// capability cluster (#1066) ships its two gold cards here.

import type { CardDefinition, Color, PermanentView } from "../../types";
import { AURA_AFFECTS_HOST, PERMANENT_TYPES } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Ordered Migration — {3}{W}{U} Sorcery. "Domain — Create a 1/1 blue Bird
// creature token with flying for each basic land type among lands you
// control." (CR 111 / 701.7 token creation, CR 702 preamble Domain ability
// word, issue #1066.) `createToken`'s `count` is the ninth EffectValue
// grammar member `{ domain: { of } }` — no arithmetic, a straight reuse of
// the same value member Tribal Flames uses for `dealDamage`.
export const orderedMigration: CardDefinition = {
    id: "04d83a07-6054-45f1-bdf9-07f2006238d2",
    name: "Ordered Migration",
    rarity: "uncommon",
    oracleText:
        "Domain — Create a 1/1 blue Bird creature token with flying for each basic land type among lands you control.",
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "createToken",
            token: {
                name: "Bird",
                types: ["Creature"],
                subtypes: ["Bird"],
                power: 1,
                toughness: 1,
                colors: ["U"],
                staticAbilities: ["flying"],
            },
            controller: "controller",
            count: { domain: { of: "controller" } },
        },
    ],
};

// Coalition Victory — {3}{W}{U}{B}{R}{G} Sorcery. "You win the game if you
// control a land of each basic land type and a creature of each color."
// (CR 104.2a alternate win, CR 702 preamble Domain ability word (the land
// clause), issue #1066.) The marquee win condition, 100% DSL:
//
//   - the LAND clause is exactly "Domain == 5" (all five basic types
//     present) — a single `{ domain: { of: "controller" } } >= 5` check,
//     reusing the ninth EffectValue grammar member rather than five separate
//     land-subtype `count`s;
//   - the COLOR clause has no equivalent single scalar (no "Domain for
//     colors" ability word exists), so it is five NESTED `if`s, each a
//     `count` over `{ zone: "battlefield", filter: { type: "Creature", color:
//     X } }` — the EXISTING count/filter construct (no new value member). A
//     multicolour creature satisfies every color clause it matches
//     (`ctx.getColors` — layer-5-aware, `gre/state.ts` `getBattlefieldIds`);
//     colourless creatures satisfy none.
//
// The `winGame` Op itself carries no predicate (CR 104.2a: "a player CAN win
// as a result of a spell or ability" — the calling card's `if` chain is the
// gate, not the Op). Checked ONCE at resolution (CR 608.2c — the spell's
// instructions run top to bottom exactly once; a board state that stops
// satisfying the predicate a moment later doesn't retroactively un-resolve
// the win).
export const coalitionVictory: CardDefinition = {
    id: "dd8ad3aa-3225-45ae-8343-5991f5b52269",
    name: "Coalition Victory",
    rarity: "rare",
    oracleText:
        "You win the game if you control a land of each basic land type and a creature of each color.",
    manaCost: { X: 3, W: 1, U: 1, B: 1, R: 1, G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "if",
            predicate: {
                left: { domain: { of: "controller" } },
                op: "ge",
                right: 5,
            },
            then: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Creature", color: "W" },
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            type: "Creature",
                                            color: "U",
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            count: {
                                                zone: "battlefield",
                                                controller: "controller",
                                                filter: {
                                                    type: "Creature",
                                                    color: "B",
                                                },
                                            },
                                        },
                                        op: "ge",
                                        right: 1,
                                    },
                                    then: [
                                        {
                                            op: "if",
                                            predicate: {
                                                left: {
                                                    count: {
                                                        zone: "battlefield",
                                                        controller:
                                                            "controller",
                                                        filter: {
                                                            type: "Creature",
                                                            color: "R",
                                                        },
                                                    },
                                                },
                                                op: "ge",
                                                right: 1,
                                            },
                                            then: [
                                                {
                                                    op: "if",
                                                    predicate: {
                                                        left: {
                                                            count: {
                                                                zone: "battlefield",
                                                                controller:
                                                                    "controller",
                                                                filter: {
                                                                    type: "Creature",
                                                                    color: "G",
                                                                },
                                                            },
                                                        },
                                                        op: "ge",
                                                        right: 1,
                                                    },
                                                    then: [
                                                        {
                                                            op: "winGame",
                                                            player: "controller",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — WU (issue #1075, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────

// Absorb — {W}{U}{U} Instant. "Counter target spell. You gain 3 life." (CR
// 701.5a counter, CR 119.3a life gain.) A plain two-Op sequence: `counter`
// removes the targeted spell from the stack, then `gainLife` on the
// resolving controller. MTGJSON INV.json: casting cost {W}{U}{U}.
export const absorb: CardDefinition = {
    id: "5d6a0f3e-457f-41f5-be26-5fb249874f1a",
    rarity: "rare",
    name: "Absorb",
    oracleText: "Counter target spell. You gain 3 life.",
    manaCost: { W: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        { op: "counter", target: { target: 0 } },
        { op: "gainLife", player: "controller", amount: 3 },
    ],
};

// Angelic Shield — {W}{U} Enchantment. "Creatures you control get +0/+1.
// Sacrifice this enchantment: Return target creature to its owner's hand."
// (CR 611/613 layer 7c controller-scoped anthem, precedent Vibrating Sphere
// `ice/colorless.ts`; CR 701.16 sacrifice cost, CR 400.7 zone move.) The
// static half is unconditional (unlike Vibrating Sphere's turn-gated pair) —
// a plain "creatures you control" `pt-buff` with no `condition`. The
// activated half pays sacrifice-self as its entire cost (no mana/tap,
// precedent Bottle of Suleiman `arn/colorless.ts`) and bounces an announced
// creature target to hand via `moveZone`.
export const angelicShield: CardDefinition = {
    id: "5aaa3e4e-4e08-4df2-9e0c-66e15a10fec4",
    rarity: "uncommon",
    name: "Angelic Shield",
    oracleText:
        "Creatures you control get +0/+1.\nSacrifice this enchantment: Return target creature to its owner's hand.",
    manaCost: { W: 1, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            power: 0,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "angelic-shield-bounce",
            oracleText:
                "Sacrifice this enchantment: Return target creature to its owner's hand.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Galina's Knight — {W}{U} Creature — Merfolk Knight, 2/2. "Protection from
// red." (CR 702.16 protection, `bindingPattern` in the Mechanics Registry.)
// Pure data — a vanilla body with one printed keyword, no activated/
// triggered abilities.
export const galinasKnight: CardDefinition = {
    id: "11b492d6-5e28-4f4b-942c-080d03cb0e92",
    rarity: "common",
    name: "Galina's Knight",
    oracleText: "Protection from red",
    manaCost: { W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from red"],
};

// Hanna, Ship's Navigator — {1}{W}{U} Legendary Creature — Human Artificer,
// 1/2. "{1}{W}{U}, {T}: Return target artifact or enchantment card from your
// graveyard to your hand." (CR 605 activated ability, CR 400.7 zone change.)
// Same shape as Argivian Archaeologist (`atq/white.ts`) — a graveyard-zone
// target filtered to an OR of two card types (`TargetRequirement.type`
// array, precedent c19/white.ts's Sevinne's Reclamation) — then a plain
// `moveZone` to hand.
export const hannaShipsNavigator: CardDefinition = {
    id: "83a4e48d-6452-4245-bdad-63fe3263550e",
    rarity: "rare",
    name: "Hanna, Ship's Navigator",
    oracleText:
        "{1}{W}{U}, {T}: Return target artifact or enchantment card from your graveyard to your hand.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "hanna-return",
            oracleText:
                "{1}{W}{U}, {T}: Return target artifact or enchantment card from your graveyard to your hand.",
            cost: { tap: true, mana: { X: 1, W: 1, U: 1 } },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Riptide Crab — {1}{W}{U} Creature — Crab, 1/3. "Vigilance. When this
// creature dies, draw a card." (CR 702.20b vigilance, CR 700.4/603.2 dies
// trigger, precedent Haywire Mite `bro/colorless.ts` — a direct DSL
// `triggeredAbilities[]` entry on `CREATURE_DIED` rather than the
// `resolve()`-only `diedTrigger` factory.)
export const riptideCrab: CardDefinition = {
    id: "7e42ae1d-62b4-4b19-aafc-f12bdd6fb8cc",
    rarity: "uncommon",
    name: "Riptide Crab",
    oracleText: "Vigilance\nWhen this creature dies, draw a card.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Crab"],
    power: 1,
    toughness: 3,
    staticAbilities: ["vigilance"],
    triggeredAbilities: [
        {
            id: "riptide-crab-dies-draw",
            oracleText: "When this creature dies, draw a card.",
            event: "CREATURE_DIED",
            matches: (event, self) =>
                event.type === "CREATURE_DIED" &&
                event.creatureInstanceId === self.id,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Samite Archer — {1}{W}{U} Creature — Human Cleric Archer, 1/1. "{T}:
// Prevent the next 1 damage that would be dealt to any target this turn.
// {T}: This creature deals 1 damage to any target." (CR 615.1 prevention
// shield, CR 120.1 damage.) Two independent tap-only activated abilities —
// exact precedent pair Samite Healer (`lea/white.ts`) + Prodigal Sorcerer
// (`lea/blue.ts`), fused onto one creature.
export const samiteArcher: CardDefinition = {
    id: "07a262d7-6d0c-43d0-89b6-9f46a1a9eb69",
    rarity: "uncommon",
    name: "Samite Archer",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to any target this turn.\n{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Archer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "samite-archer-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "samite-archer-zap",
            oracleText: "{T}: This creature deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// The five colours a "choose a color" enchantment picker offers, shared by
// Teferi's Moat (mirrors the local HARSH_JUDGMENT_COLORS array in
// `inv/white.ts` — kept local rather than exported since only one gold card
// needs it this tranche).
const TEFERIS_MOAT_COLORS = ["W", "U", "B", "R", "G"] as const;

// Teferi's Moat — {3}{W}{U} Enchantment. "As this enchantment enters, choose
// a color. Creatures of the chosen color without flying can't attack you."
// (CR 603.6b ETB colour choice via `modes` — precedent Harsh Judgment,
// `inv/white.ts`, `chosenModeId` read by a later predicate; CR 508.1c
// battlefield-scanned attack restriction — precedent Moat, `leg/white.ts`,
// `global-attack-restriction`.) DIRECTED at "you" (this enchantment's
// controller): the `forbids` predicate first excludes attackers already
// controlled by Teferi's Moat's own controller (a player's creatures never
// attack their own controller) before checking flying/colour, so — in this
// 2-player engine — only attacks against Teferi's Moat's controller are
// restricted, exactly as printed, with no separate "defending player" plumbing
// needed (CR 508.1c: the sole other player IS always the defending player
// whenever the attacker's controller differs from the enchantment's).
export const teferisMoat: CardDefinition = {
    id: "9ed5845c-ef6d-4a7b-b725-b09d3e9bbc17",
    rarity: "rare",
    name: "Teferi's Moat",
    oracleText:
        "As this enchantment enters, choose a color.\nCreatures of the chosen color without flying can't attack you.",
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Enchantment"],
    modes: TEFERIS_MOAT_COLORS.map((color) => ({
        id: color,
        label: color,
        oracleText:
            "Creatures of the chosen color without flying can't attack you.",
    })),
    staticEffects: [
        {
            kind: "global-attack-restriction",
            id: "teferis-moat-no-fly-chosen-color-cant-attack-you",
            forbids: (attacker: PermanentView, source, _state, ctx) => {
                if (attacker.controllerId === source.controllerId) {
                    return false;
                }
                const keywords =
                    (attacker as { staticAbilities?: string[] })
                        .staticAbilities ?? [];
                if (keywords.includes("flying")) return false;
                const chosenColor = (source as { chosenModeId?: string })
                    .chosenModeId;
                if (!chosenColor) return false;
                return ctx.getColors(attacker).includes(chosenColor as Color);
            },
            oracleText:
                "Creatures of the chosen color without flying can't attack you (Teferi's Moat).",
        },
    ],
};

// Wings of Hope — {W}{U} Enchantment — Aura. "Enchant creature. Enchanted
// creature gets +1/+3 and has flying." (CR 611 layer 7c static P/T + layer 6
// keyword-grant.) Exact shape precedent Wings of Aesthir (`ice/multicolor.ts`,
// also {W}{U}) — one `pt-buff` + one `keyword-grant`, both scoped to the aura
// host via the shared `AURA_AFFECTS_HOST` predicate.
export const wingsOfHope: CardDefinition = {
    id: "be0d2402-f1ef-4a71-ac01-c7099c4ce54c",
    rarity: "common",
    name: "Wings of Hope",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+3 and has flying.",
    manaCost: { W: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 3 },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Deferred (engine capability gaps) — WU (issue #1075)
// ─────────────────────────────────────────────────────────────────────────

// Armored Guardian — {3}{W}{U} Creature — Cat Soldier, 2/5. "{1}{W}{W}:
// Target creature you control gains protection from the color of your
// choice until end of turn. {1}{U}{U}: This creature gains shroud until end
// of turn." tracked-by: #1086 (same root cause as Glimmering Angel,
// `inv/white.ts`: `shroud` is `status: "planned"` in the Mechanics Registry —
// `grantAbility` would append the literal string "shroud" to
// `staticAbilities`, but no engine check anywhere reads a dynamically-granted
// "shroud" string, so granting it would be inert, the exact "shipped but
// dead" anti-pattern the registry census exists to catch. The FIRST ability
// alone is free (a straight `protectionColorModes` reuse, precedent Mother of
// Runes / Giver of Runes), but "never ship silent partials" (PRD #1063) means
// the whole card waits for the same hexproof-style `permanentGuard.ts`
// bridge before shipping either ability.)

// Kangee, Aerie Keeper — {2}{W}{U} Legendary Creature — Bird Wizard, 2/2.
// "Kicker {X}{2}. Flying. When Kangee enters, if it was kicked, put X
// feather counters on it. Other Bird creatures get +1/+1 for each feather
// counter on Kangee." tracked-by: #1097 (same root cause as Verdeloth the
// Ancient, `inv/green.ts`: `KickerCost.cost` is a FIXED `ManaCost` — there is
// no VARIABLE-amount kicker where the paid X is chosen once and read back as
// the kicker count. `entersWith.counters`' `count: "kicker"` reads a 0-or-1
// paid flag, not an arbitrary chosen X, so it cannot express "put X feather
// counters" for this shape.)

// Reviving Vapors — {2}{W}{U} Instant. "Reveal the top three cards of your
// library and put one of them into your hand. You gain life equal to that
// card's mana value. Put all other cards revealed this way into your
// graveyard." tracked-by: #1101 (the `digToHand` Op always bottoms its
// non-kept looked-at cards — issue #984's documented scope — with no
// destination parameter for "into the graveyard instead"; it also has no
// `bind` for the kept card, so there is no way to read that card's mana
// value back into a `gainLife` amount. Needs `digToHand` extended with an
// optional `destination` + `bind`, mirroring how `scryReorder` already has a
// `destination` discriminator for its own non-kept cards.)

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — UB (issue #1076, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────

// Recoil — {1}{U}{B} Instant. "Return target permanent to its owner's hand.
// Then that player discards a card." (CR 400.7 zone change, CR 701.9
// discard.) `moveZone`'s `bind` snapshots the bounced permanent's CONTROLLER
// before it leaves the battlefield (the same LKI snapshot Swords to
// Plowshares reads its target's power/controller from, `lea/white.ts`); the
// trailing `choice`(`choose-hand-card`) + `discard` pair reads that snapshot
// as "that player" — the shipped choose-then-discard shape (issue #805),
// just scoped to the chooser's OWN hand instead of an opponent's.
// FLAGGED SIMPLIFICATION (tracked: #1106): `moveZone`'s bind captures the
// target's CONTROLLER, not its OWNER, so "that player discards" resolves to
// the controller. This diverges from CR 400.7 ("return … to its OWNER's hand
// … that player discards") whenever a permanent is controlled by a non-owner
// and still targetable by Recoil — REACHABLE within INV itself via Spinal
// Embrace (steal a creature, then Recoil it → the wrong player discards). No
// `{ ownerOf }` `EffectPlayerRef` variant exists yet (#1106 adds it); flagged
// rather than silently assumed away.
export const recoil: CardDefinition = {
    id: "b6a77be3-e3b0-40f5-a470-414bac49da60",
    rarity: "common",
    name: "Recoil",
    oracleText:
        "Return target permanent to its owner's hand. Then that player discards a card.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
    },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "hand",
            bind: "$bounced",
        },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: { ref: "$bounced.controller" },
            zone: "hand",
            count: 1,
            prompt: "Discard a card (Recoil)",
            bind: "$picked",
        },
        {
            op: "discard",
            player: { ref: "$bounced.controller" },
            cards: { ref: "$picked" },
        },
    ],
};

// Sleeper's Robe — {U}{B} Enchantment — Aura. "Enchant creature. Enchanted
// creature has fear. Whenever enchanted creature deals combat damage to an
// opponent, you may draw a card." (CR 702.14b fear via `keyword-grant`
// scoped to the Aura's host (`AURA_AFFECTS_HOST`, precedent Sleeper's
// Robe-shaped grants throughout the catalogue); CR 510.4/603.2 combat-damage
// trigger.) The damage trigger is a RAW `triggeredAbilities[]` entry (not
// the `damageDealtTrigger` factory, which only offers `source: "self" /
// "yours" / "opponents" / "any"` — none of which express "the damage SOURCE
// is this Aura's HOST", since the Aura itself never deals damage) — a direct
// DSL `matches` closure keyed on `self.attachedTo`, mirroring how Riptide
// Crab (this same file) bypassed the resolve()-only `diedTrigger` factory
// for an analogous reason. The optional draw is a cost-free `mayPay` (issue
// #680) + `if` on its own outcome — no new Op.
export const sleepersRobe: CardDefinition = {
    id: "3411f0fd-8b85-4d0d-a202-701a24ffac9f",
    rarity: "uncommon",
    name: "Sleeper's Robe",
    oracleText:
        "Enchant creature\nEnchanted creature has fear. (It can't be blocked except by artifact creatures and/or black creatures.)\nWhenever enchanted creature deals combat damage to an opponent, you may draw a card.",
    manaCost: { U: 1, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "keyword-grant", applies: AURA_AFFECTS_HOST, keyword: "fear" },
    ],
    triggeredAbilities: [
        {
            id: "sleepers-robe-combat-damage-draw",
            oracleText:
                "Whenever enchanted creature deals combat damage to an opponent, you may draw a card.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                self.attachedTo !== undefined &&
                event.sourceInstanceId === self.attachedTo &&
                event.isCombat &&
                event.target.type === "player" &&
                event.target.id !== self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Draw a card (Sleeper's Robe)?",
                    bind: "$draw",
                },
                {
                    op: "if",
                    predicate: { binding: "$draw" },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
    ],
};

// Slinking Serpent — {2}{U}{B} Creature — Serpent, 2/3. "Forestwalk." (CR
// 702.15b landwalk.) Pure data — a vanilla body with one printed keyword.
export const slinkingSerpent: CardDefinition = {
    id: "070a7004-5a28-4ccb-8640-ad6b07b51ece",
    rarity: "uncommon",
    name: "Slinking Serpent",
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Serpent"],
    power: 2,
    toughness: 3,
    staticAbilities: ["forestwalk"],
};

// Spinal Embrace — {3}{U}{U}{B} Instant. "Cast this spell only during
// combat. Untap target creature you don't control and gain control of it.
// It gains haste until end of turn. At the beginning of the next end step,
// sacrifice it. If you do, you gain life equal to its toughness." (CR 601.3e
// cast-timing restriction via `castPhaseRestriction`, spanning every combat
// step, precedent Chaotic Strike `inv/red.ts`; CR 701.26 untap; CR 613.1b
// control change via `gainControl` with NO `duration` — an INDEFINITE
// reassignment, since the delayed trigger below removes the creature by
// sacrifice rather than a control-reversion condition; CR 611.1b temporary
// keyword grant for haste; CR 603.7 delayed trigger, ADR 0048.) The delayed
// body's `capture: { $creature: { target: 0 } }` carries only the
// INSTANCE ID across scheduling → fire (`resolveCaptureSource`); at FIRE
// TIME `runDelayedTriggerBody` re-snapshots the live permanent via
// `bindSnapshot` — so `$creature.toughness` reads the CURRENT toughness at
// the moment of sacrifice (CR 608.2h last-known information taken at the
// right instant), not a stale cast-time value. "If you do" is expressed by
// the shared existence gate: when the creature has already left the
// battlefield by fire time, the capture never binds and both the
// `sacrifice` and the following `gainLife` skip (CR 608.2b) — exactly
// "if you do" with no separate boolean needed, the same reasoning
// Swords to Plowshares' bind-then-read pair already relies on.
export const spinalEmbrace: CardDefinition = {
    id: "692ad1eb-62a3-4560-bf8e-35f7db73c7a3",
    rarity: "rare",
    name: "Spinal Embrace",
    oracleText:
        "Cast this spell only during combat.\nUntap target creature you don't control and gain control of it. It gains haste until end of turn. At the beginning of the next end step, sacrifice it. If you do, you gain life equal to its toughness.",
    manaCost: { X: 3, U: 2, B: 1 },
    types: ["Instant"],
    castPhaseRestriction: [
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
    ],
    targetRequirement: { type: "Creature", count: 1, controller: "opponent" },
    effects: [
        { op: "tapUntap", action: "untap", target: { target: 0 } },
        {
            op: "gainControl",
            target: { target: 0 },
            controller: "controller",
        },
        {
            op: "grantAbility",
            ability: "haste",
            target: { target: 0 },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText:
                "At the beginning of the next end step, sacrifice it. If you do, you gain life equal to its toughness.",
            capture: { $creature: { target: 0 } },
            effects: [
                { op: "sacrifice", target: { ref: "$creature" } },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$creature.toughness" },
                },
            ],
        },
    ],
};

// Stalking Assassin — {1}{U}{B} Creature — Human Assassin, 1/1. "{3}{U},
// {T}: Tap target creature. {3}{B}, {T}: Destroy target tapped creature."
// (CR 605 activated ability; CR 701.26 tap; CR 701.8 destroy filtered by
// `tappedFilter`.) Two independent tap-cost activated abilities, exact
// precedent pair Samite Archer (this same file).
export const stalkingAssassin: CardDefinition = {
    id: "ff8cc71f-3070-497f-908f-35aa13a8a857",
    rarity: "rare",
    name: "Stalking Assassin",
    oracleText:
        "{3}{U}, {T}: Tap target creature.\n{3}{B}, {T}: Destroy target tapped creature.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Assassin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "stalking-assassin-tap",
            oracleText: "{3}{U}, {T}: Tap target creature.",
            cost: { mana: { X: 3, U: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
        {
            id: "stalking-assassin-destroy",
            oracleText: "{3}{B}, {T}: Destroy target tapped creature.",
            cost: { mana: { X: 3, B: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                tappedFilter: "tapped",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Undermine — {U}{U}{B} Instant. "Counter target spell. Its controller
// loses 3 life." (CR 701.5a counter, CR 119.3b life loss.) A plain two-Op
// sequence, exact precedent shape Absorb (this same file) with `loseLife`
// in place of `gainLife` and `{ controllerOf }` in place of the resolving
// controller.
export const undermine: CardDefinition = {
    id: "2334bc71-5f85-47ff-b393-601a1e746a4e",
    rarity: "rare",
    name: "Undermine",
    oracleText: "Counter target spell. Its controller loses 3 life.",
    manaCost: { U: 2, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        { op: "counter", target: { target: 0 } },
        {
            op: "loseLife",
            player: { controllerOf: { target: 0 } },
            amount: 3,
        },
    ],
};

// Urborg Drake — {1}{U}{B} Creature — Drake, 2/3. "Flying. This creature
// attacks each combat if able." (CR 702.9b flying; CR 508.1d attack
// requirement via `staticEffects[]`, precedent Juggernaut `lea/colorless.ts`
// / Sengir Autocrat's counterpart `lea/black.ts`.)
export const urborgDrake: CardDefinition = {
    id: "97d1327e-bf87-423f-8a04-8124e45b9ae0",
    rarity: "uncommon",
    name: "Urborg Drake",
    oracleText: "Flying\nThis creature attacks each combat if able.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "attack-requirement",
            id: "urborg-drake-attacks-if-able",
            oracleText: "Urborg Drake attacks each combat if able.",
        },
    ],
};

// Vile Consumption — {1}{U}{B} Enchantment. "All creatures have 'At the
// beginning of your upkeep, sacrifice this creature unless you pay 1
// life.'" (CR 113.1/611 `triggered-grant` static effect granting a templated
// upkeep trigger to EVERY creature — either player's — exact precedent The
// Tabernacle at Pendrell Vale (`leg/colorless.ts`), generalized from a mana
// cost to a life cost.) UNLIKE Tabernacle's shared
// `payOrSacrificeUpkeepTrigger` factory (which is `resolve()`-only and takes
// a `ManaCost`, not a life payment), the granted template here is written as
// a RAW `TriggeredAbility` with `effects: EffectOp[]` — `mayPay(cost: {
// life: 1 })` + `if` + `sacrifice($source)` — so the grant stays DSL-first
// (ADR 0045) rather than reaching for a resolve()-only helper for a shape
// that already has full Op coverage. `$source` inside a GRANTED ability's
// body resolves to the CARRYING creature (the trigger collector scans/
// resolves `triggeredGrantTemplates` "as if printed on the target",
// `gre/state.ts`), not Vile Consumption itself — each creature's own
// controller decides at their own upkeep (CR 603.3b independent per-source
// triggers).
export const vileConsumption: CardDefinition = {
    id: "7f7e5716-77f3-45d2-a40a-f5bf500f6ad7",
    rarity: "rare",
    name: "Vile Consumption",
    oracleText:
        'All creatures have "At the beginning of your upkeep, sacrifice this creature unless you pay 1 life."',
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "triggered-grant",
            applies: (target: PermanentView) =>
                target.types.includes("Creature"),
            abilityId: "vile-consumption-upkeep",
        },
    ],
    triggeredGrantTemplates: [
        {
            id: "vile-consumption-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this creature unless you pay 1 life.",
            event: "PHASE_BEGIN",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { life: 1 },
                    prompt: "Pay 1 life or sacrifice this creature (Vile Consumption)?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ],
        },
    ],
};

// Vodalian Zombie — {U}{B} Creature — Merfolk Zombie, 2/2. "Protection from
// green." (CR 702.16 protection.) Pure data — a vanilla body with one
// printed keyword.
export const vodalianZombie: CardDefinition = {
    id: "f30a5a06-32ce-4d71-b71f-e3e1d8d4511a",
    rarity: "common",
    name: "Vodalian Zombie",
    oracleText: "Protection from green",
    manaCost: { U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Zombie"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from green"],
};

// ─────────────────────────────────────────────────────────────────────────
// Deferred (engine capability gaps) — UB (issue #1076)
// ─────────────────────────────────────────────────────────────────────────

// Barrin's Spite — {2}{U}{B} Sorcery. "Choose two target creatures
// controlled by the same player. Their controller chooses and sacrifices
// one of them. Return the other to its owner's hand." tracked-by: #1104 (no
// `TargetRequirement` field expresses a constraint BETWEEN two announced
// target slots — only per-slot filters against the CASTER exist. The
// consequence half is otherwise free: `optionChoice` with `player: {
// controllerOf: { target: 0 } }` and two modes — sac target 0 / bounce
// target 1, or vice versa — composes entirely from shipped Ops. Only the
// "controlled by the same player" TARGETING constraint is missing.)

// Lobotomy — {2}{U}{B} Sorcery. "Target player reveals their hand, then you
// choose a card other than a basic land card from it. Search that player's
// graveyard, hand, and library for all cards with the same name as the
// chosen card and exile them. Then that player shuffles." tracked-by: #1104
// (`EffectCardFilter.name` matches only a literal string — there is no way
// to filter by a NAME READ BACK from an earlier `choice` pick, and no single
// Op sweeps graveyard + hand + library simultaneously for a name match.)

// Seer's Vision — {2}{U}{B} Enchantment. "Your opponents play with their
// hands revealed. Sacrifice this enchantment: Look at target player's hand
// and choose a card from it. That player discards that card. Activate only
// as a sorcery." tracked-by: #1104 (no primitive tracks a PERSISTENT
// "plays with hand revealed" continuous condition — `reveal` is a one-shot
// Op, not a continuous one. Same root-cause gap already flagged inline,
// uncommented, for Enduring Renewal `ice/white.ts`, issue #628 — never
// given its own tracking issue until now.)
