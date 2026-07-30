// PLS (Planeshift) — white cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
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
