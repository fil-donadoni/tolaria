// Fallen Empires (FEM), split by colour per ADR 0043. The 1994 faction-war
// expansion (102 unique cards, 187 prints across its multi-art commons). Every
// in-scope card is a new CardDefinition — FEM has zero reprints of
// already-implemented cards (ADR 0014); its signature multi-artwork commons
// ship as ONE shared CardDefinition plus one CardPrint per extra artwork, all
// setCode "fem", all resolving to the single definition. Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {1}{U} → { X: 1, U: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    CardDefinition,
    CardPrint,
    SpellContext,
    TokenSpec,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { payOrSacrificeUpkeepTrigger } from "../leg";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

const THALLID_ID = "4caaf31b-86a9-485b-8da7-d5b526ed1233"; // FEM 74a (canonical art)

// Shared by every Saproling-producing FEM card (Thallid, Thallid Devourer,
// Elvish Farmer, Night Soil) — Scryfall links the SAME printed Saproling
// token (10E art) to all of them, so one lookup covers the whole engine.
const SAPROLING_TOKEN: TokenSpec = {
    name: "Saproling",
    types: ["Creature"],
    subtypes: ["Saproling"],
    power: 1,
    toughness: 1,
    colors: ["G"],
    imagePrintId: tokenPrintIdFor(THALLID_ID, "Saproling"),
};

function sporeUpkeepTrigger(id: string) {
    return phaseTrigger({
        id,
        oracleText:
            "At the beginning of your upkeep, put a spore counter on this creature.",
        phase: "UPKEEP",
        scope: "your",
        // CR 122 (issue #841) — put one spore counter on the source.
        effects: [
            {
                op: "counters",
                action: "add",
                counter: "spore",
                target: { ref: "$source" },
                count: 1,
            },
        ],
    });
}

export const thallid: CardDefinition = {
    id: THALLID_ID,
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
            // Migrated resolve()→effects[] (ADR 0045, #847): create one 1/1
            // green Saproling token on the controller's battlefield (CR 111 /
            // 707.1).
            effects: [
                {
                    op: "createToken",
                    token: SAPROLING_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
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
            // Migrated resolve()→effects[] (ADR 0045, #847): create one 1/1
            // green Saproling token on the controller's battlefield (CR 111 /
            // 707.1).
            effects: [
                {
                    op: "createToken",
                    token: SAPROLING_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "thallid-devourer-devour",
            oracleText:
                "Sacrifice a Saproling: This creature gets +1/+2 until end of turn.",
            cost: { sacrificeFilter: { subtypes: ["Saproling"] } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

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
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
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
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

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
            // Migrated resolve()→effects[] (ADR 0045, #845): the "all-combat"
            // mode of preventDamage is a turn-scoped global Fog (CR 615).
            effects: [{ op: "preventDamage", mode: "all-combat" }],
        },
    ],
};

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
            // CR 122 (issue #841) — put one spore counter on the target Fungus.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "spore",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};

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
            // Migrated resolve()→effects[] (ADR 0045, #847): create one 1/1
            // green Saproling token on the controller's battlefield (CR 111 /
            // 707.1).
            effects: [
                {
                    op: "createToken",
                    token: SAPROLING_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "elvish-farmer-gain-life",
            oracleText: "Sacrifice a Saproling: You gain 2 life.",
            cost: { sacrificeFilter: { subtypes: ["Saproling"] } },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
};

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
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 0,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
            // NOT DSL-migratable (ADR 0045): built via the `enteredTrigger`
            // factory (no `effects[]` site), and the "3 damage unless they put a
            // -1/-1 counter" branch is a punisher choice whose target is the
            // punished player's own creature pick (`requestChoice`) — not a
            // covered object selector. Stays resolve().
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
            // NOT DSL-migratable (ADR 0045): an `each`-scoped phaseTrigger
            // (scoped player ≠ controller, so `effects` is disallowed) that
            // selects tapped BLUE creatures (no colour/tap-state filter on the
            // forEach selector) and runs a per-creature mayPay→untap loop over a
            // runtime candidate set.
            // Blocked on: non-"your" trigger effects + colour/tap filters + a
            // per-member mayPay iteration.
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
            // Migrated resolve()→effects[] (ADR 0045, #847): create one 1/1
            // green Saproling token on the controller's battlefield (CR 111 /
            // 707.1).
            effects: [
                {
                    op: "createToken",
                    token: SAPROLING_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
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
