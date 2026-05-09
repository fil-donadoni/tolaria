import type {
    ActivatedAbilityContext,
    CardDefinition,
    PermanentFilter,
    SpellContext,
    TargetSelection,
} from "../types";
import {
    AURA_AFFECTS_HOST,
    EFFECT_AFFECTS_SELF,
    TARGET_ACL_PERMANENT,
} from "../types";
import {
    knightStaticAbilities,
    makeDualLand,
    makeTapForMana,
} from "../abilities";

// export const animateWall: CardDefinition = {
//     id: "d5c83259-9b90-47c2-b48e-c7d78519e792",
//     name: "Animate Wall",
//     manaCost: { W: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const armageddon: CardDefinition = {
    id: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb",
    name: "Armageddon",
    manaCost: { X: 3, W: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Land");
    },
};

// Balance — "Each player chooses a number of lands they control equal to the
// number of lands controlled by the player who controls the fewest, then
// sacrifices the rest. Players discard cards and sacrifice creatures the same
// way." (CR 608.2, 101.4 APNAP, 701.16 sacrifice, 701.8 discard)
//
// Ruling (2016-06-08): the order is lands → discard → creatures, each step
// applied simultaneously after all players have chosen. Counts are sampled
// fresh at the start of each step — a creature-land sacrificed in step 1 is
// not counted as a creature in step 3. Within a step, choices are collected
// APNAP; each chooser sees the prior choices before deciding (except for
// hands, which reveal only after all have chosen — naturally modelled here
// because we apply the discard only after both picks are collected).

/** Generic "each player keeps `min` permanents matching `filter`" step. Used
 *  by both the lands and creatures passes of Balance. Idempotent across
 *  replays: after a suspension, `requestChoice` returns stored picks so the
 *  apply phase runs exactly once per step completion. */
function balanceEqualizeBattlefield(
    ctx: SpellContext,
    filter: PermanentFilter,
    label: { singular: string; plural: string }
): void {
    const players = ctx.apNapOrder();
    const counts = players.map((p) => ctx.getBattlefieldIds(p, filter).length);
    const min = Math.min(...counts);

    const keepByPlayer: Record<string, string[] | undefined> = {};
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const n = counts[i];
        if (n <= min) {
            keepByPlayer[p] = ctx.getBattlefieldIds(p, filter);
            continue;
        }
        if (min === 0) {
            keepByPlayer[p] = [];
            continue;
        }
        keepByPlayer[p] = ctx.requestChoice({
            playerId: p,
            choiceId: p,
            kind: "keep-permanents",
            zone: "battlefield",
            filter,
            count: min,
            prompt:
                min === 1
                    ? `Choose the ${label.singular} to keep`
                    : `Choose ${min} ${label.plural} to keep`,
        });
    }

    // One or more choices still pending — engine will suspend after return.
    if (Object.values(keepByPlayer).some((v) => v === undefined)) return;

    // All picks collected — sacrifice the non-chosen permanents simultaneously.
    for (const p of players) {
        const keep = new Set(keepByPlayer[p]);
        for (const id of ctx.getBattlefieldIds(p, filter)) {
            if (!keep.has(id)) ctx.sacrifice(id);
        }
    }
}

function balanceEqualizeLands(ctx: SpellContext): void {
    balanceEqualizeBattlefield(
        ctx,
        { types: "Land" },
        { singular: "land", plural: "lands" }
    );
}

function balanceEqualizeCreatures(ctx: SpellContext): void {
    balanceEqualizeBattlefield(
        ctx,
        { types: "Creature" },
        { singular: "creature", plural: "creatures" }
    );
}

function balanceEqualizeHand(ctx: SpellContext): void {
    const players = ctx.apNapOrder();
    const counts = players.map((p) => ctx.getHandSize(p));
    const min = Math.min(...counts);

    const keepByPlayer: Record<string, string[] | undefined> = {};
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const n = counts[i];
        if (n <= min) {
            keepByPlayer[p] = ctx.getHandIds(p);
            continue;
        }
        if (min === 0) {
            keepByPlayer[p] = [];
            continue;
        }
        keepByPlayer[p] = ctx.requestChoice({
            playerId: p,
            choiceId: p,
            kind: "keep-hand",
            zone: "hand",
            count: min,
            prompt:
                min === 1
                    ? `Choose 1 card to keep`
                    : `Choose ${min} cards to keep`,
        });
    }

    if (Object.values(keepByPlayer).some((v) => v === undefined)) return;

    for (const p of players) {
        const keep = new Set(keepByPlayer[p]);
        for (const id of ctx.getHandIds(p)) {
            if (!keep.has(id)) ctx.discardCard(p, id);
        }
    }
}

export const balance: CardDefinition = {
    id: "6f9ea46a-411f-40ce-a873-a905180093f4",
    name: "Balance",
    manaCost: { X: 1, W: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        balanceEqualizeLands,
        balanceEqualizeHand,
        balanceEqualizeCreatures,
    ],
};

// export const benalishHero: CardDefinition = {
//     id: "11600105-56c6-4073-a4a6-8469030b39c9",
//     name: "Benalish Hero",
//     manaCost: { W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Soldier"],
//     power: 1,
//     toughness: 1,
// };

export const blackWard: CardDefinition = makeColorWard({
    id: "15967a39-303f-457d-bcde-51837c8d63e1",
    name: "Black Ward",
    color: "black",
});

// export const blazeOfGlory: CardDefinition = {
//     id: "98fba951-c5bb-497c-9292-ce1b2a1e1247",
//     name: "Blaze of Glory",
//     manaCost: { W: 1 },
//     types: ["Instant"],
// };

// export const blessing: CardDefinition = {
//     id: "f131fd27-18da-47ca-b59f-135bcac83abd",
//     name: "Blessing",
//     manaCost: { W: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const blueWard: CardDefinition = makeColorWard({
    id: "93f9f0f2-e1cc-4740-888c-1336c6de0a27",
    name: "Blue Ward",
    color: "blue",
});

// Castle — "Untapped creatures you control get +0/+2." (CR 611, 613 — static layer 7c)
export const castle: CardDefinition = {
    id: "b0da8d56-3178-44c2-9344-95d2346d326f",
    name: "Castle",
    manaCost: { X: 3, W: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId &&
                !target.isTapped,
            power: 0,
            toughness: 2,
        },
    ],
};

// Circle of Protection — "{1}: The next time a source of your choice of
// [color] would deal damage to you this turn, prevent that damage." The
// four CoPs share identical behavior modulo the color filter (CR 615.1,
// 615.6). We build them from one factory to keep the colored choice local.
function makeCircleOfProtection(args: {
    id: string;
    name: string;
    color: "U" | "G" | "R" | "W";
    colorWord: string;
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        manaCost: { X: 1, W: 1 },
        types: ["Enchantment"],
        activatedAbilities: [
            {
                id: "cop-prevent",
                oracleText: `{1}: The next time a ${args.colorWord.toLowerCase()} source of your choice would deal damage to you this turn, prevent that damage.`,
                cost: { mana: { X: 1 } },
                useStack: true,
                targetRequirement: {
                    type: ["any", "spell"],
                    count: 1,
                    colorFilter: args.color,
                },
                resolve: (ctx: SpellContext) => {
                    const [target] = ctx.targets;
                    if (!target) return;
                    if (target.type === "player") return; // no color
                    ctx.preventNextDamageFromSource(target.id, ctx.controller, {
                        phase: "end-of-turn",
                    });
                },
            },
        ],
    };
}

export const circleOfProtectionBlue: CardDefinition = makeCircleOfProtection({
    id: "848b1a7f-e8ba-40b5-92b7-af1e963a0319",
    name: "Circle of Protection: Blue",
    color: "U",
    colorWord: "Blue",
});

export const circleOfProtectionGreen: CardDefinition = makeCircleOfProtection({
    id: "1ae32d20-b438-4f43-b603-e8f706ecfb03",
    name: "Circle of Protection: Green",
    color: "G",
    colorWord: "Green",
});

export const circleOfProtectionRed: CardDefinition = makeCircleOfProtection({
    id: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e",
    name: "Circle of Protection: Red",
    color: "R",
    colorWord: "Red",
});

export const circleOfProtectionWhite: CardDefinition = makeCircleOfProtection({
    id: "92df19c9-e127-42d9-8dd2-7fa5a7095428",
    name: "Circle of Protection: White",
    color: "W",
    colorWord: "White",
});

// Consecrate Land — "Enchant land. Enchanted land is indestructible. Prevent
// all damage that would be dealt to enchanted land." (CR 303.4 aura attachment,
// 702.12 indestructible keyword). The damage-prevention clause is innocuous in
// the current engine — lands are not damageable targets — so the implementation
// reduces to a `keyword-grant: "indestructible"` static effect on the host.
export const consecrateLand: CardDefinition = {
    id: "d2379f78-c03f-447f-b3c9-10a918d556e9",
    name: "Consecrate Land",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "indestructible",
        },
    ],
};

// export const conversion: CardDefinition = {
//     id: "13186bc9-8d9c-433b-ba15-121ef94dd68a",
//     name: "Conversion",
//     manaCost: { X: 2, W: 2 },
//     types: ["Enchantment"],
// };

// Crusade — "White creatures get +1/+1." (CR 611 — static layer 7c, color via
// CR 202.2). Mirrors Bad Moon's structure but filtered on white instead of
// black. Affects creatures of either controller.
export const crusade: CardDefinition = {
    id: "057986c7-20c0-4157-b4df-beae4ef5c66d",
    name: "Crusade",
    manaCost: { W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("W"),
            power: 1,
            toughness: 1,
        },
    ],
};

// Death Ward — "Regenerate target creature." (CR 701.15a regenerate, 614.5
// destroy replacement). Stacks one regen shield on the target via the same
// primitive used by Regeneration's activated ability — consumed by the next
// destroy attempt, expiring at CLEANUP if unused (CR 514.2).
export const deathWard: CardDefinition = {
    id: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13",
    name: "Death Ward",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") ctx.applyRegenerationShield(target);
    },
};

export const disenchant: CardDefinition = {
    id: "2722d7e2-61c6-4934-9c21-875ee78fd06c",
    name: "Disenchant",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    effect: "destroy-target",
};

