// Invasion (INV) — multicolour (gold) cards, split by colour per ADR 0043.
// The registry's `import * as inv from "./sets/inv"` resolves through
// inv/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004).
//
// Invasion is the set that introduced the heavy multicolour theme (Domain,
// gold-card cycles); the walking-skeleton slice (parent PRD #1063) left this
// module empty ("sparse modules are accepted", ADR 0043). The Domain
// capability cluster (#1066) ships its two gold cards here.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    Color,
    EffectOp,
    PermanentView,
    StaticKeywordGrant,
    CardPrint,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    EFFECT_AFFECTS_SELF,
    PERMANENT_TYPES,
} from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

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
// of turn." tracked-by: #1086 — UNBLOCKED (PR #2040, issue #959): same root
// cause as Glimmering Angel (`inv/white.ts`) — `shroud` is now `status:
// "implemented"` in the Mechanics Registry, and `gre/permanentGuard.ts`'s
// `isGuardedAgainst` bridges a dynamically-granted "shroud" string (the
// `hasShroud` helper, mirroring the existing `hexproof` bridge) so
// `grantAbility` appending the literal string to `staticAbilities` is
// enforced live, no longer inert. The engine-level gap that blocked BOTH
// abilities is closed; the card is still a STUB in this pass (out of scope
// for the shroud-bridge slice) — a future pass can ship the FIRST ability
// (a straight `protectionColorModes` reuse, precedent Mother of Runes /
// Giver of Runes) and the second (a `grantAbility` DSL body over
// "shroud") together, per "never ship silent partials" (PRD #1063).

// Kangee, Aerie Keeper — {2}{W}{U} Legendary Creature — Bird Wizard, 2/2.
// "Kicker {X}{2}. Flying. When Kangee enters, if it was kicked, put X
// feather counters on it. Other Bird creatures get +1/+1 for each feather
// counter on Kangee." tracked-by: #1097 (same root cause as Verdeloth the
// Ancient, `inv/green.ts`: `KickerCost.cost` is a FIXED `ManaCost` — there is
// no VARIABLE-amount kicker where the paid X is chosen once and read back as
// the kicker count. `entersWith.counters`' `count: "kicker"` reads a 0-or-1
// paid flag, not an arbitrary chosen X, so it cannot express "put X feather
// counters" for this shape.)

// ─────────────────────────────────────────────────────────────────────────
// digToHand destination + bind cluster (issue #1101)
// ─────────────────────────────────────────────────────────────────────────

// Reviving Vapors — {2}{W}{U} Instant. "Reveal the top three cards of your
// library and put one of them into your hand. You gain life equal to that
// card's mana value. Put all other cards revealed this way into your
// graveyard." (CR 401.4 look, CR 202.3 mana value, issue #1101.) Ships as a
// straight DSL card once `digToHand` grows a `destination` discriminator
// (mirrors `scryReorder`'s own `library-bottom`/`graveyard` split) and a
// `bind` (mirrors `destroy`/`exile`'s SNAPSHOT-family object bind) for the
// kept card: `digToHand` looks 3, keeps 1, sends the other 2 straight to the
// graveyard (`destination: "graveyard"`), and snapshot-binds the kept card as
// `$kept`; the trailing `gainLife` reads `manaValue: { of: { ref: "$kept" } }`
// to size the life gain off that card's mana value (CR 202.3b — an {X} in a
// library card's cost counts as 0, per the card's own ruling).
export const revivingVapors: CardDefinition = {
    id: "47a23c32-e122-400b-b252-e636ea2e684b",
    name: "Reviving Vapors",
    rarity: "uncommon",
    oracleText:
        "Reveal the top three cards of your library and put one of them into your hand. You gain life equal to that card's mana value. Put all other cards revealed this way into your graveyard.",
    manaCost: { generic: 2, W: 1, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "digToHand",
            player: "controller",
            look: 3,
            take: 1,
            // "REVEAL the top three cards" (CR 701.20a) — the whole window is
            // public: every player sees all three in the reveal dialog.
            reveal: "window",
            destination: "graveyard",
            bind: "$kept",
        },
        {
            op: "gainLife",
            player: "controller",
            amount: { manaValue: { of: { ref: "$kept" } } },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — UB (issue #1076, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────

// Recoil — {1}{U}{B} Instant. "Return target permanent to its owner's hand.
// Then that player discards a card." (CR 400.7 zone change, CR 701.9
// discard.) `moveZone`'s `bind` snapshots the bounced permanent's OWNER
// before it leaves the battlefield (the same LKI snapshot Swords to
// Plowshares reads its target's power/controller from, `lea/white.ts`, now
// also carrying an owner slot — issue #1106); the trailing
// `choice`(`choose-hand-card`) + `discard` pair reads that snapshot's
// `.owner` as "that player" — the shipped choose-then-discard shape (issue
// #805), just scoped to the chooser's OWN hand instead of an opponent's.
// FIXED (issue #1106): previously read `$bounced.controller`, which
// diverges from CR 400.7's OWNER whenever a permanent is controlled by a
// non-owner and still targetable by Recoil — reachable within INV itself via
// Spinal Embrace (steal a creature, then Recoil it). `.owner` is immutable
// (CR 108.3) so it always names the correct discarder regardless of who
// currently controls the bounced permanent.
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
            player: { ref: "$bounced.owner" },
            zone: "hand",
            count: 1,
            prompt: "Discard a card (Recoil)",
            bind: "$picked",
        },
        {
            op: "discard",
            player: { ref: "$bounced.owner" },
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
// UB engine gaps, closed (issue #1104, parent #1076)
// ─────────────────────────────────────────────────────────────────────────

// Barrin's Spite — {2}{U}{B} Sorcery. "Choose two target creatures
// controlled by the same player. Their controller chooses and sacrifices
// one of them. Return the other to its owner's hand." (CR 601.2c cross-slot
// same-controller constraint, issue #1104 gap 1.) `targetRequirement.
// sameController: true` is the new TargetRequirement field spanning both
// announced slots — checked at both legality-scan (`getLegalTargets`) and
// selection (`selectTarget`) via the single-authority target-filter
// registry (ADR 0068, `gre/targetFilters.ts`).
//
// The consequence is a `choice` NARROWED TO THE ANNOUNCED TARGETS
// (`candidates: [{ target: 0 }, { target: 1 }]`) whose complement is bound by
// `bindOther`. It was first written as an `optionChoice` with two prose modes
// ("sacrifice the FIRST creature; return the SECOND…"), which is unusable at
// the table: nothing on the board says which of the two creatures is "first",
// so the controller was asked to pick blind. Now they click the creature they
// are sacrificing — the same gesture every other sacrifice uses — and
// `$spared` names the one left over, which no announced slot can (which slot
// it is depends on the choice).
//
// `player: { controllerOf: { target: 0 } }` is their controller — both targets
// share one (`sameController`), so either slot names them.
export const barrinsSpite: CardDefinition = {
    id: "6d8ec4dc-c74a-4d49-856e-95703675fe9b",
    name: "Barrin's Spite",
    rarity: "rare",
    oracleText:
        "Choose two target creatures controlled by the same player. Their controller chooses and sacrifices one of them. Return the other to its owner's hand.",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 2, sameController: true },
    effects: [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player: { controllerOf: { target: 0 } },
            zone: "battlefield",
            candidates: [{ target: 0 }, { target: 1 }],
            count: 1,
            prompt: "Choose which of the two creatures to sacrifice",
            bind: "$sacrificed",
            bindOther: "$spared",
        },
        { op: "sacrifice", permanents: { ref: "$sacrificed" } },
        // "Return THE OTHER to its owner's hand" — `$spared` is the candidate
        // that wasn't picked. Uncaptured (and therefore skipped, CR 608.2b)
        // if only one of the two creatures was still on the battlefield when
        // the choice was raised, which is exactly right: there is no "other".
        { op: "moveZone", target: { ref: "$spared" }, to: "hand" },
    ],
};

// lobotomy — INV reprint of the Tempest definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `tmp/multicolor.ts`.
export const lobotomyInv: CardPrint = {
    printId: "ff307dbb-4ab6-457b-be56-47106864bf61", // INV 258
    definitionId: "ee7ba92d-d327-4b1c-be40-708c5abb27df", // lobotomy (Tempest)
    setCode: "inv",
    rarity: "uncommon",
};

// Seer's Vision — {2}{U}{B} Enchantment. "Your opponents play with their
// hands revealed. Sacrifice this enchantment: Look at target player's hand
// and choose a card from it. That player discards that card. Activate only
// as a sorcery." (CR 702-adjacent persistent hand-reveal, issue #1104 gap
// 3.) `revealsHand` already shipped a "controller"/"all-players" continuous
// hand-reveal static (issue #735, Enduring Renewal / Zur's Weirding); the
// new `"opponents"` scope is the flipped-polarity generalization this card
// needs, not a new mechanism — it reveals every OTHER player's hand to the
// controller (2-player: exactly the one opponent), surfaced by
// `gameProjections.ts`'s existing `computeHandRevealedPlayers`. The
// sac-for-value ability is ordinary shipped DSL (`choice` + `discard`).
export const seersVision: CardDefinition = {
    id: "0c94618a-808c-4b3c-8f34-45e64d0414d3",
    name: "Seer's Vision",
    rarity: "uncommon",
    oracleText:
        "Your opponents play with their hands revealed.\nSacrifice this enchantment: Look at target player's hand and choose a card from it. That player discards that card. Activate only as a sorcery.",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Enchantment"],
    revealsHand: "opponents",
    activatedAbilities: [
        {
            id: "seers-vision-discard",
            oracleText:
                "Sacrifice this enchantment: Look at target player's hand and choose a card from it. That player discards that card. Activate only as a sorcery.",
            cost: { sacrifice: true },
            targetRequirement: { type: "player", count: 1 },
            sorcerySpeedOnly: true,
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    zoneOwnerId: { target: 0 },
                    count: 1,
                    prompt: "Choose a card",
                    bind: "$chosen",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$chosen" },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — BR (issue #1077, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────

// Agonizing Demise — {3}{B} Instant. "Kicker {1}{R}. Destroy target
// nonblack creature. It can't be regenerated. If this spell was kicked,
// Agonizing Demise deals damage equal to that creature's power to the
// creature's controller." (CR 702.33 Kicker; CR 701.8 destroy +
// `excludeColors` target filter, "nonblack creature" — Terror precedent;
// CR 701.15c "can't be regenerated" via `destroy`'s `cantBeRegenerated`;
// CR 120.1 damage.) `bind: "$slain"` snapshots the destroyed creature's
// power/controller BEFORE it leaves the battlefield (CR 608.2h last-known
// information) — the kicked damage reads `$slain.power` to `$slain`'s
// controller. `{ kickerCount: true } >= 1` is the standard "if this spell
// was kicked" gate (Overload, Explosive Growth this same set).
export const agonizingDemise: CardDefinition = {
    id: "539ac5e1-4bad-4f70-abac-e70c406bebec",
    rarity: "common",
    name: "Agonizing Demise",
    oracleText:
        "Kicker {1}{R} (You may pay an additional {1}{R} as you cast this spell.)\nDestroy target nonblack creature. It can't be regenerated. If this spell was kicked, Agonizing Demise deals damage equal to that creature's power to the creature's controller.",
    manaCost: { X: 3, B: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}{R}",
            mana: { X: 1, R: 1 },
        },
    ],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    effects: [
        {
            op: "destroy",
            target: { target: 0 },
            bind: "$slain",
            cantBeRegenerated: true,
        },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "dealDamage",
                    amount: { ref: "$slain.power" },
                    to: { player: { ref: "$slain.controller" } },
                },
            ],
        },
    ],
};

