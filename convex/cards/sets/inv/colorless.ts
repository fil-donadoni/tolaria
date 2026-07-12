// inv (Invasion) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Colourless artifacts (no coloured
// cost) live here per the colour-split convention.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    Color,
    GameEvent,
    SpellContext,
    StaticEffectContext,
} from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { firstBlockerOf } from "../../abilities/triggers/rampageTrigger";
import {
    hasNonManaActivatedAbility,
    untapRestriction,
} from "../../abilities/static/untapRestriction";

// Tsabo's Web — {2} Artifact. "When this artifact enters, draw a card. Each
// land with an activated ability that isn't a mana ability doesn't untap during
// its controller's untap step." (Premodern-legal utility-land hoser, PRD #979.)
//
// Part (a) — the ETB cantrip is a self-scoped `enteredTrigger` running a single
// `draw` Op (CR 603.6a, CR 121.1), DSL-first (ADR 0045).
//
// Part (b) — the untap lock is a continuous `untap-restriction` static effect
// (CR 502.1). Its target set — "each land with an activated ability that isn't a
// mana ability" — depends on the land's card DEFINITION (its
// `activatedAbilities`), which `PermanentFilter` doesn't carry, so it uses the
// `dynamicMatch` refinement: the base `filter` scopes to lands, and
// `hasNonManaActivatedAbility` (a non-mana ability is `useStack: true`,
// CR 605.1a — NO tap-cost requirement, so no-{T} animate creaturelands like
// Creeping Tar Pit are caught) selects the qualifying ones at untap-collection
// time. `maxUntap: 0` makes it a hard skip — matching lands cannot untap while
// Tsabo's Web is in play (mana-only lands untap normally).
export const tsabosWeb: CardDefinition = {
    id: "0dee69f8-cceb-41b9-a0ee-6b2ac9f4bad9",
    rarity: "rare",
    name: "Tsabo's Web",
    oracleText:
        "When this artifact enters, draw a card.\nEach land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "tsabos-web-etb-draw",
            oracleText: "When this artifact enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    staticEffects: [
        untapRestriction({
            id: "tsabos-web-untap-lock",
            oracleText:
                "Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.",
            filter: { types: "Land" },
            maxUntap: 0,
            dynamicMatch: (_candidate, def) => hasNonManaActivatedAbility(def),
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Power Armor — {4} Artifact. "Domain — {3}, {T}: Target creature gets
// +1/+1 until end of turn for each basic land type among lands you
// control." (CR 605 activated ability, CR 611.1 temporary P/T, CR 702
// preamble Domain ability word, issue #1066.) The `pump` Op's `power`/
// `toughness` are the ninth EffectValue grammar member `{ domain: { of } }`
// — no arithmetic needed, a straight reuse of the same value member Tribal
// Flames uses for `dealDamage`.
export const powerArmor: CardDefinition = {
    id: "ed1981dd-c0f3-4e9d-a1f1-8bea823326ef",
    name: "Power Armor",
    rarity: "uncommon",
    oracleText:
        "Domain — {3}, {T}: Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "power-armor-pump",
            oracleText:
                "{3}, {T}: Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: { domain: { of: "controller" } },
                    toughness: { domain: { of: "controller" } },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (issue #1074, parent PRD #1063) — the remaining 11 of 13
// colourless INV cards (Tsabo's Web shipped via #1023; Power Armor above via
// the Domain cluster #1066). Every active card below composes
// already-exercised Ops/keywords/cost shapes: `manaChoices` "any color" mana
// abilities (City of Brass/Black Lotus shape), `sacrificeFilter` cost +
// `optionChoice` colour picker (Devouring Strossus + Addle, both already in
// this same set), the search-library→hand→shuffle tutor template
// (Manipulate Fate, this set), `cost-modifier` (Mana Matrix/Planar Gate), and
// the `untapRestriction` `dynamicMatch` refinement (Tsabo's Web above) — no
// hand-written test required beyond the catalogue-wide `validateEffectScript`
// sweep + `effectScriptSmoke` generator (per-Op regime, ADR 0045/0046),
// except where noted per-card below (a new trigger-math shape and a
// resolve()-justified ETB colour choice each get a dedicated test).
//
// Chromatic Sphere is deferred as a tracked stub — see its comment.
// ─────────────────────────────────────────────────────────────────────────

// Alloy Golem — {6} Artifact Creature — Golem 4/4. "As this creature enters,
// choose a color. This creature is the chosen color. (It's still an
// artifact.)" (CR 105.2 / 613.1e layer 5 colour-set; CR 603.6b "as ~ enters,
// choose".)
//
// resolve() justification (ADR 0045 DSL-first): the declarative `setColor`
// Op is `status: "planned"` in the Mechanics Registry (not yet registered),
// so the colour-choice-then-set stays imperative here, mirroring Alchor's
// Tomb (`leg/colorless.ts`) exactly — `requestOptionChoice` for the pick,
// `setColorOverride` (no `duration` = indefinite) to apply it. The trigger
// fires on `PERMANENT_ENTERED` (CR 603.6a); by resolve time the entering
// permanent is already on the battlefield, so `setColorOverride` (which
// requires `findOnBattlefield`) resolves it — the same "as ~ enters, choose"
// convention Black Vise's `setChosenPlayer` already uses in this codebase.
export const alloyGolem: CardDefinition = {
    id: "1fb6d6a1-9d71-405b-9c93-1a7f06c67abd",
    rarity: "uncommon",
    name: "Alloy Golem",
    oracleText:
        "As this creature enters, choose a color. This creature is the chosen color. (It's still an artifact.)",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        enteredTrigger({
            id: "alloy-golem-choose-color",
            oracleText:
                "As this creature enters, choose a color. This creature is the chosen color.",
            scope: "self",
            resolve: (ctx: SpellContext, _event, entered) => {
                const pick = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "alloy-golem-color",
                    prompt: "Choose a color.",
                    options: [
                        { id: "W", label: "White" },
                        { id: "U", label: "Blue" },
                        { id: "B", label: "Black" },
                        { id: "R", label: "Red" },
                        { id: "G", label: "Green" },
                    ],
                });
                if (pick === undefined) return; // suspended — wait for the pick
                ctx.setColorOverride({ type: "permanent", id: entered.id }, [
                    pick as Color,
                ]);
            },
        }),
    ],
};

// Chromatic Sphere — {1} Artifact. "{1}, {T}, Sacrifice this artifact: Add
// one mana of any color. Draw a card." (CR 605.1a — a mana ability MAY carry
// a non-mana additional effect and still skip the stack, the Wall of Roots
// precedent; here the additional effect is a draw.)
//
// DEFERRED (tracked-by: #1093) — NOT a card-shaped `resolve()` hack: the
// engine's `useStack: false` mana-ability commit path (`convex/game.ts`
// `tapUntap` / the shared payment-tap helper) invokes `ability.effect`
// through a deliberately narrow `ActivatedAbilityContext` exposing ONLY
// `addMana` (see the comment at the granted-ability mana-ability call site —
// "a minimal context exposing only addMana"). There is no rider for "draw a
// card on tap" in the existing rider family
// (`dealsDamageToControllerOnTap` / `dealsDamageToControllerOnColoredTap` /
// `putDepletionCounterOnTap` / `armsDelayedTriggerOnTap`), so this genuinely
// isn't buildable with already-shipped capability. Chromatic STAR
// (`tsp/colorless.ts`) is NOT a substitute template: Star's actual (later,
// different) Oracle text splits the draw into a separate "leaves the
// battlefield to a graveyard" trigger, which would incorrectly draw a card
// if Sphere were destroyed by unrelated removal instead of sacrificed for
// its own ability — a silent rules deviation, not a simplification. Issue
// #1093 tracks adding a `drawsCardOnTap` rider (mirroring the existing rider
// family) to unblock this card.
//
// export const chromaticSphere: CardDefinition = {
//     id: "920cd17f-9274-443e-906f-c9904f0658d5",
//     rarity: "uncommon",
//     name: "Chromatic Sphere",
//     oracleText:
//         "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card.",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
//     activatedAbilities: [
//         {
//             id: "chromatic-sphere-mana",
//             oracleText:
//                 "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card.",
//             cost: { mana: { X: 1 }, tap: true, sacrifice: true },
//             useStack: false,
//             effect: (ctx) => ctx.addMana({ W: 1 }),
//             manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
//             drawsCardOnTap: 1, // blocked on #1093
//         },
//     ],
// };

// Juntu Stakes — {2} Artifact. "Creatures with power 1 or less don't untap
// during their controllers' untap steps." (CR 502.1 untap-restriction, same
// factory as Tsabo's Web/Meekstone above.) `PermanentFilter` only has
// LOWER-bound power/toughness comparisons (`powerAtLeast`/`toughnessAtLeast`,
// CR 613 layer 7c) — no upper bound — so "1 or less" reads the candidate's
// live effective power directly via `dynamicMatch`, the same per-candidate
// refinement hook Tsabo's Web uses above (there keyed on the card
// definition; here keyed on live P/T instead).
export const juntuStakes: CardDefinition = {
    id: "3ab7cf53-f62d-47e1-af70-ab12be0d22e2",
    rarity: "rare",
    name: "Juntu Stakes",
    oracleText:
        "Creatures with power 1 or less don't untap during their controllers' untap steps.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticEffects: [
        untapRestriction({
            id: "juntu-stakes-untap-lock",
            oracleText:
                "Creatures with power 1 or less don't untap during their controllers' untap steps.",
            filter: { types: "Creature" },
            maxUntap: 0,
            dynamicMatch: (candidate) => (candidate.power ?? 0) <= 1,
        }),
    ],
};

// Lotus Guardian — {7} Artifact Creature — Dragon 4/4. "Flying\n{T}: Add one
// mana of any color." (CR 702.9b flying; CR 605.1a "any color" mana ability —
// the City of Brass / Celestial Prism `manaChoices` shape.)
export const lotusGuardian: CardDefinition = {
    id: "ddfc6396-5377-4ab3-9c10-8abcdeae2aa1",
    rarity: "rare",
    name: "Lotus Guardian",
    oracleText: "Flying\n{T}: Add one mana of any color.",
    manaCost: { X: 7 },
    types: ["Artifact", "Creature"],
    subtypes: ["Dragon"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "lotus-guardian-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Phyrexian Altar — {3} Artifact. "Sacrifice a creature: Add one mana of any
// color." (CR 602.1/118.5 filtered-sacrifice cost — same `sacrificeFilter`
// shape as Devouring Strossus above / Ashnod's Altar / Atog / Priest of
// Yawgmoth; per the CR 605.1a deviation note in `atq/red.ts`, a
// filtered-sacrifice cost needs a player choice the instant tap-mana path
// can't model, so it's `useStack: true`.) The "any color" pick can't ride
// `manaChoices` — that shape is reserved for `useStack: false` mana
// abilities (`gre/rules.ts` / `gre/constants.ts` gate on `!useStack`) — so it
// composes the same "choose a color" DSL skin Addle uses in this set (a
// 5-mode `optionChoice`), each mode a bare `addMana` for that colour — both
// Ops already exercised catalogue-wide (per-Op regime, no hand-written test
// required).
export const phyrexianAltar: CardDefinition = {
    id: "25158cd5-749b-408c-9ab1-0f83e38730f7",
    rarity: "rare",
    name: "Phyrexian Altar",
    oracleText: "Sacrifice a creature: Add one mana of any color.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "phyrexian-altar-mana",
            oracleText: "Sacrifice a creature: Add one mana of any color.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            effects: [
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Choose a color.",
                    modes: [
                        {
                            label: "White",
                            effects: [{ op: "addMana", mana: { W: 1 } }],
                        },
                        {
                            label: "Blue",
                            effects: [{ op: "addMana", mana: { U: 1 } }],
                        },
                        {
                            label: "Black",
                            effects: [{ op: "addMana", mana: { B: 1 } }],
                        },
                        {
                            label: "Red",
                            effects: [{ op: "addMana", mana: { R: 1 } }],
                        },
                        {
                            label: "Green",
                            effects: [{ op: "addMana", mana: { G: 1 } }],
                        },
                    ],
                },
            ],
        },
    ],
};

