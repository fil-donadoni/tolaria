// Limited Edition Alpha (LEA), the base set of Magic, split by colour per
// ADR 0043. Every entry is a CardDefinition — LEA is the root set whose cards
// later editions (LEB, 2ED, 3ED, …) reprint via CardPrint, resolving printId →
// definitionId → the shared LEA definition (ADR 0014). Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    CardDefinition,
    PermanentView,
    SpellContext,
    StaticEffectContext,
    TargetSelection,
    TriggerStateView,
} from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { knightStaticAbilities } from "../../abilities";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { damageTakenTrigger } from "../../abilities/triggers/damageTakenTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { makeLace } from "./white";
import { makeUpkeepPayOrElse } from "./white";

// Animate Dead — "Enchant creature card in a graveyard. Return enchanted
// creature card to the battlefield under your control and attach Animate Dead
// to it. When Animate Dead leaves the battlefield, that creature's controller
// sacrifices it. Enchanted creature gets -1/-0." (CR 303.4i graveyard-target
// aura, CR 603.10 LTB-trigger last-known-info.) Implementation:
//
//  - targetRequirement zone:"graveyard" controller:"any" → caster picks a
//    Creature card in any graveyard at cast (CR 601.2c).
//  - The aura branch in `finalizeSpellResolution` detects the graveyard-card
//    target, moves the creature onto the caster's battlefield via
//    `putReanimatedOnBattlefield` (CR 400.7), then attaches Animate Dead.
//  - staticEffect pt-buff -1/0 with `AURA_AFFECTS_HOST` predicate applies the
//    -1/-0 to the reanimated creature (CR 611 layer 7c).
//  - triggeredAbility on PERMANENT_LEFT (self) fires when this Aura departs
//    (destroy / exile / return-to-hand). It reads `attachedToBeforeLeave` from
//    the event (CR 603.10) and calls `sacrifice` on the host. If the host has
//    already left the battlefield by then (e.g. lethal damage), sacrifice is a
//    silent no-op (CR 608.2b).
export const animateDead: CardDefinition = {
    id: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b",
    rarity: "uncommon",
    name: "Animate Dead",
    oracleText:
        "Enchant creature card in a graveyard\nReturn enchanted creature card to the battlefield under your control and attach Animate Dead to it.\nWhen Animate Dead leaves the battlefield, that creature's controller sacrifices it.\nEnchanted creature gets -1/-0.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: -1,
            toughness: 0,
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "anim-dead-ltb",
            oracleText:
                "When Animate Dead leaves the battlefield, that creature's controller sacrifices it.",
            scope: "self",
            resolve: (ctx, _event, leaving) => {
                const hostId = leaving.attachedToBeforeLeave;
                if (!hostId) return;
                ctx.sacrifice(hostId);
            },
        }),
    ],
};

// Bad Moon — "Black creatures get +1/+1." (CR 611 — static layer 7c, color check via CR 202.2)
export const badMoon: CardDefinition = {
    id: "43572906-ea74-4411-a549-5dc401591d2a",
    rarity: "rare",
    name: "Bad Moon",
    oracleText: "Black creatures get +1/+1.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("B"),
            power: 1,
            toughness: 1,
        },
    ],
};

// Black Knight — first strike + protection from white (CR 702.7, 702.16).
export const blackKnight: CardDefinition = {
    id: "c1662949-0d69-49a3-8c69-daf10717ed4e",
    rarity: "uncommon",
    name: "Black Knight",
    oracleText:
        "First strike (This creature deals combat damage before creatures without first strike.)\nProtection from white (This creature can't be blocked, targeted, dealt damage, or enchanted by anything white.)",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: knightStaticAbilities("white"),
};

// Bog Wraith — swampwalk (landwalk keyword, CR 702.13b). Enforced at
// blocker-assignment time by validateBlockerEligibility in gre/combat.ts.
export const bogWraith: CardDefinition = {
    id: "6701874e-986e-4b81-9268-90b6171e6187",
    rarity: "uncommon",
    name: "Bog Wraith",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Wraith"],
    power: 3,
    toughness: 3,
    staticAbilities: ["swampwalk"],
};

// Out of scope — see ADR 0010
// export const contractFromBelow: CardDefinition = {
//     id: "9853b0ce-4763-4877-9741-f9145a3659c6",
//     name: "Contract from Below",
//     oracleText: "Remove this card from your deck before playing if you're not playing for ante.\nDiscard your hand, ante the top card of your library, then draw seven cards.",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

// Cursed Land — "Enchant land. At the beginning of the upkeep of enchanted
// land's controller, Cursed Land deals 1 damage to that player." (CR 303.4
// aura attachment, 603.6a phase trigger). Same shape as Farmstead/Feedback —
// trigger fires on the host's controller's upkeep only.
export const cursedLand: CardDefinition = {
    id: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a",
    rarity: "uncommon",
    name: "Cursed Land",
    oracleText:
        "Enchant land\nAt the beginning of the upkeep of enchanted land's controller, this Aura deals 1 damage to that player.",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "cursed-land-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted land's controller, Cursed Land deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 1);
            },
        }),
    ],
};

export const darkRitual: CardDefinition = {
    id: "ebb6664d-23ca-456e-9916-afcd6f26aa7f",
    rarity: "common",
    name: "Dark Ritual",
    oracleText: "Add {B}{B}{B}.",
    manaCost: { B: 1 },
    types: ["Instant"],
    effects: [{ op: "addMana", mana: { B: 3 } }],
};

// Out of scope — see ADR 0010
// export const darkpact: CardDefinition = {
//     id: "e78db688-93a2-47f5-9aa5-9158a72cd973",
//     name: "Darkpact",
//     oracleText: "Remove this card from your deck before playing if you're not playing for ante.\nYou own target card in the ante. Exchange that card with the top card of your library.",
//     manaCost: { B: 3 },
//     types: ["Sorcery"],
// };