// Backlash — {1}{B}{R} Instant. "Tap target untapped creature. That
// creature deals damage equal to its power to its controller." (CR 701.26a
// tap; CR 120.1 damage; CR 608.2h last-known information.) `tapUntap`'s
// `bind: "$c"` snapshots the tapped creature's power/controller AT TAP TIME
// (issue #1416) — no zone change, the creature stays on the battlefield —
// so the trailing `dealDamage` reads `$c.power` for the amount and sends it
// to the creature's own controller (`{ ref: "$c.controller" }`). Crucially
// the CREATURE is the CR-120.1 damage SOURCE, not this B/R spell:
// `dealDamage`'s `source: { ref: "$c" }` routes the damage through the
// permanent-source pipeline (`dealDamageFromPermanent`), so infect (poison
// vs life loss), lifelink (the creature's controller gains life), source-
// colour prevention/protection and "a source deals damage" triggers all key
// off the creature's identity. Reusing `$c` (still on the battlefield after
// the tap) as the source resolves it back to the live tapped creature.
export const backlash: CardDefinition = {
    id: "dadf030d-5451-43fc-bf0c-c1629fdf88ec",
    rarity: "uncommon",
    name: "Backlash",
    oracleText:
        "Tap target untapped creature. That creature deals damage equal to its power to its controller.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, tappedFilter: "untapped" },
    effects: [
        { op: "tapUntap", action: "tap", target: { target: 0 }, bind: "$c" },
        {
            op: "dealDamage",
            amount: { ref: "$c.power" },
            to: { player: { ref: "$c.controller" } },
            source: { ref: "$c" },
        },
    ],
};

// Blazing Specter — {2}{B}{R} Creature — Specter, 2/2. "Flying, haste.
// Whenever this creature deals combat damage to a player, that player
// discards a card." (CR 702.9b flying, CR 702.10b haste, CR 510.4/603.2
// combat-damage trigger.) The firing `DAMAGE_DEALT` event's `damagedPlayer`
// field (ADR 0049's event-field registry) is a PLAYER-family ref legal
// directly in a triggered ability's own `effects[]` — no bind/capture
// needed: `{ ref: "$event.damagedPlayer" }` names both the chooser of
// `choice(choose-hand-card)` and the `discard` player (CR 701.8a default —
// the discarding player picks their own card).
export const blazingSpecter: CardDefinition = {
    id: "3bd397be-0e61-4f41-b0cf-f0c9d2440da7",
    rarity: "rare",
    name: "Blazing Specter",
    oracleText:
        "Flying, haste\nWhenever this creature deals combat damage to a player, that player discards a card.",
    manaCost: { X: 2, B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Specter"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "haste"],
    triggeredAbilities: [
        {
            id: "blazing-specter-damage-discard",
            oracleText:
                "Whenever this creature deals combat damage to a player, that player discards a card.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: { ref: "$event.damagedPlayer" },
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card (Blazing Specter).",
                    bind: "$disc",
                },
                {
                    op: "discard",
                    player: { ref: "$event.damagedPlayer" },
                    cards: { ref: "$disc" },
                },
            ],
        },
    ],
};

// Bloodstone Cameo — {3} Artifact. "{T}: Add {B} or {R}." (CR 605.1a
// choice-of-color mana ability — the Fellwar Stone / Nomadic Elf
// `manaChoices` shape, restricted to the two printed colors instead of
// "any color.")
export const bloodstoneCameo: CardDefinition = {
    id: "f9db32fa-64b2-4ef6-88f2-28e758d420bb",
    rarity: "uncommon",
    name: "Bloodstone Cameo",
    oracleText: "{T}: Add {B} or {R}.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "bloodstone-cameo-tap",
            oracleText: "{T}: Add {B} or {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ B: 1 }),
            manaChoices: [{ B: 1 }, { R: 1 }],
        },
    ],
};

