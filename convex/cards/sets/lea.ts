import type {
    ActivatedAbilityContext,
    CardDefinition,
    Color,
    DelayedTriggerDef,
    ManaCost,
    PermanentFilter,
    PermanentView,
    SpellContext,
    SpellMode,
    StaticEffectContext,
    StaticEffectStateView,
    TargetSelection,
    TriggeredAbility,
    TriggerStateView,
} from "../types";
import {
    AURA_AFFECTS_HOST,
    EFFECT_AFFECTS_SELF,
    TARGET_ACL_PERMANENT,
} from "../types";
import {
    knightStaticAbilities,
    makeCircleOfProtection,
    makeDualLand,
    makeTapForMana,
} from "../abilities";
import { stateTrigger } from "../abilities/triggers/stateTrigger";
import { leftTrigger } from "../abilities/triggers/leftTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { damageTakenTrigger } from "../abilities/triggers/damageTakenTrigger";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../abilities/static/untapRestriction";
import { tokenPrintIdFor } from "../tokenPrintLookup";

// Animate Wall — "Enchant Wall. Enchanted Wall can attack as though it didn't
// have defender." (CR 702.3, 613.1a layer 6 keyword removal). Aura removes
// defender from its host, allowing the Wall to be declared as an attacker.
export const animateWall: CardDefinition = {
    id: "d5c83259-9b90-47c2-b48e-c7d78519e792",
    name: "Animate Wall",
    oracleText:
        "Enchant Wall\nEnchanted Wall can attack as though it didn't have defender.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1, subtypeFilter: "Wall" },
    staticEffects: [
        {
            kind: "keyword-remove",
            applies: AURA_AFFECTS_HOST,
            keyword: "defender",
        },
    ],
};

export const armageddon: CardDefinition = {
    id: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb",
    name: "Armageddon",
    oracleText: "Destroy all lands.",
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
    oracleText:
        "Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players discard cards and sacrifice creatures the same way.",
    manaCost: { X: 1, W: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        balanceEqualizeLands,
        balanceEqualizeHand,
        balanceEqualizeCreatures,
    ],
};

// Benalish Hero — vanilla 1/1 with banding (CR 702.21). The keyword lives in
// staticAbilities[]; the combat engine reads it to expand band-blocking and
// shift combat-damage assignment authority (CR 702.21j-k).
export const benalishHero: CardDefinition = {
    id: "11600105-56c6-4073-a4a6-8469030b39c9",
    name: "Benalish Hero",
    oracleText:
        "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    staticAbilities: ["banding"],
};

export const blackWard: CardDefinition = makeColorWard({
    id: "15967a39-303f-457d-bcde-51837c8d63e1",
    name: "Black Ward",
    oracleText:
        "Enchant creature\nEnchanted creature has protection from black. This effect doesn't remove this Aura.",
    color: "black",
});

// Blaze of Glory — "Cast this spell only during combat before blockers are
// declared. Target creature defending player controls can block any number
// of creatures this turn. It blocks each attacking creature this turn if
// able." (CR 509.1a — multi-block, CR 509.1c — must-block-all).
// castPhaseRestriction limits to BEGINNING_OF_COMBAT and DECLARE_ATTACKERS.
export const blazeOfGlory: CardDefinition = {
    id: "98fba951-c5bb-497c-9292-ce1b2a1e1247",
    name: "Blaze of Glory",
    oracleText:
        "Cast this spell only during combat before blockers are declared.\nTarget creature defending player controls can block any number of creatures this turn. It blocks each attacking creature this turn if able.",
    manaCost: { W: 1 },
    types: ["Instant"],
    castPhaseRestriction: ["BEGINNING_OF_COMBAT", "DECLARE_ATTACKERS"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") {
            ctx.setCanBlockAdditional(target, 999);
            ctx.setMustBlockAll(target);
        }
    },
};

// Blessing — "Enchant creature. {W}: Enchanted creature gets +1/+1 until
// end of turn." (CR 303.4 aura, CR 611.1 temp P/T mod, activated-on-aura
// pumping the host — same shape as holyArmor's pump.)
export const blessing: CardDefinition = {
    id: "f131fd27-18da-47ca-b59f-135bcac83abd",
    name: "Blessing",
    oracleText:
        "Enchant creature\n{W}: Enchanted creature gets +1/+1 until end of turn.",
    manaCost: { W: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "blessing-pump",
            oracleText: "{W}: Enchanted creature gets +1/+1 until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const blueWard: CardDefinition = makeColorWard({
    id: "93f9f0f2-e1cc-4740-888c-1336c6de0a27",
    name: "Blue Ward",
    oracleText:
        "Enchant creature\nEnchanted creature has protection from blue. This effect doesn't remove this Aura.",
    color: "blue",
});

// Castle — "Untapped creatures you control get +0/+2." (CR 611, 613 — static layer 7c)
export const castle: CardDefinition = {
    id: "b0da8d56-3178-44c2-9344-95d2346d326f",
    name: "Castle",
    oracleText: "Untapped creatures you control get +0/+2.",
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
// CoPs share identical behavior modulo the color filter (CR 615.1, 615.6),
// built from the shared `makeCircleOfProtection` factory (also used by the
// Beta-original Circle of Protection: Black in leb.ts).

export const circleOfProtectionBlue: CardDefinition = makeCircleOfProtection({
    id: "848b1a7f-e8ba-40b5-92b7-af1e963a0319",
    name: "Circle of Protection: Blue",
    oracleText:
        "{1}: The next time a blue source of your choice would deal damage to you this turn, prevent that damage.",
    color: "U",
    colorWord: "Blue",
});

export const circleOfProtectionGreen: CardDefinition = makeCircleOfProtection({
    id: "1ae32d20-b438-4f43-b603-e8f706ecfb03",
    name: "Circle of Protection: Green",
    oracleText:
        "{1}: The next time a green source of your choice would deal damage to you this turn, prevent that damage.",
    color: "G",
    colorWord: "Green",
});

export const circleOfProtectionRed: CardDefinition = makeCircleOfProtection({
    id: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e",
    name: "Circle of Protection: Red",
    oracleText:
        "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.",
    color: "R",
    colorWord: "Red",
});

export const circleOfProtectionWhite: CardDefinition = makeCircleOfProtection({
    id: "92df19c9-e127-42d9-8dd2-7fa5a7095428",
    name: "Circle of Protection: White",
    oracleText:
        "{1}: The next time a white source of your choice would deal damage to you this turn, prevent that damage.",
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
    oracleText:
        "Enchant land\nEnchanted land has indestructible and can't be enchanted by other Auras.",
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

// Conversion — "At the beginning of your upkeep, sacrifice this enchantment
// unless you pay {W}{W}. All Mountains are Plains." (CR 305.7 global
// subtype replacement, CR 603.6a upkeep trigger, CR 117.3a pay-or-else).
// Layer 4 subtype-set replaces subtypes on every permanent with subtype
// "Mountain" with ["Plains"], changing their mana production.
export const conversion: CardDefinition = {
    id: "13186bc9-8d9c-433b-ba15-121ef94dd68a",
    name: "Conversion",
    oracleText:
        "At the beginning of your upkeep, sacrifice Conversion unless you pay {W}{W}.\nAll Mountains are Plains.",
    manaCost: { X: 2, W: 2 },
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
            id: "conversion-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice Conversion unless you pay {W}{W}.",
            cost: { W: 2 },
            prompt: "Pay {W}{W} to keep Conversion?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Crusade — "White creatures get +1/+1." (CR 611 — static layer 7c, color via
// CR 202.2). Mirrors Bad Moon's structure but filtered on white instead of
// black. Affects creatures of either controller.
export const crusade: CardDefinition = {
    id: "057986c7-20c0-4157-b4df-beae4ef5c66d",
    name: "Crusade",
    oracleText: "White creatures get +1/+1.",
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
    oracleText: "Regenerate target creature.",
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
    oracleText: "Destroy target artifact or enchantment.",
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
    oracleText:
        'Enchant land\nEnchanted land has "At the beginning of your upkeep, you may pay {W}{W}. If you do, you gain 1 life."',
    manaCost: { W: 3 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Land",
        count: 1,
        subtypeFilter: "Plains",
    },
    triggeredAbilities: [
        phaseTrigger({
            id: "farmstead-upkeep",
            oracleText:
                "At the beginning of the upkeep step of enchanted land's controller, that player gains 2 life.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.gainLife(hostController, 2);
            },
        }),
    ],
};

export const greenWard: CardDefinition = makeColorWard({
    id: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e",
    name: "Green Ward",
    oracleText:
        "Enchant creature\nEnchanted creature has protection from green. This effect doesn't remove this Aura.",
    color: "green",
});

export const guardianAngel: CardDefinition = {
    id: "0f84d676-5327-454c-a033-b4498a9d28e2",
    name: "Guardian Angel",
    oracleText:
        "Prevent the next X damage that would be dealt to any target this turn. Until end of turn, you may pay {1} any time you could cast an instant. If you do, prevent the next 1 damage that would be dealt to that permanent or player this turn.",
    manaCost: { X: "X", W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t) return;
        const x = ctx.getX();
        if (x > 0) {
            ctx.preventNextNDamageToTarget(t, x, { phase: "end-of-turn" });
        }
    },
};

// Healing Salve — "Choose one — Target player gains 3 life. OR Prevent the
// next 3 damage that would be dealt to any target this turn." (CR 700.2
// modal — chooser picks one mode at announcement, the chosen mode's
// targetRequirement drives target selection.)
export const healingSalve: CardDefinition = {
    id: "e28de37e-84d5-4dc7-b36c-e14da5924729",
    name: "Healing Salve",
    oracleText:
        "Choose one —\n• Target player gains 3 life.\n• Prevent the next 3 damage that would be dealt to any target this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "gain-life",
            label: "Gain 3 life",
            oracleText: "Target player gains 3 life.",
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "player") return;
                ctx.gainLife(t.id, 3);
            },
        },
        {
            id: "prevent",
            label: "Prevent next 3 damage",
            oracleText:
                "Prevent the next 3 damage that would be dealt to any target this turn.",
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (!t) return;
                ctx.preventNextNDamageToTarget(t, 3, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// Holy Armor — "Enchant creature. Enchanted creature gets +0/+2. {1}{W}:
// Enchanted creature gets +0/+3 until end of turn." (CR 303.4 aura, 611
// static layer 7c, 611.1 temp P/T mod). Static buff stacks with the activated
// pump on the same host (both summed at read time).
export const holyArmor: CardDefinition = {
    id: "b01041d2-687e-4972-81c8-16690809275b",
    name: "Holy Armor",
    oracleText:
        "Enchant creature\nEnchanted creature gets +0/+2.\n{W}: Enchanted creature gets +0/+1 until end of turn.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 0,
            toughness: 2,
        },
    ],
    activatedAbilities: [
        {
            id: "holy-armor-pump",
            oracleText:
                "{1}{W}: Enchanted creature gets +0/+3 until end of turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    0,
                    3,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Holy Strength — "Enchant creature. Enchanted creature gets +1/+2." (CR 303.4
// aura attachment, 611 static layer 7c). Plain pt-buff aura — same shape as
// the future Unholy Strength / Weakness, all reusing AURA_AFFECTS_HOST.
export const holyStrength: CardDefinition = {
    id: "e945a4cd-0eb1-4f54-898d-169ce2748a03",
    name: "Holy Strength",
    oracleText: "Enchant creature\nEnchanted creature gets +1/+2.",
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

// Island Sanctuary — "If you would draw a card during your draw step, instead
// you may skip that draw. If you do, until your next turn, you can't be
// attacked except by creatures with flying and/or islandwalk." (CR 614 draw
// replacement). The `drawStepReplacement` flag suppresses the automatic draw;
// a phaseTrigger at DRAW asks the player whether to skip or draw.
export const islandSanctuary: CardDefinition = {
    id: "c15e8a42-89de-42bc-8d5f-33426d207c3a",
    name: "Island Sanctuary",
    oracleText:
        "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by creatures with flying and/or islandwalk.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    drawStepReplacement: true,
    triggeredAbilities: [
        phaseTrigger({
            id: "island-sanctuary-draw-choice",
            oracleText:
                "Skip your draw? If you do, you can't be attacked except by creatures with flying or islandwalk until your next turn.",
            phase: "DRAW",
            scope: "your",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: "island-sanctuary-skip",
                    prompt: "Skip your draw for Island Sanctuary protection? (Only flying/islandwalk creatures can attack you until your next turn.)",
                });
                if (accept === undefined) return;
                if (accept) {
                    ctx.setIslandSanctuaryProtection(ctx.controller);
                } else {
                    ctx.drawCards(ctx.controller, 1);
                }
            },
        }),
    ],
};

// Karma — "At the beginning of each player's upkeep, Karma deals damage to
// that player equal to the number of Swamps they control." (CR 603.6a phase
// trigger, 120.1 damage). Fires on every player's UPKEEP — the active player
// at trigger time is the one taking the damage, not Karma's controller.
export const karma: CardDefinition = {
    id: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4",
    name: "Karma",
    oracleText:
        "At the beginning of each player's upkeep, this enchantment deals damage to that player equal to the number of Swamps they control.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "karma-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, Karma deals damage to that player equal to the number of Swamps they control.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, playerId) => {
                const swamps = ctx.getBattlefieldIds(playerId, {
                    subtypes: "Swamp",
                }).length;
                if (swamps > 0) {
                    ctx.dealDamage({ type: "player", id: playerId }, swamps);
                }
            },
        }),
    ],
};

// Lance — "Enchant creature. Enchanted creature has first strike." (CR 303.4
// aura attachment, 702.7 first strike, 611.2 keyword grant via static effect).
export const lance: CardDefinition = {
    id: "ddb633f5-cc4d-4157-8217-def90cb15e24",
    name: "Lance",
    oracleText: "Enchant creature\nEnchanted creature has first strike.",
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

// Mesa Pegasus — 1/1 with flying + banding. Both keywords coexist in
// staticAbilities[]; flying governs evasion (CR 702.9) and banding governs
// combat-damage assignment (CR 702.21).
export const mesaPegasus: CardDefinition = {
    id: "eaac88da-d19e-4771-944c-3709963d04e7",
    name: "Mesa Pegasus",
    oracleText:
        "Flying; banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Pegasus"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying", "banding"],
};

// Northern Paladin — "{W}{W}, {T}: Destroy target black creature." (CR 701.7
// destroy, 202.2 color filter on target).
export const northernPaladin: CardDefinition = {
    id: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2",
    name: "Northern Paladin",
    oracleText: "{W}{W}, {T}: Destroy target black permanent.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "northern-paladin-destroy",
            oracleText: "{W}{W}, {T}: Destroy target black creature.",
            cost: { mana: { W: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilter: "B",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};

export const pearledUnicorn: CardDefinition = {
    id: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8",
    name: "Pearled Unicorn",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Unicorn"],
    power: 2,
    toughness: 2,
};

// Personal Incarnation — LEA original oracle: "All damage that would be
// dealt to its owner is dealt to Personal Incarnation instead. When Personal
// Incarnation dies, its owner loses half their life, rounded up." (CR 614
// continuous damage replacement + CR 603 dies-trigger.)
//
// Scope notes: the LEA card carries the redirection statically — modern
// reprints split it into an activated next-1 ability, but we model the LEA
// printed text as a continuous replacement keyed on `event.target.ownerId
// === self.ownerId`. The dies-trigger reads `event.ownerId` from the
// PERMANENT_LEFT payload so a control-changed Personal Incarnation still
// damages its ORIGINAL owner (CR 109.5 ownership is permanent).
export const personalIncarnation: CardDefinition = {
    id: "caf9cef4-0f2d-478a-b119-fe1967687f74",
    name: "Personal Incarnation",
    oracleText:
        "All damage that would be dealt to its owner is dealt to Personal Incarnation instead.\nWhen this creature dies, its owner loses half their life, rounded up.",
    manaCost: { X: 4, W: 3 },
    types: ["Creature"],
    subtypes: ["Avatar", "Incarnation"],
    power: 6,
    toughness: 6,
    replacementEffects: [
        {
            id: "pinc-redirect",
            oracleText:
                "All damage that would be dealt to its owner is dealt to Personal Incarnation instead.",
            eventKind: "damage",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "player") return false;
                return event.target.id === self.ownerId;
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        target: { type: "permanent", id: ctx.self.id },
                    },
                };
            },
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "pinc-ltb",
            oracleText:
                "When this creature dies, its owner loses half their life, rounded up.",
            scope: "self",
            toZone: "graveyard",
            resolve: (ctx, _event, leaving) => {
                const life = ctx.getLife(leaving.ownerId);
                const loss = Math.ceil(life / 2);
                if (loss > 0) ctx.loseLife(leaving.ownerId, loss);
            },
        }),
    ],
};

// CR 305.7 / 613.1d layer 5 — lace cycle factory
function makeLace(args: {
    id: string;
    name: string;
    oracleText: string;
    manaCost: ManaCost;
    color: Color;
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        oracleText: args.oracleText,
        manaCost: args.manaCost,
        types: ["Instant"],
        targetRequirement: { type: "spell-or-permanent", count: 1 },
        resolve: (ctx: SpellContext) => {
            const t = ctx.targets[0];
            if (!t) return;
            ctx.setColorOverride(t, [args.color]);
        },
    };
}

export const purelace: CardDefinition = makeLace({
    id: "2facf462-55cd-4da4-997f-2cf4add75628",
    name: "Purelace",
    oracleText:
        "Target spell or permanent becomes white. (Mana symbols on that permanent remain unchanged.)",
    manaCost: { W: 1 },
    color: "W",
});

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
    oracleText?: string;
    color: "white" | "blue" | "black" | "red" | "green";
}): CardDefinition {
    const keyword = `protection from ${args.color}`;
    return {
        id: args.id,
        name: args.name,
        oracleText: args.oracleText,
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
    oracleText:
        "Enchant creature\nEnchanted creature has protection from red. This effect doesn't remove this Aura.",
    color: "red",
});

// Resurrection — "Return target creature card from your graveyard to the
// battlefield." (CR 400.7 zone change, CR 302.1 summoning sickness applies to
// the freshly-entered creature.) The targetRequirement zone:"graveyard" +
// controller:"you" triple narrows legal picks to a creature card in the
// caster's own graveyard at cast time (CR 601.2c); the resolve re-checks
// implicitly because `returnToBattlefield` silently fizzles if the card has
// left the graveyard between cast and resolution (CR 608.2b).
export const resurrection: CardDefinition = {
    id: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c",
    name: "Resurrection",
    oracleText:
        "Return target creature card from your graveyard to the battlefield.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card" || !t.playerId) return;
        ctx.returnToBattlefield(t.playerId, t.id, "graveyard");
    },
};

// Reverse Damage — "The next time a source of your choice would deal damage
// to you this turn, prevent that damage. You gain life equal to the damage
// prevented this way." (CR 614 one-shot transient replacement.) Pushes a
// `prevent-from-source-gain-life` shield keyed on the chosen source and the
// caster. The shield's body fires when matching damage is intercepted: the
// damage is fully absorbed and the caster gains life equal to the absorbed
// amount in a single atomic step.
//
// "Source of your choice" (CR 109.4) accepts either a battlefield permanent
// or a stack item (instant/sorcery/activated ability). The `["any","spell"]`
// target union covers both: `any` yields creatures/planeswalkers/players, and
// `spell` yields stack items. Players are excluded from being a damage
// source in practice (the prevention check keys on `sourceInstanceId`).
export const reverseDamage: CardDefinition = {
    id: "943baea8-b173-4863-a3ab-dd217d483cd9",
    name: "Reverse Damage",
    oracleText:
        "The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way.",
    manaCost: { X: 1, W: 2 },
    types: ["Instant"],
    targetRequirement: { type: ["any", "spell"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t) return;
        ctx.addDamageRedirectionShield({
            kind: "prevent-from-source-gain-life",
            sourceInstanceId: t.id,
            playerId: ctx.caster,
            duration: { phase: "end-of-turn" },
        });
    },
};

