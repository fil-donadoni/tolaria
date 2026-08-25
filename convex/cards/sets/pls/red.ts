// PLS (Planeshift) — red cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, CardPrint, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { kickerPaidCondition } from "../../abilities/triggers/shared";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { chooseColorEffects } from "../../abilities/chooseColor";

// Flametongue Kavu — {3}{R} Creature — Kavu, 4/2. "When this creature enters,
// it deals 4 damage to target creature." (CR 603.6a self-ETB trigger with a
// CR 603.3d announcement-time target — `enteredTrigger` scope `self` +
// `targetRequirement`, the Fury/#1193 seam. The single-target 4 damage is a
// plain `dealDamage` Op reading the announced slot via `{ target: 0 }`, so
// the effect is DSL-first — no divide-as-you-choose, no `resolve`.) The
// mandatory "target creature" may be Flametongue Kavu itself when it is the
// only creature — self is a legal target, the classic FTK self-kill.
export const flametongueKavu: CardDefinition = {
    id: "e5056bca-bd90-4b50-8630-105558f8ef92", // PLS printing (scryfallId)
    name: "Flametongue Kavu",
    rarity: "uncommon",
    oracleText:
        "When this creature enters, it deals 4 damage to target creature.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 4,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "flametongue-kavu-etb",
            oracleText:
                "When this creature enters, it deals 4 damage to target creature.",
            scope: "self",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        }),
    ],
};

// Caldera Kavu — {2}{R} Creature — Kavu, 2/2. "{1}{B}: This creature gets
// +1/+1 until end of turn.\n{G}: This creature becomes the color of your
// choice until end of turn." (CR 605 activated abilities; off-color activation
// costs don't affect the card's own colour identity, CR 202.2 — mono-red by
// mana cost, same as Phyrexian Infiltrator's blue-cost ability, `inv/black.ts`.)
// The pump is the censused `pump` Op (Dragon Engine precedent, `atq/colorless.ts`);
// the color-choice is the shared `chooseColorEffects` builder — an
// `optionChoice` over the five colors, each mode a single `setColor` Op
// (Rainbow Crow / Blind Seer precedent, `inv/blue.ts`) — no new choice-kind
// construct needed (ADR 0045 "generalize, don't add").
export const calderaKavu: CardDefinition = {
    id: "fcad32aa-2ce1-402d-a9d8-ad5c81fe4c5b", // PLS 58
    rarity: "common",
    name: "Caldera Kavu",
    oracleText:
        "{1}{B}: This creature gets +1/+1 until end of turn.\n{G}: This creature becomes the color of your choice until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "caldera-kavu-pump",
            oracleText: "{1}{B}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { X: 1, B: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "caldera-kavu-color",
            oracleText:
                "{G}: This creature becomes the color of your choice until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            effects: chooseColorEffects(
                { ref: "$source" },
                { phase: "end-of-turn" },
                "Choose a color (Caldera Kavu)."
            ),
        },
    ],
};

