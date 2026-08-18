// Ice Age (ICE) — Multicolour (two-or-more-colour) cards, split by colour per ADR 0043.
// The registry's `import * as ice from "./sets/ice"` resolves through
// ice/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {1}{G} → { X: 1, G: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).
import type {
    CardDefinition,
    Color,
    ManaCost,
    SpellContext,
    StaticAttackSacrificeTax,
    TargetSelection,
    TriggeredAbility,
} from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";

// Per-attacker "sacrifice a land" attack tax (CR 508.1c/1g — Flooded Woodlands,
// Reclamation, #733). A battlefield-scanned `attack-sacrifice-tax` static whose
// `taxes` predicate matches attacking creatures of one colour; the engine
// (`collectAttackSacrificeTax` + `confirmAttackers`) charges one land sacrifice
// per matching attacker as attackers are declared. Shared factory — both ICE
// enchantments differ only by taxed colour and oracle text.
function attackSacrificeTaxForColor(args: {
    id: string;
    color: Color;
    oracleText: string;
}): StaticAttackSacrificeTax {
    return {
        kind: "attack-sacrifice-tax",
        id: args.id,
        taxes: (attacker, _source, _state, ctx) =>
            ctx.isCreature(attacker) &&
            ctx.getColors(attacker).includes(args.color),
        oracleText: args.oracleText,
    };
}
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";
import { untapTrigger } from "../../abilities/triggers/untapTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