// Farmstead — "Enchant land (target a Plains). At the beginning of the upkeep
// step of enchanted land's controller, that player gains 2 life." (CR 303.4
// aura attachment, 603.6a beginning-of-step trigger). The trigger fires only
// on the host's controller's upkeep; the resolver looks up the host via
// `getAttachedTo` (no targeting at trigger time per CR 603.2) and reads its
// current controller — so a Farmstead whose host has changed controllers
// (Control Magic, etc.) follows the new controller automatically.
export const farmstead: CardDefinition = {
    id: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf",
    name: "Farmstead",
    manaCost: { W: 3 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Land",
        count: 1,
        subtypeFilter: "Plains",
    },
    triggeredAbilities: [
        {
            id: "farmstead-upkeep",
            oracleText:
                "At the beginning of the upkeep step of enchanted land's controller, that player gains 2 life.",
            event: "PHASE_BEGIN",
            matches: (event, self, state) => {
                if (event.type !== "PHASE_BEGIN") return false;
                if (event.phase !== "UPKEEP") return false;
                if (!self.attachedTo) return false;
                for (const p of state?.players ?? []) {
                    const host = p.battlefield.find(
                        (c) => c.id === self.attachedTo
                    );
                    if (host) return host.controllerId === event.activePlayerId;
                }
                return false;
            },
            resolve: (ctx) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                const controller = ctx.getController({
                    type: "permanent",
                    id: hostId,
                });
                ctx.gainLife(controller, 2);
            },
        },
    ],
};

export const greenWard: CardDefinition = makeColorWard({
    id: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e",
    name: "Green Ward",
    color: "green",
});

// export const guardianAngel: CardDefinition = {
//     id: "0f84d676-5327-454c-a033-b4498a9d28e2",
//     name: "Guardian Angel",
//     manaCost: { X: "X", W: 1 },
//     types: ["Instant"],
// };

// export const healingSalve: CardDefinition = {
//     id: "e28de37e-84d5-4dc7-b36c-e14da5924729",
//     name: "Healing Salve",
//     manaCost: { W: 1 },
//     types: ["Instant"],
// };

// export const holyArmor: CardDefinition = {
//     id: "b01041d2-687e-4972-81c8-16690809275b",
//     name: "Holy Armor",
//     manaCost: { W: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// Holy Strength — "Enchant creature. Enchanted creature gets +1/+2." (CR 303.4
// aura attachment, 611 static layer 7c). Plain pt-buff aura — same shape as
// the future Unholy Strength / Weakness, all reusing AURA_AFFECTS_HOST.
export const holyStrength: CardDefinition = {
    id: "e945a4cd-0eb1-4f54-898d-169ce2748a03",
    name: "Holy Strength",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: 2,
        },
    ],
};

// export const islandSanctuary: CardDefinition = {
//     id: "c15e8a42-89de-42bc-8d5f-33426d207c3a",
//     name: "Island Sanctuary",
//     manaCost: { X: 1, W: 1 },
//     types: ["Enchantment"],
// };

// Karma — "At the beginning of each player's upkeep, Karma deals damage to
// that player equal to the number of Swamps they control." (CR 603.6a phase
// trigger, 120.1 damage). Fires on every player's UPKEEP — the active player
// at trigger time is the one taking the damage, not Karma's controller.
export const karma: CardDefinition = {
    id: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4",
    name: "Karma",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "karma-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, Karma deals damage to that player equal to the number of Swamps they control.",
            event: "PHASE_BEGIN",
            matches: (event) =>
                event.type === "PHASE_BEGIN" && event.phase === "UPKEEP",
            resolve: (ctx, event) => {
                if (event.type !== "PHASE_BEGIN") return;
                const playerId = event.activePlayerId;
                const swamps = ctx.getBattlefieldIds(playerId, {
                    subtypes: "Swamp",
                }).length;
                if (swamps > 0) {
                    ctx.dealDamage({ type: "player", id: playerId }, swamps);
                }
            },
        },
    ],
};

// Lance — "Enchant creature. Enchanted creature has first strike." (CR 303.4
// aura attachment, 702.7 first strike, 611.2 keyword grant via static effect).
export const lance: CardDefinition = {
    id: "ddb633f5-cc4d-4157-8217-def90cb15e24",
    name: "Lance",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
    ],
};

// export const mesaPegasus: CardDefinition = {
//     id: "eaac88da-d19e-4771-944c-3709963d04e7",
//     name: "Mesa Pegasus",
//     manaCost: { X: 1, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Pegasus"],
//     power: 1,
//     toughness: 1,
// };

// export const northernPaladin: CardDefinition = {
//     id: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2",
//     name: "Northern Paladin",
//     manaCost: { X: 2, W: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Knight"],
//     power: 3,
//     toughness: 3,
// };

export const pearledUnicorn: CardDefinition = {
    id: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8",
    name: "Pearled Unicorn",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Unicorn"],
    power: 2,
    toughness: 2,
};

// export const personalIncarnation: CardDefinition = {
//     id: "caf9cef4-0f2d-478a-b119-fe1967687f74",
//     name: "Personal Incarnation",
//     manaCost: { X: 3, W: 3 },
//     types: ["Creature"],
//     subtypes: ["Avatar", "Incarnation"],
//     power: 6,
//     toughness: 6,
// };

// export const purelace: CardDefinition = {
//     id: "2facf462-55cd-4da4-997f-2cf4add75628",
//     name: "Purelace",
//     manaCost: { W: 1 },
//     types: ["Instant"],
// };

// Color Ward cycle — {W} Enchant creature; enchanted creature has protection
// from <color>. All five wards are structurally identical (white-costed
// auras, CR 611.2 keyword grant). They all carry the 702.16n rider "This
// effect doesn't remove this Aura" — load-bearing only for White Ward,
// where aura-color (W) matches granted protection (pro-white) and 702.16c
// would otherwise detach the aura. The other four are safe either way, but
// we set the flag faithfully to the oracle text.
function makeColorWard(args: {
    id: string;
    name: string;
    color: "white" | "blue" | "black" | "red" | "green";
}): CardDefinition {
    const keyword = `protection from ${args.color}`;
    return {
        id: args.id,
        name: args.name,
        manaCost: { W: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
        targetRequirement: { type: "Creature", count: 1 },
        staticEffects: [
            {
                kind: "keyword-grant",
                applies: AURA_AFFECTS_HOST,
                keyword,
            },
        ],
        exemptFromProtectionDetach: true,
    };
}

export const redWard: CardDefinition = makeColorWard({
    id: "e0c64c01-c2aa-470b-88c6-3d3e4a969649",
    name: "Red Ward",
    color: "red",
});

// export const resurrection: CardDefinition = {
//     id: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c",
//     name: "Resurrection",
//     manaCost: { X: 2, W: 2 },
//     types: ["Sorcery"],
// };

// export const reverseDamage: CardDefinition = {
//     id: "943baea8-b173-4863-a3ab-dd217d483cd9",
//     name: "Reverse Damage",
//     manaCost: { X: 1, W: 2 },
//     types: ["Instant"],
// };

// export const righteousness: CardDefinition = {
//     id: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb",
//     name: "Righteousness",
//     manaCost: { W: 1 },
//     types: ["Instant"],
// };

// export const samiteHealer: CardDefinition = {
//     id: "efba235e-04e5-449c-906c-0ac33f6d7929",
//     name: "Samite Healer",
//     manaCost: { X: 1, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Cleric"],
//     power: 1,
//     toughness: 1,
// };

export const savannahLions: CardDefinition = {
    id: "d05b92bd-797e-413f-a8b0-32e0937a1ee0",
    name: "Savannah Lions",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 1,
};

export const serraAngel: CardDefinition = {
    id: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    name: "Serra Angel",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying", "vigilance"],
};

export const swordsToPlowshares: CardDefinition = {
    id: "386ea9eb-abc1-4862-aa2d-8fb808d79490",
    name: "Swords to Plowshares",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const power = ctx.getPower(ctx.targets[0]);
        const controller = ctx.getController(ctx.targets[0]);
        ctx.exile(ctx.targets[0]);
        ctx.gainLife(controller, power);
    },
};

// export const veteranBodyguard: CardDefinition = {
//     id: "cbd9ab01-a833-4fa4-8dee-151bd9800835",
//     name: "Veteran Bodyguard",
//     manaCost: { X: 3, W: 2 },
//     types: ["Creature"],
//     subtypes: ["Human"],
//     power: 2,
//     toughness: 5,
// };

export const wallOfSwords: CardDefinition = {
    id: "99ec4723-b36c-4015-b361-736a6523e8f5",
    name: "Wall of Swords",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 3,
    toughness: 5,
    staticAbilities: ["defender", "flying"],
};

// White Knight — first strike + protection from black (CR 702.7, 702.16).
export const whiteKnight: CardDefinition = {
    id: "50abfba8-c9f9-4ebf-965a-4b425fe83129",
    name: "White Knight",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: knightStaticAbilities("black"),
};

export const whiteWard: CardDefinition = makeColorWard({
    id: "49b22665-1501-420a-82ad-f71f6768bcf8",
    name: "White Ward",
    color: "white",
});

export const wrathOfGod: CardDefinition = {
    id: "a2788d69-6a3a-42f0-8736-cc6b57755ecd",
    name: "Wrath of God",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Creature");
    },
};

export const airElemental: CardDefinition = {
    id: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea",
    name: "Air Elemental",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
};

// Ancestral Recall — "Target player draws three cards." (CR 121.1)
export const ancestralRecall: CardDefinition = {
    id: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b",
    name: "Ancestral Recall",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") ctx.drawCards(target.id, 3);
    },
};

// export const animateArtifact: CardDefinition = {
//     id: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357",
//     name: "Animate Artifact",
//     manaCost: { X: 3, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const blueElementalBlast: CardDefinition = {
//     id: "20d666ef-39bf-4fbf-8201-5f1056539da2",
//     name: "Blue Elemental Blast",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

// Braingeyser — "Target player draws X cards." (CR 107.3 X cost, 121.1 draw,
// 601.2b X chosen on cast, 608.3 sorcery resolution).
export const braingeyser: CardDefinition = {
    id: "62b19a12-6914-430e-81ce-dcfca47884df",
    name: "Braingeyser",
    manaCost: { X: "X", U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") ctx.drawCards(target.id, ctx.getX());
    },
};

// export const clone: CardDefinition = {
//     id: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3",
//     name: "Clone",
//     manaCost: { X: 3, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Shapeshifter"],
//     power: 0,
//     toughness: 0,
// };

// Control Magic — "Enchant creature. You control enchanted creature."
// (CR 303.4 aura attachment, 611.2 continuous static ability, 613.1b layer 2
// control-changing effect, 702.10c summoning sickness reset on control change)
export const controlMagic: CardDefinition = {
    id: "7b52f459-c703-4a0b-9114-ff69eec61287",
    name: "Control Magic",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "control-change",
            applies: AURA_AFFECTS_HOST,
        },
    ],
};