// Deathgrip — "{B}, Sacrifice Deathgrip: Counter target green spell." (CR
// 701.5a counter, 202.2 color filter on stack target).
export const deathgrip: CardDefinition = {
    id: "2371c126-f19a-472a-ba5f-3b1366274ea0",
    rarity: "uncommon",
    name: "Deathgrip",
    oracleText: "{B}{B}: Counter target green spell.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "deathgrip-counter",
            oracleText: "{B}, Sacrifice Deathgrip: Counter target green spell.",
            cost: { mana: { B: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                colorFilter: "G",
            },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

export const deathlace: CardDefinition = makeLace({
    id: "6ff1cefc-62cb-4525-b0c5-2b09603b4314",
    rarity: "rare",
    name: "Deathlace",
    oracleText:
        "Target spell or permanent becomes black. (Mana symbols on that permanent remain unchanged.)",
    manaCost: { B: 1 },
    color: "B",
});

// Out of scope — see ADR 0010
// export const demonicAttorney: CardDefinition = {
//     id: "fd891fc6-d9d6-494e-ae65-8bea8f44b575",
//     name: "Demonic Attorney",
//     oracleText: "Remove this card from your deck before playing if you're not playing for ante.\nEach player antes the top card of their library.",
//     manaCost: { X: 1, B: 2 },
//     types: ["Sorcery"],
// };

// Demonic Hordes — "{T}: Destroy target land. At the beginning of your
// upkeep, unless you pay {B}{B}{B}, tap this creature and sacrifice a land
// of an opponent's choice." (CR 701.6 destroy, CR 603.6a phase trigger,
// CR 117.3a optional cost.) The novel piece is the cross-player choice on
// decline: the OPPONENT picks which of the controller's lands to sacrifice.
// Implemented via `requestChoice` with `zoneOwnerId: ctx.controller` —
// chooser is the opp, but the candidate set is from controller's
// battlefield.
export const demonicHordes: CardDefinition = {
    id: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50",
    rarity: "rare",
    name: "Demonic Hordes",
    oracleText:
        "{T}: Destroy target land.\nAt the beginning of your upkeep, unless you pay {B}{B}{B}, tap this creature and sacrifice a land of an opponent's choice.",
    manaCost: { X: 3, B: 3 },
    types: ["Creature"],
    subtypes: ["Demon"],
    power: 5,
    toughness: 5,
    activatedAbilities: [
        {
            id: "demonic-hordes-destroy-land",
            oracleText: "{T}: Destroy target land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "demonic-hordes-upkeep",
            oracleText:
                "At the beginning of your upkeep, unless you pay {B}{B}{B}, tap this creature and sacrifice a land of an opponent's choice.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): on decline, the OPPONENT chooses
            // which of the CONTROLLER's lands to sacrifice (a cross-player
            // choice — chooser ≠ zone owner, resolved via apNapOrder +
            // requestChoice with zoneOwnerId). The `choice` Op picks from the
            // resolving player's own zone; it cannot express an opponent-driven
            // pick of the controller's permanents.
            // Blocked on: a cross-player (chooser ≠ owner) choice selector.
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { B: 3 },
                    prompt: "Pay {B}{B}{B} to skip Demonic Hordes's upkeep penalty?",
                });
                if (accept === undefined) return;
                if (accept) return;
                // Decline → tap self + opp picks one of our lands to sac.
                ctx.tap({ type: "permanent", id: ctx.sourceInstanceId });
                const opps = ctx
                    .apNapOrder()
                    .filter((p) => p !== ctx.controller);
                const opp = opps[0];
                if (!opp) return;
                const lands = ctx.getBattlefieldIds(ctx.controller, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: opp,
                    choiceId: `demonic-hordes-sac-${ctx.sourceInstanceId}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    zoneOwnerId: ctx.controller,
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Demonic Hordes: choose a land to sacrifice from opponent's battlefield.",
                });
                if (picks === undefined) return;
                for (const id of picks) ctx.sacrifice(id);
            },
        }),
    ],
};

// Demonic Tutor — "Search your library for a card, then shuffle and put that
// card on top." (CR 701.19 for search, CR 701.20 for shuffle). Modern oracle
// simplifies to "Search your library for a card, put it into your hand, then
// shuffle." Implemented as a two-step resolve: step 0 enqueues a
// search-library pending choice (count=1); step 1 moves the picked card into
// the caster's hand and shuffles.
export const demonicTutor: CardDefinition = {
    id: "711d4d54-5520-4de8-9b93-79902ed8e562",
    rarity: "uncommon",
    name: "Demonic Tutor",
    oracleText:
        "Search your library for a card, put that card into your hand, then shuffle.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045): the "then shuffle" tail is now a
    // libraryLook Op (issue #844), but the search half moves a CHOICE-PICKED
    // LIBRARY card into hand — the `moveZone` Op only sources the battlefield /
    // graveyard (its `resolveObjectRef` is battlefield-scoped and its card-by-id
    // branch hardcodes the graveyard source), and no selector references a
    // library card a `choice` bound. The classifier over-counts this FREE
    // because `moveCardById` reads as a covered `moveZone` primitive; it is not
    // covered for a library source.
    // Blocked on: a library-sourced move of a choice-picked card (planned —
    // a `moveZone` extension for library sources / a search-and-move Op).
    resolveSteps: [
        (ctx: SpellContext) => {
            const picks = ctx.requestChoice({
                playerId: ctx.caster,
                choiceId: ctx.caster,
                kind: "search-library",
                zone: "library",
                count: 1,
                prompt: "Search your library for a card.",
            });
            if (!picks || picks.length === 0) return;
            ctx.moveCardById(ctx.caster, picks[0], "library", "hand");
            ctx.shuffleLibrary(ctx.caster);
        },
    ],
};

// Drain Life — "Drain Life deals X damage to any target. You gain life equal
// to the damage dealt." (CR 107.3 for X, CR 120.1 for damage, CR 118.3 for
// life gain). The LEA "spend only black mana on X" restriction is out of
// scope — X is treated as generic here, matching Fireball's payment model.
export const drainLife: CardDefinition = {
    id: "5d077a49-73d4-4958-b42a-31b814e110e8",
    rarity: "common",
    name: "Drain Life",
    oracleText:
        "Spend only black mana on X.\nDrain Life deals X damage to any target. You gain life equal to the damage dealt, but not more life than the player's life total before the damage was dealt, the planeswalker's loyalty before the damage was dealt, or the creature's toughness.",
    manaCost: { X: "X", B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const x = ctx.getX();
        ctx.dealDamage(ctx.targets[0], x);
        ctx.gainLife(ctx.caster, x);
    },
};

// Drudge Skeletons — "{B}: Regenerate Drudge Skeletons." (CR 701.15a regen,
// 614.5 destroy replacement). Self-targeting via `ctx.sourceInstanceId`, no
// targetRequirement on the activated ability.
export const drudgeSkeletons: CardDefinition = {
    id: "23614289-0d73-4747-a849-5cb67cc97d6a",
    rarity: "common",
    name: "Drudge Skeletons",
    oracleText:
        "{B}: Regenerate this creature. (The next time this creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Skeleton"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "drudge-skeletons-regenerate",
            oracleText: "{B}: Regenerate Drudge Skeletons.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Evil Presence — "Enchant land. Enchanted land is a Swamp." (CR 305.7
// subtype replacement, CR 303.4 aura). Layer 4 subtype-set replaces the
// host's subtypes with ["Swamp"], which also changes its mana production
// via getBasicLandMana (Swamp → {B}).
export const evilPresence: CardDefinition = {
    id: "0551d66e-8cd4-48f0-aa17-15f26be9d85f",
    rarity: "uncommon",
    name: "Evil Presence",
    oracleText: "Enchant land\nEnchanted land is a Swamp.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "subtype-set",
            applies: AURA_AFFECTS_HOST,
            subtypes: ["Swamp"],
        },
    ],
};

// Fear — "Enchant creature. Enchanted creature has fear (it can't be blocked
// except by artifact creatures and/or black creatures)." (CR 303.4 aura,
// 702.36b fear). Granted as `fear` keyword on the host; the combat validator
// enforces the artifact-or-black blocker check.
export const fear: CardDefinition = {
    id: "0cd927be-e63f-4371-a1d8-7a0489cb187e",
    rarity: "common",
    name: "Fear",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "fear",
        },
    ],
};

// Frozen Shade — "{B}: This creature gets +1/+1 until end of turn." (CR 113.1
// activated, 611.1 temporary P/T modification). Self-targeting pump using
// the new `addTemporaryPTBuff` primitive.
export const frozenShade: CardDefinition = {
    id: "d0bd76c8-4cff-4c15-9686-7a299b589814",
    rarity: "common",
    name: "Frozen Shade",
    oracleText: "{B}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Shade"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "frozen-shade-pump",
            oracleText: "{B}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Gloom — "White spells cost {3} more to cast. Activated abilities of white
// enchantments cost {3} more to activate." (CR 601.2f cost modification).
export const gloom: CardDefinition = {
    id: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f",
    rarity: "uncommon",
    name: "Gloom",
    oracleText:
        "White spells cost {3} more to cast.\nActivated abilities of white enchantments cost {3} more to activate.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card: PermanentView, ctx: StaticEffectContext) =>
                ctx.getColors(card).includes("W"),
            appliesToAbility: (
                source: PermanentView,
                ctx: StaticEffectContext
            ) =>
                ctx.getColors(source).includes("W") &&
                source.types.includes("Enchantment"),
            costIncrease: { X: 3 },
        },
    ],
};

// Howl from Beyond — "Target creature gets +X/+0 until end of turn." (CR 107.3
// X cost, 611.1 temp P/T mod). Single-target pump scaled by paid X.
export const howlFromBeyond: CardDefinition = {
    id: "67ec17e1-174b-4d07-a27f-91a333c4b2fb",
    rarity: "common",
    name: "Howl from Beyond",
    oracleText: "Target creature gets +X/+0 until end of turn.",
    manaCost: { X: "X", B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        ctx.addTemporaryPTBuff(target, ctx.getX(), 0, {
            phase: "end-of-turn",
        });
    },
};

// Hypnotic Specter — CR 603 triggered ability on combat/spell damage to an
// opponent. The random discard uses the game's seeded PRNG (CR 701.8a).
export const hypnoticSpecter: CardDefinition = {
    id: "b43b900f-2d9b-442b-9699-058483604ec9",
    rarity: "uncommon",
    name: "Hypnotic Specter",
    oracleText:
        "Flying\nWhenever this creature deals damage to an opponent, that player discards a card at random.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Specter"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        damageDealtTrigger({
            id: "hypnotic-specter-discard",
            oracleText:
                "Whenever Hypnotic Specter deals damage to an opponent, that player discards a card at random.",
            source: "self",
            target: { kind: "player", player: { relation: "opponent" } },
            resolve: (ctx, _event, damage) => {
                if (damage.target.type !== "player") return;
                ctx.discardAtRandom(damage.target.id, 1);
            },
        }),
    ],
};

// Lich — multi-replacement enchantment that turns its controller's life
// total into a draw-engine and a sacrifice-engine. CR-faithful clauses:
//
//   1. ETB: lose life equal to current life (CR 614.1 "as ~ enters" is
//      modeled here as a PERMANENT_ENTERED trigger that immediately calls
//      `loseLife`; the lose drops the player to 0, then the lose-game
//      replacement below protects them).
//   2. Lose-game replacement (CR 614 / 104.3): the controller doesn't lose
//      from `life-zero`. Consumed in `checkGameOverSBA`.
//   3. Lifegain replacement (CR 614): "if you would gain life, draw that
//      many cards instead." Consumes the gainLife event and calls
//      `drawCards` via the apply ctx.
//   4. Damage trigger (CR 603): "whenever you're dealt damage, sacrifice
//      that many nontoken permanents. If you can't, you lose the game."
//      Counts non-token permanents controlled by Lich's controller
//      (excluding Lich itself, CR 701.16) and sacrifices that many; falls
//      back to a forced loss via `ctx.loseGame` when the supply runs out.
//   5. LTB trigger (CR 603): when Lich is put into a graveyard from the
//      battlefield, controller loses the game outright. Fires after Lich
//      has left play so its own lose-game replacement no longer protects.
//
// Scope notes: the sacrifice choice is deterministic (battlefield-order
// non-token, non-Lich) rather than player-driven — CR 701.16 says the
// controller picks, but mid-trigger choice requires a richer pendingChoices
// integration than this wave. Documented limitation.
export const lich: CardDefinition = {
    id: "4250caec-0e37-41be-9ec4-8938deb5f0d0",
    rarity: "rare",
    name: "Lich",
    oracleText:
        "As this enchantment enters, you lose life equal to your life total.\nYou don't lose the game for having 0 or less life.\nIf you would gain life, draw that many cards instead.\nWhenever you're dealt damage, sacrifice that many nontoken permanents. If you can't, you lose the game.\nWhen this enchantment is put into a graveyard from the battlefield, you lose the game.",
    // Modern Scryfall oracle cost is {B}{B}{B}{B} (the Alpha {2}{B}{B} print was
    // superseded by errata).
    manaCost: { B: 4 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "lich-etb",
            oracleText:
                "As this enchantment enters, you lose life equal to your life total.",
            scope: "self",
            resolve: (ctx) => {
                const life = ctx.getLife(ctx.controller);
                if (life > 0) ctx.loseLife(ctx.controller, life);
            },
        }),
        damageTakenTrigger({
            id: "lich-damage",
            oracleText:
                "Whenever you're dealt damage, sacrifice that many nontoken permanents. If you can't, you lose the game.",
            target: { kind: "player", player: { relation: "controller" } },
            resolve: (ctx, _event, damage) => {
                const amount = damage.amount;
                if (amount <= 0) return;
                // CR 701.16 — controller picks. Filter to nontoken permanents
                // other than Lich itself (avoids self-sacrifice forcing the
                // LTB-lose trigger to fire spuriously).
                const filter = {
                    isToken: false,
                    excludeInstanceIds: [ctx.sourceInstanceId],
                };
                const candidates = ctx.getBattlefieldIds(
                    ctx.controller,
                    filter
                );
                // "If you can't" — fewer candidates than required → sacrifice
                // all available, then loseGame.
                if (candidates.length < amount) {
                    for (const id of candidates) ctx.sacrifice(id);
                    ctx.loseGame(ctx.controller);
                    return;
                }
                // CR 701.16 player choice — directly pick N permanents to
                // sacrifice. If candidates equal `amount` exactly, there is
                // no meaningful pick: sac all without prompting (saves a
                // round-trip on an empty choice).
                if (candidates.length === amount) {
                    for (const id of candidates) ctx.sacrifice(id);
                    return;
                }
                const sacPicks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `lich-${ctx.sourceInstanceId}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter,
                    count: amount,
                    prompt: `Lich: choose ${amount} permanent${
                        amount === 1 ? "" : "s"
                    } to sacrifice.`,
                });
                if (sacPicks === undefined) return;
                for (const id of sacPicks) ctx.sacrifice(id);
            },
        }),
        leftTrigger({
            id: "lich-ltb",
            oracleText:
                "When this enchantment is put into a graveyard from the battlefield, you lose the game.",
            scope: "self",
            toZone: "graveyard",
            resolve: (ctx, _event, leaving) => {
                ctx.loseGame(leaving.controllerId);
            },
        }),
    ],
    replacementEffects: [
        {
            id: "lich-no-lose",
            oracleText: "You don't lose the game for having 0 or less life.",
            eventKind: "lose-game",
            appliesTo: (event, self) => {
                if (event.kind !== "lose-game") return false;
                if (event.reason !== "life-zero") return false;
                return event.playerId === self.controllerId;
            },
            replace: () => ({ kind: "consumed" }),
        },
        {
            id: "lich-lifegain",
            oracleText: "If you would gain life, draw that many cards instead.",
            eventKind: "lifegain",
            appliesTo: (event, self) => {
                if (event.kind !== "lifegain") return false;
                return event.playerId === self.controllerId;
            },
            replace: (event, ctx) => {
                if (event.kind !== "lifegain") return { kind: "consumed" };
                ctx.drawCards(event.playerId, event.amount);
                return { kind: "consumed" };
            },
        },
    ],
};

