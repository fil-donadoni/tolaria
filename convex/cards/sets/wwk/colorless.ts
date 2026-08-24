// wwk (Worldwake) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    PermanentView,
} from "../../types";

// Creeping Tar Pit — the manland cycle (CR 611.1 animate). DSL-first (ADR
// 0045): the `animate` Op (issue #1317) skins `animateAsCreature` and the
// `restrictCombat` Op's evasion `restriction: "cant-be-blocked"` (CR 509.1b)
// skins `setCantBeBlockedThisTurn` — the whole ability is now `effects[]`, no
// `resolve()`.
// The colour clause ("blue and black") is `animate`'s `colors` field (issue
// #1872) — a layer-5 colour SET (CR 613.1e) applied through the same
// `setColorOverride` primitive the `setColor` Op skins, so CR 105.3's "the new
// color replaces all previous colors" holds and the land reads blue+black to
// protection / colour hosers exactly while it is animated. Vintage Cube free
// tranche (issue #675, ADR 0041).
export const creepingTarPit: CardDefinition = {
    id: "0f427f0b-034c-4821-8758-e395c0042d8a",
    rarity: "rare",
    name: "Creeping Tar Pit",
    oracleText:
        "This land enters tapped.\n{T}: Add {U} or {B}.\n{1}{U}{B}: Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land. It can't be blocked this turn.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "creeping-tar-pit-mana",
            oracleText: "{T}: Add {U} or {B}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaChoices: [{ U: 1 }, { B: 1 }],
        },
        {
            id: "creeping-tar-pit-animate",
            oracleText:
                "{1}{U}{B}: Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land. It can't be blocked this turn.",
            cost: { mana: { X: 1, U: 1, B: 1 } },
            useStack: true,
            animatesSelf: true,
            // DSL-first (ADR 0045): the `animate` Op (CR 208.2/611.1, issue
            // #1317) skins `animateAsCreature` (3/2 Elemental until end of
            // turn), then the `restrictCombat` Op's evasion `restriction:
            // "cant-be-blocked"` (CR 509.1b) → `setCantBeBlockedThisTurn` on
            // the same `$source`.
            effects: [
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 3,
                    toughness: 2,
                    subtype: "Elemental",
                    // CR 613.1e / 105.3 — "becomes a 3/2 BLUE AND BLACK
                    // Elemental creature"; reverts with the animation.
                    colors: ["U", "B"],
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "restrictCombat",
                    restriction: "cant-be-blocked",
                    target: { ref: "$source" },
                },
            ],
        },
    ],
};

// Celestial Colonnade — see Creeping Tar Pit's comment for the layer-5 colour
// clause (`animate`'s `colors`, CR 613.1e / 105.3).
//
// Migrated resolve()→effects[] (ADR 0045, PRD #795): the `animate` Op (CR
// 208.2/611.1, issue #1317) is a thin declarative skin over the exact
// `animateAsCreature` call this closure made (4/4 base P/T, Elemental
// subtype, until end of turn). Flying/vigilance are NOT folded into
// `animate`'s own `grantedAbilities` param — that param grants PERMANENTLY
// (not spliced back out at `duration`, unlike a plain `grantAbility` Op call;
// see `AnimateSpec.grantedAbilities`'s doc), which would diverge from the
// original two `ctx.grantStaticAbility(source, ability, { phase:
// "end-of-turn" })` calls that DO expire at end of turn. Two separate
// `grantAbility` Ops (CR 611.2a/613.1f, issue #843), each carrying its own
// `duration: { phase: "end-of-turn" }`, reproduce that exactly.
export const celestialColonnade: CardDefinition = {
    id: "f6929259-2903-4f6f-9b06-42048fd55c6a",
    rarity: "rare",
    name: "Celestial Colonnade",
    oracleText:
        "This land enters tapped.\n{T}: Add {W} or {U}.\n{3}{W}{U}: Until end of turn, this land becomes a 4/4 white and blue Elemental creature with flying and vigilance. It's still a land.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "celestial-colonnade-mana",
            oracleText: "{T}: Add {W} or {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }],
        },
        {
            id: "celestial-colonnade-animate",
            oracleText:
                "{3}{W}{U}: Until end of turn, this land becomes a 4/4 white and blue Elemental creature with flying and vigilance. It's still a land.",
            cost: { mana: { X: 3, W: 1, U: 1 } },
            useStack: true,
            animatesSelf: true,
            effects: [
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 4,
                    toughness: 4,
                    subtype: "Elemental",
                    // CR 613.1e / 105.3 — "becomes a 4/4 WHITE AND BLUE
                    // Elemental creature"; reverts with the animation.
                    colors: ["W", "U"],
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    ability: "flying",
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    ability: "vigilance",
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Everflowing Chalice — "Multikicker {2}. This artifact enters with a charge
// counter on it for each time it was kicked. {T}: Add {C} for each charge
// counter on this artifact." (CR 702.33e Multikicker.) The kicker capability
// tallies each payment on the stack item; `entersWith.counters` count "kicker"
// (CR 122.1 / 614.1c) reads that tally as it enters. The mana ability scales
// its {C} output with the live charge count via the board-conditional
// `manaAmount` hook — the same primitive Gaea's Cradle / the Urza land trio use
// (`convex/gre/constants.ts` getDynamicManaProduced), counting the source's own
// counters instead of the battlefield. Vintage Cube Kicker cluster (#692).
export const everflowingChalice: CardDefinition = {
    id: "1fdcc0c3-4029-4fc3-a486-5d7f45c910bd",
    rarity: "uncommon",
    name: "Everflowing Chalice",
    oracleText:
        "Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)\nThis artifact enters with a charge counter on it for each time it was kicked.\n{T}: Add {C} for each charge counter on this artifact.",
    manaCost: {},
    types: ["Artifact"],
    kickers: [
        {
            id: "kicker",
            description: "Multikicker {2}",
            mana: { X: 2 },
            multi: true,
        },
    ],
    entersWith: { counters: [{ type: "charge", count: "kicker" }] },
    activatedAbilities: [
        {
            id: "everflowing-chalice-mana",
            oracleText:
                "{T}: Add {C} for each charge counter on this artifact.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 1 },
            manaAmount: (source: PermanentView) => ({
                C: source.counters?.charge ?? 0,
            }),
        },
    ],
};