export const righteousness: CardDefinition = {
    id: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb",
    name: "Righteousness",
    oracleText: "Target blocking creature gets +7/+7 until end of turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        combatRoleFilter: "blocking",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target) return;
        ctx.addTemporaryPTBuff(target, 7, 7, { phase: "end-of-turn" });
    },
};

// Samite Healer — "{T}: Prevent the next 1 damage that would be dealt to
// any target this turn." (CR 615.1, 120.3 "any target" = creature/player).
// Drops a 1-damage shield on the chosen target via the
// `preventNextNDamageToTarget` primitive; shield is consumed by the next
// damage event regardless of source, leftover wears off at CLEANUP.
export const samiteHealer: CardDefinition = {
    id: "efba235e-04e5-449c-906c-0ac33f6d7929",
    name: "Samite Healer",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "samite-healer-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { tap: true },
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
    oracleText:
        "Flying\nVigilance (Attacking doesn't cause this creature to tap.)",
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
    oracleText:
        "Exile target creature. Its controller gains life equal to its power.",
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

// Veteran Bodyguard — "As long as Veteran Bodyguard remains untapped, all
// damage that would be dealt to you by unblocked attacking creatures is
// dealt to Veteran Bodyguard instead." (CR 614 continuous damage
// replacement, gated on self.isTapped + source-must-be-unblocked-attacker.)
// The combat lookup comes through `ReplacementStateView.combat` which mirrors
// `state.combat.{attackerIds, blockerAssignments}`.
export const veteranBodyguard: CardDefinition = {
    id: "cbd9ab01-a833-4fa4-8dee-151bd9800835",
    name: "Veteran Bodyguard",
    oracleText:
        "As long as Veteran Bodyguard remains untapped, all damage that would be dealt to you by unblocked attacking creatures is dealt to Veteran Bodyguard instead.",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 4,
    replacementEffects: [
        {
            id: "vbg-redirect",
            oracleText:
                "All damage from unblocked attacking creatures that would be dealt to you is dealt to Veteran Bodyguard instead.",
            eventKind: "damage",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "player") return false;
                if (event.target.id !== self.controllerId) return false;
                if (self.isTapped) return false;
                if (!event.isCombat) return false;
                const combat = state.combat;
                if (!combat) return false;
                if (!combat.attackerIds.includes(event.sourceInstanceId))
                    return false;
                const blockers =
                    combat.blockersByAttacker[event.sourceInstanceId] ?? [];
                return blockers.length === 0;
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        target: { type: "permanent", id: ctx.self.id },
                    },
                };
            },
        },
    ],
};

export const wallOfSwords: CardDefinition = {
    id: "99ec4723-b36c-4015-b361-736a6523e8f5",
    name: "Wall of Swords",
    oracleText: "Defender (This creature can't attack.)\nFlying",
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
    oracleText:
        "First strike (This creature deals combat damage before creatures without first strike.)\nProtection from black (This creature can't be blocked, targeted, dealt damage, or enchanted by anything black.)",
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
    oracleText:
        "Enchant creature\nEnchanted creature has protection from white. This effect doesn't remove this Aura.",
    color: "white",
});

// Wrath of God — "Destroy all creatures. They can't be regenerated."
// (CR 701.7, 701.15c). The `cantBeRegenerated` rider suppresses any
// regeneration shields the victims may have stacked; indestructible still
// protects (CR 702.12).
export const wrathOfGod: CardDefinition = {
    id: "a2788d69-6a3a-42f0-8736-cc6b57755ecd",
    name: "Wrath of God",
    oracleText: "Destroy all creatures. They can't be regenerated.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Creature", { cantBeRegenerated: true });
    },
};

export const airElemental: CardDefinition = {
    id: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea",
    name: "Air Elemental",
    oracleText: "Flying",
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
    oracleText: "Target player draws three cards.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") ctx.drawCards(target.id, 3);
    },
};

// Animate Artifact — "Enchant artifact. As long as enchanted artifact
// isn't a creature, it's an artifact creature with power and toughness
// each equal to its mana value." (CR 303.4 aura, CR 205 type-add via
// layer-4 surrogate `type-add`, CR 604.3 / 613 layer 7b CDA P/T derived
// from the host's printed mana value.) Predicate gates on the host not
// already being a Creature at apply-time (CR 205 layer-4 — close enough
// for LEA scope; full layer-1-through-7 recompute is out of scope).
export const animateArtifact: CardDefinition = {
    id: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357",
    name: "Animate Artifact",
    oracleText:
        "Enchant artifact\nAs long as enchanted artifact isn't a creature, it's an artifact creature with power and toughness each equal to its mana value.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    staticEffects: [
        {
            kind: "type-add",
            applies: (target, source, ctx) =>
                AURA_AFFECTS_HOST(target, source, ctx) &&
                !ctx.isCreature(target),
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target, source, ctx) =>
                AURA_AFFECTS_HOST(target, source, ctx),
            compute: (_source, _state, ctx, target) => {
                const mv = ctx.getManaValue(target);
                return { power: mv, toughness: mv };
            },
        },
    ],
};

// Helper for the {U}/{R} "elemental blast" pair (CR 700.2 modal — counter
// target X spell OR destroy target X permanent). Both modes use the
// `colorFilter` propagated from the mode's targetRequirement.
function makeElementalBlast(args: {
    id: string;
    name: string;
    oracleColor: string;
    castColor: "U" | "R";
    targetColor: "U" | "R";
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        oracleText: `Choose one —\n• Counter target ${args.oracleColor} spell.\n• Destroy target ${args.oracleColor} permanent.`,
        manaCost: { [args.castColor]: 1 },
        types: ["Instant"],
        modes: [
            {
                id: "counter",
                label: `Counter target ${args.oracleColor} spell`,
                oracleText: `Counter target ${args.oracleColor} spell.`,
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    colorFilter: args.targetColor,
                },
                resolve: (ctx) => {
                    const t = ctx.targets[0];
                    if (t?.type === "spell") ctx.counter(t);
                },
            },
            {
                id: "destroy",
                label: `Destroy target ${args.oracleColor} permanent`,
                oracleText: `Destroy target ${args.oracleColor} permanent.`,
                targetRequirement: {
                    type: "any",
                    count: 1,
                    colorFilter: args.targetColor,
                },
                resolve: (ctx) => {
                    const t = ctx.targets[0];
                    if (t?.type === "permanent") ctx.destroy(t);
                },
            },
        ],
    };
}

export const blueElementalBlast: CardDefinition = makeElementalBlast({
    id: "20d666ef-39bf-4fbf-8201-5f1056539da2",
    name: "Blue Elemental Blast",
    oracleColor: "red",
    castColor: "U",
    targetColor: "R",
});

// Braingeyser — "Target player draws X cards." (CR 107.3 X cost, 121.1 draw,
// 601.2b X chosen on cast, 608.3 sorcery resolution).
export const braingeyser: CardDefinition = {
    id: "62b19a12-6914-430e-81ce-dcfca47884df",
    name: "Braingeyser",
    oracleText: "Target player draws X cards.",
    manaCost: { X: "X", U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") ctx.drawCards(target.id, ctx.getX());
    },
};

// Clone — "You may have Clone enter the battlefield as a copy of any creature
// on the battlefield." (CR 707.2 copy effect, 614.12 as-enters replacement.)
// The copy choice runs in a resolve step while Clone is still on the stack;
// `becomeCopyOf` overwrites its copiable characteristics before it enters.
// Declining (or no creatures present) leaves it a 0/0 that dies to SBA
// (CR 704.5f).
export const clone: CardDefinition = {
    id: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3",
    name: "Clone",
    oracleText:
        "You may have Clone enter the battlefield as a copy of any creature on the battlefield.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                }).length;
            }
            if (candidates === 0) return; // enters as a 0/0
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "clone-may-copy",
                prompt: "Have Clone enter as a copy of a creature?",
            });
            if (accept === undefined) return; // suspended
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "clone-copy-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Creature" },
                count: 1,
                prompt: "Choose a creature for Clone to copy.",
            });
            if (picks === undefined) return; // suspended
            if (picks.length === 1) ctx.becomeCopyOf(picks[0]);
        },
    ],
};

// Control Magic — "Enchant creature. You control enchanted creature."
// (CR 303.4 aura attachment, 611.2 continuous static ability, 613.1b layer 2
// control-changing effect, 702.10c summoning sickness reset on control change)
export const controlMagic: CardDefinition = {
    id: "7b52f459-c703-4a0b-9114-ff69eec61287",
    name: "Control Magic",
    oracleText: "Enchant creature\nYou control enchanted creature.",
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

// Copy Artifact — "You may have Copy Artifact enter the battlefield as a copy
// of any artifact on the battlefield, except it's an enchantment in addition
// to its other types." (CR 707.2 copy effect with a type-adding exception,
// CR 707.9d.) The copy keeps the Enchantment type via `additionalTypes`.
// Declining (or no artifacts present) leaves it a do-nothing enchantment.
export const copyArtifact: CardDefinition = {
    id: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063",
    name: "Copy Artifact",
    oracleText:
        "You may have Copy Artifact enter the battlefield as a copy of any artifact on the battlefield, except it's an enchantment in addition to its other types.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Artifact",
                }).length;
            }
            if (candidates === 0) return;
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "copy-artifact-may-copy",
                prompt: "Have Copy Artifact enter as a copy of an artifact?",
            });
            if (accept === undefined) return;
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "copy-artifact-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Artifact" },
                count: 1,
                prompt: "Choose an artifact for Copy Artifact to copy.",
            });
            if (picks === undefined) return;
            if (picks.length === 1) {
                ctx.becomeCopyOf(picks[0], {
                    additionalTypes: ["Enchantment"],
                });
            }
        },
    ],
};

// Counterspell — "Counter target spell." (CR 701.5a)
export const counterspell: CardDefinition = {
    id: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    name: "Counterspell",
    oracleText: "Counter target spell.",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "spell") ctx.counter(target);
    },
};

// Creature Bond — "Enchant creature. When enchanted creature dies, this Aura
// deals damage equal to that creature's toughness to the creature's
// controller." (CR 303.4 aura attachment, 603.2 death trigger, 603.10 last
// known information for the host's toughness). The trigger fires before SBA
// orphan-aura cleanup so `self.attachedTo` is still set when matched; the
// resolve reads the host's toughness from the event snapshot.
export const creatureBond: CardDefinition = {
    id: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c",
    name: "Creature Bond",
    oracleText:
        "Enchant creature\nWhen enchanted creature dies, this Aura deals damage equal to that creature's toughness to the creature's controller.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        diedTrigger({
            id: "creature-bond-death",
            oracleText:
                "When enchanted creature dies, Creature Bond deals damage equal to that creature's toughness to the creature's controller.",
            scope: "any",
            condition: (event, self) =>
                event.creatureInstanceId === self.attachedTo,
            resolve: (ctx, _event, dead) => {
                ctx.dealDamage(
                    { type: "player", id: dead.controllerId },
                    dead.lastKnownToughness
                );
            },
        }),
    ],
};

// Feedback — "Enchant enchantment. At the beginning of the upkeep of enchanted
// enchantment's controller, Feedback deals 1 damage to that player." (CR 303.4
// aura attachment to a non-creature host, 603.6a phase trigger). Trigger fires
// only on the host's controller's upkeep — same lookup pattern as Farmstead.
export const feedback: CardDefinition = {
    id: "0eb8f591-d763-49bf-8ef9-86265aaa72f7",
    name: "Feedback",
    oracleText:
        "Enchant enchantment\nAt the beginning of the upkeep of enchanted enchantment's controller, this Aura deals 1 damage to that player.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Enchantment", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "feedback-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted enchantment's controller, Feedback deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 1);
            },
        }),
    ],
};

// Flight — "Enchant creature. Enchanted creature has flying." (CR 303.4 aura
// attachment, 702.9 flying, 611.2 keyword grant via static effect).
export const flight: CardDefinition = {
    id: "67c7784b-6b79-4268-a714-895c82809aff",
    name: "Flight",
    oracleText: "Enchant creature\nEnchanted creature has flying.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
};

// Invisibility — "Enchant creature. Enchanted creature can't be blocked
// except by Walls." (CR 303.4 aura, 509.1b block restriction). The
// block-restriction is on the aura's staticEffects; the combat validator
// discovers it by scanning permanents attached to the attacker.
export const invisibility: CardDefinition = {
    id: "1858ac51-e6a7-48d7-8759-166070ca13d8",
    name: "Invisibility",
    oracleText:
        "Enchant creature\nEnchanted creature can't be blocked except by Walls.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "invisibility-wall-only",
            side: "attacker" as const,
            // CR 509.1b — can be blocked only by Walls
            predicate: (_self, opponent) => opponent.subtypes.includes("Wall"),
            oracleText: "Enchanted creature can't be blocked except by Walls.",
        },
    ],
};

// Jump — "Target creature gains flying until end of turn." (CR 702.9 flying,
// 611.1b temporary keyword grant with end-of-turn duration).
export const jump: CardDefinition = {
    id: "cb3f4b11-ad1b-48e2-a500-787d351b0174",
    name: "Jump",
    oracleText: "Target creature gains flying until end of turn.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") {
            ctx.grantStaticAbility(target, "flying", { phase: "end-of-turn" });
        }
    },
};

// Lifetap — "Whenever a Forest an opponent controls becomes tapped, you gain
// 1 life." (CR 603.2 PERMANENT_TAPPED trigger). Fires for any tap of an
// opponent-controlled Forest, not just for-mana taps — `forMana` is omitted.
export const lifetap: CardDefinition = {
    id: "11add837-7ee4-4104-b031-c161bce459ae",
    name: "Lifetap",
    oracleText:
        "Whenever a Forest an opponent controls becomes tapped, you gain 1 life.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "lifetap-gain",
            oracleText:
                "Whenever a Forest an opponent controls becomes tapped, you gain 1 life.",
            scope: "opponents",
            filter: { subtypes: "Forest" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Lord of Atlantis — "Other Merfolk creatures get +1/+1 and have islandwalk."
// (CR 611 layer 7c, 702.13c landwalk). Lord-style static effects: pt-buff at
// stat-read time, keyword-grant applied imperatively at battlefield
// entry/exit.
export const lordOfAtlantis: CardDefinition = {
    id: "210c4a90-fc7a-4c76-aeaa-20a005e45386",
    name: "Lord of Atlantis",
    oracleText:
        "Other Merfolk get +1/+1 and have islandwalk. (They can't be blocked as long as defending player controls an Island.)",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Merfolk"),
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Merfolk"),
            keyword: "islandwalk",
        },
    ],
};

// Magical Hack — "Change the text of target spell or permanent by replacing
// all instances of one basic land type with another." (CR 612 text-changing
// effect, layer 3.) The modal picker selects the replacement ("to") basic land
// type; the replaced ("from") type is derived from — and so validated against —
// the land types the target actually references (its land subtypes plus the
// types its landwalk keywords name, via ctx.getLandTypesPresent), per CR 612
// ("replace all instances of one basic land type [that appears]"). The change
// rides the target instance, lasting indefinitely and ending on a zone change
// (CR 612.6/612.7). For Alpha targets at most one basic land type is present,
// so the from-type is unambiguous; a target referencing several is a documented
// gap (ADR 0011) — the first that differs from the chosen type is used.
const BASIC_LAND_TYPES = [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
] as const;

function magicalHackMode(toType: string): SpellMode {
    return {
        id: toType.toLowerCase(),
        label: toType,
        oracleText: `Replace a basic land type with ${toType}.`,
        resolve: (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target) return;
            const present = ctx.getLandTypesPresent(target);
            // Prefer a from-type that actually differs from the choice; fall
            // back to the only type present (a no-op same-type pick).
            const from = present.find((t) => t !== toType) ?? present[0];
            if (!from) return; // target references no basic land type — no-op
            ctx.addTextChange(target, { kind: "land-type", from, to: toType });
        },
    };
}

export const magicalHack: CardDefinition = {
    id: "2bd4202c-0477-45aa-82fd-83c85d6d4bef",
    name: "Magical Hack",
    oracleText:
        'Change the text of target spell or permanent by replacing all instances of one basic land type with another. (For example, you may change "swampwalk" to "plainswalk." This effect lasts indefinitely.)',
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell-or-permanent", count: 1 },
    modes: BASIC_LAND_TYPES.map(magicalHackMode),
};

export const mahamotiDjinn: CardDefinition = {
    id: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb",
    name: "Mahamoti Djinn",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)",
    manaCost: { X: 4, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
};

export const merfolkOfThePearlTrident: CardDefinition = {
    id: "2b871039-6a66-4ac3-95e7-24759c1f2f92",
    name: "Merfolk of the Pearl Trident",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 1,
    toughness: 1,
};

// Helper for the "at the beginning of your upkeep, pay {cost} or
// <consequence>" pattern (CR 603.6a phase trigger, CR 117.3a optional cost).
// Used by cards whose upkeep cost is a flat may-pay with a hard consequence
// on decline (Phantasmal Forces → sacrifice self, Force of Nature → deal
// damage to controller, Stasis / Pestilence → sacrifice self). Cumulative
// upkeep (CR 702.23, post-LEA) is a distinct mechanic and not modeled here.
// Delegates to the `phaseTrigger` factory so the matches() narrowing and
// scope filter live in one place.
function makeUpkeepPayOrElse(args: {
    id: string;
    oracleText: string;
    cost: ManaCost;
    prompt: string;
    onDecline: (ctx: SpellContext) => void;
}): TriggeredAbility {
    return phaseTrigger({
        id: args.id,
        oracleText: args.oracleText,
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                cost: args.cost,
                prompt: args.prompt,
            });
            if (accept === undefined) return;
            if (!accept) args.onDecline(ctx);
        },
    });
}

// Phantasmal Forces — "Flying. At the beginning of your upkeep, sacrifice
// this creature unless you pay {U}." (CR 702.9 flying, CR 603.6a phase
// trigger, CR 117.3a may-pay with hard sacrifice on decline.)
export const phantasmalForces: CardDefinition = {
    id: "0631c7c8-9aa5-4333-8e20-20247fc47033",
    name: "Phantasmal Forces",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice this creature unless you pay {U}.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 4,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "phantasmal-forces-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this creature unless you pay {U}.",
            cost: { U: 1 },
            prompt: "Pay {U} to keep Phantasmal Forces?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Phantasmal Terrain — "Enchant land. As this enters, choose a basic land
// type. Enchanted land is the chosen type." (CR 305.7 subtype replacement,
// CR 303.4 aura). Modal choice at cast time selects which basic land type
// the host becomes. Each mode applies a subtype-set with a single subtype.
export const phantasmalTerrain: CardDefinition = {
    id: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14",
    name: "Phantasmal Terrain",
    oracleText:
        "Enchant land\nAs Phantasmal Terrain enters, choose a basic land type.\nEnchanted land is the chosen type.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    modes: [
        {
            id: "plains",
            label: "Plains",
            oracleText: "Enchanted land is a Plains.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Plains"],
                },
            ],
        },
        {
            id: "island",
            label: "Island",
            oracleText: "Enchanted land is an Island.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Island"],
                },
            ],
        },
        {
            id: "swamp",
            label: "Swamp",
            oracleText: "Enchanted land is a Swamp.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Swamp"],
                },
            ],
        },
        {
            id: "mountain",
            label: "Mountain",
            oracleText: "Enchanted land is a Mountain.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Mountain"],
                },
            ],
        },
        {
            id: "forest",
            label: "Forest",
            oracleText: "Enchanted land is a Forest.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Forest"],
                },
            ],
        },
    ],
};

