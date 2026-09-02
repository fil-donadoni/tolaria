// ALA — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ala from "./sets/ala"` resolves through ala/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Tidehollow Sculler — {W}{B} Artifact Creature — Zombie, 2/2 (Vintage Cube
// edict/discard/hand disruption, issue #682; shipped by issue #2522).
//
// TWO printed triggered abilities (CR 603.2), so both halves are ordinary
// triggers — this card has no CR divergence. Composed entirely from Ops that
// already ship; no new Op, no new `SpellContext` primitive, no `resolve()`.
//
//   - The ETB half is the canonical Thoughtseize template (`lrw/black.ts`):
//     `reveal` stamps the announced opponent's hand `knownTo` the controller
//     (CR 701.20a), then a `choose-hand-card` `choice` whose CHOOSER is the
//     controller and whose ZONE OWNER (`zoneOwnerId`) is that opponent.
//     "Nonland card" is the filter's `excludeType: "Land"`.
//   - The exile is the `cards`-shape `moveZone` (`from: "hand"` →
//     `to: "exile"`) carrying `linkToSource: true` (issue #1947), which
//     stamps `exiledBySourceId` = this creature's own instance, so the
//     return half can name exactly this card (CR 607 linked abilities).
//   - The return is the sixth `moveZone` shape, `target: { exiledWithSource:
//     true }` → `to: "hand"` (issue #1323). It resolves through
//     `getCardsExiledWith`, which spans EVERY player's exile, and moves the
//     card out of the OWNER's exile pile into the OWNER's hand — CR 400.7,
//     which is what this card needs, since the exiled card belongs to the
//     opponent and not to the Sculler's controller. Precedent for pairing
//     `linkToSource` with this selector: Emperor of Bones (`mh3/black.ts`).
//
// "Target opponent" is a REAL target announced when the ETB trigger goes on
// the stack (CR 603.3d, the issue #1193 machinery), not a resolution-time
// choice — so it reaches the player-target legality gate. Both of the
// abilities that make a PLAYER an illegal target are stated in those terms:
// protection (CR 702.16b — "a permanent or player with protection can't be
// targeted by spells with the stated quality") and shroud (CR 702.18a —
// "this permanent or player can't be the target of spells or abilities").
//
// DELIBERATELY no `condition` on the leaves-the-battlefield trigger: per CR
// 603.2 the ability triggers whenever the permanent leaves, whether or not a
// card was exiled (an empty hand, an all-land hand, or a card that has since
// left exile). With nothing linked, the return is a clean CR 608.2b no-op.
// This is NOT Banishing Light's `holdsExileBundle` shape — that condition
// reads the `exileHeld` bundle store, which this card never populates.
//
// The defining play pattern falls out of the two triggers by itself: killing
// the Sculler in response to its own ETB trigger puts the return trigger on
// the stack ABOVE it, so the return resolves first with nothing linked (a
// no-op) and the exile resolves afterwards — the card stays exiled
// indefinitely. Exiled cards are face up (CR 406.3): entering exile clears
// `knownTo` (ADR 0026 public-zone rule), and the board affordance pinning the
// exiled card to the Sculler comes free from the `exiledBySourceId` →
// `exiledByPermanentId` projection link (issue #791).
//
// The Oracle compiler has no grammar for either printed line yet — the
// reveal-and-exile-a-chosen-hand-card clause and the linked return-on-leave
// clause are both unconsumed slots, so Guard C is satisfied by declaring the
// fragments rather than by a round trip (PRD #2693).
// compiler-gap: When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card. (#2693)
// compiler-gap: When this creature leaves the battlefield, return the exiled card to its owner's hand. (#2693)
export const tidehollowSculler: CardDefinition = {
    id: "1abecc77-07f2-43e4-8585-0a8199cdcf01",
    name: "Tidehollow Sculler",
    rarity: "uncommon",
    oracleText:
        "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.\nWhen this creature leaves the battlefield, return the exiled card to its owner's hand.",
    manaCost: { W: 1, B: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "tidehollow-sculler-exile",
            oracleText:
                "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.",
            scope: "self",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { excludeType: "Land" },
                    count: 1,
                    prompt: "Choose a nonland card from that player's hand to exile.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: { target: 0 },
                    from: "hand",
                    to: "exile",
                    linkToSource: true,
                },
            ],
        }),
        leftTrigger({
            id: "tidehollow-sculler-return",
            oracleText:
                "When this creature leaves the battlefield, return the exiled card to its owner's hand.",
            scope: "self",
            effects: [
                {
                    op: "moveZone",
                    target: { exiledWithSource: true },
                    to: "hand",
                },
            ],
        }),
    ],
};
