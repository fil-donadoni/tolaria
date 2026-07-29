// C17 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as c17 from "./sets/c17"` resolves through c17/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";

// Fractured Identity — {3}{W}{U} Sorcery. "Exile target nonland permanent.
// Each player other than its controller creates a token that's a copy of
// it." UNSTUBBED for issue #1568: the original blocker (`createTokenCopy`)
// shipped in #1459; the deeper gap — "each player other than its
// controller" had no `EffectPlayerRef` expression — is closed by THIS
// issue's `{ opponentOf: EffectPlayerRef }` grammar member
// (`convex/cards/types.ts`, `resolvePlayerRef` in
// `convex/gre/effects/interpreter.ts`): `{ opponentOf: { controllerOf:
// { target: 0 } } }` is exactly "the other seat than the target's
// controller".
//
// TWO-PLAYER SIMPLIFICATION (CLAUDE.md § Out of Scope — no 3+ player
// multiplayer): Oracle's "each player other than its controller" is a
// PLURAL selector in a multiplayer game (every other player creates a
// copy); Tolaria has exactly two seats, so it degenerates to "the ONE other
// player", which `{ opponentOf }` resolves directly with no `forEach`
// needed. This card does NOT generalize to 3+ players — see the
// `opponentOf` doc comment in `cards/types.ts` for why that would need a
// different (multi-valued) construct.
//
// ORDERING: copy BEFORE exile, matching the official ruling that the token
// is a copy "as [the permanent] looked immediately before it was
// exiled" — the `createTokenCopy` Op reads the source live off the
// battlefield, so it must run first; the target then exiles.
export const fracturedIdentity: CardDefinition = {
    id: "b2f73f5d-1aad-48c2-9e74-5f7bdd87900f",
    name: "Fractured Identity",
    rarity: "rare",
    oracleText:
        "Exile target nonland permanent. Each player other than its controller creates a token that's a copy of it.",
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Sorcery"],
    // CR 115.1c — "target nonland permanent" (any controller's — no
    // `controller` restriction, which is exactly why the target's
    // controller can be either seat and "opponent" alone can't express the
    // complement).
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        excludeTypes: "Land",
        count: 1,
    },
    effects: [
        {
            op: "createTokenCopy",
            source: { target: 0 },
            controller: { opponentOf: { controllerOf: { target: 0 } } },
        },
        { op: "exile", target: { target: 0 } },
    ],
};
