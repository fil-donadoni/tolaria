// RNA — blue cards, split by colour per ADR 0043. The registry's
// `import * as rna from "./sets/rna"` resolves through rna/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
//
// Home set for Skitter Eel (earliest paper printing, ADR 0041) — a new
// cross-set home set opened to prove Adapt N (CR 701.46, issue #1316,
// parent #917) against a genuinely SIMPLE adapt user: no linked-exile
// tracking (unlike Emperor of Bones, mh3/black.ts, still a tracked stub),
// no counter-placement meta-trigger, nothing beyond the keyword action
// itself.

import type { CardDefinition } from "../../types";
import { adaptAbility } from "../../abilities/adapt";

// Skitter Eel — {3}{U} Creature — Fish Crab, 3/3. "{2}{U}: Adapt 2." (CR
// 701.46). Vanilla P/T with a single activated ability whose entire effect
// IS the Adapt action — nothing else to model, which is exactly why it's the
// prover card for the keyword (issue #1316). Built with the `adaptAbility`
// factory (`convex/cards/abilities/adapt.ts`), itself composed from two
// ALREADY-exercised primitives (the `if` comparison predicate over the
// `counters` value grammar, and the `counters` add Op) — no new Op, per-Op
// test regime applies (no hand-written interpreter/wire test required).
export const skitterEel: CardDefinition = {
    id: "db328f03-7dae-445b-8e71-99dd88f26a9e",
    name: "Skitter Eel",
    rarity: "common",
    oracleText:
        "{2}{U}: Adapt 2. (If this creature has no +1/+1 counters on it, put two +1/+1 counters on it.)",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Fish", "Crab"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        adaptAbility({
            id: "skitter-eel-adapt",
            n: 2,
            cost: { X: 2, U: 1 },
            costLabel: "{2}{U}",
        }),
    ],
};
