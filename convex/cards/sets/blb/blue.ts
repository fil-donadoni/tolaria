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
// PROTOCOL (attack-trigger ability-strip + base-P/T set — no Op skin):
// `removeStaticAbilities` (predicate closure) and `setBasePT` (a computed
// value locked at resolution) are both documented "stays resolve() by
// design" primitives in the Mechanics Registry (no JSON-expressible form).
// `TriggeredAbility` carries no `targetRequirement`, so the "up to one
// target" pick is a mid-resolution `choose-permanents` choice (idiom: Loran
// of the Third Path, bro/white.ts). "Until your next turn" maps to the
// `{ phase: "untap", player: "controller" }` DurationSpec (precedent: Orcish
// Farmer's "until its controller's next untap step").
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
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx: SpellContext) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!opponentId) return;
                const candidateIds = ctx.getBattlefieldIds(opponentId, {
                    types: ["Artifact", "Creature", "Planeswalker"],
                });
                if (candidateIds.length === 0) return;
                const creatureIds = new Set(
                    ctx.getBattlefieldIds(opponentId, { types: "Creature" })
                );
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `azure-beastbinder-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: opponentId,
                    candidateIds,
                    count: { min: 0, max: 1 },
                    prompt: "Azure Beastbinder: up to one target artifact, creature, or planeswalker an opponent controls (or none).",
                });
                if (picks === undefined) return; // suspended for the choice
                const targetId = picks[0];
                if (!targetId) return;
                const target = { type: "permanent" as const, id: targetId };
                const duration = {
                    phase: "untap" as const,
                    player: "controller" as const,
                };
                ctx.removeStaticAbilities(target, () => true, duration);
                if (creatureIds.has(targetId)) {
                    ctx.setBasePT(target, 2, 2, duration);
                }
            },
        },
    ],
};
