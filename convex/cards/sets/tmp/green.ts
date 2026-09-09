// TMP — green cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Mirri's Guile — {G} Enchantment. "At the beginning of your upkeep, you may
// look at the top three cards of your library, then put them back in any
// order." Authored DSL-first as an Effect Script (ADR 0045): an upkeep
// `phaseTrigger` (CR 603.6a, `scope: "your"` — the scoped player IS the
// controller) whose `effects[]` are the cost-free "you may" gate (CR 117.3a,
// `mayPay` with no cost → boolean bind) and, if accepted, the `scryReorder` Op
// with `destination: "none"` (a pure reorder — every looked-at card stays on
// top, only the order changes, CR 401.4 look + CR 401 reorder; unlike Scry it
// bottoms nothing). The Op is the declarative skin over `SpellContext.orderTop`
// and marks the cards known to the controller (ADR 0026). Each suspending Op
// checkpoints on its own Op index so a suspension never re-runs an earlier step
// (CR 608.3).
export const mirrisGuile: CardDefinition = {
    id: "73d51a3c-95c0-4810-b847-4b8afd12fd64",
    name: "Mirri's Guile",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "mirris-guile-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Look at the top three cards of your library (Mirri's Guile)?",
                    bind: "$look",
                },
                {
                    op: "if",
                    predicate: { binding: "$look" },
                    then: [
                        {
                            op: "scryReorder",
                            player: "controller",
                            count: 3,
                            destination: "none",
                            prompt: "Put these cards back on top in any order (rightmost = top).",
                        },
                    ],
                },
            ],
        }),
    ],
};

// Earthcraft — {1}{G} Enchantment. "Tap an untapped creature you control:
// Untap target basic land." Authored DSL-first (ADR 0045). The ability lives
// on the enchantment (no `tap` on the source — the enchantment does not tap
// itself); its whole cost is the `tapOtherFilter` pick (CR 602.1 / 118.8) of
// ONE untapped creature the activator controls, the same cost primitive
// Hand of Justice / Vodalian War Machine use. Because the ability has a
// target it is never a mana ability (CR 605.1a requires "no target"), so it
// uses the stack normally. The effect is the `tapUntap` Op in untap mode
// (CR 701.26b) on the announced basic-land slot; the target is any basic land
// (`supertypeFilter: "Basic"`, CR 205.4a — oracle says "target basic land",
// not restricted to lands you control).
export const earthcraft: CardDefinition = {
    id: "9dda7531-82a1-4f49-8858-601ddbc6e2bc",
    name: "Earthcraft",
    rarity: "rare",
    oracleText:
        "Tap an untapped creature you control: Untap target basic land.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "earthcraft-untap-land",
            oracleText:
                "Tap an untapped creature you control: Untap target basic land.",
            cost: {
                tapOtherFilter: {
                    filter: { types: "Creature", controllerRelation: "you" },
                    count: 1,
                },
            },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                supertypeFilter: "Basic",
            },
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        },
    ],
};

// Harrow — {2}{G} Instant. "As an additional cost to cast this spell,
// sacrifice a land. Search your library for up to two basic land cards, put
// them onto the battlefield, then shuffle." (CR 601.2b / 118.8 additional
// sacrifice cost; CR 401.4 search; CR 701.24 shuffle.)
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/green.ts`.
export const harrow: CardDefinition = {
    id: "3c207142-4880-4935-9827-b91bc7d9d643", // TMP 230
    rarity: "uncommon",
    name: "Harrow",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a land.\nSearch your library for up to two basic land cards, put them onto the battlefield, then shuffle.",
    manaCost: { X: 2, G: 1 },
    types: ["Instant"],
    additionalCosts: { sacrificeFilter: { types: "Land" } },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Land", supertype: "Basic" },
            count: { min: 0, max: 2 },
            prompt: "Search your library for up to two basic land cards.",
            bind: "$lands",
        },
        {
            op: "moveZone",
            cards: { ref: "$lands" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Aluren — {2}{G}{G} Enchantment. "Any player may cast creature spells with
// mana value 3 or less without paying their mana costs and as though they had
// flash."
//
// Pure DATA (ADR 0045): a single `cast-permission` static effect, the
// grant-polarity sibling of `cast-restriction` (CR 601.3 — "A player can begin
// to cast a spell only if a rule or effect allows that player to cast it").
// Nothing here is Aluren-shaped — the class of cards is a declarative
// `EffectCardFilter` read by the same hand-card matcher every CR 118.9 hand leg
// uses, and the sentence's three clauses map one-to-one onto three independent
// fields:
//
//   "Any player may cast"      -> grantee: "any-player" (CR 601.3 grants are
//                                 player-scoped; the commoner "You may cast"
//                                 is the same kind with grantee "controller")
//   "creature spells with
//    mana value 3 or less"     -> filter (CR 202.3; an {X} in a hand card's
//                                 cost counts as 0, CR 202.3b)
//   "without paying their
//    mana costs"               -> withoutPayingManaCost (CR 118.9 — "a cost …
//                                 applied to it from another effect that its
//                                 controller may pay rather than paying the
//                                 spell's mana cost"; announced per CR 601.2b,
//                                 never applied silently, because CR 118.5 says
//                                 even a {0} cost "is not automatically paid")
//   "and as though they had
//    flash"                    -> asThoughFlash (CR 601.3b, priced by CR 702.8a
//                                 as "any time you could cast an instant")
//
// The two terms travel TOGETHER, which is what makes the free cast mandatory
// off the caster's sorcery window (CR 118.9b — "An effect that allows you to
// cast a spell may require a certain alternative cost to be paid"): Aluren
// never lets a creature be cast at instant speed for its printed price.
// Enforced once, at announcement, by `castPermissionRequiredFor`
// (`convex/gre/rules.ts`).
export const aluren: CardDefinition = {
    id: "268403bc-733d-446e-a7c1-abc957c42bc2",
    name: "Aluren",
    rarity: "rare",
    oracleText:
        "Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.",
    manaCost: { X: 2, G: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "cast-permission",
            id: "aluren-creature-permission",
            grantee: "any-player",
            filter: { type: "Creature", manaValueAtMost: 3 },
            withoutPayingManaCost: true,
            asThoughFlash: true,
            oracleText:
                "Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.",
        },
    ],
};
