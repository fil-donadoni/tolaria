// TMP — red cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { damageTakenTrigger } from "../../abilities/triggers/damageTakenTrigger";
import type { SpellContext } from "../../types";

// Goblin Bombardment — "Sacrifice a creature: This enchantment deals 1
// damage to any target." (CR 701.16 sacrifice cost, CR 120.1 damage.) The
// sacrificed creature is any creature the activating player controls (not
// necessarily this permanent, since Goblin Bombardment is an Enchantment,
// not a creature) — `cost.sacrificeFilter` needs neither `excludeInstanceIds`
// nor `excludeSource` (issue #2367): this permanent isn't itself a creature, so
// it can never satisfy its own filter.
export const goblinBombardment: CardDefinition = {
    id: "179e954f-1d90-4ef4-b800-25845cc338e2",
    rarity: "uncommon",
    name: "Goblin Bombardment",
    oracleText:
        "Sacrifice a creature: This enchantment deals 1 damage to any target.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "goblin-bombardment-sac",
            oracleText:
                "Sacrifice a creature: This enchantment deals 1 damage to any target.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Mogg Fanatic — "Sacrifice this creature: It deals 1 damage to any target."
// The sacrifice-for-effect shape shared with Seal of Fire: sacrifice THIS
// source as an activation cost (CR 602.1 / 701.21) with no mana and no tap —
// activatable any time you have priority (a sacrifice ability is not a tap
// ability, so summoning sickness never gates it, CR 302.6 / 602.5b). The
// self-sacrifice is `cost.sacrifice` (distinct from Goblin Bombardment's
// `sacrificeFilter`, which sacrifices a chosen OTHER creature). DSL-first: a
// single `dealDamage` Op to the announced any-target (CR 120.1); the creature
// is removed to the graveyard at cost payment, before the ability resolves off
// its stack-item clone.
export const moggFanatic: CardDefinition = {
    id: "ca2ecfd4-c874-4468-8601-87aa110d5a00",
    rarity: "common",
    name: "Mogg Fanatic",
    oracleText: "Sacrifice this creature: It deals 1 damage to any target.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "mogg-fanatic-sac",
            oracleText:
                "Sacrifice this creature: It deals 1 damage to any target.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Jackal Pup — a 2/1 for {R} with a self-damage drawback (modern oracle,
// Scryfall): "Whenever this creature is dealt damage, it deals that much
// damage to you." A `damageTakenTrigger` gating on the receiver being this
// permanent (CR 109.2, `controllerRelation: "self"`) — the same DAMAGE_DEALT
// event (CR 120.3) other damage triggers listen to, filtered on the target
// side. It fires for combat AND non-combat damage (no `isCombat` gate) and
// still fires when the damage was lethal (the factory synthesises last-known
// information for a Jackal Pup already moved to the graveyard in the same
// trigger batch, CR 603.10) — so a bolt that kills it still pings you.
//
// NOT DSL-migratable (ADR 0045): the redirected amount is the firing event's
// damage amount (`damage.amount`), a runtime value with no EffectValue
// construct — the EVENT_FIELD_REGISTRY (ADR 0049) censuses only object/player
// families, not a numeric `$event.amount`, and `damageTakenTrigger` has no
// `effects[]` passthrough. Same imperative-resolve shape as El-Hajjâj
// (arn/black.ts) and Living Artifact (lea/green.ts). Planned-migratable
// pending a triggering-event value ref. The redirect deals damage to the
// controller as a player (CR 119.3) — it targets a player, not Jackal Pup, so
// it never re-triggers itself (no loop).
export const jackalPup: CardDefinition = {
    id: "3707ab74-9aec-4d30-86e0-ffa5f72d5b4f",
    rarity: "common",
    name: "Jackal Pup",
    oracleText:
        "Whenever this creature is dealt damage, it deals that much damage to you.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Jackal"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        damageTakenTrigger({
            id: "jackal-pup-redirect",
            oracleText:
                "Whenever this creature is dealt damage, it deals that much damage to you.",
            target: {
                kind: "permanent",
                filter: { controllerRelation: "self" },
            },
            resolve: (ctx, _event, damage) => {
                if (damage.amount <= 0) return;
                ctx.dealDamage(
                    { type: "player", id: ctx.controller },
                    damage.amount
                );
            },
        }),
    ],
};

// Crown of Flames — {R} Enchantment — Aura, enchant creature. "{R}: Enchanted
// creature gets +1/+0 until end of turn. {R}: Return this Aura to its owner's
// hand." (CR 303.4 Aura, CR 117 activated ability cost.) The bounce ability is
// a plain DSL `moveZone($source → hand)`. The pump ability is NOT
// DSL-migratable (ADR 0045, Thrull Retainer precedent, fem/black.ts): it
// targets the Aura's ENCHANTED HOST via `getAttachedToId` — the object-selector
// grammar has no attached-host ("enchanted permanent") ref; the `pump` Op
// itself is available, only the target selector is missing.
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/red.ts`.
export const crownOfFlames: CardDefinition = {
    id: "f2c82741-2869-41f9-82f4-6ed88756e2fd", // TMP 169
    rarity: "common",
    name: "Crown of Flames",
    oracleText:
        "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn.\n{R}: Return this Aura to its owner's hand.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    activatedAbilities: [
        {
            id: "crown-of-flames-pump",
            oracleText: "{R}: Enchanted creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: hostId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
        {
            id: "crown-of-flames-bounce",
            oracleText: "{R}: Return this Aura to its owner's hand.",
            cost: { mana: { R: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// Stun — {1}{R} Instant. "Target creature can't block this turn. Draw a
// card." Migrated resolve()→effects[] (ADR 0045, issue #1285): "can't block"
// via the ADR 0053 `restrictCombat` Op (CR 509.1b block restriction on an
// ANNOUNCED target, `restriction: "cant-block"`, same shape Panic uses in
// `ice/red.ts`), then an immediate `draw` (unlike Panic's delayed
// next-upkeep cantrip, Stun's draw fires right away as part of resolution).
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/red.ts`.
export const stun: CardDefinition = {
    id: "c09c0da6-37a7-42ba-b264-18898ee372f0", // TMP 207
    rarity: "common",
    name: "Stun",
    oracleText: "Target creature can't block this turn.\nDraw a card.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "restrictCombat",
            restriction: "cant-block",
            target: { target: 0 },
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