export const lordOfThePit: CardDefinition = {
    id: "2926777a-4f6e-4965-ba83-22cf7df02602",
    rarity: "rare",
    name: "Lord of the Pit",
    oracleText:
        "Flying, trample\nAt the beginning of your upkeep, sacrifice a creature other than Lord of the Pit. If you can't, Lord of the Pit deals 7 damage to you.",
    manaCost: { X: 4, B: 3 },
    types: ["Creature"],
    subtypes: ["Demon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "lord-of-the-pit-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice a creature other than Lord of the Pit. If you can't, Lord of the Pit deals 7 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const others = ctx.getBattlefieldIds(ctx.controller, {
                    types: "Creature",
                    excludeInstanceIds: [ctx.sourceInstanceId],
                });
                if (others.length === 0) {
                    ctx.dealDamage({ type: "player", id: ctx.controller }, 7);
                    return;
                }
                const pick = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: {
                        types: "Creature",
                        excludeInstanceIds: [ctx.sourceInstanceId],
                    },
                    count: 1,
                    prompt: "Sacrifice a creature other than Lord of the Pit.",
                });
                if (pick === undefined) return;
                ctx.sacrifice(pick[0]);
            },
        }),
    ],
};

// Mind Twist — "Target player discards X cards at random." (CR 107.3 X cost,
// 701.8a random discard). Routes through `discardAtRandom` which uses the
// game's seeded PRNG for deterministic replays.
export const mindTwist: CardDefinition = {
    id: "eee9e106-a248-49d2-b8c8-6bbcd56ce739",
    rarity: "rare",
    name: "Mind Twist",
    oracleText: "Target player discards X cards at random.",
    manaCost: { X: "X", B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") {
            ctx.discardAtRandom(target.id, ctx.getX());
        }
    },
};