export const phantomMonster: CardDefinition = {
    id: "e46d2cf5-e8d0-4fb2-b950-252d52084b63",
    name: "Phantom Monster",
    oracleText: "Flying",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
};

// Pirate Ship — "Pirate Ship can't attack unless defender controls an Island.
// {T}: Pirate Ship deals 1 damage to any target." (CR 508.1c attack
// restriction, 605 activated ability, 120.1 damage). The attack restriction
// is data-driven via `staticEffects[attack-restriction]` (same pattern as
// Sea Serpent).
export const pirateShip: CardDefinition = {
    id: "d0a7cb23-d229-43c5-addd-dcf423984b0c",
    name: "Pirate Ship",
    oracleText:
        "This creature can't attack unless defending player controls an Island.\n{T}: This creature deals 1 damage to any target.\nWhen you control no Islands, sacrifice this creature.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Pirate"],
    power: 4,
    toughness: 3,
    staticAbilities: [],
    staticEffects: [
        {
            // CR 508.1c — can't attack unless defending player controls an Island
            kind: "attack-restriction" as const,
            id: "pirate-ship-island-restriction",
            predicate: (
                _self: PermanentView,
                defenderBattlefield: readonly PermanentView[]
            ) => defenderBattlefield.some((c) => c.subtypes.includes("Island")),
            oracleText:
                "Pirate Ship can't attack unless defending player controls an Island.",
        },
    ],
    activatedAbilities: [
        {
            id: "pirate-ship-zap",
            oracleText: "{T}: Pirate Ship deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
            },
        },
    ],
};

// Power Leak — "Enchant enchantment. At the beginning of the upkeep of
// enchanted enchantment's controller, that player loses 1 life unless they
// pay {U}." (CR 303.4 aura, 603.6a phase trigger, 117.3a optional cost).
// Same upkeep-on-host-controller pattern as Feedback.
export const powerLeak: CardDefinition = {
    id: "ccc982b6-35b2-4e33-ace2-86cb79123e4f",
    name: "Power Leak",
    oracleText:
        "Enchant enchantment\nAt the beginning of the upkeep of enchanted enchantment's controller, that player may pay any amount of mana. This Aura deals 2 damage to that player. Prevent X of that damage, where X is the amount of mana that player paid this way.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Enchantment", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "power-leak-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted enchantment's controller, that player loses 1 life unless they pay {U}.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: hostController,
                    cost: { U: 1 },
                    prompt: "Pay {U} to avoid losing 1 life from Power Leak?",
                });
                if (accept === undefined) return;
                if (!accept) ctx.loseLife(hostController, 1);
            },
        }),
    ],
};

// Power Sink — "Counter target spell unless its controller pays {X}. If that
// player doesn't, they tap all lands with mana abilities they control and
// lose all unspent mana." (CR 701.5a counter-unless-pay, CR 117.3a may-pay).
export const powerSink: CardDefinition = {
    id: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9",
    name: "Power Sink",
    oracleText:
        "Counter target spell unless its controller pays {X}. If that player doesn't, they tap all lands with mana abilities they control and lose all unspent mana.",
    manaCost: { X: "X", U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "spell") return;
        const spellController = ctx.getController(target);
        const x = ctx.getX();
        const accept = ctx.requestMayPay({
            playerId: spellController,
            choiceId: "power-sink-pay",
            cost: x > 0 ? { X: x } : undefined,
            prompt: `Pay {${x}} to prevent your spell from being countered?`,
        });
        if (accept === undefined) return;
        if (!accept) {
            ctx.tapAllLands(spellController);
            ctx.drainManaPool(spellController);
            ctx.counter(target);
        }
    },
};

// Prodigal Sorcerer — "{T}: Prodigal Sorcerer deals 1 damage to any target."
// (CR 605 activated ability, 120.1 damage). The original "Tim".
export const prodigalSorcerer: CardDefinition = {
    id: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a",
    name: "Prodigal Sorcerer",
    oracleText: "{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard", "Sorcerer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "prodigal-sorcerer-zap",
            oracleText: "{T}: Prodigal Sorcerer deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
            },
        },
    ],
};

// Psionic Blast — deals 4 damage to any target and 2 damage to you.
// CR 115.4: "any target" = creature/player/planeswalker. CR 120.3: damage
// to self is a normal damage event (can be prevented/redirected), not life
// loss — resolved via dealDamage on a player target pointing at the caster.
export const psionicBlast: CardDefinition = {
    id: "a6a86e6e-bfff-46af-9d36-c912901fea92",
    name: "Psionic Blast",
    oracleText:
        "Psionic Blast deals 4 damage to any target and 2 damage to you.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.dealDamage(ctx.targets[0], 4);
        ctx.dealDamage({ type: "player", id: ctx.caster }, 2);
    },
};

// Psychic Venom — "Enchant land. Whenever enchanted land becomes tapped,
// Psychic Venom deals 2 damage to that land's controller." (CR 303.4 aura,
// 603.2 PERMANENT_TAPPED trigger, 120.1 damage). Fires on every tap of the
// host land — `forMana` is ignored, mana taps and Twiddle taps both count.
export const psychicVenom: CardDefinition = {
    id: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5",
    name: "Psychic Venom",
    oracleText:
        "Enchant land\nWhenever enchanted land becomes tapped, this Aura deals 2 damage to that land's controller.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        // No `host` scope in the shared vocabulary (see ADR 0002) — the aura
        // identifies its host via `self.attachedTo`, so `scope: "any"` with a
        // host-check `condition` is the idiomatic expression.
        tappedTrigger({
            id: "psychic-venom-damage",
            oracleText:
                "Whenever enchanted land becomes tapped, Psychic Venom deals 2 damage to that land's controller.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 2);
            },
        }),
    ],
};

// CR 508.1c — "can't attack unless defending player controls an Island" is
// encoded as a data-driven `staticEffects[attack-restriction]` so the same
// pattern is reusable for other cards (Reef Pirates, Phantom Monster
// variants).
// CR 603.8 — "When you control no Islands, sacrifice this creature" is a
// state-triggered ability: the trigger fires as soon as the condition becomes
// true, then doesn't trigger again until it has resolved or otherwise left
// the stack. The engine scans for state triggers as part of every stable
// checkpoint after SBA evaluation (CR 117.5).
export const seaSerpent: CardDefinition = {
    id: "d0b333b7-db4d-4439-b0de-60414cbf8d7b",
    name: "Sea Serpent",
    oracleText:
        "This creature can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice this creature.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Serpent"],
    power: 5,
    toughness: 5,
    staticAbilities: [],
    staticEffects: [
        {
            // CR 508.1c — can't attack unless defending player controls an Island
            kind: "attack-restriction" as const,
            id: "sea-serpent-island-restriction",
            predicate: (
                _self: PermanentView,
                defenderBattlefield: readonly PermanentView[]
            ) => defenderBattlefield.some((c) => c.subtypes.includes("Island")),
            oracleText:
                "Sea Serpent can't attack unless defending player controls an Island.",
        },
    ],
    triggeredAbilities: [
        // CR 603.8 — state-triggered ability. `stateTrigger` wires `STATE_CHECK`
        // narrowing and the resolve-time re-check (intervening-if) so the
        // sacrifice fizzles automatically if controller has gained an Island
        // between trigger time and resolution.
        stateTrigger({
            id: "sea-serpent-no-islands-sacrifice",
            oracleText: "When you control no Islands, sacrifice Sea Serpent.",
            condition: (self, state) => {
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
        }),
    ],
};

// Siren's Call — "Cast only during an opponent's turn, before attackers are
// declared. Creatures the active player controls attack this turn if able.
// At the beginning of the next end step, destroy all non-Wall creatures that
// player controls that didn't attack this turn." (CR 508.1d mass forced
// attack + delayed end-step destroy).
export const sirensCall: CardDefinition = {
    id: "d992b336-3b6e-43e1-8662-d85664349b44",
    name: "Siren's Call",
    oracleText:
        "Cast this spell only during an opponent's turn, before attackers are declared.\nCreatures the active player controls attack this turn if able.\nAt the beginning of the next end step, destroy all non-Wall creatures that player controls that didn't attack this turn.",
    manaCost: { U: 1 },
    types: ["Instant"],
    castTurnRestriction: "opponent",
    castPhaseRestriction: ["UNTAP", "UPKEEP", "DRAW", "PRECOMBAT_MAIN"],
    resolve: (ctx: SpellContext) => {
        const activePlayerId = ctx.allPlayerIds.find(
            (id) => id !== ctx.controller
        );
        if (!activePlayerId) return;
        ctx.setAllCreaturesMustAttack(activePlayerId);
        ctx.scheduleDelayedTrigger(
            sirensCall.id,
            "sirens-call-destroy",
            "next-end-step",
            { targetPlayerId: activePlayerId }
        );
    },
    delayedTriggers: [
        {
            id: "sirens-call-destroy",
            oracleText:
                "Destroy all non-Wall creatures that didn't attack this turn.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const pid = payload.targetPlayerId;
                if (!pid) return;
                const ids = ctx.getBattlefieldIds(pid, { types: "Creature" });
                for (const id of ids) {
                    const t = { type: "permanent" as const, id };
                    if (ctx.hasSubtype(t, "Wall")) continue;
                    if (ctx.hasAttackedThisTurn(t)) continue;
                    ctx.destroy(t);
                }
            },
        },
    ],
};

// export const sleightOfMind: CardDefinition = {
//     id: "d427790c-e322-446e-8d7d-a6b48ad41a42",
//     name: "Sleight of Mind",
//     oracleText: "Change the text of target spell or permanent by replacing all instances of one color word with another. (For example, you may change \"target black spell\" to \"target blue spell.\" This effect lasts indefinitely.)",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

// Spell Blast — "Counter target spell with mana value X." (CR 107.3 X cost,
// CR 202.3 mana value, CR 701.5a counter.) Target selection uses the new
// `mvFilter: { equals: "X" }` which resolves X at announcement against the
// chosen value and filters the stack to spells whose mana value equals X.
export const spellBlast: CardDefinition = {
    id: "845734da-ab03-4dbc-bb5f-96481d3b8e88",
    name: "Spell Blast",
    oracleText:
        "Counter target spell with mana value X. (For example, if that spell's mana cost is {3}{U}{U}, X is 5.)",
    manaCost: { X: "X", U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        mvFilter: { equals: "X" },
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "spell") ctx.counter(t);
    },
};

// Stasis — "Players skip their untap steps. At the beginning of your upkeep,
// sacrifice this enchantment unless you pay {U}." (CR 502.1 skip, 603.6a
// upkeep trigger, 117.3a optional cost, 701.16 sacrifice). The skip is encoded
// as a data-driven `untapRestriction` (ADR 0005) with `maxUntap: 0` and an
// any-permanent filter — the dispatcher in `untapStep` recognises a hard skip
// and clears cleanup flags without enqueueing a prompt. The upkeep trigger
// fires only on the controller's upkeep — same pattern as Pestilence.
export const stasis: CardDefinition = {
    id: "b6cef408-5b4b-49f6-9531-be544815b93f",
    name: "Stasis",
    oracleText:
        "Players skip their untap steps.\nAt the beginning of your upkeep, sacrifice this enchantment unless you pay {U}.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "stasis-skip-untap",
            oracleText: "Players skip their untap steps (Stasis).",
            filter: {
                types: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Land",
                    "Planeswalker",
                    "Battle",
                ],
            },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "stasis-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {U}.",
            cost: { U: 1 },
            prompt: "Pay {U} to keep Stasis?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Steal Artifact — "Enchant artifact. You control enchanted artifact."
// (CR 303.4 aura attachment, 611.2 continuous static ability, 613.1b layer 2
// control-changing effect). Mirrors Control Magic but targets an artifact
// instead of a creature — artifacts don't get summoning sickness on a
// control flip, so 702.10c doesn't fire.
export const stealArtifact: CardDefinition = {
    id: "83316930-d6ad-46ce-9b40-48eea856d95b",
    name: "Steal Artifact",
    oracleText: "Enchant artifact\nYou control enchanted artifact.",
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

export const thoughtlace: CardDefinition = makeLace({
    id: "23749375-1416-47a4-9251-52f41fe2fae9",
    name: "Thoughtlace",
    oracleText:
        "Target spell or permanent becomes blue. (Mana symbols on that permanent remain unchanged.)",
    manaCost: { U: 1 },
    color: "U",
});

export const timeWalk: CardDefinition = {
    id: "e0139f60-d48e-46fb-9f5a-1e3d7558c834",
    name: "Time Walk",
    oracleText: "Take an extra turn after this one.",
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
    oracleText:
        "Each player shuffles their hand and graveyard into their library, then draws seven cards. (Then put Timetwister into its owner's graveyard.)",
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
    oracleText: "You may tap or untap target artifact, creature, or land.",
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
    oracleText: "Return target creature to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.returnToHand(ctx.targets[0]);
    },
};

// Vesuvan Doppelganger — enters as a copy of any creature, "except it doesn't
// copy that creature's color and it has [an upkeep re-copy ability]" (CR
// 707.2, 707.9d). The colour exception keeps it blue via a layer-5 colour
// override; the retained ability is flagged `retainedThroughCopy` so the
// trigger keeps functioning after the copy overwrites the presented
// characteristics (see `gre/copy.ts`). The upkeep ability re-applies the copy
// with the same two exceptions.
const VESUVAN_OWN_COLORS: Color[] = ["U"];

export const vesuvanDoppelganger: CardDefinition = {
    id: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f",
    name: "Vesuvan Doppelganger",
    oracleText:
        "You may have Vesuvan Doppelganger enter the battlefield as a copy of any creature on the battlefield, except it doesn't copy that creature's color and it has \"At the beginning of your upkeep, you may have this creature become a copy of target creature, except it doesn't copy that creature's color and it has this ability.\"",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                }).length;
            }
            if (candidates === 0) return;
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "vesuvan-may-copy",
                prompt: "Have Vesuvan Doppelganger enter as a copy of a creature?",
            });
            if (accept === undefined) return;
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "vesuvan-copy-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Creature" },
                count: 1,
                prompt: "Choose a creature for Vesuvan Doppelganger to copy.",
            });
            if (picks === undefined) return;
            if (picks.length === 1) {
                ctx.becomeCopyOf(picks[0], {
                    copyColor: false,
                    ownColors: VESUVAN_OWN_COLORS,
                });
            }
        },
    ],
    triggeredAbilities: [
        {
            ...phaseTrigger({
                id: "vesuvan-doppelganger-recopy",
                oracleText:
                    "At the beginning of your upkeep, you may have Vesuvan Doppelganger become a copy of target creature, except it doesn't copy that creature's color and it has this ability.",
                phase: "UPKEEP",
                scope: "your",
                resolve: (ctx) => {
                    let candidates = 0;
                    for (const pid of ctx.allPlayerIds) {
                        candidates += ctx.getBattlefieldIds(pid, {
                            types: "Creature",
                        }).length;
                    }
                    if (candidates === 0) return;
                    const accept = ctx.requestMayPay({
                        playerId: ctx.controller,
                        choiceId: `vesuvan-recopy-may-${ctx.sourceInstanceId}`,
                        prompt: "Have Vesuvan Doppelganger become a copy of another creature?",
                    });
                    if (accept === undefined) return;
                    if (!accept) return;
                    const picks = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: `vesuvan-recopy-${ctx.sourceInstanceId}`,
                        kind: "choose-permanents",
                        zone: "battlefield",
                        allControllers: true,
                        filter: { types: "Creature" },
                        count: 1,
                        prompt: "Choose a creature for Vesuvan Doppelganger to copy.",
                    });
                    if (picks === undefined) return;
                    if (picks.length === 1) {
                        ctx.becomeCopyOf(picks[0], {
                            copyColor: false,
                            ownColors: VESUVAN_OWN_COLORS,
                        });
                    }
                },
            }),
            retainedThroughCopy: true,
        },
    ],
};

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
    oracleText:
        "Destroy X target Mountains. Volcanic Eruption deals damage to each creature and each player equal to the number of Mountains put into a graveyard this way.",
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
    oracleText:
        "Defender, flying (This creature can't attack, and it can block creatures with flying.)",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender", "flying"],
};

// Wall of Water — defender + "{U}: This creature gets +1/+0 until end of turn."
// (CR 702.3 defender, 611.1 temp P/T mod).
export const wallOfWater: CardDefinition = {
    id: "41faed1a-ded8-49ee-8e2a-c60d377775d7",
    name: "Wall of Water",
    oracleText:
        "Defender (This creature can't attack.)\n{U}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 5,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-water-pump",
            oracleText: "{U}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { U: 1 } },
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

export const waterElemental: CardDefinition = {
    id: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e",
    name: "Water Elemental",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 4,
};

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
    name: "Dark Ritual",
    oracleText: "Add {B}{B}{B}.",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.addMana({ B: 3 });
    },
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
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "spell") ctx.counter(target);
            },
        },
    ],
};

