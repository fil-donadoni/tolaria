// APC — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST, PERMANENT_TYPES } from "../../types";
import { defineSplitCard } from "../../splitCard";

// Vindicate — "Destroy target permanent." (CR 701.8 destroy.) `type: "any"`
// matches only the CR 115.4 damageable types (creature/planeswalker/battle/
// player); "target permanent" of any type uses the full CR 300.1 permanent-type
// set (incl. Land) instead.
export const vindicate: CardDefinition = {
    id: "2a1bfefd-dae8-49e9-9d56-cc852e3dc93b",
    rarity: "rare",
    name: "Vindicate",
    oracleText: "Destroy target permanent.",
    manaCost: { X: 1, W: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
};

// Gerrard's Verdict. CR 701.9a — the discard moves a card from its owner's
// hand to that player's graveyard, and the affected player chooses which: the
// canonical choice + discard pair, whose picks binding is exactly what
// "discarded this way" then names.
// CR 608.2h — the life is counted once, as the effect is applied. `picks`
// narrows the graveyard count to those two cards, so a land that was already
// in that graveyard is not counted; `times: 3` is the printed multiplier.
// A player holding fewer than two cards discards what they have, and the
// count follows (CR 101.3 — the impossible part of an instruction is ignored).
// hand-tail: Target player discards two cards. You gain 3 life for each land card discarded this way. (#4332)
export const gerrardsVerdict: CardDefinition = {
    id: "583740c0-68cf-4205-b682-2f97c0880d42",
    rarity: "uncommon",
    name: "Gerrard's Verdict",
    oracleText:
        "Target player discards two cards. You gain 3 life for each land card discarded this way.",
    manaCost: { W: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "choice",
            kind: "discard-hand",
            player: { target: 0 },
            zone: "hand",
            count: 2,
            prompt: "Discard two cards.",
            bind: "$discarded",
        },
        { op: "discard", player: { target: 0 }, cards: { ref: "$discarded" } },
        {
            op: "gainLife",
            player: "controller",
            amount: {
                count: {
                    zone: "graveyard",
                    controller: { target: 0 },
                    filter: { type: "Land" },
                    picks: { ref: "$discarded" },
                    times: 3,
                },
            },
        },
    ],
};