// Deadapult — {2}{R} Enchantment. "{R}, Sacrifice a Zombie: This enchantment
// deals 2 damage to any target." (CR 602.1 activated ability; CR 701.21
// sacrifice-as-cost via `sacrificeFilter` — the activating player chooses
// which Zombie to give up, the Thopter Foundry precedent `arb/multicolor.ts`;
// CR 120 damage to `type: "any"`.)
export const deadapult: CardDefinition = {
    id: "bdc93b3d-bde4-422f-9edc-e337719be7b4", // PLS 59
    rarity: "rare",
    name: "Deadapult",
    oracleText:
        "{R}, Sacrifice a Zombie: This enchantment deals 2 damage to any target.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "deadapult-ping",
            oracleText:
                "{R}, Sacrifice a Zombie: This enchantment deals 2 damage to any target.",
            cost: { mana: { R: 1 }, sacrificeFilter: { subtypes: "Zombie" } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

// Implode — {4}{R} Sorcery. "Destroy target land.\nDraw a card." (CR 701.8
// destroy; CR 121 draw — two already-registered Ops, no new capability.)
export const implode: CardDefinition = {
    id: "a76ee318-8126-4ebf-884d-8369ae8726ac", // PLS 62
    rarity: "uncommon",
    name: "Implode",
    oracleText: "Destroy target land.\nDraw a card.",
    manaCost: { X: 4, R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Land", count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Insolence — {2}{R} Enchantment — Aura. "Enchant creature.\nWhenever
// enchanted creature becomes tapped, this Aura deals 2 damage to that
// creature's controller." (CR 303.4 aura attachment; CR 701.26a becomes-tapped
// trigger scoped to the host via `tappedTrigger({ scope: "host" })`, the
// Seizures precedent `ice/black.ts` — this card is the SAME shape minus the
// "unless that player pays" rider.)
//
// NOT DSL-migratable (ADR 0045, same gap Seizures already documents):
// `tappedTrigger`'s `effects[]` site binds only `$source` and the ability's
// own controller — NOT the tapped permanent's controller, which is exactly
// what "deals damage to THAT creature's controller" needs (the enchanted
// host's controller need not be this Aura's own controller). The `resolve`
// callback's derived `tapped` payload carries `controllerId` directly, no
// `getAttachedTo` round-trip needed. Blocked on: a tapped-permanent-controller
// player selector reachable from a `tappedTrigger` script.
export const insolence: CardDefinition = {
    id: "d8009a37-f966-4a71-9a2a-469127758dc6", // PLS 63
    rarity: "common",
    name: "Insolence",
    oracleText:
        "Enchant creature\nWhenever enchanted creature becomes tapped, this Aura deals 2 damage to that creature's controller.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "insolence-tapped",
            oracleText:
                "Whenever enchanted creature becomes tapped, this Aura deals 2 damage to that creature's controller.",
            scope: "host",
            resolve: (ctx: SpellContext, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 2);
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — the real recipient is
            // the enchanted permanent's CONTROLLER, a cross-player selector no
            // `dealDamage` Op skin reaches from a `tappedTrigger` script (see
            // the NOT DSL-migratable note above). Shadow with the
            // representative "opponent" recipient — the common case, and the
            // same one-representative-value idiom `usg/green.ts`'s `{ C: 1 }`
            // any-colour shadow uses.
            aiEffects: [
                { op: "dealDamage", amount: 2, to: { player: "opponent" } },
            ],
        }),
    ],
};

// Kavu Recluse — {2}{R} Creature — Kavu, 2/2. "{T}: Target land becomes a
// Forest until end of turn." (CR 605 activated ability; CR 305.7 land-type
// change via the censused `setSubtype` Op — the Dream Thrush precedent
// `inv/blue.ts` — no new capability.)
export const kavuRecluse: CardDefinition = {
    id: "6f04ac02-3eff-4a66-8320-ee7b4357522f", // PLS 64
    rarity: "common",
    name: "Kavu Recluse",
    oracleText: "{T}: Target land becomes a Forest until end of turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "kavu-recluse-forest",
            oracleText: "{T}: Target land becomes a Forest until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [
                {
                    op: "setSubtype",
                    target: { target: 0 },
                    subtypes: ["Forest"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Keldon Mantle — {1}{R} Enchantment — Aura. "Enchant creature.\n{B}:
// Regenerate enchanted creature.\n{R}: Enchanted creature gets +1/+0 until
// end of turn.\n{G}: Enchanted creature gains trample until end of turn."
// (CR 303.4 aura attachment; three activated abilities, each affecting the
// Aura's HOST rather than a re-announced target.)
//
// NOT DSL-migratable (ADR 0045): all three read the enchanted creature via
// `ctx.getAttachedTo(ctx.sourceInstanceId)` — the object-selector grammar
// (`EffectObjectSelector`) has no attached-host ("enchanted permanent") ref
// (the same gap Regeneration / Stonehands document, `lea/green.ts` /
// `ice/red.ts`). Blocked on: an attached-host object selector (planned-
// migratable — not a stop-and-issue case, an already-recorded gap).
export const keldonMantle: CardDefinition = {
    id: "35bb73df-f488-468c-a9ad-72f52c8da3dc", // PLS 65
    rarity: "common",
    name: "Keldon Mantle",
    oracleText:
        "Enchant creature\n{B}: Regenerate enchanted creature.\n{R}: Enchanted creature gets +1/+0 until end of turn.\n{G}: Enchanted creature gains trample until end of turn.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "keldon-mantle-regenerate",
            oracleText: "{B}: Regenerate enchanted creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.applyRegenerationShield({ type: "permanent", id: hostId });
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — the real target is
            // the enchanted HOST (`getAttachedTo`), unreachable from the Op
            // grammar (see the NOT DSL-migratable note above); shadow against
            // `$source` itself so the bot's value model still sees "grants a
            // regeneration shield" (same shape as Regeneration's own gap).
            aiEffects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
        {
            id: "keldon-mantle-pump",
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
            // aiEffects — same host-selector gap as the regenerate ability
            // above; shadow against `$source` (the Stonehands precedent).
            aiEffects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "keldon-mantle-trample",
            oracleText:
                "{G}: Enchanted creature gains trample until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
                if (!hostId) return;
                ctx.grantStaticAbility(
                    { type: "permanent", id: hostId },
                    "trample",
                    { phase: "end-of-turn" }
                );
            },
            // aiEffects — same host-selector gap; shadow against `$source`.
            aiEffects: [
                {
                    op: "grantAbility",
                    ability: "trample",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Magma Burst — {3}{R} Instant. "Kicker—Sacrifice two lands.\nMagma Burst
// deals 3 damage to any target. If this spell was kicked, it deals 3 damage
// to another target." (CR 702.33 Kicker — a non-mana PERMANENT leg,
// `permanent: { action: "sacrifice", filter: { types: "Land" }, count: 2 }`,
// ADR 0079/#1937; CR 601.2c the kicked mode WIDENS the target count 1 -> 2 via
// `kickedTargetRequirement` — the Bloodchief's Thirst precedent `znr/black.ts`,
// here widening `count` rather than the type filter. The second `dealDamage`
// is gated on `{ kickerCount: true } >= 1`, the standard kicker branch idiom
// (Overload, `inv/red.ts`) — both damage Ops are already-exercised, no new Op.)
export const magmaBurst: CardDefinition = {
    id: "d9752bc3-0bdf-4657-8750-73c8cbc8e83f", // PLS 66
    rarity: "common",
    name: "Magma Burst",
    oracleText:
        "Kicker—Sacrifice two lands. (You may sacrifice two lands in addition to any other costs as you cast this spell.)\nMagma Burst deals 3 damage to any target. If this spell was kicked, it deals 3 damage to another target.",
    manaCost: { X: 3, R: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice two lands",
            permanent: {
                action: "sacrifice",
                filter: { types: "Land" },
                count: 2,
            },
        },
    ],
    targetRequirement: { type: "any", count: 1 },
    kickedTargetRequirement: { type: "any", count: 2 },
    effects: [
        { op: "dealDamage", amount: 3, to: { target: 0 } },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "dealDamage", amount: 3, to: { target: 1 } }],
        },
    ],
};

// Mire Kavu — {3}{R} Creature — Kavu, 3/2. "This creature gets +1/+1 as long
// as you control a Swamp." (CR 611/613 board-conditional buff via `pt-cda` —
// the Kird Ape precedent `arn/red.ts`, same shape with Swamp instead of
// Forest.)
export const mireKavu: CardDefinition = {
    id: "ccdd0086-eb27-48b3-91cb-a113aa1de102", // PLS 67
    rarity: "common",
    name: "Mire Kavu",
    oracleText: "This creature gets +1/+1 as long as you control a Swamp.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const controlsSwamp = state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            c.subtypes.includes("Swamp")
                    )
                );
                return controlsSwamp
                    ? { power: 1, toughness: 1 }
                    : { power: 0, toughness: 0 };
            },
        },
    ],
};