// Nether Shadow — "Haste. At the beginning of your upkeep, if this card is in
// your graveyard with three or more creature cards above it, you may put this
// card onto the battlefield." (CR 603.6e graveyard-zone trigger, 603.4d
// intervening-if, 603.10.) The trigger opts into `collectTriggers`' graveyard
// scan via `zone: "graveyard"`; the intervening-if counts creature cards
// stacked above Nether Shadow in its owner's graveyard (index 0 = bottom,
// last = top, so "above" = higher index).
function creatureCardsAboveInGraveyard(
    state: TriggerStateView | undefined,
    self: PermanentView
): number {
    const graveyard = state?.players.find(
        (p) => p.id === self.ownerId
    )?.graveyard;
    if (!graveyard) return 0;
    const idx = graveyard.findIndex((c) => c.id === self.id);
    if (idx === -1) return 0;
    let count = 0;
    for (let i = idx + 1; i < graveyard.length; i++) {
        if (graveyard[i].types.includes("Creature")) count++;
    }
    return count;
}

export const netherShadow: CardDefinition = {
    id: "f13ad58a-6f9b-420a-bac1-40929f5e616a",
    rarity: "rare",
    name: "Nether Shadow",
    oracleText:
        "Haste\nAt the beginning of your upkeep, if this card is in your graveyard with three or more creature cards above it, you may put this card onto the battlefield.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 1,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        phaseTrigger({
            id: "nether-shadow-reanimate",
            oracleText:
                "At the beginning of your upkeep, if this card is in your graveyard with three or more creature cards above it, you may put this card onto the battlefield.",
            phase: "UPKEEP",
            scope: "your",
            zone: "graveyard",
            interveningIf: (_event, self, state) =>
                creatureCardsAboveInGraveyard(state, self) >= 3,
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `nether-shadow-${ctx.sourceInstanceId}`,
                    prompt: "Return Nether Shadow to the battlefield?",
                });
                if (accept === undefined) return;
                if (accept) {
                    ctx.returnToBattlefield(
                        ctx.controller,
                        ctx.sourceInstanceId,
                        "graveyard"
                    );
                }
            },
        }),
    ],
};

// Nettling Imp — "{T}: Target non-Wall creature the active player controls
// attacks this combat if able. If it doesn't, destroy it at the beginning of
// the next end step. Activate only before attackers are declared."
// (CR 508.1d, 603.7a, 602.5)
//
// canActivate enforces "only during opponent's turn" (active != controller).
// activationPhaseRestriction enforces "before attackers are declared" (phases
// before DECLARE_ATTACKERS). resolve sets mustAttackThisTurn on the target and
// schedules a delayed end-step trigger that checks hasAttackedThisTurn.
const NETTLING_IMP_ID = "8105973c-a94d-444c-ba20-ab0fa978bee8";

export const nettlingImp: CardDefinition = {
    id: NETTLING_IMP_ID,
    rarity: "uncommon",
    name: "Nettling Imp",
    oracleText:
        "{T}: Target non-Wall creature the active player controls attacks this combat if able. If it doesn't, destroy it at the beginning of the next end step. Activate only during an opponent's turn, before attackers are declared.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "nettling-imp-force",
            oracleText:
                "{T}: Target non-Wall creature the active player controls attacks this combat if able. If it doesn't, destroy it at the beginning of the next end step.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
                excludeSubtypes: "Wall",
            },
            activationPhaseRestriction: [
                "UPKEEP",
                "DRAW",
                "PRECOMBAT_MAIN",
                "BEGINNING_OF_COMBAT",
            ],
            canActivate: (source, state) =>
                state.activePlayerId !== source.controllerId,
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "permanent") return;
                ctx.setMustAttackThisTurn(target);
                ctx.scheduleDelayedTrigger(
                    NETTLING_IMP_ID,
                    "nettling-imp-destroy",
                    "next-end-step",
                    { targetId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "nettling-imp-destroy",
            oracleText:
                "Destroy that creature at the beginning of the next end step if it didn't attack this turn.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                const target = { type: "permanent" as const, id: targetId };
                if (ctx.hasAttackedThisTurn(target)) return;
                ctx.destroy(target);
            },
        },
    ],
};

