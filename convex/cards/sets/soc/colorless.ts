// Secrets of Strixhaven Commander (SOC) — colorless cards, split by colour
// per ADR 0043. The registry's `import * as soc from "./sets/soc"` resolves
// through soc/index.ts. Lands and colourless artifacts (no coloured cost)
// live here per the colour-split convention. New home-set directory
// scaffolded for the #1302 residue tranche (parent PRD #620).
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tokenCreatedTrigger } from "../../abilities/triggers/tokenCreatedTrigger";

// Staff of the Storyteller — {1}{W} Artifact (residue of #1302, parent PRD
// #620; unblocked by #1345). "When this artifact enters, create a 1/1 white
// Spirit creature token with flying. Whenever you create one or more
// creature tokens, put a story counter on this artifact. {W}, {T}, Remove a
// story counter from this artifact: Draw a card." Modern Scryfall oracle
// text (rarity "rare" — the #1302 residue note's "uncommon" guess was wrong,
// corrected against Scryfall id 67083aca-b077-4b12-8218-876e22476f85).
//
// Three DSL pieces, all Op-expressible (no resolve() needed):
//   - ETB (`enteredTrigger` scope: "self") — plain `createToken` (CR 111 /
//     701.7), the exact 1/1 white flying Spirit shape `dka/white.ts`'s
//     Lingering Souls already exercises.
//   - The middle trigger — `tokenCreatedTrigger` (issue #1345's new factory)
//     scoped "you", filtered to creature tokens (`filter: { types:
//     "Creature" }`), running a `counters` Op that adds a story counter to
//     `$source`. Fires off the SAME `TOKENS_CREATED` event the ETB's own
//     `createToken` call emits — so the ETB's own Spirit ALSO nets a story
//     counter (correct: the real card gets its first counter the turn it
//     enters, per Scryfall rulings), and creating several creature tokens
//     in one resolution nets exactly ONE counter (the "one or more" batching
//     issue #1345 exists to prove).
//   - The activated ability — `{W}, {T}, Remove a story counter` cost (the
//     `removeCounter` activation-cost shape `eld/black.ts`'s Wishclaw
//     Talisman already exercises) → a plain `draw` Op.
export const staffOfTheStoryteller: CardDefinition = {
    id: "67083aca-b077-4b12-8218-876e22476f85",
    name: "Staff of the Storyteller",
    rarity: "rare",
    manaCost: { X: 1, W: 1 },
    types: ["Artifact"],
    oracleText:
        "When this artifact enters, create a 1/1 white Spirit creature token with flying.\nWhenever you create one or more creature tokens, put a story counter on this artifact.\n{W}, {T}, Remove a story counter from this artifact: Draw a card.",
    triggeredAbilities: [
        enteredTrigger({
            id: "staff-of-the-storyteller-etb-spirit",
            oracleText:
                "When this artifact enters, create a 1/1 white Spirit creature token with flying.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    controller: "controller",
                    token: {
                        name: "Spirit",
                        types: ["Creature"],
                        subtypes: ["Spirit"],
                        power: 1,
                        toughness: 1,
                        colors: ["W"],
                        staticAbilities: ["flying"],
                    },
                },
            ],
        }),
        tokenCreatedTrigger({
            id: "staff-of-the-storyteller-story-counter",
            oracleText:
                "Whenever you create one or more creature tokens, put a story counter on this artifact.",
            scope: "you",
            filter: { types: "Creature" },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "story",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "staff-of-the-storyteller-draw",
            oracleText:
                "{W}, {T}, Remove a story counter from this artifact: Draw a card.",
            cost: {
                mana: { W: 1 },
                tap: true,
                removeCounter: { type: "story", count: 1 },
            },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