// Firescreamer — {3}{B} Creature — Kavu, 2/2. "{R}: This creature gets
// +1/+0 until end of turn." (CR 613.4c firebreathing-style pump, the
// Dragon Whelp / Rogue Kavu `pump` Op shape self-targeted via `$source`.)
export const firescreamer: CardDefinition = {
    id: "155a2213-bf6e-4a54-924b-e450b7d06f26",
    rarity: "common",
    name: "Firescreamer",
    oracleText: "{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "firescreamer-pump",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Hooded Kavu — {2}{R} Creature — Kavu, 2/2. "{B}: This creature gains fear
// until end of turn." (CR 702.14b fear, CR 611.1b temporary keyword grant
// via the shipped `grantAbility` Op self-targeted via `$source`.)
export const hoodedKavu: CardDefinition = {
    id: "5464b80a-22fe-42c7-a839-31667712fb2d",
    rarity: "common",
    name: "Hooded Kavu",
    oracleText: "{B}: This creature gains fear until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "hooded-kavu-fear",
            oracleText: "{B}: This creature gains fear until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "fear",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Plague Spores — {4}{B}{R} Sorcery. "Destroy target nonblack creature and
// target land. They can't be regenerated." (CR 701.8 destroy +
// `excludeColors` "nonblack creature" filter, CR 701.15c "can't be
// regenerated"; two INDEPENDENT target groups — Fumarole's "destroy target
// creature and target land" `additionalTargetRequirements` precedent.)
export const plagueSpores: CardDefinition = {
    id: "0d106d56-a688-49cc-8d5d-0279a5a7c0a7",
    rarity: "common",
    name: "Plague Spores",
    oracleText:
        "Destroy target nonblack creature and target land. They can't be regenerated.",
    manaCost: { X: 4, B: 1, R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    additionalTargetRequirements: [{ type: "Land", count: 1 }],
    effects: [
        { op: "destroy", target: { target: 0 }, cantBeRegenerated: true },
        { op: "destroy", target: { target: 1 }, cantBeRegenerated: true },
    ],
};

// Reckless Assault — {2}{B}{R} Enchantment. "{1}, Pay 2 life: This
// enchantment deals 1 damage to any target." (CR 602.1/118.5 mana + life
// activation cost — the Bloodstained Mire / City of Brass `cost.life`
// shape; CR 115.4 any-target; CR 120.1 damage.)
export const recklessAssault: CardDefinition = {
    id: "ff0f568e-4d3a-40a5-b72a-63040ec5402d",
    rarity: "rare",
    name: "Reckless Assault",
    oracleText:
        "{1}, Pay 2 life: This enchantment deals 1 damage to any target.",
    manaCost: { X: 2, B: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "reckless-assault-ping",
            oracleText:
                "{1}, Pay 2 life: This enchantment deals 1 damage to any target.",
            cost: { mana: { X: 1 }, life: 2 },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Shivan Zombie — {B}{R} Creature — Phyrexian Barbarian Zombie, 2/2.
// "Protection from white." (CR 702.16 protection.) Pure data — a vanilla
// body with one printed keyword.
export const shivanZombie: CardDefinition = {
    id: "f4c99269-f730-4d33-bbce-9e855e9ad0fc",
    rarity: "common",
    name: "Shivan Zombie",
    oracleText: "Protection from white",
    manaCost: { B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Barbarian", "Zombie"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from white"],
};

// Smoldering Tar — {2}{B}{R} Enchantment. "At the beginning of your
// upkeep, target player loses 1 life. Sacrifice this enchantment: It deals
// 4 damage to target creature. Activate only as a sorcery." (CR 603.6a
// upkeep trigger; CR 701.16 sacrifice cost; CR 120.1 damage.)
//
// CR 603.3d — "target player" is a REAL target chosen when the upkeep
// trigger is put on the stack, declared as a `targetRequirement` on the
// TriggeredAbility (issue #1193 machinery, `raiseTriggerTargetSelection` in
// gre/rules.ts), NOT a resolution-time `requestOptionChoice` player pick.
// The old choice-as-target workaround chose the player at resolution, which
// bypassed the target-legality checks and "becomes the target" triggers the
// stack-placement target is subject to. Migrated resolve()→effects[] (ADR
// 0045, PRD #795): `{ target: number }` is a legal `EffectPlayerRef`
// directly (`convex/cards/types.ts`), so `loseLife`'s `player` reads the
// announced player slot with no `controllerOf`/bind indirection needed; a
// missing/illegal slot is CR 608.2b's standard skip, handled by
// `resolvePlayerRef` returning `undefined`. The second (sacrifice-for-
// damage) ability is fully DSL — no gap.
export const smolderingTar: CardDefinition = {
    id: "fcdc55c0-c8ac-49d5-969b-9bf0ee8e696c",
    rarity: "uncommon",
    name: "Smoldering Tar",
    oracleText:
        "At the beginning of your upkeep, target player loses 1 life.\nSacrifice this enchantment: It deals 4 damage to target creature. Activate only as a sorcery.",
    manaCost: { X: 2, B: 1, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "smoldering-tar-upkeep",
            oracleText:
                "At the beginning of your upkeep, target player loses 1 life.",
            event: "PHASE_BEGIN",
            // CR 603.3d — "target player" chosen when the trigger is put on
            // the stack (issue #1193, `raiseTriggerTargetSelection`), not a
            // resolution-time pick. `{ target: 0 }` is the announced player.
            targetRequirement: { type: "player", count: 1 },
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [{ op: "loseLife", player: { target: 0 }, amount: 1 }],
        },
    ],
    activatedAbilities: [
        {
            id: "smoldering-tar-detonate",
            oracleText:
                "Sacrifice this enchantment: It deals 4 damage to target creature. Activate only as a sorcery.",
            cost: { sacrifice: true },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        },
    ],
};

// Trench Wurm — {3}{B} Creature — Wurm, 3/3. "{2}{R}, {T}: Destroy target
// nonbasic land." (CR 605 activated ability; CR 701.8 destroy filtered by
// `excludeSupertypes: "Basic"` — the Wasteland / Vandalblast-cycle
// precedent, e.g. `inv/red.ts`'s own "Sacrifice a creature: Destroy target
// nonbasic land.")
export const trenchWurm: CardDefinition = {
    id: "1b076f85-d1bf-491a-af9d-f35b8e1bd163",
    rarity: "uncommon",
    name: "Trench Wurm",
    oracleText: "{2}{R}, {T}: Destroy target nonbasic land.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "trench-wurm-destroy-land",
            oracleText: "{2}{R}, {T}: Destroy target nonbasic land.",
            cost: { mana: { X: 2, R: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSupertypes: "Basic",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Urborg Volcano — Land. "This land enters tapped. {T}: Add {B} or {R}."
// (CR 110.5b enters tapped; CR 605.1a choice-of-color mana ability — same
// `manaChoices` shape as Bloodstone Cameo, this same file.)
export const urborgVolcano: CardDefinition = {
    id: "c76f346c-ae34-4f5f-8e3b-6c77b0c4d530",
    rarity: "uncommon",
    name: "Urborg Volcano",
    oracleText: "This land enters tapped.\n{T}: Add {B} or {R}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "urborg-volcano-tap",
            oracleText: "{T}: Add {B} or {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ B: 1 }),
            manaChoices: [{ B: 1 }, { R: 1 }],
        },
    ],
};

// Vicious Kavu — {1}{B}{R} Creature — Kavu, 2/2. "Whenever this creature
// attacks, it gets +2/+0 until end of turn." (CR 508.1 attack declaration +
// CR 613.4c until-end-of-turn pump — the exact Rogue Kavu (`inv/red.ts`)
// "attacks alone" shape, generalized to "attacks" by dropping the
// single-attacker constraint.)
export const viciousKavu: CardDefinition = {
    id: "31e9e629-7c25-4d45-aa35-9ba5f95b43cb",
    rarity: "uncommon",
    name: "Vicious Kavu",
    oracleText:
        "Whenever this creature attacks, it gets +2/+0 until end of turn.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "vicious-kavu-attacks",
            oracleText:
                "Whenever this creature attacks, it gets +2/+0 until end of turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Deferred (engine capability gaps) — BR (issue #1077, tracked-by #1120
// unless otherwise noted)
// ─────────────────────────────────────────────────────────────────────────

// Cauldron Dance — {4}{B}{R} Instant. "Cast this spell only during combat.
// Return target creature card from your graveyard to the battlefield. That
// creature gains haste. Return it to your hand at the beginning of the next
// end step. You may put a creature card from your hand onto the
// battlefield. That creature gains haste. Its controller sacrifices it at
// the beginning of the next end step." tracked-by: #1120 (the graveyard→
// battlefield half is free — the announced-target `moveZone` shape's
// `bind` captures the reanimated permanent for the haste grant + delayed
// return, same idiom Spinal Embrace uses in this file. The HAND→battlefield
// half is blocked: the choice-driven `moveZone(cards, from: "hand", to:
// "battlefield")` shape has no `bind` field, so there is no way to capture
// the newly-entered permanent's instance id for its own haste grant +
// delayed sacrifice. Shipping only the graveyard half would silently drop
// half the printed card, so the whole card waits.)

// Cinder Shade — {1}{B}{R} Creature — Shade, 1/1. "{B}: This creature gets
// +1/+1 until end of turn. {R}, Sacrifice this creature: It deals damage
// equal to its power to target creature." tracked-by: #1120 (the first
// ability alone is a free self-pump, but the second needs the SACRIFICED
// creature's own power as last-known information — no DSL Op has the
// `$source`-after-cost-sacrifice LKI fallback the `counters` value member
// carries (Powder Keg, issue #997); the identical shape already ships as
// `resolve()`-only precedent, Freyalise Supplicant `ice/green.ts`, via
// `ctx.getAdditionalSacrificePower()`. "Never ship silent partials" means
// the whole card waits rather than shipping only the pump half.)

// Pyre Zombie — {1}{B}{R} Creature — Zombie, 2/1. "At the beginning of your
// upkeep, if this card is in your graveyard, you may pay {1}{B}{B}. If you
// do, return it to your hand. {1}{R}{R}, Sacrifice this creature: It deals
// 2 damage to any target." tracked-by: #1120 (the battlefield sac-for-
// damage half is a free fixed-amount `dealDamage` — no power reference
// needed, so it doesn't hit the Cinder Shade gap above. The upkeep
// graveyard-recursion half needs a TRIGGERED ability that functions from
// the graveyard (CR 603.6e) reading "while this card is in your graveyard"
// — distinct from `activateFromGraveyard`, which only covers ACTIVATED
// abilities; no such triggered-ability graveyard scan variant exists.
// Shipping only the sac-damage half would silently drop the card's
// signature recursion clause, so the whole card waits.)

// Shivan Emissary — {2}{R} Creature — Human Wizard, 1/1. "Kicker {1}{B}.
// When this creature enters, if it was kicked, destroy target nonblack
// creature. It can't be regenerated." tracked-by: #1086 (same root cause as
// Benalish Emissary, `inv/white.ts`: `kickerCount` lives only on the
// resolving `StackItem`, never persisted onto `CardInstanceState`/
// `PERMANENT_ENTERED` for a LATER-firing ETB `TriggeredAbility` to read —
// `entersWith.counters`' `count: "kicker"` reads it fine at ETB-resolution
// time itself, but a separate triggered ability firing off the
// `PERMANENT_ENTERED` event has no access.)

// Tsabo Tavoc — {5}{B}{R} Legendary Creature — Phyrexian Horror, 7/4.
// "First strike, protection from legendary creatures. {B}{B}, {T}: Destroy
// target legendary creature. It can't be regenerated." tracked-by: #1120
// (first strike and the activated ability are both free — the destroy
// clause's `excludeSupertypes`/`bindingPattern` machinery composes fine for
// "target legendary creature" via `TargetRequirement.requireSupertype`-style
// filtering. The static keyword clause is the blocker: `protection.ts` only
// parses "protection from <color/colorless>" (CR 702.16a-g) — a non-color
// quality like "protection from legendary creatures" (CR 702.16h-k) has no
// engine support anywhere protection is consulted [targeting/damage/
// blocking], so granting the literal string would silently no-op — the
// "shipped but dead" anti-pattern the Mechanics Registry census exists to
// catch. Shipping without it would misrepresent a core printed keyword, so
// the whole card waits.)

// Void — {3}{B}{R} Sorcery. "Choose a number. Destroy all artifacts and
// creatures with mana value equal to that number. Then target player
// reveals their hand and discards all nonland cards with mana value equal
// to the number." tracked-by: #1120 (the battlefield sweep half alone would
// be buildable per fixed number via Powder Keg's `forEach` + `manaValue`
// `if`-check idiom, but there is no general "choose a number" DSL primitive
// to drive it, AND the hand-discard half needs a filtered, UNCHOSEN bulk
// discard from a zone `forEach` has no "hand" set member for — `discard`
// only ever consumes a `choice` Op's player-picked cards, never an
// automatic mana-value sweep. Both halves are blocked on capabilities that
// don't exist.)

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — RG (issue #1078, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────
//
// The RG colour-identity cluster (MTGJSON `colorIdentity` superset) is 19
// cards: 12 TRUE gold (mana cost carries both {R} and {G} pips — `colors`
// omitted below, derived from the pips per issue #1078's guidance) + 5
// mono-cost cards whose colour identity crosses into RG via a
// cross-colour activated-ability cost (the Hooded Kavu/Bloodstone
// Cameo/Urborg Volcano shape already established by the BR tranche,
// issue #1077). Serpentine Kavu is ALREADY shipped by the mono green free
// tranche (issue #1073, `inv/green.ts`); Verduran Emissary is a DEFERRED
// stub there (tracked-by #1086) — neither is re-declared here (never
// duplicate a `CardDefinition`, and never activate a tracked stub as a side
// effect).

// Artifact Mutation — {R}{G} Instant. "Destroy target artifact. It can't be
// regenerated. Create X 1/1 green Saproling creature tokens, where X is
// that artifact's mana value." (CR 701.8 destroy + 701.15c regeneration
// suppression — the Agonizing Demise `cantBeRegenerated` + `bind` shape,
// this file's BR tranche — then CR 111 token creation with `count` reading
// the ninth EffectValue grammar member's SIBLING, `{ ref: "$x.manaValue" }`
// (issue #680), off the destroyed artifact's own snapshot.)
export const artifactMutation: CardDefinition = {
    id: "d5eef49c-a80f-4622-ba77-999f9151c841",
    rarity: "uncommon",
    name: "Artifact Mutation",
    oracleText:
        "Destroy target artifact. It can't be regenerated. Create X 1/1 green Saproling creature tokens, where X is that artifact's mana value.",
    manaCost: { R: 1, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    effects: [
        {
            op: "destroy",
            target: { target: 0 },
            bind: "$art",
            cantBeRegenerated: true,
        },
        {
            op: "createToken",
            token: {
                name: "Saproling",
                types: ["Creature"],
                subtypes: ["Saproling"],
                power: 1,
                toughness: 1,
                colors: ["G"],
            },
            controller: "controller",
            count: { ref: "$art.manaValue" },
        },
    ],
};

// Fires of Yavimaya — {1}{R}{G} Enchantment. "Creatures you control have
// haste. Sacrifice this enchantment: Target creature gets +2/+2 until end
// of turn." (CR 611/613 layer 6 controller-scoped keyword-grant — the exact
// Goblin War Drums `keyword-grant` shape, `fem/red.ts`, keyword swapped to
// haste — then the Angelic Shield sacrifice-for-effect shape, this file's
// WU tranche, target creature `pump` instead of `moveZone`.)
export const firesOfYavimaya: CardDefinition = {
    id: "967f1658-8777-46fc-a648-07fb19e46745",
    rarity: "rare",
    name: "Fires of Yavimaya",
    oracleText:
        "Creatures you control have haste.\nSacrifice this enchantment: Target creature gets +2/+2 until end of turn.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.types.includes("Creature") &&
                target.controllerId === source.controllerId,
            keyword: "haste",
        },
    ],
    activatedAbilities: [
        {
            id: "fires-of-yavimaya-pump",
            oracleText:
                "Sacrifice this enchantment: Target creature gets +2/+2 until end of turn.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Frenzied Tilling — {3}{R}{G} Sorcery. "Destroy target land. Search your
// library for a basic land card, put that card onto the battlefield
// tapped, then shuffle." (CR 701.8 destroy, CR 401.4 search / 701.20
// shuffle — the Quirion Trailblazer / Harrow search-put-tapped-shuffle
// idiom, `inv/green.ts`, composed after a plain land `destroy`.)
export const frenziedTilling: CardDefinition = {
    id: "15875876-3341-40fb-866f-5587c3638538",
    rarity: "uncommon",
    name: "Frenzied Tilling",
    oracleText:
        "Destroy target land. Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
    manaCost: { X: 3, R: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 } },
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Land", supertype: "Basic" },
            count: { min: 0, max: 1 },
            prompt: "Search your library for a basic land card.",
            bind: "$land",
        },
        {
            op: "moveZone",
            cards: { ref: "$land" },
            player: "controller",
            from: "library",
            to: "battlefield",
            tapped: true,
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Hunting Kavu — {1}{R}{G} Creature — Kavu, 2/3. "{1}{R}{G}, {T}: Exile
// this creature and target creature without flying that's attacking you."
// (CR 602.1 activated ability, CR 508.1/509.1 `combatRoleFilter:
// "attacking"` + `excludeAbility: "flying"` — both already-censused
// `TargetRequirement` fields — CR 701.13 exile, one `exile` Op per object:
// `$source` and the announced target.)
export const huntingKavu: CardDefinition = {
    id: "8943304a-89c9-48b0-97b4-3e1aa690ca4d",
    rarity: "uncommon",
    name: "Hunting Kavu",
    oracleText:
        "{1}{R}{G}, {T}: Exile this creature and target creature without flying that's attacking you.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "hunting-kavu-exile",
            oracleText:
                "{1}{R}{G}, {T}: Exile this creature and target creature without flying that's attacking you.",
            cost: { mana: { X: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
                combatRoleFilter: "attacking",
                excludeAbility: "flying",
            },
            effects: [
                { op: "exile", target: { ref: "$source" } },
                { op: "exile", target: { target: 0 } },
            ],
        },
    ],
};

// Meteor Storm — {R}{G} Enchantment. "{2}{R}{G}, Discard two cards at
// random: This enchantment deals 4 damage to any target." (CR 118.3/701.8
// random-discard ACTIVATION COST — the Coral Helm `discardAtRandom` cost
// shape — CR 120.1 damage to `type: "any"`, the Zap shape, `inv/red.ts`.)
export const meteorStorm: CardDefinition = {
    id: "36489b24-f8a8-46b6-b879-0a5ce400a6dc",
    rarity: "rare",
    name: "Meteor Storm",
    oracleText:
        "{2}{R}{G}, Discard two cards at random: This enchantment deals 4 damage to any target.",
    manaCost: { R: 1, G: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "meteor-storm-blast",
            oracleText:
                "{2}{R}{G}, Discard two cards at random: This enchantment deals 4 damage to any target.",
            cost: { mana: { X: 2, R: 1, G: 1 }, discardAtRandom: 2 },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        },
    ],
};

// Raging Kavu — {1}{R}{G} Creature — Kavu, 3/1. "Flash. Haste." (CR 702.8b
// flash + CR 702.10b haste, pure printed-keyword data.)
export const ragingKavu: CardDefinition = {
    id: "27573679-e9e5-4bfc-b5d5-85d4648b01b6",
    rarity: "common",
    name: "Raging Kavu",
    oracleText: "Flash\nHaste",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 1,
    staticAbilities: ["flash", "haste"],
};

// simoon — INV reprint of the Visions definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `vis/multicolor.ts`.
export const simoonInv: CardPrint = {
    printId: "84b1930d-2e4b-472f-98a9-008fd632f3be", // INV 279
    definitionId: "642d9239-82e0-4696-ad99-10796042d1f8", // simoon (Visions)
    setCode: "inv",
    rarity: "uncommon",
};

// Voracious Cobra — {2}{R}{G} Creature — Snake, 2/2. "First strike.
// Whenever this creature deals combat damage to a creature, destroy that
// creature." (CR 702.7 first strike + CR 510.4/603.2 combat-damage trigger
// — the Blazing Specter `DAMAGE_DEALT` shape, this file's WU tranche,
// scoped to a PERMANENT target instead of a player via the newly-censused
// `EVENT_FIELD_REGISTRY.DAMAGE_DEALT.damagedPermanent` row (issue #1078,
// mirroring the existing `damagedPlayer` row 1:1 — `resolveObjectRef`'s
// generic `$event.<field>` branch, ADR 0049, already resolves any
// object-family row, so this is a pure census addition, no interpreter
// change) — then CR 701.8 destroy on that permanent.)
export const voraciousCobra: CardDefinition = {
    id: "9d8c5669-11a9-4d95-8431-7065037f1fb6",
    rarity: "uncommon",
    name: "Voracious Cobra",
    oracleText:
        "First strike\nWhenever this creature deals combat damage to a creature, destroy that creature.",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 2,
    toughness: 2,
    staticAbilities: ["first strike"],
    triggeredAbilities: [
        {
            id: "voracious-cobra-damage-destroy",
            oracleText:
                "Whenever this creature deals combat damage to a creature, destroy that creature.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "permanent",
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$event.damagedPermanent" },
                },
            ],
        },
    ],
};

// Yavimaya Barbarian — {R}{G} Creature — Elf Barbarian, 2/2. "Protection
// from blue." (CR 702.16 protection, pure printed-keyword data — the
// `bindingPattern` census in the Mechanics Registry.)
export const yavimayaBarbarian: CardDefinition = {
    id: "8e17377d-4dad-4144-b0ce-c849636096a2",
    rarity: "common",
    name: "Yavimaya Barbarian",
    oracleText: "Protection from blue",
    manaCost: { R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Barbarian"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from blue"],
};

// Yavimaya Kavu — {2}{R}{G} Creature — Kavu, */*. "Yavimaya Kavu's power is
// equal to the number of red creatures on the battlefield. Yavimaya Kavu's
// toughness is equal to the number of green creatures on the battlefield."
// (CR 604.3 characteristic-defining ability, layer 7b — the Keldon Warlord
// / Drift of the Dead `pt-cda` `compute` closure shape, `lea/red.ts` /
// `ice/black.ts`, generalized from a CONTROLLER-scoped count to a GLOBAL
// battlefield-wide one — the oracle text reads "on the battlefield", not
// "you control" — by dropping the `controllerId` equality check.)
export const yavimayaKavu: CardDefinition = {
    id: "1872f104-7cf1-41e3-b1b4-ca75c678e08b",
    rarity: "rare",
    name: "Yavimaya Kavu",
    oracleText:
        "Yavimaya Kavu's power is equal to the number of red creatures on the battlefield.\nYavimaya Kavu's toughness is equal to the number of green creatures on the battlefield.",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state, ctx) => {
                let red = 0;
                let green = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (!ctx.isCreature(p)) continue;
                        if (ctx.getColors(p).includes("R")) red++;
                        if (ctx.getColors(p).includes("G")) green++;
                    }
                }
                return { power: red, toughness: green };
            },
        },
    ],
};