// export const copyArtifact: CardDefinition = {
//     id: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063",
//     name: "Copy Artifact",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
// };

// Counterspell — "Counter target spell." (CR 701.5a)
export const counterspell: CardDefinition = {
    id: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    name: "Counterspell",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "spell") ctx.counter(target);
    },
};

// export const creatureBond: CardDefinition = {
//     id: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c",
//     name: "Creature Bond",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const drainPower: CardDefinition = {
//     id: "ea3830c5-cc66-453e-9e53-0636e00ee0ee",
//     name: "Drain Power",
//     manaCost: { U: 2 },
//     types: ["Sorcery"],
// };

// export const feedback: CardDefinition = {
//     id: "0eb8f591-d763-49bf-8ef9-86265aaa72f7",
//     name: "Feedback",
//     manaCost: { X: 2, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const flight: CardDefinition = {
//     id: "67c7784b-6b79-4268-a714-895c82809aff",
//     name: "Flight",
//     manaCost: { U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const invisibility: CardDefinition = {
//     id: "1858ac51-e6a7-48d7-8759-166070ca13d8",
//     name: "Invisibility",
//     manaCost: { U: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const jump: CardDefinition = {
//     id: "cb3f4b11-ad1b-48e2-a500-787d351b0174",
//     name: "Jump",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

// export const lifetap: CardDefinition = {
//     id: "11add837-7ee4-4104-b031-c161bce459ae",
//     name: "Lifetap",
//     manaCost: { U: 2 },
//     types: ["Enchantment"],
// };

// export const lordOfAtlantis: CardDefinition = {
//     id: "210c4a90-fc7a-4c76-aeaa-20a005e45386",
//     name: "Lord of Atlantis",
//     manaCost: { U: 2 },
//     types: ["Creature"],
//     subtypes: ["Merfolk"],
//     power: 2,
//     toughness: 2,
// };

// export const magicalHack: CardDefinition = {
//     id: "2bd4202c-0477-45aa-82fd-83c85d6d4bef",
//     name: "Magical Hack",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

export const mahamotiDjinn: CardDefinition = {
    id: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb",
    name: "Mahamoti Djinn",
    manaCost: { X: 4, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
};

// export const manaShort: CardDefinition = {
//     id: "73e3e0b3-5284-464f-8c62-0f7801c966f5",
//     name: "Mana Short",
//     manaCost: { X: 2, U: 1 },
//     types: ["Instant"],
// };

export const merfolkOfThePearlTrident: CardDefinition = {
    id: "2b871039-6a66-4ac3-95e7-24759c1f2f92",
    name: "Merfolk of the Pearl Trident",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 1,
    toughness: 1,
};

// export const phantasmalForces: CardDefinition = {
//     id: "0631c7c8-9aa5-4333-8e20-20247fc47033",
//     name: "Phantasmal Forces",
//     manaCost: { X: 3, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Illusion"],
//     power: 4,
//     toughness: 1,
// };

// export const phantasmalTerrain: CardDefinition = {
//     id: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14",
//     name: "Phantasmal Terrain",
//     manaCost: { U: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const phantomMonster: CardDefinition = {
    id: "e46d2cf5-e8d0-4fb2-b950-252d52084b63",
    name: "Phantom Monster",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
};

// export const pirateShip: CardDefinition = {
//     id: "d0a7cb23-d229-43c5-addd-dcf423984b0c",
//     name: "Pirate Ship",
//     manaCost: { X: 4, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Pirate"],
//     power: 4,
//     toughness: 3,
// };

// export const powerLeak: CardDefinition = {
//     id: "ccc982b6-35b2-4e33-ace2-86cb79123e4f",
//     name: "Power Leak",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const powerSink: CardDefinition = {
//     id: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9",
//     name: "Power Sink",
//     manaCost: { X: "X", U: 1 },
//     types: ["Instant"],
// };

// export const prodigalSorcerer: CardDefinition = {
//     id: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a",
//     name: "Prodigal Sorcerer",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Wizard", "Sorcerer"],
//     power: 1,
//     toughness: 1,
// };

// Psionic Blast — deals 4 damage to any target and 2 damage to you.
// CR 115.4: "any target" = creature/player/planeswalker. CR 120.3: damage
// to self is a normal damage event (can be prevented/redirected), not life
// loss — resolved via dealDamage on a player target pointing at the caster.
export const psionicBlast: CardDefinition = {
    id: "a6a86e6e-bfff-46af-9d36-c912901fea92",
    name: "Psionic Blast",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.dealDamage(ctx.targets[0], 4);
        ctx.dealDamage({ type: "player", id: ctx.caster }, 2);
    },
};

// export const psychicVenom: CardDefinition = {
//     id: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5",
//     name: "Psychic Venom",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// CR 508.1c — "can't attack unless defending player controls an Island" is
// encoded as a generic `cant-attack-unless-defender-controls-Island` static
// ability so the same restriction shape is reusable for other cards (Reef
// Pirates, Phantom Monster variants).
// CR 603.8 — "When you control no Islands, sacrifice this creature" is a
// state-triggered ability: the trigger fires as soon as the condition becomes
// true, then doesn't trigger again until it has resolved or otherwise left
// the stack. The engine scans for state triggers as part of every stable
// checkpoint after SBA evaluation (CR 117.5).
export const seaSerpent: CardDefinition = {
    id: "d0b333b7-db4d-4439-b0de-60414cbf8d7b",
    name: "Sea Serpent",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Serpent"],
    power: 5,
    toughness: 5,
    staticAbilities: ["cant-attack-unless-defender-controls-Island"],
    triggeredAbilities: [
        {
            id: "sea-serpent-no-islands-sacrifice",
            oracleText: "When you control no Islands, sacrifice Sea Serpent.",
            event: "STATE_CHECK",
            matches: (event, self, state) => {
                if (event.type !== "STATE_CHECK") return false;
                if (!state) return false;
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!controller) return false;
                return !controller.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        },
    ],
};

// export const sirensCall: CardDefinition = {
//     id: "d992b336-3b6e-43e1-8662-d85664349b44",
//     name: "Siren's Call",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

// export const sleightOfMind: CardDefinition = {
//     id: "d427790c-e322-446e-8d7d-a6b48ad41a42",
//     name: "Sleight of Mind",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

// export const spellBlast: CardDefinition = {
//     id: "845734da-ab03-4dbc-bb5f-96481d3b8e88",
//     name: "Spell Blast",
//     manaCost: { X: "X", U: 1 },
//     types: ["Instant"],
// };

// export const stasis: CardDefinition = {
//     id: "b6cef408-5b4b-49f6-9531-be544815b93f",
//     name: "Stasis",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
// };

// Steal Artifact — "Enchant artifact. You control enchanted artifact."
// (CR 303.4 aura attachment, 611.2 continuous static ability, 613.1b layer 2
// control-changing effect). Mirrors Control Magic but targets an artifact
// instead of a creature — artifacts don't get summoning sickness on a
// control flip, so 702.10c doesn't fire.
export const stealArtifact: CardDefinition = {
    id: "83316930-d6ad-46ce-9b40-48eea856d95b",
    name: "Steal Artifact",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    staticEffects: [
        {
            kind: "control-change",
            applies: AURA_AFFECTS_HOST,
        },
    ],
};

// export const thoughtlace: CardDefinition = {
//     id: "23749375-1416-47a4-9251-52f41fe2fae9",
//     name: "Thoughtlace",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

export const timeWalk: CardDefinition = {
    id: "e0139f60-d48e-46fb-9f5a-1e3d7558c834",
    name: "Time Walk",
    manaCost: { X: 1, U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.takeExtraTurn(ctx.controller);
    },
};

// Timetwister — "Each player shuffles their hand and graveyard into their
// library, then draws seven cards." (CR 121.1, 701.20)
// Timetwister itself is on the stack during resolution, so it's unaffected
// by the shuffle; after resolve() it goes to its owner's graveyard normally.
export const timetwister: CardDefinition = {
    id: "9a49dc44-616e-4bdd-8220-0bb71eccc512",
    name: "Timetwister",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.forEachPlayer((pid) => {
            ctx.moveZone(pid, "hand", "library");
            ctx.moveZone(pid, "graveyard", "library");
            ctx.shuffleLibrary(pid);
            ctx.drawCards(pid, 7);
        });
    },
};

// CR 701.20: oracle reads "you may tap or untap target ~". Modal-spell
// infrastructure (CR 700.2) is not implemented yet, so the resolve toggles
// the target's tap state — the only mode-with-effect for any board state.
// Replace with explicit mode selection once modal cast UI lands.
export const twiddle: CardDefinition = {
    id: "576e811f-26a3-4a7c-bd13-3b1cc3e184eb",
    name: "Twiddle",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: TARGET_ACL_PERMANENT,
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target) return;
        if (ctx.getIsTapped(target)) {
            ctx.untap(target);
        } else {
            ctx.tap(target);
        }
    },
};

export const unsummon: CardDefinition = {
    id: "8512f2c1-6361-4b79-843f-80b6bceeeb99",
    name: "Unsummon",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.returnToHand(ctx.targets[0]);
    },
};

// export const vesuvanDoppelganger: CardDefinition = {
//     id: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f",
//     name: "Vesuvan Doppelganger",
//     manaCost: { X: 3, U: 2 },
//     types: ["Creature"],
//     subtypes: ["Shapeshifter"],
//     power: 0,
//     toughness: 0,
// };

// Volcanic Eruption — "Destroy X target Mountains. Volcanic Eruption deals
// damage to each creature and each player equal to the number of Mountains
// put into a graveyard this way." (CR 107.3 — X chosen on cast / 601.2c —
// X-bound target count / 205.3 — subtype filter "Mountain" matches basic
// Mountain plus duals like Plateau / Taiga / Badlands / 614.5 — destroy
// returns false if a regen shield saves the land, so the damage count only
// reflects lands actually moved to graveyards / 120.3 — second-clause damage
// to each creature and each player.)
export const volcanicEruption: CardDefinition = {
    id: "a80582b1-09db-45f8-b362-0e5207a5a8e6",
    name: "Volcanic Eruption",
    manaCost: { X: "X", U: 3 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Land",
        subtypeFilter: "Mountain",
        count: "X",
    },
    resolve: (ctx: SpellContext) => {
        // CR 608.2b: re-validate each target on resolution. A target that's
        // no longer a Mountain on the battlefield is silently skipped.
        const mountainIds = new Set<string>();
        ctx.forEachPlayer((playerId) => {
            for (const id of ctx.getBattlefieldIds(playerId, {
                subtypes: "Mountain",
            })) {
                mountainIds.add(id);
            }
        });
        let destroyed = 0;
        for (const target of ctx.targets) {
            if (target.type !== "permanent") continue;
            if (!mountainIds.has(target.id)) continue;
            // CR 614.5 — destroy reports actual graveyard movement.
            if (ctx.destroy(target)) destroyed++;
        }
        if (destroyed === 0) return;
        ctx.dealDamageToEach(destroyed, {
            creatures: true,
            players: true,
        });
    },
};

