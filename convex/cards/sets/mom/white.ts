// mom — white cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import { incubateOp } from "../../abilities/tokens/incubatorToken";
import type { CardDefinition } from "../../types";

// Sunfall — {3}{W}{W} Sorcery. "Exile all creatures. Incubate X, where X is
// the number of creatures exiled this way." (CR 701.13 exile; CR 701.53
// Incubate.) UNBLOCKED by #924/#1210 — `incubate` is now `status:
// "implemented"` in `mechanicsRegistry.ts`; `incubateOp` (issue #924,
// `cards/abilities/tokens/incubatorToken.ts`) is a thin `createToken` sugar
// over the shared Incubator token spec.
//
// Op order note: `incubateOp` (which computes X) runs BEFORE the `forEach`
// exile, even though the Oracle text reads "exile ... then incubate". The
// `count` EffectValue construct reads LIVE battlefield state at the moment
// it resolves (CR 608.2b); evaluating it AFTER the exile would see an empty
// board and give X=0. Reordering is rules-equivalent here: a non-targeted
// "exile all creatures" effect exiles EVERY creature unconditionally (unlike
// `destroy`, there is no indestructible-style out for `exile`), and the
// Incubator token itself is a noncreature Artifact, so it never inflates the
// count of the creatures it's about to be created alongside — the pre-exile
// creature count computed by `incubateOp`'s `count` always equals the
// post-exile actually-exiled count.
export const sunfall: CardDefinition = {
    id: "32e29c7d-ed4b-4eff-b3c2-d99e5b63ef8d",
    name: "Sunfall",
    rarity: "rare",
    oracleText:
        "Exile all creatures. Incubate X, where X is the number of creatures exiled this way.",
    manaCost: { generic: 3, W: 2 },
    types: ["Sorcery"],
    effects: [
        incubateOp({
            count: {
                zone: "battlefield",
                acrossAllPlayers: true,
                filter: { type: "Creature" },
            },
        }),
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [{ op: "exile", target: { ref: "$each" } }],
        },
    ],
};