// Firebrand Ranger — {1}{R} Creature — Human Soldier Ranger, 2/1. "{G},
// {T}: You may put a basic land card from your hand onto the battlefield."
// (Colour-identity RG via a cross-colour activated-ability cost, mono {R}
// cast cost — the Hooded Kavu / Bloodstone Cameo shape, this file's BR
// tranche, ships alongside the true-gold cards per issue #1078. CR 602.1
// activated ability — the Stoneforge Mystic hand-source `choice` +
// `moveZone` shape, `wwk/white.ts`: `count: { min: 0, max: 1 }` makes it
// "you may".)
export const firebrandRanger: CardDefinition = {
    id: "ee05211e-cf08-4dea-9740-ed06f8682153",
    rarity: "common",
    name: "Firebrand Ranger",
    oracleText:
        "{G}, {T}: You may put a basic land card from your hand onto the battlefield.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Ranger"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "firebrand-ranger-land-drop",
            oracleText:
                "{G}, {T}: You may put a basic land card from your hand onto the battlefield.",
            cost: { mana: { G: 1 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: { type: "Land", supertype: "Basic" },
                    count: { min: 0, max: 1 },
                    prompt: "Put a basic land card from your hand onto the battlefield (or none).",
                    bind: "$land",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$land" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Savage Offensive — {1}{R} Sorcery. "Kicker {G}. Creatures you control
// gain first strike until end of turn. If this spell was kicked, they get
// +1/+1 until end of turn." (Colour-identity RG via Kicker, mono {R} cast
// cost — same tranche placement as Firebrand Ranger above. CR 702.33
// Kicker read at spell RESOLUTION (not a later-firing ETB trigger, so the
// Shivan Emissary/Kangee `kickerCount`-persistence gap doesn't apply — the
// exact Agonizing Demise `{ kickerCount: true } >= 1` shape, this file's BR
// tranche) gating a SECOND `forEach` + `pump` pass over the same
// controller-scoped creature sweep the unconditional `grantAbility` pass
// uses.)
export const savageOffensive: CardDefinition = {
    id: "356744f3-e444-4f4e-bf00-80bb6b2ef76f",
    rarity: "uncommon",
    name: "Savage Offensive",
    oracleText:
        "Kicker {G} (You may pay an additional {G} as you cast this spell.)\nCreatures you control gain first strike until end of turn. If this spell was kicked, they get +1/+1 until end of turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {G}",
            mana: { G: 1 },
        },
    ],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: "controller",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { ref: "$each" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 1,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Viashino Grappler — {2}{R} Creature — Lizard, 3/1. "{G}: This creature
// gains trample until end of turn." (Colour-identity RG via a
// cross-colour activated-ability cost, mono {R} cast cost — the exact
// Hooded Kavu (fear) / Serpentine Kavu (haste) firebreathing-keyword
// shape, this file's BR tranche / `inv/green.ts`, keyword swapped to
// trample.)
export const viashinoGrappler: CardDefinition = {
    id: "4a94aeb4-349c-4394-848d-c1c9133856e2",
    rarity: "common",
    name: "Viashino Grappler",
    oracleText: "{G}: This creature gains trample until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Lizard"],
    power: 3,
    toughness: 1,
    activatedAbilities: [
        {
            id: "viashino-grappler-trample",
            oracleText: "{G}: This creature gains trample until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "trample",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Troll-Horn Cameo — {3} Artifact. "{T}: Add {R} or {G}." (Colourless,
// colour-identity RG via its own mana ability — the Bloodstone Cameo
// choice-of-color shape, this file's BR tranche, ships alongside the true
// RG gold cards per issue #1078's colour-identity cluster scoping.)
export const trollHornCameo: CardDefinition = {
    id: "42b1ca6c-6ca0-4b02-885a-58cee3fa2aa8",
    rarity: "uncommon",
    name: "Troll-Horn Cameo",
    oracleText: "{T}: Add {R} or {G}.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "troll-horn-cameo-tap",
            oracleText: "{T}: Add {R} or {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ R: 1 }),
            manaChoices: [{ R: 1 }, { G: 1 }],
        },
    ],
};

// Shivan Oasis — Land. "This land enters tapped. {T}: Add {R} or {G}."
// (CR 110.5b enters tapped + CR 605.1a choice-of-color mana ability — the
// exact Urborg Volcano shape, this file's BR tranche, colours swapped to
// R/G.)
export const shivanOasis: CardDefinition = {
    id: "9841f7e8-162c-44a3-96f3-af944fce15d1",
    rarity: "uncommon",
    name: "Shivan Oasis",
    oracleText: "This land enters tapped.\n{T}: Add {R} or {G}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "shivan-oasis-tap",
            oracleText: "{T}: Add {R} or {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ R: 1 }),
            manaChoices: [{ R: 1 }, { G: 1 }],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// RG gold (issue #1078) — Aether Rift shipped (issue #1123), Overabundance
// still deferred
// ─────────────────────────────────────────────────────────────────────────

// Aether Rift — {1}{R}{G} Enchantment. "At the beginning of your upkeep,
// discard a card at random. If you discard a creature card this way, return
// it from your graveyard to the battlefield unless any player pays 5 life."
// (CR 701.8a random discard, CR 603.2 upkeep trigger, CR 117.3a "unless a
// player pays", CR 400.7 graveyard→battlefield zone change. Closes issue
// #1123's three sub-gaps against Aether Rift.)
//
// Gap 1+2 (random discard as an EFFECT, with a bind to read the discarded
// card back): `discardAtRandom` previously existed only as an ACTIVATION COST
// primitive (Coral Helm's `cost.discardAtRandom`) with no Effect Script Op
// exposing it inside `effects[]`, and no way to snapshot which card came up.
// Both close together: the Op grew an optional `bind` (mirrors `destroy`/
// `exile`'s `bind` shape — `bindSnapshot`) that snapshots the FIRST discarded
// card as a `"graveyard-card"` object right after the discard (it is already
// sitting in the public graveyard, CR 400.2 — a live read, not last-known
// information). `$discarded` then answers "was it a creature card?" via the
// existing `boundMatchesFilter` predicate (Minsc & Boo's own snapshot-typed
// `if`, no new predicate needed) and, if the card stays put, is reanimated
// straight off the SAME binding by `moveZone`'s pre-existing graveyard-source
// recovery path (issue #1469 — it re-derives ANY snapshot's id from the
// graveyard, not just `destroy`/`exile`'s own bind).
//
// Gap 3 ("unless ANY player pays" — CR 117.3a, MTGJSON ruling 2009-10-01:
// "in turn order, each player is given the option to pay 5 life"): tried
// composing `forEach { set: "players" } + mayPay` first, per the DSL-first
// stop-and-compose discipline — it does NOT compose cleanly. `mayPay`'s
// pending-choice key is `${resolutionStep}:${choiceId}` (`requestMayPay`,
// `gre/state.ts`); `scopedContext`'s forEach iteration-scoping (`gre/effects/
// interpreter.ts`) rewrites `noteChoice`/`recallChoice`/`requestChoice`
// per-iteration but NOT `requestMayPay`, so two `mayPay` calls at the same
// script position from different forEach members would collide on the exact
// same key — the second player's answer would either overwrite the first's
// or silently replay it. Composed instead with TWO SEQUENTIAL `mayPay` Ops
// (no forEach) + nested `if`s: this engine is 2-player/solo-only by design
// (CLAUDE.md "Out of Scope — 3+ player multiplayer"), so "ask each player in
// APNAP order, stop at the first yes" is exactly "ask controller, then
// (nested) ask opponent only if controller declined" — CR 101.4's APNAP order
// starts with the active player, which here IS Aether Rift's controller
// (the ability only fires at their own upkeep). Reanimation is nested three
// `if`s deep ("neither paid"), so no AND-of-two-bindings predicate is needed
// either — a second reusable primitive gap avoided along with the first.
export const aetherRift: CardDefinition = {
    id: "692c186a-997c-4f7e-a339-bf84884e1019",
    rarity: "rare",
    name: "Aether Rift",
    oracleText:
        "At the beginning of your upkeep, discard a card at random. If you discard a creature card this way, return it from your graveyard to the battlefield unless any player pays 5 life.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "aether-rift-upkeep-discard",
            oracleText:
                "At the beginning of your upkeep, discard a card at random. If you discard a creature card this way, return it from your graveyard to the battlefield unless any player pays 5 life.",
            event: "PHASE_BEGIN",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "discardAtRandom",
                    player: "controller",
                    count: 1,
                    bind: "$discarded",
                },
                {
                    op: "if",
                    predicate: {
                        boundMatchesFilter: { ref: "$discarded" },
                        filter: { type: "Creature" },
                    },
                    then: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: { life: 5 },
                            prompt: "Pay 5 life, or the discarded creature returns to the battlefield (Aether Rift)?",
                            bind: "$p1Paid",
                        },
                        {
                            op: "if",
                            predicate: { not: { binding: "$p1Paid" } },
                            then: [
                                {
                                    op: "mayPay",
                                    player: "opponent",
                                    cost: { life: 5 },
                                    prompt: "Pay 5 life, or the discarded creature returns to the battlefield (Aether Rift)?",
                                    bind: "$p2Paid",
                                },
                                {
                                    op: "if",
                                    predicate: {
                                        not: { binding: "$p2Paid" },
                                    },
                                    then: [
                                        {
                                            op: "moveZone",
                                            target: { ref: "$discarded" },
                                            to: "battlefield",
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

// Overabundance — {1}{R}{G} Enchantment. "Whenever a player taps a land
// for mana, that player adds one mana of any type that land produced, and
// this enchantment deals 1 damage to the player." tracked-by: #1123 (no
// `GameEvent` / `EVENT_FIELD_REGISTRY` row exists for "a land was tapped
// for mana" — `TriggeredAbility.event` has nothing to key off — AND the
// "adds one mana of any type that land produced" doubling effect has no
// engine precedent (Extraplanar Lens-style mana doublers are unimplemented
// catalogue-wide). Both gaps block the whole card.)

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — GW (issue #1079, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────
//
// The GW colour-identity cluster (MTGJSON `colors` field, exact {G,W} pips)
// is 12 cards. All 12 are TRUE gold — no cross-colour mono-cost outliers
// this pair (unlike BR/RG's Hooded Kavu/Bloodstone Cameo shape) — `colors`
// omitted below, derived from the pips (CR 202.2). 11 ship free (Sterling
// Grove shipped with issue #1125's tutor-to-top Op — see the end of this
// file); Dueling Grounds is deferred — see the section below.

// Armadillo Cloak — {1}{G}{W} Enchantment — Aura. "Enchant creature.
// Enchanted creature gets +2/+2 and has trample. Whenever enchanted
// creature deals damage, you gain that much life." (CR 611/613 layer 7c
// static P/T + layer 6 keyword-grant for the first two clauses — the
// Wings of Hope `pt-buff` + `keyword-grant` shape, this file's WU tranche,
// scoped to the aura host via `AURA_AFFECTS_HOST`.)
//
// resolve() justification (ADR 0045 DSL-first, precedent-twin): the
// lifegain-on-damage clause is the EXACT Spirit Link shape (`leg/white.ts`)
// — a `damageDealtTrigger` factory call, `source: "any"` narrowed by a
// `condition` checking `event.sourceInstanceId === self.attachedTo` (CR
// 303.4b, the damage source must be the aura's host), `resolve: (ctx,
// event) => ctx.gainLife(ctx.controller, event.amount)`. NOT DSL-migratable
// (documented catalogue-wide, e.g. `arn/black.ts` El-Hajjâj, `tmp/red.ts`):
// the gained amount is `event.amount`, a runtime value with no
// `EffectValue` grammar member (literal / ref / count / X / domain only)
// and no trigger-event `amount` row in `EVENT_FIELD_REGISTRY` — a real,
// already-flagged composition gap, not an invented shortcut.
export const armadilloCloak: CardDefinition = {
    id: "9d816f98-6cb6-432c-b0a4-a0eed21658ac",
    rarity: "common",
    name: "Armadillo Cloak",
    oracleText:
        "Enchant creature\nEnchanted creature gets +2/+2 and has trample.\nWhenever enchanted creature deals damage, you gain that much life.",
    manaCost: { X: 1, G: 1, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 2, toughness: 2 },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "trample",
        },
    ],
    triggeredAbilities: [
        damageDealtTrigger({
            id: "armadillo-cloak-lifegain",
            oracleText:
                "Whenever enchanted creature deals damage, you gain that much life.",
            source: "any",
            condition: (event, self) =>
                event.sourceInstanceId === self.attachedTo,
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

// Aura Mutation — {G}{W} Instant. "Destroy target enchantment. Create X
// 1/1 green Saproling creature tokens, where X is that enchantment's mana
// value." (CR 701.8 destroy + CR 111 token creation with `count` reading
// the `{ ref: "$x.manaValue" }` snapshot — the exact Artifact Mutation
// shape, this file's RG tranche, target type swapped Artifact → Enchantment
// and no `cantBeRegenerated` clause (enchantments don't regenerate).)
export const auraMutation: CardDefinition = {
    id: "38421179-615e-4aba-91a4-503bfee05403",
    rarity: "rare",
    name: "Aura Mutation",
    oracleText:
        "Destroy target enchantment. Create X 1/1 green Saproling creature tokens, where X is that enchantment's mana value.",
    manaCost: { G: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Enchantment", count: 1 },
    effects: [
        {
            op: "destroy",
            target: { target: 0 },
            bind: "$ench",
        },
        {
            op: "createToken",
            token: {
                name: "Saproling",
                types: ["Creature"],
                subtypes: ["Saproling"],
                power: 1,
                toughness: 1,
                colors: ["G"],
            },
            controller: "controller",
            count: { ref: "$ench.manaValue" },
        },
    ],
};

// Aura Shards — {1}{G}{W} Enchantment. "Whenever a creature you control
// enters, you may destroy target artifact or enchantment." (CR 603.6a
// ETB trigger, scope "yours" + `filter: { types: "Creature" }" via
// `enteredTrigger`; CR 701.8 destroy.)
//
// CR 603.3d — "target artifact or enchantment" is a REAL target chosen when
// the ETB trigger is put on the stack, declared as a `targetRequirement` on
// the trigger (issue #1193 machinery, `raiseTriggerTargetSelection` in
// gre/rules.ts), NOT a resolution-time `requestChoice`. `count: { min: 0,
// max: 1 }` IS the "may" (the caster may lock zero or one target as the
// trigger goes on the stack). Choosing at stack placement makes it subject to
// hexproof/shroud/protection and fires "becomes the target of an ability"
// triggers, which the old choice-as-target workaround silently skipped.
// Migrated resolve()→effects[] (ADR 0045, PRD #795): `destroy`'s
// `resolveObjectRef` already no-ops on a missing target slot, which is
// exactly the "may: none chosen / CR 608.2b none legal" fizzle the old
// resolve() spelled out by hand — `enteredTrigger`'s `effects[]` site (this
// factory now accepts either) needs no imperative reach.
export const auraShards: CardDefinition = {
    id: "df4039ef-af72-4267-ade9-fdb7c921279e",
    rarity: "uncommon",
    name: "Aura Shards",
    oracleText:
        "Whenever a creature you control enters, you may destroy target artifact or enchantment.",
    manaCost: { X: 1, G: 1, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "aura-shards-destroy",
            oracleText:
                "Whenever a creature you control enters, you may destroy target artifact or enchantment.",
            scope: "yours",
            filter: { types: "Creature" },
            // CR 603.3d — announcement-time target; `count 0..1` = the "may".
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: { min: 0, max: 1 },
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        }),
    ],
};

// Captain Sisay — {2}{G}{W} Legendary Creature — Human Soldier, 2/2. "{T}:
// Search your library for a legendary card, reveal that card, put it into
// your hand, then shuffle." (CR 605 activated ability, CR 701.23 search
// filtered by `supertype: "Legendary"`, CR 701.20 reveal, CR 701.24
// shuffle — the Stoneforge Mystic `choice(search-library)` + `reveal` +
// `moveZone` + `libraryLook` shape, `wwk/white.ts`, no "may"/no count
// range since the printed text has neither.)
export const captainSisay: CardDefinition = {
    id: "d24d441c-f37f-44fe-8a93-f5c89df807e4",
    rarity: "rare",
    name: "Captain Sisay",
    oracleText:
        "{T}: Search your library for a legendary card, reveal that card, put it into your hand, then shuffle.",
    manaCost: { X: 2, G: 1, W: 1 },
    types: ["Creature"],
    // Captain Sisay is Legendary (MTGJSON INV.json `supertypes: ["Legendary"]`)
    // — missing here until the widened data/json conformance guard caught it
    // (the mirror-image bug of Questing Phelddagrif shipping AS Legendary
    // when it isn't, PR #2047).
    supertypes: ["Legendary"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "captain-sisay-tutor",
            oracleText:
                "{T}: Search your library for a legendary card, reveal that card, put it into your hand, then shuffle.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { supertype: "Legendary" },
                    count: 1,
                    prompt: "Search your library for a legendary card.",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};

// Charging Troll — {2}{G}{W} Creature — Troll, 3/3. "Vigilance\n{G}:
// Regenerate this creature." (CR 702.20b vigilance; CR 701.15a
// regeneration via the shipped `regenerate` Op self-targeted through
// `$source` — the Clay Statue/Ghost Ship shape, `atq/colorless.ts` /
// `drk/blue.ts`.)
export const chargingTroll: CardDefinition = {
    id: "58956099-6b97-4c7b-ab23-9f9b4d50ef95",
    rarity: "uncommon",
    name: "Charging Troll",
    oracleText: "Vigilance\n{G}: Regenerate this creature.",
    manaCost: { X: 2, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 3,
    toughness: 3,
    staticAbilities: ["vigilance"],
    activatedAbilities: [
        {
            id: "charging-troll-regen",
            oracleText: "{G}: Regenerate this creature.",
            cost: { mana: { G: 1 } },
            useStack: true,
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Dueling Grounds — {1}{G}{W} Enchantment. "No more than one creature can
// attack each combat.\nNo more than one creature can block each combat."
// tracked-by: #1127 (a battlefield-wide DECLARED-SET count cap, distinct
// from every existing attack/block-restriction kind: `declared-attack-
// restriction` / `declared-block-restriction` (CR 508.1c/509.1b, Orcish
// Conscripts' "can't attack/block unless...") are only ever collected from
// the ATTACKING/BLOCKING creature's OWN definition and from Auras attached
// to it (`collectDeclaredAttackRestrictions` / `collectDeclaredBlockRestrictions`,
// `gre/combat.ts`) — never scanned battlefield-wide from an unrelated,
// unattached Enchantment like Dueling Grounds. `global-attack-restriction`
// (Moat) IS battlefield-scanned but is a per-creature forbid/allow
// predicate, not a COUNT CAP over the whole declared set — it can't express
// "no more than one" either. No existing static-effect kind combines
// "scanned from any battlefield source" with "judged over the complete
// declared-attacker/-blocker set", so this needs a new kind (a
// `global-declared-attack-restriction` / `-block-restriction` pair, or an
// extension of the existing collectors to also scan non-aura battlefield
// sources) before Dueling Grounds can ship.)

// Heroes' Reunion — {G}{W} Instant. "Target player gains 7 life." (CR
// 119.3a life gain.) A plain single-Op spell — exact shape precedent
// Absorb's `gainLife` half (this file's WU tranche), target swapped from
// the caster to an announced player target.
export const heroesReunion: CardDefinition = {
    id: "135d6043-5ec1-4ad4-8296-41fe23f11cb9",
    rarity: "uncommon",
    name: "Heroes' Reunion",
    oracleText: "Target player gains 7 life.",
    manaCost: { G: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "gainLife", player: { target: 0 }, amount: 7 }],
};

// Horned Cheetah — {2}{G}{W} Creature — Cat, 2/2. "Whenever this creature
// deals damage, you gain that much life." (CR 120.3/603.2 damage-dealt
// trigger.)
//
// resolve() justification (ADR 0045 DSL-first, precedent-twin): identical
// to Armadillo Cloak's lifegain clause (this file, GW tranche) minus the
// Aura indirection — the EXACT El-Hajjâj shape (`arn/black.ts`):
// `damageDealtTrigger({ source: "self", resolve: (ctx, event) =>
// ctx.gainLife(ctx.controller, event.amount) })`. Same documented gap
// (`event.amount` has no `EffectValue` grammar member / `$event` field row)
// — not an invented shortcut.
export const hornedCheetah: CardDefinition = {
    id: "a28ad983-ce91-40b6-a1ce-fe36ec7fbce8",
    rarity: "uncommon",
    name: "Horned Cheetah",
    oracleText: "Whenever this creature deals damage, you gain that much life.",
    manaCost: { X: 2, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        damageDealtTrigger({
            id: "horned-cheetah-lifegain",
            oracleText:
                "Whenever this creature deals damage, you gain that much life.",
            source: "self",
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

// Llanowar Knight — {G}{W} Creature — Elf Knight, 2/2. "Protection from
// black." (CR 702.16 protection, `bindingPattern` in the Mechanics
// Registry.) Pure data — a vanilla body with one printed keyword.
export const llanowarKnight: CardDefinition = {
    id: "e6c75d89-e432-49aa-a407-555b223b7eff",
    rarity: "common",
    name: "Llanowar Knight",
    oracleText: "Protection from black",
    manaCost: { G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from black"],
};

// Noble Panther — {1}{G}{W} Creature — Cat, 3/3. "{1}: This creature gains
// first strike until end of turn." (CR 702.7b first strike, CR 611.1b
// temporary keyword grant via the shipped `grantAbility` Op self-targeted
// through `$source` — the exact Hooded Kavu shape, this file's BR
// tranche, keyword swapped fear → first strike.)
export const noblePanther: CardDefinition = {
    id: "3f327818-8222-4295-8cef-118757b34d17",
    rarity: "rare",
    name: "Noble Panther",
    oracleText: "{1}: This creature gains first strike until end of turn.",
    manaCost: { X: 1, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "noble-panther-first-strike",
            oracleText:
                "{1}: This creature gains first strike until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Sabertooth Nishoba — {4}{G}{W} Creature — Cat Beast Warrior, 5/5.
// "Trample, protection from blue and from red" (CR 702.19 trample; CR
// 702.16 protection — TWO independent "protection from <color>" strings in
// the same `staticAbilities[]` array. `getProtectedColors`
// (`gre/protection.ts`) iterates and collects EVERY matching entry, so two
// distinct-color protections stack correctly (CR 702.16m — only literal
// duplicates collapse) with zero engine change; the catalogue's first
// double-protection creature, not a new capability.)
export const sabertoothNishoba: CardDefinition = {
    id: "8338c296-cf3f-41d7-b380-3fb4237cb41c",
    rarity: "rare",
    name: "Sabertooth Nishoba",
    oracleText: "Trample, protection from blue and from red",
    manaCost: { X: 4, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Cat", "Beast", "Warrior"],
    power: 5,
    toughness: 5,
    staticAbilities: ["trample", "protection from blue", "protection from red"],
};

// ─────────────────────────────────────────────────────────────────────────
// GW (issue #1125 — unblocked by the tutor-to-top `moveZone` destination)
// ─────────────────────────────────────────────────────────────────────────

// Sterling Grove — other enchantments you control affected by this static
// effect (excludes Sterling Grove itself and any enchantment a different
// player controls). Shared `applies` predicate for both the cosmetic
// `keyword-grant` (staticAbilities display) and the enforcing
// `permanent-guard` (CR 702.18 shroud — `cantBeTargeted`), mirroring the
// shroud dominant-enforcement pattern (mechanicsRegistry.ts's "shroud" row)
// but scoped to OTHER permanents instead of self, precedent Elvish
// Champion's own-type lord anthem (`inv/green.ts`).
const STERLING_GROVE_AFFECTS_OTHER_ENCHANTMENTS: StaticKeywordGrant["applies"] =
    (target, source) =>
        target.id !== source.id &&
        target.types.includes("Enchantment") &&
        target.controllerId === source.controllerId;

// ─────────────────────────────────────────────────────────────────────────
// Free tranche — 3-colour + WUBRG (issue #1080, parent PRD #1063)
// ─────────────────────────────────────────────────────────────────────────
//
// The Nephilim-style dragon cycle (Crosis/Darigaaz/Dromar/Rith/Treva — each
// {3}{X}{Y}{Z}, three colour-pip mana costs) plus their five sacrifice-for-
// mana Attendants ({5} artifact creatures) and five sacrifice-for-two-colour
// tri-lands, plus the three remaining Apprentice/Master wizard pairs whose
// FULL colour identity (CR 202.2 — mana symbols in the cost OR the rules
// text) spans three colours via off-cost activated-ability mana symbols even
// though each is a MONO-cost creature (the PRD's "mana-cost colour identity
// (CR 202.2)" routing rule for this module). Sunscape/Thornscape — the other
// two pairs of this same five-pair cycle — already shipped in
// white.ts/green.ts per the earlier White/Green free-tranche issues
// (#1069/#1073); not re-declared here (ADR 0043 one-definition-per-card, ADR
// 0014). Coalition Victory and Ordered Migration (the Domain cluster's own
// two gold cards, issue #1066) are already active above this section — not
// duplicated. Two of the five dragons (Crosis, Darigaaz) and one Apprentice
// (Nightscape) hit genuine capability gaps and are deferred at the end of
// this file.
// ─────────────────────────────────────────────────────────────────────────

// The five WUBRG "choose a color, then return every creature of that color
// to its owner's hand" modes Dromar's triggered ability offers (CR 700.2
// modal colour pick via `optionChoice`). The body is the SAME
// `forEach(permanents) + moveZone(to: "hand")` combination Upheaval
// (`ody/blue.ts`) already exercises and earned its own interpreter test for
// ("the FIRST card to pair forEach's $each with moveZone's target-shape"),
// just scoped to ONE color via `filter` (an already-supported `forEach`
// field, Voracious Cobra/Yavimaya Kavu this same set already filter
// `forEach` by `type`) and every player's battlefield (omitted `controller`
// — the same "all permanents" sweep default Upheaval itself uses) — no new
// construct combination, so no new interpreter test is owed here.
const DROMAR_BOUNCE_COLOR_MODES: NonNullable<
    Extract<EffectOp, { op: "optionChoice" }>["modes"]
> = [
    {
        label: "Return all white creatures to their owners' hands",
        effects: [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", color: "W" },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ],
    },
    {
        label: "Return all blue creatures to their owners' hands",
        effects: [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", color: "U" },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ],
    },
    {
        label: "Return all black creatures to their owners' hands",
        effects: [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", color: "B" },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ],
    },
    {
        label: "Return all red creatures to their owners' hands",
        effects: [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", color: "R" },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ],
    },
    {
        label: "Return all green creatures to their owners' hands",
        effects: [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", color: "G" },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ],
    },
];

// Dromar, the Banisher — {3}{W}{U}{B} Legendary Creature — Dragon, 6/6.
// "Flying. Whenever Dromar deals combat damage to a player, you may pay
// {2}{U}. If you do, choose a color, then return all creatures of that
// color to their owners' hands." (CR 702.9b flying; CR 510.4/603.2
// combat-damage trigger — the firing `DAMAGE_DEALT` event's `damagedPlayer`
// field is unused here (the effect isn't about the damaged PLAYER, only the
// gate that damage was dealt), so the trigger's `matches` closure mirrors
// Blazing Specter's (this file) minus the `$event.damagedPlayer` ref; CR
// 117.3a/118.4 optional additional-cost `mayPay`; CR 700.2 modal colour
// pick; CR 400.7 mass zone change.) A card whose script contains `mayPay`
// is SKIPPED by the auto-generated canned-scenario smoke test (it can't
// answer a live Pay/Skip decision) — the per-card tests below cover both
// the accept and decline paths by hand.
export const dromar: CardDefinition = {
    id: "cfcc3c72-fff5-454c-814c-eb952fd23ba9",
    rarity: "rare",
    name: "Dromar, the Banisher",
    oracleText:
        "Flying\nWhenever Dromar deals combat damage to a player, you may pay {2}{U}. If you do, choose a color, then return all creatures of that color to their owners' hands.",
    manaCost: { X: 3, W: 1, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Dragon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "dromar-damage-bounce",
            oracleText:
                "Whenever Dromar deals combat damage to a player, you may pay {2}{U}. If you do, choose a color, then return all creatures of that color to their owners' hands.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 2, U: 1 },
                    prompt: "Pay {2}{U} to have Dromar bounce a color (Dromar, the Banisher)?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "optionChoice",
                            player: "controller",
                            prompt: "Choose a color — return all creatures of that color to their owners' hands (Dromar, the Banisher)",
                            modes: DROMAR_BOUNCE_COLOR_MODES,
                        },
                    ],
                },
            ],
        },
    ],
};

// The five WUBRG "choose a color, then create a 1/1 green Saproling for each
// permanent of that color" modes Rith's triggered ability offers (CR 700.2
// modal colour pick). `count` reuses the `acrossAllPlayers` generalization of
// the `count` value construct (Phyrexian Infiltrator/Accumulated Knowledge
// this same catalogue) scoped to `zone: "battlefield"` instead of
// `"graveyard"` — no new value-construct shape.
const RITH_SAPROLING_COLOR_MODES: NonNullable<
    Extract<EffectOp, { op: "optionChoice" }>["modes"]
> = (
    [
        ["W", "white"],
        ["U", "blue"],
        ["B", "black"],
        ["R", "red"],
        ["G", "green"],
    ] as const
).map(([color, label]) => ({
    label: `Create a 1/1 green Saproling for each ${label} permanent`,
    effects: [
        {
            op: "createToken",
            token: {
                name: "Saproling",
                types: ["Creature"],
                subtypes: ["Saproling"],
                power: 1,
                toughness: 1,
                colors: ["G"],
            },
            controller: "controller",
            count: {
                count: {
                    zone: "battlefield",
                    filter: { color },
                    acrossAllPlayers: true,
                },
            },
        },
    ],
}));

// Rith, the Awakener — {3}{R}{G}{W} Legendary Creature — Dragon, 6/6.
// "Flying. Whenever Rith deals combat damage to a player, you may pay
// {2}{G}. If you do, choose a color, then create a 1/1 green Saproling
// creature token for each permanent of that color." (CR 702.9b flying; CR
// 510.4/603.2 combat-damage trigger; CR 117.3a/118.4 optional
// additional-cost `mayPay`; CR 700.2 modal colour pick; CR 111/701.7 token
// creation scaled by a battlefield-wide `count`.) Same smoke-skip note as
// Dromar (this file) — `mayPay` is hand-tested below.
export const rith: CardDefinition = {
    id: "c30be387-280d-49bd-a3d1-c1636ee931ce",
    rarity: "rare",
    name: "Rith, the Awakener",
    oracleText:
        "Flying\nWhenever Rith deals combat damage to a player, you may pay {2}{G}. If you do, choose a color, then create a 1/1 green Saproling creature token for each permanent of that color.",
    manaCost: { X: 3, R: 1, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Dragon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "rith-damage-saprolings",
            oracleText:
                "Whenever Rith deals combat damage to a player, you may pay {2}{G}. If you do, choose a color, then create a 1/1 green Saproling creature token for each permanent of that color.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 2, G: 1 },
                    prompt: "Pay {2}{G} to have Rith make Saprolings (Rith, the Awakener)?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "optionChoice",
                            player: "controller",
                            prompt: "Choose a color — create a Saproling for each permanent of that color (Rith, the Awakener)",
                            modes: RITH_SAPROLING_COLOR_MODES,
                        },
                    ],
                },
            ],
        },
    ],
};

// The five WUBRG "choose a color, then gain 1 life for each permanent of
// that color" modes Treva's triggered ability offers (CR 700.2 modal colour
// pick). Same `acrossAllPlayers` count shape as Rith's Saproling modes
// (this file), fed into `gainLife` instead of `createToken`.
const TREVA_LIFEGAIN_COLOR_MODES: NonNullable<
    Extract<EffectOp, { op: "optionChoice" }>["modes"]
> = (
    [
        ["W", "white"],
        ["U", "blue"],
        ["B", "black"],
        ["R", "red"],
        ["G", "green"],
    ] as const
).map(([color, label]) => ({
    label: `Gain 1 life for each ${label} permanent`,
    effects: [
        {
            op: "gainLife",
            player: "controller",
            amount: {
                count: {
                    zone: "battlefield",
                    filter: { color },
                    acrossAllPlayers: true,
                },
            },
        },
    ],
}));

// Treva, the Renewer — {3}{G}{W}{U} Legendary Creature — Dragon, 6/6.
// "Flying. Whenever Treva deals combat damage to a player, you may pay
// {2}{W}. If you do, choose a color, then you gain 1 life for each
// permanent of that color." (CR 702.9b flying; CR 510.4/603.2 combat-damage
// trigger; CR 117.3a/118.4 optional additional-cost `mayPay`; CR 700.2
// modal colour pick; CR 119.3a life gain scaled by a battlefield-wide
// `count`.) Same smoke-skip note as Dromar (this file).
export const treva: CardDefinition = {
    id: "4ee67039-6cee-4a2d-b973-570f5060f550",
    rarity: "rare",
    name: "Treva, the Renewer",
    oracleText:
        "Flying\nWhenever Treva deals combat damage to a player, you may pay {2}{W}. If you do, choose a color, then you gain 1 life for each permanent of that color.",
    manaCost: { X: 3, G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Dragon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "treva-damage-lifegain",
            oracleText:
                "Whenever Treva deals combat damage to a player, you may pay {2}{W}. If you do, choose a color, then you gain 1 life for each permanent of that color.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 2, W: 1 },
                    prompt: "Pay {2}{W} to have Treva gain you life (Treva, the Renewer)?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "optionChoice",
                            player: "controller",
                            prompt: "Choose a color — gain 1 life for each permanent of that color (Treva, the Renewer)",
                            modes: TREVA_LIFEGAIN_COLOR_MODES,
                        },
                    ],
                },
            ],
        },
    ],
};

// The five Attendants — {5} Artifact Creature — Golem, 3/3. "{1}, Sacrifice
// this creature: Add <the paired dragon's three colours>." (CR 605.1a mana
// ability with a {1} + self-sacrifice cost — the exact Coal Golem shape,
// `drk/colorless.ts`, generalized from one fixed colour to three.)
export const crosisAttendant: CardDefinition = {
    id: "45edc18c-2046-4d0e-92fe-a6cf4aaf1c6f",
    rarity: "uncommon",
    name: "Crosis's Attendant",
    oracleText: "{1}, Sacrifice this creature: Add {U}{B}{R}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "crosis-attendant-sacrifice-mana",
            oracleText: "{1}, Sacrifice this creature: Add {U}{B}{R}.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ U: 1, B: 1, R: 1 }),
            manaProduced: { U: 1, B: 1, R: 1 },
        },
    ],
};

export const darigaazAttendant: CardDefinition = {
    id: "6f22b575-443a-4c06-8e75-d4140cbd3660",
    rarity: "uncommon",
    name: "Darigaaz's Attendant",
    oracleText: "{1}, Sacrifice this creature: Add {B}{R}{G}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "darigaaz-attendant-sacrifice-mana",
            oracleText: "{1}, Sacrifice this creature: Add {B}{R}{G}.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ B: 1, R: 1, G: 1 }),
            manaProduced: { B: 1, R: 1, G: 1 },
        },
    ],
};

export const dromarAttendant: CardDefinition = {
    id: "24936fa9-41a3-4da5-91cf-c28fa45f47c9",
    rarity: "uncommon",
    name: "Dromar's Attendant",
    oracleText: "{1}, Sacrifice this creature: Add {W}{U}{B}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "dromar-attendant-sacrifice-mana",
            oracleText: "{1}, Sacrifice this creature: Add {W}{U}{B}.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ W: 1, U: 1, B: 1 }),
            manaProduced: { W: 1, U: 1, B: 1 },
        },
    ],
};

export const rithAttendant: CardDefinition = {
    id: "a26e8130-7fe9-4ef4-98af-928814f5b130",
    rarity: "uncommon",
    name: "Rith's Attendant",
    oracleText: "{1}, Sacrifice this creature: Add {R}{G}{W}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "rith-attendant-sacrifice-mana",
            oracleText: "{1}, Sacrifice this creature: Add {R}{G}{W}.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ R: 1, G: 1, W: 1 }),
            manaProduced: { R: 1, G: 1, W: 1 },
        },
    ],
};

export const trevaAttendant: CardDefinition = {
    id: "9857af81-fb95-4dc4-b048-9ce4e96d1eca",
    rarity: "uncommon",
    name: "Treva's Attendant",
    oracleText: "{1}, Sacrifice this creature: Add {G}{W}{U}.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "treva-attendant-sacrifice-mana",
            oracleText: "{1}, Sacrifice this creature: Add {G}{W}{U}.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ G: 1, W: 1, U: 1 }),
            manaProduced: { G: 1, W: 1, U: 1 },
        },
    ],
};

// The five tri-lands — Land. "This land enters tapped. {T}: Add <its own
// colour>. {T}, Sacrifice this land: Add <the other two colours of its
// paired dragon>." (CR 110.5b enters tapped; CR 605.1a two chained mana
// abilities — the first the plain Urborg Volcano/Shivan Oasis shape (this
// file) minus the choice, the second the Coal Golem sacrifice-for-mana
// shape, `drk/colorless.ts`, with a {T} rider added alongside the
// sacrifice, generalized from one fixed colour to two.)
export const ancientSpring: CardDefinition = {
    id: "004eefa4-947b-45fc-b45c-5263bfd763bc",
    rarity: "common",
    name: "Ancient Spring",
    oracleText:
        "This land enters tapped.\n{T}: Add {U}.\n{T}, Sacrifice this land: Add {W}{B}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "ancient-spring-tap",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
        {
            id: "ancient-spring-sacrifice-mana",
            oracleText: "{T}, Sacrifice this land: Add {W}{B}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ W: 1, B: 1 }),
            manaProduced: { W: 1, B: 1 },
        },
    ],
};

export const geothermalCrevice: CardDefinition = {
    id: "e744b593-13fe-4967-b492-ac02f5815e57",
    rarity: "common",
    name: "Geothermal Crevice",
    oracleText:
        "This land enters tapped.\n{T}: Add {R}.\n{T}, Sacrifice this land: Add {B}{G}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "geothermal-crevice-tap",
            oracleText: "{T}: Add {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ R: 1 }),
            manaProduced: { R: 1 },
        },
        {
            id: "geothermal-crevice-sacrifice-mana",
            oracleText: "{T}, Sacrifice this land: Add {B}{G}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ B: 1, G: 1 }),
            manaProduced: { B: 1, G: 1 },
        },
    ],
};