// Nightmare — Flying. "Nightmare's power and toughness are each equal to the
// number of Swamps you control." (CR 604.3 CDA, layer 7b). Modeled as a
// pt-cda static effect scoped to the card itself; base 0/0 means the CDA's
// output is the effective stat line. CR 208.2 still applies: if the CDA
// returns 0, the card is a 0/0 and dies to SBA unless otherwise buffed.
export const nightmare: CardDefinition = {
    id: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b",
    rarity: "rare",
    name: "Nightmare",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\nNightmare's power and toughness are each equal to the number of Swamps you control.",
    manaCost: { X: 5, B: 1 },
    types: ["Creature"],
    subtypes: ["Nightmare", "Horse"],
    power: 0,
    toughness: 0,
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let swamps = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.subtypes.includes("Swamp")
                        ) {
                            swamps++;
                        }
                    }
                }
                return { power: swamps, toughness: swamps };
            },
        },
    ],
};

// Paralyze — "Enchant creature. When this Aura enters, tap enchanted
// creature. Enchanted creature doesn't untap during its controller's untap
// step. At the beginning of the upkeep of enchanted creature's controller,
// that player may pay {4}. If the player does, untap the creature."
// (CR 303.4 aura, 502.1 untap restriction, 603.6a upkeep trigger, 611
// keyword-grant). The ETB-tap is executed in the aura's `resolve()` — the
// spell context fires before `finalizeSpellResolution` ETBs the aura
// attached, so tapping the targeted host here is well-defined. The
// keyword-grant publishes `does-not-untap` onto the host via
// `AURA_AFFECTS_HOST`; the host stays tapped through the controller's untap
// step until they pay {4} on upkeep.
export const paralyze: CardDefinition = {
    id: "be33a155-de26-43d1-88f1-c926f1b7cb7c",
    rarity: "common",
    name: "Paralyze",
    oracleText:
        "Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step.\nAt the beginning of the upkeep of enchanted creature's controller, that player may pay {4}. If the player does, untap the creature.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "does-not-untap",
        },
    ],
    // Migrated resolve()→effects[] (ADR 0045, #842): the aura's ETB tap-the-
    // host effect (CR 603) — tap the announced creature target (slot 0), the
    // future host, before `finalizeSpellResolution` attaches the aura.
    effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
    triggeredAbilities: [
        phaseTrigger({
            id: "paralyze-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, that player may pay {4}. If the player does, untap the creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045): untaps the enchanted host
            // (`getAttachedTo` — an attached-object target with no selector
            // member) on a `host-controller`-scoped trigger (scoped player ≠
            // controller, so `effects` is disallowed on the phaseTrigger).
            // Blocked on: attached-object selector + non-"your" trigger effects.
            resolve: (ctx, _event, hostController) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: hostController,
                    cost: { X: 4 },
                    prompt: "Pay {4} to untap the creature paralyzed?",
                });
                if (accept === undefined) return;
                if (accept) {
                    ctx.untap({ type: "permanent", id: hostId });
                }
            },
        }),
    ],
};

// Pestilence — "At the beginning of the upkeep of Pestilence's controller,
// sacrifice Pestilence unless that player pays {B}. {B}: Pestilence deals 1
// damage to each creature and each player." (CR 603.6a phase trigger, 117.3a
// optional cost, 120.3 damage to each). The "sacrifice unless pay" clause
// uses requestMayPay with sacrifice as the fail branch. Activated ability
// can only be activated while a creature is on the battlefield (CR 605.2).
export const pestilence: CardDefinition = {
    id: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a",
    rarity: "common",
    name: "Pestilence",
    oracleText:
        "At the beginning of the end step, if no creatures are on the battlefield, sacrifice this enchantment.\n{B}: This enchantment deals 1 damage to each creature and each player.",
    manaCost: { X: 2, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "pestilence-upkeep",
            oracleText:
                "At the beginning of the upkeep of Pestilence's controller, sacrifice Pestilence unless that player pays {B}.",
            cost: { B: 1 },
            prompt: "Pay {B} to keep Pestilence?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
    activatedAbilities: [
        {
            id: "pestilence-damage",
            oracleText:
                "{B}: Pestilence deals 1 damage to each creature and each player.",
            cost: { mana: { B: 1 } },
            useStack: true,
            canActivate: (_source, state) => {
                for (const p of state.players)
                    for (const c of p.battlefield)
                        if (c.types.includes("Creature")) return true;
                return false;
            },
            // dealDamageToEach(1, creatures+players) → forEach-per-set
            // (CR 120.3). Deal 1 to each creature, then 1 to each player.
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        { op: "dealDamage", amount: 1, to: { ref: "$each" } },
                    ],
                },
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ],
        },
    ],
};

// Plague Rats — "Plague Rats's power and toughness are each equal to the
// number of creatures named Plague Rats on the battlefield." (CR 604.3 CDA,
// 207.2 name match). Same pt-cda shape as Nightmare; counts every Plague
// Rats across both battlefields, regardless of controller.
export const plagueRats: CardDefinition = {
    id: "b3724e40-0622-4aee-9334-6c9fff88bcd5",
    rarity: "common",
    name: "Plague Rats",
    oracleText:
        "Plague Rats's power and toughness are each equal to the number of creatures named Plague Rats on the battlefield.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Rat"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state) => {
                let count = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        const cardId = (p.card as { id?: string }).id;
                        if (cardId === "b3724e40-0622-4aee-9334-6c9fff88bcd5") {
                            count++;
                        }
                    }
                }
                return { power: count, toughness: count };
            },
        },
    ],
};

// Raise Dead — "Return target creature card from your graveyard to your hand."
// (CR 400.7 zone change, 608.2b illegal target → no-op). Mirrors Regrowth's
// targeting shape but constrained to Creature cards.
export const raiseDead: CardDefinition = {
    id: "ce07bede-2219-427c-a61a-56518751de42",
    rarity: "common",
    name: "Raise Dead",
    oracleText: "Return target creature card from your graveyard to your hand.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    // Migrated resolve()→effects[] (ADR 0045, #839): return the targeted
    // graveyard creature card to its owner's hand (CR 400.7).
    effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
};

// Royal Assassin — "{T}: Destroy target tapped creature." (CR 701.20 for
// tap-state, CR 701.7 for destroy). The tappedFilter on TargetRequirement
// enforces legality at activation (CR 602.2b); the resolve re-checks at
// resolution (CR 608.2b) so an opposing Twiddle-style untap fizzles this.
export const royalAssassin: CardDefinition = {
    id: "59590768-fa96-4869-8763-9d5ab6ac22ad",
    rarity: "rare",
    name: "Royal Assassin",
    oracleText: "{T}: Destroy target tapped creature.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Assassin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "royal-assassin-destroy",
            oracleText: "{T}: Destroy target tapped creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                tappedFilter: "tapped",
            },
            // NOT DSL-migratable (ADR 0045): the resolution-time re-check that
            // the target is still tapped (CR 608.2b — an in-response untap
            // fizzles this) is load-bearing and has no `destroy`-Op predicate
            // form. Blocked on: an `if` predicate over a target's tap state.
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                if (!ctx.getIsTapped(target)) return;
                ctx.destroy(target);
            },
        },
    ],
};