// Guided Passage — the first CATEGORISED PICK an OPPONENT makes out of a
// REVEALED library (issue #3808).
//
// CR 701.20a — "Reveal the cards in your library" shows every card to every
// player. That is a knowledge stamp, not a zone change: CR 400.2 keeps a
// library hidden "even if all the cards in one such zone happen to be
// revealed", so the reveal Op marks the cards known to all and the trailing
// shuffle takes the knowledge back (CR 701.20d). It also BINDS what it
// revealed, which is what lets the pick below name a set CR 701.20a actually
// made public rather than reaching into a hidden zone.
//
// No search happens here — the opponent is shown the cards, they do not look
// through the library — so the pick is `choose-library-card`, never
// `search-library`: no `LIBRARY_SEARCHED` trigger fires (Aven Mindcensor and
// friends have nothing to replace), and CR 701.23b's "you need not find" does
// not apply, so the choice is MANDATORY. The opponent chooses as many of the
// three descriptions as the library can answer, and the interpreter clamps the
// count to the maximum matching (CR 608.2b — a library with no land offers two
// cards, not three).
//
// The three categories are injective by construction of the text: a creature
// LAND (Dryad Arbor) answers "a creature card" or "a land card", never both,
// because three distinct cards are chosen and put into a hand.
// hand-tail: "Reveal the cards in your library. An opponent chooses from among them a creature card, a land card, and a noncreature, nonland card. You put the chosen cards into your hand. Then shuffle." (#4333)
export const guidedPassage: CardDefinition = {
    id: "0b2e8e58-aee1-4882-943a-17a6af2f8410",
    rarity: "rare",
    name: "Guided Passage",
    oracleText:
        "Reveal the cards in your library. An opponent chooses from among them a creature card, a land card, and a noncreature, nonland card. You put the chosen cards into your hand. Then shuffle.",
    manaCost: { G: 1, U: 1, R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "reveal",
            player: "controller",
            zone: "library",
            bind: "$revealed",
        },
        {
            op: "choice",
            kind: "choose-library-card",
            player: "opponent",
            zoneOwnerId: "controller",
            zone: "library",
            candidates: [{ ref: "$revealed" }],
            categories: [
                { label: "Creature card", filter: { type: "Creature" } },
                { label: "Land card", filter: { type: "Land" } },
                {
                    label: "Noncreature, nonland card",
                    filter: { excludeType: ["Creature", "Land"] },
                },
            ],
            count: 3,
            prompt: "Choose a creature card, a land card, and a noncreature, nonland card.",
            bind: "$chosen",
        },
        {
            op: "moveZone",
            cards: { ref: "$chosen" },
            player: "controller",
            from: "library",
            to: "hand",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Split card (CR 709.1–709.4, ADR 0121 §6 slice 2, issue #3308)
//
// CR 709.4b makes Life // Death a GOLD card — "a split card's colors and mana
// value are determined from its combined mana cost", and {G} + {1}{B} is
// {1}{B}{G}: green AND black, mana value 3. That is what every graveyard
// reader sees (a tutor, a deck-legality check, the Bot's valuation), which is
// why the card lives here and not in green.ts or black.ts.
//
// It declares no top-level `name`, `manaCost` or `types`: CR 709.4 makes those
// three a FUNCTION of the halves, and `defineSplitCard` is the only thing that
// writes them (`cards/splitCard.ts`, ADR 0121 §1).
// ─────────────────────────────────────────────────────────────────────────

// Life // Death — {G} // {1}{B}, Sorcery // Sorcery. "All lands you control
// become 1/1 creatures until end of turn. They're still lands." // "Return
// target creature card from your graveyard to the battlefield. You lose life
// equal to its mana value."
//
// LIFE is the half with the real rules content. "All lands you control become
// 1/1 creatures until end of turn" is a continuous effect generated by a
// RESOLVING SPELL, so CR 611.2c fixes its set of objects the moment it begins:
// "the set of objects it affects is determined when that continuous effect
// begins. After that point, the set won't change." A land that enters the
// battlefield later this turn is NOT animated. `forEach` is exactly that
// semantics already — its member set is frozen at construct entry — so the
// clause needs no new Op and no new duration: ONE `animate` per land that was
// there at resolution, each with its own end-of-turn expiry.
//
// The animation itself is `animate`'s own layer split (CR 613.1d/f): the
// Creature card type lands in layer 4 and the 1/1 base P/T in layer 7b, and
// the type is ADDED rather than replacing the printed line — CR 205.1b's "in
// addition to its other types", which is what "They're still lands" says. The
// animated land is a land and a creature at once, so it keeps tapping for mana
// and it dies to the CR 704.5f state-based action the moment something drops
// its toughness to 0.
//
// DEATH is ordinary reanimation over already-exercised Ops, and it is
// Reanimate's script (`tmp/black.ts`) narrowed to `controller: "you"` — "your
// graveyard", not "a graveyard". `bind` + `ref.manaValue` snapshots the card's
// mana value BEFORE the zone change (CR 608.2h last-known information), since
// "its mana value" is the card's, read off the object that just left the
// graveyard.
export const lifeDeath: CardDefinition = defineSplitCard({
    id: "7ab75cdb-93a1-4f78-b404-37566295c321",
    rarity: "uncommon",
    oracleText:
        "All lands you control become 1/1 creatures until end of turn. They're still lands.\nReturn target creature card from your graveyard to the battlefield. You lose life equal to its mana value.",
    halves: [
        {
            name: "Life",
            manaCost: { G: 1 },
            types: ["Sorcery"],
            oracleText:
                "All lands you control become 1/1 creatures until end of turn. They're still lands.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Land" },
                    },
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$each" },
                            power: 1,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
        {
            name: "Death",
            manaCost: { X: 1, B: 1 },
            types: ["Sorcery"],
            oracleText:
                "Return target creature card from your graveyard to the battlefield. You lose life equal to its mana value.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "battlefield",
                    bind: "$reanimated",
                },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$reanimated.manaValue" },
                },
            ],
        },
    ],
});