// Mogg Jailer — {1}{R} Creature — Goblin, 2/2. "This creature can't attack if
// defending player controls an untapped creature with power 2 or less." (CR
// 508.1c card-level attack restriction — the Goblin Mutant precedent
// `ice/red.ts`, same shape with the inequality flipped to <= 2.)
export const moggJailer: CardDefinition = {
    id: "52513235-0e6c-40ea-8ead-a050e6da676e", // PLS 68
    rarity: "uncommon",
    name: "Mogg Jailer",
    oracleText:
        "This creature can't attack if defending player controls an untapped creature with power 2 or less.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "mogg-jailer-no-attack-vs-small",
            predicate: (_self, defenderBattlefield) =>
                !defenderBattlefield.some(
                    (p) =>
                        p.types.includes("Creature") &&
                        !p.isTapped &&
                        (p.power ?? 0) <= 2
                ),
            oracleText:
                "This creature can't attack if defending player controls an untapped creature with power 2 or less.",
        },
    ],
};

// Mogg Sentry — {R} Creature — Goblin Warrior, 1/1. "Whenever an opponent
// casts a spell, this creature gets +2/+2 until end of turn." (CR 603.2
// SPELL_CAST trigger via `spellCastTrigger({ scope: "opponents" })`; the pump
// is the censused `pump` Op.)
export const moggSentry: CardDefinition = {
    id: "8536ec54-cebd-4d44-8e52-42344a3e6daa", // PLS 69
    rarity: "rare",
    name: "Mogg Sentry",
    oracleText:
        "Whenever an opponent casts a spell, this creature gets +2/+2 until end of turn.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        spellCastTrigger({
            id: "mogg-sentry-pump",
            oracleText:
                "Whenever an opponent casts a spell, this creature gets +2/+2 until end of turn.",
            scope: "opponents",
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
    ],
};

