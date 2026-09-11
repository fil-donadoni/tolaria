// blb (Bloomburrow) — blue cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";
import {
    CLASS_SUBTYPE,
    classLevelGainedTrigger,
} from "../../abilities/classLevels";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { OTTER_TOKEN } from "../../sharedTokens";

// Azure Beastbinder — {1}{U} Creature — Rat Rogue, 1/3, vigilance (Vintage
// Cube FREE: ETB/dies/attack triggers, issue #679). "Vigilance. This creature
// can't be blocked by creatures with power 2 or greater. Whenever this
// creature attacks, up to one target artifact, creature, or planeswalker an
// opponent controls loses all abilities until your next turn. If it's a
// creature, it also has base power and toughness 2/2 until your next turn."
//
// The block restriction is a plain `staticEffects[]` predicate (CR 509.1b,
// layer system, precedent: Argothian Pixies, atq/green.ts — already-shipped
// continuous-effect machinery, not a DSL Op).
//
// TARGETING (CR 603.3d): "up to one target artifact, creature, or planeswalker
// an opponent controls" is a REAL target chosen when the attack trigger is put
// on the stack — declared as a `targetRequirement` on the TriggeredAbility
// (issue #1193 machinery, `raiseTriggerTargetSelection` in gre/rules.ts), NOT a
// resolution-time `requestChoice`. That makes it subject to hexproof /
// protection / ward and fires "becomes the target of an ability" triggers,
// which the old choice-as-target workaround silently skipped. `controller:
// "opponent"` enforces "an opponent controls"; `count 0..1` = "up to one".
//
// PROTOCOL (attack-trigger ability-strip + base-P/T set — no Op skin): the
// resolve() then only applies the announced target's effect.
// `removeStaticAbilities` (predicate closure) and `setBasePT` (a computed
// value locked at resolution) are both documented "stays resolve() by
// design" primitives in the Mechanics Registry (no JSON-expressible form).
// "Until your next turn" maps to the `{ phase: "untap", player: "controller" }`
// DurationSpec (precedent: Orcish Farmer's "until its controller's next untap
// step").
export const azureBeastbinder: CardDefinition = {
    id: "211af1bf-910b-41a5-b928-f378188d1871",
    name: "Azure Beastbinder",
    rarity: "rare",
    oracleText:
        "Vigilance\nThis creature can't be blocked by creatures with power 2 or greater.\nWhenever this creature attacks, up to one target artifact, creature, or planeswalker an opponent controls loses all abilities until your next turn. If it's a creature, it also has base power and toughness 2/2 until your next turn.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Rat", "Rogue"],
    power: 1,
    toughness: 3,
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "block-restriction",
            id: "azure-beastbinder-no-power-2-plus",
            side: "attacker" as const,
            // CR 509.1b — can't be blocked by creatures with power 2 or greater.
            predicate: (_self, opponent) => (opponent.power ?? 0) < 2,
            oracleText:
                "Azure Beastbinder can't be blocked by creatures with power 2 or greater.",
        },
    ],
    triggeredAbilities: [
        {
            id: "azure-beastbinder-attack",
            oracleText:
                "Whenever this creature attacks, up to one target artifact, creature, or planeswalker an opponent controls loses all abilities until your next turn. If it's a creature, it also has base power and toughness 2/2 until your next turn.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d — "up to one target artifact, creature, or planeswalker
            // an opponent controls": a real target chosen when the trigger is
            // put on the stack (not a resolution-time choice), so it is subject
            // to hexproof / protection / ward and fires "becomes the target"
            // triggers. `controller: "opponent"` = "an opponent controls";
            // `count 0..1` = "up to one".
            targetRequirement: {
                type: ["Artifact", "Creature", "Planeswalker"],
                count: { min: 0, max: 1 },
                controller: "opponent",
            },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            // NOT DSL-migratable (ADR 0045): the `setBasePT` Op (CR 613.4b,
            // issue #1318) now covers the 2/2 base set, but this closure is
            // blocked on TWO other gaps: (1) `removeStaticAbilities` has no Op
            // (New-Op backlog `removeStaticAbilities`, migration-classifier.mjs)
            // — the ability-stripping half; (2) the 2/2 set is CONDITIONAL on
            // the target being an opponent's CREATURE (`isCreatureTarget`, an
            // opponent-battlefield scan), which the `if` predicate grammar
            // (boolean-binding / numeric-comparison / count) can't express for
            // an announced target's card-type. Blocked on: a
            // `removeStaticAbilities` Op + a target-is-creature predicate, NOT
            // the setBasePT Op.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // "up to one": none chosen / CR 608.2b none legal
                const targetId = target.id;
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                const isCreatureTarget = opponentId
                    ? new Set(
                          ctx.getBattlefieldIds(opponentId, {
                              types: "Creature",
                          })
                      ).has(targetId)
                    : false;
                const permanent = { type: "permanent" as const, id: targetId };
                const duration = {
                    phase: "untap" as const,
                    player: "controller" as const,
                };
                ctx.removeStaticAbilities(permanent, () => true, duration);
                if (isCreatureTarget) {
                    ctx.setBasePT(permanent, 2, 2, duration);
                }
            },
        },
    ],
};