// Sacrifice — "As an additional cost to cast this spell, sacrifice a
// creature. Add an amount of {B} equal to the sacrificed creature's mana
// value." (CR 117.9 / 601.2f additional cost, CR 202.3 mana value, CR 605
// mana ability surrogate.) The engine validates ≥1 creature available at
// announcement and the player picks the target via selectAdditionalCost
// before mana payment can complete. The sacrificed creature's mana value
// is snapshotted on the stack item for the resolve.
export const sacrifice: CardDefinition = {
    id: "12164aee-6a27-4246-8d15-2d6dd20d92e9",
    rarity: "uncommon",
    name: "Sacrifice",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nAdd an amount of {B} equal to the sacrificed creature's mana value.",
    manaCost: { B: 1 },
    types: ["Instant"],
    additionalCosts: {
        sacrificeFilter: { types: "Creature" },
    },
    // NOT DSL-migratable (ADR 0045): the produced {B} amount equals the
    // sacrificed creature's mana value (a runtime read, getAdditionalSacrificeMv).
    // The EffectValue grammar has no sacrificed-cost / mana-value member, so the
    // amount is not statically expressible. Planned-migratable. Blocked on: a
    // mana-value / sacrificed-cost EffectValue construct.
    resolve: (ctx: SpellContext) => {
        const mv = ctx.getAdditionalSacrificeMv();
        if (mv === undefined || mv <= 0) return;
        ctx.addMana({ B: mv });
    },
};

export const scatheZombies: CardDefinition = {
    id: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e",
    rarity: "common",
    name: "Scathe Zombies",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
};

// Scavenging Ghoul — "At the beginning of each end step, put a corpse counter
// on this creature for each creature that died this turn. / Remove a corpse
// counter from this creature: Regenerate this creature." (CR 603.6a end-step
// trigger, CR 122.1 counter, CR 701.15a regenerate). The deaths-this-turn
// tally is maintained on `GameState.deathsThisTurn` and reset on advanceTurn.
export const scavengingGhoul: CardDefinition = {
    id: "426984e0-88e1-4a2d-9a1c-798b95864df3",
    rarity: "uncommon",
    name: "Scavenging Ghoul",
    oracleText:
        "At the beginning of each end step, put a corpse counter on this creature for each creature that died this turn.\nRemove a corpse counter from this creature: Regenerate this creature.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "scavenging-ghoul-corpse",
            oracleText:
                "At the beginning of each end step, put a corpse counter on this creature for each creature that died this turn.",
            phase: "END_STEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): planned-migratable, blocked on a
            // value construct. The counter count is "for each creature that
            // died this turn" (`getDeathsThisTurn`), a running game tally the
            // `count` grammar (battlefield/graveyard card sets only) cannot
            // express. Stays resolve() until a deaths-this-turn value member
            // exists.
            resolve: (ctx) => {
                const n = ctx.getDeathsThisTurn();
                if (n <= 0) return;
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "corpse",
                    n
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "scavenging-ghoul-regenerate",
            oracleText:
                "Remove a corpse counter from this creature: Regenerate this creature.",
            cost: { removeCounter: { type: "corpse", count: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Sengir Vampire — flying, 4/4. "Whenever another creature dies, if Sengir
// Vampire dealt damage to it this turn, put a +1/+1 counter on Sengir
// Vampire." (CR 603.2 death trigger, CR 122.1 +1/+1 counter, layer 7d).
export const sengirVampire: CardDefinition = {
    id: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9",
    rarity: "uncommon",
    name: "Sengir Vampire",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\nWhenever a creature dealt damage by this creature this turn dies, put a +1/+1 counter on this creature.",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Vampire"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        diedTrigger({
            id: "sengir-vampire-counter",
            oracleText:
                "Whenever another creature dies, if Sengir Vampire dealt damage to it this turn, put a +1/+1 counter on Sengir Vampire.",
            scope: "any-other",
            condition: (event, self) =>
                event.damagedBySources.includes(self.id),
            // NOT DSL-migratable (ADR 0045): built via the `diedTrigger`
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

// Simulacrum — "You gain life equal to the damage dealt to you this turn.
// Simulacrum deals damage to target creature you control equal to the damage
// dealt to you this turn." (CR 120.3 per-turn damage tally, read via
// `getDamageDealtThisTurn`.) Not strictly a replacement effect — included
// in the gap-U batch because it consumes the damage-tracking infrastructure
// installed alongside the replacement framework.
//
// `controller: "you"` enforces the "creature you control" restriction at
// target selection (CR 109.3 via `getLegalTargets`).
export const simulacrum: CardDefinition = {
    id: "35c3a78d-cc79-4187-929a-8aa1d1469990",
    rarity: "uncommon",
    name: "Simulacrum",
    oracleText:
        "You gain life equal to the damage dealt to you this turn. Simulacrum deals damage to target creature you control equal to the damage dealt to you this turn.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    // NOT DSL-migratable (ADR 0045): both amounts are "damage dealt to you
    // this turn", a runtime read the EffectValue grammar (literal|ref|count)
    // cannot express. Blocked on: a per-turn-damage-tally value construct.
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "permanent") return;
        const damage = ctx.getDamageDealtThisTurn(ctx.caster);
        if (damage <= 0) return;
        ctx.gainLife(ctx.caster, damage);
        ctx.dealDamage(t, damage);
    },
};

// Sinkhole — "Destroy target land." (CR 701.7). Targeting uses the generic
// Land type filter; resolution delegates to the shared destroy primitive.
export const sinkhole: CardDefinition = {
    id: "04b31611-9053-4eaf-b392-21bb644fef5f",
    rarity: "common",
    name: "Sinkhole",
    oracleText: "Destroy target land.",
    manaCost: { B: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effect: "destroy-target",
};

// Unholy Strength — "Enchanted creature gets +2/+1." Mirror of Holy Strength.
export const unholyStrength: CardDefinition = {
    id: "90563f90-0127-4164-b43b-f0321dc63a1d",
    rarity: "common",
    name: "Unholy Strength",
    oracleText: "Enchant creature\nEnchanted creature gets +2/+1.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 2,
            toughness: 1,
        },
    ],
};

// Wall of Bone — "Defender. {B}: Regenerate Wall of Bone." Same regen shape as
// Drudge Skeletons; blocked from attacking by the Defender keyword (CR 702.3).
export const wallOfBone: CardDefinition = {
    id: "ae20d442-a544-4a03-9ebf-5ecb137c67dd",
    rarity: "uncommon",
    name: "Wall of Bone",
    oracleText:
        "Defender (This creature can't attack.)\n{B}: Regenerate this creature. (The next time this creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Skeleton", "Wall"],
    power: 1,
    toughness: 4,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-bone-regenerate",
            oracleText: "{B}: Regenerate Wall of Bone.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Warp Artifact — "Enchant artifact. At the beginning of the upkeep of
// enchanted artifact's controller, Warp Artifact deals 1 damage to that
// player." Mirror of Cursed Land/Feedback, hosting on Artifact instead.
export const warpArtifact: CardDefinition = {
    id: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5",
    rarity: "rare",
    name: "Warp Artifact",
    oracleText:
        "Enchant artifact\nAt the beginning of the upkeep of enchanted artifact's controller, this Aura deals 1 damage to that player.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "warp-artifact-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted artifact's controller, Warp Artifact deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 1);
            },
        }),
    ],
};