// Phyrexian Lens — {3} Artifact. "{T}, Pay 1 life: Add one mana of any
// color." (CR 605.1a mana ability with a life-payment cost — the Mana
// Confluence / Horizon-land shape — combined with the `manaChoices` "any
// color" picker.)
export const phyrexianLens: CardDefinition = {
    id: "6ec9a91d-7af0-44a8-839f-fb9960be0ddd",
    rarity: "rare",
    name: "Phyrexian Lens",
    oracleText: "{T}, Pay 1 life: Add one mana of any color.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "phyrexian-lens-mana",
            oracleText: "{T}, Pay 1 life: Add one mana of any color.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Planar Portal — {6} Artifact. "{6}, {T}: Search your library for a card,
// put that card into your hand, then shuffle." (CR 701.20a search library —
// no reveal clause here, unlike Spellseeker/Manipulate Fate — reuse of the
// same search→moveZone(hand)→shuffle tutor template this set already ships
// (Manipulate Fate), just with no `filter` (any card) and `count: 1`.)
export const planarPortal: CardDefinition = {
    id: "24315eaa-ef55-4fd6-9145-e75b3de6f492",
    rarity: "rare",
    name: "Planar Portal",
    oracleText:
        "{6}, {T}: Search your library for a card, put that card into your hand, then shuffle.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "planar-portal-tutor",
            oracleText:
                "{6}, {T}: Search your library for a card, put that card into your hand, then shuffle.",
            cost: { tap: true, mana: { X: 6 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                    bind: "$picked",
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
        },
    ],
};

// Sparring Golem — {3} Artifact Creature — Golem 2/2. "Whenever this creature
// becomes blocked, it gets +1/+1 until end of turn for each creature blocking
// it." (CR 509.1h becomes-blocked trigger.)
//
// The non-Rampage sibling of `rampageTrigger` (CR 702.23): same event
// (`BLOCKERS_CONFIRMED`), same once-per-becomes-blocked dedupe (the exported
// `firstBlockerOf`), same `getBlockersByAttacker` + `addTemporaryPTBuff`
// primitives — but EVERY blocker counts (no "beyond the first" subtraction),
// so this isn't the Rampage keyword and doesn't share its factory or
// `staticAbilities` entry. resolve() justification (ADR 0045): no
// `EffectValue` member counts "creatures blocking this creature" (checked
// against the full grammar in `mechanicsRegistry.ts` / `pump`'s own registry
// note) — a small dedicated trigger mirrors the shipped `rampageTrigger`
// shape exactly, reusing its exported dedupe helper rather than duplicating
// it.
export const sparringGolem: CardDefinition = {
    id: "d829d9de-83fa-4feb-8efc-0075315163c6",
    rarity: "uncommon",
    name: "Sparring Golem",
    oracleText:
        "Whenever this creature becomes blocked, it gets +1/+1 until end of turn for each creature blocking it.",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "sparring-golem-becomes-blocked",
            oracleText:
                "Whenever this creature becomes blocked, it gets +1/+1 until end of turn for each creature blocking it.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event: GameEvent, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                if (event.attackerId !== self.id) return false;
                const first = firstBlockerOf(state, self.id);
                if (first === undefined) return true;
                return event.blockerId === first;
            },
            resolve: (ctx: SpellContext, event: GameEvent) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                const attackerId = ctx.sourceInstanceId;
                // CR 509.1h — count blockers AT RESOLUTION, only those still on
                // the battlefield (mirrors rampageTrigger's live-blocker filter).
                const live = new Set<string>();
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid)) live.add(id);
                }
                const blockers = (
                    ctx.getBlockersByAttacker()[attackerId] ?? []
                ).filter((id) => live.has(id));
                if (blockers.length === 0) return;
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: attackerId },
                    blockers.length,
                    blockers.length,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Tek — {5} Artifact Creature — Dragon 2/2. "This creature gets +0/+2 as long
