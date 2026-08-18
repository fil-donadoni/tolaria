// ELD — green cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Once Upon a Time — {1}{G} Instant (issue #790). Modern Oracle text (the
// printed card's original flash-on-your-first-turn clause was later dropped
// from Oracle; this card is a plain Instant today, per Scryfall):
// "If this spell is the first spell you've cast this game, you may cast it
// without paying its mana cost. Look at the top five cards of your library.
// You may reveal a creature or land card from among them and put it into
// your hand. Put the rest on the bottom of your library in a random order."
//
// The free-cast clause is a CR 118.9 alternative cost (`alternativeCosts`) —
// a leg-free variant (no mana/permanent/life/hand leg at all, so
// `chosenAltCost.mana ?? {}` collapses the cast to genuinely free) gated on
// `{ kind: "first-spell-this-game" }`, which reads the caster's OWN lifetime
// `PlayerState.spellsCastThisGame` tally, never reset. The on-resolution
// effect reuses `lookDistribute` verbatim — the same Op Narset, Parter of Veils
// uses for an identical "look N, may keep 1 matching, rest to random bottom"
// shape — so this card introduces no new Op and needs no hand-written GRE/
// wire test beyond the catalogue-wide static sweep + auto-generated smoke
// test (the per-Op regime, `.claude/rules/gre-development.md`).
export const onceUponATime: CardDefinition = {
    id: "4034e5ba-9974-43e3-bde7-8d9b4586c3a4",
    name: "Once Upon a Time",
    rarity: "rare",
    manaCost: { generic: 1, G: 1 },
    types: ["Instant"],
    oracleText:
        "If this spell is the first spell you've cast this game, you may cast it without paying its mana cost.\nLook at the top five cards of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
    alternativeCosts: [
        {
            id: "free-first-spell",
            description: "Cast without paying its mana cost",
            condition: { kind: "first-spell-this-game" },
        },
    ],
    effects: [
        {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: 5,
            take: 1,
            optional: true,
            filter: { type: ["Creature", "Land"] },
            reveal: "kept",
            randomBottom: true,
            prompt: "Once Upon a Time — you may put a creature or land card into your hand.",
        },
    ],
};

// Questing Beast — {2}{G}{G} Legendary Creature — Beast 4/4 (issue #2395).
// Modern Scryfall oracle (ADR 0004):
//   "Vigilance, deathtouch, haste
//    Questing Beast can't be blocked by creatures with power 2 or less.
//    Combat damage that would be dealt by creatures you control can't be
//    prevented.
//    Whenever Questing Beast deals combat damage to an opponent, it deals that
//    much damage to target planeswalker that player controls."
//
// Four clauses, four shapes:
//  1. the three keywords are plain `staticAbilities` (registry rows
//     `vigilance` / `deathtouch` / `haste`, all `implemented`);
//  2. the evasion clause is a plain `block-restriction` static (CR 509.1b),
//     the same shape Argothian Pixies and Arctic Foxes use;
//  3. the unpreventable clause is the `combat-damage-unpreventable` static
//     (CR 615.12) this card ships — see `gre/combatDamagePrevention.ts`;
//  4. the planeswalker clause is a normal triggered ability.
export const questingBeast: CardDefinition = {
    id: "e41cf82d-3213-47ce-a015-6e51a8b07e4f",
    name: "Questing Beast",
    rarity: "mythic",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Beast"],
    power: 4,
    toughness: 4,
    oracleText:
        "Vigilance, deathtouch, haste\nQuesting Beast can't be blocked by creatures with power 2 or less.\nCombat damage that would be dealt by creatures you control can't be prevented.\nWhenever Questing Beast deals combat damage to an opponent, it deals that much damage to target planeswalker that player controls.",
    staticAbilities: ["vigilance", "deathtouch", "haste"],
    staticEffects: [
        {
            kind: "block-restriction",
            id: "questing-beast-power-3-or-greater-blockers-only",
            side: "attacker" as const,
            // CR 509.1b — an evasion ability restricting what may block.
            // `self` = Questing Beast (attacker), `opponent` = the candidate
            // blocker; the predicate returns true when the block is LEGAL.
            // `opponent.power` is already the effective, post-layer-7 value
            // (the combat validator enriches it), so a blocker pumped to 3 by
            // an anthem may block and one shrunk to 2 may not.
            predicate: (_self, opponent) => (opponent.power ?? 0) >= 3,
            oracleText:
                "Questing Beast can't be blocked by creatures with power 2 or less.",
        },
        {
            kind: "combat-damage-unpreventable" as const,
            id: "questing-beast-unpreventable-combat-damage",
            // CR 615.12 — "combat damage that would be dealt by creatures YOU
            // control can't be prevented". Scoped three ways, each of which a
            // sloppier predicate would get wrong: to COMBAT damage (the caller
            // only reaches this on the CR 510 path, so a creature's activated
            // ping stays preventable); to CREATURES (a planeswalker or an
            // artifact dealing damage is untouched); and to the creatures
            // QUESTING BEAST'S CONTROLLER controls — not "creatures" globally,
            // and not Questing Beast alone. Read live off `self`, so the
            // immunity follows a control change and ends the instant Questing
            // Beast leaves the battlefield (CR 611.2).
            unpreventable: (self, damageSource) =>
                damageSource.types.includes("Creature") &&
                damageSource.controllerId === self.controllerId,
            oracleText:
                "Combat damage that would be dealt by creatures you control can't be prevented.",
        },
    ],
    triggeredAbilities: [
        {
            id: "questing-beast-planeswalker-damage",
            oracleText:
                "Whenever Questing Beast deals combat damage to an opponent, it deals that much damage to target planeswalker that player controls.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player" &&
                // CR 102.1 — "an opponent", never its own controller.
                event.target.id !== self.controllerId,
            // CR 603.3d — target chosen as the trigger goes on the stack.
            // "that player controls": in this engine's 2-player scope the
            // damaged player IS the ability controller's sole opponent
            // (CR 506.2 — only the defending player can be dealt combat damage
            // by an attacker), so `controller: "opponent"` names exactly the
            // right battlefield with no per-event controller derivation.
            targetRequirement: {
                type: "Planeswalker",
                count: 1,
                controller: "opponent",
            },
            // protocol card: the amount is "THAT MUCH damage" — the damage
            // amount off the FIRING EVENT. The Effect Script DSL has no way to
            // express it: `EVENT_FIELD_REGISTRY` (ADR 0049) censuses only
            // object- and player-family `$event.<field>` refs, and `EffectValue`
            // has no numeric event member, so `dealDamage.amount` cannot read
            // `event.amount`. This is the same documented gap that keeps Jackal
            // Pup (`tmp/red.ts`), El-Hajjâj (`arn/black.ts`) and Living Artifact
            // (`lea/green.ts`) imperative; `aiEffects` below is the bot's shadow
            // script, per PRD #1423.
            resolve: (ctx, event) => {
                if (event.type !== "DAMAGE_DEALT") return;
                const target = ctx.targets[0];
                if (!target) return; // no legal planeswalker (CR 608.2b)
                if (event.amount <= 0) return;
                // CR 120.3c / 704.5i — damage dealt to a planeswalker removes
                // that many loyalty counters; `dealDamage` routes it there.
                ctx.dealDamage(target, event.amount);
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — a bare `resolve()`
            // ability, so the bot's value model has nothing to walk without a
            // shadow. `amount: 4` is Questing Beast's own printed power, the
            // damage this trigger deals in the overwhelmingly common
            // unblocked-and-unpumped case.
            aiEffects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        },
    ],
};