export const wallOfAir: CardDefinition = {
    id: "da56fdf3-6a8f-4833-a5c3-197650cc4889",
    name: "Wall of Air",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender", "flying"],
};

// export const wallOfWater: CardDefinition = {
//     id: "41faed1a-ded8-49ee-8e2a-c60d377775d7",
//     name: "Wall of Water",
//     manaCost: { X: 1, U: 2 },
//     types: ["Creature"],
//     subtypes: ["Wall"],
//     power: 0,
//     toughness: 5,
// };

export const waterElemental: CardDefinition = {
    id: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e",
    name: "Water Elemental",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 4,
};

// export const animateDead: CardDefinition = {
//     id: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b",
//     name: "Animate Dead",
//     manaCost: { X: 1, B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// Bad Moon — "Black creatures get +1/+1." (CR 611 — static layer 7c, color check via CR 202.2)
export const badMoon: CardDefinition = {
    id: "43572906-ea74-4411-a549-5dc401591d2a",
    name: "Bad Moon",
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
    name: "Black Knight",
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
    name: "Bog Wraith",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Wraith"],
    power: 3,
    toughness: 3,
    staticAbilities: ["swampwalk"],
};

// export const contractFromBelow: CardDefinition = {
//     id: "9853b0ce-4763-4877-9741-f9145a3659c6",
//     name: "Contract from Below",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

// export const cursedLand: CardDefinition = {
//     id: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a",
//     name: "Cursed Land",
//     manaCost: { X: 2, B: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const darkRitual: CardDefinition = {
    id: "ebb6664d-23ca-456e-9916-afcd6f26aa7f",
    name: "Dark Ritual",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.addMana({ B: 3 });
    },
};

// export const darkpact: CardDefinition = {
//     id: "e78db688-93a2-47f5-9aa5-9158a72cd973",
//     name: "Darkpact",
//     manaCost: { B: 3 },
//     types: ["Sorcery"],
// };

// export const deathgrip: CardDefinition = {
//     id: "2371c126-f19a-472a-ba5f-3b1366274ea0",
//     name: "Deathgrip",
//     manaCost: { B: 2 },
//     types: ["Enchantment"],
// };

// export const deathlace: CardDefinition = {
//     id: "6ff1cefc-62cb-4525-b0c5-2b09603b4314",
//     name: "Deathlace",
//     manaCost: { B: 1 },
//     types: ["Instant"],
// };

// export const demonicAttorney: CardDefinition = {
//     id: "fd891fc6-d9d6-494e-ae65-8bea8f44b575",
//     name: "Demonic Attorney",
//     manaCost: { X: 1, B: 2 },
//     types: ["Sorcery"],
// };

// export const demonicHordes: CardDefinition = {
//     id: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50",
//     name: "Demonic Hordes",
//     manaCost: { X: 3, B: 3 },
//     types: ["Creature"],
//     subtypes: ["Demon"],
//     power: 5,
//     toughness: 5,
// };

// Demonic Tutor — "Search your library for a card, then shuffle and put that
// card on top." (CR 701.19 for search, CR 701.20 for shuffle). Modern oracle
// simplifies to "Search your library for a card, put it into your hand, then
// shuffle." Implemented as a two-step resolve: step 0 enqueues a
// search-library pending choice (count=1); step 1 moves the picked card into
// the caster's hand and shuffles.
export const demonicTutor: CardDefinition = {
    id: "711d4d54-5520-4de8-9b93-79902ed8e562",
    name: "Demonic Tutor",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
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
    name: "Drain Life",
    manaCost: { X: "X", B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const x = ctx.getX();
        ctx.dealDamage(ctx.targets[0], x);
        ctx.gainLife(ctx.caster, x);
    },
};

// export const drudgeSkeletons: CardDefinition = {
//     id: "23614289-0d73-4747-a849-5cb67cc97d6a",
//     name: "Drudge Skeletons",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Skeleton"],
//     power: 1,
//     toughness: 1,
// };

// export const evilPresence: CardDefinition = {
//     id: "0551d66e-8cd4-48f0-aa17-15f26be9d85f",
//     name: "Evil Presence",
//     manaCost: { B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const fear: CardDefinition = {
//     id: "0cd927be-e63f-4371-a1d8-7a0489cb187e",
//     name: "Fear",
//     manaCost: { B: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const frozenShade: CardDefinition = {
//     id: "d0bd76c8-4cff-4c15-9686-7a299b589814",
//     name: "Frozen Shade",
//     manaCost: { X: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Shade"],
//     power: 0,
//     toughness: 1,
// };

// export const gloom: CardDefinition = {
//     id: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f",
//     name: "Gloom",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };

// export const howlFromBeyond: CardDefinition = {
//     id: "67ec17e1-174b-4d07-a27f-91a333c4b2fb",
//     name: "Howl from Beyond",
//     manaCost: { X: "X", B: 1 },
//     types: ["Instant"],
// };

// Hypnotic Specter — CR 603 triggered ability on combat/spell damage to an
// opponent. The random discard uses the game's seeded PRNG (CR 701.8a).
export const hypnoticSpecter: CardDefinition = {
    id: "b43b900f-2d9b-442b-9699-058483604ec9",
    name: "Hypnotic Specter",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Specter"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "hypnotic-specter-discard",
            oracleText:
                "Whenever Hypnotic Specter deals damage to an opponent, that player discards a card at random.",
            event: "DAMAGE_DEALT",
            matches: (event, self) => {
                if (event.type !== "DAMAGE_DEALT") return false;
                if (event.sourceInstanceId !== self.id) return false;
                if (event.target.type !== "player") return false;
                return event.target.id !== self.controllerId;
            },
            resolve: (ctx, event) => {
                if (event.type !== "DAMAGE_DEALT") return;
                if (event.target.type !== "player") return;
                ctx.discardAtRandom(event.target.id, 1);
            },
        },
    ],
};

// export const lich: CardDefinition = {
//     id: "4250caec-0e37-41be-9ec4-8938deb5f0d0",
//     name: "Lich",
//     manaCost: { B: 4 },
//     types: ["Enchantment"],
// };

// export const lordOfThePit: CardDefinition = {
//     id: "2926777a-4f6e-4965-ba83-22cf7df02602",
//     name: "Lord of the Pit",
//     manaCost: { X: 4, B: 3 },
//     types: ["Creature"],
//     subtypes: ["Demon"],
//     power: 7,
//     toughness: 7,
// };

// export const mindTwist: CardDefinition = {
//     id: "eee9e106-a248-49d2-b8c8-6bbcd56ce739",
//     name: "Mind Twist",
//     manaCost: { X: "X", B: 1 },
//     types: ["Sorcery"],
// };

// export const netherShadow: CardDefinition = {
//     id: "f13ad58a-6f9b-420a-bac1-40929f5e616a",
//     name: "Nether Shadow",
//     manaCost: { B: 2 },
//     types: ["Creature"],
//     subtypes: ["Spirit"],
//     power: 1,
//     toughness: 1,
// };

// export const nettlingImp: CardDefinition = {
//     id: "8105973c-a94d-444c-ba20-ab0fa978bee8",
//     name: "Nettling Imp",
//     manaCost: { X: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Imp"],
//     power: 1,
//     toughness: 1,
// };

// Nightmare — Flying. "Nightmare's power and toughness are each equal to the
// number of Swamps you control." (CR 604.3 CDA, layer 7b). Modeled as a
// pt-cda static effect scoped to the card itself; base 0/0 means the CDA's
// output is the effective stat line. CR 208.2 still applies: if the CDA
// returns 0, the card is a 0/0 and dies to SBA unless otherwise buffed.
export const nightmare: CardDefinition = {
    id: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b",
    name: "Nightmare",
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

// export const paralyze: CardDefinition = {
//     id: "be33a155-de26-43d1-88f1-c926f1b7cb7c",
//     name: "Paralyze",
//     manaCost: { B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const pestilence: CardDefinition = {
//     id: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a",
//     name: "Pestilence",
//     manaCost: { X: 2, B: 2 },
//     types: ["Enchantment"],
// };

// export const plagueRats: CardDefinition = {
//     id: "b3724e40-0622-4aee-9334-6c9fff88bcd5",
//     name: "Plague Rats",
//     manaCost: { X: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Rat"],
// };

// export const raiseDead: CardDefinition = {
//     id: "ce07bede-2219-427c-a61a-56518751de42",
//     name: "Raise Dead",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

// Royal Assassin — "{T}: Destroy target tapped creature." (CR 701.20 for
// tap-state, CR 701.7 for destroy). The tappedFilter on TargetRequirement
// enforces legality at activation (CR 602.2b); the resolve re-checks at
// resolution (CR 608.2b) so an opposing Twiddle-style untap fizzles this.
export const royalAssassin: CardDefinition = {
    id: "59590768-fa96-4869-8763-9d5ab6ac22ad",
    name: "Royal Assassin",
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
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                if (!ctx.getIsTapped(target)) return;
                ctx.destroy(target);
            },
        },
    ],
};

// export const sacrifice: CardDefinition = {
//     id: "12164aee-6a27-4246-8d15-2d6dd20d92e9",
//     name: "Sacrifice",
//     manaCost: { B: 1 },
//     types: ["Instant"],
// };

export const scatheZombies: CardDefinition = {
    id: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e",
    name: "Scathe Zombies",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
};

// export const scavengingGhoul: CardDefinition = {
//     id: "426984e0-88e1-4a2d-9a1c-798b95864df3",
//     name: "Scavenging Ghoul",
//     manaCost: { X: 3, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Zombie"],
//     power: 2,
//     toughness: 2,
// };