// as you control a Plains, has flying as long as you control an Island, gets
// +2/+0 as long as you control a Swamp, has first strike as long as you
// control a Mountain, and has trample as long as you control a Forest." (CR
// 613.1c/1d conditional P/T + ability grants gated on board state.)
//
// P/T clauses (Plains/Swamp) — `pt-cda` `compute` with full board access,
// the Kird Ape / Sedge Troll pattern, summed into one CDA.
//
// Keyword clauses (Island/Mountain/Forest) — SIMPLIFICATION (flagged, same
// treatment as Woolly Mammoths, `ice/green.ts`): `keyword-grant`'s `applies`
// predicate (`StaticEffectContext`) exposes only per-card characteristic
// helpers (`getColors`/`isCreature`/`hasSubtype`/...) — no battlefield
// accessor — so a continuous, re-evaluated "as long as you control a <land
// type>" keyword gate isn't expressible via `keyword-grant`. Flying / first
// strike / trample are granted UNCONDITIONALLY as plain `staticAbilities` — a
// strict superset of the printed behaviour (Tek is played in five-colour
// shells where all five basics are online in practice). A board-aware
// keyword-grant predicate would track this exactly; flagged for the same
// follow-up as Woolly Mammoths.
export const tek: CardDefinition = {
    id: "c1f38104-a699-4bb9-930a-699f7bbc338a",
    rarity: "rare",
    name: "Tek",
    oracleText:
        "This creature gets +0/+2 as long as you control a Plains, has flying as long as you control an Island, gets +2/+0 as long as you control a Swamp, has first strike as long as you control a Mountain, and has trample as long as you control a Forest.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Dragon"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "first strike", "trample"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                const controls = (subtype: string) =>
                    state.players.some((p) =>
                        p.battlefield.some(
                            (c) =>
                                c.controllerId === source.controllerId &&
                                c.subtypes.includes(subtype)
                        )
                    );
                let power = 0;
                let toughness = 0;
                if (controls("Plains")) toughness += 2;
                if (controls("Swamp")) power += 2;
                return { power, toughness };
            },
        },
    ],
};

