// ONC — white cards, split by colour per ADR 0043. The registry's
// `import * as onc from "./sets/onc"` resolves through onc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tokenCreatedTrigger } from "../../abilities/triggers/tokenCreatedTrigger";

// Staff of the Storyteller — {1}{W} Artifact (residue of #1302, parent PRD
// #620; unblocked by #1345). "When this artifact enters, create a 1/1 white
// Spirit creature token with flying. Whenever you create one or more
// creature tokens, put a story counter on this artifact. {W}, {T}, Remove a
// story counter from this artifact: Draw a card." Modern Scryfall oracle text.
//
// Home set = earliest paper printing (ADR 0041) = Phyrexia: All Will Be One
// Commander (ONC 10). It was originally implemented against the much later SOC
// reprint, which filed it under the wrong home set and rendered the wrong art;
// the SOC printing now rides along as a `CardPrint` (`soc/colorless.ts`). Its
// cost is coloured ({1}{W}), so it lives in white.ts, not colorless.ts.
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
    id: "ab1d1461-1625-4163-aacd-a939f4871fad", // ONC 10
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