// Planeswalker's Fury — {2}{R} Enchantment. "{3}{R}: Target opponent reveals a
// card at random from their hand. This enchantment deals damage equal to that
// card's mana value to that player. Activate only as a sorcery." (CR 602.1
// activated ability, sorcery-speed only; CR 701.20a random reveal.)
//
// PROTOCOL CARD — resolve() justified (DSL-first exception, ADR 0045): reads
// a RANDOMLY-revealed hand card's mana value back into the damage amount.
// `revealRandomHandCard` has no bound ref reachable from an Effect Script
// (mirrors Cursed Scroll's exact gap, `tmp/colorless.ts` — "reading a
// randomly-revealed card's [characteristic] back into a conditional/effect is
// not expressible with the current Op vocabulary"). The random reveal draws
// from the seeded PRNG exactly once, in this single non-suspending segment,
// so it is replay-safe.
export const planeswalkersFury: CardDefinition = {
    id: "6fa09e3a-bc7e-4292-aa5d-ce97c1b1f79f", // PLS 70
    rarity: "rare",
    name: "Planeswalker's Fury",
    oracleText:
        "{3}{R}: Target opponent reveals a card at random from their hand. This enchantment deals damage equal to that card's mana value to that player. Activate only as a sorcery.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "planeswalkers-fury-burn",
            oracleText:
                "{3}{R}: Target opponent reveals a card at random from their hand. This enchantment deals damage equal to that card's mana value to that player. Activate only as a sorcery.",
            cost: { mana: { X: 3, R: 1 } },
            useStack: true,
            sorcerySpeedOnly: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target || target.type !== "player") return;
                const revealedId = ctx.revealRandomHandCard(target.id);
                if (revealedId === undefined) return;
                const mv = ctx.getManaValue({
                    type: "hand-card",
                    id: revealedId,
                    playerId: target.id,
                });
                ctx.dealDamage(target, mv);
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — the real amount is a
            // RANDOMLY-revealed card's mana value, not a static number (the
            // Cursed Scroll gap cited above); shadow with a flat representative
            // amount (one-representative-value idiom, `usg/green.ts`'s `{C:1}`
            // precedent) standing in for a typical mana value.
            aiEffects: [
                { op: "dealDamage", amount: 3, to: { player: "opponent" } },
            ],
        },
    ],
};

