// ONS — white cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons"` resolves through ons/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Exalted Angel — {4}{W}{W} Creature — Angel, 4/5. "Flying / Whenever this
// creature deals damage, you gain that much life. / Morph {2}{W}{W}"
//
// The pool's first MORPH card (CR 702.37, issue #2705). Morph is declared as
// the `morph` sibling field — the printed TURN-UP cost — and nothing else:
// the face-down cast is always "{3} rather than paying its mana cost"
// (CR 702.37a), a constant of the rule synthesized by
// `morphCastAlternativeCost` (`convex/gre/morph.ts`), so this card cannot
// declare a cast cost that disagrees with it. `staticAbilities` carries only
// `flying`: morph is a static ability in the CR's sense (CR 702.37a) but not
// one this engine's keyword pipeline models, exactly as `flashback` /
// `evoke` / `dash` are sibling fields rather than keyword strings.
//
// resolve() justification (ADR 0045 DSL-first, precedent-twin): the lifegain
// clause is the EXACT El-Hajjâj / Horned Cheetah shape (`arn/black.ts`,
// `inv/multicolor.ts`) — `damageDealtTrigger({ source: "self", resolve:
// (ctx, event) => ctx.gainLife(ctx.controller, event.amount) })`. The same
// documented gap applies: `event.amount` has no `EffectValue` grammar member
// / `$event` field row, so the trigger cannot be written as an Effect Script.
// Not an invented shortcut and not a new primitive.
export const exaltedAngel: CardDefinition = {
    id: "c2213eac-cea4-4dfd-90c4-c1f466967e2e",
    rarity: "rare",
    name: "Exalted Angel",
    oracleText:
        "Flying\nWhenever this creature deals damage, you gain that much life.\nMorph {2}{W}{W} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)",
    manaCost: { X: 4, W: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 4,
    toughness: 5,
    staticAbilities: ["flying"],
    // CR 702.37e — the cost to turn the face-down permanent face up as a
    // special action. NOT the cost of the face-down cast (CR 702.37a's {3}).
    morph: { X: 2, W: 2 },
    triggeredAbilities: [
        damageDealtTrigger({
            id: "exalted-angel-lifegain",
            oracleText:
                "Whenever this creature deals damage, you gain that much life.",
            source: "self",
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};
