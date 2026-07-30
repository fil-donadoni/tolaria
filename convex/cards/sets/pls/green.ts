// PLS (Planeshift) — green cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { DAMAGEABLE_PERMANENT_TYPES, type CardDefinition } from "../../types";

// Mirrorwood Treefolk — {3}{G} Creature — Treefolk, 2/4. "{2}{R}{W}: The next
// time damage would be dealt to this creature this turn, that damage is
// dealt to any target instead." (CR 614 one-shot transient redirection,
// issue #1939.) Per the issue's spec, the destination — a player or a
// permanent (CR 115.4 "any target") — is chosen AS THE ABILITY RESOLVES, not
// announced at activation, so the ability carries no `targetRequirement`.
//
// protocol card: the destination is a mid-resolution `choose-damage-target`
// pick spanning damageable permanents AND players (CR 115.4), the same
// primitive Cuombajj Witches' opponent's-choice ping uses
// (`convex/cards/sets/arn/black.ts`) and outside the scriptable
// EffectChoiceKind subset (ADR 0045) — plus installing a transient
// `addDamageRedirectionShield` shield, a `resolve()`-only SpellContext
// primitive with no Effect Script Op wrapper (like Jade Monolith,
// `convex/cards/sets/lea/colorless.ts`). Not migratable to `effects[]`.
//
// Generalizes the redirection list's `from-source-to-permanent-redirect`
// shield (`gre/state.ts`, previously Jade Monolith-only with a
// player-only destination) so `redirectTo` can be a permanent too, chosen
// here via the same disambiguation Cuombajj Witches uses: a picked id that
// is one of the queried player ids targets that player, otherwise it names
// a damageable permanent. No `sourceInstanceId` filter — the oracle text has
// no source restriction ("the next time damage would be dealt to this
// creature", from ANY source), unlike Jade Monolith's chosen-source filter.
export const mirrorwoodTreefolk: CardDefinition = {
    id: "ba9a1c94-2b7f-4df7-8517-a122616d9ae4", // PLS printing (scryfallId)
    name: "Mirrorwood Treefolk",
    rarity: "uncommon",
    oracleText:
        "{2}{R}{W}: The next time damage would be dealt to this creature this turn, that damage is dealt to any target instead.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 2,
    toughness: 4,
    // AI valuation override (ADR 0018 / issue #1431, #1519's ability-level
    // extension): the redirect ability is `resolve()`-only with no `effects[]`
    // it could carry (see the protocol-card justification above) and its
    // `addDamageRedirectionShield` mechanism has no `EffectOp` a shadow script
    // could honestly approximate, so this plugs the `aiEffectsGuard`
    // ability-level gap (`convex/cards/__tests__/aiEffectsGuard.bot.test.ts`)
    // with a card-level override rather than a misleading shadow script.
    // Calibrated against `creatureValueRaw`/`LATENT_DISCOUNT`
    // (`gre/creatureBody.ts` / `gre/cardValue.ts`): a vanilla 2/4 for MV4
    // latents at ~175 (`(100 + 2*15 + 4*14 + 4*5) * 0.85`); +25 for the
    // repeatable defensive redirect (a fraction of `PREVENT_DAMAGE_FLAT_VALUE`
    // = 70, `gre/ai/opValuers.ts`, since it costs 4 mana and a stack action
    // per use rather than being a free static shield). Latent worth only —
    // the realized battlefield eval is unaffected (`cardValue.ts` doc).
    aiValue: 200,
    activatedAbilities: [
        {
            id: "mirrorwood-treefolk-redirect",
            oracleText:
                "{2}{R}{W}: The next time damage would be dealt to this creature this turn, that damage is dealt to any target instead.",
            cost: { mana: { X: 2, R: 1, W: 1 } },
            useStack: true,
            resolve: (ctx) => {
                const permanentCandidates = ctx.allPlayerIds.flatMap((pid) =>
                    ctx.getBattlefieldIds(pid, {
                        types: [...DAMAGEABLE_PERMANENT_TYPES],
                    })
                );
                const playerCandidates = [...ctx.allPlayerIds];
                const picked = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `mirrorwood-treefolk-target-${ctx.sourceInstanceId}`,
                    kind: "choose-damage-target",
                    zone: "battlefield",
                    allControllers: true,
                    filter: { types: [...DAMAGEABLE_PERMANENT_TYPES] },
                    candidateIds: permanentCandidates,
                    candidatePlayerIds: playerCandidates,
                    count: 1,
                    prompt: "Mirrorwood Treefolk: choose a target the next damage to this creature this turn will be redirected to.",
                });
                if (picked === undefined) return; // suspend: awaiting pick
                const id = picked[0];
                if (!id) return;
                // Disambiguate the chosen id (CR 115.4 — mirrors Cuombajj
                // Witches' opponent-choice ping): a queried player id targets
                // that player, otherwise it names a damageable permanent.
                const redirectTo = playerCandidates.includes(id)
                    ? ({ type: "player", id } as const)
                    : ({ type: "permanent", id } as const);
                ctx.addDamageRedirectionShield({
                    kind: "from-source-to-permanent-redirect",
                    targetInstanceId: ctx.sourceInstanceId,
                    redirectTo,
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                });
            },
        },
    ],
};
