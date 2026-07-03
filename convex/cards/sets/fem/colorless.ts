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
    Color,
    ManaCost,
    SpellContext,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

function makeSacrificeLand(config: {
    id: string;
    name: string;
    color: Color;
}): CardDefinition {
    const { id, name, color } = config;
    const sym = `{${color}}`;
    return {
        id,
        name,
        rarity: "uncommon",
        oracleText: `This land enters tapped.\n{T}: Add ${sym}.\n{T}, Sacrifice this land: Add ${sym}${sym}.`,
        manaCost: { X: 0 },
        types: ["Land"],
        entersTapped: true,
        activatedAbilities: [
            {
                id: "sac-land-mana",
                oracleText: `{T}: Add ${sym}.`,
                cost: { tap: true },
                useStack: false,
                manaProduced: { [color]: 1 } as ManaCost,
            },
            {
                id: "sac-land-sacrifice",
                oracleText: `{T}, Sacrifice this land: Add ${sym}${sym}.`,
                cost: { tap: true, sacrifice: true },
                useStack: false,
                manaProduced: { [color]: 2 } as ManaCost,
            },
        ],
    };
}

export const ruinsOfTrokair: CardDefinition = makeSacrificeLand({
    id: "4ce2e734-8cff-4bfe-85f8-17b3e1903f18", // FEM 100
    name: "Ruins of Trokair",
    color: "W",
});

export const svyeluniteTemple: CardDefinition = makeSacrificeLand({
    id: "8b3fde62-ab21-459b-9c5d-01aa6fe1d08e", // FEM 102
    name: "Svyelunite Temple",
    color: "U",
});

export const ebonStronghold: CardDefinition = makeSacrificeLand({
    id: "3fb2a11f-a8e4-4acf-871a-11171e3304ef", // FEM 95
    name: "Ebon Stronghold",
    color: "B",
});

export const dwarvenRuins: CardDefinition = makeSacrificeLand({
    id: "0dfe1352-27be-4c99-a58f-b961f911f270", // FEM 94
    name: "Dwarven Ruins",
    color: "R",
});

export const havenwoodBattleground: CardDefinition = makeSacrificeLand({
    id: "9028f200-80dd-4c53-877f-ea380ff417cb", // FEM 96
    name: "Havenwood Battleground",
    color: "G",
});

function makeStorageLand(config: {
    id: string;
    name: string;
    color: Color;
}): CardDefinition {
    const { id, name, color } = config;
    const sym = `{${color}}`;
    return {
        id,
        name,
        rarity: "uncommon",
        oracleText:
            `This land enters tapped.\n` +
            `You may choose not to untap this land during your untap step.\n` +
            `At the beginning of your upkeep, if this land is tapped, put a storage counter on it.\n` +
            `{T}, Remove any number of storage counters from this land: Add ${sym} for each storage counter removed this way.`,
        manaCost: { X: 0 },
        types: ["Land"],
        entersTapped: true,
        staticAbilities: ["may-choose-not-to-untap"],
        triggeredAbilities: [
            phaseTrigger({
                id: "storage-land-upkeep",
                phase: "UPKEEP",
                scope: "your",
                oracleText:
                    "At the beginning of your upkeep, if this land is tapped, put a storage counter on it.",
                // CR 603.4 intervening-if: only banks while the land is tapped.
                condition: (_event, self) => self.isTapped === true,
                // CR 122 (issue #841) — put one storage counter on the source.
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "storage",
                        target: { ref: "$source" },
                        count: 1,
                    },
                ],
            }),
        ],
        activatedAbilities: [
            {
                id: "storage-land-mana",
                oracleText: `{T}, Remove any number of storage counters from this land: Add ${sym} for each storage counter removed this way.`,
                cost: { tap: true },
                useStack: false,
                // Representative / fallback (no board snapshot): 0 counters → 0
                // mana. `getManaChoices` is what the player actually picks from.
                manaChoices: [{ [color]: 0 } as ManaCost],
                // CR 122.6 / 605.1a — index N = "remove N storage counters, add N
                // mana of this land's colour". With `available` counters the
                // chooser offers N = 0..available, i.e. 0..available mana.
                getManaChoices: (source) => {
                    const available = source.counters?.storage ?? 0;
                    const out: ManaCost[] = [];
                    for (let n = 0; n <= available; n++) {
                        out.push({ [color]: n } as ManaCost);
                    }
                    return out;
                },
                // The chosen index N is the number of `storage` counters removed
                // to pay the scaling cost (CR 122.6), restored on untap.
                manaChoiceRemovesCounters: "storage",
            },
        ],
    };
}