// Singe — {R} Instant. "Singe deals 1 damage to target creature. That
// creature becomes black until end of turn." (CR 120 damage; CR 613.1e
// color-set via the censused `setColor` Op — both already-exercised Ops, no
// new capability.)
export const singe: CardDefinition = {
    id: "32323277-db9a-48a7-b9a4-8e6914386e26", // PLS 71
    rarity: "common",
    name: "Singe",
    oracleText:
        "Singe deals 1 damage to target creature. That creature becomes black until end of turn.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "dealDamage", amount: 1, to: { target: 0 } },
        {
            op: "setColor",
            target: { target: 0 },
            colors: ["B"],
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Slingshot Goblin — {2}{R} Creature — Goblin, 2/2. "{R}, {T}: This creature
// deals 2 damage to target blue creature." (CR 605 activated ability; CR
// 120 damage; `colorFilter: "U"` narrows the announced target, CR 202.2.)
export const slingshotGoblin: CardDefinition = {
    id: "81825aef-bef7-46b7-bf52-29e32c1836b0", // PLS 72
    rarity: "common",
    name: "Slingshot Goblin",
    oracleText:
        "{R}, {T}: This creature deals 2 damage to target blue creature.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "slingshot-goblin-ping",
            oracleText:
                "{R}, {T}: This creature deals 2 damage to target blue creature.",
            cost: { mana: { R: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilter: "U",
            },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

// Strafe — {R} Sorcery. "Strafe deals 3 damage to target nonred creature."
// (CR 120 damage; `excludeColors: "R"` narrows the announced target, CR
// 202.2.)
export const strafe: CardDefinition = {
    id: "ec8b77cf-9c1e-4c8f-b452-295cc1570d0e", // PLS 73
    rarity: "uncommon",
    name: "Strafe",
    oracleText: "Strafe deals 3 damage to target nonred creature.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "R" },
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
};

// Tahngarth, Talruum Hero — {3}{R}{R} Legendary Creature — Minotaur Warrior,
// 4/4. "Vigilance\n{1}{R}, {T}: Tahngarth deals damage equal to its power to
// target creature. That creature deals damage equal to its power to
// Tahngarth." (CR 702.20b vigilance; the mutual-damage "fight" shape (CR
// 701.12-style) — Karplusan Yeti (`ice/red.ts`) ships the identical body
// behind a bare tap instead of {1}{R} + tap, but predates the DSL-first rule
// and carries no tracking ref, so it is NOT valid `resolve()` precedent on
// its own.)
//
// STOP-AND-ISSUE, not a `resolve()`-forever card (ADR 0045 — "the Op I need
// doesn't exist yet" is explicitly NOT a valid justification): `fight` is
// `status: "implemented"` as a KEYWORD-ACTION in the Mechanics Registry
// (CR 701.14, binding `SpellContext.fight`) but has no sibling
// `EFFECT_OP_REGISTRY` row, i.e. an uncensused Op, not a missing primitive.
// tracked-by: #2013 (adds the `fight` Effect Op via the standard 7-registry
// checklist; once it lands this ability migrates to
// `effects: [{ op: "fight", target: { target: 0 } }]`). Stays `resolve()`
// only until that issue closes.
//
// DIVERGENCE (tracked-by: #2012): `SpellContext.fight` (`resolveFight`,
// `gre/state.ts`) does not model CR 608.2h last-known-information — if
// Tahngarth (or the target) leaves the battlefield in response to this
// ability, `resolveFight` no-ops ENTIRELY instead of still dealing the half
// of the exchange sourced from whichever creature is still around. Karplusan
// Yeti shares this exact gap (same primitive); #2012 tracks fixing
// `resolveFight` for both.
//
// Two printings in the same set (ADR 0014): PLS 74 (canonical) and PLS 74★
// (the foil-only alternate-illustration variant) — one CardDefinition plus
// one CardPrint, the Skyship Weatherlight precedent `pls/colorless.ts`.
export const tahngarthTalruumHero: CardDefinition = {
    id: "c1778f37-af01-4f8c-ab9d-a4c60abf7e78", // PLS 74 (canonical art)
    rarity: "rare",
    name: "Tahngarth, Talruum Hero",
    oracleText:
        "Vigilance\n{1}{R}, {T}: Tahngarth deals damage equal to its power to target creature. That creature deals damage equal to its power to Tahngarth.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Minotaur", "Warrior"],
    supertypes: ["Legendary"],
    power: 4,
    toughness: 4,
    staticAbilities: ["vigilance"],
    activatedAbilities: [
        {
            id: "tahngarth-fight",
            oracleText:
                "{1}{R}, {T}: Tahngarth deals damage equal to its power to target creature. That creature deals damage equal to its power to Tahngarth.",
            cost: { mana: { X: 1, R: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.fight(target);
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — `fight` has no
            // registered Op yet (tracked-by: #2013, see the stop-and-issue
            // note above), so the bot's value model has nothing to walk
            // without a shadow. Both directions are approximated (tracked-by: #2785) with
            // Tahngarth's own printed power (4) — a flat, representative
            // amount for each side of the exchange (one-representative-value
            // idiom).
            aiEffects: [
                { op: "dealDamage", amount: 4, to: { target: 0 } },
                { op: "dealDamage", amount: 4, to: { ref: "$source" } },
            ],
        },
    ],
};

// Tahngarth, Talruum Hero — PLS 74★, the foil-only alternate-illustration
// variant printed in the SAME set (ADR 0014: one CardDefinition + one
// CardPrint per artwork). Rarity/mechanics are identical to the canonical
// print above; only the Scryfall art id differs.
export const tahngarthTalruumHeroAlt: CardPrint = {
    printId: "6cdab0f9-7208-4555-b509-e61773ebc1f9", // PLS 74★
    definitionId: tahngarthTalruumHero.id,
    setCode: "pls",
    rarity: "rare",
};

// Thunderscape Battlemage — {2}{R} Creature — Human Wizard, 2/2. "Kicker
// {1}{B} and/or {G}\nWhen this creature enters, if it was kicked with its
// {1}{B} kicker, target player discards two cards.\nWhen this creature
// enters, if it was kicked with its {G} kicker, destroy target enchantment."
// (CR 702.33 Kicker — TWO independently payable Kickers, ADR 0079/#1937 —
// each with its own intervening-if ETB trigger reading `{ kickerPaid: "<id>" }`
// (the frozen Effect Script value ADR 0079 introduced specifically for this
// cycle), NOT a single combined Kicker.)
//
// Each trigger is gated PER KICKER at CHECK time (CR 603.4) by
// `kickerPaidCondition("<id>")` — the shared predicate over the permanent's
// own per-Kicker payment record (`PermanentView.kickerPayments`, ADR 0079 /
// issue #1950), NOT the aggregate `wasKicked` boolean. `wasKicked` says only
// "kicked with *something*", so gating on it left the residual partial-kick
// bug this card was the reference case for (issue #2015): kicked with {G}
// alone, the {1}{B}-gated DISCARD trigger still went on the stack and
// announced a target — a real `BECAME_TARGET` event taxing the chosen
// player/permanent for a trigger CR 603.4 says never came into being. The
// per-Kicker predicate closes it: the unpaid Kicker's trigger never triggers.
// `conditionOnSelf` (not `condition`) because the predicate reads only
// `self` — `withTriggerGate` then stamps a DECIDED gate weight
// (`gre/ai/cardScriptValue.ts`) so the bot's value model scores an unkicked
// Battlemage as if neither trigger fires; `condition` would stamp
// `UNDECIDABLE_TRIGGER_GATE` and the bot would over-value it (issue #1936).
//
// The resolution-time half is the `if { kickerPaid: "<id>" }` gate inside
// each `effects[]` — ADR 0079's documented answer, reading the RESOLVING
// STACK ITEM's own `kickerPayments` (`buildTriggerItem`'s `...self` spread,
// `gre/triggers.ts`), i.e. CR 608.2h last known information, and what still
// holds if an ability COPY reaches the stack without re-running `matches`
// (CR 707.10). It is deliberately NOT also declared as `interveningIf`:
// `resolveTopOfStackInner` re-evaluates an `interveningIf` against the LIVE
// battlefield permanent found by `triggerSourceId`, and a blink/flicker
// (Ephemerate) returns the SAME instance object with `kickerPayments`
// already deleted by `resetBattlefieldTransientState` — so an `interveningIf`
// would read a cleared record and fizzle a trigger that must resolve off LKI.
// Check-time `conditionOnSelf` + resolution-time `if { kickerPaid }` is the
// correct pair; the blink case is locked by a regression test in
// `__tests__/red.test.ts`.
export const thunderscapeBattlemage: CardDefinition = {
    id: "d707243e-7f11-44bc-b8b8-af635ab1dc87", // PLS 75
    rarity: "uncommon",
    name: "Thunderscape Battlemage",
    oracleText:
        "Kicker {1}{B} and/or {G} (You may pay an additional {1}{B} and/or {G} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{B} kicker, target player discards two cards.\nWhen this creature enters, if it was kicked with its {G} kicker, destroy target enchantment.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "kicker-b",
            description: "Kicker {1}{B}",
            mana: { X: 1, B: 1 },
        },
        {
            id: "kicker-g",
            description: "Kicker {G}",
            mana: { G: 1 },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "thunderscape-battlemage-discard",
            oracleText:
                "When this creature enters, if it was kicked with its {1}{B} kicker, target player discards two cards.",
            scope: "self",
            // CR 603.4 per-Kicker check-time gate — see the card-level comment.
            conditionOnSelf: kickerPaidCondition("kicker-b"),
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker-b" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: { target: 0 },
                            zone: "hand",
                            count: 2,
                            prompt: "Discard two cards.",
                            bind: "$discard",
                        },
                        {
                            op: "discard",
                            player: { target: 0 },
                            cards: { ref: "$discard" },
                        },
                    ],
                },
            ],
        }),
        enteredTrigger({
            id: "thunderscape-battlemage-destroy",
            oracleText:
                "When this creature enters, if it was kicked with its {G} kicker, destroy target enchantment.",
            scope: "self",
            // CR 603.4 per-Kicker check-time gate — see the card-level comment.
            conditionOnSelf: kickerPaidCondition("kicker-g"),
            targetRequirement: { type: "Enchantment", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker-g" },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        }),
    ],
};

// Thunderscape Familiar — {1}{R} Creature — Kavu, 1/1. "First strike\nBlack
// spells and green spells you cast cost {1} less to cast." (CR 702.7 first
// strike; CR 601.2f cost reduction via `cost-modifier` scoped to the
// controller's own casts — the Andradite Leech precedent `inv/black.ts`,
// same shape as a reduction instead of a tax, over TWO colours via `.some`.)
export const thunderscapeFamiliar: CardDefinition = {
    id: "26c9c0aa-9412-4320-aaee-e05369b8bc7b", // PLS 76
    rarity: "common",
    name: "Thunderscape Familiar",
    oracleText:
        "First strike\nBlack spells and green spells you cast cost {1} less to cast.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                (ctx.getColors(card).includes("B") ||
                    ctx.getColors(card).includes("G")) &&
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId,
            costReduction: { X: 1 },
        },
    ],
};
