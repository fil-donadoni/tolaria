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
import { AURA_AFFECTS_HOST } from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { stateTrigger } from "../abilities/triggers/stateTrigger";
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
// C2 — Blue: Homarids, Vodalians & the Tide (PRD #566, issue #571).
//
// The FEM blue faction: the Homarid "tide" creatures, the Vodalian merfolk
// (Island-matters tribal + soft counters), and three small new engine
// capabilities. Tide itself is REUSE: a tide counter accrues each upkeep
// (phaseTrigger UPKEEP/your + addCounter), the body reads the EXACT counter
// count via a self-targeting pt-buff with a counter-gated `condition`
// (CR 611.2c), and a state-trigger (CR 603.8) sheds all tide counters at four
// or more. Other reuse: token-count = sacrificed creature's mana value
// (Homarid Spawning Bed via additional sacrifice MV), conditional
// `gainControl` "for as long as this remains tapped" (Seasinger), the
// data-driven "may-choose-not-to-untap" optional untap (Seasinger — ATQ cluster
// E, CR 502.1), counter-unless-pay soft counters (Vodalian Mage), mill
// (Deep Spawn), keyword grants until end of turn (River Merfolk mountainwalk,
// Vodalian Knights flying), shroud + skip-next-untap (Homarid Warrior, Deep
// Spawn), attack-restriction + sacrifice-when-no-Island (Vodalian Knights,
// Seasinger — ARN Dandân precedent), and the `tapOtherFilter` cost (Vodalian
// War Machine — built in C3 #568, capability D).
//
// New capabilities introduced by this cluster:
//   • J — cast restriction by name (`castUniqueByName`): "Cast this spell only
//     if no permanent named <this> is on the battlefield" (Tidal Influence,
//     CR 601.3e), enforced in `getLegalActions`/`assertLegalAction`.
//   • K — dynamic activation cost = the enchanted creature's mana cost
//     (`cost.manaEqualToEnchantedCreatureCost`): Merseine, CR 601.2f / 202.3.
//   • I — optional "may choose not to untap" is REUSE (the `may-choose-not-to
//     -untap` static ability + the untap-step pendingChoices machinery shipped
//     with ATQ cluster E); no new per-instance field is needed, so Seasinger
//     just declares the keyword. (The PRD's "persisted field" requirement is
//     satisfied by the already-serialized `pendingUntapStep`/`pendingChoices`.)
//
// All card data validated against Scryfall `set:fem` (modern Oracle, ADR 0004).
// FEM blue commons are multi-art; their alternate artworks ship as CardPrints.
// ═════════════════════════════════════════════════════════════════════════════

/** Shared 1/1 blue Camarid token spec (CR 111, 707.1). Homarid Spawning Bed
 *  makes a number of these equal to the sacrificed creature's mana value. */
const CAMARID_TOKEN: TokenSpec = {
    name: "Camarid",
    types: ["Creature"],
    subtypes: ["Camarid"],
    power: 1,
    toughness: 1,
    colors: ["U"],
};

/** Builds the shared "this permanent enters with a tide counter on it" ETB
 *  trigger (CR 603.6 / 122.1). Homarid and Tidal Influence both start the tide
 *  cycle at one. */
function tideEnterTrigger(id: string) {
    return enteredTrigger({
        id,
        oracleText: "This permanent enters with a tide counter on it.",
        scope: "self",
        resolve: (ctx) => {
            ctx.addCounter(
                { type: "permanent", id: ctx.sourceInstanceId },
                "tide",
                1
            );
        },
    });
}

/** Builds the shared "At the beginning of your upkeep, put a tide counter on
 *  this permanent." trigger (CR 603.6a + 122.1). */
function tideUpkeepTrigger(id: string) {
    return phaseTrigger({
        id,
        oracleText:
            "At the beginning of your upkeep, put a tide counter on this permanent.",
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            ctx.addCounter(
                { type: "permanent", id: ctx.sourceInstanceId },
                "tide",
                1
            );
        },
    });
}

/** Builds the shared "Whenever there are four or more tide counters on this
 *  permanent, remove all tide counters from it." state-trigger (CR 603.8). The
 *  state-trigger's anti-loop guard fires the removal once when the count
 *  reaches four; after removal the condition is false, so the cycle resets. */
function tideSheddingTrigger(id: string) {
    return stateTrigger({
        id,
        oracleText:
            "Whenever there are four or more tide counters on this permanent, remove all tide counters from it.",
        condition: (self) => (self.counters?.["tide"] ?? 0) >= 4,
        resolve: (ctx) => {
            const src = {
                type: "permanent" as const,
                id: ctx.sourceInstanceId,
            };
            const have = ctx.getCounterCount(src, "tide");
            if (have > 0) ctx.removeCounter(src, "tide", have);
        },
    });
}

// Homarid — {2}{U} 2/2 Homarid. The archetypal tide creature: a tide counter
// each upkeep, -1/-1 at exactly one tide counter, +1/+1 at exactly three, and
// sheds all tide counters at four or more (CR 611.2c counter-gated P/T;
// CR 603.8 state-trigger reset).
export const homarid: CardDefinition = {
    id: "d6ffeab4-83b1-4414-ae72-e59a2354ea15", // FEM 19a (canonical art)
    rarity: "common",
    name: "Homarid",
    oracleText:
        "This creature enters with a tide counter on it.\nAt the beginning of your upkeep, put a tide counter on this creature.\nAs long as there is exactly one tide counter on this creature, it gets -1/-1.\nAs long as there are exactly three tide counters on this creature, it gets +1/+1.\nWhenever there are four or more tide counters on this creature, remove all tide counters from it.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Homarid"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        tideEnterTrigger("homarid-tide-enter"),
        tideUpkeepTrigger("homarid-tide-upkeep"),
        tideSheddingTrigger("homarid-tide-shed"),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.id,
            condition: (source) => (source.counters?.["tide"] ?? 0) === 1,
            power: -1,
            toughness: -1,
        },
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.id,
            condition: (source) => (source.counters?.["tide"] ?? 0) === 3,
            power: 1,
            toughness: 1,
        },
    ],
};

export const homaridFemB: CardPrint = {
    printId: "cbb6c13f-6019-4ad5-9de6-07844c361b41", // FEM 19b
    definitionId: homarid.id,
    setCode: "fem",
    rarity: "common",
};
export const homaridFemC: CardPrint = {
    printId: "33536b0a-1cff-481f-b695-eadaf6897bf0", // FEM 19c
    definitionId: homarid.id,
    setCode: "fem",
    rarity: "common",
};
export const homaridFemD: CardPrint = {
    printId: "18f1cc24-a5fc-43cc-b558-ac7901c48b81", // FEM 19d
    definitionId: homarid.id,
    setCode: "fem",
    rarity: "common",
};

