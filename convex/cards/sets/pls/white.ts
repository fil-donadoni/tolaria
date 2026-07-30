// PLS (Planeshift) — white cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST, mostCommonColors } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Lashknife Barrier — {2}{W} Enchantment. "When this enchantment enters,
// draw a card.\nIf a source would deal damage to a creature you control, it
// deals that much damage minus 1 to that creature instead." (CR 614
// continuous replacement — issue #1939.) The ETB draw is a plain `draw` Op
// trigger (DSL-first). The reduction is a permanent-bound
// `replacementEffects[]` entry, the same live-scan mechanism as Well-Laid
// Plans / Camel (`convex/cards/sets/inv/blue.ts` / `arn/white.ts`) — no new
// persisted state, since the effect is simply "active while this enchantment
// is on the battlefield" and re-evaluated at every `damage` event.
//
// Generalization over the existing player-scoped shield
// (`PlayerDamagePreventionShield`, `gre/state.ts`): that shield's `mode` is
// `"all" | "half-down"` and its scope is a single PLAYER ("damage to you").
// Lashknife Barrier needs neither — its scope is a FILTERED SET of
// permanents (every creature the controller of Lashknife Barrier controls,
// not a fixed instance list) and its residual is a flat "minus 1", which
// fits the `ReplacementEffect.appliesTo`/`replace` closure shape directly
// rather than the transient-shield family (that family models one-shot /
// N-charge grants created by an activated ability mid-game, not a
// permanent's own continuous static text). `Math.max(0, amount - 1)` keeps
// the reduction from going negative (a 1-damage source deals 0, never
// "negative damage").
export const lashknifeBarrier: CardDefinition = {
    id: "2485c10d-de02-4be9-8119-afb2296e3317", // PLS printing (scryfallId)
    name: "Lashknife Barrier",
    rarity: "uncommon",
    oracleText:
        "When this enchantment enters, draw a card.\nIf a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "lashknife-barrier-etb",
            oracleText: "When this enchantment enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    replacementEffects: [
        {
            id: "lashknife-barrier-reduce",
            eventKind: "damage",
            oracleText:
                "If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "permanent") return false;
                const targetCreature = state.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === event.target.id);
                if (!targetCreature?.types.includes("Creature")) return false;
                return targetCreature.controllerId === self.controllerId;
            },
            // CR 614 — reduce the damage by 1, floored at 0.
            replace: (event) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        amount: Math.max(0, event.amount - 1),
                    },
                };
            },
        },
    ],
};

// Heroic Defiance — {1}{W} Enchantment — Aura. "Enchant creature. Enchanted
// creature gets +3/+3 unless it shares a color with the most common color
// among all permanents or a color tied for most common." (CR 613 board-wide
// colour census, issue #1943, PRD #1935 cluster C8b.)
//
// The census counts each colour across EVERY permanent both players control
// (every card type, not creatures only) via the shared `mostCommonColors`
// helper (`cards/types.ts`, promoted off its 3rd consumer — Goham Djinn /
// Tsabo's Assassin, `sets/inv/black.ts`, were the first two). A multicoloured
// permanent contributes to each of its colours; a colourless permanent
// contributes to none and can never be "most common". With no coloured
// permanents at all `mostCommonColors` returns `[]`, and `.some(...)` on an
// empty array is false, so the bonus applies — exactly the "no coloured
// permanents ⇒ bonus applies" acceptance criterion, for free.
//
// Modeled as a `pt-cda` (CR 613.4a/7a), not a `pt-buff` + `condition`: a
// `pt-buff`'s `condition` is evaluated per-SOURCE only (`source, state, ctx`
// — no `target` parameter, `cards/types.ts` `StaticPTBuff.condition`), so it
// cannot read the enchanted creature's OWN colour to compare against the
// census. `pt-cda`'s `compute` receives `target` as its 4th argument
// (`StaticPTCDA.compute`), which is exactly what "unless IT shares a colour"
// needs. Same shape as Exotic Curse / Goham Djinn (`sets/inv/black.ts`).
//
// No CR 613.8 dependency-loop risk: the census reads `ctx.getColors` (layer
// 5, colour — already resolved by the time this layer-7 P/T read runs) to
// compute a P/T contribution; it never feeds back into colour derivation, so
// there is nothing to order against itself. `ctx.getColors` already resolves
// the EFFECTIVE colour (CR 613.1d `colorOverride`, granted colours), so a
// colour-changing effect elsewhere on the board shifts the census on its own
// — no extra wiring needed here.
//
// DIVERGENCE: `getCDAContribution` (`gre/layers.ts`) overwrites rather than
// sums layer-7a `pt-cda` contributions across sources, which is correct for
// a true CR 613.4b "set" CDA but wrong for this card's CR 613.4c-shaped
// *modification* — enchanting a creature that carries its OWN `pt-cda`
// (e.g. Nightmare) makes one effect silently clobber the other, in the
// worst case producing a 0/0 that dies to SBA. `pt-buff` (layer 7c) can't
// express this card instead: its `applies` gets no `state` (can't read the
// board-wide census) and its `condition` gets no `target` (can't compare the
// enchanted creature's own colour). Bug-class tracked-by: #1992.
export const heroicDefiance: CardDefinition = {
    id: "0dc1aa36-5d3b-4d25-9d54-937cdabf72a4", // PLS 6
    rarity: "common",
    name: "Heroic Defiance",
    oracleText:
        "Enchant creature\nEnchanted creature gets +3/+3 unless it shares a color with the most common color among all permanents or a color tied for most common.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (_source, state, ctx, target) => {
                const mostCommon = mostCommonColors(state, ctx);
                const sharesColor = ctx
                    .getColors(target)
                    .some((c) => mostCommon.includes(c));
                return sharesColor
                    ? { power: 0, toughness: 0 }
                    : { power: 3, toughness: 3 };
            },
        },
    ],
};