// Stormchaser's Talent — {U} Enchantment — Class (Vintage Cube, issue #3234).
// The engine's first Class card (CR 716), so the whole CR 716 machinery ships
// with it: `classLevelBars[]` on the definition, desugared at the
// `getDefinition` seam by `expandClassLevelBars`
// (`cards/abilities/classLevels.ts`) into the activated ability each bar
// represents (CR 716.2a, behind the declarative `classLevelBar` gate) plus the
// abilities printed in that bar's text box section, level-gated at N or
// greater. Mechanics Registry row: `class-level-bar` (CR 716.2).
//
// CR 716.3 — the top text box section's entry trigger is declared here like any
// other card's: the Class has it at all times, at every level, and the expander
// never touches it.
//
// CR 716.2b — the level is `CardInstanceState.classLevel`, NOT a counter.
// CR 716.4 and CR 711.7 both say class levels and level counters do not
// interact, so nothing that removes, doubles or counts counters can see it, and
// a copy of a levelled Class starts at level 1 (levels are not copiable).
//
// The Otter is the shared `OTTER_TOKEN` spec (CR 111 / 707.2) — 1/1 blue and
// red with prowess, art resolved per producer from the token print lockfile
// against this card's own BLB printing.
//
// compiler-gap: "(Gain the next level as a sorcery to add its ability.)" (#2693)
// compiler-gap: "{3}{U}: Level 2" (#2693)
// compiler-gap: "When this Class becomes level 2, return target instant or sorcery card from your graveyard to your hand." (#2693)
// compiler-gap: "{5}{U}: Level 3" (#2693)
export const stormchasersTalent: CardDefinition = {
    id: "a36e682d-b43d-4e08-bf5b-70d7e924dbe5", // BLB 75
    rarity: "rare",
    name: "Stormchaser's Talent",
    oracleText:
        "(Gain the next level as a sorcery to add its ability.)\nWhen this Class enters, create a 1/1 blue and red Otter creature token with prowess.\n{3}{U}: Level 2\nWhen this Class becomes level 2, return target instant or sorcery card from your graveyard to your hand.\n{5}{U}: Level 3\nWhenever you cast an instant or sorcery spell, create a 1/1 blue and red Otter creature token with prowess.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: [CLASS_SUBTYPE],
    // CR 716.3 — the top section, functioning at every level.
    triggeredAbilities: [
        enteredTrigger({
            id: "stormchasers-talent-etb-otter",
            oracleText:
                "When this Class enters, create a 1/1 blue and red Otter creature token with prowess.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    token: OTTER_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        }),
    ],
    classLevelBars: [
        {
            level: 2,
            cost: { X: 3, U: 1 },
            costLabel: "{3}{U}",
            triggeredAbilities: [
                classLevelGainedTrigger({
                    level: 2,
                    oracleText:
                        "When this Class becomes level 2, return target instant or sorcery card from your graveyard to your hand.",
                    // CR 603.3d — a REAL target, chosen as the trigger is put
                    // on the stack (the Snapcaster Mage shape, isd/blue.ts):
                    // `zone: "graveyard"` + `controller: "you"` narrows to
                    // instant/sorcery cards in the controller's own graveyard,
                    // and `count: 1` auto-selects when exactly one is legal and
                    // removes the trigger when none is (CR 603.3c).
                    targetRequirement: {
                        type: ["Instant", "Sorcery"],
                        count: 1,
                        zone: "graveyard",
                        controller: "you",
                    },
                    effects: [
                        { op: "moveZone", target: { target: 0 }, to: "hand" },
                    ],
                }),
            ],
        },
        {
            level: 3,
            cost: { X: 5, U: 1 },
            costLabel: "{5}{U}",
            triggeredAbilities: [
                spellCastTrigger({
                    id: "stormchasers-talent-level-3-otter",
                    oracleText:
                        "Whenever you cast an instant or sorcery spell, create a 1/1 blue and red Otter creature token with prowess.",
                    scope: "you",
                    filter: { types: ["Instant", "Sorcery"] },
                    effects: [
                        {
                            op: "createToken",
                            token: OTTER_TOKEN,
                            controller: "controller",
                            count: 1,
                        },
                    ],
                }),
            ],
        },
    ],
};