export const irrigationDitch: CardDefinition = {
    id: "977f1b44-166c-4faf-8a7b-d431707e90ce",
    rarity: "common",
    name: "Irrigation Ditch",
    oracleText:
        "This land enters tapped.\n{T}: Add {W}.\n{T}, Sacrifice this land: Add {G}{U}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "irrigation-ditch-tap",
            oracleText: "{T}: Add {W}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaProduced: { W: 1 },
        },
        {
            id: "irrigation-ditch-sacrifice-mana",
            oracleText: "{T}, Sacrifice this land: Add {G}{U}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ G: 1, U: 1 }),
            manaProduced: { G: 1, U: 1 },
        },
    ],
};

export const sulfurVent: CardDefinition = {
    id: "22c66ed6-55fb-4c65-aac4-26d9cc3053b8",
    rarity: "common",
    name: "Sulfur Vent",
    oracleText:
        "This land enters tapped.\n{T}: Add {B}.\n{T}, Sacrifice this land: Add {U}{R}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "sulfur-vent-tap",
            oracleText: "{T}: Add {B}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ B: 1 }),
            manaProduced: { B: 1 },
        },
        {
            id: "sulfur-vent-sacrifice-mana",
            oracleText: "{T}, Sacrifice this land: Add {U}{R}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ U: 1, R: 1 }),
            manaProduced: { U: 1, R: 1 },
        },
    ],
};