export const deathlace: CardDefinition = makeLace({
    id: "6ff1cefc-62cb-4525-b0c5-2b09603b4314",
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
            resolve: (ctx) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "permanent") return;
                ctx.destroy(t);
            },
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "demonic-hordes-upkeep",
            oracleText:
                "At the beginning of your upkeep, unless you pay {B}{B}{B}, tap this creature and sacrifice a land of an opponent's choice.",
            phase: "UPKEEP",
            scope: "your",
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
    name: "Demonic Tutor",
    oracleText:
        "Search your library for a card, put that card into your hand, then shuffle.",
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
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Evil Presence — "Enchant land. Enchanted land is a Swamp." (CR 305.7
// subtype replacement, CR 303.4 aura). Layer 4 subtype-set replaces the
// host's subtypes with ["Swamp"], which also changes its mana production
// via getBasicLandMana (Swamp → {B}).
export const evilPresence: CardDefinition = {
    id: "0551d66e-8cd4-48f0-aa17-15f26be9d85f",
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
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Gloom — "White spells cost {3} more to cast. Activated abilities of white
// enchantments cost {3} more to activate." (CR 601.2f cost modification).
export const gloom: CardDefinition = {
    id: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f",
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
    name: "Lich",
    oracleText:
        "As this enchantment enters, you lose life equal to your life total.\nYou don't lose the game for having 0 or less life.\nIf you would gain life, draw that many cards instead.\nWhenever you're dealt damage, sacrifice that many nontoken permanents. If you can't, you lose the game.\nWhen this enchantment is put into a graveyard from the battlefield, you lose the game.",
    manaCost: { X: 2, B: 2 },
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
    resolve: (ctx: SpellContext) => {
        // ETB tap-the-host effect (CR 603 — this is modeled as part of the
        // aura's spell resolution rather than a PERMANENT_ENTERED trigger,
        // since no such event exists in the engine yet). Runs before
        // `finalizeSpellResolution` attaches the aura, so the host is still
        // a regular battlefield permanent and the tap applies normally.
        const [host] = ctx.targets;
        if (host) ctx.tap(host);
    },
    triggeredAbilities: [
        phaseTrigger({
            id: "paralyze-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, that player may pay {4}. If the player does, untap the creature.",
            phase: "UPKEEP",
            scope: "host-controller",
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
            resolve: (ctx: SpellContext) => {
                ctx.dealDamageToEach(1, { creatures: true, players: true });
            },
        },
    ],
};

// Plague Rats — "Plague Rats's power and toughness are each equal to the
// number of creatures named Plague Rats on the battlefield." (CR 604.3 CDA,
// 207.2 name match). Same pt-cda shape as Nightmare; counts every Plague
// Rats across both battlefields, regardless of controller.
export const plagueRats: CardDefinition = {
    id: "b3724e40-0622-4aee-9334-6c9fff88bcd5",
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
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card") return;
        if (!t.playerId) return;
        ctx.moveCardById(t.playerId, t.id, "graveyard", "hand");
    },
};

// Royal Assassin — "{T}: Destroy target tapped creature." (CR 701.20 for
// tap-state, CR 701.7 for destroy). The tappedFilter on TargetRequirement
// enforces legality at activation (CR 602.2b); the resolve re-checks at
// resolution (CR 608.2b) so an opposing Twiddle-style untap fizzles this.
export const royalAssassin: CardDefinition = {
    id: "59590768-fa96-4869-8763-9d5ab6ac22ad",
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
    name: "Sacrifice",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nAdd an amount of {B} equal to the sacrificed creature's mana value.",
    manaCost: { B: 1 },
    types: ["Instant"],
    additionalCosts: {
        sacrificeFilter: { types: "Creature" },
    },
    resolve: (ctx: SpellContext) => {
        const mv = ctx.getAdditionalSacrificeMv();
        if (mv === undefined || mv <= 0) return;
        ctx.addMana({ B: mv });
    },
};

export const scatheZombies: CardDefinition = {
    id: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e",
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
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Sengir Vampire — flying, 4/4. "Whenever another creature dies, if Sengir
// Vampire dealt damage to it this turn, put a +1/+1 counter on Sengir
// Vampire." (CR 603.2 death trigger, CR 122.1 +1/+1 counter, layer 7d).
export const sengirVampire: CardDefinition = {
    id: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9",
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
    name: "Simulacrum",
    oracleText:
        "You gain life equal to the damage dealt to you this turn. Simulacrum deals damage to target creature you control equal to the damage dealt to you this turn.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
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
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Warp Artifact — "Enchant artifact. At the beginning of the upkeep of
// enchanted artifact's controller, Warp Artifact deals 1 damage to that
// player." Mirror of Cursed Land/Feedback, hosting on Artifact instead.
export const warpArtifact: CardDefinition = {
    id: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5",
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
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Out of scope — see ADR 0010
// export const wordOfCommand: CardDefinition = {
//     id: "96c21429-98d3-416b-be00-6aa9c4c5a006",
//     name: "Word of Command",
//     oracleText: "Look at target opponent's hand and choose a card from it. You control that player until Word of Command finishes resolving. The player plays that card if able. While doing so, the player can activate mana abilities only if they're from lands that player controls and only if mana they produce is spent to activate other mana abilities of lands the player controls and/or to play that card. If the chosen card is cast as a spell, you control the player while that spell is resolving.",
//     manaCost: { B: 2 },
//     types: ["Instant"],
// };

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
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Burrowing — "Enchant creature. Enchanted creature has mountainwalk." (CR
// 303.4 aura attachment, 702.13c landwalk, 611.2 keyword grant).
export const burrowing: CardDefinition = {
    id: "a14c05e4-8df3-450b-8a98-5028e73b14c1",
    name: "Burrowing",
    oracleText:
        "Enchant creature\nEnchanted creature has mountainwalk. (It can't be blocked as long as defending player controls a Mountain.)",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "mountainwalk",
        },
    ],
};

export const chaoslace: CardDefinition = makeLace({
    id: "72ea2048-57bc-43d5-8987-33ca727f1a97",
    name: "Chaoslace",
    oracleText:
        "Target spell or permanent becomes red. (Its mana symbols remain unchanged.)",
    manaCost: { R: 1 },
    color: "R",
});

// Dragon Whelp — "Flying. {R}: Dragon Whelp gets +1/+0 until end of turn.
// If this ability has been activated four or more times this turn, sacrifice
// Dragon Whelp at the beginning of the next end step." (CR 602.5, 603.7a)
//
// The pump is a standard addTemporaryPTBuff. After resolution, getActivationCount
// reads the per-source counter. On the 4th+ activation, a delayed end-step
// sacrifice is scheduled. Each activation past the 3rd adds a separate
// delayed trigger (all resolve independently; the creature is already gone
// by the time later ones fire, so extra triggers are no-ops).
const DRAGON_WHELP_ID = "6bbf1eab-bc32-4835-b566-8634b1fe81b0";

export const dragonWhelp: CardDefinition = {
    id: DRAGON_WHELP_ID,
    name: "Dragon Whelp",
    oracleText:
        "Flying\n{R}: Dragon Whelp gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice Dragon Whelp at the beginning of the next end step.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "dragon-whelp-pump",
            oracleText:
                "{R}: Dragon Whelp gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice Dragon Whelp at the beginning of the next end step.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
                // CR 602.5: activation count includes the current one
                // (already incremented before resolve).
                const count = ctx.getActivationCount("dragon-whelp-pump");
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        DRAGON_WHELP_ID,
                        "dragon-whelp-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "dragon-whelp-sacrifice",
            oracleText:
                "Sacrifice Dragon Whelp at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.destroy({ type: "permanent", id: targetId });
            },
        },
    ],
};

export const dwarvenDemolitionTeam: CardDefinition = {
    id: "03482c9c-1f25-4d73-9243-17462ea37ac4",
    name: "Dwarven Demolition Team",
    oracleText: "{T}: Destroy target Wall.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "dwarven-demolition-team-destroy",
            oracleText: "{T}: Destroy target Wall.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Wall",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.destroy(target);
            },
        },
    ],
};

// Dwarven Warriors — "{T}: Target creature with power 2 or less can't be
// blocked this turn." (CR 113.1 grant of `unblockable` keyword via
// grantStaticAbility, 509.1b block restriction, 613 layer 7c power filter
// on target selection.)
export const dwarvenWarriors: CardDefinition = {
    id: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8",
    name: "Dwarven Warriors",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Dwarf", "Warrior"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "dwarven-warriors-unblockable",
            oracleText:
                "{T}: Target creature with power 2 or less can't be blocked this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent")
                    ctx.grantStaticAbility(target, "unblockable", {
                        phase: "end-of-turn",
                    });
            },
        },
    ],
};

export const earthElemental: CardDefinition = {
    id: "b24b5864-44c0-4bc8-8705-9504f83b2c03",
    name: "Earth Elemental",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 5,
};

// Earthbind — "Enchant creature. Enchanted creature loses flying. When
// Earthbind enters, if enchanted creature has flying, Earthbind deals 2
// damage to that creature." (CR 613.1a keyword removal, layer 6). The
// keyword-remove is always active; the ETB damage fires only if the host
// originally had flying (checked via removedKeywords record).
export const earthbind: CardDefinition = {
    id: "a6d492b7-b0b3-420e-8d00-6dacb11de77e",
    name: "Earthbind",
    oracleText:
        "Enchant creature\nEnchanted creature loses flying.\nWhen Earthbind enters, if enchanted creature has flying, Earthbind deals 2 damage to that creature.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-remove",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "earthbind-etb",
            oracleText:
                "When Earthbind enters, if enchanted creature has flying, Earthbind deals 2 damage to that creature.",
            scope: "self",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                if (!ctx.hasRemovedKeyword(hostId, "flying")) return;
                ctx.dealDamage({ type: "permanent", id: hostId }, 2);
            },
        }),
    ],
};

// CR 107.3: X chosen on cast. CR 120.3: damage respects flying at
// resolution time (creatures losing flying mid-resolution aren't affected,
// since matching creatures are snapshotted).
export const earthquake: CardDefinition = {
    id: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64",
    name: "Earthquake",
    oracleText:
        "Earthquake deals X damage to each creature without flying and each player.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(ctx.getX(), {
            creatures: { excludeAbility: "flying" },
            players: true,
        });
    },
};

// False Orders — "Cast only during the declare blockers step. Remove target
// creature defending player controls from combat." (CR 506.4 remove from
// combat). The optional re-assignment as blocker is deferred (not modeled
// in initial scope — the primary effect of removing from combat is complete).
export const falseOrders: CardDefinition = {
    id: "7eb71ac4-796d-4011-9002-1129bc09c284",
    name: "False Orders",
    oracleText:
        "Cast this spell only during the declare blockers step.\nRemove target creature defending player controls from combat. Creatures it was blocking that had become blocked by only that creature this combat become unblocked.",
    manaCost: { R: 1 },
    types: ["Instant"],
    castPhaseRestriction: ["DECLARE_BLOCKERS"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "opponent",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "permanent") return;
        ctx.removeFromCombat(target);
    },
};

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
    oracleText:
        "This spell costs {1} more to cast for each target beyond the first.\nFireball deals X damage divided evenly, rounded down, among any number of targets.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: { min: 1 } },
    additionalGenericPerExtraTarget: 1,
    resolve: (ctx: SpellContext) => {
        ctx.dealDividedDamage(ctx.targets, ctx.getX());
    },
};

// Firebreathing — "Enchant creature. {R}: Enchanted creature gets +1/+0
// until end of turn." (CR 303.4 aura, 611.1 temp P/T mod). Same shape as
// Regeneration's host-aware activated ability.
export const firebreathing: CardDefinition = {
    id: "3eb27381-505d-4e47-bf66-9e7ba91a5075",
    name: "Firebreathing",
    oracleText:
        "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "firebreathing-pump",
            oracleText: "{R}: Enchanted creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

export const flashfires: CardDefinition = {
    id: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5",
    name: "Flashfires",
    oracleText: "Destroy all Plains.",
    manaCost: { X: 3, R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ subtypes: "Plains" });
    },
};

// Fork — "Copy target instant or sorcery spell, except that the copy is red.
// You may choose new targets for the copy." (CR 707.10 copying a spell,
// 707.10b new targets, 707.10c color-change to red). The copy is put on the
// stack above the original and resolves first; it ceases to exist afterward.
export const fork: CardDefinition = {
    id: "e6b43916-fe2d-417a-a550-d7c795023297",
    name: "Fork",
    oracleText:
        "Copy target instant or sorcery spell, except that the copy is red. You may choose new targets for the copy.",
    manaCost: { R: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Instant", "Sorcery"],
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "spell") return;
        // CR 707.10c — the copy is red regardless of the original's color.
        const copyId = ctx.copyStackItem(target.id, { colorOverride: ["R"] });
        // copyStackItem returns null for illegal targets (e.g. a permanent
        // spell or an item that left the stack); nothing to retarget then.
        if (copyId) ctx.requestCopyRetarget(copyId);
    },
};

// Goblin Balloon Brigade — "{R}: Goblin Balloon Brigade gains flying until
// end of turn." (CR 702.9 flying, 611.1b temporary keyword grant). The grant
// targets self via `ctx.sourceInstanceId`, expires at CLEANUP.
export const goblinBalloonBrigade: CardDefinition = {
    id: "5129b422-7a35-4bc5-b14b-c814012a0d8f",
    name: "Goblin Balloon Brigade",
    oracleText: "{R}: This creature gains flying until end of turn.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-balloon-brigade-fly",
            oracleText:
                "{R}: Goblin Balloon Brigade gains flying until end of turn.",
            cost: { mana: { R: 1 } },
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

// Goblin King — "Other Goblins get +1/+1 and have mountainwalk." (CR 611
// layer 7c, 702.13c landwalk). Both halves wired via lord-style static
// effects: pt-buff applied at stat-read time, keyword-grant applied
// imperatively at battlefield entry/exit (see `applyExistingGrantsTo` /
// `applySourceStaticEffects` in gre/state.ts).
export const goblinKing: CardDefinition = {
    id: "5873672d-37ea-4c0f-97f3-12b74fde112d",
    name: "Goblin King",
    oracleText: "Other Goblins get +1/+1 and have mountainwalk.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Goblin"),
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Goblin"),
            keyword: "mountainwalk",
        },
    ],
};

// Granite Gargoyle — flying + "{R}: This creature gets +0/+1 until end of turn."
// (CR 702.9 flying, 611.1 temp P/T mod).
export const graniteGargoyle: CardDefinition = {
    id: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc",
    name: "Granite Gargoyle",
    oracleText: "Flying\n{R}: This creature gets +0/+1 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Gargoyle"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "granite-gargoyle-pump",
            oracleText: "{R}: This creature gets +0/+1 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    0,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

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

// Ironclaw Orcs — "Ironclaw Orcs can't block creatures with power 2 or
// greater." (CR 509.1b block restriction, CR 613 layer 7c for effective
// power). The combat validator enriches P/T to post-layer values before
// calling the predicate, so `opponent.power` is already effective.
export const ironclawOrcs: CardDefinition = {
    id: "d56421a8-34ae-4033-943f-c59a7bf2b6f9",
    name: "Ironclaw Orcs",
    oracleText: "Ironclaw Orcs can't block creatures with power 2 or greater.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "ironclaw-power-bound",
            side: "blocker" as const,
            // CR 509.1b — can't block power ≥ 2 (layer 7c via enrichment)
            predicate: (_self, opponent) => (opponent.power ?? 0) < 2,
            oracleText:
                "Ironclaw Orcs can't block creatures with power 2 or greater.",
        },
    ],
};

// Keldon Warlord — "Keldon Warlord's power and toughness are each equal to
// the number of other creatures you control." (CR 604.3 CDA, layer 7b). Same
// pt-cda shape as Nightmare; counts every creature controlled by source's
// controller, excluding the Warlord itself.
export const keldonWarlord: CardDefinition = {
    id: "8fe3fd83-969c-4add-888f-86f4306b067c",
    name: "Keldon Warlord",
    oracleText:
        "Keldon Warlord's power and toughness are each equal to the number of non-Wall creatures you control.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Barbarian"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state, ctx) => {
                let count = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.id !== source.id &&
                            ctx.isCreature(p)
                        ) {
                            count++;
                        }
                    }
                }
                return { power: count, toughness: count };
            },
        },
    ],
};

export const lightningBolt: CardDefinition = {
    id: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    name: "Lightning Bolt",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        ctx.dealDamage(ctx.targets[0], 3);
    },
};

// Mana Flare — "Whenever a player taps a land for mana, that player adds one
// mana of any type that land produced." (CR 603.2 PERMANENT_TAPPED trigger,
// 605 mana ability). Doubles the land's first produced color — current
// PERMANENT_TAPPED.manaProduced carries the activated ability's output, and
// we add one mana of the first non-zero color found there. Lands with only a
// single produced color (the LEA basics) hit the canonical case exactly.
export const manaFlare: CardDefinition = {
    id: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9",
    name: "Mana Flare",
    oracleText:
        "Whenever a player taps a land for mana, that player adds one mana of any type that land produced.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "mana-flare-extra",
            oracleText:
                "Whenever a player taps a land for mana, that player adds one mana of any type that land produced.",
            scope: "any",
            filter: { types: "Land" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                const produced = tapped.manaProduced ?? {};
                for (const [color, amount] of Object.entries(produced)) {
                    if (
                        color === "X" ||
                        typeof amount !== "number" ||
                        amount <= 0
                    )
                        continue;
                    ctx.addManaTo(tapped.controllerId, {
                        [color]: 1,
                    } as ManaCost);
                    return;
                }
            },
        }),
    ],
};

// Manabarbs — "Whenever a player taps a land for mana, this enchantment
// deals 1 damage to that player." (CR 603.2 PERMANENT_TAPPED trigger,
// 120.1 damage). The mana itself was already added when the tap fired —
// this is a pure penalty on top.
export const manabarbs: CardDefinition = {
    id: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8",
    name: "Manabarbs",
    oracleText:
        "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "manabarbs-damage",
            oracleText:
                "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
            scope: "any",
            filter: { types: "Land" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 1);
            },
        }),
    ],
};

export const monssGoblinRaiders: CardDefinition = {
    id: "b4eb3db3-6a7c-488a-9433-d5d1d3133816",
    name: "Mons's Goblin Raiders",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
};

// Orcish Artillery — "{T}: Orcish Artillery deals 2 damage to any target and
// 3 damage to you." (CR 605 activated ability, 120.1 damage). Both damage
// events resolve in the same effect call — the self-damage is a normal
// damage to a player target (preventable / redirectable per CR 615), not
// life loss.
export const orcishArtillery: CardDefinition = {
    id: "a97208b1-a91b-4129-8a00-2f97b418accc",
    name: "Orcish Artillery",
    oracleText:
        "{T}: This creature deals 2 damage to any target and 3 damage to you.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "orcish-artillery-shoot",
            oracleText:
                "{T}: Orcish Artillery deals 2 damage to any target and 3 damage to you.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 2);
                ctx.dealDamage({ type: "player", id: ctx.controller }, 3);
            },
        },
    ],
};

export const orcishOriflamme: CardDefinition = {
    id: "911538ea-322c-4c40-a9c3-35e47fe60fce",
    name: "Orcish Oriflamme",
    oracleText: "Attacking creatures you control get +1/+0.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                !!target.isAttacking &&
                target.controllerId === source.controllerId,
            power: 1,
            toughness: 0,
        },
    ],
};

// Power Surge — "At the beginning of each player's upkeep, Power Surge
// deals damage to that player equal to the number of untapped lands they
// control." (CR 603.6a phase trigger, 120.1 damage). APNAP not modeled —
// per-trigger event identifies the upkeep player via `activePlayerId`.
export const powerSurge: CardDefinition = {
    id: "62858604-ca5a-4f69-a045-a7515ebfabf2",
    name: "Power Surge",
    oracleText:
        "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn.",
    manaCost: { R: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "power-surge-damage",
            oracleText:
                "At the beginning of each player's upkeep, Power Surge deals damage to that player equal to the number of untapped lands they control.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, playerId) => {
                const landIds = ctx.getBattlefieldIds(playerId, {
                    types: "Land",
                });
                let untapped = 0;
                for (const id of landIds) {
                    if (!ctx.getIsTapped({ type: "permanent", id })) untapped++;
                }
                if (untapped > 0)
                    ctx.dealDamage({ type: "player", id: playerId }, untapped);
            },
        }),
    ],
};