// Tidal Influence — {2}{U} Enchantment. The "tide anthem": same tide cycle as
// Homarid, but the effect is a board-wide blue-creature anthem analogue — all
// blue creatures get -2/-0 at exactly one tide counter, +2/+0 at exactly three.
// CAPABILITY J — "Cast this spell only if no permanent named Tidal Influence is
// on the battlefield" (CR 601.3e, `castUniqueByName`).
export const tidalInfluence: CardDefinition = {
    id: "b2192c7b-ef6f-4ff6-9017-b1a125340517", // FEM 28
    rarity: "rare",
    name: "Tidal Influence",
    oracleText:
        "Cast this spell only if no permanents named Tidal Influence are on the battlefield.\nThis enchantment enters with a tide counter on it.\nAt the beginning of your upkeep, put a tide counter on this enchantment.\nAs long as there is exactly one tide counter on this enchantment, all blue creatures get -2/-0.\nAs long as there are exactly three tide counters on this enchantment, all blue creatures get +2/+0.\nWhenever there are four or more tide counters on this enchantment, remove all tide counters from it.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    castUniqueByName: true,
    triggeredAbilities: [
        tideEnterTrigger("tidal-influence-tide-enter"),
        tideUpkeepTrigger("tidal-influence-tide-upkeep"),
        tideSheddingTrigger("tidal-influence-tide-shed"),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("U"),
            condition: (source) => (source.counters?.["tide"] ?? 0) === 1,
            power: -2,
            toughness: 0,
        },
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("U"),
            condition: (source) => (source.counters?.["tide"] ?? 0) === 3,
            power: 2,
            toughness: 0,
        },
    ],
};

// Homarid Warrior — {4}{U} 3/3 Homarid Warrior. "{U}: This creature gains
// shroud until end of turn and doesn't untap during your next untap step. Tap
// it." (CR 702.18 shroud grant + one-shot skip-next-untap + tap.)
export const homaridWarrior: CardDefinition = {
    id: "627ca588-917f-4768-a69d-3d93c1210390", // FEM 22a (canonical art)
    rarity: "common",
    name: "Homarid Warrior",
    oracleText:
        "{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap it.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Homarid", "Warrior"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "homarid-warrior-dive",
            oracleText:
                "{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap it.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.grantStaticAbility(self, "shroud", {
                    phase: "end-of-turn",
                });
                ctx.tap(self);
                ctx.skipNextUntap(self);
            },
        },
    ],
};

export const homaridWarriorFemB: CardPrint = {
    printId: "c9a9bdcf-543b-4140-b836-9e222a4a9233", // FEM 22b
    definitionId: homaridWarrior.id,
    setCode: "fem",
    rarity: "common",
};
export const homaridWarriorFemC: CardPrint = {
    printId: "fb1cccdc-9c4d-4ef3-807b-278e6fd23230", // FEM 22c
    definitionId: homaridWarrior.id,
    setCode: "fem",
    rarity: "common",
};

// Homarid Shaman — {2}{U}{U} 2/1 Homarid Shaman. "{U}: Tap target green
// creature." (CR 701.21 tap; colour-restricted target.)
export const homaridShaman: CardDefinition = {
    id: "c17c6416-86d6-46ea-aea1-41b98a66b250", // FEM 20
    rarity: "uncommon",
    name: "Homarid Shaman",
    oracleText: "{U}: Tap target green creature.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Homarid", "Shaman"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "homarid-shaman-tap",
            oracleText: "{U}: Tap target green creature.",
            cost: { mana: { U: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "G" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.tap(target);
            },
        },
    ],
};

// Homarid Spawning Bed — {U}{U} Enchantment. "{1}{U}{U}, Sacrifice a blue
// creature: Create X 1/1 blue Camarid creature tokens, where X is the
// sacrificed creature's mana value." (CR 118.5 sacrifice cost; CR 202.3 mana
// value snapshotted at cost payment; CR 111/707.1 tokens.)
export const homaridSpawningBed: CardDefinition = {
    id: "2cbb62fc-3cd9-41a6-804a-4ff9a766897f", // FEM 21
    rarity: "uncommon",
    name: "Homarid Spawning Bed",
    oracleText:
        "{1}{U}{U}, Sacrifice a blue creature: Create X 1/1 blue Camarid creature tokens, where X is the sacrificed creature's mana value.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "homarid-spawning-bed-spawn",
            oracleText:
                "{1}{U}{U}, Sacrifice a blue creature: Create X 1/1 blue Camarid creature tokens, where X is the sacrificed creature's mana value.",
            cost: {
                mana: { X: 1, U: 2 },
                sacrificeFilter: { types: "Creature", colors: ["U"] },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 202.3 — the sacrificed creature's pre-sacrifice mana value
                // was snapshotted onto the stack item when the sacrifice cost
                // was paid; read it here to size the token swarm.
                const mv = ctx.getAdditionalSacrificeMv() ?? 0;
                if (mv > 0) ctx.createToken(CAMARID_TOKEN, ctx.controller, mv);
            },
        },
    ],
};

// Deep Spawn — {5}{U}{U}{U} 6/6 Homarid. Trample; "At the beginning of your
// upkeep, sacrifice this creature unless you mill two cards."; "{U}: This
// creature gains shroud until end of turn and doesn't untap during your next
// untap step. Tap this creature." (CR 702.19 trample; CR 117.3a pay-or-
// sacrifice with a mill cost; CR 701.13a mill; shroud + skip-untap.)
export const deepSpawn: CardDefinition = {
    id: "69c9e4a5-735f-471c-ab1a-6e6d50ba5724", // FEM 17
    rarity: "rare",
    name: "Deep Spawn",
    oracleText:
        "Trample\nAt the beginning of your upkeep, sacrifice this creature unless you mill two cards.\n{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap this creature.",
    manaCost: { X: 5, U: 3 },
    types: ["Creature"],
    subtypes: ["Homarid"],
    power: 6,
    toughness: 6,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "deep-spawn-upkeep-mill",
            oracleText:
                "At the beginning of your upkeep, sacrifice this creature unless you mill two cards.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 117.3a — "unless you mill two cards": the upkeep player may
                // mill two (a real cost they choose to pay) to keep Deep Spawn.
                // Declining sacrifices it (CR 701.5a).
                const top = ctx.peekLibraryTop(scopedPlayerId, 2);
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `deep-spawn-mill-${ctx.sourceInstanceId}`,
                    prompt:
                        top.length < 2
                            ? "Mill two cards to keep Deep Spawn? (fewer than two in library)"
                            : "Mill two cards to keep Deep Spawn?",
                });
                if (paid === undefined) return; // suspended
                if (paid) {
                    // CR 701.13a — mill two: move the live top card to the
                    // graveyard twice. Stops naturally once the library empties.
                    for (let i = 0; i < 2; i++) {
                        const t = ctx.peekLibraryTop(scopedPlayerId, 1);
                        if (t.length === 0) break;
                        ctx.moveCardById(
                            scopedPlayerId,
                            t[0],
                            "library",
                            "graveyard"
                        );
                    }
                } else {
                    ctx.sacrifice(ctx.sourceInstanceId);
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "deep-spawn-dive",
            oracleText:
                "{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap this creature.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.grantStaticAbility(self, "shroud", {
                    phase: "end-of-turn",
                });
                ctx.tap(self);
                ctx.skipNextUntap(self);
            },
        },
    ],
};

// High Tide — {U} Instant. "Until end of turn, whenever a player taps an Island
// for mana, that player adds an additional {U}." (CR 614-style additive rider,
// applied through the single mana funnel — `addHighTide`; benefits every player
// who taps an Island this turn.)
export const highTide: CardDefinition = {
    id: "4686bbb9-517f-4cce-aa7a-5db41e22c02b", // FEM 18a (canonical art)
    rarity: "common",
    name: "High Tide",
    oracleText:
        "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.",
    manaCost: { U: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.addHighTide(ctx.controller);
    },
};

