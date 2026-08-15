// MH3 — blue cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { investigateOp } from "../../abilities/tokens/clueToken";
import {
    drawTrigger,
    nthDrawThisTurn,
} from "../../abilities/triggers/drawTrigger";
import { colorChoiceModes } from "../../abilities/chooseColor";
import { TAMIYO_SEASONED_SCHOLAR_EMBLEM_ID } from "../../emblems";

// ─────────────────────────────────────────────────────────────────────────
// Tamiyo, Inquisitive Student // Tamiyo, Seasoned Scholar (issue #2385)
// ─────────────────────────────────────────────────────────────────────────
//
// The exile-and-return-transformed flip template is Jace, Vryn's Prodigy's
// (`sets/ori/blue.ts`, issue #2380) — front face `{ op:
// "exileAndReturnTransformed", target: { ref: "$source" } }` under a
// `drawTrigger` condition, back face `activatedAbilities[]` with
// `cost: { loyalty: N }`. Nothing new there.
//
// Colour-file placement (ADR 0043): the front face's own mana cost is
// mono-{U}, so this file. The BACK face carries a colour indicator of G/U
// (Scryfall `card_faces[1].color_indicator`), making the printed CARD
// two-colour overall — but ADR 0043 classifies a set file by "the colour
// identity of a card's mana cost" (see the header comment above), and the
// only mana cost on either face is the front's mono-{U}. No other shipped
// double-faced card has a differently-coloured back face yet, so this is a
// judgement call rather than an established precedent — flagged in the PR.
//
// Front face — "Whenever Tamiyo attacks, investigate" is the shared
// `investigateOp()` skin (CLUE_TOKEN_SPEC, `abilities/tokens/clueToken.ts`)
// under a raw `ATTACKERS_DECLARED` self-attack trigger (the `big/red.ts`
// Xantid Swarm / Generous Plunderer shape: `attackerIds.includes(self.id)`).
// "When you draw your third card in a turn" is `drawTrigger` +
// `nthDrawThisTurn(3)` (`abilities/triggers/drawTrigger.ts`, issue #781) —
// the engine-supported "Nth draw this turn" condition, already generalized
// past Faerie Mastermind's 2nd-draw template.
//
// Back face (Tamiyo, Seasoned Scholar, starting loyalty 2):
//   • +2 — "Until your next turn, whenever a creature attacks you or a
//     planeswalker you control, it gets -1/-0 until end of turn." NOT a real
//     CR 603.7a delayed triggered ability: `CardBackFace` (this ability's
//     home, synthesized through `tokenDefinitionId`'s content-derived-id
//     codec, `gre/transform.ts`) carries no native `TriggeredAbility` slot —
//     a `matches` predicate is a closure and the codec only round-trips
//     JSON-pure data. `grantAttackerDebuffWindow` (new single-purpose Op,
//     mirroring `setPlayerProtectionFromEverything`'s "The One Ring" shape)
//     opens a player-scoped window instead, applied DIRECTLY by
//     `emitAttackersDeclaredEvents` (`gre/phases.ts`) — see that Op's doc
//     comment (`cards/types.ts`) for the full rationale. Documented
//     simplification, mirroring Xantid Swarm's flag-and-gate shape.
//   • −3 — "Return target instant or sorcery card from your graveyard to
//     your hand. If it's a green card, add one mana of any color." The
//     return is Regrowth's own `moveZone` (`sets/lea/green.ts`); "add one
//     mana of any color" is the pre-existing `optionChoice` +
//     `colorChoiceModes` composition (`abilities/chooseColor.ts`, INV's
//     "becomes the color of your choice" template) — no new Op. The colour
//     GATE needed a new predicate, `targetMatchesGraveyardFilter` (issue
//     #2385): none of the three existing "matches filter" predicates reach
//     an ANNOUNCED graveyard-zone target's colour (`boundMatchesFilter`'s
//     snapshot has no colour slot; `objectMatchesFilter` is battlefield-only;
//     `picksMatchFilter` needs a `choice` Op's picks binding, and this card
//     is targeted, not picked). The new predicate is `picksMatchFilter`'s
//     announced-target sibling — same `getGraveyardCards` +
//     `matchesCardFilter` reader, keyed by an object selector instead of a
//     picks ref. Checked BEFORE the `moveZone` (reversed from the printed
//     sentence order) — a card's colour doesn't change with its zone, so the
//     reorder is CR-608.2-neutral and lets the predicate read the card while
//     it is still findable in the graveyard.
//   • −7 — "Draw cards equal to half the number of cards in your library,
//     rounded up. You get an emblem…" needed a new `EffectValue` grammar
//     member, `divide` (issue #2385, the FIFTEENTH member, `scaled`'s
//     division counterpart) — no existing member divides. The emblem is the
//     established `emblem` Op referencing a registered `EmblemDefinition`
//     (`TAMIYO_SEASONED_SCHOLAR_EMBLEM_ID`, `cards/emblems.ts`), reusing the
//     SAME `hand-size-override` continuous static effect Library of Leng /
//     Reliquary Tower carry on a permanent — `effectiveMaxHandSize`
//     (`gre/phases.ts`) now also scans `state.emblems` for it.
export const tamiyoInquisitiveStudent: CardDefinition = {
    id: "2a717b98-cdac-416d-bf6c-f6b6638e65d1",
    name: "Tamiyo, Inquisitive Student",
    rarity: "mythic",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Moonfolk", "Wizard"],
    supertypes: ["Legendary"],
    power: 0,
    toughness: 3,
    staticAbilities: ["flying"],
    oracleText:
        "Flying\nWhenever Tamiyo attacks, investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")\nWhen you draw your third card in a turn, exile Tamiyo, then return her to the battlefield transformed under her owner's control.",
    triggeredAbilities: [
        {
            id: "tamiyo-inquisitive-student-attack-investigate",
            oracleText: "Whenever Tamiyo attacks, investigate.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [investigateOp()],
        },
        drawTrigger({
            id: "tamiyo-inquisitive-student-flip",
            oracleText:
                "When you draw your third card in a turn, exile Tamiyo, then return her to the battlefield transformed under her owner's control.",
            scope: "your",
            condition: nthDrawThisTurn(3),
            effects: [
                { op: "exileAndReturnTransformed", target: { ref: "$source" } },
            ],
        }),
    ],
    backFace: {
        name: "Tamiyo, Seasoned Scholar",
        types: ["Planeswalker"],
        subtypes: ["Tamiyo"],
        supertypes: ["Legendary"],
        // CR 306.5b — starting loyalty, placed as the returning permanent
        // ENTERS the battlefield (`stageReanimatedOnBattlefield`, gre/state.ts).
        loyalty: 2,
        // CR 712.2 — a back face's colour is fixed by its own printed
        // characteristics: Tamiyo, Seasoned Scholar carries a G/U colour
        // indicator (Scryfall `card_faces[1].color_indicator`), independent
        // of the front face's mono-blue mana cost.
        colors: ["G", "U"],
        oracleText:
            '+2: Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.\n−3: Return target instant or sorcery card from your graveyard to your hand. If it\'s a green card, add one mana of any color.\n−7: Draw cards equal to half the number of cards in your library, rounded up. You get an emblem with "You have no maximum hand size."',
        imagePrintId: "2a717b98-cdac-416d-bf6c-f6b6638e65d1",
        activatedAbilities: [
            {
                id: "tamiyo-seasoned-scholar-plus2",
                cost: { loyalty: 2 },
                useStack: true,
                oracleText:
                    "+2: Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.",
                effects: [
                    { op: "grantAttackerDebuffWindow", player: "controller" },
                ],
            },
            {
                id: "tamiyo-seasoned-scholar-minus3",
                cost: { loyalty: -3 },
                useStack: true,
                oracleText:
                    "−3: Return target instant or sorcery card from your graveyard to your hand. If it's a green card, add one mana of any color.",
                targetRequirement: {
                    type: ["Instant", "Sorcery"],
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
                effects: [
                    {
                        // Checked BEFORE the move — see the file header comment
                        // for why the reorder is CR-608.2-neutral.
                        op: "if",
                        predicate: {
                            targetMatchesGraveyardFilter: { target: 0 },
                            player: "controller",
                            filter: { color: "G" },
                        },
                        then: [
                            {
                                op: "optionChoice",
                                player: "controller",
                                prompt: "Add one mana of any color.",
                                modes: colorChoiceModes((color) => [
                                    {
                                        op: "addMana",
                                        mana: { [color]: 1 },
                                        player: "controller",
                                    },
                                ]),
                            },
                        ],
                    },
                    { op: "moveZone", target: { target: 0 }, to: "hand" },
                ],
            },
            {
                id: "tamiyo-seasoned-scholar-minus7",
                cost: { loyalty: -7 },
                useStack: true,
                oracleText:
                    '−7: Draw cards equal to half the number of cards in your library, rounded up. You get an emblem with "You have no maximum hand size."',
                effects: [
                    {
                        op: "draw",
                        player: "controller",
                        count: {
                            divide: {
                                value: {
                                    count: {
                                        zone: "library",
                                        controller: "controller",
                                    },
                                },
                                by: 2,
                                rounding: "up",
                            },
                        },
                    },
                    { op: "emblem", emblem: TAMIYO_SEASONED_SCHOLAR_EMBLEM_ID },
                ],
            },
        ],
    },
};
