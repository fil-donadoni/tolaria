// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    PermanentView,
    SpellContext,
    StaticEffectContext,
    StaticEffectStateView,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

export const goblinHero: CardDefinition = {
    id: "7135a569-e5d3-4a1f-924b-bdb86926b4e1",
    rarity: "common",
    name: "Goblin Hero",
    oracleText: "",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Deferred — two DRK artifacts (#417) each need a "note a creature, then destroy
// it if THIS artifact leaves the battlefield this turn" delayed-self-LTB
// mechanism the engine does not ship. `scheduleDelayedTrigger` only fires at
// phase boundaries (end-step / end-of-combat / draw-step), not on a source's
// PERMANENT_LEFT, and there is no serializable "noted target" field on an
// instance a self `leftTrigger` could read. Both are intentionally NOT registered
// to keep the pool honest; flagged in the PR. TODO(#417):
//
//   • Runesword — "{3}, {T}: Target attacking creature gets +2/+0 until end of
//     turn. When that creature leaves the battlefield this turn, sacrifice this
//     artifact. ..." Beyond the delayed-self-LTB, it also needs per-creature
//     combat-damage-interaction tracking ("if the creature deals damage to a
//     creature this turn, the creature dealt damage can't be regenerated"; "if a
//     creature dealt damage by the targeted creature would die this turn, exile
//     it instead") — there is no per-damage-pair tally surface.
//
//   • War Barge — "{3}: Target creature gains islandwalk until end of turn. When
//     this artifact leaves the battlefield this turn, destroy that creature. A
//     creature destroyed this way can't be regenerated." The islandwalk grant is
//     free-tranche, but the "destroy the noted creature when THIS leaves the
//     battlefield this turn" clause needs the same noted-target delayed-self-LTB
//     primitive Runesword does. Defer the whole card until it lands.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RED (#413 / #419)
// ─────────────────────────────────────────────────────────────────────────────

// Blood Moon — "Nonbasic lands are Mountains." (CR 305.7 type-changing effect,
// CR 611/613 layers.) Every NONBASIC land on the battlefield loses its other
// land types and ALL of its printed abilities, has its subtype set to Mountain,
// and gains the intrinsic "{T}: Add {R}" basic-land mana ability (CR 305.6,
// which falls out of `LAND_SUBTYPE_MANA` once the subtype is Mountain). Basic
// lands (including basic Mountains) are untouched.
//
// Composed from two existing static-effect primitives (no new engine kind):
//   • `ability-loss` (CR 613.1f layer 6) — strips the land's printed activated
//     mana abilities, triggered abilities, and keywords. This is the same
//     generic "loses all abilities" static introduced for Titania's Song; the
//     payment path (`getActivatedManaAbility` and the producible-mana planner)
//     is suppression-gated, so a dual land under Blood Moon stops offering its
//     original colors and falls through to the intrinsic Mountain {R}.
//   • `subtype-set` (CR 305.7 layer 4) — replaces the land's subtypes with
//     `["Mountain"]`, which makes `getBasicLandMana` return {R}.
// The layer system recomputes both live and `unapplySourceStaticEffects`
// reverts them cleanly when Blood Moon leaves the battlefield.
const IS_NONBASIC_LAND: (
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
) => boolean = (target, _source, ctx) =>
    ctx.getPrintedTypes(target).includes("Land") &&
    !ctx.hasSupertype(target, "Basic");

export const bloodMoon: CardDefinition = {
    id: "78373616-e2d6-4ccf-998f-09f02bea45b4",
    rarity: "rare",
    name: "Blood Moon",
    oracleText: "Nonbasic lands are Mountains.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    staticEffects: [
        // CR 613.1f — strip all printed abilities (and other land types) BEFORE
        // the subtype change so the only ability the land has afterward is the
        // intrinsic Mountain mana ability granted by its new subtype.
        {
            kind: "ability-loss",
            applies: IS_NONBASIC_LAND,
        },
        // CR 305.7 — the land's land types become Mountain (and only Mountain).
        {
            kind: "subtype-set",
            applies: IS_NONBASIC_LAND,
            subtypes: ["Mountain"],
        },
    ],
};

// CR 611.2c — shared source-gate for the Goblin Caves / Goblin Shrine anthems:
// "as long as enchanted land is a basic Mountain". Reads the Aura's host
// (`source.attachedTo`) from the live board and returns true only when that host
// is a permanent with the Basic supertype and the Mountain subtype (CR 205.4a /
// 205.3). False when the Aura is unattached or the host isn't a basic Mountain.
function enchantedLandIsBasicMountain(
    source: PermanentView,
    state: StaticEffectStateView,
    ctx: StaticEffectContext
): boolean {
    const hostId = source.attachedTo;
    if (hostId === undefined) return false;
    for (const player of state.players) {
        const host = player.battlefield.find((c) => c.id === hostId);
        if (host) {
            return (
                ctx.hasSupertype(host, "Basic") &&
                host.subtypes.includes("Mountain")
            );
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// RED (#414) — free-tranche reuse. Every card here is expressible with shipped
// primitives: keywords (trample/haste/flying via `staticAbilities`), phase /
// state / attack triggers, activated abilities (damage to target+self, pump,
// landwalk grant, protection grant, mana, sacrifice-for-mana), layer-7 anthems
// (`pt-buff` with `applies`/`condition`), `attack-restriction` statics, the
// `does-not-untap` family (`skipNextUntap` armed on attack), `dealDamageToEach`
// sweepers, and the coin-flip RNG (`flipCoin`). No new engine capability.
// Modern Scryfall oracle text (ADR 0004); ids are scryfallOracleId from DRK.json.
// ─────────────────────────────────────────────────────────────────────────────

// Ball Lightning — "Trample, haste\nAt the beginning of the end step, sacrifice
// this creature." (CR 702.19 trample + CR 702.10 haste as keywords; CR 603.6a
// end-step phaseTrigger scoped to `each` so it fires on the active player's end
// step regardless of whose turn it is — Ball Lightning is sacrificed on the end
// step of the turn it was cast, and on any end step thereafter if it somehow
// survives.)
export const ballLightning: CardDefinition = {
    id: "c1ba83ab-83f5-421d-bba1-0f925870b5c8",
    rarity: "rare",
    name: "Ball Lightning",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nHaste (This creature can attack and {T} as soon as it comes under your control.)\nAt the beginning of the end step, sacrifice this creature.",
    manaCost: { R: 3 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 6,
    toughness: 1,
    staticAbilities: ["trample", "haste"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ball-lightning-end-step-sac",
            oracleText:
                "At the beginning of the end step, sacrifice this creature.",
            phase: "END_STEP",
            scope: "each",
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Brothers of Fire — "{1}{R}{R}: This creature deals 1 damage to any target and
// 1 damage to you." (CR 605 activated ability on the stack; CR 115.4 "any
// target"; the rider deals 1 to the controller — CR 120.3.)
export const brothersOfFire: CardDefinition = {
    id: "ba2cc4a6-fdcc-4082-801a-d2c50e560e8d",
    rarity: "uncommon",
    name: "Brothers of Fire",
    oracleText:
        "{1}{R}{R}: This creature deals 1 damage to any target and 1 damage to you.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Shaman"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "brothers-of-fire-bolt",
            oracleText:
                "{1}{R}{R}: This creature deals 1 damage to any target and 1 damage to you.",
            cost: { mana: { X: 1, R: 2 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 1);
                // CR 120.3 — the rider always damages the controller.
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        },
    ],
};

// Cave People — "Whenever this creature attacks, it gets +1/-2 until end of
// turn.\n{1}{R}{R}, {T}: Target creature gains mountainwalk until end of turn."
// (CR 508 attack trigger applying a temporary P/T mod to itself; CR 605
// activated ability granting the `mountainwalk` keyword to a target until EOT —
// the Part Water grant pattern.)
export const cavePeople: CardDefinition = {
    id: "72746a5d-faa1-44b7-97b5-0ef9302a3c13",
    rarity: "uncommon",
    name: "Cave People",
    oracleText:
        "Whenever this creature attacks, it gets +1/-2 until end of turn.\n{1}{R}{R}, {T}: Target creature gains mountainwalk until end of turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 4,
    triggeredAbilities: [
        {
            id: "cave-people-attack-pump",
            oracleText:
                "Whenever this creature attacks, it gets +1/-2 until end of turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    -2,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    activatedAbilities: [
        {
            id: "cave-people-grant-mountainwalk",
            oracleText:
                "{1}{R}{R}, {T}: Target creature gains mountainwalk until end of turn.",
            cost: { tap: true, mana: { X: 1, R: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "mountainwalk", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Eternal Flame — "Eternal Flame deals X damage to target opponent or
// planeswalker and half X damage, rounded up, to you, where X is the number of
// Mountains you control." (CR 120 damage; X is a board count read at resolve,
// NOT a cast-time {X}; the self-damage is half rounded up — CR 107.4-style
// rounding, Math.ceil(X/2).) Modern oracle (ADR 0004): target is an opponent or
// planeswalker.
export const eternalFlame: CardDefinition = {
    id: "d646feea-3c20-4737-8d20-ffad42258ced",
    rarity: "rare",
    name: "Eternal Flame",
    oracleText:
        "Eternal Flame deals X damage to target opponent or planeswalker and half X damage, rounded up, to you, where X is the number of Mountains you control.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    // CR 115.4 — "target opponent or planeswalker": an OPPONENT player target
    // (`controller: "opponent"`, honored for player targets here — see Jovial
    // Evil / Mana Clash) or a Planeswalker permanent. The free-tranche engine
    // has no planeswalkers in pool, so the practical legal target is an opponent.
    targetRequirement: {
        type: ["player", "Planeswalker"],
        count: 1,
        controller: "opponent",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target) return;
        // X = Mountains the controller controls, read at resolution (CR 608.2).
        const x = ctx
            .getBattlefieldIds(ctx.controller, { types: "Land" })
            .filter((id) =>
                ctx.hasSubtype({ type: "permanent", id }, "Mountain")
            ).length;
        ctx.dealDamage(target, x);
        // Half X rounded up to the controller.
        const half = Math.ceil(x / 2);
        if (half > 0) {
            ctx.dealDamage({ type: "player", id: ctx.controller }, half);
        }
    },
};

// Fire Drake — "Flying\n{R}: This creature gets +1/+0 until end of turn.
// Activate only once each turn." (CR 702.9 flying keyword; CR 605 pump activated
// ability with `oncePerTurn`.)
export const fireDrake: CardDefinition = {
    id: "d3419db6-1c38-4aa4-b953-1dde7d22b927",
    rarity: "uncommon",
    name: "Fire Drake",
    oracleText:
        "Flying\n{R}: This creature gets +1/+0 until end of turn. Activate only once each turn.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "fire-drake-pump",
            oracleText:
                "{R}: This creature gets +1/+0 until end of turn. Activate only once each turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            oncePerTurn: true,
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

// Fissure — "Destroy target creature or land. It can't be regenerated."
// (CR 701.7 destroy with the regen-shield suppression; CR 114 multi-type
// target.)
export const fissure: CardDefinition = {
    id: "aa2d778d-d74b-45ec-a86b-5d52ffad6ba5",
    rarity: "common",
    name: "Fissure",
    oracleText: "Destroy target creature or land. It can't be regenerated.",
    manaCost: { X: 3, R: 2 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Land"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target, { cantBeRegenerated: true });
    },
};

// Goblin Caves — Aura. "Enchant land\nAs long as enchanted land is a basic
// Mountain, Goblin creatures get +0/+2." (CR 303.4 Aura enchant land; CR 611
// layer 7c conditional anthem — a `pt-buff` whose `applies` filters Goblin
// creatures and whose `condition` gates on the enchanted land being a BASIC
// Mountain, read from the Aura's host via `attachedTo`.)
export const goblinCaves: CardDefinition = {
    id: "c6a415b0-00a2-4a65-8994-4a395c50ae2d",
    rarity: "common",
    name: "Goblin Caves",
    oracleText:
        "Enchant land\nAs long as enchanted land is a basic Mountain, Goblin creatures get +0/+2.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            // CR 611.2c — active only while the enchanted land is a basic
            // Mountain. Re-evaluated each read against the live board.
            condition: enchantedLandIsBasicMountain,
            power: 0,
            toughness: 2,
        },
    ],
};

// Goblin Digging Team — "{T}, Sacrifice this creature: Destroy target Wall."
// (CR 605 activated ability with tap + self-sacrifice cost; CR 701.7 destroy
// restricted to Wall-subtyped creatures via `subtypeFilter`.)
export const goblinDiggingTeam: CardDefinition = {
    id: "8a538b9d-351e-40bb-be11-9ba08c16352b",
    rarity: "common",
    name: "Goblin Digging Team",
    oracleText: "{T}, Sacrifice this creature: Destroy target Wall.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-digging-team-destroy-wall",
            oracleText: "{T}, Sacrifice this creature: Destroy target Wall.",
            cost: { tap: true, sacrifice: true },
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

// Goblin Rock Sled — "Trample\nThis creature doesn't untap during your untap
// step if it attacked during your last turn.\nThis creature can't attack unless
// defending player controls a Mountain." (CR 702.19 trample; the conditional
// untap restriction is implemented by ARMING a one-shot `skipNextUntap` when
// the Sled attacks — its controller's NEXT untap step is the "your next turn"
// untap, so a Sled that attacked this turn stays tapped next turn, CR 302.6 /
// 502.1; the attack restriction is a pure board predicate, CR 508.1c.)
export const goblinRockSled: CardDefinition = {
    id: "91e0b59d-8f9b-4a76-9845-bcb0dc32523d",
    rarity: "common",
    name: "Goblin Rock Sled",
    oracleText:
        "Trample\nThis creature doesn't untap during your untap step if it attacked during your last turn.\nThis creature can't attack unless defending player controls a Mountain.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 3,
    toughness: 1,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "goblin-rock-sled-mountain-restriction",
            oracleText:
                "This creature can't attack unless defending player controls a Mountain.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) =>
                    c.subtypes.includes("Mountain")
                ),
        },
    ],
    triggeredAbilities: [
        {
            id: "goblin-rock-sled-arm-skip-untap",
            oracleText:
                "This creature doesn't untap during your untap step if it attacked during your last turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                // CR 302.6 / 502.1 — arm a one-shot "doesn't untap next untap
                // step" on the Sled. The controller's next untap step is their
                // next turn's, so a Sled that attacked this turn stays tapped
                // then. Cleared automatically after exactly one untap step.
                ctx.skipNextUntap({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Goblin Shrine — Aura. "Enchant land\nAs long as enchanted land is a basic
// Mountain, Goblin creatures get +1/+0.\nWhen this Aura leaves the battlefield,
// it deals 1 damage to each Goblin creature." (CR 611 conditional anthem +
// CR 603.6 LTB trigger dealing 1 to each Goblin via `dealDamageToEach`.)
export const goblinShrine: CardDefinition = {
    id: "cd69a6dc-27f3-42aa-9e63-4417796e4ef5",
    rarity: "common",
    name: "Goblin Shrine",
    oracleText:
        "Enchant land\nAs long as enchanted land is a basic Mountain, Goblin creatures get +1/+0.\nWhen this Aura leaves the battlefield, it deals 1 damage to each Goblin creature.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.hasSubtype(target, "Goblin"),
            condition: enchantedLandIsBasicMountain,
            power: 1,
            toughness: 0,
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "goblin-shrine-leaves",
            oracleText:
                "When this Aura leaves the battlefield, it deals 1 damage to each Goblin creature.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                // CR 120.3 — 1 damage to every Goblin creature on the
                // battlefield (any controller).
                ctx.dealDamageToEach(1, {
                    creatures: { subtypes: "Goblin" },
                });
            },
        }),
    ],
};

// Goblin Wizard — "{T}: You may put a Goblin permanent card from your hand onto
// the battlefield.\n{R}: Target Goblin gains protection from white until end of
// turn." (CR 605: the first is a non-mana activated ability — a hand →
// battlefield zone move, CR 400.7, via `putFromHandOntoBattlefield`; the second
// grants the `protection from white` keyword to a Goblin until EOT, CR 702.16.)
export const goblinWizard: CardDefinition = {
    id: "9b73dfb4-d930-4a89-b621-129dd9f6328c",
    rarity: "rare",
    name: "Goblin Wizard",
    oracleText:
        "{T}: You may put a Goblin permanent card from your hand onto the battlefield.\n{R}: Target Goblin gains protection from white until end of turn.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Goblin", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "goblin-wizard-put-goblin",
            oracleText:
                "{T}: You may put a Goblin permanent card from your hand onto the battlefield.",
            cost: { tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 205.3 — a "Goblin permanent card" is a card that is a
                // permanent type (not Instant/Sorcery) and has the Goblin
                // subtype. Restrict the optional pick to those in hand.
                const candidateIds = ctx
                    .getHandCards(ctx.controller)
                    .filter(
                        (c) =>
                            c.subtypes.includes("Goblin") &&
                            !c.types.includes("Instant") &&
                            !c.types.includes("Sorcery")
                    )
                    .map((c) => c.id);
                if (candidateIds.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `goblin-wizard-${ctx.sourceInstanceId}`,
                    kind: "choose-hand-card",
                    zone: "hand",
                    candidateIds,
                    count: { min: 0, max: 1 },
                    prompt: "You may put a Goblin permanent from your hand onto the battlefield.",
                });
                if (picks === undefined) return; // suspended
                const id = picks[0];
                if (!id) return; // declined
                ctx.putFromHandOntoBattlefield(ctx.controller, id);
            },
        },
        {
            id: "goblin-wizard-protection",
            oracleText:
                "{R}: Target Goblin gains protection from white until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Goblin",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "protection from white", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Goblins of the Flarg — "Mountainwalk\nWhen you control a Dwarf, sacrifice this
// creature." (CR 702.19 landwalk keyword; CR 603.8 state-trigger self-sacrifice
// when the controller controls a Dwarf.)
export const goblinsOfTheFlarg: CardDefinition = {
    id: "fd333b18-b896-4ab8-9c46-eed4efdd94f2",
    rarity: "common",
    name: "Goblins of the Flarg",
    oracleText:
        "Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)\nWhen you control a Dwarf, sacrifice this creature.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 1,
    staticAbilities: ["mountainwalk"],
    triggeredAbilities: [
        stateTrigger({
            id: "goblins-flarg-dwarf-sac",
            oracleText: "When you control a Dwarf, sacrifice this creature.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return (
                    controller?.battlefield.some((c) =>
                        c.subtypes.includes("Dwarf")
                    ) ?? false
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Inferno — "Inferno deals 6 damage to each creature and each player."
// (CR 120.3 mass damage to every creature and both players via
// `dealDamageToEach`.)
export const inferno: CardDefinition = {
    id: "a6b61512-5b24-424c-966f-36b595781e14",
    rarity: "rare",
    name: "Inferno",
    oracleText: "Inferno deals 6 damage to each creature and each player.",
    manaCost: { X: 5, R: 2 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(6, { creatures: true, players: true });
    },
};

// Mana Clash — "You and target opponent each flip a coin. Mana Clash deals 1
// damage to each player whose coin comes up tails. Repeat this process until
// both players' coins come up heads on the same flip." (CR 705 coin flips via
// the seeded `flipCoin`; the loop repeats until BOTH coins are heads in the same
// round. Synchronous flips — no per-flip reveal pause — keep the loop a single
// deterministic resolution.)
export const manaClash: CardDefinition = {
    id: "72955141-d990-459f-adbe-7d3d0f5f6c95",
    rarity: "rare",
    name: "Mana Clash",
    oracleText:
        "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const you = ctx.controller;
        const opponent = target.id;
        // CR 705.2 — repeat: each flips a coin; a tails takes 1 damage; stop
        // only when BOTH come up heads on the same flip. The seeded PRNG makes
        // the loop deterministic under replay; each iteration has a 1/4 chance
        // to terminate, so a 10000-round cap is an unreachable safety bound that
        // also prevents a degenerate seed from hanging the mutation.
        for (let i = 0; i < 10000; i++) {
            const youHeads = ctx.flipCoin();
            const oppHeads = ctx.flipCoin();
            if (!youHeads) ctx.dealDamage({ type: "player", id: you }, 1);
            if (!oppHeads) ctx.dealDamage({ type: "player", id: opponent }, 1);
            if (youHeads && oppHeads) break;
        }
    },
};

// Orc General — "{T}, Sacrifice another Orc or Goblin: Other Orc creatures get
// +1/+1 until end of turn." (CR 605 activated ability with tap + a
// "sacrifice another [Orc or Goblin]" cost via `sacrificeFilter`; the buff is a
// team pump on OTHER Orcs the controller controls, CR 611.1.)
export const orcGeneral: CardDefinition = {
    id: "65a10fd5-506e-46bf-87e6-fde134c0dc04",
    rarity: "uncommon",
    name: "Orc General",
    oracleText:
        "{T}, Sacrifice another Orc or Goblin: Other Orc creatures get +1/+1 until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Orc", "Warrior"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "orc-general-pump",
            oracleText:
                "{T}, Sacrifice another Orc or Goblin: Other Orc creatures get +1/+1 until end of turn.",
            cost: {
                tap: true,
                // "another Orc or Goblin": a creature with the Orc OR Goblin
                // subtype, other than Orc General itself (CR 602.1 — "another"
                // excludes the source, enforced at activation).
                sacrificeFilter: {
                    types: "Creature",
                    subtypes: ["Orc", "Goblin"],
                    excludeInstanceIds: [],
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 611.1 — +1/+1 EOT to OTHER Orc creatures the controller
                // controls (excluding Orc General itself).
                const orcs = ctx
                    .getBattlefieldIds(ctx.controller, {
                        types: "Creature",
                        subtypes: "Orc",
                    })
                    .filter((id) => id !== ctx.sourceInstanceId);
                for (const id of orcs) {
                    ctx.addTemporaryPTBuff({ type: "permanent", id }, 1, 1, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Sisters of the Flame — "{T}: Add {R}." (CR 605.1a mana ability — resolves
// immediately, no stack, CR 605.3a.)
export const sistersOfTheFlame: CardDefinition = {
    id: "564e0ccd-decb-48d2-981f-cefa8045340f",
    rarity: "uncommon",
    name: "Sisters of the Flame",
    oracleText: "{T}: Add {R}.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Shaman"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "sisters-of-the-flame-mana",
            oracleText: "{T}: Add {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 1 }),
            manaProduced: { R: 1 },
        },
    ],
};
