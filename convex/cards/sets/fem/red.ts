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
import { manaCostForCardId } from "../../manaCostLookup";

function colorsOfView(view: { card?: Record<string, unknown> }): string[] {
    const card = view.card ?? {};
    const inlined = (card as { manaCost?: import("../../types").ManaCost })
        .manaCost;
    const cardId = (card as { id?: string }).id;
    const cost = inlined ?? (cardId ? manaCostForCardId(cardId) : undefined);
    if (!cost) return [];
    return (["W", "U", "B", "R", "G"] as const).filter(
        (c) => (cost[c] ?? 0) > 0
    );
}

const GOBLIN_TOKEN: TokenSpec = {
    name: "Goblin",
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    colors: ["R"],
};

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
    // MIGRATION DEFERRED (ADR 0045): the effect is a trivial
    // `[{ op: "dealDamage", amount: 5, to: { target: 0 } }]`, but the
    // auto-generated smoke sweep (scenarioGenerator) asserts the damaged target
    // SURVIVES with `damageMarked`, using a toughness-5 filler creature. 5 damage
    // is lethal to that filler, so the generated assertion fails. Blocked on a
    // generator skip for amount ≥ filler-toughness (shared test infra, out of the
    // light-lane migration file scope). Behaviour is unchanged and covered by the
    // Goblin Grenade per-card test.
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
            // NOT DSL-migratable (ADR 0045): "Sacrifice two Goblins" is an
            // ACTIVATION COST paid in-resolve via a requestChoice+sacrifice
            // (count exactly 2, else fizzle). The `createToken` Op (#847) covers
            // the three-Goblin creation, but a choice→sacrifice→createToken DSL
            // chain would fire createToken even when fewer than two Goblins are
            // sacrificed (choice clamps to available) — granting the tokens
            // without paying the full cost (CR 118.3). The `if` predicate can't
            // test a choice binding's cardinality, so the cost-gating is not
            // expressible (same class as Psychic Frog, #841). Stays resolve().
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
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.15a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
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
            // NOT DSL-migratable (ADR 0045, assessed #851): the grant-flying +
            // delayedTrigger halves ARE expressible (grantAbility + a
            // delayedTrigger Op capturing the creature), but the delayed body
            // must "sacrifice that creature" — a SINGLE captured object — and
            // the `sacrifice` Op only consumes a `choice` Op's picks binding (an
            // array of player-chosen ids read via recallChoice), not a bound
            // single object (a delayed capture / snapshot). Migrating the card
            // would leave the body un-migratable, so the whole card stays
            // resolve(). Blocked on: a sacrifice-single-bound-object capability
            // (planned backlog Op `sacrificeObject`, mechanicsRegistry.ts).
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
            // NOT DSL-migratable (ADR 0045, assessed #851): "sacrifice that
            // creature" sacrifices a SINGLE captured object, which the
            // `sacrifice` Op (picks-consuming only) cannot express — see the
            // activated ability above. Blocked on: `sacrificeObject`.
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
            // Migrated resolve()→effects[] (ADR 0045, #851): a `coinFlip` Op on
            // the announced Orc target — win → +2/+0, loss → -0/-2, both until
            // end of turn (CR 705 / 613.4c, the suspending reveal flip).
            effects: [
                {
                    op: "coinFlip",
                    win: {
                        consequence: "Target Orc gets +2/+0.",
                        effects: [
                            {
                                op: "pump",
                                target: { target: 0 },
                                power: 2,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                    loss: {
                        consequence: "Target Orc gets -0/-2.",
                        effects: [
                            {
                                op: "pump",
                                target: { target: 0 },
                                power: 0,
                                toughness: -2,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                },
            ],
        },
    ],
};

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
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant first
            // strike until end of turn (CR 611.1b).
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
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

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

export const dwarvenCatapult: CardDefinition = {
    id: "8c1c6932-638a-4df7-bf9b-8d921f7484d9", // FEM 51
    rarity: "uncommon",
    name: "Dwarven Catapult",
    oracleText:
        "Dwarven Catapult deals X damage divided evenly, rounded down, among all creatures target opponent controls.",
    manaCost: { X: "X", R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    // NOT DSL-migratable (ADR 0045, #852): "X damage divided evenly, rounded
    // down, among all creatures" is floor(X / creatureCount) dealt to each —
    // ARITHMETIC (division by a runtime count) the value grammar has no
    // construct for. `{ X: true }` supplies X but cannot divide it. Classifier
    // over-count (folds dealDamageToEach → dealDamage + getX, blind to the math).
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
