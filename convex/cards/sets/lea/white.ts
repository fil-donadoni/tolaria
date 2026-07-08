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
    Color,
    ManaCost,
    PermanentFilter,
    Rarity,
    SpellContext,
    TriggeredAbility,
} from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { knightStaticAbilities, makeCircleOfProtection } from "../../abilities";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Animate Wall — "Enchant Wall. Enchanted Wall can attack as though it didn't
// have defender." (CR 702.3, 613.1a layer 6 keyword removal). Aura removes
// defender from its host, allowing the Wall to be declared as an attacker.
export const animateWall: CardDefinition = {
    id: "d5c83259-9b90-47c2-b48e-c7d78519e792",
    rarity: "rare",
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
    rarity: "rare",
    name: "Armageddon",
    oracleText: "Destroy all lands.",
    manaCost: { X: 3, W: 1 },
    types: ["Sorcery"],
    // CR 701.7 — mass land destruction. The declarative marker lets effects that
    // reason about a spell's outcome (Equinox's counter) recognise this as
    // land destruction without running the effect script below.
    destroysAllLands: true,
    // Migrated resolve() → effects[] (ADR 0045, issue #831). `destroyAll("Land")`
    // is `forEach` over every player's battlefield Lands (CR 110) → `destroy`
    // each — the same sweep shape proven by Day of Judgment (m11/white). The
    // per-card behaviour test (Consecrate Land's "Armageddon spares it") is the
    // migration harness.
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Land" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
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
    rarity: "rare",
    name: "Balance",
    oracleText:
        "Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the fewest, then sacrifices the rest. Players discard cards and sacrifice creatures the same way.",
    manaCost: { X: 1, W: 1 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045, issue #831): planned-migratable. Needs a
    // "keep N / sacrifice the rest" APNAP choice keyed on a cross-player minimum
    // count — no `choice` kind or value construct expresses "equal to the fewest
    // any player controls". Blocked on: keep-count choice semantics.
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
    rarity: "common",
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
    rarity: "uncommon",
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
    rarity: "rare",
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
    rarity: "rare",
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
            // NOT DSL-migratable (ADR 0045, issue #840): pumps the enchanted
            // creature (getAttachedTo). Blocked on: an attached-object
            // EffectObjectSelector, not pump.
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
    rarity: "uncommon",
    name: "Blue Ward",
    oracleText:
        "Enchant creature\nEnchanted creature has protection from blue. This effect doesn't remove this Aura.",
    color: "blue",
});

// Castle — "Untapped creatures you control get +0/+2." (CR 611, 613 — static layer 7c)
export const castle: CardDefinition = {
    id: "b0da8d56-3178-44c2-9344-95d2346d326f",
    rarity: "uncommon",
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
    rarity: "common",
    name: "Circle of Protection: Blue",
    oracleText:
        "{1}: The next time a blue source of your choice would deal damage to you this turn, prevent that damage.",
    color: "U",
    colorWord: "Blue",
});

export const circleOfProtectionGreen: CardDefinition = makeCircleOfProtection({
    id: "1ae32d20-b438-4f43-b603-e8f706ecfb03",
    rarity: "common",
    name: "Circle of Protection: Green",
    oracleText:
        "{1}: The next time a green source of your choice would deal damage to you this turn, prevent that damage.",
    color: "G",
    colorWord: "Green",
});

export const circleOfProtectionRed: CardDefinition = makeCircleOfProtection({
    id: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e",
    rarity: "common",
    name: "Circle of Protection: Red",
    oracleText:
        "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.",
    color: "R",
    colorWord: "Red",
});

export const circleOfProtectionWhite: CardDefinition = makeCircleOfProtection({
    id: "92df19c9-e127-42d9-8dd2-7fa5a7095428",
    rarity: "common",
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
    rarity: "uncommon",
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
    rarity: "uncommon",
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
    rarity: "rare",
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
    rarity: "common",
    name: "Death Ward",
    oracleText: "Regenerate target creature.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the announced
    // creature target (CR 701.15a).
    effects: [{ op: "regenerate", target: { target: 0 } }],
};

export const disenchant: CardDefinition = {
    id: "2722d7e2-61c6-4934-9c21-875ee78fd06c",
    rarity: "common",
    name: "Disenchant",
    oracleText: "Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    effect: "destroy-target",
};

// Farmstead — "Enchant land\nEnchanted land has \"At the beginning of your
// upkeep, you may pay {W}{W}. If you do, you gain 1 life.\"" (modern Scryfall
// Oracle; CR 303.4 aura attachment, 603.6a beginning-of-step trigger, 117.3a
// optional cost). The granted ability triggers on the enchanted land's
// controller's upkeep; that player MAY pay {W}{W} and, if they do, gains 1
// life. Modeled on the Aura via a `host-controller`-scoped upkeep trigger: the
// resolver looks up the host via `getAttachedTo` (no targeting at trigger time
// per CR 603.2) and reads its current controller — so a Farmstead whose host
// changed controllers (Control Magic, etc.) follows the new controller
// automatically. (The pre-Oracle Alpha printing gained 2 life unconditionally
// with no cost — issue #960 corrected it to the modern optional-{W}{W} gain 1.)
export const farmstead: CardDefinition = {
    id: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf",
    rarity: "rare",
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
                "At the beginning of your upkeep, you may pay {W}{W}. If you do, you gain 1 life.",
            phase: "UPKEEP",
            scope: "host-controller",
            // NOT DSL-migratable (ADR 0045, issue #831): the affected player is
            // the enchanted land's controller (host-controller scope), which no
            // EffectPlayerRef expresses ("controller" is the Aura's controller).
            // Blocked on: host-controller player ref.
            resolve: (ctx, _event, hostController) => {
                // CR 117.3a optional cost — may pay {W}{W}; gain 1 life on pay.
                const accept = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: hostController,
                    cost: { W: 2 },
                    prompt: "Pay {W}{W} to gain 1 life? (Farmstead)",
                });
                if (accept === undefined) return;
                if (accept) ctx.gainLife(hostController, 1);
            },
        }),
    ],
};