// Sengir Vampire — flying, 4/4. "Whenever another creature dies, if Sengir
// Vampire dealt damage to it this turn, put a +1/+1 counter on Sengir
// Vampire." (CR 603.2 death trigger, CR 122 counters). Simplification: the
// engine has no +1/+1 counter state yet, so the counter is modeled as a
// permanent modifyPower/modifyToughness delta on the source. Functionally
// equivalent until a "remove counters" effect is needed. Only deaths from
// the combat damage step emit CREATURE_DIED (see phases.ts) — deaths from
// spells/abilities do not yet retrigger this, a known limitation.
export const sengirVampire: CardDefinition = {
    id: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9",
    name: "Sengir Vampire",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Vampire"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "sengir-vampire-counter",
            oracleText:
                "Whenever another creature dies, if Sengir Vampire dealt damage to it this turn, put a +1/+1 counter on Sengir Vampire.",
            event: "CREATURE_DIED",
            matches: (event, self) => {
                if (event.type !== "CREATURE_DIED") return false;
                if (event.creatureInstanceId === self.id) return false;
                return event.damagedBySources.includes(self.id);
            },
            resolve: (ctx) => {
                const target: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                ctx.modifyPower(target, 1);
                ctx.modifyToughness(target, 1);
            },
        },
    ],
};

// export const simulacrum: CardDefinition = {
//     id: "35c3a78d-cc79-4187-929a-8aa1d1469990",
//     name: "Simulacrum",
//     manaCost: { X: 1, B: 1 },
//     types: ["Instant"],
// };

// Sinkhole — "Destroy target land." (CR 701.7). Targeting uses the generic
// Land type filter; resolution delegates to the shared destroy primitive.
export const sinkhole: CardDefinition = {
    id: "04b31611-9053-4eaf-b392-21bb644fef5f",
    name: "Sinkhole",
    manaCost: { B: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effect: "destroy-target",
};

// export const terror: CardDefinition = {
//     id: "21004958-2c7e-4a55-bc80-411c4d780106",
//     name: "Terror",
//     manaCost: { X: 1, B: 1 },
//     types: ["Instant"],
// };

// export const unholyStrength: CardDefinition = {
//     id: "90563f90-0127-4164-b43b-f0321dc63a1d",
//     name: "Unholy Strength",
//     manaCost: { B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const wallOfBone: CardDefinition = {
//     id: "ae20d442-a544-4a03-9ebf-5ecb137c67dd",
//     name: "Wall of Bone",
//     manaCost: { X: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Skeleton", "Wall"],
//     power: 1,
//     toughness: 4,
// };

// export const warpArtifact: CardDefinition = {
//     id: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5",
//     name: "Warp Artifact",
//     manaCost: { B: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const weakness: CardDefinition = {
//     id: "36ca06a1-9b9a-49a2-9c47-9b72228621bc",
//     name: "Weakness",
//     manaCost: { B: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const willOTheWisp: CardDefinition = {
//     id: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6",
//     name: "Will-o'-the-Wisp",
//     manaCost: { B: 1 },
//     types: ["Creature"],
//     subtypes: ["Spirit"],
//     power: 0,
//     toughness: 1,
// };

// export const wordOfCommand: CardDefinition = {
//     id: "96c21429-98d3-416b-be00-6aa9c4c5a006",
//     name: "Word of Command",
//     manaCost: { B: 2 },
//     types: ["Instant"],
// };

// export const zombieMaster: CardDefinition = {
//     id: "3d4255a0-d445-4c00-b936-bbf07851e1c8",
//     name: "Zombie Master",
//     manaCost: { X: 1, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Zombie"],
//     power: 2,
//     toughness: 3,
// };

// export const burrowing: CardDefinition = {
//     id: "a14c05e4-8df3-450b-8a98-5028e73b14c1",
//     name: "Burrowing",
//     manaCost: { R: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const chaoslace: CardDefinition = {
//     id: "72ea2048-57bc-43d5-8987-33ca727f1a97",
//     name: "Chaoslace",
//     manaCost: { R: 1 },
//     types: ["Instant"],
// };

// export const disintegrate: CardDefinition = {
//     id: "8712c49e-f171-4669-bed9-87575a37af11",
//     name: "Disintegrate",
//     manaCost: { X: "X", R: 1 },
//     types: ["Sorcery"],
// };

// export const dragonWhelp: CardDefinition = {
//     id: "6bbf1eab-bc32-4835-b566-8634b1fe81b0",
//     name: "Dragon Whelp",
//     manaCost: { X: 2, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Dragon"],
//     power: 2,
//     toughness: 3,
// };

// export const dwarvenDemolitionTeam: CardDefinition = {
//     id: "03482c9c-1f25-4d73-9243-17462ea37ac4",
//     name: "Dwarven Demolition Team",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Dwarf"],
//     power: 1,
//     toughness: 1,
// };

// export const dwarvenWarriors: CardDefinition = {
//     id: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8",
//     name: "Dwarven Warriors",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Dwarf", "Warrior"],
//     power: 1,
//     toughness: 1,
// };

export const earthElemental: CardDefinition = {
    id: "b24b5864-44c0-4bc8-8705-9504f83b2c03",
    name: "Earth Elemental",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 5,
};

// export const earthbind: CardDefinition = {
//     id: "a6d492b7-b0b3-420e-8d00-6dacb11de77e",
//     name: "Earthbind",
//     manaCost: { R: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// CR 107.3: X chosen on cast. CR 120.3: damage respects flying at
// resolution time (creatures losing flying mid-resolution aren't affected,
// since matching creatures are snapshotted).
export const earthquake: CardDefinition = {
    id: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64",
    name: "Earthquake",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(ctx.getX(), {
            creatures: { excludeAbility: "flying" },
            players: true,
        });
    },
};

// export const falseOrders: CardDefinition = {
//     id: "7eb71ac4-796d-4011-9002-1129bc09c284",
//     name: "False Orders",
//     manaCost: { R: 1 },
//     types: ["Instant"],
// };

export const fireElemental: CardDefinition = {
    id: "da237992-2919-4e37-8f56-2164095f59b5",
    name: "Fire Elemental",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 4,
};

// CR 601.2f: costs {1} more per extra target. CR 120.1: damage divided
// evenly, rounded down — remainder is discarded. CR 107.3: X chosen on cast.
export const fireball: CardDefinition = {
    id: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece",
    name: "Fireball",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: { min: 1 } },
    additionalGenericPerExtraTarget: 1,
    resolve: (ctx: SpellContext) => {
        ctx.dealDividedDamage(ctx.targets, ctx.getX());
    },
};

// export const firebreathing: CardDefinition = {
//     id: "3eb27381-505d-4e47-bf66-9e7ba91a5075",
//     name: "Firebreathing",
//     manaCost: { R: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const flashfires: CardDefinition = {
    id: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5",
    name: "Flashfires",
    manaCost: { X: 3, R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ subtypes: "Plains" });
    },
};

// export const fork: CardDefinition = {
//     id: "e6b43916-fe2d-417a-a550-d7c795023297",
//     name: "Fork",
//     manaCost: { R: 2 },
//     types: ["Instant"],
// };

// export const goblinBalloonBrigade: CardDefinition = {
//     id: "5129b422-7a35-4bc5-b14b-c814012a0d8f",
//     name: "Goblin Balloon Brigade",
//     manaCost: { R: 1 },
//     types: ["Creature"],
//     subtypes: ["Goblin", "Warrior"],
//     power: 1,
//     toughness: 1,
// };

// export const goblinKing: CardDefinition = {
//     id: "5873672d-37ea-4c0f-97f3-12b74fde112d",
//     name: "Goblin King",
//     manaCost: { X: 1, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Goblin"],
//     power: 2,
//     toughness: 2,
// };

// export const graniteGargoyle: CardDefinition = {
//     id: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc",
//     name: "Granite Gargoyle",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Gargoyle"],
//     power: 2,
//     toughness: 2,
// };

export const grayOgre: CardDefinition = {
    id: "73ae5276-b607-4f23-a9d2-e8cc7b8e3693",
    name: "Gray Ogre",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Ogre"],
    power: 2,
    toughness: 2,
};

export const hillGiant: CardDefinition = {
    id: "0ddb98e8-13fe-4786-83f7-b72c56db135a",
    name: "Hill Giant",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
};

export const hurloonMinotaur: CardDefinition = {
    id: "78a9088f-8755-47cb-aa93-51d992ccab90",
    name: "Hurloon Minotaur",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Minotaur"],
    power: 2,
    toughness: 3,
};

// export const ironclawOrcs: CardDefinition = {
//     id: "d56421a8-34ae-4033-943f-c59a7bf2b6f9",
//     name: "Ironclaw Orcs",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc"],
//     power: 2,
//     toughness: 2,
// };

// export const keldonWarlord: CardDefinition = {
//     id: "8fe3fd83-969c-4add-888f-86f4306b067c",
//     name: "Keldon Warlord",
//     manaCost: { X: 2, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Barbarian"],
// };

export const lightningBolt: CardDefinition = {
    id: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    name: "Lightning Bolt",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.dealDamage(ctx.targets[0], 3);
    },
};

// export const manaFlare: CardDefinition = {
//     id: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9",
//     name: "Mana Flare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Enchantment"],
// };

// export const manabarbs: CardDefinition = {
//     id: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8",
//     name: "Manabarbs",
//     manaCost: { X: 3, R: 1 },
//     types: ["Enchantment"],
// };

export const monssGoblinRaiders: CardDefinition = {
    id: "b4eb3db3-6a7c-488a-9433-d5d1d3133816",
    name: "Mons's Goblin Raiders",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
};

// export const orcishArtillery: CardDefinition = {
//     id: "a97208b1-a91b-4129-8a00-2f97b418accc",
//     name: "Orcish Artillery",
//     manaCost: { X: 1, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Orc", "Warrior"],
//     power: 1,
//     toughness: 3,
// };

// export const orcishOriflamme: CardDefinition = {
//     id: "911538ea-322c-4c40-a9c3-35e47fe60fce",
//     name: "Orcish Oriflamme",
//     manaCost: { X: 3, R: 1 },
//     types: ["Enchantment"],
// };

// export const powerSurge: CardDefinition = {
//     id: "62858604-ca5a-4f69-a045-a7515ebfabf2",
//     name: "Power Surge",
//     manaCost: { R: 2 },
//     types: ["Enchantment"],
// };

// export const ragingRiver: CardDefinition = {
//     id: "61e4f56d-1f4f-49f2-8534-0d09196a3327",
//     name: "Raging River",
//     manaCost: { R: 2 },
//     types: ["Enchantment"],
// };

// export const redElementalBlast: CardDefinition = {
//     id: "776ad9be-3309-4f1d-9f27-6219d9477662",
//     name: "Red Elemental Blast",
//     manaCost: { R: 1 },
//     types: ["Instant"],
// };

export const rocOfKherRidges: CardDefinition = {
    id: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1",
    name: "Roc of Kher Ridges",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
};

