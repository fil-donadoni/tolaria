// AER — blue cards, split by colour per ADR 0043. The registry's
// `import * as aer from "./sets/aer"` resolves through aer/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Metallic Rebuke — {2}{U} Instant. "Improvise. Counter target spell unless
// its controller pays {3}." (CR 702.126 Improvise + CR 701.5a counter/punisher
// pattern.) Issue #1313 — the first card to ship the Improvise keyword now
// that it's `status: "implemented"` in mechanicsRegistry.ts (tapping untapped
// artifacts toward the generic portion of THIS card's own {2}{U} cost, at the
// payment step — game.ts `tapArtifactForImprovise`). The counter-unless-pay
// body reuses the shipped punisher template verbatim (Disrupt, inv/blue.ts /
// Force Spike, leg/blue.ts): `mayPay` + `if(!paid)` + `counter`, all
// interpreter-suite-exercised Ops — no new Op introduced. Scryfall AER #39.
export const metallicRebuke: CardDefinition = {
    id: "f712ac26-dca4-459b-84c1-010597007f60",
    name: "Metallic Rebuke",
    rarity: "common",
    oracleText:
        "Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)\nCounter target spell unless its controller pays {3}.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    staticAbilities: ["improvise"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            player: { controllerOf: { target: 0 } },
            cost: { X: 3 },
            prompt: "Pay {3} or your spell is countered (Metallic Rebuke)?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};