export const highTideFemB: CardPrint = {
    printId: "c2813677-91cc-4c8b-a8ea-403fa776c9f0", // FEM 18b
    definitionId: highTide.id,
    setCode: "fem",
    rarity: "common",
};
export const highTideFemC: CardPrint = {
    printId: "4af611e3-45d6-4aee-bf48-56598b14a242", // FEM 18c
    definitionId: highTide.id,
    setCode: "fem",
    rarity: "common",
};

// River Merfolk — {U}{U} 2/1 Merfolk. "{U}: This creature gains mountainwalk
// until end of turn." (CR 702.13 landwalk grant.)
export const riverMerfolk: CardDefinition = {
    id: "27d7fa54-4b89-4a9a-b088-4b89c525c1ea", // FEM 24
    rarity: "common",
    name: "River Merfolk",
    oracleText: "{U}: This creature gains mountainwalk until end of turn.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "river-merfolk-mountainwalk",
            oracleText:
                "{U}: This creature gains mountainwalk until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "mountainwalk",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Svyelunite Priest — {1}{U} 1/1 Merfolk Cleric. "{U}{U}, {T}: Target creature
// gains shroud until end of turn. Activate only during your upkeep." (CR 702.18
// shroud; CR 602.5 controller-turn timing narrowed to upkeep via canActivate +
// activation phase restriction.)
export const svyelunitePriest: CardDefinition = {
    id: "316d25ae-7ac6-4f5b-93ab-0e0e28ec104b", // FEM 26
    rarity: "common",
    name: "Svyelunite Priest",
    oracleText:
        "{U}{U}, {T}: Target creature gains shroud until end of turn. Activate only during your upkeep.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "svyelunite-priest-shroud",
            oracleText:
                "{U}{U}, {T}: Target creature gains shroud until end of turn. Activate only during your upkeep.",
            cost: { mana: { U: 2 }, tap: true },
            useStack: true,
            // CR 602.5 — "Activate only during your upkeep": the source's
            // controller must be the active player (controllerTurnOnly) and the
            // phase must be UPKEEP (activationPhaseRestriction).
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "shroud", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Vodalian Mage — {2}{U} 1/1 Merfolk Wizard. "{U}, {T}: Counter target spell
// unless its controller pays {1}." (CR 701.5a counter-unless-pay; CR 117.3a
// may-pay billed to the spell's controller.)
export const vodalianMage: CardDefinition = {
    id: "c107e82b-134a-4f2b-98c2-6537fae6a50d", // FEM 30a (canonical art)
    rarity: "common",
    name: "Vodalian Mage",
    oracleText:
        "{U}, {T}: Counter target spell unless its controller pays {1}.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "vodalian-mage-counter",
            oracleText:
                "{U}, {T}: Counter target spell unless its controller pays {1}.",
            cost: { mana: { U: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "spell", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "spell") return;
                const spellController = ctx.getController(target);
                const accept = ctx.requestMayPay({
                    playerId: spellController,
                    choiceId: `vodalian-mage-${ctx.sourceInstanceId}`,
                    cost: { X: 1 },
                    prompt: "Pay {1} or your spell is countered (Vodalian Mage)?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) ctx.counter(target);
            },
        },
    ],
};

export const vodalianMageFemB: CardPrint = {
    printId: "a47beac4-161d-4f8e-9778-78293ff9b383", // FEM 30b
    definitionId: vodalianMage.id,
    setCode: "fem",
    rarity: "common",
};
export const vodalianMageFemC: CardPrint = {
    printId: "2b3cc91d-6f87-4f2e-b3c7-8181d19a1f0b", // FEM 30c
    definitionId: vodalianMage.id,
    setCode: "fem",
    rarity: "common",
};

// Vodalian Knights — {1}{U}{U} 2/2 Merfolk Knight. First strike; "This creature
// can't attack unless defending player controls an Island."; "When you control
// no Islands, sacrifice this creature."; "{U}: This creature gains flying until
// end of turn." (CR 702.7 first strike; CR 508.1c attack-restriction; CR 603.8
// state-trigger sacrifice; CR 702.9 flying grant.)
export const vodalianKnights: CardDefinition = {
    id: "68d97e1b-2526-4740-b354-f158734d1f72", // FEM 29
    rarity: "uncommon",
    name: "Vodalian Knights",
    oracleText:
        "First strike\nThis creature can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice this creature.\n{U}: This creature gains flying until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "vodalian-knights-island-restriction",
            oracleText:
                "This creature can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        stateTrigger({
            id: "vodalian-knights-no-islands",
            oracleText: "When you control no Islands, sacrifice this creature.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
    activatedAbilities: [
        {
            id: "vodalian-knights-fly",
            oracleText: "{U}: This creature gains flying until end of turn.",
            cost: { mana: { U: 1 } },
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

// Vodalian War Machine — {1}{U}{U} 0/4 Wall. Defender; two `tapOtherFilter`
// (capability D, C3 #568) abilities tapping a Merfolk you control to attack
// through defender or pump; and a death trigger destroying every Merfolk tapped
// this turn to pay for its abilities. (CR 702.3 defender; CR 118.8 tap-other
// cost; CR 603.6e dies trigger.)
export const vodalianWarMachine: CardDefinition = {
    id: "cd962ff0-4aa6-453e-931e-bd36fc034273", // FEM 32
    rarity: "rare",
    name: "Vodalian War Machine",
    oracleText:
        "Defender\nTap an untapped Merfolk you control: This creature can attack this turn as though it didn't have defender.\nTap an untapped Merfolk you control: This creature gets +2/+1 until end of turn.\nWhen this creature dies, destroy all Merfolk tapped this turn to pay for its abilities.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 4,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "vodalian-war-machine-attack",
            oracleText:
                "Tap an untapped Merfolk you control: This creature can attack this turn as though it didn't have defender.",
            cost: {
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        subtypes: "Merfolk",
                        controllerRelation: "you",
                    },
                    count: 1,
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.allowAttackDespiteDefender({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
        {
            id: "vodalian-war-machine-pump",
            oracleText:
                "Tap an untapped Merfolk you control: This creature gets +2/+1 until end of turn.",
            cost: {
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        subtypes: "Merfolk",
                        controllerRelation: "you",
                    },
                    count: 1,
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    2,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    // NOTE (faithful-text deferral): the printed death rider — "When this
    // creature dies, destroy all Merfolk tapped this turn to pay for its
    // abilities." — requires per-source bookkeeping of which permanents were
    // tapped to pay THIS card's `tapOtherFilter` costs across the turn, a
    // capability the engine doesn't yet track. The load-bearing mechanic for
    // this slice (the `tapOtherFilter` cost to attack/pump, acceptance
    // criterion) is fully implemented above; the death-destroy rider is
    // deferred and flagged rather than silently dropped. See issue #571.
};

// Seasinger — {1}{U}{U} 0/1 Merfolk. "When you control no Islands, sacrifice
// this creature."; "You may choose not to untap this creature during your untap
// step." (CAPABILITY I — REUSE of the `may-choose-not-to-untap` static ability,
// ATQ cluster E, CR 502.1); "{T}: Gain control of target creature whose
// controller controls an Island for as long as you control this creature and
// this creature remains tapped." (conditional `gainControl`, CR 611.2c
// source-tapped condition.)
export const seasinger: CardDefinition = {
    id: "c5266aa1-e2ea-46b9-91ab-b94a7bb7e9f9", // FEM 25
    rarity: "uncommon",
    name: "Seasinger",
    oracleText:
        "When you control no Islands, sacrifice this creature.\nYou may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature whose controller controls an Island for as long as you control this creature and this creature remains tapped.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 0,
    toughness: 1,
    staticAbilities: ["may-choose-not-to-untap"],
    triggeredAbilities: [
        stateTrigger({
            id: "seasinger-no-islands",
            oracleText: "When you control no Islands, sacrifice this creature.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
    activatedAbilities: [
        {
            id: "seasinger-steal",
            oracleText:
                "{T}: Gain control of target creature whose controller controls an Island for as long as you control this creature and this creature remains tapped.",
            cost: { tap: true },
            useStack: true,
            // The engine has no "controller controls subtype X" target filter,
            // so the "whose controller controls an Island" clause (CR 115.4) is
            // enforced at resolution (CR 608.2b — an illegal target makes the
            // ability not resolve) rather than at target enumeration. Targeting
            // is over any creature; the resolve guard fizzles non-Island
            // controllers. (Faithful-text simplification flagged in #571.)
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // CR 115.4 — the target's controller must control an Island.
                const targetController = ctx.getController(target);
                const controlsIsland =
                    ctx.getBattlefieldIds(targetController, {
                        subtypes: "Island",
                    }).length > 0;
                if (!controlsIsland) return;
                // CR 611.2c — control lasts only "for as long as ... this
                // creature remains tapped". The conditional-control SBA reverts
                // it the moment Seasinger untaps or leaves play.
                ctx.gainControl(target, ctx.controller, {
                    kind: "source-tapped",
                });
            },
        },
    ],
};

// Merseine — {2}{U}{U} Aura — Enchant creature. "This Aura enters with three net
// counters on it."; "Enchanted creature doesn't untap during its controller's
// untap step if this Aura has a net counter on it."; "Pay enchanted creature's
// mana cost: Remove a net counter from this Aura. Only the controller of the
// enchanted creature may activate this ability." (CR 303.4 Aura; CR 122.1 net
// counters; CR 502.1 untap lock while a net counter remains; CAPABILITY K —
// dynamic cost = enchanted creature's mana cost, CR 601.2f / 202.3.)
export const merseine: CardDefinition = {
    id: "b1e96895-ef1d-44fa-b263-bce833fc3109", // FEM 23a (canonical art)
    rarity: "common",
    name: "Merseine",
    oracleText:
        "Enchant creature\nThis Aura enters with three net counters on it.\nEnchanted creature doesn't untap during its controller's untap step if this Aura has a net counter on it.\nPay enchanted creature's mana cost: Remove a net counter from this Aura. Only the controller of the enchanted creature may activate this ability.",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "merseine-enter-counters",
            oracleText: "This Aura enters with three net counters on it.",
            scope: "self",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "net",
                    3
                );
            },
        }),
    ],
    // CR 502.1 — the enchanted creature doesn't untap while a net counter
    // remains. Expressed as an untap restriction scoped to the Aura's host,
    // gated on the live net-counter count.
    staticEffects: [
        {
            kind: "untap-restriction",
            id: "merseine-untap-lock",
            oracleText:
                "Enchanted creature doesn't untap during its controller's untap step if this Aura has a net counter on it.",
            // Empty filter is ignored when `appliesToHost` is set — the engine
            // synthesizes an instance-id filter for the Aura's host.
            filter: {},
            maxUntap: 0,
            scope: "each-player",
            appliesToHost: true,
            condition: (source) => (source.counters?.["net"] ?? 0) > 0,
        },
    ],
    activatedAbilities: [
        {
            id: "merseine-remove-net",
            oracleText:
                "Pay enchanted creature's mana cost: Remove a net counter from this Aura. Only the controller of the enchanted creature may activate this ability.",
            cost: {
                manaEqualToEnchantedCreatureCost: true,
                removeCounter: { type: "net", count: 1 },
            },
            useStack: true,
            // "Only the controller of the enchanted creature may activate this
            // ability" (CR 602.1). The activating player isn't passed to
            // canActivate, so the engine gates activator identity at the
            // activation entry point; this guard additionally requires the Aura
            // to still be attached (the dynamic cost needs a host).
            canActivate: (source) => source.attachedTo !== undefined,
            activatableByEnchantedController: true,
            resolve: () => {
                // The net counter was removed as part of the activation cost
                // (CR 122.6); nothing more happens on resolution.
            },
        },
    ],
};

export const merseineFemB: CardPrint = {
    printId: "5c7fb804-65ba-477e-93e8-eea101c1521e", // FEM 23b
    definitionId: merseine.id,
    setCode: "fem",
    rarity: "common",
};
export const merseineFemC: CardPrint = {
    printId: "2dd197f8-ced0-461a-9672-2720a7b70803", // FEM 23c
    definitionId: merseine.id,
    setCode: "fem",
    rarity: "common",
};
export const merseineFemD: CardPrint = {
    printId: "ae7a9e9a-d1f8-44c5-9f79-a1201acfb5fc", // FEM 23d
    definitionId: merseine.id,
    setCode: "fem",
    rarity: "common",
};

// Tidal Flats — {U} Enchantment. "{U}{U}: For each attacking creature without
// flying, its controller may pay {1}. If that player doesn't, creatures you
// control blocking that creature gain first strike until end of turn."
// (CR 509 combat; CR 117.3a per-attacker may-pay; CR 702.7 first strike grant.)
export const tidalFlats: CardDefinition = {
    id: "2e820f3f-434e-4d09-91b9-0ebd6966b393", // FEM 27a (canonical art)
    rarity: "common",
    name: "Tidal Flats",
    oracleText:
        "{U}{U}: For each attacking creature without flying, its controller may pay {1}. If that player doesn't, creatures you control blocking that creature gain first strike until end of turn.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "tidal-flats-first-strike",
            oracleText:
                "{U}{U}: For each attacking creature without flying, its controller may pay {1}. If that player doesn't, creatures you control blocking that creature gain first strike until end of turn.",
            cost: { mana: { U: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 509 / 117.3a — for each non-flying attacker, its controller
                // may pay {1}; if they don't, this Aura's controller's creatures
                // blocking that attacker gain first strike until end of turn.
                // Attacker→blocker pairings are read from the live combat state.
                const blockersByAttacker = ctx.getBlockersByAttacker();
                for (const attackerId of Object.keys(blockersByAttacker)) {
                    const atk = { type: "permanent" as const, id: attackerId };
                    if (ctx.hasStaticAbility(atk, "flying")) continue;
                    const blockers = blockersByAttacker[attackerId].filter(
                        (bId) =>
                            ctx.getController({
                                type: "permanent",
                                id: bId,
                            }) === ctx.controller
                    );
                    // No first-strike payoff possible if this Aura's controller
                    // isn't blocking that attacker — skip the may-pay entirely.
                    if (blockers.length === 0) continue;
                    const atkController = ctx.getController(atk);
                    const paid = ctx.requestMayPay({
                        playerId: atkController,
                        choiceId: `tidal-flats-${ctx.sourceInstanceId}-${attackerId}`,
                        cost: { X: 1 },
                        prompt: "Pay {1} or your attacker's blockers gain first strike (Tidal Flats)?",
                    });
                    if (paid === undefined) return; // suspended
                    if (!paid) {
                        for (const bId of blockers) {
                            ctx.grantStaticAbility(
                                { type: "permanent", id: bId },
                                "first strike",
                                { phase: "end-of-turn" }
                            );
                        }
                    }
                }
            },
        },
    ],
};

export const tidalFlatsFemB: CardPrint = {
    printId: "50e7d376-3e22-44aa-9c96-a3b8eb1568fe", // FEM 27b
    definitionId: tidalFlats.id,
    setCode: "fem",
    rarity: "common",
};
export const tidalFlatsFemC: CardPrint = {
    printId: "445c4767-6261-449c-bb57-713e2a2bb0bf", // FEM 27c
    definitionId: tidalFlats.id,
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

// ─────────────────────────────────────────────────────────────────────────────
// C5 — Black: Thrulls & Order of the Ebon Hand (#572).
//
// New engine work this cluster exercises (see PRD #566):
//   • CAPABILITY C — sacrifice-self FIXED-output mana ability (Basal Thrull,
//     ADR 0039): `cost: { tap, sacrifice }` + `manaProduced` on a
//     `useStack: false` ability. The three fixed-output tap-mana paths in
//     game.ts now pay the self-sacrifice instead of tapping.
//   • CAPABILITY G — per-turn activation count / once-per-turn (reused from C3's
//     Farrelite Priest): Initiates of the Ebon Hand (4th+ activation → delayed
//     end-step self-sacrifice) and Ebon Praetor (`oncePerTurn`).
//   • CAPABILITY E (extended) — exile-a-permanent-you-control as an additional
//     cost coexisting with a target (Soul Exchange): `additionalCosts.exileFilter`
//     + `getAdditionalCostSubtypes()`.
// Everything else is free-tranche reuse (anthem pt-buff, conditional gainControl,
// counter-unless-pay, random discard, upkeep pay-or-sacrifice, attack-and-
// sacrifice riders, regenerate-aura, cost-increase static, typed-sac + time
// counters + tap-the-land cost).
// ─────────────────────────────────────────────────────────────────────────────

// A 0/1 black Thrull token created by Breeding Pit each end step.
const THRULL_TOKEN: TokenSpec = {
    name: "Thrull",
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 0,
    toughness: 1,
    colors: ["B"],
};

// Armor Thrull — {2}{B} 1/3 Thrull. "{T}, Sacrifice this creature: Put a +1/+2
// counter on target creature." (CR 602.1 tap + self-sacrifice activation cost;
// CR 122.1 P/T counter. Reuses `cost: { tap, sacrifice }` on a useStack:true
// targeted ability — the sacrifice is the source itself.)
export const armorThrull: CardDefinition = {
    id: "a98384d1-8e7d-4c41-9f23-47bc2ae2ad6a", // FEM 33a (canonical art)
    rarity: "common",
    name: "Armor Thrull",
    oracleText:
        "{T}, Sacrifice this creature: Put a +1/+2 counter on target creature.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "armor-thrull-counter",
            oracleText:
                "{T}, Sacrifice this creature: Put a +1/+2 counter on target creature.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.addCounter(target, "+1/+2", 1);
            },
        },
    ],
};
export const armorThrullFemB: CardPrint = {
    printId: "9c6120e6-ceb8-4eab-86b0-18d38ed97d8f", // FEM 33b
    definitionId: armorThrull.id,
    setCode: "fem",
    rarity: "common",
};
export const armorThrullFemC: CardPrint = {
    printId: "18a91ed4-131e-455b-a3bd-0bd42aa754e5", // FEM 33c
    definitionId: armorThrull.id,
    setCode: "fem",
    rarity: "common",
};
export const armorThrullFemD: CardPrint = {
    printId: "3d653ca4-c21f-4594-b900-2526a912001b", // FEM 33d
    definitionId: armorThrull.id,
    setCode: "fem",
    rarity: "common",
};

// Basal Thrull — {B}{B} 1/2 Thrull. CAPABILITY C (ADR 0039) — a FIXED-output
// SACRIFICE-SELF MANA ABILITY: "{T}, Sacrifice this creature: Add {B}{B}." A
// mana ability (CR 605.1a — adds mana, no target, resolves without the stack),
// `useStack: false`, whose cost taps AND sacrifices the source for a fixed
// `{B}{B}`. The engine's fixed-output tap-mana paths sacrifice the source
// instead of tapping it (game.ts, ADR 0039).
export const basalThrull: CardDefinition = {
    id: "0c1d5d13-0160-48cb-8fac-dd86102569b4", // FEM 34a (canonical art)
    rarity: "common",
    name: "Basal Thrull",
    oracleText: "{T}, Sacrifice this creature: Add {B}{B}.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "basal-thrull-mana",
            oracleText: "{T}, Sacrifice this creature: Add {B}{B}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            manaProduced: { B: 2 },
        },
    ],
};
export const basalThrullFemB: CardPrint = {
    printId: "fcf60db5-4f69-4db4-9dc2-1a6fbdec0429", // FEM 34b
    definitionId: basalThrull.id,
    setCode: "fem",
    rarity: "common",
};
export const basalThrullFemC: CardPrint = {
    printId: "a86d9647-3a87-4620-aa07-26f996fc6fa3", // FEM 34c
    definitionId: basalThrull.id,
    setCode: "fem",
    rarity: "common",
};
export const basalThrullFemD: CardPrint = {
    printId: "b6908e4c-f94d-4b0d-b9a5-64c04751f108", // FEM 34d
    definitionId: basalThrull.id,
    setCode: "fem",
    rarity: "common",
};