export const greenWard: CardDefinition = makeColorWard({
    id: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e",
    rarity: "uncommon",
    name: "Green Ward",
    oracleText:
        "Enchant creature\nEnchanted creature has protection from green. This effect doesn't remove this Aura.",
    color: "green",
});

export const guardianAngel: CardDefinition = {
    id: "0f84d676-5327-454c-a033-b4498a9d28e2",
    rarity: "common",
    name: "Guardian Angel",
    oracleText:
        "Prevent the next X damage that would be dealt to any target this turn. Until end of turn, you may pay {1} any time you could cast an instant. If you do, prevent the next 1 damage that would be dealt to that permanent or player this turn.",
    manaCost: { X: "X", W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #852): prevent the next X damage
    // to the announced any-target this turn (CR 615.1) via the `preventDamage`
    // next-n Op with a chosen-cost `{ X: true }` amount. `to: { target: 0 }`
    // resolves the raw target (player OR permanent). A missing target is skipped
    // (CR 608.2b); X = 0 stacks a harmless 0-damage shield (the executor no-ops
    // a zero-amount prevention). The second sentence ("you may pay {1} …") was
    // already unmodelled in the closure — the migration preserves that.
    effects: [
        {
            op: "preventDamage",
            mode: "next-n",
            to: { target: 0 },
            amount: { X: true },
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Healing Salve — "Choose one — Target player gains 3 life. OR Prevent the
// next 3 damage that would be dealt to any target this turn." (CR 700.2
// modal — chooser picks one mode at announcement, the chosen mode's
// targetRequirement drives target selection.)
export const healingSalve: CardDefinition = {
    id: "e28de37e-84d5-4dc7-b36c-e14da5924729",
    rarity: "common",
    name: "Healing Salve",
    oracleText:
        "Choose one —\n• Target player gains 3 life.\n• Prevent the next 3 damage that would be dealt to any target this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    // NOT DSL-migratable (ADR 0045, issue #845): a MODAL "choose one" card.
    // `effects[]` is mutually exclusive with `modes`, and there is no
    // mode-level Effect Script yet — the "choose one" mode selection needs the
    // `optionChoice` Op, still `planned`. The classifier over-counts this site
    // (both mode closures now use only covered Ops — gainLife and preventDamage
    // "next-n"), but the modal WRAPPER is the blocker, not the mode bodies.
    // Blocked on: modal-card support (`optionChoice` Op).
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
    rarity: "common",
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
            // NOT DSL-migratable (ADR 0045, issue #840): pumps the enchanted
            // creature (getAttachedTo). Blocked on: an attached-object
            // EffectObjectSelector, not pump.
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
    rarity: "common",
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
    rarity: "rare",
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
    rarity: "uncommon",
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
            // NOT DSL-migratable (ADR 0045, issue #831): the damaged player is
            // the upkeep player (each-scope, event-derived), not the ability's
            // controller/opponent, so no EffectPlayerRef targets it; the amount
            // is a Swamp count on that same dynamic player. Blocked on:
            // event-player ref for `each`-scope triggers.
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
    rarity: "uncommon",
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
    rarity: "common",
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
    rarity: "rare",
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
            // Migrated resolve() → effects[] (ADR 0045, issue #831): a single
            // `destroy` Op on the announced target (CR 701.7), same shape as
            // Dwarven Demolition Team. Per-card test is the migration harness.
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

export const pearledUnicorn: CardDefinition = {
    id: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8",
    rarity: "common",
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
    rarity: "rare",
    name: "Personal Incarnation",
    oracleText:
        "All damage that would be dealt to its owner is dealt to Personal Incarnation instead.\nWhen this creature dies, its owner loses half their life, rounded up.",
    // Modern Scryfall oracle cost is {3}{W}{W}{W} (the Alpha {4}{W}{W}{W} print
    // was superseded by errata).
    manaCost: { X: 3, W: 3 },
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
            // NOT DSL-migratable (ADR 0045, issue #831): the loss is
            // Math.ceil(life/2) — arithmetic on a runtime read, which the value
            // grammar (literal | ref | count) forbids. Blocked on: arithmetic
            // value construct (half-life).
            resolve: (ctx, _event, leaving) => {
                const life = ctx.getLife(leaving.ownerId);
                const loss = Math.ceil(life / 2);
                if (loss > 0) ctx.loseLife(leaving.ownerId, loss);
            },
        }),
    ],
};

// CR 305.7 / 613.1d layer 5 — lace cycle factory
export function makeLace(args: {
    id: string;
    name: string;
    rarity: Rarity;
    oracleText: string;
    manaCost: ManaCost;
    color: Color;
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
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
    rarity: "rare",
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
    rarity: Rarity;
    oracleText?: string;
    color: "white" | "blue" | "black" | "red" | "green";
}): CardDefinition {
    const keyword = `protection from ${args.color}`;
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
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
    rarity: "uncommon",
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
    rarity: "uncommon",
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
    // Migrated resolve()→effects[] (ADR 0045, #839): return the targeted
    // graveyard creature card to the battlefield under its owner's control
    // (CR 400.7 reanimation).
    effects: [{ op: "moveZone", target: { target: 0 }, to: "battlefield" }],
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
    rarity: "rare",
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
    rarity: "rare",
    name: "Righteousness",
    oracleText: "Target blocking creature gets +7/+7 until end of turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        combatRoleFilter: "blocking",
    },
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: 7,
            toughness: 7,
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Samite Healer — "{T}: Prevent the next 1 damage that would be dealt to
// any target this turn." (CR 615.1, 120.3 "any target" = creature/player).
// Drops a 1-damage shield on the chosen target via the
// `preventNextNDamageToTarget` primitive; shield is consumed by the next
// damage event regardless of source, leftover wears off at CLEANUP.
export const samiteHealer: CardDefinition = {
    id: "efba235e-04e5-449c-906c-0ac33f6d7929",
    rarity: "common",
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
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-1
            // shield on the announced "any" target — a creature or a player;
            // `{ target: 0 }` resolves either (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const savannahLions: CardDefinition = {
    id: "d05b92bd-797e-413f-a8b0-32e0937a1ee0",
    rarity: "rare",
    name: "Savannah Lions",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 1,
};

export const serraAngel: CardDefinition = {
    id: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    rarity: "uncommon",
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

// First DSL card exercising the bind + ref constructs (ADR 0045, issue #802).
// The whole effect is a declarative Effect Script: `exile` snapshots the
// creature's power and controller BEFORE it leaves the battlefield (CR 608.2h
// last-known information), then `gainLife` reads that snapshot — "its
// controller gains life equal to its power". No imperative `resolve()`.
export const swordsToPlowshares: CardDefinition = {
    id: "386ea9eb-abc1-4862-aa2d-8fb808d79490",
    rarity: "uncommon",
    name: "Swords to Plowshares",
    oracleText:
        "Exile target creature. Its controller gains life equal to its power.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "exile", target: { target: 0 }, bind: "$creature" },
        {
            op: "gainLife",
            player: { ref: "$creature.controller" },
            amount: { ref: "$creature.power" },
        },
    ],
};

// Veteran Bodyguard — "As long as Veteran Bodyguard remains untapped, all
// damage that would be dealt to you by unblocked attacking creatures is
// dealt to Veteran Bodyguard instead." (CR 614 continuous damage
// replacement, gated on self.isTapped + source-must-be-unblocked-attacker.)
// The combat lookup comes through `ReplacementStateView.combat` which mirrors
// `state.combat.{attackerIds, blockerAssignments}`.
export const veteranBodyguard: CardDefinition = {
    id: "cbd9ab01-a833-4fa4-8dee-151bd9800835",
    rarity: "rare",
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
    rarity: "uncommon",
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
    rarity: "uncommon",
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
    rarity: "uncommon",
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
    rarity: "rare",
    name: "Wrath of God",
    oracleText: "Destroy all creatures. They can't be regenerated.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045, issue #831): the `destroy` Op has no
    // "can't be regenerated" option, so a forEach/destroy sweep would let
    // regeneration shields save creatures (unlike this card). Blocked on:
    // cantBeRegenerated flag on the `destroy` Op.
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Creature", { cantBeRegenerated: true });
    },
};

// Helper for the "at the beginning of your upkeep, pay {cost} or
// <consequence>" pattern (CR 603.6a phase trigger, CR 117.3a optional cost).
// Used by cards whose upkeep cost is a flat may-pay with a hard consequence
// on decline (Phantasmal Forces → sacrifice self, Force of Nature → deal
// damage to controller, Stasis / Pestilence → sacrifice self). Cumulative
// upkeep (CR 702.23, post-LEA) is a distinct mechanic and not modeled here.
// Delegates to the `phaseTrigger` factory so the matches() narrowing and
// scope filter live in one place.
export function makeUpkeepPayOrElse(args: {
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