export const tinderFarm: CardDefinition = {
    id: "989b5901-aeb0-4a48-8c53-3b0ec0e0deba",
    rarity: "common",
    name: "Tinder Farm",
    oracleText:
        "This land enters tapped.\n{T}: Add {G}.\n{T}, Sacrifice this land: Add {R}{W}.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "tinder-farm-tap",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ G: 1 }),
            manaProduced: { G: 1 },
        },
        {
            id: "tinder-farm-sacrifice-mana",
            oracleText: "{T}, Sacrifice this land: Add {R}{W}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) =>
                ctx.addMana({ R: 1, W: 1 }),
            manaProduced: { R: 1, W: 1 },
        },
    ],
};

// Stormscape Apprentice — {U} Creature — Human Wizard, 1/1. "{W}, {T}: Tap
// target creature. {B}, {T}: Target player loses 1 life." (CR 602.1
// activated ability, CR 701.26 tap; CR 119.3b life loss.) Two independent
// tap-only activated abilities — same fused-pair shape as Samite Archer
// (this file, WU tranche) and Stormscape Apprentice's own sibling Sunscape
// Apprentice (`white.ts`, deferred elsewhere — a DIFFERENT ability pair).
export const stormscapeApprentice: CardDefinition = {
    id: "1eb42f39-9187-44e4-aa34-14ab31977199",
    rarity: "common",
    name: "Stormscape Apprentice",
    oracleText:
        "{W}, {T}: Tap target creature.\n{B}, {T}: Target player loses 1 life.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "stormscape-apprentice-tap",
            oracleText: "{W}, {T}: Tap target creature.",
            cost: { mana: { W: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
        {
            id: "stormscape-apprentice-drain",
            oracleText: "{B}, {T}: Target player loses 1 life.",
            cost: { mana: { B: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "loseLife", player: { target: 0 }, amount: 1 }],
        },
    ],
};

// The five WUBRG "protection from the color of your choice" modes Stormscape
// Master's second ability offers — the exact Thornscape Master shape
// (`green.ts`, this same five-pair cycle) reproduced module-locally: each
// per-colour module authors its own mode array rather than importing across
// files (Urborg Volcano/Shivan Oasis, this file, likewise each hand-write
// their own `manaChoices` instead of sharing one).
const STORMSCAPE_MASTER_PROTECTION_MODES: NonNullable<
    Extract<EffectOp, { op: "optionChoice" }>["modes"]
> = [
    {
        label: "Protection from white",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from white",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from blue",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from blue",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from black",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from black",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from red",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from red",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from green",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from green",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
];

// Stormscape Master — {2}{U}{U} Creature — Human Wizard, 2/2. "{W}{W}, {T}:
// Target creature gains protection from the color of your choice until end
// of turn. {B}{B}, {T}: Target player loses 2 life and you gain 2 life."
// (CR 613.1f keyword grant + CR 700.2 modal colour pick; CR 119.3b life loss
// + CR 119.3a life gain.)
export const stormscapeMaster: CardDefinition = {
    id: "9b704165-4587-48f1-8830-c5a07ec666cc",
    rarity: "rare",
    name: "Stormscape Master",
    oracleText:
        "{W}{W}, {T}: Target creature gains protection from the color of your choice until end of turn.\n{B}{B}, {T}: Target player loses 2 life and you gain 2 life.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "stormscape-master-protection",
            oracleText:
                "{W}{W}, {T}: Target creature gains protection from the color of your choice until end of turn.",
            cost: { mana: { W: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Grant protection from which color?",
                    modes: STORMSCAPE_MASTER_PROTECTION_MODES,
                },
            ],
        },
        {
            id: "stormscape-master-drain",
            oracleText:
                "{B}{B}, {T}: Target player loses 2 life and you gain 2 life.",
            cost: { mana: { B: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [
                { op: "loseLife", player: { target: 0 }, amount: 2 },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        },
    ],
};

// Nightscape Master — {2}{B}{B} Creature — Zombie Wizard, 2/2. "{U}{U}, {T}:
// Return target creature to its owner's hand. {R}{R}, {T}: This creature
// deals 2 damage to target creature." (CR 400.7 zone change; CR 120.1
// damage.)
export const nightscapeMaster: CardDefinition = {
    id: "d86174b8-dd9e-4ece-bc23-4f9ac50bccd3",
    rarity: "rare",
    name: "Nightscape Master",
    oracleText:
        "{U}{U}, {T}: Return target creature to its owner's hand.\n{R}{R}, {T}: This creature deals 2 damage to target creature.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Zombie", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "nightscape-master-bounce",
            oracleText:
                "{U}{U}, {T}: Return target creature to its owner's hand.",
            cost: { mana: { U: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "nightscape-master-damage",
            oracleText:
                "{R}{R}, {T}: This creature deals 2 damage to target creature.",
            cost: { mana: { R: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

// Thunderscape Apprentice — {R} Creature — Human Wizard, 1/1. "{B}, {T}:
// Target player loses 1 life. {G}, {T}: Target creature gets +1/+1 until
// end of turn." (CR 119.3b life loss; CR 613.4c temporary P/T pump.)
export const thunderscapeApprentice: CardDefinition = {
    id: "75a0b075-5414-48d3-a2b1-47dc20213e96",
    rarity: "common",
    name: "Thunderscape Apprentice",
    oracleText:
        "{B}, {T}: Target player loses 1 life.\n{G}, {T}: Target creature gets +1/+1 until end of turn.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "thunderscape-apprentice-drain",
            oracleText: "{B}, {T}: Target player loses 1 life.",
            cost: { mana: { B: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "loseLife", player: { target: 0 }, amount: 1 }],
        },
        {
            id: "thunderscape-apprentice-pump",
            oracleText:
                "{G}, {T}: Target creature gets +1/+1 until end of turn.",
            cost: { mana: { G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Thunderscape Master — {2}{R}{R} Creature — Human Wizard, 2/2. "{B}{B},
// {T}: Target player loses 2 life and you gain 2 life. {G}{G}, {T}:
// Creatures you control get +2/+2 until end of turn." (CR 119.3b life loss
// + CR 119.3a life gain; CR 613.4c temporary P/T pump swept over a
// `forEach` — the exact Sunscape Master (`white.ts`)/Thornscape Master
// (`green.ts`) "creatures you control get +2/+2" shape, this cycle's third
// occurrence.)
export const thunderscapeMaster: CardDefinition = {
    id: "22abdc2f-bdc8-46c4-8ce2-f06befedbc32",
    rarity: "rare",
    name: "Thunderscape Master",
    oracleText:
        "{B}{B}, {T}: Target player loses 2 life and you gain 2 life.\n{G}{G}, {T}: Creatures you control get +2/+2 until end of turn.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "thunderscape-master-drain",
            oracleText:
                "{B}{B}, {T}: Target player loses 2 life and you gain 2 life.",
            cost: { mana: { B: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [
                { op: "loseLife", player: { target: 0 }, amount: 2 },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        },
        {
            id: "thunderscape-master-pump-team",
            oracleText:
                "{G}{G}, {T}: Creatures you control get +2/+2 until end of turn.",
            cost: { mana: { G: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Deferred (engine capability gaps) — 3-colour + WUBRG (issue #1080)
// ─────────────────────────────────────────────────────────────────────────

// Crosis, the Purger — {3}{U}{B}{R} Legendary Creature — Dragon, 6/6.
// "Flying. Whenever Crosis deals combat damage to a player, you may pay
// {2}{B}. If you do, choose a color, then that player reveals their hand
// and discards all cards of that color." tracked-by: #1120 (the identical
// root cause already catalogued as gap 6 for Void, `red.ts` this same set:
// "`forEach`'s `select` union has no 'hand' set member, and `discard` only
// consumes a `choice` Op's picks — there is no way to sweep a player's hand
// for an UNCHOSEN, filter-matched bulk discard." `EffectCountSpec.zone` is
// likewise restricted to `"battlefield" | "graveyard"` — no hand-zone count
// either, so even a "reveal, then count matching cards" workaround is
// unavailable. The flying body + trigger gate + `mayPay` + colour-choice
// modal are all free; only the mandatory hand-side bulk discard blocks the
// whole card.)

// Darigaaz, the Igniter — {3}{B}{R}{G} Legendary Creature — Dragon, 6/6.
// "Flying. Whenever Darigaaz deals combat damage to a player, you may pay
// {2}{R}. If you do, choose a color, then that player reveals their hand
// and Darigaaz deals damage to the player equal to the number of cards of
// that color revealed this way." tracked-by: #1120 (the SAME root cause as
// Crosis above — "the number of cards of that color revealed this way"
// needs a hand-zone, filter-matched `count`, which `EffectCountSpec` does
// not support for `zone: "hand"`. `reveal`'s player/zone shape carries no
// `bind`, so there is no snapshot to count off of either.)

// Nightscape Apprentice — {B} Creature — Zombie Wizard, 1/1. "{U}, {T}: Put
// target creature you control on top of its owner's library. {R}, {T}:
// Target creature gains first strike until end of turn." tracked-by: #1086
// (same root cause as Sunscape Apprentice, `white.ts`, this same five-pair
// cycle: the `moveZone` Op's `target`-shape, a live battlefield permanent,
// only supports `to: "hand"` — any other destination including `library`
// from a live permanent is unhandled by the interpreter's `moveZone`
// executor. The SECOND ability alone — first-strike grant — is free, but
// "never ship silent partials" (PRD #1063) means the whole card waits for
// the same `moveZone`-to-library extension Sunscape Apprentice is already
// tracked against.)
// shroud. (They can't be the targets of spells or abilities.) {1}, Sacrifice
// this enchantment: Search your library for an enchantment card, reveal it,
// then shuffle and put that card on top." (CR 611/613 layer 6 keyword grant
// + CR 702.18 shroud enforcement, scoped to "other enchantments you
// control"; CR 701.19 search / 701.20 reveal + shuffle / 401.4
// top-of-library, issue #1125.) The static half pairs a `keyword-grant`
// (the reminder string) with a `permanent-guard` (`cantBeTargeted: true`,
// the real CR-702.18-compliant enforcement `isGuardedAgainst` reads) — the
// SAME two-piece pattern every printed-shroud card uses, just both scoped
// by `STERLING_GROVE_AFFECTS_OTHER_ENCHANTMENTS` instead of a self-applies
// predicate. The activated half is the tutor-to-top template: `{1},
// Sacrifice` as its entire cost (no tap), then
// choice(search-library, filter Enchantment) → reveal → shuffle →
// `library-top`.
export const sterlingGrove: CardDefinition = {
    id: "40b26aa3-8169-4978-9554-bd2fc8e18e3b",
    name: "Sterling Grove",
    rarity: "uncommon",
    manaCost: { G: 1, W: 1 },
    types: ["Enchantment"],
    oracleText:
        "Other enchantments you control have shroud. (They can't be the targets of spells or abilities.)\n{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: STERLING_GROVE_AFFECTS_OTHER_ENCHANTMENTS,
            keyword: "shroud",
        },
        {
            kind: "permanent-guard",
            id: "sterling-grove-shroud",
            applies: STERLING_GROVE_AFFECTS_OTHER_ENCHANTMENTS,
            cantBeTargeted: true,
        },
    ],
    activatedAbilities: [
        {
            id: "sterling-grove-search",
            oracleText:
                "{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Enchantment" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an enchantment card.",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "library-top",
                },
            ],
        },
    ],
};