// Captain's Maneuver — {X}{R}{W} Instant. "The next X damage that would be
// dealt to target creature, planeswalker, or player this turn is dealt to
// another target creature, planeswalker, or player instead." (CR 614.9.)
//
// A REDIRECTION, not a prevention (CR 614.9 vs CR 615.1a): nothing is erased,
// the recipient is rewritten — which is why it is the `redirectDamage` Op
// rather than a seventh `preventDamage` mode, and why an unpreventable burn
// spell still gets moved while an unredirectable one does not.
//
// X is a POINTS budget: a damage event bigger than what is left splits, the
// budget landing on the second target and the remainder still on the first.
//
// CR 601.2c — the printed form is two instances of the word "target", the
// second marked "another". It is announced as ONE group of count 2 (the Magma
// Burst / Falling Timber precedent in this block) and leans on the engine's
// within-group distinctness, because `excludePriorTargets` merges earlier
// picks into `excludeInstanceIds` and so keeps only PERMANENT picks — on a
// recipient group spanning players the word would compile and not be honoured.
// CR 115.4 — "creature, planeswalker, or player" is the pre-errata spelling of
// "any target"; battles postdate every card that prints it, so the two denote
// the same set and the card announces the same `type: "any"` requirement.
export const captainsManeuver: CardDefinition = {
    id: "fb50813c-72df-49e7-bac5-e6e247649241", // APC 92
    rarity: "uncommon",
    name: "Captain's Maneuver",
    oracleText:
        "The next X damage that would be dealt to target creature, planeswalker, or player this turn is dealt to another target creature, planeswalker, or player instead.",
    manaCost: { X: "X", W: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 2 },
    effects: [
        {
            op: "redirectDamage",
            from: { target: 0 },
            to: { target: 1 },
            amount: { X: true },
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Squee's Revenge — a bounded coin-flip SERIES (issue #3813, ADR 0144).
// CR 107.1c — "Choose a number": any non-negative number is legal; zero flips
// nothing and draws nothing. CR 705.2 — the caster calls each flip and wins it
// when the call matches; `coinFlipSeries` stops after the chosen number of
// flips or at the first lost one, whichever comes first, and binds how many
// were made and how many were lost. "If you win all the flips" is zero losses
// (`lt 1`: a literal comparand is a positive integer)
// — so choosing 0 is a vacuous win of nothing — and "two cards for each flip"
// is twice the flips made.
export const squeesRevenge: CardDefinition = {
    id: "2b391ee3-c1cd-47bc-9540-977cbc32913e", // APC 123
    rarity: "uncommon",
    name: "Squee's Revenge",
    oracleText:
        "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.",
    manaCost: { X: 1, U: 1, R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "chooseNumber",
            player: "controller",
            prompt: "Choose a number.",
            bind: "$n",
        },
        {
            op: "coinFlipSeries",
            count: { ref: "$n" },
            untilLoss: true,
            bindFlips: "$flips",
            bindLosses: "$losses",
        },
        {
            op: "if",
            predicate: { left: { ref: "$losses" }, op: "lt", right: 1 },
            then: [
                {
                    op: "draw",
                    player: "controller",
                    count: { scaled: { value: { ref: "$flips" }, times: 2 } },
                },
            ],
        },
    ],
};

// Temporal Spring — "Put target permanent on top of its owner's library."
// CR 300.1 — "target permanent" of any type uses the full permanent-type set
// (incl. Land), as Vindicate does. CR 108.3 — the card goes to its OWNER's
// library, not the controller's: `moveZone` to `"library"` with no `position`
// puts it on TOP (issue #1726), the same shape as Hunting Drake.
// hand-tail: Put target permanent on top of its owner's library. (#4323)
export const temporalSpring: CardDefinition = {
    id: "b584dfd1-a56c-406e-8504-47ea136dc102", // APC 125
    rarity: "common",
    name: "Temporal Spring",
    oracleText: "Put target permanent on top of its owner's library.",
    manaCost: { X: 1, G: 1, U: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
    effects: [{ op: "moveZone", target: { target: 0 }, to: "library" }],
};

// Putrid Warrior — {W}{B} 2/2 Zombie Soldier Warrior. "Whenever this creature
// deals damage, choose one — • Each player loses 1 life. • Each player gains
// 1 life." (CR 603.2 damage trigger, CR 700.2b modal triggered ability, CR
// 119.3 life change for every player via `forEach { set: "players" }`.)
//
// Built by hand rather than through `damageDealtTrigger`: the factory has no
// `modes` member, and the mode is announced as the ability goes on the stack
// (CR 700.2b), not chosen at resolution. Any damage — combat or not, to any
// recipient — fires it, so `matches` gates on the source alone.
// hand-tail: Whenever this creature deals damage, choose one — • Each player loses 1 life. • Each player gains 1 life. (#4339)
export const putridWarrior: CardDefinition = {
    id: "17fce298-3338-4f41-8156-ab6322951a76", // APC 117
    rarity: "common",
    name: "Putrid Warrior",
    oracleText:
        "Whenever this creature deals damage, choose one —\n• Each player loses 1 life.\n• Each player gains 1 life.",
    manaCost: { W: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Soldier", "Warrior"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "putrid-warrior-damage",
            oracleText:
                "Whenever this creature deals damage, choose one — • Each player loses 1 life. • Each player gains 1 life.",
            event: "DAMAGE_DEALT",
            matches: (event, self) =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id,
            modes: [
                {
                    id: "each-player-loses-1",
                    label: "Each player loses 1 life",
                    oracleText: "Each player loses 1 life.",
                    effects: [
                        {
                            op: "forEach",
                            select: { set: "players" },
                            effects: [
                                {
                                    op: "loseLife",
                                    player: { ref: "$each" },
                                    amount: 1,
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "each-player-gains-1",
                    label: "Each player gains 1 life",
                    oracleText: "Each player gains 1 life.",
                    effects: [
                        {
                            op: "forEach",
                            select: { set: "players" },
                            effects: [
                                {
                                    op: "gainLife",
                                    player: { ref: "$each" },
                                    amount: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// Quicksilver Dagger — {1}{U}{R} Enchantment — Aura. "Enchant creature.
// Enchanted creature has '{T}: This creature deals 1 damage to target player
// or planeswalker. You draw a card.'" (CR 613.1f layer-6 ability grant; CR
// 602.2 the granted ability is activated by the enchanted creature's
// controller, so "You" is that player; CR 120.1 the enchanted creature is the
// damage source, hence `source: $source`.)
//
// The granted ability lives on `grantTemplates[]` and an `activated-grant`
// static pushes it onto the host (the Mystic Might shape). Built by hand: the
// grammar has no rule for a granted quoted ability that damages and draws.
// hand-tail: Enchanted creature has "{T}: This creature deals 1 damage to target player or planeswalker. You draw a card." (#4340)
export const quicksilverDagger: CardDefinition = {
    id: "83c74012-6060-4fad-aa73-6e6afd33c482", // APC 118
    rarity: "common",
    name: "Quicksilver Dagger",
    oracleText:
        'Enchant creature\nEnchanted creature has "{T}: This creature deals 1 damage to target player or planeswalker. You draw a card."',
    manaCost: { U: 1, R: 1, X: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "quicksilver-dagger-ping-draw",
        },
    ],
    grantTemplates: [
        {
            id: "quicksilver-dagger-ping-draw",
            oracleText:
                "{T}: This creature deals 1 damage to target player or planeswalker. You draw a card.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: ["player", "Planeswalker"], count: 1 },
            effects: [
                {
                    op: "dealDamage",
                    amount: 1,
                    to: { target: 0 },
                    source: { ref: "$source" },
                },
                { op: "draw", player: "controller", count: 1 },
            ],
        },
    ],
};

// Suffocating Blast — {1}{U}{U}{R} Instant. "Counter target spell and
// Suffocating Blast deals 3 damage to target creature." (CR 701.6a counter,
// CR 120.1 damage, CR 601.2c two INDEPENDENT target groups — one spell, one
// creature — the Plague Spores `additionalTargetRequirements` precedent; CR
// 608.2b a target that became illegal is skipped while the other still
// resolves.) Damage source defaults to the resolving spell itself.
// hand-tail: Counter target spell and {self} deals 3 damage to target creature. (#4341)
export const suffocatingBlast: CardDefinition = {
    id: "c2a70297-2a7b-4a0c-ace5-cd61bfe6dafd", // APC 124
    rarity: "rare",
    name: "Suffocating Blast",
    oracleText:
        "Counter target spell and Suffocating Blast deals 3 damage to target creature.",
    manaCost: { X: 1, U: 2, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    additionalTargetRequirements: [{ type: "Creature", count: 1 }],
    effects: [
        { op: "counter", target: { target: 0 } },
        { op: "dealDamage", amount: 3, to: { target: 1 } },
    ],
};

// hand-tail: Creatures can't block this turn. (#4473)
// Order // Chaos — {3}{W} // {2}{R}, Instant // Instant. "Exile target
// attacking creature." // "Creatures can't block this turn." CR 709.4b makes
// it a GOLD card (white AND red, mana value 6), so it lives here.
//
// ORDER is one `exile` over an announced attacking creature — the Giant Trap
// Door Spider target shape (`combatRoleFilter: "attacking"`).
//
// CHAOS is `forEach` over every creature on EVERY player's battlefield (no
// `controller` = both battlefields) and one `restrictCombat` "cant-block" per
// member, the same per-permanent flag Manacles of Decay writes (CR 509.1a).
// The flag clears at cleanup (CR 514.2), which is the "this turn" duration.
//
// Divergence: CR 611.2c makes "creatures can't block" a rules-modifying effect
// (no characteristic changes), so it must also bind a creature that enters
// after resolution; `forEach` freezes its member set at resolution, so a
// creature with flash that enters before blockers can still block.
// tracked-by: #4726
export const orderChaos: CardDefinition = defineSplitCard({
    id: "14e4f5a4-b1ea-4816-b2d7-cf148468a388",
    rarity: "uncommon",
    oracleText:
        "Exile target attacking creature.\nCreatures can't block this turn.",
    halves: [
        {
            name: "Order",
            manaCost: { X: 3, W: 1 },
            types: ["Instant"],
            oracleText: "Exile target attacking creature.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
        {
            name: "Chaos",
            manaCost: { X: 2, R: 1 },
            types: ["Instant"],
            oracleText: "Creatures can't block this turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "restrictCombat",
                            restriction: "cant-block",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
});