export const icatianStore: CardDefinition = makeStorageLand({
    id: "d7cd8d8c-52c7-402f-92e1-5e5866f2555a", // FEM 98
    name: "Icatian Store",
    color: "W",
});

export const sandSilos: CardDefinition = makeStorageLand({
    id: "3f6f1fcb-d903-4a31-abab-40488569eef6", // FEM 101
    name: "Sand Silos",
    color: "U",
});

export const bottomlessVault: CardDefinition = makeStorageLand({
    id: "639ae988-d1d1-4ead-b0f8-47fc39eb64a0", // FEM 92
    name: "Bottomless Vault",
    color: "B",
});

export const dwarvenHold: CardDefinition = makeStorageLand({
    id: "a3142ded-ff62-4817-aa54-75a7ea4498a6", // FEM 93
    name: "Dwarven Hold",
    color: "R",
});

export const hollowTrees: CardDefinition = makeStorageLand({
    id: "90845410-e09a-4753-ad4c-bf2b2f3c95ac", // FEM 97
    name: "Hollow Trees",
    color: "G",
});

export const rainbowVale: CardDefinition = {
    id: "c1b138e1-f8fc-435c-9aed-98004768479c", // FEM 99
    rarity: "rare",
    name: "Rainbow Vale",
    oracleText:
        "{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step.",
    manaCost: { X: 0 },
    types: ["Land"],
    activatedAbilities: [
        {
            id: "rainbow-vale-mana",
            oracleText:
                "{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // ADR 0040 — arm the delayed control change when tapped for mana.
            armsDelayedTriggerOnTap: {
                triggerId: "rainbow-vale-handoff",
                timing: "next-end-step",
            },
        },
    ],
    delayedTriggers: [
        {
            id: "rainbow-vale-handoff",
            oracleText:
                "An opponent gains control of this land at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const sourceId = payload.sourceId;
                if (!sourceId) return;
                // CR 800.4 / PRD §Out of Scope — 2-player: "an opponent" is the
                // single opponent of the trigger's controller (the activator).
                const opponent = ctx.allPlayerIds.find(
                    (id) => id !== ctx.controller
                );
                if (!opponent) return;
                // CR 613.1b — indefinite control change (no condition), the
                // Ghazbán Ogre shape. Reverts only when the next handoff fires.
                ctx.gainControl({ type: "permanent", id: sourceId }, opponent);
            },
        },
    ],
};

export const implementsOfSacrifice: CardDefinition = {
    id: "aa5deb95-79a6-4398-b82a-c1df169550d9", // FEM 88
    rarity: "common",
    name: "Implements of Sacrifice",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Add two mana of any one color.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "implements-mana",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Add two mana of any one color.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: false,
            manaChoices: [{ W: 2 }, { U: 2 }, { B: 2 }, { R: 2 }, { G: 2 }],
        },
    ],
};

export const spiritShield: CardDefinition = {
    id: "213d6e0d-5ec9-441e-a38d-50ce44583e4b", // FEM 90
    rarity: "common",
    name: "Spirit Shield",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{2}, {T}: Target creature gets +0/+2 for as long as this artifact remains tapped.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "spirit-shield-buff",
            oracleText:
                "{2}, {T}: Target creature gets +0/+2 for as long as this artifact remains tapped.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.addSourceTappedPTBuff(target, 0, 2);
            },
        },
    ],
};

export const zelyonSword: CardDefinition = {
    id: "4137160b-5248-4fbd-8ae8-25e9afd8fb5c", // FEM 91
    rarity: "rare",
    name: "Zelyon Sword",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{3}, {T}: Target creature gets +2/+0 for as long as this artifact remains tapped.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "zelyon-sword-buff",
            oracleText:
                "{3}, {T}: Target creature gets +2/+0 for as long as this artifact remains tapped.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.addSourceTappedPTBuff(target, 2, 0);
            },
        },
    ],
};

