// one — multicolor cards (ADR 0043 colour split).
import type { CardDefinition, CardType } from "../../types";

// Atraxa, Grand Unifier — {3}{G}{W}{U}{B} Legendary Creature, 7/7. "Flying,
// vigilance, deathtouch, lifelink. When Atraxa enters, reveal the top ten
// cards of your library. For each card type, you may put a card of that type
// from among the revealed cards into your hand. Put the rest on the bottom of
// your library in a random order."
//
// The ETB was the long-standing engine gap tracked at issue #1364 (the stub
// this file used to carry): "reveal a fixed top-N window ONCE, then run
// several INDEPENDENT category-scoped picks against that SAME shared set."
// `lookDistribute` cannot express it — one `filter`, one `take`, and repeated calls
// do not share a window (each re-peeks the CURRENT library top, which has
// already moved). It is now the `revealAndCategorize` Op, whose per-category
// keep is validated as a bipartite matching (`gre/categorizedPick.ts`): a card
// with several card types may be kept for only ONE of them (Gatherer ruling),
// so the legal keep-sets are exactly those admitting an injective card →
// category assignment.
//
// CR 205.2a card types, not the printed reminder list. The reminder text
// enumerates eight ("Artifact, battle, creature, enchantment, instant, land,
// planeswalker, and sorcery are card types") because it predates the
// Tribal → Kindred rename; reminder text is explanatory, never rules text
// (CR 207.2), and the ability itself says "for each card TYPE". Kindred is a
// card type (CR 205.2a) and this engine models it (`CardType`), so it is a
// category here too — omitting it would silently under-deliver on a Kindred
// card in the revealed window.
const ATRAXA_CARD_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Instant",
    "Kindred",
    "Land",
    "Planeswalker",
    "Sorcery",
] as const satisfies readonly CardType[];

export const atraxaGrandUnifier: CardDefinition = {
    id: "4a1f905f-1d55-4d02-9d24-e58070793d3f",
    name: "Atraxa, Grand Unifier",
    rarity: "mythic",
    oracleText:
        "Flying, vigilance, deathtouch, lifelink\nWhen Atraxa enters, reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order.",
    manaCost: { X: 3, W: 1, U: 1, B: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Phyrexian", "Angel"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "vigilance", "deathtouch", "lifelink"],
    triggeredAbilities: [
        {
            id: "atraxa-etb-reveal-ten",
            oracleText:
                "When Atraxa enters, reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            effects: [
                {
                    op: "revealAndCategorize",
                    player: "controller",
                    look: 10,
                    // "REVEAL the top ten cards" (CR 701.20a) — the whole
                    // window is public, not a private look.
                    reveal: "window",
                    // "you MAY put a card of that type" — keeping fewer than
                    // the maximum (including nothing) is legal.
                    optional: true,
                    // "Put the rest on the bottom of your library in a RANDOM
                    // order" — no ordering pick, no knowledge granted.
                    randomBottom: true,
                    categories: ATRAXA_CARD_TYPES.map((type) => ({
                        label: type,
                        filter: { type },
                    })),
                    prompt: "Put up to one card of each card type into your hand.",
                },
            ],
        },
    ],
};
