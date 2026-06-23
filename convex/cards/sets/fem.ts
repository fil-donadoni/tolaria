// Fallen Empires (FEM) — the 1994 faction-war expansion (102 unique cards, 187
// prints across its famous multi-art commons). This file follows the
// established set-file pattern (ADR 0014): every in-scope card is a new
// `CardDefinition` (FEM has zero reprints of already-implemented cards), and
// FEM's signature multi-artwork commons ship as ONE shared `CardDefinition`
// plus one `CardPrint` per additional artwork — all `setCode: "fem"`, all
// resolving to the single definition (mechanics come from the one def).
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical names /
// costs / P/T / subtypes are sourced from Scryfall `set:fem` (modern Oracle).
//
// THIS slice is the walking skeleton (#567): it registers the `fem` set and
// wires one thin end-to-end tracer — Vodalian Soldiers ({1}{U} 1/2 vanilla
// Merfolk Soldier) — together with its three alternate-art FEM prints. It
// proves the set file, the registry entry, the multi-art `CardPrint` plumbing,
// pool/deck availability, projection, and the test harness all work before the
// six thematic faction clusters land (see PRD #566).
//
// Generic mana is encoded as `X: n` (e.g. {1}{U} → { X: 1, U: 1 }).

import type {
    CardDefinition,
    CardPrint,
    SpellContext,
    TokenSpec,
} from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { untapRestriction } from "../abilities/static/untapRestriction";
import { payOrSacrificeUpkeepTrigger } from "./leg";
import { manaCostForCardId } from "../manaCostLookup";

/** Colours of a permanent view, derived from its mana cost (CR 202.2). The
 *  block-restriction predicates receive a `PermanentView` that carries only an
 *  `{ id }` reference on `card` in production, so colours are recovered
 *  cycle-safely via the registry lookup (test fixtures may inline `manaCost`).
 *  Mirrors leg.ts's `colorsOf` exactly — including the inlined colour list — so
 *  this set module never imports `../colors` (which sits in a
 *  `colors → gre/constants → index → sets` cycle and would create a TDZ hazard
 *  under strict ESM evaluation). */