export const aeolipile: CardDefinition = {
    id: "a09030ee-415c-45af-bf08-7623197a314f", // FEM 81
    rarity: "common",
    name: "Aeolipile",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: It deals 2 damage to any target.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "aeolipile-damage",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: It deals 2 damage to any target.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

export const balmOfRestoration: CardDefinition = {
    id: "7f95de4a-7fae-42bc-9660-39ea7685ca02", // FEM 82
    rarity: "common",
    name: "Balm of Restoration",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Choose one —\n• You gain 2 life.\n• Prevent the next 2 damage that would be dealt to any target this turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "balm-gain-life",
            oracleText: "{1}, {T}, Sacrifice this artifact: You gain 2 life.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
        {
            id: "balm-prevent",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Prevent the next 2 damage that would be dealt to any target this turn.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.preventNextNDamageToTarget(target, 2, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

export const conchHorn: CardDefinition = {
    id: "860a9ba3-e4c4-4af9-bdfe-1ada39289fd5", // FEM 83
    rarity: "uncommon",
    name: "Conch Horn",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Draw two cards, then put a card from your hand on top of your library.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "conch-horn",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Draw two cards, then put a card from your hand on top of your library.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            resolveSteps: [
                (ctx: SpellContext) => {
                    ctx.drawCards(ctx.controller, 2);
                },
                (ctx: SpellContext) => {
                    const hand = ctx
                        .getHandCards(ctx.controller)
                        .map((c) => c.id);
                    if (hand.length === 0) return;
                    const picks = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: `conch-horn-${ctx.sourceInstanceId}`,
                        kind: "choose-hand-card",
                        zone: "hand",
                        candidateIds: hand,
                        count: 1,
                        prompt: "Conch Horn: put a card from your hand on top of your library.",
                    });
                    if (picks === undefined) return; // suspended
                    const cardId = picks[0];
                    if (!cardId) return;
                    ctx.moveHandCardToLibraryTop(ctx.controller, cardId);
                },
            ],
        },
    ],
};

export const draconianCylix: CardDefinition = {
    id: "a419c9e3-5615-44f9-9256-94a3022bb69f", // FEM 86
    rarity: "common",
    name: "Draconian Cylix",
    oracleText:
        "{2}, {T}, Discard a card at random: Regenerate target creature.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "draconian-cylix",
            oracleText:
                "{2}, {T}, Discard a card at random: Regenerate target creature.",
            cost: { mana: { X: 2 }, tap: true, discardAtRandom: 1 },
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

export const elvenLyre: CardDefinition = {
    id: "c3a8cd72-04c0-46f7-a249-f1cecddfdc26", // FEM 87
    rarity: "common",
    name: "Elven Lyre",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Target creature gets +2/+2 until end of turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "elven-lyre",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Target creature gets +2/+2 until end of turn.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
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

export const ringOfRenewal: CardDefinition = {
    id: "a532d38a-809b-4132-8690-be15fe23afab", // FEM 89
    rarity: "rare",
    name: "Ring of Renewal",
    oracleText: "{5}, {T}: Discard a card at random, then draw two cards.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ring-of-renewal",
            oracleText:
                "{5}, {T}: Discard a card at random, then draw two cards.",
            cost: { mana: { X: 5 }, tap: true, discardAtRandom: 1 },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 2 }],
        },
    ],
};

export const delifsCone: CardDefinition = {
    id: "262b8788-c5a0-4c8e-9d58-b769b1b0a2ff", // FEM 84
    rarity: "common",
    name: "Delif's Cone",
    oracleText:
        "{T}, Sacrifice this artifact: This turn, when target creature you control attacks and isn't blocked, you may gain life equal to its power. If you do, it assigns no combat damage this turn.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "delifs-cone",
            oracleText:
                "{T}, Sacrifice this artifact: This turn, when target creature you control attacks and isn't blocked, you may gain life equal to its power. If you do, it assigns no combat damage this turn.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: () => {
                // Deferred: arm-on-target unblocked-attack rider not yet built.
            },
        },
    ],
};

export const delifsCube: CardDefinition = {
    id: "14749600-9eca-4122-b04f-30ddda091b74", // FEM 85
    rarity: "uncommon",
    name: "Delif's Cube",
    oracleText:
        "{2}, {T}: This turn, when target creature you control attacks and isn't blocked, it assigns no combat damage this turn and you put a cube counter on this artifact.\n{2}, Remove a cube counter from this artifact: Regenerate target creature.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "delifs-cube-arm",
            oracleText:
                "{2}, {T}: This turn, when target creature you control attacks and isn't blocked, it assigns no combat damage this turn and you put a cube counter on this artifact.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: () => {
                // Deferred: arm-on-target unblocked-attack rider not yet built.
            },
        },
        {
            id: "delifs-cube-regen",
            oracleText:
                "{2}, Remove a cube counter from this artifact: Regenerate target creature.",
            cost: { mana: { X: 2 }, removeCounter: { type: "cube", count: 1 } },
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