// Breeding Pit — {3}{B} Enchantment. "At the beginning of your upkeep,
// sacrifice this enchantment unless you pay {B}{B}." + "At the beginning of your
// end step, create a 0/1 black Thrull creature token." (CR 603.2 upkeep
// pay-or-sacrifice via the shared leg.ts helper; CR 603.2 end-step token.)
export const breedingPit: CardDefinition = {
    id: "a0d7e85f-eba5-4fc5-9fc0-109109d368aa", // FEM 35
    rarity: "uncommon",
    name: "Breeding Pit",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {B}{B}.\nAt the beginning of your end step, create a 0/1 black Thrull creature token.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "breeding-pit-upkeep",
            cardName: "Breeding Pit",
            cost: { B: 2 },
            costText: "{B}{B}",
        }),
        phaseTrigger({
            id: "breeding-pit-end-step",
            phase: "END_STEP",
            scope: "your",
            oracleText:
                "At the beginning of your end step, create a 0/1 black Thrull creature token.",
            resolve: (ctx) => {
                ctx.createToken(THRULL_TOKEN, ctx.controller, 1);
            },
        }),
    ],
};

// Derelor — {3}{B} 4/4 Thrull. "Black spells you cast cost {B} more to cast."
// (CR 601.2f cost increase — the Gloom precedent, scoped to the controller's
// OWN black spells via the `effectSource` argument: the spell's caster
// (`card.controllerId`) must equal Derelor's controller.)
export const derelor: CardDefinition = {
    id: "9eb2b79f-f09a-49dc-8e0f-7d711ba78981", // FEM 36
    rarity: "rare",
    name: "Derelor",
    oracleText: "Black spells you cast cost {B} more to cast.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 4,
    toughness: 4,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                ctx.getColors(card).includes("B") &&
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId,
            costIncrease: { B: 1 },
        },
    ],
};