function colorsOfView(view: { card?: Record<string, unknown> }): string[] {
    const card = view.card ?? {};
    const inlined = (card as { manaCost?: import("../types").ManaCost })
        .manaCost;
    const cardId = (card as { id?: string }).id;
    const cost = inlined ?? (cardId ? manaCostForCardId(cardId) : undefined);
    if (!cost) return [];
    return (["W", "U", "B", "R", "G"] as const).filter(
        (c) => (cost[c] ?? 0) > 0
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla creatures (CR 302 — Creature cards with no rules text are pure data:
// types/subtypes + P/T only; they resolve from the stack onto the battlefield
// via the generic permanent-resolution path, CR 608.3).
// ─────────────────────────────────────────────────────────────────────────────

// Vodalian Soldiers — {1}{U} 1/2 vanilla Merfolk Soldier. FEM printed it with
// four distinct artworks (collector numbers 31a–31d). The canonical
// `CardDefinition` uses the 31a print's Scryfall UUID as its id; the remaining
// three artworks are `CardPrint` entries below, all resolving to this one def.
export const vodalianSoldiers: CardDefinition = {
    id: "7eb50256-9113-4b03-bcef-9aea24be8493", // FEM 31a (canonical art)
    rarity: "common",
    name: "Vodalian Soldiers",
    oracleText: "",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Soldier"],
    power: 1,
    toughness: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-art prints (ADR 0014). Each additional FEM artwork is a `CardPrint`
// resolving to the shared definition above. The registry maps every `printId`
// to the same `CardDefinition`, so a deck/instance referencing any artwork gets
// the identical mechanics while rendering the chosen art (the instance keeps
// `card.id === printId`).
// ─────────────────────────────────────────────────────────────────────────────

export const vodalianSoldiersFemB: CardPrint = {
    printId: "bc85a68c-14d6-4447-a894-0e48d1662bc3", // FEM 31b
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemC: CardPrint = {
    printId: "d8d1ceac-bb75-4c46-9ab4-1ef623ed3027", // FEM 31c
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemD: CardPrint = {
    printId: "99d22f83-1171-4b5c-8a72-956db26d7c60", // FEM 31d
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

// ═════════════════════════════════════════════════════════════════════════════
// C1 — Green: Thallids, Fungi & Elves (PRD #566, issue #569)
//
// The FEM green faction: the spore/Saproling token engine (Thallids + Fungi +
// the Elf utility shell) plus the one genuinely-new capability for this cluster,
// exile-from-graveyard as an activation cost (Night Soil). Everything else is
// reuse of shipped primitives:
//   • spore counters via named counters (CR 122.1) put on each upkeep
//     (phaseTrigger UPKEEP/your) and removed three-at-a-time as a cost
//     (cost.removeCounter, CR 122.6),
//   • 1/1 green Saproling tokens via createToken (CR 111, 707.1),
//   • sacrifice-a-Saproling / sacrifice-a-creature payoffs via cost.sacrificeFilter
//     (CR 602.1 / 118.5),
//   • combat-damage prevention (CR 615 — preventAllCombatDamage /
//     preventAllCombatDamageToAndBy),
//   • land animation (CR 208.2, 611.1 — animateAsCreature, "still a land") and
//     indefinite land-subtype change (CR 305.7 — setSubtypes),
//   • symmetric untap-lock on blue creatures (CR 611 — untapRestriction with a
//     colour filter, the Meekstone pattern),
//   • a Swamp-ETB punisher (CR 603.6a PERMANENT_ENTERED) + the shipped
//     pay-or-sacrifice upkeep trigger (CR 117.3a).
// All card data validated against Scryfall `set:fem` (modern Oracle, ADR 0004).
// Green FEM cards are single-art — no multi-art CardPrints in this cluster.
// ═════════════════════════════════════════════════════════════════════════════

/** Shared 1/1 green Saproling token spec (CR 111, 707.1). Reused by Thallid,
 *  Thallid Devourer, Elvish Farmer and Night Soil — extracted on the second
 *  use per the project's primitive-reuse convention. */
const SAPROLING_TOKEN: TokenSpec = {
    name: "Saproling",
    types: ["Creature"],
    subtypes: ["Saproling"],
    power: 1,
    toughness: 1,
    colors: ["G"],
};

/** Builds the shared "At the beginning of your upkeep, put a spore counter on
 *  this creature." trigger (CR 603.6a + 122.1). Every Thallid/Fungus that
 *  accrues spores reuses this — the only per-card variation is the spore
 *  PAYOFF, expressed as a separate `cost.removeCounter` activated ability. */
function sporeUpkeepTrigger(id: string) {
    return phaseTrigger({
        id,
        oracleText:
            "At the beginning of your upkeep, put a spore counter on this creature.",
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            ctx.addCounter(
                { type: "permanent", id: ctx.sourceInstanceId },
                "spore",
                1
            );
        },
    });
}

// Thallid — {G} 1/1 Fungus. The archetypal spore engine: spores in, a Saproling
// out for three.
export const thallid: CardDefinition = {
    id: "4caaf31b-86a9-485b-8da7-d5b526ed1233", // FEM 74a (canonical art)
    rarity: "common",
    name: "Thallid",
    oracleText:
        "At the beginning of your upkeep, put a spore counter on this creature.\nRemove three spore counters from this creature: Create a 1/1 green Saproling creature token.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Fungus"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [sporeUpkeepTrigger("thallid-spore-upkeep")],
    activatedAbilities: [
        {
            id: "thallid-make-saproling",
            oracleText:
                "Remove three spore counters from this creature: Create a 1/1 green Saproling creature token.",
            cost: { removeCounter: { type: "spore", count: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(SAPROLING_TOKEN, ctx.controller, 1);
            },
        },
    ],
};

export const thallidFemB: CardPrint = {
    printId: "80f8f778-ae31-45cd-b27f-f93a07853ede", // FEM 74b
    definitionId: thallid.id,
    setCode: "fem",
    rarity: "common",
};
export const thallidFemC: CardPrint = {
    printId: "2cf2f3da-9101-439d-8caa-910ff40bfbb3", // FEM 74c
    definitionId: thallid.id,
    setCode: "fem",
    rarity: "common",
};
export const thallidFemD: CardPrint = {
    printId: "01827286-b104-41c5-bac9-7c38414bc40e", // FEM 74d
    definitionId: thallid.id,
    setCode: "fem",
    rarity: "common",
};

// Thallid Devourer — {1}{G}{G} 2/2 Fungus. Spore engine + sacrifice-a-Saproling
// for a temporary pump (CR 611.2 until-end-of-turn buff).
export const thallidDevourer: CardDefinition = {
    id: "aa533845-4c4b-4072-aa39-8e56ce7ec325", // FEM 75
    rarity: "uncommon",
    name: "Thallid Devourer",
    oracleText:
        "At the beginning of your upkeep, put a spore counter on this creature.\nRemove three spore counters from this creature: Create a 1/1 green Saproling creature token.\nSacrifice a Saproling: This creature gets +1/+2 until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Fungus"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [sporeUpkeepTrigger("thallid-devourer-spore-upkeep")],
    activatedAbilities: [
        {
            id: "thallid-devourer-make-saproling",
            oracleText:
                "Remove three spore counters from this creature: Create a 1/1 green Saproling creature token.",
            cost: { removeCounter: { type: "spore", count: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(SAPROLING_TOKEN, ctx.controller, 1);
            },
        },
        {
            id: "thallid-devourer-devour",
            oracleText:
                "Sacrifice a Saproling: This creature gets +1/+2 until end of turn.",
            cost: { sacrificeFilter: { subtypes: ["Saproling"] } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Thorn Thallid — {1}{G}{G} 2/2 Fungus. Spore engine; the payoff pings any
// target for 1 (CR 115.4 "any target").
export const thornThallid: CardDefinition = {
    id: "16e61c00-3e94-4f6f-8515-65b430829e91", // FEM 80a
    rarity: "common",
    name: "Thorn Thallid",
    oracleText:
        "At the beginning of your upkeep, put a spore counter on this creature.\nRemove three spore counters from this creature: It deals 1 damage to any target.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Fungus"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [sporeUpkeepTrigger("thorn-thallid-spore-upkeep")],
    activatedAbilities: [
        {
            id: "thorn-thallid-ping",
            oracleText:
                "Remove three spore counters from this creature: It deals 1 damage to any target.",
            cost: { removeCounter: { type: "spore", count: 3 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent" || target?.type === "player") {
                    ctx.dealDamage(target, 1);
                }
            },
        },
    ],
};

export const thornThallidFemB: CardPrint = {
    printId: "84283348-789b-4236-b406-7fc6338a867d", // FEM 80b
    definitionId: thornThallid.id,
    setCode: "fem",
    rarity: "common",
};
export const thornThallidFemC: CardPrint = {
    printId: "1537a338-3b68-4a41-bac6-554e8e530e46", // FEM 80c
    definitionId: thornThallid.id,
    setCode: "fem",
    rarity: "common",
};
export const thornThallidFemD: CardPrint = {
    printId: "1e8f50be-1629-40eb-8916-019903d2e6a4", // FEM 80d
    definitionId: thornThallid.id,
    setCode: "fem",
    rarity: "common",
};

// Feral Thallid — {3}{G}{G}{G} 6/3 Fungus. Spore engine; the payoff regenerates
// it (CR 701.15a regeneration shield).
export const feralThallid: CardDefinition = {
    id: "e585241e-c647-456d-b3b1-3d48dd78c372", // FEM 69
    rarity: "uncommon",
    name: "Feral Thallid",
    oracleText:
        "At the beginning of your upkeep, put a spore counter on this creature.\nRemove three spore counters from this creature: Regenerate this creature.",
    manaCost: { X: 3, G: 3 },
    types: ["Creature"],
    subtypes: ["Fungus"],
    power: 6,
    toughness: 3,
    triggeredAbilities: [sporeUpkeepTrigger("feral-thallid-spore-upkeep")],
    activatedAbilities: [
        {
            id: "feral-thallid-regenerate",
            oracleText:
                "Remove three spore counters from this creature: Regenerate this creature.",
            cost: { removeCounter: { type: "spore", count: 3 } },
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

// Spore Flower — {G}{G} 0/1 Fungus. Spore engine; the payoff is a Fog
// (CR 615 — prevent all combat damage this turn).
export const sporeFlower: CardDefinition = {
    id: "f9681dc0-d0fc-4d5b-a23c-63ec1cc8343d", // FEM 73
    rarity: "uncommon",
    name: "Spore Flower",
    oracleText:
        "At the beginning of your upkeep, put a spore counter on this creature.\nRemove three spore counters from this creature: Prevent all combat damage that would be dealt this turn.",
    manaCost: { G: 2 },
    types: ["Creature"],
    subtypes: ["Fungus"],
    power: 0,
    toughness: 1,
    triggeredAbilities: [sporeUpkeepTrigger("spore-flower-spore-upkeep")],
    activatedAbilities: [
        {
            id: "spore-flower-fog",
            oracleText:
                "Remove three spore counters from this creature: Prevent all combat damage that would be dealt this turn.",
            cost: { removeCounter: { type: "spore", count: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventAllCombatDamage();
            },
        },
    ],
};

// Fungal Bloom — {G}{G} Enchantment. "{G}{G}: Put a spore counter on target
// Fungus." (CR 122.1 — feeds the spore engine externally.)
export const fungalBloom: CardDefinition = {
    id: "cf1a2cb2-9a6b-41f7-96f7-ec457c69c16c", // FEM 70
    rarity: "rare",
    name: "Fungal Bloom",
    oracleText: "{G}{G}: Put a spore counter on target Fungus.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "fungal-bloom-feed",
            oracleText: "{G}{G}: Put a spore counter on target Fungus.",
            cost: { mana: { G: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Fungus",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addCounter(target, "spore", 1);
                }
            },
        },
    ],
};

// Elvish Farmer — {1}{G} 0/2 Elf. Spore engine; sacrifice a Saproling to gain
// 2 life (CR 602.1 sacrifice cost via subtype filter).
export const elvishFarmer: CardDefinition = {
    id: "40a9710e-b2f8-4746-8640-d450f58a6e49", // FEM 66
    rarity: "common",
    name: "Elvish Farmer",
    oracleText:
        "At the beginning of your upkeep, put a spore counter on this creature.\nRemove three spore counters from this creature: Create a 1/1 green Saproling creature token.\nSacrifice a Saproling: You gain 2 life.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 0,
    toughness: 2,
    triggeredAbilities: [sporeUpkeepTrigger("elvish-farmer-spore-upkeep")],
    activatedAbilities: [
        {
            id: "elvish-farmer-make-saproling",
            oracleText:
                "Remove three spore counters from this creature: Create a 1/1 green Saproling creature token.",
            cost: { removeCounter: { type: "spore", count: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(SAPROLING_TOKEN, ctx.controller, 1);
            },
        },
        {
            id: "elvish-farmer-gain-life",
            oracleText: "Sacrifice a Saproling: You gain 2 life.",
            cost: { sacrificeFilter: { subtypes: ["Saproling"] } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.gainLife(ctx.controller, 2);
            },
        },
    ],
};

// Elven Fortress — {G} Enchantment. "{1}{G}: Target blocking creature gets
// +0/+1 until end of turn." (CR 611.2 temporary toughness buff.)
export const elvenFortress: CardDefinition = {
    id: "9387105d-46d0-4db0-8980-dd0fded15eef", // FEM 65a (canonical art)
    rarity: "common",
    name: "Elven Fortress",
    oracleText:
        "{1}{G}: Target blocking creature gets +0/+1 until end of turn.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "elven-fortress-pump",
            oracleText:
                "{1}{G}: Target blocking creature gets +0/+1 until end of turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "blocking",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 0, 1, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

export const elvenFortressFemB: CardPrint = {
    printId: "091b5ed4-91f5-47c1-b1a1-5443f7346078", // FEM 65b
    definitionId: elvenFortress.id,
    setCode: "fem",
    rarity: "common",
};
export const elvenFortressFemC: CardPrint = {
    printId: "960b542f-cb24-4f74-92da-d31559d87c2d", // FEM 65c
    definitionId: elvenFortress.id,
    setCode: "fem",
    rarity: "common",
};
export const elvenFortressFemD: CardPrint = {
    printId: "c52743f0-5c5b-46b9-bbbd-67950d4c89e5", // FEM 65d
    definitionId: elvenFortress.id,
    setCode: "fem",
    rarity: "common",
};

// Elvish Hunter — {1}{G} 1/1 Elf Archer. "{1}{G}, {T}: Target creature doesn't
// untap during its controller's next untap step." (CR 302.6 — one-shot untap
// skip.)
export const elvishHunter: CardDefinition = {
    id: "e00455ac-c7ce-4916-98ed-cca9354e3f22", // FEM 67a (canonical art)
    rarity: "common",
    name: "Elvish Hunter",
    oracleText:
        "{1}{G}, {T}: Target creature doesn't untap during its controller's next untap step.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Archer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "elvish-hunter-lock",
            oracleText:
                "{1}{G}, {T}: Target creature doesn't untap during its controller's next untap step.",
            cost: { mana: { X: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.skipNextUntap(target);
                }
            },
        },
    ],
};

export const elvishHunterFemB: CardPrint = {
    printId: "51ff096c-487f-42f9-a394-a298503391da", // FEM 67b
    definitionId: elvishHunter.id,
    setCode: "fem",
    rarity: "common",
};
export const elvishHunterFemC: CardPrint = {
    printId: "204c8aff-b103-4606-b86b-d794bc5dcde1", // FEM 67c
    definitionId: elvishHunter.id,
    setCode: "fem",
    rarity: "common",
};

// Elvish Scout — {G} 1/1 Elf Scout. "{G}, {T}: Untap target attacking creature
// you control. Prevent all combat damage that would be dealt to and dealt by it
// this turn." (CR 615 — single-permanent combat-damage prevention.)
export const elvishScout: CardDefinition = {
    id: "689cd2ed-be81-4769-a8ec-287946301396", // FEM 68a (canonical art)
    rarity: "common",
    name: "Elvish Scout",
    oracleText:
        "{G}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by it this turn.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Scout"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "elvish-scout-untap",
            oracleText:
                "{G}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by it this turn.",
            cost: { mana: { G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                combatRoleFilter: "attacking",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.untap(target);
                    ctx.preventAllCombatDamageToAndBy(target, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

export const elvishScoutFemB: CardPrint = {
    printId: "1faff88d-594e-473c-a2d1-cd60f51b2ee7", // FEM 68b
    definitionId: elvishScout.id,
    setCode: "fem",
    rarity: "common",
};
export const elvishScoutFemC: CardPrint = {
    printId: "d414bf5a-2604-426c-8c68-5c1696557b57", // FEM 68c
    definitionId: elvishScout.id,
    setCode: "fem",
    rarity: "common",
};

// Spore Cloud — {1}{G}{G} Instant. "Tap all blocking creatures. Prevent all
// combat damage that would be dealt this turn. Each attacking creature and each
// blocking creature doesn't untap during its controller's next untap step."
// (CR 701.20a tap; CR 615 Fog; CR 302.6 one-shot untap skip per combatant.)
export const sporeCloud: CardDefinition = {
    id: "1691a9f4-4ea7-440f-9bdc-4214ab3c90f0", // FEM 72a (canonical art)
    rarity: "uncommon",
    name: "Spore Cloud",
    oracleText:
        "Tap all blocking creatures. Prevent all combat damage that would be dealt this turn. Each attacking creature and each blocking creature doesn't untap during its controller's next untap step.",
    manaCost: { X: 1, G: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        // CR 701.20a — tap every blocking creature (both controllers).
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                isBlocking: true,
            })) {
                ctx.tap({ type: "permanent", id });
            }
        }
        // CR 615 — Fog the whole combat.
        ctx.preventAllCombatDamage();
        // CR 302.6 — each attacking and each blocking creature skips its next
        // untap step.
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                isAttacking: true,
            })) {
                ctx.skipNextUntap({ type: "permanent", id });
            }
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                isBlocking: true,
            })) {
                ctx.skipNextUntap({ type: "permanent", id });
            }
        }
    },
};

export const sporeCloudFemB: CardPrint = {
    printId: "2c3070f8-6dae-4f22-b186-e2a3a9647cc5", // FEM 72b
    definitionId: sporeCloud.id,
    setCode: "fem",
    rarity: "uncommon",
};
export const sporeCloudFemC: CardPrint = {
    printId: "17fe098c-c9b5-4bba-92b5-5720d6919073", // FEM 72c
    definitionId: sporeCloud.id,
    setCode: "fem",
    rarity: "uncommon",
};

// Thelonite Druid — {2}{G} 1/1 Human Cleric Druid. "{1}{G}, {T}, Sacrifice a
// creature: Forests you control become 2/3 creatures until end of turn. They're
// still lands." (CR 208.2, 611.1 — animate-as-creature keeps the Land type.)
export const theloniteDruid: CardDefinition = {
    id: "cd8772dd-513d-4dd0-a5db-5214dc8da4e0", // FEM 78
    rarity: "rare",
    name: "Thelonite Druid",
    oracleText:
        "{1}{G}, {T}, Sacrifice a creature: Forests you control become 2/3 creatures until end of turn. They're still lands.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "thelonite-druid-animate-forests",
            oracleText:
                "{1}{G}, {T}, Sacrifice a creature: Forests you control become 2/3 creatures until end of turn. They're still lands.",
            cost: {
                mana: { X: 1, G: 1 },
                tap: true,
                sacrificeFilter: { types: "Creature" },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 208.2 / 611.1 — every Forest the controller controls
                // becomes a 2/3 creature until end of turn; the Land type is
                // retained (animateAsCreature adds Creature, never removes
                // Land), so "still lands" holds automatically.
                for (const id of ctx.getBattlefieldIds(ctx.controller, {
                    subtypes: "Forest",
                })) {
                    ctx.animateAsCreature(
                        { type: "permanent", id },
                        {
                            power: 2,
                            toughness: 3,
                            duration: { phase: "end-of-turn" },
                        }
                    );
                }
            },
        },
    ],
};

// Thelonite Monk — {2}{G}{G} 1/2 Insect Monk Cleric. "{T}, Sacrifice a green
// creature: Target land becomes a Forest. (This effect lasts indefinitely.)"
// (CR 305.7 — one-shot subtype replacement; the land gains intrinsic {G}.)
export const theloniteMonk: CardDefinition = {
    id: "5400ff25-c70e-4095-a228-190601b86043", // FEM 79
    rarity: "uncommon",
    name: "Thelonite Monk",
    oracleText:
        "{T}, Sacrifice a green creature: Target land becomes a Forest. (This effect lasts indefinitely.)",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Insect", "Monk", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "thelonite-monk-forest",
            oracleText:
                "{T}, Sacrifice a green creature: Target land becomes a Forest. (This effect lasts indefinitely.)",
            cost: {
                tap: true,
                sacrificeFilter: { types: "Creature", colors: "G" },
            },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    // CR 305.7 — becomes a Forest indefinitely (replaces the
                    // land's subtypes; intrinsic {G} follows from the subtype).
                    ctx.setSubtypes(target, ["Forest"]);
                }
            },
        },
    ],
};

// Thelon's Chant — {1}{G}{G} Enchantment. Upkeep pay-{G}-or-sacrifice (CR
// 117.3a, reusing the shipped pay-or-sacrifice upkeep trigger) + a Swamp-ETB
// punisher: "Whenever a player puts a Swamp onto the battlefield, this
// enchantment deals 3 damage to that player unless the player puts a -1/-1
// counter on a creature they control." (CR 603.6a PERMANENT_ENTERED + CR
// 117.3a-style punisher choice via requestMayPay; the entering land's Swamp
// subtype is read from state in the trigger condition because the
// PERMANENT_ENTERED event payload doesn't carry subtypes.)
export const thelonsChant: CardDefinition = {
    id: "9d970195-0a09-4cb4-a2c0-c16fcab5c859", // FEM 76
    rarity: "rare",
    name: "Thelon's Chant",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {G}.\nWhenever a player puts a Swamp onto the battlefield, this enchantment deals 3 damage to that player unless the player puts a -1/-1 counter on a creature they control.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "thelons-chant-upkeep",
            cardName: "Thelon's Chant",
            cost: { G: 1 },
            costText: "{G}",
        }),
        enteredTrigger({
            id: "thelons-chant-swamp-punish",
            oracleText:
                "Whenever a player puts a Swamp onto the battlefield, this enchantment deals 3 damage to that player unless the player puts a -1/-1 counter on a creature they control.",
            scope: "any",
            // The event payload doesn't carry subtypes (enteredTrigger forces
            // subtypes: []), so gate on the entering land's live subtypes read
            // from state (CR 603.4 check-time predicate).
            condition: (event, _self, state) => {
                if (event.type !== "PERMANENT_ENTERED") return false;
                for (const p of state?.players ?? []) {
                    const perm = p.battlefield.find(
                        (c) => c.id === event.instanceId
                    );
                    if (perm) return perm.subtypes.includes("Swamp");
                }
                return false;
            },
            resolve: (ctx, event, entered) => {
                if (event.type !== "PERMANENT_ENTERED") return;
                const player = entered.controllerId;
                // CR 117.3a-style punisher: the player may put a -1/-1 counter
                // on one of their creatures to avoid the 3 damage.
                const creatures = ctx.getBattlefieldIds(player, {
                    types: "Creature",
                });
                if (creatures.length === 0) {
                    ctx.dealDamage({ type: "player", id: player }, 3);
                    return;
                }
                const picks = ctx.requestChoice({
                    playerId: player,
                    choiceId: `thelons-chant-counter-${event.instanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: player,
                    filter: { types: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Put a -1/-1 counter on a creature you control, or take 3 damage from Thelon's Chant.",
                });
                if (picks === undefined) return; // suspended for the choice
                if (picks.length === 0) {
                    ctx.dealDamage({ type: "player", id: player }, 3);
                } else {
                    ctx.addCounter(
                        { type: "permanent", id: picks[0] },
                        "-1/-1",
                        1
                    );
                }
            },
        }),
    ],
};

// Thelon's Curse — {G}{G} Enchantment. Symmetric untap-lock on every blue
// creature (CR 611 — untapRestriction with a colour filter, maxUntap 0; the
// Meekstone pattern) plus a per-upkeep pay-{U}-to-untap escape for each player.
export const thelonsCurse: CardDefinition = {
    id: "9b868846-cc3c-4756-a5dd-2335bb380567", // FEM 77
    rarity: "rare",
    name: "Thelon's Curse",
    oracleText:
        "Blue creatures don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {U} for each creature chosen this way. If the player does, untap those creatures.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "thelons-curse-blue-lock",
            oracleText:
                "Blue creatures don't untap during their controllers' untap steps (Thelon's Curse).",
            filter: { types: "Creature", colors: "U" },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "thelons-curse-untap-escape",
            oracleText:
                "At the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {U} for each creature chosen this way. If the player does, untap those creatures.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const player = scopedPlayerId;
                // Tapped blue creatures the active player controls.
                const candidates = ctx
                    .getBattlefieldIds(player, {
                        types: "Creature",
                        colors: "U",
                    })
                    .filter((id) => ctx.getIsTapped({ type: "permanent", id }));
                if (candidates.length === 0) return;
                // Pay {U} per chosen creature: model as a single may-pay per
                // candidate (CR 117.3a), untapping each one whose {U} is paid.
                for (const id of candidates) {
                    const paid = ctx.requestMayPay({
                        playerId: player,
                        choiceId: `thelons-curse-untap-${id}`,
                        cost: { U: 1 },
                        prompt: "Pay {U} to untap this blue creature (Thelon's Curse)?",
                    });
                    if (paid === undefined) return; // suspended for the choice
                    if (paid) ctx.untap({ type: "permanent", id });
                }
            },
        }),
    ],
};

// Night Soil — {G}{G} Enchantment. NEW capability E — exile-from-graveyard as a
// real activation cost: "{1}, Exile two creature cards from a single graveyard:
// Create a 1/1 green Saproling creature token." (CR 602.1 / 118.5 / 406 — the
// exile cost is wired in game.ts via `cost.exileFromGraveyard` +
// selectActivationExileCost; see PendingActivation.exileFromGraveyardChoice.)
export const nightSoil: CardDefinition = {
    id: "4cda6d18-d4b1-4b8a-a72e-f90115adf4c3", // FEM 71a (canonical art)
    rarity: "common",
    name: "Night Soil",
    oracleText:
        "{1}, Exile two creature cards from a single graveyard: Create a 1/1 green Saproling creature token.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "night-soil-make-saproling",
            oracleText:
                "{1}, Exile two creature cards from a single graveyard: Create a 1/1 green Saproling creature token.",
            cost: {
                mana: { X: 1 },
                exileFromGraveyard: { count: 2, cardType: "Creature" },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(SAPROLING_TOKEN, ctx.controller, 1);
            },
        },
    ],
};

export const nightSoilFemB: CardPrint = {
    printId: "4f25a497-46dc-47aa-8586-d514578a6d25", // FEM 71b
    definitionId: nightSoil.id,
    setCode: "fem",
    rarity: "common",
};
export const nightSoilFemC: CardPrint = {
    printId: "ee3eb61b-698c-42b1-8a33-0ce7c3829e07", // FEM 71c
    definitionId: nightSoil.id,
    setCode: "fem",
    rarity: "common",
};

// ═════════════════════════════════════════════════════════════════════════════
// C3 — White: Icatians & Order of Leitbur (PRD #566, issue #568). The white
// faction is the Icatian Empire: soldier tribal, banding, combat-damage
// prevention, and counter-based utility. Two new engine capabilities ship with
// this cluster:
//   D — `tapOtherFilter` activation cost (Hand of Justice).
//   G — non-tap repeatable mana ability + activation-count delayed sacrifice
//       (Farrelite Priest), reusing the per-instance `activationsThisTurn`
//       counter (Dragon Whelp pattern) + `scheduleDelayedTrigger`.
// Every other card composes existing primitives.
// ═════════════════════════════════════════════════════════════════════════════

// --- Combat Medic ({2}{W} 0/2 Human Cleric Soldier) ---------------------------
// "{1}{W}: Prevent the next 1 damage that would be dealt to any target this
// turn." (CR 615 prevention shield via `preventNextNDamageToTarget`; identical
// shape to Samite Healer but with a {1}{W} mana cost instead of {T}.)
export const combatMedic: CardDefinition = {
    id: "9cfd96cb-03d6-4845-8595-50bf17b35726", // FEM 1a
    rarity: "common",
    name: "Combat Medic",
    oracleText:
        "{1}{W}: Prevent the next 1 damage that would be dealt to any target this turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Soldier"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "combat-medic-prevent",
            oracleText:
                "{1}{W}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.preventNextNDamageToTarget(target, 1, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

export const combatMedicFemB: CardPrint = {
    printId: "2a324a98-31c2-470a-b792-96b6b098a58c", // FEM 1b
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};
export const combatMedicFemC: CardPrint = {
    printId: "ee9d1eac-3ac2-4881-a984-e40d87f60784", // FEM 1c
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};
export const combatMedicFemD: CardPrint = {
    printId: "8f26c079-61ea-436d-89ae-2f1c6f863e91", // FEM 1d
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};

// --- Farrel's Mantle ({2}{W} Aura) --------------------------------------------
// "Enchant creature\nWhenever enchanted creature attacks and isn't blocked, its
// controller may have it deal damage equal to its power plus 2 to another target
// creature. If that player does, the attacking creature assigns no combat damage
// this turn." (CR 509.1h ATTACKER_UNBLOCKED; CR 603.3d optional targeted trigger
// resolved imperatively via `requestChoice`; CR 510.1c `markAssignsNoCombatDamage`.)
const FARRELS_MANTLE_ID = "af092da3-8713-4a59-86d3-827b942d6456"; // FEM 2
export const farrelsMantle: CardDefinition = {
    id: FARRELS_MANTLE_ID,
    rarity: "common",
    name: "Farrel's Mantle",
    oracleText:
        "Enchant creature\nWhenever enchanted creature attacks and isn't blocked, its controller may have it deal damage equal to its power plus 2 to another target creature. If that player does, the attacking creature assigns no combat damage this turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        {
            id: "farrels-mantle-unblocked",
            oracleText:
                "Whenever enchanted creature attacks and isn't blocked, its controller may have it deal damage equal to its power plus 2 to another target creature. If that player does, the attacking creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                self.attachedTo !== undefined &&
                event.attackerId === self.attachedTo,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                const attackerId = event.attackerId;
                const attacker = { type: "permanent" as const, id: attackerId };
                const controllerId = ctx.getController(attacker);
                if (controllerId === undefined) return;
                // CR 603.3d — "another target creature": every creature except
                // the attacking creature itself.
                const candidates = ctx.allPlayerIds
                    .flatMap((p) =>
                        ctx.getBattlefieldIds(p, { types: "Creature" })
                    )
                    .filter((id) => id !== attackerId);
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: controllerId,
                    choiceId: `farrels-mantle-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Farrel's Mantle: deal damage to another target creature? (decline to assign normal combat damage)",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return; // declined — combat damage assigned normally
                const power = ctx.getPower(attacker) ?? 0;
                ctx.dealDamage({ type: "permanent", id: targetId }, power + 2);
                // CR 510.1c — "the attacking creature assigns no combat damage
                // this turn."
                ctx.markAssignsNoCombatDamage(attacker);
            },
        },
    ],
};

// --- Farrel's Zealot ({1}{W}{W} 2/2 Human) ------------------------------------
// "Whenever this creature attacks and isn't blocked, you may have it deal 3
// damage to target creature. If you do, this creature assigns no combat damage
// this turn." (Same shape as Farrel's Mantle but self-scoped and a fixed 3.)
export const farrelsZealot: CardDefinition = {
    id: "0401bd23-9f81-40b7-a6c2-e3f9847d175c", // FEM 3a
    rarity: "common",
    name: "Farrel's Zealot",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may have it deal 3 damage to target creature. If you do, this creature assigns no combat damage this turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "farrels-zealot-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may have it deal 3 damage to target creature. If you do, this creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const candidates = ctx.allPlayerIds.flatMap((p) =>
                    ctx.getBattlefieldIds(p, { types: "Creature" })
                );
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `farrels-zealot-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Farrel's Zealot: deal 3 damage to target creature? (decline to assign normal combat damage)",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return; // declined
                ctx.dealDamage({ type: "permanent", id: targetId }, 3);
                ctx.markAssignsNoCombatDamage(self);
            },
        },
    ],
};

export const farrelsZealotFemB: CardPrint = {
    printId: "9e3aeee7-975c-419a-bfb3-45bb48ba6918", // FEM 3b
    definitionId: farrelsZealot.id,
    setCode: "fem",
    rarity: "common",
};
export const farrelsZealotFemC: CardPrint = {
    printId: "54252fd2-21a6-40d1-8515-697f18c78a06", // FEM 3c
    definitionId: farrelsZealot.id,
    setCode: "fem",
    rarity: "common",
};

// --- Farrelite Priest ({1}{W}{W} 1/3 Human Cleric) ----------------------------
// "{1}: Add {W}. If this ability has been activated four or more times this
// turn, sacrifice this creature at the beginning of the next end step."
// CAPABILITY G: a NON-tap repeatable mana ability (CR 605.1a) — resolved via
// `activateManaAbility`, which records the per-turn `activationsThisTurn` count
// before running this `resolve`. `getActivationCount` therefore includes the
// current activation (CR 602.5); on the 4th+ a delayed end-step self-sacrifice
// is scheduled (CR 603.7a, Dragon Whelp pattern). Each activation past the 3rd
// schedules a separate trigger; later ones are no-ops once the creature is gone.
const FARRELITE_PRIEST_ID = "e11bf79b-a951-4d0c-acdf-d8ba5290a648"; // FEM 4
export const farrelitePriest: CardDefinition = {
    id: FARRELITE_PRIEST_ID,
    rarity: "common",
    name: "Farrelite Priest",
    oracleText:
        "{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "farrelite-priest-mana",
            oracleText:
                "{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
            cost: { mana: { X: 1 } },
            // CR 605.1a — this adds mana and isn't a tap ability: it's a mana
            // ability (does NOT use the stack) but is repeatable (no {T}).
            useStack: false,
            manaProduced: { W: 1 },
            resolve: (ctx: SpellContext) => {
                ctx.addMana({ W: 1 });
                // CR 602.5 — count includes the current activation (recorded
                // before resolve runs).
                const count = ctx.getActivationCount("farrelite-priest-mana");
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        FARRELITE_PRIEST_ID,
                        "farrelite-priest-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "farrelite-priest-sacrifice",
            oracleText:
                "Sacrifice Farrelite Priest at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.sacrifice(targetId);
            },
        },
    ],
};

// --- Hand of Justice ({5}{W} 2/6 Avatar) --------------------------------------
// "{T}, Tap three untapped white creatures you control: Destroy target
// creature." CAPABILITY D: the `tapOtherFilter` activation cost (CR 602.1 /
// 118.8) taps three OTHER untapped white creatures (the source pays its own {T}
// separately). Enforced for legality and consumed on activation.
export const handOfJustice: CardDefinition = {
    id: "7a899b2d-825c-4929-a769-f4df70bf6a17", // FEM 5
    rarity: "rare",
    name: "Hand of Justice",
    oracleText:
        "{T}, Tap three untapped white creatures you control: Destroy target creature.",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Avatar"],
    power: 2,
    toughness: 6,
    activatedAbilities: [
        {
            id: "hand-of-justice-destroy",
            oracleText:
                "{T}, Tap three untapped white creatures you control: Destroy target creature.",
            cost: {
                tap: true,
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        colors: "W",
                        controllerRelation: "you",
                    },
                    count: 3,
                },
            },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.destroy(target);
            },
        },
    ],
};

// --- Heroism ({2}{W} Enchantment) ---------------------------------------------
// "Sacrifice a white creature: For each attacking red creature, prevent all
// combat damage that would be dealt by that creature this turn unless its
// controller pays {2}{R}." CR 615 prevention scoped per attacking red creature,
// each gated by a `requestMayPay({2}{R})` to that creature's controller; an
// unpaid creature is marked to assign no combat damage this turn (CR 510.1c).
export const heroism: CardDefinition = {
    id: "08ee87a0-a7eb-4472-9045-85d11e8a1501", // FEM 6
    rarity: "common",
    name: "Heroism",
    oracleText:
        "Sacrifice a white creature: For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "heroism-prevent",
            oracleText:
                "Sacrifice a white creature: For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.",
            cost: {
                sacrificeFilter: {
                    types: "Creature",
                    colors: "W",
                    controllerRelation: "you",
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 615 — for each attacking red creature, its controller may
                // pay {2}{R} to avoid the prevention; otherwise it assigns no
                // combat damage this turn.
                const attackers = ctx.allPlayerIds.flatMap((p) =>
                    ctx
                        .getBattlefieldIds(p, {
                            types: "Creature",
                            colors: "R",
                            isAttacking: true,
                        })
                        .map((id) => ({ id, owner: p }))
                );
                for (const { id, owner } of attackers) {
                    const paid = ctx.requestMayPay({
                        playerId: owner,
                        choiceId: `heroism-${ctx.sourceInstanceId}-${id}`,
                        cost: { X: 2, R: 1 },
                        prompt: "Heroism: pay {2}{R} or this attacking red creature assigns no combat damage this turn.",
                    });
                    if (paid === undefined) return; // suspended
                    if (!paid) {
                        ctx.markAssignsNoCombatDamage({
                            type: "permanent",
                            id,
                        });
                    }
                }
            },
        },
    ],
};

// --- Icatian Infantry ({W} 1/1 Human Soldier) ---------------------------------
// "{1}: This creature gains first strike until end of turn.\n{1}: This creature
// gains banding until end of turn." (CR 611.1b layer-6 keyword grants scoped to
// end of turn; banding is CR 702.22.)
export const icatianInfantry: CardDefinition = {
    id: "f95d42d8-ba75-43bf-81b8-b02374f03e83", // FEM 7a
    rarity: "common",
    name: "Icatian Infantry",
    oracleText:
        "{1}: This creature gains first strike until end of turn.\n{1}: This creature gains banding until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-infantry-first-strike",
            oracleText:
                "{1}: This creature gains first strike until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "icatian-infantry-banding",
            oracleText: "{1}: This creature gains banding until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "banding",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const icatianInfantryFemB: CardPrint = {
    printId: "e0e4a9d2-ea43-46ac-8b8b-00496a478103", // FEM 7b
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianInfantryFemC: CardPrint = {
    printId: "efac583d-a492-45ee-8c52-60a6422b2168", // FEM 7c
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianInfantryFemD: CardPrint = {
    printId: "96b2a8d4-7c06-454c-9923-553294aada4f", // FEM 7d
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Javelineers ({W} 1/1 Human Soldier) ------------------------------
// "This creature enters with a javelin counter on it.\n{T}, Remove a javelin
// counter from this creature: It deals 1 damage to any target." (CR 122
// entersWith; CR 602.1 removeCounter cost; CR 119 damage.)
export const icatianJavelineers: CardDefinition = {
    id: "f04b8356-2384-4743-80dd-f15ca7ec65f7", // FEM 8a
    rarity: "common",
    name: "Icatian Javelineers",
    oracleText:
        "This creature enters with a javelin counter on it.\n{T}, Remove a javelin counter from this creature: It deals 1 damage to any target.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    entersWith: { counters: [{ type: "javelin", count: 1 }] },
    activatedAbilities: [
        {
            id: "icatian-javelineers-throw",
            oracleText:
                "{T}, Remove a javelin counter from this creature: It deals 1 damage to any target.",
            cost: {
                tap: true,
                removeCounter: { type: "javelin", count: 1 },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.dealDamage(target, 1);
            },
        },
    ],
};

export const icatianJavelineersFemB: CardPrint = {
    printId: "c70f8f50-866a-4889-b986-48636225638a", // FEM 8b
    definitionId: icatianJavelineers.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianJavelineersFemC: CardPrint = {
    printId: "2be5ab7a-e7db-4c09-8df2-6fe55fa4a116", // FEM 8c
    definitionId: icatianJavelineers.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Lieutenant ({W}{W} 1/2 Human Soldier) ----------------------------
// "{1}{W}: Target Soldier creature gets +1/+0 until end of turn." (CR 611 layer
// 7c temporary buff on a Soldier-subtype target.)
export const icatianLieutenant: CardDefinition = {
    id: "39fec59a-4ade-4c6f-ae7d-911fbe6da26d", // FEM 9
    rarity: "uncommon",
    name: "Icatian Lieutenant",
    oracleText: "{1}{W}: Target Soldier creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "icatian-lieutenant-pump",
            oracleText:
                "{1}{W}: Target Soldier creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Soldier",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.addTemporaryPTBuff(target, 1, 0, { phase: "end-of-turn" });
            },
        },
    ],
};

// --- Icatian Moneychanger ({W} 0/2 Human) -------------------------------------
// "This creature enters with three credit counters on it.\nWhen this creature
// enters, it deals 3 damage to you.\nAt the beginning of your upkeep, put a
// credit counter on this creature.\nSacrifice this creature: You gain 1 life for
// each credit counter on this creature. Activate only during your upkeep."
export const icatianMoneychanger: CardDefinition = {
    id: "b3d502d4-4a96-47b3-ae26-8b2c9f36623d", // FEM 10a
    rarity: "common",
    name: "Icatian Moneychanger",
    oracleText:
        "This creature enters with three credit counters on it.\nWhen this creature enters, it deals 3 damage to you.\nAt the beginning of your upkeep, put a credit counter on this creature.\nSacrifice this creature: You gain 1 life for each credit counter on this creature. Activate only during your upkeep.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 2,
    entersWith: { counters: [{ type: "credit", count: 3 }] },
    triggeredAbilities: [
        enteredTrigger({
            id: "icatian-moneychanger-etb-damage",
            oracleText: "When this creature enters, it deals 3 damage to you.",
            scope: "self",
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 3);
            },
        }),
        phaseTrigger({
            id: "icatian-moneychanger-upkeep-counter",
            oracleText:
                "At the beginning of your upkeep, put a credit counter on this creature.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "credit",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "icatian-moneychanger-cash-out",
            oracleText:
                "Sacrifice this creature: You gain 1 life for each credit counter on this creature. Activate only during your upkeep.",
            cost: { sacrifice: true },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            resolve: (ctx: SpellContext) => {
                // Read the counter count from the source BEFORE the sacrifice
                // cost removes it (the cost is paid at activation, so by resolve
                // the permanent is gone — read via last-known is unavailable, so
                // the ability records nothing extra: count is captured here from
                // the resolving stack item's snapshot of counters).
                const count = ctx.getCounterCount(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "credit"
                );
                if (count > 0) ctx.gainLife(ctx.controller, count);
            },
        },
    ],
};

export const icatianMoneychangerFemB: CardPrint = {
    printId: "cbf9194c-8e50-4f50-9a87-3b339a5bc279", // FEM 10b
    definitionId: icatianMoneychanger.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianMoneychangerFemC: CardPrint = {
    printId: "cf9521ae-6fac-4d86-9c60-adecaae5687d", // FEM 10c
    definitionId: icatianMoneychanger.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Phalanx ({4}{W} 2/4 Human Soldier) -------------------------------
// "Banding" (CR 702.22) — pure data plus the banding keyword.
export const icatianPhalanx: CardDefinition = {
    id: "7bc02d30-3eef-4a48-8b11-b4f37219ab3a", // FEM 11
    rarity: "uncommon",
    name: "Icatian Phalanx",
    oracleText:
        "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 4,
    staticAbilities: ["banding"],
};

// --- Icatian Priest ({W} 1/1 Human Cleric) ------------------------------------
// "{1}{W}{W}: Target creature gets +1/+1 until end of turn." (CR 611 layer 7c.)
export const icatianPriest: CardDefinition = {
    id: "d7690cdd-6610-4310-9e93-60dc4db2ae8d", // FEM 12
    rarity: "uncommon",
    name: "Icatian Priest",
    oracleText: "{1}{W}{W}: Target creature gets +1/+1 until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-priest-pump",
            oracleText:
                "{1}{W}{W}: Target creature gets +1/+1 until end of turn.",
            cost: { mana: { X: 1, W: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.addTemporaryPTBuff(target, 1, 1, { phase: "end-of-turn" });
            },
        },
    ],
};

// --- Icatian Scout ({W} 1/1 Human Soldier Scout) ------------------------------
// "{1}, {T}: Target creature gains first strike until end of turn." (CR 611.1b
// layer-6 keyword grant.)
export const icatianScout: CardDefinition = {
    id: "86bf4aaa-a9b1-4798-a96b-c3e35afb77f7", // FEM 13a
    rarity: "common",
    name: "Icatian Scout",
    oracleText:
        "{1}, {T}: Target creature gains first strike until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Scout"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-scout-first-strike",
            oracleText:
                "{1}, {T}: Target creature gains first strike until end of turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.grantStaticAbility(target, "first strike", {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

export const icatianScoutFemB: CardPrint = {
    printId: "e9db3442-01cb-4db2-ac33-8eca6880c315", // FEM 13b
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianScoutFemC: CardPrint = {
    printId: "6c461655-a05d-4eed-85b2-04d554f5ec50", // FEM 13c
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};
export const icatianScoutFemD: CardPrint = {
    printId: "db63ad7f-6dc4-4249-b360-46ec5569a5a9", // FEM 13d
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};

// --- Icatian Skirmishers ({3}{W} 1/1 Human Soldier) ---------------------------
// "First strike; banding\nWhenever this creature attacks, all creatures banded
// with it gain first strike until end of turn." The banded-creatures grant on
// attack is deferred (the engine has no per-band membership query exposed to
// card bodies); the static first strike + banding keywords are the load-bearing
// behaviour and are implemented.
export const icatianSkirmishers: CardDefinition = {
    id: "15f6d115-c02d-45a3-aa6d-402964df47dd", // FEM 14
    rarity: "uncommon",
    name: "Icatian Skirmishers",
    oracleText:
        "First strike; banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)\nWhenever this creature attacks, all creatures banded with it gain first strike until end of turn.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike", "banding"],
};

// --- Icatian Town ({5}{W} Sorcery) --------------------------------------------
// "Create four 1/1 white Citizen creature tokens." (CR 707.2 token creation.)
export const icatianTown: CardDefinition = {
    id: "cbb7c28d-0366-4d01-84a2-f1bc9f38aa4a", // FEM 15
    rarity: "uncommon",
    name: "Icatian Town",
    oracleText: "Create four 1/1 white Citizen creature tokens.",
    manaCost: { X: 5, W: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.createToken(
            {
                name: "Citizen",
                types: ["Creature"],
                subtypes: ["Citizen"],
                power: 1,
                toughness: 1,
                colors: ["W"],
            },
            ctx.controller,
            4
        );
    },
};

// --- Order of Leitbur ({W}{W} 2/1 Human Cleric Knight) ------------------------
// "Protection from black\n{W}: This creature gains first strike until end of
// turn.\n{W}{W}: This creature gets +1/+0 until end of turn." (CR 702.16
// protection; CR 611 keyword grant + 7c buff.)
export const orderOfLeitbur: CardDefinition = {
    id: "ebd6e51e-f042-4673-a898-291607105829", // FEM 16a
    rarity: "uncommon",
    name: "Order of Leitbur",
    oracleText:
        "Protection from black\n{W}: This creature gains first strike until end of turn.\n{W}{W}: This creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from black"],
    activatedAbilities: [
        {
            id: "order-of-leitbur-first-strike",
            oracleText:
                "{W}: This creature gains first strike until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "order-of-leitbur-pump",
            oracleText: "{W}{W}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { W: 2 } },
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

export const orderOfLeitburFemB: CardPrint = {
    printId: "fb537b5a-d725-420d-bc15-0d54ba23331c", // FEM 16b
    definitionId: orderOfLeitbur.id,
    setCode: "fem",
    rarity: "uncommon",
};
export const orderOfLeitburFemC: CardPrint = {
    printId: "1373dea4-3565-4612-8505-ab8fba3ddb67", // FEM 16c
    definitionId: orderOfLeitbur.id,
    setCode: "fem",
    rarity: "uncommon",
};

// ═════════════════════════════════════════════════════════════════════════════
// C4 — Red: Goblins, Orcs & Dwarves (PRD #566, issue #570). The red faction is
// goblin/orc/dwarf aggression: coin-flip gambles, typed-Goblin sacrifice loops,
// drawback bodies (can't-block restrictions), and symmetric land hate.
//
// ONE genuinely-new engine capability ships with this cluster (ADR 0038):
//   A — `menace`, a GRANTABLE evasion keyword enforced at DECLARE_BLOCKERS via a
//       GENERIC minimum-blocker threshold (menace → 2). The threshold lives in
//       `gre/combat.ts` (`getMinimumBlockers` / `validateMinimumBlockers`) so a
//       future "can't be blocked except by three or more creatures" reuses the
//       same confirm-time check — it only raises the number. Goblin War Drums
//       grants menace to every creature its controller controls (anthem-style
//       `keyword-grant`, the Kobold-lord pattern).
//
// Everything else composes shipped primitives: coin flips (`requestCoinFlip`),
// typed sacrifice costs (`sacrificeFilter`), token creation (`createToken`),
// data-driven combat eligibility (`block-restriction` / `attack-restriction`
// staticEffects, ADR 0006), regeneration shields, temporary P/T buffs, and
// divided damage (computed in resolve). All card data validated against Scryfall
// `set:fem` (modern Oracle, ADR 0004).
// ═════════════════════════════════════════════════════════════════════════════

/** Shared 1/1 red Goblin token spec (CR 111, 707.1). Reused by Goblin Warrens
 *  (and any future red goblin-token maker) — extracted per the project's
 *  primitive-reuse convention. */
const GOBLIN_TOKEN: TokenSpec = {
    name: "Goblin",
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    colors: ["R"],
};

// --- Goblin War Drums ({2}{R} Enchantment) ------------------------------------
// "Creatures you control have menace." NEW capability A (ADR 0038): an
// anthem-style `keyword-grant` (CR 611 layer 6) that pushes the `menace` keyword
// onto every creature its controller controls. The grant is reversed when the
// enchantment leaves play. Menace itself (CR 702.111a) is enforced generically
// at DECLARE_BLOCKERS by `validateMinimumBlockers` (gre/combat.ts).
export const goblinWarDrums: CardDefinition = {
    id: "2a2c4e4b-e9a7-4180-927b-589514c21876", // FEM 58a (canonical art)
    rarity: "common",
    name: "Goblin War Drums",
    oracleText: "Creatures you control have menace.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "keyword-grant",
            // CR 611 — applies to every creature the source's controller
            // controls (the Kobold-lord anthem pattern from leg.ts).
            applies: (target, source) =>
                target.types.includes("Creature") &&
                target.controllerId === source.controllerId,
            keyword: "menace",
        },
    ],
};

export const goblinWarDrumsFemB: CardPrint = {
    printId: "5988a3d2-748f-4642-9e33-293ddc568111", // FEM 58b
    definitionId: goblinWarDrums.id,
    setCode: "fem",
    rarity: "common",
};
export const goblinWarDrumsFemC: CardPrint = {
    printId: "2232386e-986d-41b5-8b70-e086264f3277", // FEM 58c
    definitionId: goblinWarDrums.id,
    setCode: "fem",
    rarity: "common",
};
export const goblinWarDrumsFemD: CardPrint = {
    printId: "2a0185f3-fbc0-44d7-b933-30627cda1bf9", // FEM 58d
    definitionId: goblinWarDrums.id,
    setCode: "fem",
    rarity: "common",
};

// --- Goblin Grenade ({R} Sorcery) ---------------------------------------------
// "As an additional cost to cast this spell, sacrifice a Goblin.\nGoblin Grenade
// deals 5 damage to any target." (CR 601.2f additional cost via `sacrificeFilter`
// on the spell; CR 115.4 "any target".)
export const goblinGrenade: CardDefinition = {
    id: "8837eaba-9602-4f63-9897-85583fcdcf51", // FEM 56a (canonical art)
    rarity: "common",
    name: "Goblin Grenade",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a Goblin.\nGoblin Grenade deals 5 damage to any target.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    additionalCosts: { sacrificeFilter: { subtypes: ["Goblin"] } },
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent" || target?.type === "player") {
            ctx.dealDamage(target, 5);
        }
    },
};

export const goblinGrenadeFemB: CardPrint = {
    printId: "dee262da-3002-4c08-8043-4e40e1b46822", // FEM 56b
    definitionId: goblinGrenade.id,
    setCode: "fem",
    rarity: "common",
};
export const goblinGrenadeFemC: CardPrint = {
    printId: "1befdfc7-a1e3-4a2a-ad68-7d0fee170f3f", // FEM 56c
    definitionId: goblinGrenade.id,
    setCode: "fem",
    rarity: "common",
};

// --- Goblin Warrens ({2}{R} Enchantment) --------------------------------------
// "{2}{R}, Sacrifice two Goblins: Create three 1/1 red Goblin creature tokens."
// (CR 602.1 typed sacrifice cost, count 2; CR 111 token creation.)
export const goblinWarrens: CardDefinition = {
    id: "bbec4aa5-3319-43dc-8347-5633edbd7018", // FEM 59
    rarity: "uncommon",
    name: "Goblin Warrens",
    oracleText:
        "{2}{R}, Sacrifice two Goblins: Create three 1/1 red Goblin creature tokens.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "goblin-warrens-breed",
            oracleText:
                "{2}{R}, Sacrifice two Goblins: Create three 1/1 red Goblin creature tokens.",
            // The "sacrifice two Goblins" cost is paid in-resolve via a chosen
            // pick (the codebase has no multi-count `sacrificeFilter`; the
            // established pattern for "sacrifice two X" is a requestChoice +
            // sacrifice, as in Psychic Allergy / Bone Mask). The ability is only
            // useful with two Goblins available; otherwise it fizzles.
            cost: { mana: { X: 2, R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const goblins = ctx.getBattlefieldIds(ctx.controller, {
                    subtypes: "Goblin",
                });
                if (goblins.length < 2) return;
                const chosen = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "goblin-warrens-sacrifice",
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: ctx.controller,
                    count: 2,
                    candidateIds: goblins,
                    prompt: "Sacrifice two Goblins (Goblin Warrens).",
                });
                if (chosen === undefined) return; // suspended for the choice
                if (chosen.length < 2) return;
                for (const id of chosen) ctx.sacrifice(id);
                ctx.createToken(GOBLIN_TOKEN, ctx.controller, 3);
            },
        },
    ],
};

// --- Goblin Chirurgeon ({R} 0/2 Goblin Shaman) --------------------------------
// "Sacrifice a Goblin: Regenerate target creature." (CR 602.1 typed sacrifice
// cost; CR 701.15a regeneration shield. The cost has no mana — {0}-style.)
export const goblinChirurgeon: CardDefinition = {
    id: "2b710c21-e9f5-4660-80f6-2104ec65f63f", // FEM 54a (canonical art)
    rarity: "uncommon",
    name: "Goblin Chirurgeon",
    oracleText: "Sacrifice a Goblin: Regenerate target creature.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Shaman"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "goblin-chirurgeon-regen",
            oracleText: "Sacrifice a Goblin: Regenerate target creature.",
            cost: { sacrificeFilter: { subtypes: ["Goblin"] } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.applyRegenerationShield(target);
                }
            },
        },
    ],
};

export const goblinChirurgeonFemB: CardPrint = {
    printId: "982115b2-e1e7-4b2f-8eb6-a1633477d4a8", // FEM 54b
    definitionId: goblinChirurgeon.id,
    setCode: "fem",
    rarity: "uncommon",
};
export const goblinChirurgeonFemC: CardPrint = {
    printId: "c9740842-7955-4cf9-8f76-a426858360b1", // FEM 54c
    definitionId: goblinChirurgeon.id,
    setCode: "fem",
    rarity: "uncommon",
};

// --- Goblin Kites ({1}{R} Enchantment) ----------------------------------------
// "{R}: Target creature you control with toughness 2 or less gains flying until
// end of turn. Flip a coin at the beginning of the next end step. If you lose
// the flip, sacrifice that creature." (CR 611.1b keyword grant; CR 705.2 coin
// flip via a delayed end-step trigger; CR 701.16 sacrifice on loss.)
export const goblinKites: CardDefinition = {
    id: "a0a27ac3-2273-469a-92ba-3f4a3d55de6f", // FEM 57
    rarity: "common",
    name: "Goblin Kites",
    oracleText:
        "{R}: Target creature you control with toughness 2 or less gains flying until end of turn. Flip a coin at the beginning of the next end step. If you lose the flip, sacrifice that creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "goblin-kites-fly",
            oracleText:
                "{R}: Target creature you control with toughness 2 or less gains flying until end of turn. Flip a coin at the beginning of the next end step. If you lose the flip, sacrifice that creature.",
            cost: { mana: { R: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                toughnessFilter: { max: 2 },
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.grantStaticAbility(target, "flying", {
                    phase: "end-of-turn",
                });
                // CR 705.2 / 603.7a — the coin flip happens at the next end
                // step. Arm the delayed trigger (template below), carrying the
                // creature id and the flipping player in the serializable
                // payload (closures are not permitted on delayed triggers).
                ctx.scheduleDelayedTrigger(
                    goblinKites.id,
                    "goblin-kites-flip",
                    "next-end-step",
                    { creatureId: target.id, flipperId: ctx.controller }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "goblin-kites-flip",
            oracleText:
                "Flip a coin. If you lose the flip, sacrifice that creature (Goblin Kites).",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const creatureId = payload.creatureId;
                const flipperId = payload.flipperId;
                if (!creatureId || !flipperId) return;
                const won = ctx.requestCoinFlip({
                    playerId: flipperId,
                    choiceId: `goblin-kites-flip-${creatureId}`,
                    heads: { consequence: "Creature is safe." },
                    tails: { consequence: "Sacrifice that creature." },
                });
                if (won === undefined) return; // suspended for the reveal
                if (!won) ctx.sacrifice(creatureId);
            },
        },
    ],
};

// --- Orcish Captain ({R} 1/1 Orc Warrior) -------------------------------------
// "{1}: Flip a coin. If you win the flip, target Orc creature gets +2/+0 until
// end of turn. If you lose the flip, it gets -0/-2 until end of turn." (CR 705.2
// coin flip; CR 611.2 temporary P/T buff either way.)
export const orcishCaptain: CardDefinition = {
    id: "e43cf61d-b4d6-4461-a228-47fd8b026d33", // FEM 60
    rarity: "uncommon",
    name: "Orcish Captain",
    oracleText:
        "{1}: Flip a coin. If you win the flip, target Orc creature gets +2/+0 until end of turn. If you lose the flip, it gets -0/-2 until end of turn.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-captain-flip",
            oracleText:
                "{1}: Flip a coin. If you win the flip, target Orc creature gets +2/+0 until end of turn. If you lose the flip, it gets -0/-2 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Orc",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                const won = ctx.requestCoinFlip({
                    playerId: ctx.controller,
                    choiceId: "orcish-captain-flip",
                    heads: { consequence: "Target Orc gets +2/+0." },
                    tails: { consequence: "Target Orc gets -0/-2." },
                });
                if (won === undefined) return; // suspended for reveal
                if (won) {
                    ctx.addTemporaryPTBuff(target, 2, 0, {
                        phase: "end-of-turn",
                    });
                } else {
                    ctx.addTemporaryPTBuff(target, 0, -2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// --- Brassclaw Orcs ({2}{R} 3/2 Orc) ------------------------------------------
// "This creature can't block creatures with power 2 or greater." (CR 509.1b /
// 508.1c — data-driven combat eligibility via a `block-restriction` static,
// side "blocker", ADR 0006.)
export const brassclawOrcs: CardDefinition = {
    id: "fc0cb8f6-6ba7-402c-9829-251f7443e871", // FEM 49a (canonical art)
    rarity: "common",
    name: "Brassclaw Orcs",
    oracleText: "This creature can't block creatures with power 2 or greater.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 3,
    toughness: 2,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "brassclaw-orcs-cant-block-power-2",
            side: "blocker",
            // self = the blocker (Brassclaw Orcs), opponent = the attacker.
            predicate: (_self, attacker) => (attacker.power ?? 0) < 2,
            oracleText:
                "Brassclaw Orcs can't block creatures with power 2 or greater.",
        },
    ],
};

export const brassclawOrcsFemB: CardPrint = {
    printId: "ac9d0354-9ddd-4fe1-8174-9d3686ca564c", // FEM 49b
    definitionId: brassclawOrcs.id,
    setCode: "fem",
    rarity: "common",
};
export const brassclawOrcsFemC: CardPrint = {
    printId: "a2c1e461-f74e-436c-a9df-aff197cf48e1", // FEM 49c
    definitionId: brassclawOrcs.id,
    setCode: "fem",
    rarity: "common",
};
export const brassclawOrcsFemD: CardPrint = {
    printId: "50f0f4fe-2dd0-42c1-8f68-5d24a8a9d07d", // FEM 49d
    definitionId: brassclawOrcs.id,
    setCode: "fem",
    rarity: "common",
};

// --- Orcish Veteran ({2}{R} 2/2 Orc) ------------------------------------------
// "This creature can't block white creatures with power 2 or greater.\n{R}: This
// creature gains first strike until end of turn." (CR 509.1b block-restriction
// with a colour clause; CR 611.1b keyword grant.)
export const orcishVeteran: CardDefinition = {
    id: "1dbca765-8756-4e28-9faf-25714c9b8838", // FEM 62a (canonical art)
    rarity: "common",
    name: "Orcish Veteran",
    oracleText:
        "This creature can't block white creatures with power 2 or greater.\n{R}: This creature gains first strike until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "orcish-veteran-cant-block-white-power-2",
            side: "blocker",
            predicate: (_self, attacker) =>
                !(
                    colorsOfView(attacker).includes("W") &&
                    (attacker.power ?? 0) >= 2
                ),
            oracleText:
                "Orcish Veteran can't block white creatures with power 2 or greater.",
        },
    ],
    activatedAbilities: [
        {
            id: "orcish-veteran-first-strike",
            oracleText:
                "{R}: This creature gains first strike until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const orcishVeteranFemB: CardPrint = {
    printId: "bc37db83-9efc-4d58-90c9-78eef9073ec2", // FEM 62b
    definitionId: orcishVeteran.id,
    setCode: "fem",
    rarity: "common",
};
export const orcishVeteranFemC: CardPrint = {
    printId: "334004e6-bf8c-4a4e-a30c-1537a99819c9", // FEM 62c
    definitionId: orcishVeteran.id,
    setCode: "fem",
    rarity: "common",
};
export const orcishVeteranFemD: CardPrint = {
    printId: "4990dd4b-2b18-4e4c-81d4-1cd8d746a7dc", // FEM 62d
    definitionId: orcishVeteran.id,
    setCode: "fem",
    rarity: "common",
};

// --- Orcish Spy ({R} 1/1 Orc Rogue) -------------------------------------------
// "{T}: Look at the top three cards of target player's library." (CR 401.4 look;
// modelled as `peekLibraryTop(3)` + `markKnown` to the controller — the
// look-class knowledge primitive, ADR 0026.)
export const orcishSpy: CardDefinition = {
    id: "cd3890d1-563d-4519-ab8c-913031d71918", // FEM 61a (canonical art)
    rarity: "common",
    name: "Orcish Spy",
    oracleText: "{T}: Look at the top three cards of target player's library.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Orc", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "orcish-spy-look",
            oracleText:
                "{T}: Look at the top three cards of target player's library.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "player") return;
                const topIds = ctx.peekLibraryTop(target.id, 3);
                ctx.markKnown(target.id, topIds, ctx.controller);
            },
        },
    ],
};

export const orcishSpyFemB: CardPrint = {
    printId: "8b931cfd-b952-416c-ab2c-271ecaee8e0c", // FEM 61b
    definitionId: orcishSpy.id,
    setCode: "fem",
    rarity: "common",
};
export const orcishSpyFemC: CardPrint = {
    printId: "28e08767-7e92-4ff4-b0d8-196565fbc23c", // FEM 61c
    definitionId: orcishSpy.id,
    setCode: "fem",
    rarity: "common",
};

// --- Orgg ({3}{R}{R} 6/6 Orgg) ------------------------------------------------
// "Trample\nThis creature can't attack if defending player controls an untapped
// creature with power 3 or greater.\nThis creature can't block creatures with
// power 3 or greater." (CR 702.19 trample; CR 508.1c attack-restriction reading
// the defender's board; CR 509.1b block-restriction.)
export const orgg: CardDefinition = {
    id: "5af19ab0-4bd0-4d5f-8d2e-507e4fe87c18", // FEM 63
    rarity: "rare",
    name: "Orgg",
    oracleText:
        "Trample\nThis creature can't attack if defending player controls an untapped creature with power 3 or greater.\nThis creature can't block creatures with power 3 or greater.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Orgg"],
    power: 6,
    toughness: 6,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "orgg-cant-attack-into-power-3",
            // Legal to attack only if the defending player controls NO untapped
            // creature with power 3 or greater.
            predicate: (_self, defenderBattlefield) =>
                !defenderBattlefield.some(
                    (c) =>
                        c.types.includes("Creature") &&
                        !c.isTapped &&
                        (c.power ?? 0) >= 3
                ),
            oracleText:
                "Orgg can't attack if defending player controls an untapped creature with power 3 or greater.",
        },
        {
            kind: "block-restriction",
            id: "orgg-cant-block-power-3",
            side: "blocker",
            predicate: (_self, attacker) => (attacker.power ?? 0) < 3,
            oracleText: "Orgg can't block creatures with power 3 or greater.",
        },
    ],
};

// --- Goblin Flotilla ({2}{R} 2/2 Goblin) --------------------------------------
// "Islandwalk\nAt the beginning of each combat, unless you pay {R}, whenever this
// creature blocks or becomes blocked by a creature this combat, that creature
// gains first strike until end of turn." The islandwalk keyword is the
// load-bearing mechanic (CR 702.13b — generic landwalk); the upkeep-of-combat
// pay-or-grant rider is faithfully described in oracle text but is a niche
// drawback that does not gate the golden path, so it ships as text (the engine
// has no per-combat conditional first-strike-on-block hook and the PRD lists
// Goblin Flotilla as reuse for landwalk).
export const goblinFlotilla: CardDefinition = {
    id: "87024efe-4a74-49fe-a43a-480bed0a650a", // FEM 55
    rarity: "rare",
    name: "Goblin Flotilla",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)\nAt the beginning of each combat, unless you pay {R}, whenever this creature blocks or becomes blocked by a creature this combat, that creature gains first strike until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    staticAbilities: ["islandwalk"],
};

// --- Dwarven Lieutenant ({R}{R} 1/2 Dwarf Soldier) ----------------------------
// "{1}{R}: Target Dwarf creature gets +1/+0 until end of turn." (CR 611.2
// temporary P/T buff, subtype-filtered target.)
export const dwarvenLieutenant: CardDefinition = {
    id: "ea9a38b1-4676-425a-b40d-4fb478966024", // FEM 52
    rarity: "uncommon",
    name: "Dwarven Lieutenant",
    oracleText: "{1}{R}: Target Dwarf creature gets +1/+0 until end of turn.",
    manaCost: { R: 2 },
    types: ["Creature"],
    subtypes: ["Dwarf", "Soldier"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "dwarven-lieutenant-pump",
            oracleText:
                "{1}{R}: Target Dwarf creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, R: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Dwarf",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 1, 0, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// --- Dwarven Soldier ({1}{R} 2/1 Dwarf Soldier) -------------------------------
// "Whenever this creature blocks or becomes blocked by one or more Orcs, this
// creature gets +0/+2 until end of turn." (CR 509.1 combat trigger; the trigger
// fires on the block event and inspects the opposing creatures' subtypes.) The
// engine has no per-combat "blocked-by-subtype" trigger hook in this slice's
// scope, and the PRD groups Dwarven Soldier as reuse; the +0/+2-on-block rider
// ships as faithful oracle text on a French-vanilla body.
export const dwarvenSoldier: CardDefinition = {
    id: "6fe77608-0b33-43f5-83fb-ae993ca1bf7c", // FEM 53a (canonical art)
    rarity: "common",
    name: "Dwarven Soldier",
    oracleText:
        "Whenever this creature blocks or becomes blocked by one or more Orcs, this creature gets +0/+2 until end of turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf", "Soldier"],
    power: 2,
    toughness: 1,
};

export const dwarvenSoldierFemB: CardPrint = {
    printId: "ea7e4c52-dfe1-4b15-a0d6-4f26c294426d", // FEM 53b
    definitionId: dwarvenSoldier.id,
    setCode: "fem",
    rarity: "common",
};
export const dwarvenSoldierFemC: CardPrint = {
    printId: "872c5601-f356-4873-adf9-9a39536e7d4a", // FEM 53c
    definitionId: dwarvenSoldier.id,
    setCode: "fem",
    rarity: "common",
};

// --- Dwarven Armorer ({R} 0/2 Dwarf) ------------------------------------------
// "{R}, {T}, Discard a card: Put a +0/+1 counter or a +1/+0 counter on target
// creature." (CR 122.1 P/T counters; the discard is paid in-resolve via a hand
// pick — the codebase models chosen discards inside resolve, Jalum Tome
// pattern; the counter type is a `requestOptionChoice`.)
export const dwarvenArmorer: CardDefinition = {
    id: "1d50bf06-97ab-4874-a484-9289f41dc98e", // FEM 50
    rarity: "rare",
    name: "Dwarven Armorer",
    oracleText:
        "{R}, {T}, Discard a card: Put a +0/+1 counter or a +1/+0 counter on target creature.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "dwarven-armorer-counter",
            oracleText:
                "{R}, {T}, Discard a card: Put a +0/+1 counter or a +1/+0 counter on target creature.",
            cost: { mana: { R: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolveSteps: [
                // Step 0 — pay the discard portion of the cost (a chosen card).
                (ctx: SpellContext) => {
                    const handIds = ctx.getHandIds(ctx.controller);
                    if (handIds.length === 0) return;
                    const picked = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: "dwarven-armorer-discard",
                        kind: "choose-hand-card",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card (Dwarven Armorer).",
                    });
                    if (!picked || picked.length === 0) return;
                    ctx.discardCard(ctx.controller, picked[0]);
                },
                // Step 1 — choose which counter to add, then add it.
                (ctx: SpellContext) => {
                    const target = ctx.targets[0];
                    if (target?.type !== "permanent") return;
                    const which = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "dwarven-armorer-counter-kind",
                        options: [
                            { id: "+0/+1", label: "+0/+1 counter" },
                            { id: "+1/+0", label: "+1/+0 counter" },
                        ],
                        prompt: "Choose a counter to put on the creature.",
                    });
                    if (which === undefined) return; // suspended for choice
                    ctx.addCounter(target, which, 1);
                },
            ],
        },
    ],
};

// --- Dwarven Catapult ({X}{R} Instant) ----------------------------------------
// "Dwarven Catapult deals X damage divided evenly, rounded down, among all
// creatures target opponent controls." (CR 107.3 X read via `getX`; the even
// division is computed in resolve — floor(X / N) to each of the opponent's N
// creatures, CR 510.1c-style even split.)
export const dwarvenCatapult: CardDefinition = {
    id: "8c1c6932-638a-4df7-bf9b-8d921f7484d9", // FEM 51
    rarity: "uncommon",
    name: "Dwarven Catapult",
    oracleText:
        "Dwarven Catapult deals X damage divided evenly, rounded down, among all creatures target opponent controls.",
    manaCost: { X: "X", R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const creatureIds = ctx.getBattlefieldIds(target.id, {
            types: "Creature",
        });
        if (creatureIds.length === 0) return;
        const each = Math.floor(ctx.getX() / creatureIds.length);
        if (each <= 0) return;
        for (const id of creatureIds) {
            ctx.dealDamage({ type: "permanent", id }, each);
        }
    },
};

// --- Raiding Party ({2}{R} Enchantment) — the set's most complex card ----------
// "This enchantment can't be the target of white spells or abilities from white
// sources.\nSacrifice an Orc: Each player may tap any number of untapped white
// creatures they control. For each creature tapped this way, that player chooses
// up to two Plains. Then destroy all Plains that weren't chosen this way by any
// player." (CR 602.1 typed sacrifice cost; a symmetric, stepped, suspendable
// resolution: each player taps white creatures, protects up to 2 Plains per tap,
// then all unprotected Plains are destroyed. The "can't be the target of white
// spells/abilities" clause requires source-COLOUR targeting filters, which the
// targeting guard does not model yet (it filters by source type/subtype only),
// so that rider ships as faithful oracle text — the load-bearing, PRD-scoped
// mechanic is the symmetric Plains destruction implemented below.)
export const raidingParty: CardDefinition = {
    id: "907a3396-706b-4ca2-9973-bca758986032", // FEM 64
    rarity: "rare",
    name: "Raiding Party",
    oracleText:
        "This enchantment can't be the target of white spells or abilities from white sources.\nSacrifice an Orc: Each player may tap any number of untapped white creatures they control. For each creature tapped this way, that player chooses up to two Plains. Then destroy all Plains that weren't chosen this way by any player.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "raiding-party-raze",
            oracleText:
                "Sacrifice an Orc: Each player may tap any number of untapped white creatures they control. For each creature tapped this way, that player chooses up to two Plains. Then destroy all Plains that weren't chosen this way by any player.",
            cost: { sacrificeFilter: { subtypes: ["Orc"] } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // Each player, in turn order, taps any number of their own
                // untapped white creatures; for each tapped this way they then
                // choose up to two Plains they control to protect. The picks
                // accumulate into a protected set; at the end, every Plains NOT
                // protected by any player is destroyed (CR 608.2 stepped, each
                // requestChoice suspends until answered).
                const protectedPlains = new Set<string>(
                    ctx.recallChoice("raiding-party-protected") ?? []
                );
                for (const pid of ctx.allPlayerIds) {
                    const whiteCreatures = ctx
                        .getBattlefieldIds(pid, {
                            types: "Creature",
                            colors: "W",
                        })
                        .filter(
                            (id) => !ctx.getIsTapped({ type: "permanent", id })
                        );
                    let tappedCount = 0;
                    if (whiteCreatures.length > 0) {
                        const chosen = ctx.requestChoice({
                            playerId: pid,
                            choiceId: `raiding-party-tap-${pid}`,
                            kind: "choose-permanents",
                            zone: "battlefield",
                            zoneOwnerId: pid,
                            count: { min: 0, max: whiteCreatures.length },
                            candidateIds: whiteCreatures,
                            prompt: "Tap any number of untapped white creatures you control to protect Plains (Raiding Party).",
                        });
                        if (chosen === undefined) return; // suspended
                        for (const id of chosen) {
                            ctx.tap({ type: "permanent", id });
                        }
                        tappedCount = chosen.length;
                    }
                    // For each creature tapped this way, choose up to two of
                    // your Plains to protect. Model the whole protection pick as
                    // one "up to 2 × tappedCount" selection from this player's
                    // Plains.
                    const maxProtect = tappedCount * 2;
                    const myPlains = ctx.getBattlefieldIds(pid, {
                        subtypes: "Plains",
                    });
                    if (maxProtect > 0 && myPlains.length > 0) {
                        const picks = ctx.requestChoice({
                            playerId: pid,
                            choiceId: `raiding-party-protect-${pid}`,
                            kind: "choose-permanents",
                            zone: "battlefield",
                            zoneOwnerId: pid,
                            count: {
                                min: 0,
                                max: Math.min(maxProtect, myPlains.length),
                            },
                            candidateIds: myPlains,
                            prompt: "Choose Plains to protect from Raiding Party (up to two per creature tapped).",
                        });
                        if (picks === undefined) return; // suspended
                        for (const id of picks) protectedPlains.add(id);
                    }
                    // Checkpoint the running protected set so a later player's
                    // suspension/replay doesn't lose earlier players' picks.
                    ctx.noteChoice(
                        "raiding-party-protected",
                        Array.from(protectedPlains)
                    );
                }
                // Destroy every Plains not protected by any player (CR 701.7).
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        subtypes: "Plains",
                    })) {
                        if (!protectedPlains.has(id)) {
                            ctx.destroy({ type: "permanent", id });
                        }
                    }
                }
            },
        },
    ],
};
