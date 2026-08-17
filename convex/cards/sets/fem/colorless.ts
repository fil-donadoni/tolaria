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
            // NOT DSL-migratable (ADR 0045): the gainControl call lives in a
            // `delayedTriggers[]` body, and `DelayedTriggerDef` exposes only a
            // `resolve` closure — there is no `effects[]` site on the old-style
            // delayed-trigger definition to convert (the arming is already
            // declarative via `armsDelayedTriggerOnTap`). The gainControl Op
            // (#848) is COVERED, but it needs an effects[] site. Blocked on: an
            // effects[] site on DelayedTriggerDef — stays resolve().
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
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-2
            // shield on the announced "any" target (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
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
            // Migrated resolve()→effects[] (ADR 0045, issue #1264): CR 121.1
            // draw 2, then CR 401.4 put 1 card from hand on top via `putBack`
            // (same shape as Brainstorm, ice/blue.ts).
            effects: [
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "putBack",
                    player: "controller",
                    count: 1,
                    prompt: "Conch Horn: put a card from your hand on top of your library.",
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
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.19a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
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

// Delif's Cone — {0} Artifact. "{T}, Sacrifice this artifact: This turn, when
// target creature you control attacks and isn't blocked, you may gain life
// equal to its power. If you do, it assigns no combat damage this turn."
//
// The whole ability is the ARMED UNBLOCKED-ATTACK RIDER (CR 603.7a delayed
// trigger + CR 509.1h "attacks and isn't blocked"): resolving the ability puts
// nothing on the board — it schedules a `delayedTrigger` with the
// `attacks-unblocked` timing watching the announced creature. That watch fires
// on the creature's ATTACKER_UNBLOCKED event (emitted once per unblocked
// attacker when blockers are confirmed), at most once ("when", not
// "whenever"), and expires unfired at CLEANUP if the creature never attacked
// unblocked this turn (the "this turn" bound, CR 514.2).
//
// The Cone sacrifices ITSELF as a cost, so nothing of the source survives to
// fire time — which is exactly why the rider is a delayed trigger keyed to the
// creature (`watch`) rather than anything hanging off the artifact. `capture`
// carries the creature into the body; `runDelayedTriggerBody` re-snapshots it
// live at resolution (it is still on the battlefield, unlike a leave-watch),
// so `{ ref: "$c.power" }` reads its EFFECTIVE power (CR 613, counters and
// continuous effects included) at the moment the trigger resolves — no
// power-valued `EffectValue` member needed.
//
// "you may … If you do" is the cost-free `mayPay` decision (CR 117.3a, the
// Squee/Sylvan Library shape): declining leaves BOTH halves undone, so the
// life gain and the damage suppression sit together inside the `if` branch —
// gaining the life is what pays for the creature dealing no combat damage.
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
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "attacks-unblocked",
                    oracleText:
                        "When that creature attacks and isn't blocked this turn, you may gain life equal to its power. If you do, it assigns no combat damage this turn.",
                    watch: { target: 0 },
                    capture: { $c: { target: 0 } },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Gain life equal to that creature's power (Delif's Cone)? If you do, it assigns no combat damage this turn.",
                            bind: "$gain",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$gain" },
                            then: [
                                {
                                    op: "gainLife",
                                    player: "controller",
                                    amount: { ref: "$c.power" },
                                },
                                {
                                    op: "markAssignsNoCombatDamage",
                                    target: { ref: "$c" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// Delif's Cube — {1} Artifact. Delif's Cone's repeatable sibling: the same
// armed unblocked-attack rider (CR 603.7a delayed trigger + CR 509.1h), but
// mandatory instead of optional, and it FEEDS the artifact rather than the
// controller — each firing puts a cube counter on the Cube, which the second
// ability spends to regenerate. The Cube is NOT sacrificed to arm, so it is
// still on the battlefield at fire time and rides into the body as a second
// capture (`$cube`); `$source` is deliberately invisible inside a delayed body
// (ADR 0048), so the artifact must be captured explicitly like any other datum.
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
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "attacks-unblocked",
                    oracleText:
                        "When that creature attacks and isn't blocked this turn, it assigns no combat damage this turn and you put a cube counter on Delif's Cube.",
                    watch: { target: 0 },
                    capture: {
                        $c: { target: 0 },
                        $cube: { ref: "$source" },
                    },
                    effects: [
                        {
                            op: "markAssignsNoCombatDamage",
                            target: { ref: "$c" },
                        },
                        {
                            op: "counters",
                            action: "add",
                            counter: "cube",
                            target: { ref: "$cube" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
        {
            id: "delifs-cube-regen",
            oracleText:
                "{2}, Remove a cube counter from this artifact: Regenerate target creature.",
            cost: { mana: { X: 2 }, removeCounter: { type: "cube", count: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.19a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
    ],
};
