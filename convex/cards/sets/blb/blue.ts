// blb (Bloomburrow) — blue cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";

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