// "At the beginning of your upkeep, sacrifice this permanent unless you pay
// <cost>" (CR 603.6a phase trigger + CR 117.3a may-pay with a hard action on
// decline). Local twin of the LEA helper of the same name — kept per-set so
// the set file stays self-contained.
// Migrated resolve()→effects[] (ADR 0045, PRD #795): both call sites in this
// file (Earthlink, Glaciers) decline into the SAME "sacrifice this permanent"
// consequence, so the shared body is a fixed `mayPay` + `if(not $paid)` +
// `sacrifice($source)` script — no `onDecline` closure parameter needed.
function makeUpkeepPayOrElse(args: {
    id: string;
    oracleText: string;
    cost: ManaCost;
    prompt: string;
}): TriggeredAbility {
    return phaseTrigger({
        id: args.id,
        oracleText: args.oracleText,
        phase: "UPKEEP",
        scope: "your",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                cost: args.cost,
                prompt: args.prompt,
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "sacrifice", target: { ref: "$source" } }],
            },
        ],
    });
}
// Pyknite — activated above (Green tranche; duplicate stub removed, #660).
// Rime Dryad — activated above (Green snow cluster); duplicate stub removed.
// Ritual of Subdual — {4}{G}{G}, mono-green by colour identity (CR 202.2);
// implemented in green.ts (the triage stub originally landed here). See #726.
// Snowblind — activated above (Green snow cluster); duplicate stub removed.
// Thermokarst — activated above (Green free tranche).
// Thoughtleech — activated above (Green free tranche).
// Touch of Vitae — deferred (#660); single stub kept above (duplicate removed).
// Venomous Breath — activated above (Green free tranche).
// Whiteout — activated above (Green snow cluster); duplicate stub removed.
// Wiitigo — activated above (Green free tranche).
// Woolly Mammoths — activated above (Green snow cluster); duplicate stub removed.
// ─────────────────────────────────────────────────────────────────────────────
// MULTICOLOUR free tranche (#635) — the gold ICE cards expressible with
// already-shipped primitives are active CardDefinitions below (Altar of Bone,
// Centaur Archer, Essence Vortex, Giant Trap Door Spider; plus the gold cards
// already activated by their colour batches: Diabolic Vision, Elemental Augury,
// Glaciers, Skeleton Ship, Spectral Shield, Storm Spirit, Stormbind, Wings of
// Aesthir).
//
// DEFERRED (remain commented stubs, owned by a later capability cluster):
//   • Divided-as-you-choose damage / counters — Fire Covenant, Fiery Justice,
//     Meteor Shower, Spoils of War: SHIPPED (#664). Player-chosen ≥1-each
//     division (`dealDamageDividedAsChosen` / `distributeCountersAsChosen` +
//     the `divideAsChosen` target requirement), pay-X-life additional cost, and
//     cast-time graveyard-derived X all ship.
//   • Pay-life additional cost — Fumarole ("pay 3 life" as an additional cast
//     cost; `additionalCosts` only models sacrifice/exile today).
//   • Cross-graveyard reanimation under YOUR control — Hymn of Rebirth
//     (`returnToBattlefield` returns the card under its OWNER's control; putting
//     an opponent's graveyard creature under the caster's control needs a
//     source-owner / controller split).
//   • End-of-combat destroy of blocking-or-blocked-by — Kjeldoran Frostbeast
//     (same delayed end-of-combat combat-relationship trigger flagged for
//     Venomous Breath).
//   • Specialized statics / triggers — Earthlink (dies → sac a land), Ghostly
//     Flame (colourless-damage-source static), Monsoon (per-player end-step
//     Island tap + damage), Mountain Titan (cast-trigger counter grant),
//     Merieke Ri Berit (gain control + destroy-on-leave/untap). Each needs a
//     primitive not yet built; flagged for its capability cluster.
// ─────────────────────────────────────────────────────────────────────────────
// Altar of Bone — {G}{W} Sorcery. "As an additional cost to cast this spell,
// sacrifice a creature. Search your library for a creature card, reveal it, put
// it into your hand, then shuffle." (CR 118.8 / 601.2f sacrifice additional cost
// via `additionalCosts.sacrificeFilter`; CR 701.23 library search for a creature
// card → hand; CR 701.20 shuffle.) The reveal is implicit — the searched card
// moves to the caster's hand and the library is shuffled.
export const altarOfBone: CardDefinition = {
    id: "75d5b014-8675-4d91-a539-ac5c31d44b35",
    name: "Altar of Bone",
    rarity: "rare",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card, reveal it, put it into your hand, then shuffle.",
    manaCost: { W: 1, G: 1 },
    types: ["Sorcery"],
    additionalCosts: {
        // A sacrifice cost is always paid from the caster's own battlefield, so
        // no `controllerRelation` is needed (nor supported — the cost-validation
        // call sites pass no `selfControllerId`; a `controllerRelation` here
        // never matches).
        sacrificeFilter: { types: "Creature" },
    },
    // NOT DSL-migratable (ADR 0045): the "then shuffle" tail is now a
    // libraryLook Op (issue #844), but the search half both (a) moves a
    // CHOICE-PICKED LIBRARY card into hand — the `moveZone` Op only sources the
    // battlefield / graveyard, no selector references a library card a `choice`
    // bound — and (b) needs a TYPE-FILTERED library search (creatures only),
    // whereas the `choice` Op's `filter` applies to the battlefield zone only.
    // The classifier over-counts this FREE because `moveCardById` reads as a
    // covered `moveZone` primitive; it is not covered for a library source.
    // Blocked on: a library-sourced move of a choice-picked card + a
    // type-filtered library `choice` (planned).
    resolve: (ctx: SpellContext) => {
        const creatures = ctx
            .getLibraryCards(ctx.controller)
            .filter((c) => c.types.includes("Creature"));
        const found = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "altar-of-bone-search",
            kind: "search-library",
            zone: "library",
            candidateIds: creatures.map((c) => c.id),
            count: { min: 0, max: 1 },
            prompt: "Search your library for a creature card.",
            // Genuine CR 701.23a search (candidateIds is a whole-library
            // filter match, not a peeked window) — issue #788 finding 1.
            isSearch: true,
        });
        if (found === undefined) return; // suspended for the search
        const foundId = found[0];
        if (foundId) {
            ctx.moveCardById(ctx.controller, foundId, "library", "hand");
        }
        ctx.shuffleLibrary(ctx.controller);
    },
};
// Centaur Archer — {1}{R}{G} 3/2. "{T}: This creature deals 1 damage to target
// creature with flying." (CR 605 activated ability; CR 120.1 damage; the "with
// flying" filter narrows legal targets via `requireAbility`. Modern Scryfall
// Oracle text — ADR 0004.)
export const centaurArcher: CardDefinition = {
    id: "e275c295-72da-4a86-82c6-cfd75b38b19c",
    name: "Centaur Archer",
    rarity: "uncommon",
    oracleText:
        "{T}: This creature deals 1 damage to target creature with flying.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Centaur", "Archer"],
    power: 3,
    toughness: 2,
    activatedAbilities: [
        {
            id: "centaur-archer-ping",
            oracleText:
                "{T}: This creature deals 1 damage to target creature with flying.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "flying",
            },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
// DEFERRED (#734): the colour-keyed all-damage prevention shield itself now
// ships (Prismatic Ward — a `replacementEffects[]` damage shield reading the
// stored `chosenModeId` colour). Chromatic Armor now reuses that exact shield
// and adds its SECOND clause — "{X}: Put a sleight counter on this Aura and
// choose a color. X is the number of sleight counters on this Aura." — on the
// two primitives that shipped for it (#734): the `manaEqualToCounterCount`
// dynamic activation cost (X = the source's own sleight-counter count, read at
// announcement, CR 601.2f) and `SpellContext.setChosenMode` (re-write the host
// Aura's `chosenModeId` post-ETB, CR 700.2c). See `chromaticArmor` below.

// The five colours Chromatic Armor's warded-colour picker offers, at ETB (the
// modal `chosenModeId` pick) and via the re-choose activated ability. Mirrors
// Prismatic Ward's WARD_COLORS (`ice/white.ts`) — kept local rather than
// exported since only these two ICE shields use it.
const CHROMATIC_ARMOR_COLORS = ["W", "U", "B", "R", "G"] as const;
const CHROMATIC_ARMOR_COLOR_NAMES: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

// Chromatic Armor — {1}{W}{U} Aura. "Enchant creature. As this Aura enters,
// choose a color. This Aura enters with a sleight counter on it. Prevent all
// damage that would be dealt to enchanted creature by sources of the last
// chosen color. {X}: Put a sleight counter on this Aura and choose a color. X
// is the number of sleight counters on this Aura." (CR 700.2c the warded colour
// is a modal pick stored as `chosenModeId`; CR 122.1 the ETB sleight counter;
// CR 615 the continuous, source-colour-filtered, ALL-damage prevention shield
// on the Aura's HOST — the SAME `replacementEffects[]` seam as Prismatic Ward,
// running at every damage site (combat and non-combat); CR 601.2f the {X}
// re-choose whose X is fixed by the source's own sleight-counter count.)
export const chromaticArmor: CardDefinition = {
    id: "2657e85b-8f77-41fa-9df2-233443efef43",
    name: "Chromatic Armor",
    rarity: "rare",
    oracleText:
        "Enchant creature\nAs this Aura enters, choose a color.\nThis Aura enters with a sleight counter on it.\nPrevent all damage that would be dealt to enchanted creature by sources of the last chosen color.\n{X}: Put a sleight counter on this Aura and choose a color. X is the number of sleight counters on this Aura.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    // CR 700.2c — the initial warded colour is chosen as the Aura enters,
    // stored as `chosenModeId` ("W"/"U"/"B"/"R"/"G") on the instance.
    modes: CHROMATIC_ARMOR_COLORS.map((color) => ({
        id: color,
        label: CHROMATIC_ARMOR_COLOR_NAMES[color],
        color,
        oracleText: `Prevent all damage dealt to enchanted creature by ${CHROMATIC_ARMOR_COLOR_NAMES[color]} sources.`,
    })),
    // CR 122.1 — "This Aura enters with a sleight counter on it." Seeds the
    // {X} re-choose cost at 1 (X = sleight-counter count).
    entersWith: { counters: [{ type: "sleight", count: 1 }] },
    // CR 615 — the SAME colour-filtered ALL-damage prevention shield as
    // Prismatic Ward (`ice/white.ts`): a `replacementEffects[]` entry with
    // `eventKind: "damage"` that consumes any damage to the Aura's host
    // (`self.attachedTo`) from a source whose colours include the LAST chosen
    // colour (`self.chosenModeId`, updated by the re-choose ability). The
    // replacement pipeline runs at every damage site (combat and non-combat).
    replacementEffects: [
        {
            id: "chromatic-armor-shield",
            oracleText:
                "Prevent all damage that would be dealt to enchanted creature by sources of the last chosen color.",
            eventKind: "damage",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                if (self.attachedTo === undefined) return false;
                if (event.target.type !== "permanent") return false;
                if (event.target.id !== self.attachedTo) return false;
                const color = self.chosenModeId;
                if (color === undefined) return false;
                return event.sourceColors.includes(color as Color);
            },
            // CR 615 — prevent the damage: consuming the event means it is
            // never dealt.
            replace: () => ({ kind: "consumed" }),
        },
    ],
    activatedAbilities: [
        {
            id: "chromatic-armor-recolor",
            oracleText:
                "{X}: Put a sleight counter on this Aura and choose a color. X is the number of sleight counters on this Aura.",
            // CR 601.2f — X is FIXED by board state (the source's own sleight
            // counters at announcement), not a player-chosen {X}: each
            // successive activation costs one more (1 → {1}, then {2}, …).
            cost: { manaEqualToCounterCount: { type: "sleight" } },
            useStack: true,
            // protocol card: re-choosing a modal colour and MUTATING the host
            // Aura's stored `chosenModeId` post-ETB (CR 700.2c) is not
            // expressible by the current Op vocabulary — no Op writes a
            // permanent's persistent modal state. Uses the shipped
            // `setChosenMode` primitive; the colour lookup stays data (the
            // Prismatic-Ward shield above reads the new `chosenModeId`).
            resolve: (ctx: SpellContext) => {
                // Suspend for the colour pick FIRST — nothing is mutated until
                // the pick is stored, so on replay `addCounter` runs exactly
                // once (CR 608.3 — a re-run must not double the counter).
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "chromatic-armor-recolor",
                    options: CHROMATIC_ARMOR_COLORS.map((c) => ({
                        id: c,
                        label: CHROMATIC_ARMOR_COLOR_NAMES[c],
                        color: c,
                    })),
                    prompt: "Choose a color (Chromatic Armor)",
                });
                if (chosen === undefined) return; // suspended for the pick
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "sleight",
                    1
                );
                ctx.setChosenMode(ctx.sourceInstanceId, chosen);
            },
        },
    ],
};
// Diabolic Vision — "Look at the top five cards of your library. Put one of
// them into your hand and the rest on top of your library in any order." (CR
// 401 library peek/reorder, CR 121 to hand.) Composition: peek the top five
// (grant knowledge), pick one to move to hand, then reorder the remaining top
// cards.
export const diabolicVision: CardDefinition = {
    id: "1ea01324-1cfb-498c-8299-f690373864bd",
    name: "Diabolic Vision",
    rarity: "uncommon",
    oracleText:
        "Look at the top five cards of your library. Put one of them into your hand and the rest on top of your library in any order.",
    manaCost: { U: 1, B: 1 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045): "put ONE into hand, the REST back on
    // top in any order" needs BOTH a hand-bound pick from a peeked window AND
    // a full reorder of the remainder — `lookDistribute` sends its un-taken cards
    // to the library BOTTOM or graveyard (never a reordered top), and
    // `scryReorder` has no "send some to hand" destination (`LibraryDestination`
    // is `"library-bottom" | "graveyard" | "none"`). No existing Op composes
    // "N to hand, rest reordered on top". Blocked on: a hand-bound `lookDistribute`
    // rest-destination (or a `scryReorder` hand destination) — stays resolve().
    resolve: (ctx: SpellContext) => {
        const top = ctx.peekLibraryTop(ctx.controller, 5);
        if (top.length === 0) return;
        ctx.markKnown(ctx.controller, top, ctx.controller);
        const pick = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "diabolic-vision-keep",
            kind: "search-library",
            zone: "library",
            count: 1,
            candidateIds: top,
            prompt: "Put one of the top five cards into your hand.",
        });
        if (pick === undefined) return; // suspended for the choice
        const kept = pick[0];
        if (kept) ctx.moveCardById(ctx.controller, kept, "library", "hand");
        // The rest stay on top; their order is the player's prerogative
        // ("in any order") — reorder among the remaining peeked ids.
        const rest = top.filter((id) => id !== kept);
        const ordered = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "diabolic-vision-reorder",
            kind: "reorder-library",
            zone: "library",
            count: rest.length,
            candidateIds: rest,
            prompt: "Put the rest back on top in any order (rightmost = top).",
        });
        if (ordered === undefined) return; // suspended
        ctx.reorderLibraryTop(ctx.controller, ordered);
    },
};
// Earthlink — upkeep "pay {2} or sacrifice" (CR 603.6a phase trigger +
// CR 117.3a may-pay with a hard sacrifice on decline, via the local
// `makeUpkeepPayOrElse`) plus a death trigger: "Whenever a creature dies, that
// creature's controller sacrifices a land of their choice" (CR 603.2 death
// trigger over `scope: "any"`; the dying creature's controller is read from the
// `diedTrigger` last-known-information payload, CR 603.10, and chooses which
// Land to sacrifice via a `sacrifice-permanents` choice, CR 701.21). Modern
// Scryfall oracle text (ADR 0004): the upkeep clause is a flat "pay {2}", NOT
// cumulative upkeep.
const EARTHLINK_ID = "a83cb1c4-7c5b-4a5e-b15e-138d644f5cdb";
export const earthlink: CardDefinition = {
    id: EARTHLINK_ID,
    name: "Earthlink",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {2}.\nWhenever a creature dies, that creature's controller sacrifices a land of their choice.",
    manaCost: { X: 3, B: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "earthlink-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {2}.",
            cost: { X: 2 },
            prompt: "Pay {2} to keep Earthlink?",
        }),
        // NOT DSL-migratable (ADR 0045): the consequence names "that
        // creature's controller" — the DYING creature's controller (CR
        // 603.10 last-known information), read from `diedTrigger`'s
        // `deadCreature` LKI payload. A `diedTrigger` `effects[]` script only
        // binds the SOURCE's controller (`ctx.controller`, Earthlink's own
        // controller), never the dead creature's — the LKI payload isn't
        // reachable from the DSL. Blocked on: LKI-derived player exposure to
        // Effect Script — stays resolve().
        diedTrigger({
            id: "earthlink-dies-sac-land",
            oracleText:
                "Whenever a creature dies, that creature's controller sacrifices a land of their choice.",
            scope: "any",
            resolve: (ctx, _event, deadCreature) => {
                const controller = deadCreature.controllerId;
                // CR 701.21 — only ask when the controller actually has a Land
                // to sacrifice (a no-Land board makes the sacrifice a no-op).
                const lands = ctx.getBattlefieldIds(controller, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `earthlink-${ctx.sourceInstanceId}-${deadCreature.id}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Earthlink: sacrifice a land of your choice.",
                });
                if (picked === undefined) return; // suspended for the choice
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
    ],
};
// Elemental Augury — "{3}: Look at the top three cards of target player's
// library, then put them back in any order." (CR 401 library peek/reorder.)
// The activated ability targets a player; on resolution the controller looks at
// (gains knowledge of) the top three of that player's library and reorders
// them.
export const elementalAugury: CardDefinition = {
    id: "62bbff2a-5109-400a-961b-eacffb9aed67",
    name: "Elemental Augury",
    rarity: "rare",
    oracleText:
        "{3}: Look at the top three cards of target player's library, then put them back in any order.",
    manaCost: { U: 1, B: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "elemental-augury-look",
            oracleText:
                "{3}: Look at the top three cards of target player's library, then put them back in any order.",
            cost: { mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            // NOT DSL-migratable (ADR 0045): the ability's CONTROLLER looks at
            // and reorders the TARGET PLAYER's library — a cross-player scry
            // (chooser ≠ library owner). The only reorder-capable Op,
            // `scryReorder`, wraps `SpellContext.orderTop(playerId, n, …)`,
            // which takes a SINGLE playerId for both "whose library" and "who
            // chooses" — it cannot express a chooser distinct from the zone
            // owner. The raw `choice` Op's `zoneOwnerId` generalization only
            // covers its `search-library` kind, not a reorder. Blocked on: a
            // cross-player reorder-library Op/kind — stays resolve().
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "player") return;
                const top = ctx.peekLibraryTop(t.id, 3);
                if (top.length === 0) return;
                ctx.markKnown(t.id, top, ctx.controller);
                const ordered = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "elemental-augury-reorder",
                    kind: "reorder-library",
                    zone: "library",
                    count: top.length,
                    candidateIds: top,
                    zoneOwnerId: t.id,
                    prompt: "Put the top three cards back in any order (rightmost = top).",
                });
                if (ordered === undefined) return; // suspended
                ctx.reorderLibraryTop(t.id, ordered);
            },
        },
    ],
};
// Essence Vortex — {1}{U}{B} Instant. "Destroy target creature unless its
// controller pays life equal to its toughness. A creature destroyed this way
// can't be regenerated." (CR 117.3a / 118.4 — a "pay life unless" offer to the
// target's controller via `requestMayPay` (no mana cost = a yes/no life gate);
// pay `getToughness` life to keep it, else destroy with the no-regen rider
// CR 701.19a.) The toughness is snapshotted at resolution (CR 608.2g).
export const essenceVortex: CardDefinition = {
    id: "fe07e496-5070-4116-a91a-a3bbe19c12af",
    name: "Essence Vortex",
    rarity: "uncommon",
    oracleText:
        "Destroy target creature unless its controller pays life equal to its toughness. A creature destroyed this way can't be regenerated.",
    manaCost: { X: 1, U: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // NOT DSL-migratable (ADR 0045): "pays life equal to its toughness" is a
    // DYNAMIC `mayPay` life cost derived from the target's own toughness —
    // `MayPayCost.life` is a flat `number`, never a `ref`/`EffectValue` (only
    // a dynamic MANA cost exists, `DynamicMayPayManaCost`, for a different
    // shape — Flash's "pay its mana cost reduced by {2}"). The card also
    // pre-checks affordability (toughness > 0 AND life >= toughness) BEFORE
    // even offering the choice, skipping straight to `destroy` when unaffordable
    // — the `mayPay` Op has no such pre-check gate. Blocked on: a dynamic
    // (ref-derived) life leg for `mayPay` — stays resolve().
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const toughness = ctx.getToughness(target);
        const controller = ctx.getController(target);
        // CR 118.4 — only offer the life payment when the controller can
        // afford it; otherwise the creature is destroyed outright.
        if (toughness > 0 && ctx.getLife(controller) >= toughness) {
            const pay = ctx.requestMayPay({
                playerId: controller,
                choiceId: `essence-vortex-${target.id}`,
                prompt: `Pay ${toughness} life to keep this creature?`,
            });
            if (pay === undefined) return; // suspended for the choice
            if (pay) {
                ctx.loseLife(controller, toughness);
                return;
            }
        }
        ctx.destroy(target, { cantBeRegenerated: true });
    },
};
// Fiery Justice — {R}{G}{W} Sorcery. "Fiery Justice deals 5 damage divided as
// you choose among any number of targets. Target opponent gains 5 life."
// (CR 601.2d / 120.4 divide as you choose.) The "5 damage divided" group is the
// card's `targetRequirement` (any target, divide total 5). The "target opponent
// gains 5 life" is a SECOND target group the single-`targetRequirement` engine
// can't model independently; in a 2-player game "an opponent" is unambiguous
// (the one opponent), so the lifegain auto-resolves to that opponent at
// resolution — a zero-branch choice (Arena-UX auto-resolve), expressed as a
// `gainLife` Op with `player: "opponent"`. DSL-first (ADR 0045): the divided
// damage is the `dealDamageDividedAsChosen` Op (CR 601.2d / 120.4).
export const fieryJustice: CardDefinition = {
    id: "8965ce61-0522-4f77-a82d-89441d1ba867",
    name: "Fiery Justice",
    rarity: "rare",
    oracleText:
        "Fiery Justice deals 5 damage divided as you choose among any number of targets. Target opponent gains 5 life.",
    manaCost: { R: 1, G: 1, W: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "any",
        count: { min: 1 },
        divideAsChosen: { total: 5 },
    },
    effects: [
        { op: "dealDamageDividedAsChosen", total: 5 },
        { op: "gainLife", player: "opponent", amount: 5 },
    ],
};
// Fire Covenant — {1}{B}{R} Instant. "As an additional cost to cast this spell,
// pay X life. Fire Covenant deals X damage divided as you choose among any
// number of target creatures." (CR 601.2b pay-X-life additional cost; CR 601.2d
// / 120.4 divide as you choose.) The {X} here is NOT in the mana cost — it is
// the life the caster chooses to pay, which becomes the damage total. The
// engine validates affordability (CR 118.4), pays the life as the spell hits
// the stack, snapshots X so `getX()` returns it, and drives the per-target
// split via `divideAsChosen: { total: "X" }`. DSL-first (ADR 0045): the
// `dealDamageDividedAsChosen` Op resolves `total: "X"` as `getX()`.
export const fireCovenant: CardDefinition = {
    id: "6a0139c2-ad86-4c71-ab6d-4840c37d5d20",
    name: "Fire Covenant",
    rarity: "uncommon",
    oracleText:
        "As an additional cost to cast this spell, pay X life.\nFire Covenant deals X damage divided as you choose among any number of target creatures.",
    // {1}{B}{R}: the {1} generic is the numeric `X: 1` (NOT the variable "X" —
    // Fire Covenant's X lives in the pay-X-life additional cost, not the mana).
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Instant"],
    additionalCosts: { payXLife: true },
    targetRequirement: {
        type: "Creature",
        count: { min: 1 },
        divideAsChosen: { total: "X" },
    },
    effects: [{ op: "dealDamageDividedAsChosen", total: "X" }],
};
// Flooded Woodlands — {2}{U}{B} enchantment. "Green creatures can't attack
// unless their controller sacrifices a land of their choice for each green
// creature they control that's attacking." (CR 508.1c/1g — a per-attacker
// sacrifice-a-land cost paid as attackers are declared, NOT a binary
// prohibition. Modelled with the `attack-sacrifice-tax` combat seam: the engine
// scans this static at declare-attackers confirmation and charges one land
// sacrifice per attacking green creature — #733. Twin: Reclamation, below.)
export const floodedWoodlands: CardDefinition = {
    id: "de89e9e1-485b-42e5-9728-5d6f948999e1",
    name: "Flooded Woodlands",
    rarity: "rare",
    oracleText:
        "Green creatures can't attack unless their controller sacrifices a land of their choice for each green creature they control that's attacking. (This cost is paid as attackers are declared.)",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Enchantment"],
    staticEffects: [
        attackSacrificeTaxForColor({
            id: "flooded-woodlands-green-tax",
            color: "G",
            oracleText:
                "Green creatures can't attack unless their controller sacrifices a land for each attacking green creature they control",
        }),
    ],
};
// Fumarole — {3}{B}{R} Sorcery. "As an additional cost to cast this spell, pay
// 3 life.\nDestroy target creature and target land." (CR 601.2b fixed pay-life
// additional cost; CR 601.2c two INDEPENDENT typed target groups; CR 701.8
// destroy.) The dual-target seam (issue #737): `targetRequirement` names the
// creature (target 0) and `additionalTargetRequirements` the land (target 1);
// the Effect Script destroys each positionally. The fixed 3-life cost rides
// `additionalCosts.payLife`.
export const fumarole: CardDefinition = {
    id: "efa53e9a-0d7c-4d17-b2be-56930edfa2c2",
    name: "Fumarole",
    rarity: "uncommon",
    oracleText:
        "As an additional cost to cast this spell, pay 3 life.\nDestroy target creature and target land.",
    manaCost: { X: 3, B: 1, R: 1 },
    types: ["Sorcery"],
    additionalCosts: { payLife: 3 },
    targetRequirement: { type: "Creature", count: 1 },
    additionalTargetRequirements: [{ type: "Land", count: 1 }],
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "destroy", target: { target: 1 } },
    ],
};
// Ghostly Flame (#668) — demonstrates the damage-source colour-override seam.
//   "Black and/or red permanents and spells are colorless sources of damage."
// CR 119.4 / 614 — while this enchantment is on the battlefield, any black
// and/or red source becomes a colourless source of damage. Pure-data card: the
// override lives in the engine seam `describeDamageSource`
// (`convex/gre/replacements.ts`), the single point every damage site reads
// source colours from, gated on Ghostly Flame being in play. No per-card code.
export const ghostlyFlame: CardDefinition = {
    id: "6314344b-6493-4142-9c76-da9b90b8d3e1",
    name: "Ghostly Flame",
    rarity: "rare",
    oracleText:
        "Black and/or red permanents and spells are colorless sources of damage.",
    manaCost: { B: 1, R: 1 },
    types: ["Enchantment"],
};
// Giant Trap Door Spider — {1}{R}{G} 2/3. "{1}{R}{G}, {T}: Exile this creature
// and target creature without flying that's attacking you." (CR 605 activated
// ability; CR 118.5 / 406 exile. "Without flying" filters legal targets via
// `excludeAbility`; "attacking you" is `combatRoleFilter: "attacking"` — in a
// 2-player game every attacking creature is attacking the lone defender. The
// ability exiles both its source and the chosen attacker.)
export const giantTrapDoorSpider: CardDefinition = {
    id: "8965dfa8-dc90-4cf2-a93b-72bf88b58936",
    name: "Giant Trap Door Spider",
    rarity: "uncommon",
    oracleText:
        "{1}{R}{G}, {T}: Exile this creature and target creature without flying that's attacking you.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "giant-trap-door-spider-exile",
            oracleText:
                "{1}{R}{G}, {T}: Exile this creature and target creature without flying that's attacking you.",
            cost: { mana: { X: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
                excludeAbility: "flying",
            },
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): two `exile`
            // Ops — the announced attacker, then the spider itself (CR 118.5
            // — its own ability already paid the tap cost, so it is still on
            // the battlefield at resolution).
            effects: [
                { op: "exile", target: { target: 0 } },
                { op: "exile", target: { ref: "$source" } },
            ],
        },
    ],
};
// Glaciers — upkeep pay-{W}{U}-or-sacrifice (CR 603.6a / 117.3a) plus the
// Conversion-style global subtype replacement "All Mountains are Plains"
// (CR 305.7, layer 4 subtype-set).
export const glaciers: CardDefinition = {
    id: "b86e159b-ecf1-4b4a-9041-4e97fdf935e5",
    name: "Glaciers",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{U}.\nAll Mountains are Plains.",
    manaCost: { X: 2, W: 1, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "subtype-set",
            applies: (target) => target.subtypes.includes("Mountain"),
            subtypes: ["Plains"],
        },
    ],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "glaciers-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{U}.",
            cost: { W: 1, U: 1 },
            prompt: "Pay {W}{U} to keep Glaciers?",
        }),
    ],
};
// Hymn of Rebirth — "Put target creature card from a graveyard onto the
// battlefield under your control." (CR 601.2c graveyard target in ANY graveyard;
// CR 400.7 / 800.4a zone change where the OWNER stays the graveyard's owner but
// the CONTROLLER becomes the caster.) Unlike Resurrection (which returns under
// the owner's control), this reanimates cross-graveyard under YOUR control, so
// the resolve passes the caster as the explicit `controllerId` override on
// `returnToBattlefield`. The target carries `t.playerId` — the graveyard's
// owner — used to locate the card; the 4th arg redirects control to the caster.
export const hymnOfRebirth: CardDefinition = {
    id: "61d0f2f2-f6e2-4b8a-8418-10b17c5e0ea9",
    name: "Hymn of Rebirth",
    rarity: "uncommon",
    oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control.",
    manaCost: { X: 3, W: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
    // Migrated resolve()→effects[] (ADR 0045, PRD #795): a single `moveZone`
    // Op. CR 800.4a — owner stays the graveyard card's own owner (the
    // `moveZone` graveyard→battlefield branch's default); `controller:
    // "controller"` redirects control to the caster ("under your control"),
    // routing through `SpellContext.returnToBattlefield`'s optional 4th
    // argument exactly as the prior imperative body did. No dedicated
    // per-card test exists — covered by the catalogue-wide
    // `validateEffectScript` static sweep + the auto-generated
    // canned-scenario smoke test (per-Op regime, ADR 0045).
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "battlefield",
            controller: "controller",
        },
    ],
};
// Kjeldoran Frostbeast — "At end of combat, destroy all creatures blocking or
// blocked by this creature." (CR 511.3 END_OF_COMBAT phase trigger, scope
// "each"; CR 701.8 destroy.) The block graph is still live at the END_OF_COMBAT
// step (combat is torn down on step exit), so the resolve reads
// `getBlockersByAttacker()` and walks BOTH directions relative to Frostbeast:
//   • if Frostbeast attacked → the creatures BLOCKING it (its entry's blockers),
//   • if Frostbeast blocked → the attackers it is BLOCKING (entries that list
//     Frostbeast among their blockers).
// Every such partner is destroyed (CR 510.1c damage has already been dealt by
// this step, so survivors of combat are still destroyed by the trigger).
const KJELDORAN_FROSTBEAST_ID = "2fccb1d0-b324-4780-bb9e-4533240da06d";
export const kjeldoranFrostbeast: CardDefinition = {
    id: KJELDORAN_FROSTBEAST_ID,
    name: "Kjeldoran Frostbeast",
    rarity: "uncommon",
    oracleText:
        "At end of combat, destroy all creatures blocking or blocked by this creature.",
    manaCost: { X: 3, W: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Beast"],
    power: 2,
    toughness: 4,
    triggeredAbilities: [
        phaseTrigger({
            id: "kjeldoran-frostbeast-end-of-combat",
            oracleText:
                "At end of combat, destroy all creatures blocking or blocked by this creature.",
            phase: "END_OF_COMBAT",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): "creatures blocking or blocked
            // by this creature" is a COMBAT-RELATIONSHIP selector (walking
            // `getBlockersByAttacker()` both directions relative to the
            // source) — no `EffectForEachSelector` filters permanents by
            // combat role relative to a specific object (only zone/controller/
            // type). Blocked on: a combat-partner-of-source forEach selector
            // — stays resolve().
            resolve: (ctx) => {
                const selfId = ctx.sourceInstanceId;
                const blockersByAttacker = ctx.getBlockersByAttacker();
                const partners = new Set<string>();
                for (const [attackerId, blockerIds] of Object.entries(
                    blockersByAttacker
                )) {
                    if (attackerId === selfId) {
                        // Frostbeast attacked → creatures blocking it.
                        for (const id of blockerIds) partners.add(id);
                    } else if (blockerIds.includes(selfId)) {
                        // Frostbeast blocked → the attacker it blocked.
                        partners.add(attackerId);
                    }
                }
                for (const id of partners) {
                    ctx.destroy({ type: "permanent", id });
                }
            },
        }),
    ],
};
// Merieke Ri Berit — "doesn't untap during your untap step" (the
// `does-not-untap` self-keyword, read by the untap step, CR 502.1) + "{T}: Gain
// control of target creature for as long as you control Merieke Ri Berit"
// (CR 613.1b layer-2 control change with the `controller-controls-source`
// condition — the Preacher/Aladdin precedent, auto-reverted by the conditional-
// control SBA when Merieke leaves or changes controller) + "When Merieke Ri
// Berit leaves the battlefield or becomes untapped, destroy that creature. It
// can't be regenerated." (CR 603.10 / 701.20b dual leave-or-untap delayed
// destroy — the Tawnos's Coffin trigger pair.)
//
// Tracking the stolen creature for the destroy clause: on activation Merieke
// stamps a per-source marker counter (`merieke:<sourceInstanceId>`) on the
// stolen creature (idiomatic custom counter, cf. "wind"/"hunger"/"mire"). The
// leave/untap triggers scan the battlefield for that marker, destroy each
// marked creature (no regen, CR 701.19a), and clear the marker — no closure or
// new control primitive needed. Because Merieke "doesn't untap", it normally
// stays tapped (so the untap clause fires only if something force-untaps it).
const MERIEKE_RI_BERIT_ID = "3bf47c0a-5c17-47d0-b663-becff62fbdf8";
function meriekeMarker(sourceInstanceId: string): string {
    return `merieke:${sourceInstanceId}`;
}
// Destroy every creature Merieke had gained control of (marked on steal),
// clearing the marker. Shared by the leave and untap triggers (CR 603.10).
// NOT DSL-migratable (ADR 0045): scans EVERY player's battlefield for a
// counter of a RUNTIME-COMPUTED name (`meriekeMarker(ctx.sourceInstanceId)`)
// — the `counters` Op's `counter` field is a fixed literal string, never a
// ref, and no `EffectForEachSelector` filters permanents by counter
// count/name across all players. Blocked on: a dynamic (ref-named) counter
// type + a counter-count-filtered forEach selector — stays resolve().
function meriekeDestroyControlled(ctx: SpellContext): void {
    const marker = meriekeMarker(ctx.sourceInstanceId);
    for (const pid of ctx.allPlayerIds) {
        for (const id of ctx.getBattlefieldIds(pid)) {
            const sel: TargetSelection = { type: "permanent", id };
            if (ctx.getCounterCount(sel, marker) > 0) {
                ctx.removeCounter(
                    sel,
                    marker,
                    ctx.getCounterCount(sel, marker)
                );
                ctx.destroy(sel, { cantBeRegenerated: true });
            }
        }
    }
}
export const meriekeRiBerit: CardDefinition = {
    id: MERIEKE_RI_BERIT_ID,
    name: "Merieke Ri Berit",
    rarity: "rare",
    oracleText:
        "Merieke Ri Berit doesn't untap during your untap step.\n{T}: Gain control of target creature for as long as you control Merieke Ri Berit. When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature. It can't be regenerated.",
    manaCost: { W: 1, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 1,
    toughness: 1,
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        {
            id: "merieke-ri-berit-steal",
            oracleText:
                "{T}: Gain control of target creature for as long as you control Merieke Ri Berit. When Merieke Ri Berit leaves the battlefield or becomes untapped, destroy that creature. It can't be regenerated.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // NOT DSL-migratable (ADR 0045): the gainControl Op (#848) is now
            // COVERED and the "for as long as you control this" control change
            // alone WOULD migrate, but the ability ALSO stamps a per-source
            // marker COUNTER (a runtime-computed counter name,
            // `meriekeMarker(ctx.sourceInstanceId)`) so the linked leave/untap
            // triggered ability can find "that creature" (CR 603.10) and destroy
            // it can't-be-regenerated. That marker (a dynamic counter-type name)
            // plus the linked-destroy rider is not JSON-expressible. Blocked on:
            // a runtime-named marker counter + a linked leaves/untap destroy
            // rider — stays resolve().
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // Layer-2 control change, reverted by the SBA the instant
                // Merieke stops being controlled (leaves / changes controller).
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
                // Mark the stolen creature so the leave/untap destroy clause
                // can find it (CR 603.10 — the "that creature" reference).
                ctx.addCounter(target, meriekeMarker(ctx.sourceInstanceId), 1);
            },
        },
    ],
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): delegates to `meriekeDestroyControlled`
        // — see that function's doc comment for the blocker (dynamic marker
        // counter name + cross-player counter-filtered scan).
        leftTrigger({
            id: "merieke-ri-berit-on-leave",
            oracleText:
                "When Merieke Ri Berit leaves the battlefield, destroy that creature. It can't be regenerated.",
            scope: "self",
            resolve: (ctx) => meriekeDestroyControlled(ctx),
        }),
        // NOT DSL-migratable (ADR 0045): same blocker as the leave trigger
        // above (`meriekeDestroyControlled`); `untapTrigger` also has no
        // `effects[]` site at all (its `resolve` is a required, non-optional
        // field — no dual-mode dispatch).
        untapTrigger({
            id: "merieke-ri-berit-on-untap",
            oracleText:
                "When Merieke Ri Berit becomes untapped, destroy that creature. It can't be regenerated.",
            scope: "self",
            resolve: (ctx) => meriekeDestroyControlled(ctx),
        }),
    ],
};
// Monsoon — "At the beginning of each player's end step, tap all untapped
// Islands that player controls and this enchantment deals X damage to the
// player, where X is the number of Islands tapped this way." (CR 603.6a phase
// trigger, scope "each" with the step's player delivered as `scopedPlayerId`;
// CR 701.26a tap; CR 120.1 damage.) Tap only the UNTAPPED Islands (already-
// tapped ones don't count), then deal damage equal to the number tapped this
// way (Power Surge's "untapped lands" read, but Monsoon also TAPS them).
const MONSOON_ID = "254fcc50-79a5-40cd-b028-e78dde3f8480";
export const monsoon: CardDefinition = {
    id: MONSOON_ID,
    name: "Monsoon",
    rarity: "rare",
    oracleText:
        "At the beginning of each player's end step, tap all untapped Islands that player controls and this enchantment deals X damage to the player, where X is the number of Islands tapped this way.",
    manaCost: { X: 2, R: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "monsoon-end-step",
            oracleText:
                "At the beginning of each player's end step, tap all untapped Islands that player controls and this enchantment deals X damage to the player, where X is the number of Islands tapped this way.",
            phase: "END_STEP",
            scope: "each",
            // NOT DSL-migratable (ADR 0045): RE-ASSESSED — the `each`-scope
            // blocker on `effects` itself has SHIPPED (issue #1066,
            // `{ ref: "$event.activePlayerId" }`; see phaseTrigger.ts), but two
            // real blockers remain: taps only UNTAPPED Islands and
            // `EffectCardFilter` (the forEach `permanents` selector's filter,
            // convex/cards/types.ts) has no tap-state field to select just
            // those; and the damage amount is the count TAPPED THIS WAY (the
            // just-tapped subset), not a selectable set's `count` — no Op
            // value construct captures "how many a `tapUntap` forEach actually
            // changed" (`tapUntap` no-ops silently on an already-tapped member,
            // per its registry note, with no output count). Blocked on: a
            // tap-state filter on the `permanents` forEach selector + a
            // tapped-this-way count value.
            resolve: (ctx, _event, scopedPlayerId) => {
                const islandIds = ctx.getBattlefieldIds(scopedPlayerId, {
                    subtypes: "Island",
                });
                let tapped = 0;
                for (const id of islandIds) {
                    const sel: TargetSelection = { type: "permanent", id };
                    if (!ctx.getIsTapped(sel)) {
                        ctx.tap(sel);
                        tapped++;
                    }
                }
                if (tapped > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        tapped
                    );
                }
            },
        }),
    ],
};
// Mountain Titan — "{1}{R}{R}: Until end of turn, whenever you cast a black
// spell, put a +1/+1 counter on this creature." (CR 605 activated ability that
// arms an until-end-of-turn cast-watch trigger via `grantTriggeredAbility` with
// `{ phase: "end-of-turn" }`, CR 611.2a; the granted rider — a
// `spellCastTrigger(scope:"you", filter:{colors:"B"})` on
// `triggeredGrantTemplates[]` — fires on each black spell you cast and adds a
// +1/+1 counter, CR 122.1.) The Bone Shaman pattern: the rider is grant-only
// (off `triggeredAbilities`) so it functions only while armed. Each activation
// stacks another copy until end of turn, matching the printed wording.
const MOUNTAIN_TITAN_ID = "bcc1d589-02a2-4896-a283-9d0385534667";
export const mountainTitan: CardDefinition = {
    id: MOUNTAIN_TITAN_ID,
    name: "Mountain Titan",
    rarity: "rare",
    oracleText:
        "{1}{R}{R}: Until end of turn, whenever you cast a black spell, put a +1/+1 counter on this creature.",
    manaCost: { X: 2, B: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "mountain-titan-arm-cast-watch",
            oracleText:
                "{1}{R}{R}: Until end of turn, whenever you cast a black spell, put a +1/+1 counter on this creature.",
            cost: { mana: { X: 1, R: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantTriggeredAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    MOUNTAIN_TITAN_ID,
                    "mountain-titan-black-cast-rider",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    // Granted-only rider (CR 113.1): off `triggeredAbilities` so it functions
    // only while armed by the activated ability.
    triggeredGrantTemplates: [
        spellCastTrigger({
            id: "mountain-titan-black-cast-rider",
            oracleText:
                "Whenever you cast a black spell, put a +1/+1 counter on this creature.",
            scope: "you",
            filter: { colors: "B" },
            // NOT DSL-migratable (ADR 0045): built via the `spellCastTrigger`
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
// Reclamation — {2}{G}{W} enchantment. Twin of Flooded Woodlands (black
// creatures). "Black creatures can't attack unless their controller sacrifices
// a land of their choice for each black creature they control that's attacking."
// (CR 508.1c/1g — the `attack-sacrifice-tax` combat seam, #733.)
export const reclamation: CardDefinition = {
    id: "ca335f4f-d345-4eb9-9bc6-74595c501078",
    name: "Reclamation",
    rarity: "rare",
    oracleText:
        "Black creatures can't attack unless their controller sacrifices a land of their choice for each black creature they control that's attacking. (This cost is paid as attackers are declared.)",
    manaCost: { X: 2, W: 1, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        attackSacrificeTaxForColor({
            id: "reclamation-black-tax",
            color: "B",
            oracleText:
                "Black creatures can't attack unless their controller sacrifices a land for each attacking black creature they control",
        }),
    ],
};
// Skeleton Ship — legendary 0/3 with a state-triggered "no Islands → sacrifice"
// guard (CR 603.8) and "{T}: Put a -1/-1 counter on target creature" (CR 122,
// layer 7d). The state trigger fizzles at resolve if an Island reappears.
export const skeletonShip: CardDefinition = {
    id: "271c8a7c-0f71-4f9d-ab0e-ca7c8c4aca50",
    name: "Skeleton Ship",
    rarity: "rare",
    oracleText:
        "When you control no Islands, sacrifice Skeleton Ship.\n{T}: Put a -1/-1 counter on target creature.",
    manaCost: { X: 3, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Skeleton"],
    power: 0,
    toughness: 3,
    triggeredAbilities: [
        stateTrigger({
            id: "skeleton-ship-no-islands",
            oracleText: "When you control no Islands, sacrifice Skeleton Ship.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!controller) return false;
                return !controller.battlefield.some((perm) =>
                    perm.subtypes.includes("Island")
                );
            },
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): a single
            // `sacrifice($source)` Op. No dedicated per-card test exercises
            // this clause specifically — covered by the catalogue-wide
            // `validateEffectScript` static sweep + the auto-generated
            // canned-scenario smoke test (per-Op regime, ADR 0045).
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
    ],
    activatedAbilities: [
        {
            id: "skeleton-ship-weaken",
            oracleText: "{T}: Put a -1/-1 counter on target creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // CR 122 (issue #841) — put one -1/-1 counter on the target.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "-1/-1",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};
// Spectral Shield — Aura: static +0/+2 (layer 7c) and "can't be the target of
// spells" on the host (CR 113.3 — spells only; abilities may still target it).
export const spectralShield: CardDefinition = {
    id: "7fe0a783-d086-4dc8-ae4a-59f3c2daaca0",
    name: "Spectral Shield",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nEnchanted creature gets +0/+2 and can't be the target of spells.",
    manaCost: { X: 1, W: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 0, toughness: 2 },
        {
            kind: "permanent-guard",
            id: "spectral-shield-spell-shroud",
            cantBeTargeted: true,
            targetSourceMustBeSpell: true,
            applies: (target, source) => target.id === source.attachedTo,
        },
    ],
};
// Storm Spirit — 3/3 flier with "{T}: deal 2 damage to target creature"
// (CR 605 activated ability, CR 120.1 damage).
export const stormSpirit: CardDefinition = {
    id: "7a383a5f-4814-4b92-aa80-2a6440a719bc",
    name: "Storm Spirit",
    rarity: "rare",
    oracleText: "Flying\n{T}: This creature deals 2 damage to target creature.",
    manaCost: { X: 3, W: 1, U: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "storm-spirit-zap",
            oracleText: "{T}: This creature deals 2 damage to target creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
// Stormbind — R/G Enchantment (activated here as part of the Red tranche, #633):
// "{2}, Discard a card at random: This enchantment deals 2 damage to any
// target." (CR 605 activated ability; the discard-at-random leg of the cost uses
// the `discardAtRandom` cost field; CR 120.1 damage.)
export const stormbind: CardDefinition = {
    id: "c2d5d91b-aeb4-4d7e-b748-77f9960da55f",
    name: "Stormbind",
    rarity: "rare",
    oracleText:
        "{2}, Discard a card at random: This enchantment deals 2 damage to any target.",
    manaCost: { X: 1, R: 1, G: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "stormbind-bolt",
            oracleText:
                "{2}, Discard a card at random: This enchantment deals 2 damage to any target.",
            cost: { mana: { X: 2 }, discardAtRandom: 1 },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
// Wings of Aesthir — Aura: static +1/+0 (layer 7c) plus flying and first
// strike grants on the host (CR 611 keyword-grant).
export const wingsOfAesthir: CardDefinition = {
    id: "eeb0282d-ccec-4556-8b70-b6f665077afe",
    name: "Wings of Aesthir",
    rarity: "uncommon",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+0 and has flying and first strike.",
    manaCost: { W: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 0 },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
    ],
};