// Weakness — "Enchanted creature gets -2/-1." Negative pt-buff aura. Lethal
// at -1 toughness if base + buffs ≤ 1; SBA 704.5g sweeps the resulting
// 0-toughness creature on the next checkpoint.
export const weakness: CardDefinition = {
    id: "36ca06a1-9b9a-49a2-9c47-9b72228621bc",
    rarity: "common",
    name: "Weakness",
    oracleText: "Enchant creature\nEnchanted creature gets -2/-1.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: -2,
            toughness: -1,
        },
    ],
};

// Will-o'-the-Wisp — "Flying. {B}: Regenerate Will-o'-the-Wisp." Flying static
// + self-regen activated. Same shape as Drudge Skeletons / Wall of Bone.
export const willOTheWisp: CardDefinition = {
    id: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6",
    rarity: "rare",
    name: "Will-o'-the-Wisp",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\n{B}: Regenerate this creature. (The next time this creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "will-o-the-wisp-regenerate",
            oracleText: "{B}: Regenerate Will-o'-the-Wisp.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Word of Command — "Look at target opponent's hand and choose a card from it.
// You control that player until Word of Command finishes resolving. The player
// plays that card if able. …" (CR 608.2, ADR 0037 Acting Player). The control
// aspect is modelled by scoped choice-routing, NOT a general control-a-player
// subsystem: WoC's controller is the *Acting Player* who answers every prompt,
// while the controlled opponent stays the controller of whatever card is
// played (it is their card, played under their control from their hand, and it
// counts against their resources — CR 305.2 land drop, "mana only from lands
// that player controls"). Slice 1 (#576) implemented the LAND branch; slice 2
// (#577) adds the spell branch ("if the chosen card is cast as a spell …").
//
// Resolution (single suspending step):
//   1. The Acting Player (WoC's controller) looks at the target opponent's hand
//      — grant Card Knowledge (`knownTo` the controller) over every hand card.
//   2. The Acting Player picks one card via a resolve-time Pending Choice
//      (`choose-hand-card`, `zoneOwnerId` = opponent, `actingPlayerId` =
//      controller). Suspends until submitted.
//   3. If the chosen card is a LAND: the opponent PLAYS it under their control
//      "if able" — `playLandForPlayer` consumes the opponent's one-land-per-turn
//      drop (CR 305.2). Land drop already spent → not played.
//   4. Otherwise (a non-land card): the opponent CASTS it as their spell via
//      `castChosenSpell` (castById = opponent, actingPlayerId = controller, CR
//      601), mana auto-tapped only from the opponent's lands; unpayable → not
//      played (#577). This slice supports a NON-targeted spell; targeted / X /
//      modal casts route the extra choices to the controller in later slices
//      (#578-#580).
export const wordOfCommand: CardDefinition = {
    id: "96c21429-98d3-416b-be00-6aa9c4c5a006",
    rarity: "rare",
    name: "Word of Command",
    oracleText:
        "Look at target opponent's hand and choose a card from it. You control that player until Word of Command finishes resolving. The player plays that card if able. While doing so, the player can activate mana abilities only if they're from lands that player controls and only if mana they produce is spent to activate other mana abilities of lands the player controls and/or to play that card. If the chosen card is cast as a spell, you control the player while that spell is resolving.",
    manaCost: { B: 2 },
    types: ["Instant"],
    // CR 115 — "target opponent". A player target restricted to an opponent of
    // the caster (the relationship filter is honored for player targets here).
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "player") return;
        const opponentId = target.id;
        const controllerId = ctx.controller; // the Acting Player (ADR 0037)

        // "Look at target opponent's hand" — grant Card Knowledge of every card
        // in the opponent's hand to the Acting Player (ADR 0026 knownTo).
        const handIds = ctx.getHandIds(opponentId);
        ctx.markKnown(opponentId, handIds, controllerId);

        // Nothing to choose if the opponent's hand is empty — WoC simply
        // resolves with no effect (CR 608.2b — instructions become impossible).
        if (handIds.length === 0) return;

        // The Acting Player chooses one card from the opponent's hand. The
        // chooser (`playerId`) is the controller; the zone belongs to the
        // opponent (`zoneOwnerId`); `actingPlayerId` records the controlled-cast
        // routing (ADR 0037). Suspends until submitted.
        const picked = ctx.requestChoice({
            playerId: controllerId,
            choiceId: controllerId,
            actingPlayerId: controllerId,
            kind: "choose-hand-card",
            zone: "hand",
            zoneOwnerId: opponentId,
            count: 1,
            prompt: "Choose a card from the opponent's hand for them to play.",
        });
        if (picked === undefined) return; // suspend — resumes on submit
        const chosenId = picked[0];
        if (!chosenId) return;

        // "The player plays that card if able." Determine the chosen card's
        // characteristics from the opponent's hand (CR 108.1).
        const handCard = ctx
            .getHandCards(opponentId)
            .find((c) => c.id === chosenId);
        if (!handCard) return; // no longer in hand (CR 608.2b)

        if (handCard.types.includes("Land")) {
            // LAND branch — play it under the opponent's control, counting
            // toward their one-land-per-turn drop (CR 305.2). Already spent →
            // not played ("if able").
            ctx.playLandForPlayer(opponentId, chosenId);
            return;
        }

        // SPELL branch — cast the chosen non-land card as the opponent's spell
        // (CR 601): `castById` = opponent, `actingPlayerId` = controller, so the
        // resulting stack item is the opponent's spell while the Acting Player
        // keeps deciding. Mana is auto-tapped ONLY from the opponent's lands;
        // unpayable from those lands → not played ("if able").
        //
        // The Acting Player (controller) makes EVERY cast decision for the
        // controlled opponent's spell, consuming the opponent's resources
        // (ADR 0037): the mode (CR 700.2c), the value of X (CR 107.3), any
        // additional sacrifice cost (CR 117.9), and the targets (CR 601.2c).
        // Each pick is a resolve-time Pending Choice routed to the controller;
        // the resolve step re-runs after every submit, reading prior picks back
        // (so the choiceIds must be stable). Any pick that is unmeetable from
        // the opponent's resources means the card is NOT played ("if able").

        // MODE (#579, CR 700.2c) — for a modal spell the controller chooses
        // exactly one mode; its target requirement and resolution drive the
        // rest of the cast (CR 700.2d). Non-modal cards return an empty list.
        const modes = ctx.getCardModes(opponentId, chosenId);
        let chosenModeId: string | undefined;
        if (modes.length > 0) {
            const pickedMode = ctx.requestOptionChoice({
                playerId: controllerId,
                choiceId: `${controllerId}:mode`,
                actingPlayerId: controllerId,
                options: modes,
                prompt: "Choose a mode for the opponent's spell.",
            });
            if (pickedMode === undefined) return; // suspend — resume on submit
            chosenModeId = pickedMode;
        }

        // X (#579, CR 107.3) — for a spell with a variable {X} the controller
        // chooses X. The legal range is 0..maxAffordable from the opponent's
        // lands ONLY (the oracle's mana restriction): values the opponent
        // cannot pay are not offered, so "if able" falls out — if even X=0 is
        // unpayable, `castChosenSpell` below returns false and nothing happens.
        let chosenX: number | undefined;
        if (ctx.cardHasXCost(opponentId, chosenId)) {
            const maxX = ctx.getMaxAffordableX(
                opponentId,
                chosenId,
                chosenModeId
            );
            const xOptions = Array.from({ length: maxX + 1 }, (_, n) => ({
                id: String(n),
                label: `X = ${n}`,
            }));
            const pickedX = ctx.requestOptionChoice({
                playerId: controllerId,
                choiceId: `${controllerId}:x`,
                actingPlayerId: controllerId,
                options: xOptions,
                prompt: "Choose the value of X for the opponent's spell.",
            });
            if (pickedX === undefined) return; // suspend — resume on submit
            chosenX = Number(pickedX);
        }

        // ADDITIONAL COST — sacrifice (#579, CR 117.9). For a spell with a
        // sacrifice additional cost the controller picks a matching permanent
        // on the CONTROLLED OPPONENT's battlefield; it is sacrificed on commit.
        // No matching permanent → the cost is unmeetable, the spell is NOT
        // played ("if able", CR 117.9 / 601.2f).
        const sacrificeFilter = ctx.getCardSacrificeFilter(
            opponentId,
            chosenId
        );
        let additionalSacrificeId: string | undefined;
        if (sacrificeFilter) {
            const candidateIds = ctx.getBattlefieldIds(
                opponentId,
                sacrificeFilter
            );
            if (candidateIds.length === 0) return; // unmeetable — not played
            const pickedSac = ctx.requestChoice({
                playerId: controllerId,
                choiceId: `${controllerId}:sacrifice`,
                actingPlayerId: controllerId,
                kind: "choose-permanents",
                zone: "battlefield",
                zoneOwnerId: opponentId,
                filter: sacrificeFilter,
                candidateIds,
                count: 1,
                prompt: "Choose a permanent for the opponent to sacrifice.",
            });
            if (pickedSac === undefined) return; // suspend — resume on submit
            additionalSacrificeId = pickedSac[0];
            if (!additionalSacrificeId) return;
        }

        // TARGETED spell (#578, CR 601.2c) — the Acting Player chooses the
        // targets. For a MODAL spell the active requirement is the chosen
        // mode's (CR 700.2d); otherwise the card-level one. The legal candidate
        // set comes from `getLegalTargetsForCard`, which reuses `getLegalTargets`
        // exactly as a normal cast does, with the controlled opponent as the
        // spell's caster (CR 601). For an "any target" spell (Lightning Bolt)
        // that places no restriction, so the controller may aim the opponent's
        // Bolt at the opponent themselves — the classic Word of Command line.
        // No legal targets → the spell is NOT played ("if able", CR 601.2c).
        const targetReq = chosenModeId
            ? ctx.getCardModeTargetRequirement(
                  opponentId,
                  chosenId,
                  chosenModeId
              )
            : ctx.getCardTargetRequirement(opponentId, chosenId);
        let chosenTargets: TargetSelection[] | undefined;
        if (targetReq) {
            // This slice supports single-target spells (count 1); multi-target
            // casts route their extra picks in a later slice.
            const legal = ctx.getLegalTargetsForCard(
                opponentId,
                chosenId,
                targetReq
            );
            if (legal.length === 0) return; // no legal target — not played

            // Route the target pick to the Acting Player (controller). The
            // candidate set is split into permanent/spell instance ids
            // (`candidateIds`) and player ids (`candidatePlayerIds`) so the
            // `choose-damage-target` validator accepts either kind, mirroring an
            // "any target" pick (CR 115.4) — Lightning Bolt's exact shape.
            const candidatePlayerIds = legal
                .filter((t) => t.type === "player")
                .map((t) => t.id);
            const candidateIds = legal
                .filter((t) => t.type !== "player")
                .map((t) => t.id);
            const pickedTarget = ctx.requestChoice({
                playerId: controllerId,
                choiceId: `${controllerId}:target`,
                actingPlayerId: controllerId,
                kind: "choose-damage-target",
                zone: "battlefield",
                count: 1,
                candidateIds,
                candidatePlayerIds,
                prompt: "Choose a target for the opponent's spell.",
            });
            if (pickedTarget === undefined) return; // suspend — resume on submit
            const pickedId = pickedTarget[0];
            if (!pickedId) return;
            const selected = legal.find((t) => t.id === pickedId);
            if (!selected) return; // pick no longer legal (CR 608.2b)
            chosenTargets = [selected];
        }

        // `castChosenSpell` handles mana payment (including X) + the additional
        // sacrifice + stack placement + cast triggers, and is a no-op (returns
        // false) when the spell can't be paid for / its additional cost can't
        // be met from the opponent's resources. The Acting Player's targets, X,
        // mode and sacrifice all ride onto the resulting stack item.
        ctx.castChosenSpell(opponentId, chosenId, controllerId, {
            targets: chosenTargets,
            chosenX,
            chosenModeId,
            additionalSacrificeId,
        });
    },
};