// export const rockHydra: CardDefinition = {
//     id: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97",
//     name: "Rock Hydra",
//     manaCost: { X: "X", R: 2 },
//     types: ["Creature"],
//     subtypes: ["Hydra"],
//     power: 0,
//     toughness: 0,
// };

// export const sedgeTroll: CardDefinition = {
//     id: "b13bf496-f3c0-4c13-8282-e7abfab6a198",
//     name: "Sedge Troll",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Troll"],
//     power: 2,
//     toughness: 2,
// };

// export const shatter: CardDefinition = {
//     id: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e",
//     name: "Shatter",
//     manaCost: { X: 1, R: 1 },
//     types: ["Instant"],
// };

// export const shivanDragon: CardDefinition = {
//     id: "fefbf149-f988-4f8b-9f53-56f5878116a6",
//     name: "Shivan Dragon",
//     manaCost: { X: 4, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Dragon"],
//     power: 5,
//     toughness: 5,
// };

// export const smoke: CardDefinition = {
//     id: "7c67788e-d713-47c3-ab9f-b8a6212ae24f",
//     name: "Smoke",
//     manaCost: { R: 2 },
//     types: ["Enchantment"],
// };

// export const stoneGiant: CardDefinition = {
//     id: "7ffaedb9-25f8-4304-9085-e12505b93312",
//     name: "Stone Giant",
//     manaCost: { X: 2, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Giant"],
//     power: 3,
//     toughness: 4,
// };

// export const stoneRain: CardDefinition = {
//     id: "57ff74cb-a2ed-4123-ac42-f72f9820049e",
//     name: "Stone Rain",
//     manaCost: { X: 2, R: 1 },
//     types: ["Sorcery"],
// };

// export const tunnel: CardDefinition = {
//     id: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31",
//     name: "Tunnel",
//     manaCost: { R: 1 },
//     types: ["Instant"],
// };

// export const twoHeadedGiantOfForiys: CardDefinition = {
//     id: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245",
//     name: "Two-Headed Giant of Foriys",
//     manaCost: { X: 4, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Giant"],
//     power: 4,
//     toughness: 4,
// };

// export const uthdenTroll: CardDefinition = {
//     id: "2ff21a6f-83a7-4bf3-a078-294e303232cc",
//     name: "Uthden Troll",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Troll"],
//     power: 2,
//     toughness: 2,
// };

// export const wallOfFire: CardDefinition = {
//     id: "efcf12cd-fb70-444e-9641-73ffa0e8f16e",
//     name: "Wall of Fire",
//     manaCost: { X: 1, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Wall"],
//     power: 0,
//     toughness: 5,
// };

export const wallOfStone: CardDefinition = {
    id: "140e567c-6e4a-42b0-8084-d6c9695ae802",
    name: "Wall of Stone",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 8,
    staticAbilities: ["defender"],
};

// Wheel of Fortune — "Each player discards their hand, then draws seven
// cards." (CR 701.8, 121.1)
// Wheel of Fortune itself is on the stack during resolution, so it's not in
// the caster's hand to be discarded; after resolve() it goes to its owner's
// graveyard normally.
export const wheelOfFortune: CardDefinition = {
    id: "67b369c4-faa8-45c8-a1b9-98f228b69682",
    name: "Wheel of Fortune",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.forEachPlayer((pid) => {
            for (const cardId of ctx.getHandIds(pid)) {
                ctx.discardCard(pid, cardId);
            }
            ctx.drawCards(pid, 7);
        });
    },
};

// export const aspectOfWolf: CardDefinition = {
//     id: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29",
//     name: "Aspect of Wolf",
//     manaCost: { X: 1, G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// Berserk — "Cast this spell only before the combat damage step. Target
// creature gains trample and gets +X/+0 until end of turn, where X is its
// power. At the beginning of the next end step, destroy that creature if it
// attacked this turn." (CR 117.1b, 113.1, 611.1b, 603.7a, 514.2)
//
// "+X/+0 where X is its power" resolves at cast time: the creature's current
// power is snapshotted on resolution and added back. The delayed destroy is
// scheduled via scheduleDelayedTrigger and looked up on this card's def at
// end-step fire time.
const BERSERK_ID = "e173c8ce-2352-405e-ad00-e3bb94ced1ad";

export const berserk: CardDefinition = {
    id: BERSERK_ID,
    name: "Berserk",
    manaCost: { G: 1 },
    types: ["Instant"],
    // CR 117.1b — castable only up to (but not including) the combat damage step.
    castPhaseRestriction: [
        "UNTAP",
        "UPKEEP",
        "DRAW",
        "PRECOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
    ],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "permanent") return;
        // CR 611.1b — static grant applies immediately; trample is read at
        // combat-damage assignment time.
        ctx.grantStaticAbility(target, "trample", { phase: "end-of-turn" });
        // CR 107.3 — X is the creature's power as the spell resolves.
        const power = ctx.getPower(target);
        ctx.modifyPower(target, power);
        // CR 603.7a — destroy fires at the next end step. Payload holds the
        // creature id so the resolver can look it up after the scheduling
        // spell has left the stack.
        ctx.scheduleDelayedTrigger(
            BERSERK_ID,
            "destroy-if-attacked",
            "next-end-step",
            { targetId: target.id }
        );
    },
    delayedTriggers: [
        {
            id: "destroy-if-attacked",
            oracleText:
                "At the beginning of the next end step, destroy that creature if it attacked this turn.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                const target = { type: "permanent" as const, id: targetId };
                // CR 506.2 — only if the creature was declared as an attacker
                // at any point this turn. destroy() is a no-op when the
                // permanent has already left the battlefield (CR 603.7b).
                if (!ctx.hasAttackedThisTurn(target)) return;
                ctx.destroy(target);
            },
        },
    ],
};

export const birdsOfParadise: CardDefinition = {
    id: "55fe6449-1f23-43dc-adee-d144cd505b5c",
    name: "Birds of Paradise",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "birds-of-paradise-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            effect: (ctx: ActivatedAbilityContext) => {
                // Color chosen at activation time, applied by engine
                ctx.addMana({ G: 1 });
            },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// export const camouflage: CardDefinition = {
//     id: "3838c2a3-7fab-4976-9c1b-2891aee24e52",
//     name: "Camouflage",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };

// CR 605.1a — the granted ability adds mana and does not target, so it
// qualifies as a mana ability (useStack: false). CR 118.4 — paying 1 life
// requires player.life >= 1; SBA handles reaching 0 (CR 704.5a).
const CHANNEL_ID = "c1862c47-71cc-45a3-8805-a5ddc62e55ea";

export const channel: CardDefinition = {
    id: CHANNEL_ID,
    name: "Channel",
    manaCost: { G: 2 },
    types: ["Sorcery"],
    activatedAbilities: [
        {
            id: "channel-mana",
            cost: { life: 1 },
            oracleText: "Pay 1 life: Add {C}.",
            useStack: false,
            manaProduced: { C: 1 },
            effect: (ctx) => ctx.addMana({ C: 1 }),
        },
    ],
    resolve: (ctx) => {
        ctx.grantAbility(ctx.caster, CHANNEL_ID, "channel-mana", {
            phase: "end-of-turn",
        });
    },
};

// export const cockatrice: CardDefinition = {
//     id: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957",
//     name: "Cockatrice",
//     manaCost: { X: 3, G: 2 },
//     types: ["Creature"],
//     subtypes: ["Cockatrice"],
//     power: 2,
//     toughness: 4,
// };

export const crawWurm: CardDefinition = {
    id: "bfed1a95-bd67-4e16-a781-81866028af2f",
    name: "Craw Wurm",
    manaCost: { X: 4, G: 2 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 6,
    toughness: 4,
};

export const elvishArchers: CardDefinition = {
    id: "1cb9d405-f2b5-4e10-a405-feafd2a87d90",
    name: "Elvish Archers",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Archer"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
};

// export const fastbond: CardDefinition = {
//     id: "a575a9af-e1de-4a1d-91d8-440585377e4f",
//     name: "Fastbond",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
// };

// export const fog: CardDefinition = {
//     id: "cfba606d-bb55-43ba-aa0c-299649958788",
//     name: "Fog",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };

// export const forceOfNature: CardDefinition = {
//     id: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3",
//     name: "Force of Nature",
//     manaCost: { X: 2, G: 4 },
//     types: ["Creature"],
//     subtypes: ["Elemental"],
//     power: 8,
//     toughness: 8,
// };

// export const fungusaur: CardDefinition = {
//     id: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23",
//     name: "Fungusaur",
//     manaCost: { X: 3, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Fungus", "Dinosaur"],
//     power: 2,
//     toughness: 2,
// };

// export const gaeasLiege: CardDefinition = {
//     id: "e2b15221-c8b0-4861-9f8b-8a65834ad499",
//     name: "Gaea's Liege",
//     manaCost: { X: 3, G: 3 },
//     types: ["Creature"],
//     subtypes: ["Avatar"],
// };

export const giantGrowth: CardDefinition = {
    id: "367dbefe-3366-408e-9fcf-7dc00f8cc201",
    name: "Giant Growth",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.modifyPower(ctx.targets[0], 3);
        ctx.modifyToughness(ctx.targets[0], 3);
    },
};

// export const giantSpider: CardDefinition = {
//     id: "77636b4c-faea-4bf5-b88c-dd5bb88dc930",
//     name: "Giant Spider",
//     manaCost: { X: 3, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Spider"],
//     power: 2,
//     toughness: 4,
// };

export const grizzlyBears: CardDefinition = {
    id: "ce2d603a-3231-4a8c-bf39-1617586ea870",
    name: "Grizzly Bears",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

// CR 107.3: X chosen on cast. CR 120.3: mirrors Earthquake but targets
// fliers instead.
export const hurricane: CardDefinition = {
    id: "52f5a19f-16e4-4d35-89e1-969ac8202f88",
    name: "Hurricane",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(ctx.getX(), {
            creatures: { requireAbility: "flying" },
            players: true,
        });
    },
};

// export const iceStorm: CardDefinition = {
//     id: "9914836e-2fa6-4390-94b2-431427848a54",
//     name: "Ice Storm",
//     manaCost: { X: 2, G: 1 },
//     types: ["Sorcery"],
// };

// export const instillEnergy: CardDefinition = {
//     id: "5bd38716-874c-4e3c-a315-837839a6258c",
//     name: "Instill Energy",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const ironrootTreefolk: CardDefinition = {
    id: "b93c5869-7777-44bb-967a-e9439b25ced4",
    name: "Ironroot Treefolk",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 3,
    toughness: 5,
};