// Ebon Praetor — {4}{B}{B} 5/5 Avatar Praetor. First strike, trample; "At the
// beginning of your upkeep, put a -2/-2 counter on this creature."; CAPABILITY G
// (oncePerTurn) — "Sacrifice a creature: Remove a -2/-2 counter from this
// creature. If the sacrificed creature was a Thrull, put a +1/+0 counter on this
// creature. Activate only during your upkeep and only once each turn." (CR 122.1
// counters; CR 602.5 once-per-turn + phase restriction; the Thrull check reads
// the sacrificed permanent's snapshotted mana value path's subtype analog via a
// pre-sacrifice subtype lookup.)
export const ebonPraetor: CardDefinition = {
    id: "40451f7a-692a-422d-99d3-d93a4d9315e0", // FEM 37
    rarity: "rare",
    name: "Ebon Praetor",
    oracleText:
        "First strike, trample\nAt the beginning of your upkeep, put a -2/-2 counter on this creature.\nSacrifice a creature: Remove a -2/-2 counter from this creature. If the sacrificed creature was a Thrull, put a +1/+0 counter on this creature. Activate only during your upkeep and only once each turn.",
    manaCost: { X: 4, B: 2 },
    types: ["Creature"],
    subtypes: ["Avatar", "Praetor"],
    power: 5,
    toughness: 5,
    staticAbilities: ["first strike", "trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ebon-praetor-upkeep",
            phase: "UPKEEP",
            scope: "your",
            oracleText:
                "At the beginning of your upkeep, put a -2/-2 counter on this creature.",
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "-2/-2",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "ebon-praetor-sacrifice",
            oracleText:
                "Sacrifice a creature: Remove a -2/-2 counter from this creature. If the sacrificed creature was a Thrull, put a +1/+0 counter on this creature. Activate only during your upkeep and only once each turn.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            oncePerTurn: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // CR 122.6 — remove a -2/-2 counter the praetor received.
                ctx.removeCounter(self, "-2/-2", 1);
                // CR 117.9 — the sacrificed creature's subtypes were snapshotted
                // when the activation cost was paid; a Thrull adds +1/+0.
                const subtypes = ctx.getAdditionalCostSubtypes();
                if (subtypes?.includes("Thrull")) {
                    ctx.addCounter(self, "+1/+0", 1);
                }
            },
        },
    ],
};