// Zombie Master — "Other Zombie creatures you control have swampwalk. Other
// Zombies have '{B}: Regenerate this creature.'" (CR 611, 702.13c landwalk,
// 113.1 granted activated ability). Two lord-style static effects:
// keyword-grant (swampwalk) + activated-grant (regen). Master itself is
// excluded via the `target.id !== source.id` predicate. No pt-buff — the
// original LEA text and current Oracle both omit it. The granted regen
// template lives on `grantTemplates` so Zombie Master itself does NOT expose
// it as a native activated ability.
export const zombieMaster: CardDefinition = {
    id: "3d4255a0-d445-4c00-b936-bbf07851e1c8",
    rarity: "rare",
    name: "Zombie Master",
    oracleText:
        'Other Zombie creatures have swampwalk. (They can\'t be blocked as long as defending player controls a Swamp.)\nOther Zombies have "{B}: Regenerate this permanent."',
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 3,
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Zombie"),
            keyword: "swampwalk",
        },
        {
            kind: "activated-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Zombie"),
            abilityId: "zombie-master-regenerate",
        },
    ],
    grantTemplates: [
        {
            id: "zombie-master-regenerate",
            oracleText: "{B}: Regenerate this creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): the granted
            // self-regenerate shield on the bearer (CR 701.15a) via $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Terror — {1}{B} Instant. "Destroy target nonartifact, nonblack creature.
// It can't be regenerated." (CR 701.7, 701.15c, 202.2, 205)
export const terror: CardDefinition = {
    id: "21004958-2c7e-4a55-bc80-411c4d780106",
    rarity: "common",
    name: "Terror",
    oracleText:
        "Destroy target nonartifact, nonblack creature. It can't be regenerated.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        excludeTypes: "Artifact",
        excludeColors: "B",
    },
    // NOT DSL-migratable (ADR 0045): the "can't be regenerated" rider is a
    // destroy option the `destroy` Op does not expose.
    // Blocked on: destroy Op `cantBeRegenerated` parameter (planned-migratable).
    resolve: (ctx: SpellContext) => {
        ctx.destroy(ctx.targets[0], { cantBeRegenerated: true });
    },
};