// Raging River — pile combat (CR 509.2 variant, ADR 0012). When the
// controller's creatures attack, the defender divides their non-flying
// creatures into a "left" and "right" pile, then the attacker labels each
// attacker "left" or "right"; a labelled attacker can be blocked only by
// flying creatures or creatures in the matching pile. Modelled as two
// sequential `partition` choices (selected set = "left", complement =
// "right"): the defender's non-flying creatures, then the attackers. Each
// attacker's chosen label becomes a transient combatBlockRestriction consumed
// generically by the block validator. Single defending player, matching the
// rest of combat.
export const ragingRiver: CardDefinition = {
    id: "61e4f56d-1f4f-49f2-8534-0d09196a3327",
    name: "Raging River",
    oracleText:
        'Whenever one or more creatures you control attack, each defending player divides all creatures without flying they control into a "left" pile and a "right" pile. Then, for each attacking creature you control, choose "left" or "right." That creature can\'t be blocked this combat except by creatures with flying and creatures in a pile with the chosen label.',
    manaCost: { R: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "raging-river-piles",
            oracleText:
                'Whenever one or more creatures you control attack, each defending player divides all creatures without flying they control into a "left" pile and a "right" pile. Then, for each attacking creature you control, choose "left" or "right."',
            event: "ATTACKERS_DECLARED",
            matches: (event, self) => {
                if (event.type !== "ATTACKERS_DECLARED") return false;
                return (
                    event.attackingPlayerId === self.controllerId &&
                    event.attackerIds.length > 0
                );
            },
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKERS_DECLARED") return;
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!defenderId) return;

                // 1) Defender divides their non-flying creatures into piles
                //    (selected = "left", the rest = "right"). Flying creatures
                //    are not divided — they can block any pile anyway.
                const nonFlying = ctx.getBattlefieldIds(defenderId, {
                    types: "Creature",
                    excludeAbility: "flying",
                });
                if (nonFlying.length > 0) {
                    const leftPile = ctx.requestChoice({
                        playerId: defenderId,
                        choiceId: "partition-defenders",
                        kind: "partition",
                        zone: "battlefield",
                        zoneOwnerId: defenderId,
                        filter: { types: "Creature", excludeAbility: "flying" },
                        count: { min: 0, max: nonFlying.length },
                        prompt: 'Divide your non-flying creatures: select the "left" pile (the rest go "right").',
                    });
                    if (leftPile === undefined) return; // suspended
                    for (const id of nonFlying) {
                        ctx.setPileLabel(
                            id,
                            leftPile.includes(id) ? "left" : "right"
                        );
                    }
                }

                // 2) Attacker labels each attacking creature "left"/"right".
                const leftAttackers = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: "label-attackers",
                    kind: "partition",
                    zone: "battlefield",
                    zoneOwnerId: ctx.controller,
                    filter: { types: "Creature", isAttacking: true },
                    count: { min: 0, max: event.attackerIds.length },
                    prompt: 'Label your attackers: select the "left" attackers (the rest are "right").',
                });
                if (leftAttackers === undefined) return; // suspended
                for (const attackerId of event.attackerIds) {
                    ctx.addCombatBlockRestriction(
                        attackerId,
                        leftAttackers.includes(attackerId) ? "left" : "right"
                    );
                }
            },
        },
    ],
};

export const redElementalBlast: CardDefinition = makeElementalBlast({
    id: "776ad9be-3309-4f1d-9f27-6219d9477662",
    name: "Red Elemental Blast",
    oracleColor: "blue",
    castColor: "R",
    targetColor: "U",
});

export const rocOfKherRidges: CardDefinition = {
    id: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1",
    name: "Roc of Kher Ridges",
    oracleText: "Flying",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
};

export const rockHydra: CardDefinition = {
    id: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97",
    name: "Rock Hydra",
    oracleText:
        "This creature enters with X +1/+1 counters on it.\nFor each 1 damage that would be dealt to this creature, if it has a +1/+1 counter on it, remove a +1/+1 counter from it and prevent that 1 damage.\n{R}: Prevent the next 1 damage that would be dealt to this creature this turn.\n{R}{R}{R}: Put a +1/+1 counter on this creature. Activate only during your upkeep.",
    manaCost: { X: "X", R: 2 },
    types: ["Creature"],
    subtypes: ["Hydra"],
    power: 0,
    toughness: 0,
    entersWith: { counters: [{ type: "+1/+1", count: "X" }] },
    replacementEffects: [
        {
            id: "rock-hydra-counter-prevent",
            oracleText:
                "For each 1 damage that would be dealt to Rock Hydra, if it has a +1/+1 counter on it, remove a +1/+1 counter from it and prevent that 1 damage.",
            eventKind: "damage",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "permanent") return false;
                if (event.target.id !== self.id) return false;
                return (self.counters?.["+1/+1"] ?? 0) > 0;
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                const prevented = ctx.removeCounter("+1/+1", event.amount);
                if (prevented >= event.amount) {
                    return { kind: "consumed" };
                }
                return {
                    kind: "modified",
                    event: { ...event, amount: event.amount - prevented },
                };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "rock-hydra-prevent",
            oracleText:
                "{R}: Prevent the next 1 damage that would be dealt to Rock Hydra this turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventNextNDamageToTarget(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "rock-hydra-grow",
            oracleText:
                "{R}{R}{R}: Put a +1/+1 counter on Rock Hydra. Activate only during your upkeep.",
            cost: { mana: { R: 3 } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            resolve: (ctx: SpellContext) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        },
    ],
};

export const sedgeTroll: CardDefinition = {
    id: "b13bf496-f3c0-4c13-8282-e7abfab6a198",
    name: "Sedge Troll",
    oracleText:
        "Sedge Troll gets +1/+1 as long as you control a Swamp.\n{B}: Regenerate Sedge Troll.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.subtypes.includes("Swamp")
                        ) {
                            return { power: 1, toughness: 1 };
                        }
                    }
                }
                return { power: 0, toughness: 0 };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "sedge-troll-regenerate",
            oracleText: "{B}: Regenerate Sedge Troll.",
            cost: { mana: { B: 1 } },
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

// Shatter — "Destroy target artifact." (CR 701.7). Declarative shorthand via
// the shared destroy-target effect, same shape as Sinkhole / Disenchant.
export const shatter: CardDefinition = {
    id: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e",
    name: "Shatter",
    oracleText: "Destroy target artifact.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    effect: "destroy-target",
};

// Shivan Dragon — flying + "{R}: This creature gets +1/+0 until end of turn."
// (CR 702.9 flying, 611.1 temp P/T mod).
export const shivanDragon: CardDefinition = {
    id: "fefbf149-f988-4f8b-9f53-56f5878116a6",
    name: "Shivan Dragon",
    oracleText: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 4, R: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 5,
    toughness: 5,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "shivan-dragon-pump",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
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

// Smoke — modern Oracle (Scryfall, ADR 0004): "Players can't untap more
// than one creature during their untap steps." (CR 502.1). Encoded as a
// data-driven `untapRestriction` (ADR 0002 / 0005) on the Creature filter
// with `maxUntap: 1`: the engine dispatcher collects the cap, computes the
// active player's tapped-creature eligible set, and either auto-resolves
// or enqueues an `untap-pick` `PendingChoice` ({ min: 0, max: 1 }) routed
// to the active player. Land and non-creature permanents are unaffected.
// Composes with Winter Orb's land cap — both restrictions fire
// independently in FIFO order during the same untap step.
export const smoke: CardDefinition = {
    id: "7c67788e-d713-47c3-ab9f-b8a6212ae24f",
    name: "Smoke",
    oracleText:
        "Players can't untap more than one creature during their untap steps.",
    manaCost: { R: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "smoke-creature-cap",
            oracleText: "Untap up to one creature (Smoke).",
            filter: { types: "Creature" },
            maxUntap: 1,
        }),
    ],
};

// Stone Giant — "{T}: Target creature you control with toughness less than
// Stone Giant's power gains flying until end of turn. Destroy that creature
// at the beginning of the next end step." (CR 113.1, 611.1b, 603.7a)
//
// getTargetRequirement computes a dynamic toughnessFilter from the source's
// current power. resolve grants flying EOT and schedules a delayed destroy.
const STONE_GIANT_ID = "7ffaedb9-25f8-4304-9085-e12505b93312";

export const stoneGiant: CardDefinition = {
    id: STONE_GIANT_ID,
    name: "Stone Giant",
    oracleText:
        "{T}: Target creature you control with toughness less than Stone Giant's power gains flying until end of turn. Destroy that creature at the beginning of the next end step.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 4,
    activatedAbilities: [
        {
            id: "stone-giant-fling",
            oracleText:
                "{T}: Target creature you control with toughness less than Stone Giant's power gains flying until end of turn. Destroy that creature at the beginning of the next end step.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                controller: "you" as const,
                toughnessFilter: { max: (source.power ?? 0) - 1 },
            }),
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "permanent") return;
                ctx.grantStaticAbility(target, "flying", {
                    phase: "end-of-turn",
                });
                ctx.scheduleDelayedTrigger(
                    STONE_GIANT_ID,
                    "stone-giant-destroy",
                    "next-end-step",
                    { targetId: target.id }
                );
            },
        },
    ],
    delayedTriggers: [
        {
            id: "stone-giant-destroy",
            oracleText:
                "Destroy that creature at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.destroy({ type: "permanent", id: targetId });
            },
        },
    ],
};

// Stone Rain — "Destroy target land." (CR 701.7). Identical shape to Sinkhole
// modulo cost / type.
export const stoneRain: CardDefinition = {
    id: "57ff74cb-a2ed-4123-ac42-f72f9820049e",
    name: "Stone Rain",
    oracleText: "Destroy target land.",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effect: "destroy-target",
};

// Tunnel — "Destroy target Wall." (CR 205.3 subtype filter, 701.7 destroy).
export const tunnel: CardDefinition = {
    id: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31",
    name: "Tunnel",
    oracleText: "Destroy target Wall. It can't be regenerated.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        subtypeFilter: "Wall",
    },
    effect: "destroy-target",
};

// Two-Headed Giant of Foriys — "Trample. Two-Headed Giant of Foriys can
// block an additional creature each combat." (CR 509.1a — multi-block).
// canBlockAdditional: 1 lets the combat validator allow blocking 2 attackers.
export const twoHeadedGiantOfForiys: CardDefinition = {
    id: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245",
    name: "Two-Headed Giant of Foriys",
    oracleText:
        "Trample\nTwo-Headed Giant of Foriys can block an additional creature each combat.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 4,
    staticAbilities: ["trample"],
    canBlockAdditional: 1,
};

// Uthden Troll — "{R}: Regenerate Uthden Troll." Same self-regen shape as
// Drudge Skeletons / Wall of Bone / Will-o'-the-Wisp.
export const uthdenTroll: CardDefinition = {
    id: "2ff21a6f-83a7-4bf3-a078-294e303232cc",
    name: "Uthden Troll",
    oracleText: "{R}: Regenerate this creature.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "uthden-troll-regenerate",
            oracleText: "{R}: Regenerate Uthden Troll.",
            cost: { mana: { R: 1 } },
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

// Wall of Fire — defender + "{R}: This creature gets +1/+0 until end of turn."
// (CR 702.3 defender, 611.1 temp P/T mod).
export const wallOfFire: CardDefinition = {
    id: "efcf12cd-fb70-444e-9641-73ffa0e8f16e",
    name: "Wall of Fire",
    oracleText:
        "Defender (This creature can't attack.)\n{R}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 5,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-fire-pump",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
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

export const wallOfStone: CardDefinition = {
    id: "140e567c-6e4a-42b0-8084-d6c9695ae802",
    name: "Wall of Stone",
    oracleText: "Defender (This creature can't attack.)",
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
    oracleText: "Each player discards their hand, then draws seven cards.",
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

export const aspectOfWolf: CardDefinition = {
    id: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29",
    name: "Aspect of Wolf",
    oracleText:
        "Enchant creature\nEnchanted creature gets +X/+Y, where X is half the number of Forests you control, rounded down, and Y is half the number of Forests you control, rounded up.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source, state) => {
                let forests = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.subtypes.includes("Forest")
                        ) {
                            forests++;
                        }
                    }
                }
                return {
                    power: Math.floor(forests / 2),
                    toughness: Math.ceil(forests / 2),
                };
            },
        },
    ],
};

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
        // CR 611.1 / 514.2 — "+X/+0 until end of turn" is a temporary buff
        // that must expire at cleanup, NOT a permanent base-stat mutation.
        const power = ctx.getPower(target);
        ctx.addTemporaryPTBuff(target, power, 0, { phase: "end-of-turn" });
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
    oracleText: "Flying\n{T}: Add one mana of any color.",
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

// Out of scope — see ADR 0010
// export const camouflage: CardDefinition = {
//     id: "3838c2a3-7fab-4976-9c1b-2891aee24e52",
//     name: "Camouflage",
//     oracleText: "Cast this spell only during your declare attackers step.\nThis turn, instead of declaring blockers, each defending player chooses any number of creatures they control and divides them into a number of piles equal to the number of attacking creatures for whom that player is the defending player. Creatures those players control that can block additional creatures may likewise be put into additional piles. Assign each pile to a different one of those attacking creatures at random. Each creature in a pile that can block the creature that pile is assigned to does so. (Piles can be empty.)",
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

// --- Combat kill pattern (Cockatrice, Thicket Basilisk) ---
// "Whenever this creature blocks or becomes blocked by a non-Wall creature,
// destroy that creature at end of combat." (CR 509.1h, CR 511.3)

function combatKillTrigger(
    cardId: string,
    abilityId: string
): TriggeredAbility {
    const destroyTriggerId = `${abilityId}-destroy`;
    return {
        id: abilityId,
        oracleText:
            "Whenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.",
        event: "BLOCKERS_CONFIRMED",
        matches: (event, self) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return false;
            const isSelfAttacker = event.attackerId === self.id;
            const isSelfBlocker = event.blockerId === self.id;
            if (!isSelfAttacker && !isSelfBlocker) return false;
            const opponentSubtypes = isSelfAttacker
                ? event.blockerSubtypes
                : event.attackerSubtypes;
            return !opponentSubtypes.includes("Wall");
        },
        resolve: (ctx, event) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return;
            const isSelfAttacker = event.attackerId === ctx.sourceInstanceId;
            const opponentId = isSelfAttacker
                ? event.blockerId
                : event.attackerId;
            ctx.scheduleDelayedTrigger(
                cardId,
                destroyTriggerId,
                "next-end-of-combat",
                {
                    targetId: opponentId,
                }
            );
        },
    };
}

function combatKillDelayed(triggerId: string): DelayedTriggerDef {
    return {
        id: triggerId,
        oracleText: "Destroy that creature at end of combat.",
        timing: "next-end-of-combat",
        resolve: (ctx, payload) => {
            if (!payload.targetId) return;
            ctx.destroy({ type: "permanent", id: payload.targetId });
        },
    };
}

// Cockatrice — {3}{G}{G} 2/4, flying. "Whenever this creature blocks or
// becomes blocked by a non-Wall creature, destroy that creature at end of
// combat." (CR 509.1h combat pairing trigger, CR 511.3 end-of-combat timing)
const COCKATRICE_ID = "9cd91814-6177-4a3d-a1c1-a3be7d7c7957";
export const cockatrice: CardDefinition = {
    id: COCKATRICE_ID,
    name: "Cockatrice",
    oracleText:
        "Flying\nWhenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Cockatrice"],
    power: 2,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        combatKillTrigger(COCKATRICE_ID, "cockatrice-combat-kill"),
    ],
    delayedTriggers: [combatKillDelayed("cockatrice-combat-kill-destroy")],
};

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
    oracleText: "First strike",
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
//     oracleText: "You may play any number of lands on each of your turns.\nWhenever you play a land, if it wasn't the first land you played this turn, this enchantment deals 1 damage to you.",
//     manaCost: { G: 1 },
//     types: ["Enchantment"],
// };

// Force of Nature — "Trample. At the beginning of your upkeep, this
// creature deals 8 damage to you unless you pay {G}{G}{G}{G}." (CR 702.19
// trample, CR 603.6a phase trigger, CR 117.3a may-pay; on decline the
// source-of-damage is this creature itself, so the damage is sourced from
// the permanent's instance id — relevant for damage tracking and shields.)
export const forceOfNature: CardDefinition = {
    id: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3",
    name: "Force of Nature",
    oracleText:
        "Trample\nAt the beginning of your upkeep, this creature deals 8 damage to you unless you pay {G}{G}{G}{G}.",
    manaCost: { X: 2, G: 4 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 8,
    toughness: 8,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "force-of-nature-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 8 damage to you unless you pay {G}{G}{G}{G}.",
            cost: { G: 4 },
            prompt: "Pay {G}{G}{G}{G} or take 8 damage from Force of Nature?",
            onDecline: (ctx) =>
                ctx.dealDamage({ type: "player", id: ctx.controller }, 8),
        }),
    ],
};

// Fungusaur — "Whenever this creature is dealt damage, put a +1/+1 counter
// on it." (CR 603.2 damage trigger, CR 122.1 counter, CR 117.5 SBA-before-
// triggers ordering — lethal damage kills Fungusaur before the counter is
// applied, matching the official ruling).
export const fungusaur: CardDefinition = {
    id: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23",
    name: "Fungusaur",
    oracleText:
        "Whenever this creature is dealt damage, put a +1/+1 counter on it.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Fungus", "Dinosaur"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        damageTakenTrigger({
            id: "fungusaur-counter",
            oracleText:
                "Whenever this creature is dealt damage, put a +1/+1 counter on it.",
            target: {
                kind: "permanent",
                filter: { controllerRelation: "self" },
            },
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

// Gaea's Liege — "As long as Gaea's Liege isn't attacking, its power and
// toughness are each equal to the number of Forests you control. As long as
// Gaea's Liege is attacking, its power and toughness are each equal to the
// number of Forests defending player controls.\n{T}: Target land becomes a
// Forest until this creature leaves the battlefield."
// P/T via a layer 7c characteristic-defining ability (CR 604.3, 613.4c) that
// reads `isAttacking` (W14) to switch which player's Forests are counted.
// The {T} ability marks the target land with a `gaea-forest` counter; a
// counter-driven subtype-set (CR 305.7, layer 4) turns it into a Forest while
// Gaea's Liege is on the battlefield — when Gaea's Liege leaves,
// `unapplySourceStaticEffects` reverts the land (CR 611.2), satisfying "until
// this creature leaves the battlefield".
const countForestsControlledBy = (
    controllerId: string,
    state: StaticEffectStateView
): number => {
    let n = 0;
    for (const player of state.players) {
        for (const p of player.battlefield) {
            if (
                p.controllerId === controllerId &&
                p.subtypes.includes("Forest")
            ) {
                n++;
            }
        }
    }
    return n;
};

export const gaeasLiege: CardDefinition = {
    id: "e2b15221-c8b0-4861-9f8b-8a65834ad499",
    name: "Gaea's Liege",
    oracleText:
        "As long as Gaea's Liege isn't attacking, its power and toughness are each equal to the number of Forests you control. As long as Gaea's Liege is attacking, its power and toughness are each equal to the number of Forests defending player controls.\n{T}: Target land becomes a Forest until this creature leaves the battlefield.",
    manaCost: { X: 3, G: 3 },
    types: ["Creature"],
    subtypes: ["Avatar"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let n: number;
                if (source.isAttacking) {
                    // CR 509.1 — in a 2-player game the defending player is the
                    // attacker's sole opponent. The static-effect state view
                    // exposes no player ids, so derive the opponent's id from
                    // any permanent it controls; if it controls none it has no
                    // Forests either, so the count is 0.
                    const defenderId = state.players
                        .flatMap((pl) => pl.battlefield)
                        .find(
                            (c) => c.controllerId !== source.controllerId
                        )?.controllerId;
                    n = defenderId
                        ? countForestsControlledBy(defenderId, state)
                        : 0;
                } else {
                    n = countForestsControlledBy(source.controllerId, state);
                }
                return { power: n, toughness: n };
            },
        },
        {
            kind: "subtype-set",
            applies: (target) => (target.counters?.["gaea-forest"] ?? 0) > 0,
            subtypes: ["Forest"],
        },
    ],
    activatedAbilities: [
        {
            id: "gaeas-liege-make-forest",
            oracleText:
                "{T}: Target land becomes a Forest until this creature leaves the battlefield.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") {
                    ctx.addCounter(t, "gaea-forest", 1);
                }
            },
        },
    ],
};

