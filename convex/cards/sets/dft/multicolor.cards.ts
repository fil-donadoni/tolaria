// dft — multicolor cards (ADR 0043 colour split).
import { defineCard } from "../../types";
import type { PermanentView, StaticEffectStateView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { cardsExiledTrigger } from "../../abilities/triggers/cardsExiledTrigger";

/** CR 406.1 — total cards across every player's exile zone; an unseen exile
 *  zone (a view without one) reads as empty. */
function sevenCardsInExile(state: StaticEffectStateView): boolean {
    return state.players.reduce((n, p) => n + (p.exile?.length ?? 0), 0) >= 7;
}

// TODO(issue #676 stub — Exhaust, CR 702.177, is `planned` in
// mechanicsRegistry.ts, not implemented): Loot exhausts its three mana/draw/
// damage abilities ("activate each exhaust ability only once") — the engine
// has no exhaust-tracking primitive, so this can't be modelled faithfully
// yet. Stop-and-issue per gre-development.md DSL-first authoring; left as a
// tracked stub rather than a card-shaped `resolve()` workaround.
// export const lootThePathfinder: CardDefinition = {
//     id: "33c59c04-4c0b-4a60-826e-3a7757d0b2a2",
//     name: "Loot, the Pathfinder",
//     rarity: "mythic",
//     manaCost: { X: 2, U: 1, R: 1, G: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Beast", "Noble"],
//     power: 2,
//     toughness: 4,
// };

// Brightglass Gearhulk — {G}{G}{W}{W} Artifact Creature 4/4. "First strike,
// trample. When this creature enters, you may search your library for up to
// two artifact, creature, and/or enchantment cards with mana value 1 or
// less, reveal them, put them into your hand, then shuffle." (CR 701.23 search /
// 400.7 / 701.24 shuffle.) `filter.type` is an OR-array (Artifact/Creature/
// Enchantment, issue #677); `filter.manaValueAtMost: 1` is the fixed
// mana-value ceiling (issue #677); `count: { min: 0, max: 2 }` is "up to two"
// (issue #677) — the `moveZone` cards-shape moves every picked id (0, 1, or
// 2). The "reveal them" clause is a `reveal` Op on the picked cards (issue
// #945, CR 701.20): it makes the found cards known to every player, placed
// BEFORE the moveZone/shuffle so the knowledge rides them into hand.
// hand-tail: When this creature enters, you may search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less, reveal them, put them into your hand, then shuffle. (#8505)
export const brightglassGearhulk = defineCard(() => ({
    id: "3dea5b45-925c-4732-8e9d-fa8232792736",
    name: "Brightglass Gearhulk",
    rarity: "mythic",
    manaCost: { W: 2, G: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 4,
    toughness: 4,
    staticAbilities: ["first strike", "trample"],
    oracleText:
        "First strike, trample\nWhen this creature enters, you may search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.",
    triggeredAbilities: [
        enteredTrigger({
            id: "brightglass-gearhulk-etb-search",
            oracleText:
                "When this creature enters, you may search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: ["Artifact", "Creature", "Enchantment"],
                        manaValueAtMost: 1,
                    },
                    count: { min: 0, max: 2 },
                    prompt: "Search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less.",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        }),
    ],
}));

// Ketramose, the New Dawn — {1}{W}{B} Legendary Creature — God 4/4. "Menace,
// lifelink, indestructible. Ketramose can't attack or block unless there are
// seven or more cards in exile. Whenever one or more cards are put into exile
// from graveyards and/or the battlefield during your turn, you draw a card
// and lose 1 life."
// CR 508.1c / 509.1b — the attack side is a `global-attack-restriction` whose
// source is the attacker itself (its `forbids` receives the live state view,
// so it can count every player's exile zone); the block side is a
// `block-restriction` on the blocker. "Seven or more cards in exile" counts
// all players' exile zones (CR 406.1). CR 603.2c — `CARDS_EXILED` is one event
// per exile occurrence, so the trigger fires once however many cards moved;
// `scope: "any"` + `fromZones: [graveyard, battlefield]` is "graveyards and/or
// the battlefield" (any owner); "during your turn" reads `activePlayerId`.
// hand-tail: Whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, you draw a card and lose 1 life. (#8623)
export const ketramoseTheNewDawn = defineCard(() => ({
    id: "cffae8d0-7b4e-42ed-8124-24a86b38f490",
    name: "Ketramose, the New Dawn",
    rarity: "mythic",
    manaCost: { X: 1, W: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["God"],
    power: 4,
    toughness: 4,
    staticAbilities: ["menace", "lifelink", "indestructible"],
    oracleText:
        "Menace, lifelink, indestructible\nKetramose can't attack or block unless there are seven or more cards in exile.\nWhenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, you draw a card and lose 1 life.",
    staticEffects: [
        {
            kind: "global-attack-restriction",
            id: "ketramose-cant-attack-unless-seven-exiled",
            forbids: (
                attacker: PermanentView,
                source: PermanentView,
                state: StaticEffectStateView
            ) => attacker.id === source.id && !sevenCardsInExile(state),
            oracleText:
                "Ketramose can't attack unless there are seven or more cards in exile.",
        },
        {
            kind: "block-restriction",
            id: "ketramose-cant-block-unless-seven-exiled",
            side: "blocker",
            predicate: (
                _self: PermanentView,
                _opponent: PermanentView,
                state?: StaticEffectStateView
            ) => (state ? sevenCardsInExile(state) : true),
            oracleText:
                "Ketramose can't block unless there are seven or more cards in exile.",
        },
    ],
    triggeredAbilities: [
        cardsExiledTrigger({
            id: "ketramose-exile-draw-lose-life",
            oracleText:
                "Whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, you draw a card and lose 1 life.",
            scope: "any",
            fromZones: ["graveyard", "battlefield"],
            condition: (_event, self, state) =>
                state?.activePlayerId === self.controllerId,
            effects: [
                { op: "draw", player: "controller", count: 1 },
                { op: "loseLife", player: "controller", amount: 1 },
            ],
        }),
    ],
}));
