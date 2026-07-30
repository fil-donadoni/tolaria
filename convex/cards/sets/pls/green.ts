// PLS (Planeshift) — green cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Mirrorwood Treefolk — {3}{G} Creature — Treefolk, 2/4. "{2}{R}{W}: The next
// time damage would be dealt to this creature this turn, that damage is
// dealt to any target instead." (CR 614 one-shot transient redirection,
// issue #1939.)
//
// Targeting fix (PR #1978 review): "any target" is chosen when the ability
// is PUT ON THE STACK (CR 601.2c / 602.2b), not mid-resolution — issue
// #1939's "chosen as the ability resolves" wording conflicted with the CR
// (commented on the issue). The ability declares
// `targetRequirement: { type: "any", count: 1 }`, exactly like Cuombajj
// Witches' controller-chosen ping (`convex/cards/sets/arn/black.ts`), which
// routes the pick through `getLegalTargets`/`selectTarget` — the real CR
// 115.4/608.2b/protection/hexproof/shroud gate — instead of an unfiltered
// candidate list assembled at resolution. `choose-damage-target` stays
// reserved for a genuinely mid-resolution, OPPONENT-chosen pick (Cuombajj's
// second ping); this one is the controller's own announced target, so it
// needs no request/disambiguation step at all.
//
// protocol card: `resolve()` still installs a transient
// `addDamageRedirectionShield` shield, a `resolve()`-only SpellContext
// primitive with no Effect Script Op wrapper (like Jade Monolith,
// `convex/cards/sets/lea/colorless.ts`). Not migratable to `effects[]`.
//
// Generalizes the redirection list's `from-source-to-permanent-redirect`
// shield (`gre/state.ts`, previously Jade Monolith-only with a
// player-only destination) so `redirectTo` can be a permanent too —
// `ctx.targets[0]` is already shaped as `{type:"player"|"permanent", id}`
// (`TargetSelection`), the exact same union `redirectTo` declares, so no
// disambiguation step is needed. No `sourceInstanceId` filter — the oracle
// text has no source restriction ("the next time damage would be dealt to
// this creature", from ANY source), unlike Jade Monolith's chosen-source
// filter.
//
// DIVERGENCE: the official ruling says "during combat it is possible for
// multiple sources to damage the Treefolk at one time, in which case damage
// from all of those sources is redirected" — but the shield is `remaining: 1`
// and the engine emits one combat-damage event PER SOURCE
// (`applyOneCombatDamage`, `convex/gre/phases.ts`), each independently
// running the CR 614 replacement loop, so only the first simultaneous
// source's damage is redirected; the rest lands on the Treefolk. Not fixed
// in this pass — tracked-by: #1983.
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
            // Controller's target (CR 602.2b — chosen at activation), same
            // shape as Cuombajj Witches' controller-chosen ping.
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                // "any target" (CR 115.4) only ever resolves to a permanent
                // or a player here — narrow defensively rather than widen
                // `DamageRedirection.redirectTo`'s union.
                if (
                    !target ||
                    (target.type !== "player" && target.type !== "permanent")
                ) {
                    return;
                }
                ctx.addDamageRedirectionShield({
                    kind: "from-source-to-permanent-redirect",
                    targetInstanceId: ctx.sourceInstanceId,
                    redirectTo: { type: target.type, id: target.id },
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                });
            },
        },
    ],
};
