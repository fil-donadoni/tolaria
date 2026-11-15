// mh1 — white cards (ADR 0043 colour split).
import { defineCard, type PermanentView } from "../../types";
import { protectionColorModes } from "../../abilities";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Giver of Runes — {W} Creature — Kor Cleric (issue #684, Cube FREE evasion/
// protection statics). "{T}: Another target creature you control gains
// protection from colorless or from the color of your choice until end of
// turn." (CR 702.16 protection; CR 613.1f temporary keyword grant; CR 700.2
// modal choice; CR 109.2 "another" excludes the source itself.)
// hand-tail: {T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn. (#8505)
export const giverOfRunes = defineCard(() => ({
    id: "4e117771-5a8b-4812-b487-32ba34b7f724",
    name: "Giver of Runes",
    rarity: "rare",
    oracleText:
        "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Kor", "Cleric"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "giver-of-runes-protect",
            oracleText:
                "{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            getTargetRequirement: (source: PermanentView) => ({
                type: "Creature",
                count: 1,
                controller: "you",
                excludeInstanceIds: [source.id],
            }),
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose colorless or a color",
                    modes: protectionColorModes(["C", "W", "U", "B", "R", "G"]),
                },
            ],
        },
    ],
}));

// Ephemerate — {W} Instant (issue #1402, closes the #676 stub). "Exile target
// creature you control, then return it to the battlefield under its owner's
// control. Rebound." Rebound (CR 702.88) shipped as reusable engine infra
// (`convex/gre/rebound.ts`, Mechanics Registry `rebound` now `implemented`) —
// see that module for the full timing model. The blink itself is the #1401
// "exile(bind) + moveZone(ref, battlefield)" idiom, the SAME-resolution shape
// (no `delayedTrigger` wrapper — unlike Liberate/Flickerwisp, which delay the
// return to the next end step, Ephemerate's oracle text has no such delay):
// `exile` the announced target with a `bind`, then an immediate `moveZone`
// `from: "exile"` resolves the bound ref back out of exile,
// returning the card under its OWNER's control by default (no explicit
// `controller` — matches "under its owner's control"). Cast again from exile
// at the caster's next upkeep (Rebound), the fresh copy picks a NEW target.
export const ephemerate = defineCard(() => ({
    id: "2da5f3f8-5eef-498f-ba2c-2f3fbc3745aa",
    name: "Ephemerate",
    rarity: "common",
    oracleText:
        "Exile target creature you control, then return it to the battlefield under its owner's control. Rebound. (If you cast this spell from your hand, instead of putting it into your graveyard as it resolves, exile it. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
    manaCost: { W: 1 },
    types: ["Instant"],
    staticAbilities: ["rebound"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    effects: [
        { op: "exile", target: { target: 0 }, bind: "$c" },
        {
            op: "moveZone",
            target: { ref: "$c" },
            from: "exile",
            to: "battlefield",
        },
    ],
}));

// Ranger-Captain of Eos — {1}{W}{W} Creature — Human Soldier Ranger, 3/3.
// "When this creature enters, you may search your library for a creature card
// with mana value 1 or less, reveal it, put it into your hand, then shuffle.
// Sacrifice this creature: Your opponents can't cast noncreature spells this
// turn." (CR 701.23 search / 701.24 shuffle; CR 601.3a cast prohibition;
// CR 602.2b the sacrifice is a cost, paid before the ability is on the stack.)
// The ETB is the Stoneforge Mystic tail with a mana-value ceiling filter. The
// second ability is `restrictCasting` against the opponent with
// `excludeCardTypes: ["Creature"]` ("noncreature" = no Creature type); lands
// are not cast, so they stay playable. Cleared at CLEANUP (CR 514.2).
// hand-tail: Sacrifice this creature: Your opponents can't cast noncreature spells this turn. (#8631)
export const rangerCaptainOfEos = defineCard(() => ({
    id: "af3928b4-813a-4120-8799-de34235d60ac",
    name: "Ranger-Captain of Eos",
    rarity: "mythic",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Ranger"],
    power: 3,
    toughness: 3,
    oracleText:
        "When this creature enters, you may search your library for a creature card with mana value 1 or less, reveal it, put it into your hand, then shuffle.\nSacrifice this creature: Your opponents can't cast noncreature spells this turn.",
    triggeredAbilities: [
        enteredTrigger({
            id: "ranger-captain-of-eos-etb-search",
            oracleText:
                "When this creature enters, you may search your library for a creature card with mana value 1 or less, reveal it, put it into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Creature", manaValueAtMost: 1 },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a creature card with mana value 1 or less (or none).",
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
    activatedAbilities: [
        {
            id: "ranger-captain-of-eos-lock",
            oracleText:
                "Sacrifice this creature: Your opponents can't cast noncreature spells this turn.",
            cost: { sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "restrictCasting",
                    player: "opponent",
                    excludeCardTypes: ["Creature"],
                },
            ],
        },
    ],
}));