export const giantGrowth: CardDefinition = {
    id: "367dbefe-3366-408e-9fcf-7dc00f8cc201",
    name: "Giant Growth",
    oracleText: "Target creature gets +3/+3 until end of turn.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // CR 611.1 / 514.2: "+3/+3 until end of turn" is a temporary P/T buff that
    // must expire at the cleanup step — NOT a permanent base-stat mutation.
    // `addTemporaryPTBuff` records it in `temporaryPTMods` with an end-of-turn
    // duration, which the cleanup duration tick purges.
    resolve: (ctx: SpellContext) => {
        ctx.addTemporaryPTBuff(ctx.targets[0], 3, 3, { phase: "end-of-turn" });
    },
};

// Giant Spider — vanilla 2/4 with reach. (CR 702.17 reach: a creature with
// reach can block a creature with flying.) Combat validator already honors
// "reach" alongside "flying" in `block.ts`.
export const giantSpider: CardDefinition = {
    id: "77636b4c-faea-4bf5-b88c-dd5bb88dc930",
    name: "Giant Spider",
    oracleText: "Reach (This creature can block creatures with flying.)",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 4,
    staticAbilities: ["reach"],
};

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
    oracleText:
        "Hurricane deals X damage to each creature with flying and each player.",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(ctx.getX(), {
            creatures: { requireAbility: "flying" },
            players: true,
        });
    },
};

// Ice Storm — "Destroy target land." (CR 701.7). Identical shape to Sinkhole
// / Stone Rain, distinct only in cost / color.
export const iceStorm: CardDefinition = {
    id: "9914836e-2fa6-4390-94b2-431427848a54",
    name: "Ice Storm",
    oracleText: "Destroy target land.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effect: "destroy-target",
};

// Instill Energy — "Enchant creature. Enchanted creature can attack as
// though it had haste. {0}: Untap enchanted creature. Activate only during
// your turn and only once each turn." (CR 303.4 aura, CR 702.10 haste
// surrogate, CR 602.5b activation timing.) Pseudo-haste is modeled by
// granting the host the regular "haste" keyword — slightly broader than the
// printed text (LEA pseudo-haste only allows attacking, not abilities) but
// adequate for the engine's binary summoning-sickness model. The {0}: untap
// uses `controllerTurnOnly` + `oncePerTurn` to enforce both timing
// restrictions without an open infinite-untap loop.
export const instillEnergy: CardDefinition = {
    id: "5bd38716-874c-4e3c-a315-837839a6258c",
    name: "Instill Energy",
    oracleText:
        "Enchant creature\nEnchanted creature can attack as though it had haste.\n{0}: Untap enchanted creature. Activate only during your turn and only once each turn.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
    ],
    activatedAbilities: [
        {
            id: "instill-energy-untap",
            oracleText:
                "{0}: Untap enchanted creature. Activate only during your turn and only once each turn.",
            cost: { mana: {} },
            useStack: true,
            controllerTurnOnly: true,
            oncePerTurn: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.untap({ type: "permanent", id: hostId });
            },
        },
    ],
};

export const ironrootTreefolk: CardDefinition = {
    id: "b93c5869-7777-44bb-967a-e9439b25ced4",
    name: "Ironroot Treefolk",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 3,
    toughness: 5,
};