// export const kudzu: CardDefinition = {
//     id: "b2b72dcd-9ea1-4729-baae-ecd262fdff67",
//     name: "Kudzu",
//     manaCost: { X: 1, G: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const leyDruid: CardDefinition = {
//     id: "f9232508-d363-4ef3-987a-741f6bff331f",
//     name: "Ley Druid",
//     manaCost: { X: 2, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Druid"],
//     power: 1,
//     toughness: 1,
// };

// export const lifeforce: CardDefinition = {
//     id: "e292577e-6232-44fa-a9c2-cc09949c6ed3",
//     name: "Lifeforce",
//     manaCost: { G: 2 },
//     types: ["Enchantment"],
// };

// export const lifelace: CardDefinition = {
//     id: "38cb601b-a35c-412e-b386-e77dad3daa54",
//     name: "Lifelace",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };

// export const livingArtifact: CardDefinition = {
//     id: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e",
//     name: "Living Artifact",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const livingLands: CardDefinition = {
//     id: "80be0580-7948-4d8e-8c0f-5e2797ac411b",
//     name: "Living Lands",
//     manaCost: { X: 3, G: 1 },
//     types: ["Enchantment"],
// };

export const llanowarElves: CardDefinition = {
    id: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb",
    name: "Llanowar Elves",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "llanowar-elves-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};

// export const lure: CardDefinition = {
//     id: "2a87b26e-0431-42e9-b44f-94ba8546111a",
//     name: "Lure",
//     manaCost: { X: 1, G: 2 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const naturalSelection: CardDefinition = {
//     id: "a8917dc8-01c0-4e72-9310-c4d501775411",
//     name: "Natural Selection",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };

// Regeneration — "Enchant creature. {G}: Regenerate enchanted creature."
// (CR 303.4 aura attachment, 701.15a regenerate, 614.5 destroy replacement,
// 506.4 remove from combat). The activated ability does not target — the
// affected creature is determined by the aura's `attachedTo` host. The
// regen rider is implemented engine-side via regenerateOrDestroy: each
// shield consumed heals damage, taps, and removes from combat.
export const regeneration: CardDefinition = {
    id: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4",
    name: "Regeneration",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "regeneration-regenerate",
            cost: { mana: { G: 1 } },
            oracleText: "{G}: Regenerate enchanted creature.",
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: hostId,
                });
            },
        },
    ],
};

// Regrowth — "Return target card from your graveyard to your hand."
// CR 601.2c (target chosen at cast); CR 608.2b (illegal target on resolution
// → effect does nothing); CR 400.7 (zone change to hand). The
// `targetRequirement.zone: "graveyard"` + `controller: "you"` + `type: "card"`
// triple narrows legal targets to any card type sitting in the caster's own
// graveyard. `moveCardById` is a silent no-op if the card has left the
// graveyard before resolution, so the legality recheck on resolve is implicit.
export const regrowth: CardDefinition = {
    id: "badc73ec-3728-4246-90c7-5f4eb7051ed5",
    name: "Regrowth",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "card",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card") return;
        if (!t.playerId) return;
        ctx.moveCardById(t.playerId, t.id, "graveyard", "hand");
    },
};

export const scrybSprites: CardDefinition = {
    id: "6d929c38-91e6-457c-937a-d1884f4bba44",
    name: "Scryb Sprites",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
};

export const shanodinDryads: CardDefinition = {
    id: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8",
    name: "Shanodin Dryads",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Nymph", "Dryad"],
    power: 1,
    toughness: 1,
    staticAbilities: ["forestwalk"],
};

// export const streamOfLife: CardDefinition = {
//     id: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9",
//     name: "Stream of Life",
//     manaCost: { X: "X", G: 1 },
//     types: ["Sorcery"],
// };

// export const thicketBasilisk: CardDefinition = {
//     id: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab",
//     name: "Thicket Basilisk",
//     manaCost: { X: 3, G: 2 },
//     types: ["Creature"],
//     subtypes: ["Basilisk"],
//     power: 2,
//     toughness: 4,
// };

// export const timberWolves: CardDefinition = {
//     id: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01",
//     name: "Timber Wolves",
//     manaCost: { G: 1 },
//     types: ["Creature"],
//     subtypes: ["Wolf"],
//     power: 1,
//     toughness: 1,
// };

export const tranquility: CardDefinition = {
    id: "774cc5a6-3a69-4812-add4-eb5eb6389238",
    name: "Tranquility",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Enchantment");
    },
};

export const tsunami: CardDefinition = {
    id: "9ed67d61-cf47-446b-b454-eb404a8686b7",
    name: "Tsunami",
    manaCost: { X: 3, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ subtypes: "Island" });
    },
};

// export const verduranEnchantress: CardDefinition = {
//     id: "9f87178b-1221-4d7a-a7a5-20d7f01b8089",
//     name: "Verduran Enchantress",
//     manaCost: { X: 1, G: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Druid"],
//     power: 0,
//     toughness: 2,
// };

// export const wallOfBrambles: CardDefinition = {
//     id: "af2a4558-db6e-41b2-aff6-b164d93282a0",
//     name: "Wall of Brambles",
//     manaCost: { X: 2, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Plant", "Wall"],
//     power: 2,
//     toughness: 3,
// };

export const wallOfIce: CardDefinition = {
    id: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756",
    name: "Wall of Ice",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 7,
    staticAbilities: ["defender"],
};

export const wallOfWood: CardDefinition = {
    id: "8df80424-3bd9-4982-ad79-e55d9ba3b43d",
    name: "Wall of Wood",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender"],
};

// export const wanderlust: CardDefinition = {
//     id: "220a03ca-8c9b-4acb-821d-f6577fbb20fb",
//     name: "Wanderlust",
//     manaCost: { X: 2, G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

export const warMammoth: CardDefinition = {
    id: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb",
    name: "War Mammoth",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
};

// export const web: CardDefinition = {
//     id: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0",
//     name: "Web",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const wildGrowth: CardDefinition = {
//     id: "fd896dfa-66c0-4327-8e5b-489bbe350c95",
//     name: "Wild Growth",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
//     subtypes: ["Aura"],
// };

// export const ankhOfMishra: CardDefinition = {
//     id: "f594b7aa-d44e-47c4-989b-565f881e25f1",
//     name: "Ankh of Mishra",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// export const basaltMonolith: CardDefinition = {
//     id: "66a74c89-6f86-4ec8-af17-391cd5026054",
//     name: "Basalt Monolith",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
//     activatedAbilities: [
//         {
//             id: "basalt-monolith-mana",
//             cost: { tap: true },
//             effect: (ctx: ActivatedAbilityContext) => {
//                 ctx.addMana({ C: 3 });
//             },
//             useStack: false,
//         },
//     ],
// };

export const blackLotus: CardDefinition = {
    id: "b0faa7f2-b547-42c4-a810-839da50dadfe",
    name: "Black Lotus",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "black-lotus-mana",
            oracleText:
                "{T}, Sacrifice Black Lotus: Add three mana of any one color.",
            cost: { tap: true, sacrifice: true },
            effect: (ctx: ActivatedAbilityContext) => {
                // Color chosen at activation time, applied by engine
                ctx.addMana({ W: 3 });
            },
            useStack: false,
            manaChoices: [{ W: 3 }, { U: 3 }, { B: 3 }, { R: 3 }, { G: 3 }],
        },
    ],
};

// export const blackVise: CardDefinition = {
//     id: "76ac72f8-5b1e-4d67-a796-ef69cde27424",
//     name: "Black Vise",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const celestialPrism: CardDefinition = {
//     id: "a47417cb-1ea7-4f65-ba06-e27a99373114",
//     name: "Celestial Prism",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// export const chaosOrb: CardDefinition = {
//     id: "92274971-7c4a-4326-b0fe-75e2d124f718",
//     name: "Chaos Orb",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// export const clockworkBeast: CardDefinition = {
//     id: "27f916a2-0ace-44b5-99dc-72979af34db9",
//     name: "Clockwork Beast",
//     manaCost: { X: 6 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Beast"],
//     power: 0,
//     toughness: 4,
// };

// export const conservator: CardDefinition = {
//     id: "c7824e2a-4eff-4f72-9216-0db30a4f4252",
//     name: "Conservator",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

// export const copperTablet: CardDefinition = {
//     id: "30935e4a-013e-4c46-ad05-304df8e5dfa4",
//     name: "Copper Tablet",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// export const crystalRod: CardDefinition = {
//     id: "76693233-7961-4b7e-80f2-ed90e494c4aa",
//     name: "Crystal Rod",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const cyclopeanTomb: CardDefinition = {
//     id: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d",
//     name: "Cyclopean Tomb",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

// export const dingusEgg: CardDefinition = {
//     id: "65eb6cda-e512-40a8-9c1f-335b713409ff",
//     name: "Dingus Egg",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

// export const disruptingScepter: CardDefinition = {
//     id: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9",
//     name: "Disrupting Scepter",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// export const forcefield: CardDefinition = {
//     id: "3f2004c1-8efe-407f-bf48-27b807422eea",
//     name: "Forcefield",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// export const gauntletOfMight: CardDefinition = {
//     id: "da248001-ed75-4b68-9532-37d3cd5afc4c",
//     name: "Gauntlet of Might",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

// export const glassesOfUrza: CardDefinition = {
//     id: "cafc2350-5d64-4379-9198-79a114654d45",
//     name: "Glasses of Urza",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const helmOfChatzuk: CardDefinition = {
//     id: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393",
//     name: "Helm of Chatzuk",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// Howling Mine — "At the beginning of each player's draw step, if this
// artifact is untapped, that player draws an additional card."
// CR 603.6a (beginning-of-step trigger), CR 603.4 (intervening-if: condition
// checked at trigger time AND again at resolution). Fires on DRAW for both
// players — the active player at the time of the trigger is the one who
// draws, not the artifact's controller.
export const howlingMine: CardDefinition = {
    id: "51f8f6e1-a451-4262-90d3-5107caf54175",
    name: "Howling Mine",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        {
            id: "howling-mine-draw",
            oracleText:
                "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card.",
            event: "PHASE_BEGIN",
            matches: (event, self) => {
                if (event.type !== "PHASE_BEGIN") return false;
                if (event.phase !== "DRAW") return false;
                // CR 603.4: intervening-if — the artifact must be untapped at
                // the moment the trigger would go on the stack.
                return !self.isTapped;
            },
            resolve: (ctx, event) => {
                if (event.type !== "PHASE_BEGIN") return;
                // CR 603.4: intervening-if re-check at resolution. If the
                // artifact has been tapped (or left the battlefield) between
                // trigger and resolve, the ability does nothing.
                const sourceRef: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                if (ctx.getIsTapped(sourceRef)) return;
                ctx.drawCards(event.activePlayerId, 1);
            },
        },
    ],
};