// Hymn to Tourach — {B}{B} Sorcery. "Target player discards two cards at
// random." (CR 701.8a random discard via the seeded PRNG.)
export const hymnToTourach: CardDefinition = {
    id: "eb9273ea-9a41-42e3-8c9c-0d50b127a818", // FEM 38a (canonical art)
    rarity: "common",
    name: "Hymn to Tourach",
    oracleText: "Target player discards two cards at random.",
    manaCost: { B: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        ctx.discardAtRandom(target.id, 2);
    },
};
export const hymnToTourachFemB: CardPrint = {
    printId: "8601f082-7e43-44ef-97d0-dead272b7eb4", // FEM 38b
    definitionId: hymnToTourach.id,
    setCode: "fem",
    rarity: "common",
};
export const hymnToTourachFemC: CardPrint = {
    printId: "58e125c6-81dc-4907-aad2-2ccd1cb166f0", // FEM 38c
    definitionId: hymnToTourach.id,
    setCode: "fem",
    rarity: "common",
};
export const hymnToTourachFemD: CardPrint = {
    printId: "5bc50e08-dd6f-4ea7-87f8-cce72bafb928", // FEM 38d
    definitionId: hymnToTourach.id,
    setCode: "fem",
    rarity: "common",
};

// Initiates of the Ebon Hand — {B} 1/1 Cleric. CAPABILITY G (reused from
// Farrelite Priest): "{1}: Add {B}. If this ability has been activated four or
// more times this turn, sacrifice this creature at the beginning of the next end
// step." (CR 605.1a repeatable non-tap mana ability; CR 602.5 activation count;
// CR 603.7a delayed end-step self-sacrifice on the 4th+ activation.)
const INITIATES_EBON_HAND_ID = "5be87527-3b8f-4529-afdb-a61ad4e787e1"; // FEM 39a
export const initiatesOfTheEbonHand: CardDefinition = {
    id: INITIATES_EBON_HAND_ID,
    rarity: "common",
    name: "Initiates of the Ebon Hand",
    oracleText:
        "{1}: Add {B}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "initiates-ebon-hand-mana",
            oracleText:
                "{1}: Add {B}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
            cost: { mana: { X: 1 } },
            useStack: false,
            manaProduced: { B: 1 },
            resolve: (ctx: SpellContext) => {
                ctx.addMana({ B: 1 });
                // CR 602.5 — count includes the current activation (recorded
                // before resolve runs).
                const count = ctx.getActivationCount(
                    "initiates-ebon-hand-mana"
                );
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        INITIATES_EBON_HAND_ID,
                        "initiates-ebon-hand-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "initiates-ebon-hand-sacrifice",
            oracleText:
                "Sacrifice Initiates of the Ebon Hand at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.sacrifice(targetId);
            },
        },
    ],
};
export const initiatesOfTheEbonHandFemB: CardPrint = {
    printId: "03c7dc01-46d0-42be-a1a9-48f69c846d12", // FEM 39b
    definitionId: initiatesOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};
export const initiatesOfTheEbonHandFemC: CardPrint = {
    printId: "62982970-e8b8-4659-bcf0-21aab662d89d", // FEM 39c
    definitionId: initiatesOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};