// Kudzu — "Enchant land. When enchanted land becomes tapped, destroy it. That
// land's controller may attach this Aura to a land of their choice." (CR
// 701.20a becomes-tapped trigger, 701.3d attach, 704.5n orphan-aura SBA.)
//
// Resolution ordering note: the host is destroyed first, then the controller
// is asked (CR 117.3a "may") and chooses a new land (CR 608.2 mid-resolution
// choice). `ctx.destroy` is idempotent, so the replay-from-top that follows
// each choice suspension re-runs it harmlessly. Destroying before the choice
// keeps the dead host out of the candidate set without needing an exclusion
// filter. If the controller has no other land — or declines — Kudzu is left
// orphaned and SBA 704.5n moves it to the graveyard.
export const kudzu: CardDefinition = {
    id: "b2b72dcd-9ea1-4729-baae-ecd262fdff67",
    name: "Kudzu",
    oracleText:
        "Enchant land\nWhen enchanted land becomes tapped, destroy it. That land's controller may attach this Aura to a land of their choice.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "kudzu-tapped",
            oracleText:
                "When enchanted land becomes tapped, destroy it. That land's controller may attach this Aura to a land of their choice.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.destroy({ type: "permanent", id: tapped.id });
                const hostController = tapped.controllerId;
                const lands = ctx.getBattlefieldIds(hostController, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: `kudzu-may-${ctx.sourceInstanceId}`,
                    prompt: "Attach Kudzu to a land you control?",
                });
                if (accept === undefined) return;
                if (!accept) return;
                const picks = ctx.requestChoice({
                    playerId: hostController,
                    choiceId: `kudzu-reattach-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Choose a land to attach Kudzu to.",
                });
                if (picks === undefined) return;
                ctx.reattachAura(ctx.sourceInstanceId, picks[0]);
            },
        }),
    ],
};

// Ley Druid — "{T}: Untap target land." (CR 605 activated ability, 701.20a
// untap). Stack-using ability (not a mana ability per CR 605.1a — produces no
// mana directly).
export const leyDruid: CardDefinition = {
    id: "f9232508-d363-4ef3-987a-741f6bff331f",
    name: "Ley Druid",
    oracleText: "{T}: Untap target land.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "ley-druid-untap",
            oracleText: "{T}: Untap target land.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.untap(target);
            },
        },
    ],
};

// Lifeforce — "{G}, Sacrifice Lifeforce: Counter target black spell." (CR
// 701.5a counter, 202.2 color filter on stack target). Mirror of Deathgrip.
export const lifeforce: CardDefinition = {
    id: "e292577e-6232-44fa-a9c2-cc09949c6ed3",
    name: "Lifeforce",
    oracleText: "{G}{G}: Counter target black spell.",
    manaCost: { G: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "lifeforce-counter",
            oracleText: "{G}, Sacrifice Lifeforce: Counter target black spell.",
            cost: { mana: { G: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                colorFilter: "B",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "spell") ctx.counter(target);
            },
        },
    ],
};

export const lifelace: CardDefinition = makeLace({
    id: "38cb601b-a35c-412e-b386-e77dad3daa54",
    name: "Lifelace",
    oracleText:
        "Target spell or permanent becomes green. (Mana symbols on that permanent remain unchanged.)",
    manaCost: { G: 1 },
    color: "G",
});

export const livingArtifact: CardDefinition = {
    id: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e",
    name: "Living Artifact",
    oracleText:
        "Enchant artifact\nWhenever you're dealt damage, put that many vitality counters on this Aura.\nAt the beginning of your upkeep, you may remove a vitality counter from this Aura. If you do, you gain 1 life.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    triggeredAbilities: [
        damageTakenTrigger({
            id: "living-artifact-vitality",
            oracleText:
                "Whenever you're dealt damage, put that many vitality counters on Living Artifact.",
            target: {
                kind: "player",
                player: { relation: "controller" },
            },
            resolve: (ctx, _event, damage) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "vitality",
                    damage.amount
                );
            },
        }),
        phaseTrigger({
            id: "living-artifact-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may remove a vitality counter from Living Artifact. If you do, you gain 1 life.",
            phase: "UPKEEP",
            scope: "your",
            interveningIf: (_event, self) => {
                return (self.counters?.["vitality"] ?? 0) > 0;
            },
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    prompt: "Remove a vitality counter from Living Artifact to gain 1 life?",
                });
                if (accept === undefined) return;
                if (accept) {
                    const removed = ctx.removeCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "vitality",
                        1
                    );
                    if (removed > 0) {
                        ctx.gainLife(ctx.controller, 1);
                    }
                }
            },
        }),
    ],
};

// Living Lands — "All Forests are 1/1 creatures that are still lands."
// (CR 305.7 type-add + pt-cda). Global static: type-add Creature to all
// permanents with Forest subtype, pt-cda sets 1/1. Summoning sickness
// applies to newly-animated lands.
export const livingLands: CardDefinition = {
    id: "80be0580-7948-4d8e-8c0f-5e2797ac411b",
    name: "Living Lands",
    oracleText: "All Forests are 1/1 creatures that are still lands.",
    manaCost: { X: 3, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "type-add",
            applies: (target) => target.subtypes.includes("Forest"),
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target) => target.subtypes.includes("Forest"),
            compute: () => ({ power: 1, toughness: 1 }),
        },
    ],
};

export const llanowarElves: CardDefinition = {
    id: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb",
    name: "Llanowar Elves",
    oracleText: "{T}: Add {G}.",
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

// Lure — "Enchant creature. All creatures able to block enchanted creature
// do so." (CR 509.1c — block requirement, scope "all-able"). The
// StaticBlockRequirement is collected from attached auras at
// block-confirmation time; the combat validator auto-assigns every
// eligible defender creature to block the enchanted attacker.
export const lure: CardDefinition = {
    id: "2a87b26e-0431-42e9-b44f-94ba8546111a",
    name: "Lure",
    oracleText:
        "Enchant creature\nAll creatures able to block enchanted creature do so.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-requirement",
            id: "lure-must-block",
            oracleText: "All creatures able to block enchanted creature do so.",
            scope: "all-able",
        },
    ],
};

// Natural Selection — {G} Instant. "Look at the top three cards of target
// player's library, then put them back in any order. You may have that
// player shuffle." (CR 401.4 — peek; CR 701.20 — shuffle)
export const naturalSelection: CardDefinition = {
    id: "a8917dc8-01c0-4e72-9310-c4d501775411",
    name: "Natural Selection",
    oracleText:
        "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolveSteps: [
        // Step 0: peek top 3, request reorder
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            const topIds = ctx.peekLibraryTop(target.id, 3);
            const count = Math.min(topIds.length, 3);
            if (count === 0) return;
            const ordered = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                kind: "reorder-library",
                zone: "library",
                count,
                zoneOwnerId: target.id,
                prompt: "Put these cards back in any order (first = top).",
            });
            if (!ordered) return;
            ctx.reorderLibraryTop(target.id, ordered);
        },
        // Step 1: optional shuffle
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            const doShuffle = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: ctx.controller,
                prompt: "Shuffle target player's library?",
            });
            if (doShuffle === undefined) return;
            if (doShuffle) ctx.shuffleLibrary(target.id);
        },
    ],
};

// Regeneration — "Enchant creature. {G}: Regenerate enchanted creature."
// (CR 303.4 aura attachment, 701.15a regenerate, 614.5 destroy replacement,
// 506.4 remove from combat). The activated ability does not target — the
// affected creature is determined by the aura's `attachedTo` host. The
// regen rider is implemented engine-side via regenerateOrDestroy: each
// shield consumed heals damage, taps, and removes from combat.
export const regeneration: CardDefinition = {
    id: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4",
    name: "Regeneration",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\n{G}: Regenerate enchanted creature. (The next time that creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
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
    oracleText: "Return target card from your graveyard to your hand.",
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
    oracleText: "Flying",
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
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Nymph", "Dryad"],
    power: 1,
    toughness: 1,
    staticAbilities: ["forestwalk"],
};

// Stream of Life — "Target player gains X life." (CR 107.3 X cost, 118.3
// life gain).
export const streamOfLife: CardDefinition = {
    id: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9",
    name: "Stream of Life",
    oracleText: "Target player gains X life.",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "player") ctx.gainLife(target.id, ctx.getX());
    },
};

// Thicket Basilisk — {3}{G}{G} 2/4. Same combat kill as Cockatrice, no flying.
const THICKET_BASILISK_ID = "e92cce01-b3bd-4307-aae5-9a7c8fa386ab";
export const thicketBasilisk: CardDefinition = {
    id: THICKET_BASILISK_ID,
    name: "Thicket Basilisk",
    oracleText:
        "Whenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Basilisk"],
    power: 2,
    toughness: 4,
    triggeredAbilities: [
        combatKillTrigger(THICKET_BASILISK_ID, "basilisk-combat-kill"),
    ],
    delayedTriggers: [combatKillDelayed("basilisk-combat-kill-destroy")],
};

// Timber Wolves — vanilla 1/1 Wolf with banding (CR 702.21).
export const timberWolves: CardDefinition = {
    id: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01",
    name: "Timber Wolves",
    oracleText:
        "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 1,
    toughness: 1,
    staticAbilities: ["banding"],
};

export const tranquility: CardDefinition = {
    id: "774cc5a6-3a69-4812-add4-eb5eb6389238",
    name: "Tranquility",
    oracleText: "Destroy all enchantments.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Enchantment");
    },
};

export const tsunami: CardDefinition = {
    id: "9ed67d61-cf47-446b-b454-eb404a8686b7",
    name: "Tsunami",
    oracleText: "Destroy all Islands.",
    manaCost: { X: 3, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ subtypes: "Island" });
    },
};

// Verduran Enchantress — "Whenever you cast an enchantment spell, you may
// draw a card." (CR 603.2 spell-cast trigger; CR 117.3a optional). The
// trigger goes on top of the casting spell and resolves before it.
export const verduranEnchantress: CardDefinition = {
    id: "9f87178b-1221-4d7a-a7a5-20d7f01b8089",
    name: "Verduran Enchantress",
    oracleText: "Whenever you cast an enchantment spell, you may draw a card.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 0,
    toughness: 2,
    triggeredAbilities: [
        spellCastTrigger({
            id: "verduran-enchantress-draw",
            oracleText:
                "Whenever you cast an enchantment spell, you may draw a card.",
            scope: "you",
            filter: { types: "Enchantment" },
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    prompt: "Draw a card?",
                });
                if (accept === undefined) return;
                if (accept) ctx.drawCards(ctx.controller, 1);
            },
        }),
    ],
};

// Wall of Brambles — vanilla 2/3 Plant Wall with defender (CR 702.3).
export const wallOfBrambles: CardDefinition = {
    id: "af2a4558-db6e-41b2-aff6-b164d93282a0",
    name: "Wall of Brambles",
    oracleText:
        "Defender (This creature can't attack.)\n{G}: Regenerate this creature.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant", "Wall"],
    power: 2,
    toughness: 3,
    staticAbilities: ["defender"],
};

export const wallOfIce: CardDefinition = {
    id: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756",
    name: "Wall of Ice",
    oracleText: "Defender (This creature can't attack.)",
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
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender"],
};

// Wanderlust — "Enchant creature. At the beginning of the upkeep of
// enchanted creature's controller, this Aura deals 1 damage to that
// player." (CR 303.4 aura, CR 603.6a phase trigger keyed on the host's
// controller, CR 120.3 source = this Aura instance.) The damage source is
// the Aura itself, so death triggers on the Aura key from its
// `sourceInstanceId`, not from the host's controller.
export const wanderlust: CardDefinition = {
    id: "220a03ca-8c9b-4acb-821d-f6577fbb20fb",
    name: "Wanderlust",
    oracleText:
        "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, this Aura deals 1 damage to that player.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "wanderlust-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, this Aura deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 1);
            },
        }),
    ],
};

export const warMammoth: CardDefinition = {
    id: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb",
    name: "War Mammoth",
    oracleText: "Trample",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
};

// Web — "Enchant creature. Enchanted creature gets +0/+2 and has reach."
// (CR 303.4 aura, 611 layer 7c, 702.17 reach grant via static effect).
export const web: CardDefinition = {
    id: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0",
    name: "Web",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nEnchanted creature gets +0/+2 and has reach. (It can block creatures with flying.)",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 0,
            toughness: 2,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "reach",
        },
    ],
};

// Wild Growth — "Enchant land. Whenever enchanted land is tapped for mana,
// its controller adds an additional {G}." (CR 303.4 aura attachment, 603.2
// PERMANENT_TAPPED trigger, 605 mana ability). The aura's host is the
// "enchanted land"; the trigger fires only on for-mana taps of that host.
export const wildGrowth: CardDefinition = {
    id: "fd896dfa-66c0-4327-8e5b-489bbe350c95",
    name: "Wild Growth",
    oracleText:
        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "wild-growth-extra-green",
            oracleText:
                "Whenever enchanted land is tapped for mana, its controller adds an additional {G}.",
            scope: "any",
            forMana: true,
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.addManaTo(tapped.controllerId, { G: 1 });
            },
        }),
    ],
};

export const ankhOfMishra: CardDefinition = {
    id: "f594b7aa-d44e-47c4-989b-565f881e25f1",
    name: "Ankh of Mishra",
    oracleText:
        "Whenever a land enters the battlefield, Ankh of Mishra deals 2 damage to that land's controller.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "ankh-of-mishra-land-etb",
            oracleText:
                "Whenever a land enters the battlefield, Ankh of Mishra deals 2 damage to that land's controller.",
            scope: "any",
            filter: { types: "Land" },
            resolve: (ctx, _event, entered) => {
                ctx.dealDamage({ type: "player", id: entered.controllerId }, 2);
            },
        }),
    ],
};

// Basalt Monolith — "This artifact doesn't untap during your untap step.
// {T}: Add {C}{C}{C}. {3}: Untap this artifact." (CR 502.1 untap restriction,
// 605.1a/605.3a mana ability useStack: false, 605 activated abilities).
// The `does-not-untap` keyword is read by `untapStep` in `phases.ts`. The
// {3} untap is a non-mana activated ability that uses the stack so it can be
// responded to (the canonical {3} → reuse-for-mana combo with Power Artifact
// is out of scope of LEA's printed catalog, kept correct anyway).
export const basaltMonolith: CardDefinition = {
    id: "66a74c89-6f86-4ec8-af17-391cd5026054",
    name: "Basalt Monolith",
    oracleText:
        "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        makeTapForMana({
            id: "basalt-monolith-mana",
            oracleText: "{T}: Add {C}{C}{C}.",
            produces: { C: 3 },
        }),
        {
            id: "basalt-monolith-untap",
            oracleText: "{3}: Untap this artifact.",
            cost: { mana: { X: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
            },
        },
    ],
};

export const blackLotus: CardDefinition = {
    id: "b0faa7f2-b547-42c4-a810-839da50dadfe",
    name: "Black Lotus",
    oracleText:
        "{T}, Sacrifice this artifact: Add three mana of any one color.",
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

export const blackVise: CardDefinition = {
    id: "76ac72f8-5b1e-4d67-a796-ef69cde27424",
    name: "Black Vise",
    oracleText:
        "As Black Vise enters the battlefield, choose an opponent.\nAt the beginning of the chosen player's upkeep, Black Vise deals X damage to that player, where X is the number of cards in their hand minus 4, minimum 0.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "black-vise-upkeep",
            oracleText:
                "At the beginning of the chosen player's upkeep, Black Vise deals X damage to that player, where X is the number of cards in their hand minus 4, minimum 0.",
            phase: "UPKEEP",
            scope: "opponents",
            condition: (_event, _self, state) => {
                if (!state) return false;
                const opp = state.players.find(
                    (p) => p.id === _event.activePlayerId
                );
                if (!opp) return false;
                return opp.hand.length > 4;
            },
            resolve: (ctx, _event, scopedPlayerId) => {
                const handSize = ctx.getHandSize(scopedPlayerId);
                const damage = handSize - 4;
                if (damage > 0) {
                    ctx.dealDamage(
                        { type: "player", id: scopedPlayerId },
                        damage
                    );
                }
            },
        }),
    ],
};

// Celestial Prism — "{2}, {T}: Add one mana of any color." (CR 605.1a mana
// ability, 605.3a useStack: false). The choice of color is presented to the
// activator at activation time via `manaChoices`.
export const celestialPrism: CardDefinition = {
    id: "a47417cb-1ea7-4f65-ba06-e27a99373114",
    name: "Celestial Prism",
    oracleText: "{2}, {T}: Add one mana of any color.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "celestial-prism-mana",
            oracleText: "{2}, {T}: Add one mana of any color.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Out of scope — see ADR 0010
// export const chaosOrb: CardDefinition = {
//     id: "92274971-7c4a-4326-b0fe-75e2d124f718",
//     name: "Chaos Orb",
//     oracleText: "{1}, {T}: If this artifact is on the battlefield, flip it onto the battlefield from a height of at least one foot. If this artifact turns over completely at least once during the flip, destroy all nontoken permanents it touches. Then destroy this artifact.",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
// };

// Clockwork Beast — "This creature enters with seven +1/+0 counters on it. /
// At end of combat, if this creature attacked or blocked this combat, remove
// a +1/+0 counter from it. / {X}, {T}: Put up to X +1/+0 counters on this
// creature. Activate only if it has fewer than seven +1/+0 counters on it."
// (CR 122.1, 614.1c ETB counters; CR 603.6a end-of-combat trigger; layer 7d).
// The recharge ability uses the {X} mana cost pipeline on activated abilities
// (chosenX) and a `canActivate` precondition for the "fewer than seven" gate.
export const clockworkBeast: CardDefinition = {
    id: "27f916a2-0ace-44b5-99dc-72979af34db9",
    name: "Clockwork Beast",
    oracleText:
        "This creature enters with seven +1/+0 counters on it.\nAt end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.\n{X}, {T}: Put up to X +1/+0 counters on this creature. This ability can't cause the total number of +1/+0 counters on this creature to be greater than seven. Activate only during your upkeep.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Beast"],
    power: 0,
    toughness: 4,
    entersWith: { counters: [{ type: "+1/+0", count: 7 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "clockwork-beast-decay",
            oracleText:
                "At end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.",
            phase: "END_OF_COMBAT",
            scope: "each",
            // CR 603.4d intervening-if — checked at both trigger time and
            // resolve. The "attacked or blocked this combat" markers persist
            // past END_OF_COMBAT so the resolve-time re-check sees the same
            // values.
            interveningIf: (_event, self) =>
                self.hasAttackedThisTurn === true ||
                self.hasBlockedThisTurn === true,
            resolve: (ctx) => {
                ctx.removeCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+0",
                    1
                );
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "clockwork-beast-recharge",
            oracleText:
                "{X}, {T}: Put up to X +1/+0 counters on this creature. Activate only if it has fewer than seven +1/+0 counters on it.",
            cost: { mana: { X: "X" }, tap: true },
            useStack: true,
            canActivate: (source) => (source.counters?.["+1/+0"] ?? 0) < 7,
            resolve: (ctx: SpellContext) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const current = ctx.getCounterCount(self, "+1/+0");
                // Up to X counters, capped so the total never exceeds 7.
                const room = Math.max(0, 7 - current);
                const add = Math.min(ctx.getX(), room);
                if (add > 0) ctx.addCounter(self, "+1/+0", add);
            },
        },
    ],
};

// Conservator — "{3}, {T}: Prevent the next 2 damage that would be dealt
// to you this turn." (CR 615.1). 2-damage shield on the activator.
export const conservator: CardDefinition = {
    id: "c7824e2a-4eff-4f72-9216-0db30a4f4252",
    name: "Conservator",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "conservator-prevent",
            oracleText:
                "{3}, {T}: Prevent the next 2 damage that would be dealt to you this turn.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.preventNextNDamageToTarget(
                    { type: "player", id: ctx.controller },
                    2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Copper Tablet — "At the beginning of each player's upkeep, Copper Tablet
// deals 1 damage to that player." (CR 603.6a phase trigger, 120.1 damage).
// Symmetric ping at every upkeep — same shape as Karma but flat 1 damage,
// not Swamp-scaled.
export const copperTablet: CardDefinition = {
    id: "30935e4a-013e-4c46-ad05-304df8e5dfa4",
    name: "Copper Tablet",
    oracleText:
        "At the beginning of each player's upkeep, this artifact deals 1 damage to that player.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "copper-tablet-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, Copper Tablet deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, playerId) => {
                ctx.dealDamage({ type: "player", id: playerId }, 1);
            },
        }),
    ],
};

// Color-sphere cycle — "Whenever a player casts a [color] spell, you may pay
// {1}. If you do, you gain 1 life." (CR 603.2 spell-cast trigger; CR 117.3a
// optional may-pay). Five identical artifacts modulo the filtered color, so
// they share one factory.
function makeColorSphere(args: {
    id: string;
    name: string;
    oracleText?: string;
    color: Color;
    abilityIdSuffix: string;
    colorWord: string;
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        oracleText: args.oracleText,
        manaCost: { X: 1 },
        types: ["Artifact"],
        triggeredAbilities: [
            spellCastTrigger({
                id: `${args.abilityIdSuffix}-life`,
                oracleText: `Whenever a player casts a ${args.colorWord.toLowerCase()} spell, you may pay {1}. If you do, you gain 1 life.`,
                scope: "any",
                filter: { colors: args.color },
                resolve: (ctx) => {
                    const accept = ctx.requestMayPay({
                        playerId: ctx.controller,
                        choiceId: ctx.controller,
                        cost: { X: 1 },
                        prompt: `Pay {1} to gain 1 life from ${args.name}?`,
                    });
                    if (accept === undefined) return;
                    if (accept) ctx.gainLife(ctx.controller, 1);
                },
            }),
        ],
    };
}

export const crystalRod: CardDefinition = makeColorSphere({
    id: "76693233-7961-4b7e-80f2-ed90e494c4aa",
    name: "Crystal Rod",
    oracleText:
        "Whenever a player casts a blue spell, you may pay {1}. If you do, you gain 1 life.",
    color: "U",
    abilityIdSuffix: "crystal-rod",
    colorWord: "Blue",
});

// Cyclopean Tomb — "{2}, {T}: Put a mire counter on target non-Swamp land.
// That land is a Swamp for as long as it has a mire counter on it.
// When this is put into a graveyard from the battlefield, remove all mire
// counters and each land that had one becomes a Forest." (Simplified from
// the modern Oracle text for LEA scope.)
// CR 305.7 conditional subtype-set (mire counter > 0), CR 603.10 LTB.
export const cyclopeanTomb: CardDefinition = {
    id: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d",
    name: "Cyclopean Tomb",
    oracleText:
        "{2}, {T}: Put a mire counter on target non-Swamp land. That land is a Swamp for as long as it has a mire counter on it.\nWhen Cyclopean Tomb is put into a graveyard from the battlefield, remove all mire counters from all lands. Each land that had a mire counter removed this way becomes a Forest.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "cyclopean-tomb-mire",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            oracleText:
                "{2}, {T}: Put a mire counter on target non-Swamp land.",
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSubtypes: ["Swamp"],
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type === "permanent") ctx.addCounter(t, "mire", 1);
            },
        },
    ],
    staticEffects: [
        {
            kind: "subtype-set",
            applies: (target) => (target.counters?.mire ?? 0) > 0,
            subtypes: ["Swamp"],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "cyclopean-tomb-ltb",
            oracleText:
                "When Cyclopean Tomb is put into a graveyard from the battlefield, remove all mire counters from all lands. Each land that had a mire counter removed this way becomes a Forest.",
            scope: "self",
            toZone: "graveyard",
            resolve: (ctx) => {
                for (const player of ctx.apNapOrder()) {
                    const lands = ctx.getBattlefieldIds(player, {
                        types: "Land",
                    });
                    for (const landId of lands) {
                        const target: TargetSelection = {
                            type: "permanent",
                            id: landId,
                        };
                        const count = ctx.removeCounter(target, "mire", 999);
                        if (count > 0) {
                            ctx.setSubtypes(target, ["Forest"]);
                        }
                    }
                }
            },
        }),
    ],
};

export const dingusEgg: CardDefinition = {
    id: "65eb6cda-e512-40a8-9c1f-335b713409ff",
    name: "Dingus Egg",
    oracleText:
        "Whenever a land is put into a graveyard from the battlefield, Dingus Egg deals 2 damage to that land's controller.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    triggeredAbilities: [
        leftTrigger({
            id: "dingus-egg-land-dies",
            oracleText:
                "Whenever a land is put into a graveyard from the battlefield, Dingus Egg deals 2 damage to that land's controller.",
            scope: "any",
            toZone: "graveyard",
            filter: { types: "Land" },
            resolve: (ctx, _event, leaving) => {
                ctx.dealDamage({ type: "player", id: leaving.controllerId }, 2);
            },
        }),
    ],
};

// export const disruptingScepter: CardDefinition = {
//     id: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9",
//     name: "Disrupting Scepter",
//     oracleText: "{3}, {T}: Target player discards a card. Activate only during your turn.",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// Forcefield — "{1}: The next time an unblocked creature of your choice would
// deal combat damage to you this turn, prevent all but 1 of that damage."
// (CR 615.1 damage prevention, one-shot cap shield). Activated ability adds a
// damage-cap shield consumed at combat damage time.
export const forcefield: CardDefinition = {
    id: "3f2004c1-8efe-407f-bf48-27b807422eea",
    name: "Forcefield",
    oracleText:
        "{1}: The next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but 1 of that damage.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "forcefield-activate",
            oracleText:
                "{1}: Prevent all but 1 combat damage from the next unblocked creature.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addDamageCapShield(ctx.controller, 1);
            },
        },
    ],
};

export const gauntletOfMight: CardDefinition = {
    id: "da248001-ed75-4b68-9532-37d3cd5afc4c",
    name: "Gauntlet of Might",
    oracleText:
        "Red creatures get +1/+1.\nWhenever a Mountain is tapped for mana, its controller adds an additional {R}.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("R"),
            power: 1,
            toughness: 1,
        },
    ],
    triggeredAbilities: [
        tappedTrigger({
            id: "gauntlet-mana-bonus",
            oracleText:
                "Whenever a Mountain is tapped for mana, its controller adds an additional {R}.",
            scope: "any",
            filter: { subtypes: "Mountain" },
            forMana: true,
            resolve: (ctx, _event, tapped) => {
                ctx.addManaTo(tapped.controllerId, { R: 1 });
            },
        }),
    ],
};

// Glasses of Urza — {1} Artifact. "{T}: Look at target player's hand."
// (CR 401.4 — "look at" is a one-time reveal to the ability's controller)
export const glassesOfUrza: CardDefinition = {
    id: "cafc2350-5d64-4379-9198-79a114654d45",
    name: "Glasses of Urza",
    oracleText: "{T}: Look at target player's hand.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "glasses-look",
            cost: { tap: true },
            oracleText: "{T}: Look at target player's hand.",
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                ctx.revealHand(target.id);
            },
        },
    ],
};

// Helm of Chatzuk — "{1}, {T}: Target creature gains banding until end of
// turn." Temporary keyword grant (CR 611.1b) via grantStaticAbility with an
// end-of-turn duration, mirroring Jump (flying).
export const helmOfChatzuk: CardDefinition = {
    id: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393",
    name: "Helm of Chatzuk",
    oracleText: "{1}, {T}: Target creature gains banding until end of turn.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "helm-of-chatzuk-grant-banding",
            oracleText:
                "{1}, {T}: Target creature gains banding until end of turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "banding", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Howling Mine — "At the beginning of each player's draw step, if this
// artifact is untapped, that player draws an additional card."
// CR 603.6a (beginning-of-step trigger), CR 603.4 (intervening-if: condition
// checked at trigger time AND again at resolution). Fires on DRAW for both
// players — the active player at the time of the trigger is the one who
// draws, not the artifact's controller.
export const howlingMine: CardDefinition = {
    id: "51f8f6e1-a451-4262-90d3-5107caf54175",
    name: "Howling Mine",
    oracleText:
        "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "howling-mine-draw",
            oracleText:
                "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card.",
            phase: "DRAW",
            scope: "each",
            // CR 603.4d intervening-if — checked at both trigger time and
            // resolve. If the artifact is tapped between trigger and
            // resolve (Icy Manipulator response), the trigger fizzles.
            interveningIf: (_event, self) => !self.isTapped,
            resolve: (ctx, _event, playerId) => {
                ctx.drawCards(playerId, 1);
            },
        }),
    ],
};

// Icy Manipulator — "{1}, {T}: Tap target artifact, creature, or land."
// CR 701.20a (tap), CR 605 (activated abilities), CR 602.2 (target selection
// at activation). Uses the stack (not a mana ability) so it can be responded to.
export const icyManipulator: CardDefinition = {
    id: "29dc1596-a2e7-4d60-9f99-89babaef8a06",
    name: "Icy Manipulator",
    oracleText: "{1}, {T}: Tap target artifact, creature, or land.",
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

// Illusionary Mask — masked-cast path (ADR 0013, #123). The activated
// ability spends {X}, lets the controller pick an eligible creature card from
// hand, and casts it face down as a 2/2 creature spell paying no mana cost
// (CR 708.2). It resolves into a face-down permanent (built in #122).
//
// Eligibility simplification: the card reads "creature card whose mana cost
// could be paid by some amount of, or all of, the mana you spent on {X}". The
// {X} is colourless/generic mana; a strict colour-pip match would make nearly
// no creature eligible, defeating the card's intent. We approximate with the
// standard digital reading — mana value <= X (CR 202.3b: X counts as 0 in the
// candidate's printed cost).
//
// "Activate only as a sorcery" is approximated by a main-phase + own-turn
// restriction; the empty-stack requirement is not enforced (minor).
//
// Turn-up (the "would deal/be dealt damage or become tapped -> turn face up"
// clause) is out of scope for this slice and lands in #124.
export const illusionaryMask: CardDefinition = {
    id: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b",
    name: "Illusionary Mask",
    oracleText:
        "{X}: You may choose a creature card in your hand whose mana cost could be paid by some amount of, or all of, the mana you spent on {X}. If you do, you may cast that card face down as a 2/2 creature spell without paying its mana cost. If the creature that spell becomes as it resolves has not been turned face up and would assign or deal damage, be dealt damage, or become tapped, instead it's turned face up and assigns or deals damage, is dealt damage, or becomes tapped. Activate only as a sorcery.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "illusionary-mask-cast",
            oracleText:
                "{X}: You may choose a creature card in your hand whose mana cost could be paid by some amount of, or all of, the mana you spent on {X}. If you do, you may cast that card face down as a 2/2 creature spell without paying its mana cost. Activate only as a sorcery.",
            cost: { mana: { X: "X" } },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
            resolve: (ctx: SpellContext) => {
                const x = ctx.getX();
                const eligible = ctx
                    .getHandCards(ctx.caster)
                    .filter(
                        (c) => c.types.includes("Creature") && c.manaValue <= x
                    )
                    .map((c) => c.id);
                if (eligible.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.caster,
                    choiceId: "illusionary-mask-pick",
                    kind: "choose-hand-card",
                    zone: "hand",
                    count: { min: 0, max: 1 },
                    candidateIds: eligible,
                    prompt: "Illusionary Mask: choose a creature to cast face down, or skip.",
                });
                if (picks === undefined) return; // suspended — resume later
                if (picks.length === 0) return; // declined ("you may")
                ctx.castFaceDown(picks[0]);
            },
        },
    ],
};

export const ironStar: CardDefinition = makeColorSphere({
    id: "5786de12-cade-43c2-a6b0-0c5b294b9d0e",
    name: "Iron Star",
    oracleText:
        "Whenever a player casts a red spell, you may pay {1}. If you do, you gain 1 life.",
    color: "R",
    abilityIdSuffix: "iron-star",
    colorWord: "Red",
});

export const ivoryCup: CardDefinition = makeColorSphere({
    id: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd",
    name: "Ivory Cup",
    oracleText:
        "Whenever a player casts a white spell, you may pay {1}. If you do, you gain 1 life.",
    color: "W",
    abilityIdSuffix: "ivory-cup",
    colorWord: "White",
});

// Jade Monolith — "{1}: The next time a source of your choice would deal
// damage to target creature this turn, that source deals that damage to you
// instead." (CR 614 one-shot transient redirection.) The activated ability
// targets the creature at activation (CR 601.2c) and resolves with a
// `requestChoice` step that asks the activator to name the specific source
// (CR 109.4 — typically a battlefield permanent). The chosen source id is
// baked into a `from-source-to-permanent-redirect-to-player` shield with
// `remaining: 1`. The shield self-purges either on first match or at end of
// turn. If the activator's `requestChoice` is skipped (the engine prompt
// can return an empty list when no candidates exist), the shield falls back
// to wildcard-source matching so the activation isn't wasted.
export const jadeMonolith: CardDefinition = {
    id: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a",
    name: "Jade Monolith",
    oracleText:
        "{1}: The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jm-redirect",
            oracleText:
                "{1}: The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead.",
            cost: { mana: { X: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (!t || t.type !== "permanent") return;
                const sourcePicks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `jm-source-${ctx.sourceInstanceId}`,
                    kind: "pick-source",
                    zone: "battlefield",
                    count: 1,
                    prompt: "Jade Monolith: pick the source whose next damage to the chosen creature is redirected to you.",
                });
                if (sourcePicks === undefined) return;
                const sourceId = sourcePicks[0];
                ctx.addDamageRedirectionShield({
                    kind: "from-source-to-permanent-redirect-to-player",
                    sourceInstanceId: sourceId,
                    targetInstanceId: t.id,
                    redirectToPlayerId: ctx.controller,
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                });
            },
        },
    ],
};

// Jade Statue — "{2}: This artifact becomes a 3/6 Golem artifact creature
// until end of combat. Activate only during combat." (CR 208.2, 611.1,
// 511.3, 602.5). The "activate only during combat" restriction is enforced
// via `activationPhaseRestriction`; the animate-self effect uses the shared
// parametric-duration system with `phase: "end-of-combat"` so it reverts
// automatically at the END_OF_COMBAT step.
export const jadeStatue: CardDefinition = {
    id: "8d82d94b-ceef-4533-a4f2-b6442a61b839",
    name: "Jade Statue",
    oracleText:
        "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.",
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
    oracleText: "{4}, {T}: Draw a card.",
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
    oracleText:
        "This creature attacks each combat if able.\nThis creature can't be blocked by Walls.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Juggernaut"],
    power: 5,
    toughness: 3,
    staticAbilities: [],
    staticEffects: [
        {
            // CR 508.1d — attacks each combat if able
            kind: "attack-requirement" as const,
            id: "juggernaut-attacks-if-able",
            oracleText: "Juggernaut attacks each combat if able.",
        },
        {
            kind: "block-restriction",
            id: "juggernaut-no-walls",
            side: "attacker" as const,
            // CR 509.1b — can't be blocked by Walls
            predicate: (_self, opponent) => !opponent.subtypes.includes("Wall"),
            oracleText: "This creature can't be blocked by Walls.",
        },
    ],
};

// Kormus Bell — "All Swamps are 1/1 black creatures that are still lands."
// (CR 305.7 type-add + pt-cda + color-grant). Same pattern as Living Lands
// but for Swamps + grants black color.
export const kormusBell: CardDefinition = {
    id: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6",
    name: "Kormus Bell",
    oracleText: "All Swamps are 1/1 black creatures that are still lands.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "type-add",
            applies: (target) => target.subtypes.includes("Swamp"),
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target) => target.subtypes.includes("Swamp"),
            compute: () => ({ power: 1, toughness: 1 }),
        },
        {
            kind: "color-grant",
            applies: (target) => target.subtypes.includes("Swamp"),
            colors: ["B"],
        },
    ],
};

// Library of Leng — "You have no maximum hand size. If an effect causes you
// to discard a card, discard it, but you may put it on top of your library
// instead of into your graveyard." (CR 402.2 / 514.1 + CR 614 discard
// replacement.) The first clause is a `StaticHandSizeOverride` ("unlimited")
// — read by `effectiveMaxHandSize` in `convex/gre/phases.ts` at CLEANUP, so
// the controller is never prompted to discard down to seven while the
// artifact is in play. No PlayerState mutation: the override is computed
// inline from the battlefield (mirror of the `untap-restriction` pattern),
// so multiple copies / mid-turn enter/leave events need no bookkeeping.
//
// The "may" clause is resolved via `state.playerPreferences[playerId]
// .libraryOfLengRouting`, which the UI can toggle through a dedicated
// mutation. The default is "library" (Library of Leng activates) — set to
// "graveyard" to opt OUT and route the discard normally. Modeling player
// choice this way (state-level preference) avoids the mid-event suspension
// that would be needed for a true requestMayPay flow inside a replacement
// effect; the preference is replay-stable and toggleable at any time.
export const libraryOfLeng: CardDefinition = {
    id: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495",
    name: "Library of Leng",
    oracleText:
        "You have no maximum hand size.\nIf an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "hand-size-override",
            value: "unlimited",
        },
    ],
    replacementEffects: [
        {
            id: "leng-discard",
            oracleText:
                "If an effect causes you to discard a card, you may put that card on top of your library instead of into your graveyard.",
            eventKind: "discard",
            appliesTo: (event, self, state) => {
                if (event.kind !== "discard") return false;
                if (event.playerId !== self.controllerId) return false;
                const player = state.players.find(
                    (p) => p.id === event.playerId
                );
                // "May" opt-out: the player can preset
                // libraryOfLengRouting: "graveyard" to bypass the redirect.
                // Default (undefined) routes to the library.
                return (
                    (player?.preferences?.libraryOfLengRouting ?? "library") ===
                    "library"
                );
            },
            replace: (event, ctx) => {
                if (event.kind !== "discard") return { kind: "consumed" };
                ctx.moveHandCardToLibraryTop(
                    event.playerId,
                    event.cardInstanceId
                );
                return { kind: "consumed" };
            },
        },
    ],
};