// Icy Manipulator — "{1}, {T}: Tap target artifact, creature, or land."
// CR 701.20a (tap), CR 605 (activated abilities), CR 602.2 (target selection
// at activation). Uses the stack (not a mana ability) so it can be responded to.
export const icyManipulator: CardDefinition = {
    id: "29dc1596-a2e7-4d60-9f99-89babaef8a06",
    name: "Icy Manipulator",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "icy-manipulator-tap",
            oracleText: "{1}, {T}: Tap target artifact, creature, or land.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            targetRequirement: TARGET_ACL_PERMANENT,
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                ctx.tap(target);
            },
        },
    ],
};

// export const illusionaryMask: CardDefinition = {
//     id: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b",
//     name: "Illusionary Mask",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// export const ironStar: CardDefinition = {
//     id: "5786de12-cade-43c2-a6b0-0c5b294b9d0e",
//     name: "Iron Star",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const ivoryCup: CardDefinition = {
//     id: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd",
//     name: "Ivory Cup",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const jadeMonolith: CardDefinition = {
//     id: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a",
//     name: "Jade Monolith",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

// Jade Statue — "{2}: This artifact becomes a 3/6 Golem artifact creature
// until end of combat. Activate only during combat." (CR 208.2, 611.1,
// 511.3, 602.5). The "activate only during combat" restriction is enforced
// via `activationPhaseRestriction`; the animate-self effect uses the shared
// parametric-duration system with `phase: "end-of-combat"` so it reverts
// automatically at the END_OF_COMBAT step.
export const jadeStatue: CardDefinition = {
    id: "8d82d94b-ceef-4533-a4f2-b6442a61b839",
    name: "Jade Statue",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jade-statue-animate",
            oracleText:
                "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.",
            cost: { mana: { X: 2 } },
            useStack: true,
            activationPhaseRestriction: [
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "DECLARE_BLOCKERS",
                "FIRST_STRIKE_DAMAGE",
                "COMBAT_DAMAGE",
                "END_OF_COMBAT",
            ],
            resolve: (ctx: SpellContext) => {
                ctx.animateAsCreature(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    {
                        power: 3,
                        toughness: 6,
                        subtype: "Golem",
                        duration: { phase: "end-of-combat" },
                    }
                );
            },
        },
    ],
};

// Jayemdae Tome — "{4}, {T}: Draw a card." CR 107.1 (mana cost symbols), CR
// 602.1 (activated abilities), CR 121.1 (drawing a card). Uses the stack
// (useStack: true) — this is a non-mana activated ability (CR 605.1a).
export const jayemdaeTome: CardDefinition = {
    id: "cac8c421-5b92-481d-b2de-560c0231ab58",
    name: "Jayemdae Tome",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jayemdae-tome-draw",
            oracleText: "{4}, {T}: Draw a card.",
            cost: { tap: true, mana: { X: 4 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.caster, 1);
            },
        },
    ],
};

// Juggernaut — "This creature attacks each combat if able. This creature can't
// be blocked by Walls." CR 508.1d (attack requirement), CR 509.1b (block
// restriction by subtype).
export const juggernaut: CardDefinition = {
    id: "dcd6a291-5282-4f49-8203-d9b416083c48",
    name: "Juggernaut",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Juggernaut"],
    power: 5,
    toughness: 3,
    staticAbilities: ["attacks-if-able", "cant-be-blocked-by-wall"],
};

// export const kormusBell: CardDefinition = {
//     id: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6",
//     name: "Kormus Bell",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

// export const libraryOfLeng: CardDefinition = {
//     id: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495",
//     name: "Library of Leng",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const livingWall: CardDefinition = {
//     id: "4a98ada6-923a-44a5-bdef-ea6a160b481e",
//     name: "Living Wall",
//     manaCost: { X: 4 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Wall"],
//     power: 0,
//     toughness: 6,
// };

// export const manaVault: CardDefinition = {
//     id: "19499cb7-eccb-4e69-af32-6002d447a160",
//     name: "Mana Vault",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const meekstone: CardDefinition = {
//     id: "13a68a17-22ee-47c9-870a-83e911862b94",
//     name: "Meekstone",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

export const moxEmerald: CardDefinition = {
    id: "b0e1427c-05cd-465b-be59-97ed6e39f7ba",
    name: "Mox Emerald",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-emerald-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};

export const moxJet: CardDefinition = {
    id: "92bcd1ce-19b1-4d78-8b09-95242ca08d76",
    name: "Mox Jet",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-jet-mana",
            oracleText: "{T}: Add {B}.",
            produces: { B: 1 },
        }),
    ],
};

export const moxPearl: CardDefinition = {
    id: "8ebe4be7-e12a-4596-a899-fbd5b152e879",
    name: "Mox Pearl",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-pearl-mana",
            oracleText: "{T}: Add {W}.",
            produces: { W: 1 },
        }),
    ],
};

export const moxRuby: CardDefinition = {
    id: "8945585f-4773-493d-a0fe-d707db910b38",
    name: "Mox Ruby",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-ruby-mana",
            oracleText: "{T}: Add {R}.",
            produces: { R: 1 },
        }),
    ],
};

export const moxSapphire: CardDefinition = {
    id: "82da0972-b17b-4600-9efd-e9430a0db04b",
    name: "Mox Sapphire",
    manaCost: { X: 0 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mox-sapphire-mana",
            oracleText: "{T}: Add {U}.",
            produces: { U: 1 },
        }),
    ],
};

export const nevinyrralsDisk: CardDefinition = {
    id: "12926dc8-8e6f-4a47-a12b-4d674189615a",
    name: "Nevinyrral's Disk",
    manaCost: { X: 4 },
    types: ["Artifact"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "nevinyrral-destroy",
            oracleText:
                "{1}, {T}: Destroy all artifacts, creatures, and enchantments.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.destroyAll(["Artifact", "Creature", "Enchantment"]);
            },
        },
    ],
};

export const obsianusGolem: CardDefinition = {
    id: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418",
    name: "Obsianus Golem",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 4,
    toughness: 6,
};

// export const rodOfRuin: CardDefinition = {
//     id: "af957200-c538-4f52-b105-6db7a7abb4dc",
//     name: "Rod of Ruin",
//     manaCost: { X: 4 },
//     types: ["Artifact"],
// };

export const solRing: CardDefinition = {
    id: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd",
    name: "Sol Ring",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "sol-ring-mana",
            oracleText: "{T}: Add {C}{C}.",
            produces: { C: 2 },
        }),
    ],
};

// export const soulNet: CardDefinition = {
//     id: "2b814198-814b-4619-a158-327af675f8f2",
//     name: "Soul Net",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const sunglassesOfUrza: CardDefinition = {
//     id: "c0d433a4-76c0-4f27-836d-4c0c13a511fb",
//     name: "Sunglasses of Urza",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// export const theHive: CardDefinition = {
//     id: "544a7138-eae8-4ff9-9e17-680bfa717183",
//     name: "The Hive",
//     manaCost: { X: 5 },
//     types: ["Artifact"],
// };

// export const throneOfBone: CardDefinition = {
//     id: "a2931ae0-7836-4000-b9ec-f2029ebf5d96",
//     name: "Throne of Bone",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// export const timeVault: CardDefinition = {
//     id: "902441dc-c976-4c92-b897-6376eaa0fe38",
//     name: "Time Vault",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// Winter Orb — "Players can't untap more than one artifact, creature, or
// land during their untap steps." (CR 502.1) Encoded as a global static
// ability keyword; untapStep consults every battlefield for the marker and
// caps the active player's ACL (artifact/creature/land) untaps at one. The
// modern Oracle omits the "while Winter Orb is untapped" rider, so the
// restriction applies regardless of Winter Orb's own state.
export const winterOrb: CardDefinition = {
    id: "9359f60c-9a27-4e53-b35b-964a121a6fba",
    name: "Winter Orb",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["limits-acl-untap"],
};

// export const woodenSphere: CardDefinition = {
//     id: "bcae01a2-171b-47cd-87be-f1e4e5314326",
//     name: "Wooden Sphere",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

// --- Dual lands (LEA) ---
// Two basic land types for rules interactions (Armageddon, landwalk, etc.).
// The two mana abilities are modelled as a single choice ability so the
// frontend picker works the same as Birds of Paradise. Known limitation:
// `tapForPayment` auto-picks the first color — pre-tap with the picker to
// choose the other color.

export const badlands: CardDefinition = makeDualLand({
    id: "717f6d10-9144-4ade-9ac6-a481cc66b875",
    name: "Badlands",
    colors: ["B", "R"],
});

export const bayou: CardDefinition = makeDualLand({
    id: "412ceddd-2b9a-4551-a6bf-ae2830a2010a",
    name: "Bayou",
    colors: ["B", "G"],
});

export const plateau: CardDefinition = makeDualLand({
    id: "6eafa00b-c628-40f6-86eb-88e1361fc7a0",
    name: "Plateau",
    colors: ["R", "W"],
});

export const savannah: CardDefinition = makeDualLand({
    id: "94f7e24c-2546-41b6-81ad-5e920b07e64e",
    name: "Savannah",
    colors: ["G", "W"],
});

export const scrubland: CardDefinition = makeDualLand({
    id: "bebe39d4-21fb-46a4-a1ec-b97102e46c15",
    name: "Scrubland",
    colors: ["W", "B"],
});

export const taiga: CardDefinition = makeDualLand({
    id: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be",
    name: "Taiga",
    colors: ["R", "G"],
});

export const tropicalIsland: CardDefinition = makeDualLand({
    id: "a9c6c759-aabf-44e7-ba8c-33c5df232b56",
    name: "Tropical Island",
    colors: ["G", "U"],
});

export const tundra: CardDefinition = makeDualLand({
    id: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb",
    name: "Tundra",
    colors: ["W", "U"],
});

export const undergroundSea: CardDefinition = makeDualLand({
    id: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3",
    name: "Underground Sea",
    colors: ["U", "B"],
});

export const plains: CardDefinition = {
    id: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    name: "Plains",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Plains"],
};

export const island: CardDefinition = {
    id: "90a57c0e-fa61-45ef-955d-d296403967d5",
    name: "Island",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Island"],
};

export const swamp: CardDefinition = {
    id: "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
    name: "Swamp",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Swamp"],
};

export const mountain: CardDefinition = {
    id: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    name: "Mountain",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Mountain"],
};

export const forest: CardDefinition = {
    id: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
    name: "Forest",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Forest"],
};
