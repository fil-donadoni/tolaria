// mom — white cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import { modalLandBackFace } from "../../abilities";
import { incubateOp } from "../../abilities/tokens/incubatorToken";
import type { CardDefinition } from "../../types";

// Witch Enchanter // Witch-Blessed Meadow — {3}{W} Creature — Human Warlock
// 2/2, with a Land back face (CR 712.3, ADR 0122). "When this creature enters,
// destroy target artifact or enchantment an opponent controls." // "As this
// land enters, you may pay 3 life. If you don't, it enters tapped. {T}: Add
// {W}."
//
// CR 712.8a files it here by its FRONT face: a white creature card in every
// zone but the battlefield and the stack, which is every zone the colour split
// (ADR 0043) and the enumerators look at.
//
// The ETB is one Oracle line, so ONE `TriggeredAbility` (CR 603.2), and the
// back face is the shared shock-clause factory registered as the `${id}#back`
// twin. CR 712.14b is inert for this card — its front face IS a permanent card
// — which is why Sink into Stupor is the clause's live subject and this one is
// its control.
// compiler-gap: "As this land enters, you may pay 3 life. If you don't, it enters tapped." (#2693)
export const witchEnchanter: CardDefinition = {
    id: "62061e7c-cf19-4f03-b8fa-2bdba62d6b0b",
    name: "Witch Enchanter",
    rarity: "uncommon",
    oracleText:
        "When this creature enters, destroy target artifact or enchantment an opponent controls.",
    manaCost: { generic: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warlock"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "witch-enchanter-etb",
            oracleText:
                "When this creature enters, destroy target artifact or enchantment an opponent controls.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
                controller: "opponent",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
    backFace: modalLandBackFace({
        name: "Witch-Blessed Meadow",
        color: "W",
        life: 3,
    }),
};

// Sunfall — {3}{W}{W} Sorcery. "Exile all creatures. Incubate X, where X is
// the number of creatures exiled this way." (CR 701.13 exile; CR 701.53 incubate
// .) UNBLOCKED by #924/#1210 — `incubate` is now `status:
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