// Mindstab Thrull — {1}{B}{B} 2/2 Thrull. "Whenever this creature attacks and
// isn't blocked, you may sacrifice it. If you do, defending player discards
// three cards." (CR 509.1h ATTACKER_UNBLOCKED; CR 603.3d optional self-sacrifice
// rider; the discard is the controller's choice of three cards — CR 701.8.)
export const mindstabThrull: CardDefinition = {
    id: "499a791f-ac4f-4a96-b59b-37043686a79a", // FEM 40a (canonical art)
    rarity: "common",
    name: "Mindstab Thrull",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, defending player discards three cards.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "mindstab-thrull-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, defending player discards three cards.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                const controllerId = event.attackerControllerId;
                const sac = ctx.requestMayPay({
                    playerId: controllerId,
                    choiceId: `mindstab-thrull-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice Mindstab Thrull to make the defending player discard three cards?",
                });
                if (sac === undefined) return; // suspended
                if (!sac) return; // declined
                ctx.sacrifice(ctx.sourceInstanceId);
                // CR 506.2 — the defending player is the attacker controller's
                // opponent (2-player / solo).
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== controllerId
                );
                if (!defenderId) return;
                // CR 701.8a — "discards three cards" (the defending player's
                // own choice, clamped to hand size).
                const handSize = ctx.getHandSize(defenderId);
                if (handSize === 0) return;
                const picks = ctx.requestChoice({
                    playerId: defenderId,
                    choiceId: `mindstab-thrull-discard-${ctx.sourceInstanceId}`,
                    kind: "discard-hand",
                    zone: "hand",
                    count: Math.min(3, handSize),
                    prompt: "Discard three cards (Mindstab Thrull).",
                });
                if (picks === undefined) return; // suspended
                for (const id of picks) ctx.discardCard(defenderId, id);
            },
        },
    ],
};
export const mindstabThrullFemB: CardPrint = {
    printId: "781e4b62-3910-4ba1-9e72-e99de8523a94", // FEM 40b
    definitionId: mindstabThrull.id,
    setCode: "fem",
    rarity: "common",
};
export const mindstabThrullFemC: CardPrint = {
    printId: "923189c6-d407-4cc4-a062-2f09a4c7c1e3", // FEM 40c
    definitionId: mindstabThrull.id,
    setCode: "fem",
    rarity: "common",
};

// Necrite — {1}{B}{B} 2/2 Thrull. "Whenever this creature attacks and isn't
// blocked, you may sacrifice it. If you do, destroy target creature defending
// player controls. It can't be regenerated." (CR 509.1h ATTACKER_UNBLOCKED;
// CR 603.3d optional self-sacrifice rider; CR 701.7 destroy + can't-regenerate.)
export const necrite: CardDefinition = {
    id: "311d752a-ce8a-44cb-8aeb-1ed66705eb09", // FEM 41a (canonical art)
    rarity: "common",
    name: "Necrite",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, destroy target creature defending player controls. It can't be regenerated.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "necrite-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, destroy target creature defending player controls. It can't be regenerated.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                const controllerId = event.attackerControllerId;
                // CR 506.2 — defending player = attacker controller's opponent.
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== controllerId
                );
                if (!defenderId) return;
                const candidates = ctx.getBattlefieldIds(defenderId, {
                    types: "Creature",
                });
                if (candidates.length === 0) return;
                // CR 603.3d — "you may sacrifice it. If you do, destroy target
                // creature": picking a creature implies the sacrifice; declining
                // (empty pick) leaves the Thrull on the battlefield.
                const picks = ctx.requestChoice({
                    playerId: controllerId,
                    choiceId: `necrite-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: defenderId,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Sacrifice Necrite to destroy a creature the defending player controls? (pick one, or decline)",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return; // declined
                ctx.sacrifice(ctx.sourceInstanceId);
                ctx.destroy(
                    { type: "permanent", id: targetId },
                    { cantBeRegenerated: true }
                );
            },
        },
    ],
};
export const necriteFemB: CardPrint = {
    printId: "e19a4d41-e7b0-48b3-8e2e-9ac00f119ce2", // FEM 41b
    definitionId: necrite.id,
    setCode: "fem",
    rarity: "common",
};
export const necriteFemC: CardPrint = {
    printId: "660ae99f-4e61-45fd-9436-855a38289c8b", // FEM 41c
    definitionId: necrite.id,
    setCode: "fem",
    rarity: "common",
};

// Order of the Ebon Hand — {B}{B} 2/1 Cleric Knight. "Protection from white";
// "{B}: This creature gains first strike until end of turn."; "{B}{B}: This
// creature gets +1/+0 until end of turn." (CR 702.16 protection; CR 702.7 first
// strike grant; CR 611.2c temp P/T pump — the Order pump-knight package.)
export const orderOfTheEbonHand: CardDefinition = {
    id: "9e51f5d8-a7cc-4720-8af5-e002bcfd78a0", // FEM 42a (canonical art)
    rarity: "common",
    name: "Order of the Ebon Hand",
    oracleText:
        "Protection from white\n{B}: This creature gains first strike until end of turn.\n{B}{B}: This creature gets +1/+0 until end of turn.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Cleric", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from white"],
    activatedAbilities: [
        {
            id: "order-ebon-hand-first-strike",
            oracleText:
                "{B}: This creature gains first strike until end of turn.",
            cost: { mana: { B: 1 } },
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
            id: "order-ebon-hand-pump",
            oracleText: "{B}{B}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { B: 2 } },
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
export const orderOfTheEbonHandFemB: CardPrint = {
    printId: "60ffbb40-13c1-4d01-9421-95b2410d0d3b", // FEM 42b
    definitionId: orderOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};
export const orderOfTheEbonHandFemC: CardPrint = {
    printId: "22c32774-5507-4a60-9ed2-2a570f6ff8e3", // FEM 42c
    definitionId: orderOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};

// Soul Exchange — {B}{B} Sorcery. CAPABILITY E (extended) — exile-a-permanent-
// you-control as an additional cost coexisting with a target: "As an additional
// cost to cast this spell, exile a creature you control. Return target creature
// card from your graveyard to the battlefield. Put a +2/+2 counter on that
// creature if the exiled creature was a Thrull." (CR 117.9 / 601.2f additional
// exile cost; CR 400.7 graveyard→battlefield reanimation; the exiled creature's
// subtypes are snapshotted at cast and read via `getAdditionalCostSubtypes`.)
export const soulExchange: CardDefinition = {
    id: "9f73597d-f453-4d37-b2ef-c54ef683a884", // FEM 43
    rarity: "uncommon",
    name: "Soul Exchange",
    oracleText:
        "As an additional cost to cast this spell, exile a creature you control.\nReturn target creature card from your graveyard to the battlefield. Put a +2/+2 counter on that creature if the exiled creature was a Thrull.",
    manaCost: { B: 2 },
    types: ["Sorcery"],
    additionalCosts: { exileFilter: { types: "Creature", controllerRelation: "you" } },
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card" || !t.playerId) return;
        const returned = ctx.returnToBattlefield(t.playerId, t.id, "graveyard");
        if (!returned) return;
        // CR 117.9 — the exiled creature's subtypes were snapshotted as the
        // additional cost was paid; a Thrull adds a +2/+2 counter to the
        // reanimated creature.
        const subtypes = ctx.getAdditionalCostSubtypes();
        if (subtypes?.includes("Thrull")) {
            ctx.addCounter({ type: "permanent", id: t.id }, "+2/+2", 1);
        }
    },
};

// Thrull Champion — {4}{B} 2/2 Thrull. "Thrull creatures get +1/+1." + "{T}:
// Gain control of target Thrull for as long as you control this creature."
// (CR 611 layer 7c anthem scoped to Thrulls; CR 611.2c conditional gainControl
// via `controller-controls-source` — the Scarwood Bandits precedent.)
export const thrullChampion: CardDefinition = {
    id: "4d3cafdd-a03b-4b08-b9c1-c776f8450d3a", // FEM 44
    rarity: "rare",
    name: "Thrull Champion",
    oracleText:
        "Thrull creatures get +1/+1.\n{T}: Gain control of target Thrull for as long as you control this creature.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.hasSubtype(target, "Thrull"),
            power: 1,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "thrull-champion-steal",
            oracleText:
                "{T}: Gain control of target Thrull for as long as you control this creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, subtypeFilter: "Thrull" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
            },
        },
    ],
};

// Thrull Retainer — {B} Aura — Enchant creature. "Enchanted creature gets
// +1/+1." + "Sacrifice this Aura: Regenerate enchanted creature." (CR 303.4
// Aura; CR 611 layer 7c host buff via AURA_AFFECTS_HOST; CR 701.15a regenerate
// shield via the Aura's self-sacrifice cost.)
export const thrullRetainer: CardDefinition = {
    id: "d800512b-1492-41d2-931d-57c625044454", // FEM 45
    rarity: "uncommon",
    name: "Thrull Retainer",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+1.\nSacrifice this Aura: Regenerate enchanted creature.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "thrull-retainer-regenerate",
            oracleText: "Sacrifice this Aura: Regenerate enchanted creature.",
            cost: { sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.applyRegenerationShield({ type: "permanent", id: hostId });
            },
        },
    ],
};

