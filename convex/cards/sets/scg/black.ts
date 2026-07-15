// SCG (Scourge) — black cards, split by colour per ADR 0043. The registry's
// `import * as scg from "./sets/scg"` resolves here via scg/index.ts.
import type { CardDefinition } from "../../types";

// Tendrils of Agony — {2}{B}{B} Sorcery. "Target player loses 2 life and you
// gain 2 life. Storm (When you cast this spell, copy it for each spell cast
// before it this turn. You may choose new targets for the copies.)" (CR
// 702.40 Storm, ADR 0052 + PRD #1041 — the classic storm kill.)
// `staticAbilities: ["storm"]` drives the copy mechanism
// (`collectCastTriggers` / `resolveStormTrigger`, convex/gre/state.ts). The
// card's own effect is the plain two-Op DSL sequence Stormscape Master's
// drain ability already exercises (inv/multicolor.ts): `loseLife` on the
// announced target player, then `gainLife` on the resolving controller — no
// new Op, reused verbatim (per-Op test regime).
export const tendrilsOfAgony: CardDefinition = {
    id: "0559352e-95c1-403b-bd8f-d0679717cfa2",
    name: "Tendrils of Agony",
    rarity: "uncommon",
    oracleText:
        "Target player loses 2 life and you gain 2 life.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)",
    manaCost: { X: 2, B: 2 },
    types: ["Sorcery"],
    staticAbilities: ["storm"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        { op: "loseLife", player: { target: 0 }, amount: 2 },
        { op: "gainLife", player: "controller", amount: 2 },
    ],
};