export const livingWall: CardDefinition = {
    id: "4a98ada6-923a-44a5-bdef-ea6a160b481e",
    name: "Living Wall",
    oracleText:
        "Defender (This creature can't attack.)\n{1}: Regenerate Living Wall.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "living-wall-regenerate",
            oracleText: "{1}: Regenerate Living Wall.",
            cost: { mana: { X: 1 } },
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

// Mana Vault — "This artifact doesn't untap during your untap step. At the
// beginning of your upkeep, you may pay {4}. If you do, untap this artifact.
// At the beginning of your draw step, if this artifact is tapped, it deals 1
// damage to you. {T}: Add {C}{C}{C}." (CR 502.1, 603.4 intervening-if,
// 117.3a optional cost, 120.3 damage). The draw-step damage trigger uses an
// intervening-if at both trigger and resolve time per CR 603.4.
export const manaVault: CardDefinition = {
    id: "19499cb7-eccb-4e69-af32-6002d447a160",
    name: "Mana Vault",
    oracleText:
        "This artifact doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\nAt the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticAbilities: ["does-not-untap"],
    triggeredAbilities: [
        phaseTrigger({
            id: "mana-vault-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { X: 4 },
                    prompt: "Pay {4} to untap Mana Vault?",
                });
                if (accept === undefined) return;
                if (accept) {
                    ctx.untap({
                        type: "permanent",
                        id: ctx.sourceInstanceId,
                    });
                }
            },
        }),
        phaseTrigger({
            id: "mana-vault-draw-damage",
            oracleText:
                "At the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.",
            phase: "DRAW",
            scope: "your",
            // CR 603.4d intervening-if — checked at both trigger time and
            // resolve. If the artifact has untapped between trigger and
            // resolve (e.g. paid upkeep), the ping fizzles.
            interveningIf: (_event, self) => self.isTapped === true,
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        }),
    ],
    activatedAbilities: [
        makeTapForMana({
            id: "mana-vault-mana",
            oracleText: "{T}: Add {C}{C}{C}.",
            produces: { C: 3 },
        }),
    ],
};

// Meekstone — "Creatures with power 3 or greater don't untap during their
// controllers' untap steps." (CR 502.1, 613 layer 7c). Encoded as a
// data-driven `untapRestriction` (ADR 0002 / 0005) on the Creature filter
// with `powerAtLeast: 3` and `maxUntap: 0`: the engine dispatcher reads
// effective power at untap time, so layer 7c buffs (Crusade, Holy Strength)
// flip eligibility correctly. Hard skip (cap=0) — no prompt, the matching
// creatures stay tapped.
export const meekstone: CardDefinition = {
    id: "13a68a17-22ee-47c9-870a-83e911862b94",
    name: "Meekstone",
    oracleText:
        "Creatures with power 3 or greater don't untap during their controllers' untap steps.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        untapRestriction({
            id: "meekstone-power-skip",
            oracleText:
                "Creatures with power 3 or greater don't untap (Meekstone).",
            filter: { types: "Creature", powerAtLeast: 3 },
            maxUntap: 0,
        }),
    ],
};

export const moxEmerald: CardDefinition = {
    id: "b0e1427c-05cd-465b-be59-97ed6e39f7ba",
    name: "Mox Emerald",
    oracleText: "{T}: Add {G}.",
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
    oracleText: "{T}: Add {B}.",
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
    oracleText: "{T}: Add {W}.",
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
    oracleText: "{T}: Add {R}.",
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
    oracleText: "{T}: Add {U}.",
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
    oracleText:
        "This artifact enters tapped.\n{1}, {T}: Destroy all artifacts, creatures, and enchantments.",
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

// Rod of Ruin — "{3}, {T}: Rod of Ruin deals 1 damage to any target." (CR
// 605 activated ability, 120.1 damage). Same shape as Prodigal Sorcerer's
// ping but on an artifact body.
export const rodOfRuin: CardDefinition = {
    id: "af957200-c538-4f52-b105-6db7a7abb4dc",
    name: "Rod of Ruin",
    oracleText: "{3}, {T}: This artifact deals 1 damage to any target.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "rod-of-ruin-shoot",
            oracleText: "{3}, {T}: Rod of Ruin deals 1 damage to any target.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
            },
        },
    ],
};

export const solRing: CardDefinition = {
    id: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd",
    name: "Sol Ring",
    oracleText: "{T}: Add {C}{C}.",
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

// Soul Net — "Whenever a creature dies, you may pay {1}. If you do, you gain
// 1 life." (CR 603.2 death trigger; CR 117.3a optional may-pay).
export const soulNet: CardDefinition = {
    id: "2b814198-814b-4619-a158-327af675f8f2",
    name: "Soul Net",
    oracleText:
        "Whenever a creature dies, you may pay {1}. If you do, you gain 1 life.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        diedTrigger({
            id: "soul-net-life",
            oracleText:
                "Whenever a creature dies, you may pay {1}. If you do, you gain 1 life.",
            scope: "any",
            resolve: (ctx) => {
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: ctx.controller,
                    cost: { X: 1 },
                    prompt: "Pay {1} to gain 1 life from Soul Net?",
                });
                if (accept === undefined) return;
                if (accept) ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Sunglasses of Urza — "You may spend white mana as though it were red mana."
// (CR 609.4b mana substitution.) Declared as a `mana-substitution` static
// effect; `getManaSubstitutions` scans the controller's battlefield live at
// payment time, so removing the artifact reverts the substitution with no
// per-player persisted state.
export const sunglassesOfUrza: CardDefinition = {
    id: "c0d433a4-76c0-4f27-836d-4c0c13a511fb",
    name: "Sunglasses of Urza",
    oracleText: "You may spend white mana as though it were red mana.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    staticEffects: [{ kind: "mana-substitution", from: "W", to: "R" }],
};

// The Hive — "{5}, {T}: Create a 1/1 colorless Insect artifact creature
// token with flying named Wasp." (CR 111 / 707.1 token creation, 702.9
// flying.) Uses the new `createToken` primitive; the token is wiped from
// any non-battlefield zone by CR 704.5d (`checkTokenExistenceSBA`).
// Token print Scryfall id is resolved from
// `convex/cards/generated/token-prints.json` — refresh that mapping by
// running `node scripts/fetch-token-prints.mjs convex/cards/sets/*.ts`.
const HIVE_ID = "544a7138-eae8-4ff9-9e17-680bfa717183";
export const theHive: CardDefinition = {
    id: HIVE_ID,
    name: "The Hive",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "the-hive-wasp",
            oracleText:
                "{5}, {T}: Create a 1/1 colorless Insect artifact creature token with flying named Wasp.",
            cost: { mana: { X: 5 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(
                    {
                        name: "Wasp",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Insect"],
                        power: 1,
                        toughness: 1,
                        staticAbilities: ["flying"],
                        imagePrintId: tokenPrintIdFor(HIVE_ID, "Wasp"),
                    },
                    ctx.controller
                );
            },
        },
    ],
};

export const throneOfBone: CardDefinition = makeColorSphere({
    id: "a2931ae0-7836-4000-b9ec-f2029ebf5d96",
    name: "Throne of Bone",
    oracleText:
        "Whenever a player casts a black spell, you may pay {1}. If you do, you gain 1 life.",
    color: "B",
    abilityIdSuffix: "throne-of-bone",
    colorWord: "Black",
});

// Winter Orb — modern Oracle (Scryfall, ADR 0004): "Players can't untap
// more than one land during their untap steps." (CR 502.1). Encoded as a
// data-driven `untapRestriction` (ADR 0002 / 0005): the engine dispatcher
// in `untapStep` collects the restriction, computes the active player's
// tapped-lands eligible set, and either auto-resolves the cap or enqueues
// an `untap-pick` `PendingChoice` for the active player to declare which
// land untaps. Non-land permanents (artifacts, creatures, enchantments)
// are unaffected — the printed "artifact, creature, or land" clause from
// the LEA printing is intentionally NOT followed (ADR 0004).
export const winterOrb: CardDefinition = {
    id: "9359f60c-9a27-4e53-b35b-964a121a6fba",
    name: "Winter Orb",
    oracleText:
        "Players can't untap more than one land during their untap steps.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticEffects: [
        untapRestriction({
            id: "winter-orb-land-cap",
            oracleText: "Untap up to one land (Winter Orb).",
            filter: { types: "Land" },
            maxUntap: 1,
        }),
    ],
};

export const woodenSphere: CardDefinition = makeColorSphere({
    id: "bcae01a2-171b-47cd-87be-f1e4e5314326",
    name: "Wooden Sphere",
    oracleText:
        "Whenever a player casts a green spell, you may pay {1}. If you do, you gain 1 life.",
    color: "G",
    abilityIdSuffix: "wooden-sphere",
    colorWord: "Green",
});

// --- Dual lands (LEA) ---
// Two basic land types for rules interactions (Armageddon, landwalk, etc.).
// The two mana abilities are modelled as a single choice ability so the
// frontend picker works the same as Birds of Paradise. `tapForPayment`
// requires a `manaChoiceIndex` for these; the bot's `planManaPayment` derives
// it from `getProducibleManaOptions`, which resolves the choice ability ahead
// of the intrinsic basic-land-subtype path so the index is never dropped.

export const badlands: CardDefinition = makeDualLand({
    id: "717f6d10-9144-4ade-9ac6-a481cc66b875",
    name: "Badlands",
    oracleText: "({T}: Add {B} or {R}.)",
    colors: ["B", "R"],
});

export const bayou: CardDefinition = makeDualLand({
    id: "412ceddd-2b9a-4551-a6bf-ae2830a2010a",
    name: "Bayou",
    oracleText: "({T}: Add {B} or {G}.)",
    colors: ["B", "G"],
});

export const plateau: CardDefinition = makeDualLand({
    id: "6eafa00b-c628-40f6-86eb-88e1361fc7a0",
    name: "Plateau",
    oracleText: "({T}: Add {R} or {W}.)",
    colors: ["R", "W"],
});

export const savannah: CardDefinition = makeDualLand({
    id: "94f7e24c-2546-41b6-81ad-5e920b07e64e",
    name: "Savannah",
    oracleText: "({T}: Add {G} or {W}.)",
    colors: ["G", "W"],
});

export const scrubland: CardDefinition = makeDualLand({
    id: "bebe39d4-21fb-46a4-a1ec-b97102e46c15",
    name: "Scrubland",
    oracleText: "({T}: Add {W} or {B}.)",
    colors: ["W", "B"],
});

export const taiga: CardDefinition = makeDualLand({
    id: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be",
    name: "Taiga",
    oracleText: "({T}: Add {R} or {G}.)",
    colors: ["R", "G"],
});

export const tropicalIsland: CardDefinition = makeDualLand({
    id: "a9c6c759-aabf-44e7-ba8c-33c5df232b56",
    name: "Tropical Island",
    oracleText: "({T}: Add {G} or {U}.)",
    colors: ["G", "U"],
});

export const tundra: CardDefinition = makeDualLand({
    id: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb",
    name: "Tundra",
    oracleText: "({T}: Add {W} or {U}.)",
    colors: ["W", "U"],
});

export const undergroundSea: CardDefinition = makeDualLand({
    id: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3",
    name: "Underground Sea",
    oracleText: "({T}: Add {U} or {B}.)",
    colors: ["U", "B"],
});

export const plains: CardDefinition = {
    id: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    name: "Plains",
    oracleText: "({T}: Add {W}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Plains"],
};

export const island: CardDefinition = {
    id: "90a57c0e-fa61-45ef-955d-d296403967d5",
    name: "Island",
    oracleText: "({T}: Add {U}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Island"],
};

export const swamp: CardDefinition = {
    id: "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
    name: "Swamp",
    oracleText: "({T}: Add {B}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Swamp"],
};

export const mountain: CardDefinition = {
    id: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    name: "Mountain",
    oracleText: "({T}: Add {R}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Mountain"],
};

export const forest: CardDefinition = {
    id: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
    name: "Forest",
    oracleText: "({T}: Add {G}.)",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Forest"],
};

// Terror — {1}{B} Instant. "Destroy target nonartifact, nonblack creature.
// It can't be regenerated." (CR 701.7, 701.15c, 202.2, 205)
export const terror: CardDefinition = {
    id: "21004958-2c7e-4a55-bc80-411c4d780106",
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
    resolve: (ctx: SpellContext) => {
        ctx.destroy(ctx.targets[0], { cantBeRegenerated: true });
    },
};

// Fog — {G} Instant. "Prevent all combat damage that would be dealt this
// turn." (CR 615)
export const fog: CardDefinition = {
    id: "cfba606d-bb55-43ba-aa0c-299649958788",
    name: "Fog",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { G: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.preventAllCombatDamage();
    },
};

// Disrupting Scepter — {3} Artifact. "{3}, {T}: Target player discards a
// card. Activate only during your turn." (CR 701.8, 602.5b)
export const disruptingScepter: CardDefinition = {
    id: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9",
    name: "Disrupting Scepter",
    oracleText:
        "{3}, {T}: Target player discards a card. Activate only during your turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "disrupting-scepter-discard",
            oracleText:
                "{3}, {T}: Target player discards a card. Activate only during your turn.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const targetPlayerId = ctx.targets[0].id;
                if (ctx.getHandSize(targetPlayerId) === 0) return;
                const picks = ctx.requestChoice({
                    playerId: targetPlayerId,
                    choiceId: targetPlayerId,
                    kind: "discard-hand",
                    zone: "hand",
                    count: 1,
                    prompt: "Choose a card to discard",
                });
                if (!picks) return;
                ctx.discardCard(targetPlayerId, picks[0]);
            },
        },
    ],
};

// ---------------------------------------------------------------------------
// W16: Exile-on-death + unlimited land drops
// ---------------------------------------------------------------------------

// Disintegrate — {X}{R} Sorcery. "Disintegrate deals X damage to any target.
// If it's a creature, it can't be regenerated this turn, and if it would die
// this turn, exile it instead." (CR 614.1a — exile-on-death replacement)
export const disintegrate: CardDefinition = {
    id: "8712c49e-f171-4669-bed9-87575a37af11",
    name: "Disintegrate",
    oracleText:
        "Disintegrate deals X damage to any target. If it's a creature, it can't be regenerated this turn, and if it would die this turn, exile it instead.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t) return;
        if (t.type === "permanent") {
            ctx.setExileOnDeath(t);
        }
        ctx.dealDamage(t, ctx.getX());
    },
};

// Fastbond — {G} Enchantment. "You may play any number of lands on each of
// your turns. Whenever you play a land, if it wasn't the first land you played
// this turn, Fastbond deals 1 damage to you." (CR 305.2 — extra land drops)
export const fastbond: CardDefinition = {
    id: "a575a9af-e1de-4a1d-91d8-440585377e4f",
    name: "Fastbond",
    oracleText:
        "You may play any number of lands on each of your turns.\nWhenever you play a land, if it wasn't the first land you played this turn, this enchantment deals 1 damage to you.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    extraLandDrops: 999,
    triggeredAbilities: [
        enteredTrigger({
            id: "fastbond-land-etb",
            oracleText:
                "Whenever you play a land, if it wasn't the first land you played this turn, Fastbond deals 1 damage to you.",
            scope: "yours",
            filter: { types: "Land" },
            condition: (_event, self, state) => {
                if (!state) return false;
                const player = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return (player?.landsPlayedThisTurn ?? 0) > 1;
            },
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        }),
    ],
};

// Time Vault — {2} Artifact. Enters tapped. Doesn't untap during your untap
// step. "Skip your next turn: Untap Time Vault." "{T}: Take an extra turn
// after this one." (CR 614.10, 500.7)
export const timeVault: CardDefinition = {
    id: "c01a4081-dbb0-4a40-a27b-26e9a1b48803",
    name: "Time Vault",
    oracleText:
        "Time Vault enters tapped.\nTime Vault doesn't untap during your untap step.\nSkip your next turn: Untap Time Vault.\n{T}: Take an extra turn after this one.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    entersTapped: true,
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        {
            id: "time-vault-untap",
            oracleText: "Skip your next turn: Untap Time Vault.",
            cost: {},
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.setSkipNextTurn(ctx.controller);
                ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
            },
        },
        {
            id: "time-vault-extra-turn",
            oracleText: "{T}: Take an extra turn after this one.",
            cost: { tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.takeExtraTurn(ctx.controller);
            },
        },
    ],
};

// Mana Short — {2}{U} Instant. "Tap all lands target player controls. That
// player loses all unspent mana." (CR 106.4)
export const manaShort: CardDefinition = {
    id: "a0486cfc-b33f-4e20-a28e-c2a7e92e3a17",
    name: "Mana Short",
    oracleText:
        "Tap all lands target player controls. That player loses all unspent mana.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const targetPlayerId = ctx.targets[0].id;
        ctx.tapAllLands(targetPlayerId);
        ctx.drainManaPool(targetPlayerId);
    },
};

// Drain Power — {U}{U} Sorcery. "Target player activates a mana ability of
// each land they control. Then that player loses all unspent mana and you add
// the mana lost this way." Simplified model: tap all target's lands, drain
// their pool, add drained mana to caster. (CR 106.4)
export const drainPower: CardDefinition = {
    id: "b4f0660a-40e6-4d6e-9e1b-4d26e2e7de47",
    name: "Drain Power",
    oracleText:
        "Target player activates a mana ability of each land they control. Then that player loses all unspent mana and you add the mana lost this way.",
    manaCost: { U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const targetPlayerId = ctx.targets[0].id;
        ctx.tapAllLands(targetPlayerId);
        const drained = ctx.drainManaPool(targetPlayerId);
        ctx.addManaTo(ctx.controller, drained);
    },
};