// Thrull Wizard — {2}{B} 1/1 Thrull Wizard. "{1}{B}: Counter target black spell
// unless that spell's controller pays {B} or {3}." (CR 701.5a counter-unless-pay;
// CR 117.3a may-pay billed to the spell's controller. FAITHFUL-TEXT SIMPLIFICATION:
// the engine's `requestMayPay` takes a single cost, so the "pay {B} OR {3}"
// alternative is modelled as a single may-pay of {B} (the dominant choice). The
// {3} alternative is flagged, not silently dropped.)
export const thrullWizard: CardDefinition = {
    id: "c4e732fb-cbef-4fd8-b704-e4d513a6cf2d", // FEM 46
    rarity: "uncommon",
    name: "Thrull Wizard",
    oracleText:
        "{1}{B}: Counter target black spell unless that spell's controller pays {B} or {3}.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "thrull-wizard-counter",
            oracleText:
                "{1}{B}: Counter target black spell unless that spell's controller pays {B} or {3}.",
            cost: { mana: { X: 1, B: 1 } },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                colorFilter: "B",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "spell") return;
                const spellController = ctx.getController(target);
                const accept = ctx.requestMayPay({
                    playerId: spellController,
                    choiceId: `thrull-wizard-${ctx.sourceInstanceId}`,
                    cost: { B: 1 },
                    prompt: "Pay {B} or your spell is countered (Thrull Wizard)?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) ctx.counter(target);
            },
        },
    ],
};

// Tourach's Chant — {1}{B}{B} Enchantment. "At the beginning of your upkeep,
// sacrifice this enchantment unless you pay {B}." + "Whenever a player puts a
// Forest onto the battlefield, this enchantment deals 3 damage to that player
// unless they put a -1/-1 counter on a creature they control." (CR 603.2 upkeep
// pay-or-sacrifice; CR 603.2 land-type-entered trigger with a player choice.)
export const tourachsChant: CardDefinition = {
    id: "06883fd2-eccd-47c6-8c34-10d95e923685", // FEM 47
    rarity: "uncommon",
    name: "Tourach's Chant",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {B}.\nWhenever a player puts a Forest onto the battlefield, this enchantment deals 3 damage to that player unless they put a -1/-1 counter on a creature they control.",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "tourachs-chant-upkeep",
            cardName: "Tourach's Chant",
            cost: { B: 1 },
            costText: "{B}",
        }),
        enteredTrigger({
            id: "tourachs-chant-forest-punish",
            oracleText:
                "Whenever a player puts a Forest onto the battlefield, this enchantment deals 3 damage to that player unless they put a -1/-1 counter on a creature they control.",
            scope: "any",
            // The PERMANENT_ENTERED payload doesn't carry subtypes, so gate on
            // the entering land's live subtypes read from state (CR 603.4
            // check-time predicate) — mirrors Thelon's Chant.
            condition: (event, _self, state) => {
                if (event.type !== "PERMANENT_ENTERED") return false;
                for (const p of state?.players ?? []) {
                    const perm = p.battlefield.find(
                        (c) => c.id === event.instanceId
                    );
                    if (perm) return perm.subtypes.includes("Forest");
                }
                return false;
            },
            resolve: (ctx, event, entered) => {
                if (event.type !== "PERMANENT_ENTERED") return;
                const player = entered.controllerId;
                const creatures = ctx.getBattlefieldIds(player, {
                    types: "Creature",
                });
                if (creatures.length === 0) {
                    ctx.dealDamage({ type: "player", id: player }, 3);
                    return;
                }
                const picks = ctx.requestChoice({
                    playerId: player,
                    choiceId: `tourachs-chant-counter-${event.instanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: player,
                    filter: { types: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Put a -1/-1 counter on a creature you control, or take 3 damage from Tourach's Chant.",
                });
                if (picks === undefined) return; // suspended
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

// Tourach's Gate — {1}{B}{B} Aura — Enchant land you control. "Sacrifice a
// Thrull: Put three time counters on this Aura."; "At the beginning of your
// upkeep, remove a time counter from this Aura. If there are no time counters on
// this Aura, sacrifice it."; "Tap enchanted land: Attacking creatures you control
// get +2/-1 until end of turn. Activate only if enchanted land is untapped."
// (CR 303.4 Aura on a land; CR 122 time counters; typed-sac cost adds counters;
// upkeep counter-removal-or-sacrifice; the tap-the-host activation cost pumps the
// attacking team.)
export const tourachsGate: CardDefinition = {
    id: "d77f6401-a9fb-449c-b511-6fb837055bb4", // FEM 48
    rarity: "rare",
    name: "Tourach's Gate",
    oracleText:
        "Enchant land you control\nSacrifice a Thrull: Put three time counters on this Aura.\nAt the beginning of your upkeep, remove a time counter from this Aura. If there are no time counters on this Aura, sacrifice it.\nTap enchanted land: Attacking creatures you control get +2/-1 until end of turn. Activate only if enchanted land is untapped.",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Land",
        count: 1,
        controller: "you",
    },
    triggeredAbilities: [
        phaseTrigger({
            id: "tourachs-gate-upkeep",
            phase: "UPKEEP",
            scope: "your",
            oracleText:
                "At the beginning of your upkeep, remove a time counter from this Aura. If there are no time counters on this Aura, sacrifice it.",
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.removeCounter(self, "time", 1);
                const remaining = ctx.getCounterCount(self, "time");
                if (remaining <= 0) ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "tourachs-gate-add-time",
            oracleText:
                "Sacrifice a Thrull: Put three time counters on this Aura.",
            cost: { sacrificeFilter: { subtypes: ["Thrull"] } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "time",
                    3
                );
            },
        },
        {
            id: "tourachs-gate-pump",
            oracleText:
                "Tap enchanted land: Attacking creatures you control get +2/-1 until end of turn. Activate only if enchanted land is untapped.",
            // FAITHFUL-TEXT NOTE: the engine has no "tap the enchanted host" as
            // a first-class activation cost. The "tap enchanted land" cost is
            // gated for legality via `canActivate` (host must be untapped) and
            // paid by tapping the host inside resolve (CR 602.1 — functionally
            // equivalent: the host is untapped at activation and tapped as the
            // ability resolves).
            cost: {},
            useStack: true,
            canActivate: (source, state) => {
                const hostId = source.attachedTo;
                if (!hostId) return false;
                for (const p of state.players) {
                    const host = p.battlefield.find((c) => c.id === hostId);
                    if (host) return !host.isTapped;
                }
                return false;
            },
            resolve: (ctx: SpellContext) => {
                // Pay the "tap enchanted land" cost (CR 602.1).
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.tap({ type: "permanent", id: hostId });
                for (const id of ctx.getBattlefieldIds(ctx.controller, {
                    types: "Creature",
                })) {
                    if (ctx.getIsAttacking(id)) {
                        ctx.addTemporaryPTBuff(
                            { type: "permanent", id },
                            2,
                            -1,
                            { phase: "end-of-turn" }
                        );
                    }
                }
            },
        },
    ],
};