// Urza's Filter — {4} Artifact. "Multicolored spells cost {2} less to cast."
// (CR 601.2f cost-modifier, generic-only reduction; CR 202.2 multicolored =
// two or more colors — the same `ctx.getColors(card).length >= 2` test
// Rewards of Diversity's spell-cast trigger uses elsewhere in this set,
// applied here at the cost-modifier site instead. Unlike Mana Matrix/Planar
// Gate, the discount is NOT scoped to its controller — it reduces EVERY
// player's multicolored spells — so `appliesToSpell` has no `controllerId`
// check.)
export const urzasFilter: CardDefinition = {
    id: "680c75b1-e766-40be-84d7-2332047bb3de",
    rarity: "rare",
    name: "Urza's Filter",
    oracleText: "Multicolored spells cost {2} less to cast.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx: StaticEffectContext) =>
                ctx.getColors(card).length >= 2,
            costReduction: { X: 2 },
        },
    ],
};

// Archaeological Dig — Land. "{T}: Add {C}.\n{T}, Sacrifice this land: Add
// one mana of any color." (CR 605.1a fixed-colorless tap ability + a
// self-sacrifice "any color" mana ability — the Black Lotus/Chromatic Star
// `manaChoices` shape — modeled as two separate tap abilities, the same
// two-ability land shape Strip Mine already ships in this codebase.)
export const archaeologicalDig: CardDefinition = {
    id: "35f55af0-5a46-4900-b3d0-ca796b710e07",
    rarity: "uncommon",
    name: "Archaeological Dig",
    oracleText:
        "{T}: Add {C}.\n{T}, Sacrifice this land: Add one mana of any color.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "archaeological-dig-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "archaeological-dig-sac",
            oracleText: "{T}, Sacrifice this land: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
