// PLS (Planeshift) — colorless cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    CardPrint,
    ManaCost,
    MayPayCost,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { makeTapForMana } from "../../abilities";

// CR 117.3a / 701.21 / 400.7 — the Planeshift "Lair" cycle (5 tri-colour tap
// lands: Crosis's Catacombs, Darigaaz's Caldera, Dromar's Cavern, Rith's
// Grove, Treva's Ruins). Each reads "When this land enters, sacrifice it
// unless you return a non-Lair land you control to its owner's hand." — a
// may-pay PERMANENT leg (`action: "return"`, ADR 0079 `CostLegs`, issue
// #1933) with a "not $paid" sacrifice fallback (CR 118 "unless"). Whether to
// pay, and which land pays, are both an explicit player choice routed through
// the unified `sacrificeChoice` layer (`mayPay` suspends for the Pay/Skip
// decision; accepting opens the return-leg picker over the legal lands) —
// never auto-picked, even with exactly one legal land to return.
//
// `excludeSubtypes: "Lair"` (CR 205.3i lists Lair among the recognized land
// types) is the "non-Lair" restriction: the filter runs over the payer's
// WHOLE battlefield at payment time, so every OTHER Lair the player already
// controls is excluded too — a Lair can never pay for its own or a sibling
// Lair's survival.
const LAIR_ORACLE_TEXT =
    "When this land enters, sacrifice it unless you return a non-Lair land you control to its owner's hand.";

const RETURN_A_NON_LAIR_LAND: MayPayCost = {
    permanent: {
        action: "return",
        filter: { types: "Land", excludeSubtypes: "Lair" },
        count: 1,
    },
};

function lairEntersUnlessReturned(triggerId: string) {
    return enteredTrigger({
        id: triggerId,
        oracleText: LAIR_ORACLE_TEXT,
        scope: "self",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                cost: RETURN_A_NON_LAIR_LAND,
                prompt: "Return a non-Lair land you control to its owner's hand, or sacrifice this land?",
                bind: "$paid",
            },
            {
                op: "if",
                // CR 118 — the "unless" consequence: decline and the source is
                // sacrificed.
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "sacrifice", target: { ref: "$source" } }],
            },
        ],
    });
}

/** `{T}: Add <colour>, <colour>, or <colour>.` — no `effect` closure needed;
 *  the engine derives `addMana` from `manaChoices` directly (painland /
 *  depletion-dual precedent). */
function lairManaAbility(
    id: string,
    oracleText: string,
    manaChoices: [ManaCost, ManaCost, ManaCost]
) {
    return {
        id,
        oracleText,
        cost: { tap: true },
        useStack: false,
        manaChoices,
    };
}

export const crosissCatacombs: CardDefinition = {
    id: "7caad74f-c0d0-4eca-94be-b89a2c9a3980",
    name: "Crosis's Catacombs",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {U}, {B}, or {R}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("crosiss-catacombs-etb")],
    activatedAbilities: [
        lairManaAbility(
            "crosiss-catacombs-mana",
            "{T}: Add {U}, {B}, or {R}.",
            [{ U: 1 }, { B: 1 }, { R: 1 }]
        ),
    ],
};

export const darigaazsCaldera: CardDefinition = {
    id: "752f6f0c-af30-4937-b4a7-48f493e007a0",
    name: "Darigaaz's Caldera",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {B}, {R}, or {G}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("darigaazs-caldera-etb")],
    activatedAbilities: [
        lairManaAbility(
            "darigaazs-caldera-mana",
            "{T}: Add {B}, {R}, or {G}.",
            [{ B: 1 }, { R: 1 }, { G: 1 }]
        ),
    ],
};

export const dromarsCavern: CardDefinition = {
    id: "85f10cee-6a63-438e-a9df-6b902dd025b8",
    name: "Dromar's Cavern",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {W}, {U}, or {B}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("dromars-cavern-etb")],
    activatedAbilities: [
        lairManaAbility("dromars-cavern-mana", "{T}: Add {W}, {U}, or {B}.", [
            { W: 1 },
            { U: 1 },
            { B: 1 },
        ]),
    ],
};

export const rithsGrove: CardDefinition = {
    id: "740fa25d-9c1f-44eb-9eb4-0dd514cb315a",
    name: "Rith's Grove",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {R}, {G}, or {W}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("riths-grove-etb")],
    activatedAbilities: [
        lairManaAbility("riths-grove-mana", "{T}: Add {R}, {G}, or {W}.", [
            { R: 1 },
            { G: 1 },
            { W: 1 },
        ]),
    ],
};

export const trevasRuins: CardDefinition = {
    id: "8bae2458-b54f-426a-ad40-13529a73c423",
    name: "Treva's Ruins",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {G}, {W}, or {U}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("trevas-ruins-etb")],
    activatedAbilities: [
        lairManaAbility("trevas-ruins-mana", "{T}: Add {G}, {W}, or {U}.", [
            { G: 1 },
            { W: 1 },
            { U: 1 },
        ]),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941).
// Star Compass and Meteor Crater offer a colour set that is neither fixed nor
// "any colour": it is derived from a described slice of the board and
// recomputed at every activation. Both declare an
// `ActivatedAbility.manaColorSource` descriptor (`convex/cards/types.ts`) —
// declarative data evaluated by the engine's single `boardDerivedManaChoices`
// authority (`gre/constants.ts`), which the castability probe, the auto-tap
// solver, the bot's payment planner and the client picker already read, so the
// restricted set is visible everywhere and never desyncs. The two exercise the
// descriptor's two orthogonal axes: WHICH permanents contribute (a filter) and
// HOW each yields a colour (`"produces"`, CR 106.4, vs `"isColor"`, CR 105.2).
// Third card of the family: Quirion Explorer (`pls/green.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Representative / fallback options (any single colour) for best-effort
 *  callers with no board snapshot. The `manaColorSource` descriptor overrides
 *  it wherever a board IS available — the same contract Fellwar Stone
 *  (`drk/colorless.ts`) established. */
const ANY_SINGLE_COLOR: ManaCost[] = [
    { W: 1 },
    { U: 1 },
    { B: 1 },
    { R: 1 },
    { G: 1 },
];

// Star Compass — {2} Artifact. "This artifact enters tapped. / {T}: Add one
// mana of any color that a basic land you control could produce."
// (CR 110.5b enters tapped; CR 605.1a mana ability, `useStack: false`;
// CR 106.4 "could produce" over the controller's own BASIC lands only —
// `supertypes: "Basic"` is read from the LIVE supertype set, so a
// non-basic dual never contributes.)
export const starCompass: CardDefinition = {
    id: "b1d0beb4-c3dd-4bb1-b49b-a48b2d4ad38d",
    rarity: "uncommon",
    name: "Star Compass",
    oracleText:
        "This artifact enters tapped.\n{T}: Add one mana of any color that a basic land you control could produce.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "star-compass-mana",
            oracleText:
                "{T}: Add one mana of any color that a basic land you control could produce.",
            cost: { tap: true },
            useStack: false,
            manaChoices: ANY_SINGLE_COLOR,
            manaColorSource: {
                filter: {
                    types: "Land",
                    supertypes: "Basic",
                    controllerRelation: "you",
                },
                colors: "produces",
            },
        },
    ],
};

// Meteor Crater — Land. "{T}: Choose a color of a permanent you control. Add
// one mana of that color." (CR 605.1a mana ability, `useStack: false`. The
// scope is EVERY permanent the controller has, not just lands, and the colour
// read is the permanent's OWN colour (CR 105.2 / 202.2, post-layer-5) rather
// than what it could produce — a Forest contributes nothing, a green creature
// contributes {G}. Meteor Crater itself is a colourless land, so it never
// contributes to its own list.)
export const meteorCrater: CardDefinition = {
    id: "043a2299-1cfc-4732-a10a-58c773b9992c",
    rarity: "rare",
    name: "Meteor Crater",
    oracleText:
        "{T}: Choose a color of a permanent you control. Add one mana of that color.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "meteor-crater-mana",
            oracleText:
                "{T}: Choose a color of a permanent you control. Add one mana of that color.",
            cost: { tap: true },
            useStack: false,
            manaChoices: ANY_SINGLE_COLOR,
            manaColorSource: {
                filter: { controllerRelation: "you" },
                colors: "isColor",
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// C8f — Random pick from the exile-by-source pile (CR 400.7 / 701.13, issue
// #1947). Skyship Weatherlight.
// ─────────────────────────────────────────────────────────────────────────

// Skyship Weatherlight — {4} Legendary Artifact. "When this enters, search
// your library for any number of artifact and/or creature cards, exile
// them, then shuffle. {4}, {T}: Choose a card at random that was exiled
// with Skyship Weatherlight. Put that card into its owner's hand."
//
// ETB (CR 603.6a self-ETB): the tutor `choice(kind:"search-library")` +
// `moveZone(cards, to:"exile")` composition (the Jester's Cap precedent,
// ice/colorless.ts) with an unbounded "any number" count — `count: { min:
// 0, max: Number.MAX_SAFE_INTEGER }` is clamped down to however many
// artifact/creature cards actually sit in the library by the `choice` Op's
// own availability clamp (`Math.min(op.count.max, available)`,
// interpreter.ts), the SAME "any number" idiom several resolve() cards
// already use via `peekLibraryTop(..., Number.MAX_SAFE_INTEGER)` — no
// sentinel/special-case needed (ADR 0045 "generalize, don't add"). `filter:
// { type: ["Artifact", "Creature"] }` is CR 205's "and/or" read as an OR
// within the field (Torsten's `lookDistribute` filter, dmc/multicolor.ts, same
// idiom). The new `linkToSource: true` flag (issue #1947) parametrizes the
// EXISTING `moveZone` `cards` shape rather than adding a second new Op: it
// stamps every exiled card with `exiledBySourceId` via `linkExileToSource`
// — the same CR 607 link `hideaway` already stamps for a single card,
// generalized here to an arbitrary-count tutor sweep. "Then shuffle" is the
// trailing `libraryLook`(shuffle) Op, matching every real tutor's ordering
// (search → exile → shuffle).
//
// ACTIVATED (CR 602.1): `{4}, {T}`, no sacrifice — the artifact stays on
// the battlefield to be reused. `randomExileToHand` (issue #1947, new Op)
// reads the linked pile via `SpellContext.pickRandomCardExiledWith(
// ctx.sourceInstanceId)` — the SAME `exiledBySourceId`-keyed pool
// `getCardsExiledWith` enumerates for Currency Converter's player-CHOSEN
// retrieval and `hideaway`'s cast-permission selector (issues #791/#783),
// generalized to a RANDOM pick — drawing uniformly from the game's seeded
// PRNG (mirrors `discardAtRandom`'s determinism precedent, so replays
// reproduce the same result) and puts the pick into ITS OWNER's hand (the
// modern-Oracle, errata-corrected destination — the 2001 printing said
// "your hand"; both mtgjson's `text` field and the 2004-10-04 ruling
// confirm "its owner's hand"). CR 400.7 / 607: the link is per-INSTANCE,
// keyed to THIS permanent's own id — Skyship Weatherlight leaving the
// battlefield does not RETURN the remaining exiled cards (2004-10-04
// ruling: "If this card leaves the battlefield, the remaining cards that
// were exiled don't come back"), and a second Skyship Weatherlight's own
// pile is entirely disjoint (each stamps its own `exiledBySourceId`).
//
// Departure does NOT clear the link (issue #2001, CR 113.7a / 608.2h — last
// known information; `randomExileToHand` is UNTARGETED, so CR 608.2b's
// target-legality re-check never runs for it): an activation already on the
// stack when this Weatherlight is destroyed/bounced in response still
// resolves against the pile it stamped, exactly like Isochron Scepter's
// imprint surviving the Scepter's own destruction. The link is instead
// dropped the moment THIS instance id next enters the battlefield
// (`clearExileLinksToEnteringSource`, `convex/gre/state.ts`) — that
// re-entry is the CR 400.7 "new object" that actually severs it, not the
// departure. An
// EMPTY pile is a CR 608.2b no-op — per the acceptance criterion's chosen
// disambiguation, the ability is still activatable (its mana/tap cost is
// still paid) but resolves with no effect, matching the same ruling that
// the initial search "may choose to not find anything."
export const skyshipWeatherlight: CardDefinition = {
    id: "63f5498b-bb12-48ec-811b-b52e45ffddaf", // PLS 133 (canonical art)
    rarity: "rare",
    name: "Skyship Weatherlight",
    oracleText:
        "When Skyship Weatherlight enters, search your library for any number of artifact and/or creature cards, exile them, then shuffle.\n{4}, {T}: Choose a card at random that was exiled with Skyship Weatherlight. Put that card into its owner's hand.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    triggeredAbilities: [
        enteredTrigger({
            id: "skyship-weatherlight-etb",
            oracleText:
                "When Skyship Weatherlight enters, search your library for any number of artifact and/or creature cards, exile them, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: ["Artifact", "Creature"] },
                    count: { min: 0, max: Number.MAX_SAFE_INTEGER },
                    prompt: "Search your library for any number of artifact and/or creature cards to exile.",
                    bind: "$found",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found" },
                    player: "controller",
                    from: "library",
                    to: "exile",
                    linkToSource: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "skyship-weatherlight-random",
            oracleText:
                "{4}, {T}: Choose a card at random that was exiled with Skyship Weatherlight. Put that card into its owner's hand.",
            cost: { mana: { X: 4 }, tap: true },
            useStack: true,
            effects: [{ op: "randomExileToHand" }],
        },
    ],
};

// Skyship Weatherlight — PLS 133★, the foil-only alternate-illustration
// variant printed in the SAME set (ADR 0014: one CardDefinition + one
// CardPrint per artwork). Rarity/mechanics are identical to the canonical
// print above; only the Scryfall art id differs.
export const skyshipWeatherlightAlt: CardPrint = {
    printId: "99791ef7-ff51-4982-b0ef-55560f9577ff", // PLS 133★
    definitionId: skyshipWeatherlight.id,
    setCode: "pls",
    rarity: "rare",
};

// ─────────────────────────────────────────────────────────────────────────────
// PLS free tranche — colourless cards (#1954, parent PRD #1935): Forsaken
// City, Mana Cylix, Terminal Moraine. All three are already-exercised Ops
// (`does-not-untap` self keyword + `mayPay`/`tapUntap` upkeep pattern —
// Brass Man, arn/colorless.ts; `manaChoices: ANY_SINGLE_COLOR` — Star
// Compass, above; `choice`(search-library) + `moveZone`(tapped) + shuffle —
// Fabled Passage, eld/colorless.ts). No new Op, no `resolve()`.
// ─────────────────────────────────────────────────────────────────────────────

// Forsaken City — Land. "This land doesn't untap during your untap step. At
// the beginning of your upkeep, you may exile a card from your hand. If you
// do, untap this land. {T}: Add one mana of any color." Mirrors Brass Man's
// `does-not-untap` + upkeep may-pay-to-untap shape (arn/colorless.ts)
// exactly, with a HAND leg (`{ hand: { action: "exile", requirements: [{
// filter: {}, count: 1 }] } }`, ADR 0079 `CostLegs`) instead of a mana cost —
// the same hand-leg shape Formidable Speaker's "you may discard a card" uses
// (ecl/green.ts), substituting `action: "exile"` for `"discard"` (CR 701.13
// vs 701.9).
export const forsakenCity: CardDefinition = {
    id: "676703fe-bd80-413c-8704-1da5d3248b7e", // PLS 139
    rarity: "rare",
    name: "Forsaken City",
    oracleText:
        "This land doesn't untap during your untap step.\nAt the beginning of your upkeep, you may exile a card from your hand. If you do, untap this land.\n{T}: Add one mana of any color.",
    types: ["Land"],
    staticAbilities: ["does-not-untap"],
    triggeredAbilities: [
        phaseTrigger({
            id: "forsaken-city-untap-option",
            oracleText:
                "At the beginning of your upkeep, you may exile a card from your hand. If you do, untap this land.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: {
                        hand: {
                            action: "exile",
                            requirements: [{ filter: {}, count: 1 }],
                        },
                    },
                    prompt: "Exile a card from your hand to untap Forsaken City?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$source" },
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "forsaken-city-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            manaChoices: ANY_SINGLE_COLOR,
        },
    ],
};

// Mana Cylix — {1} Artifact. "{1}, {T}: Add one mana of any color." (Modern
// Oracle, verified via Scryfall — no "colours already spent this turn"
// restriction; that recollection was wrong. A plain unrestricted five-colour
// rock, the SAME `manaChoices: ANY_SINGLE_COLOR` shape Star Compass uses
// above, with no `manaColorSource` board restriction.)
export const manaCylix: CardDefinition = {
    id: "c6f95767-afda-4d74-bbd4-1b702eeae54b", // PLS 132
    rarity: "uncommon",
    name: "Mana Cylix",
    oracleText: "{1}, {T}: Add one mana of any color.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "mana-cylix-mana",
            oracleText: "{1}, {T}: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: false,
            manaChoices: ANY_SINGLE_COLOR,
        },
    ],
};

// Terminal Moraine — Land. "{T}: Add {C}.\n{2}, {T}, Sacrifice this land:
// Search your library for a basic land card, put that card onto the
// battlefield tapped, then shuffle." Mirrors Fabled Passage's fetch ability
// (eld/colorless.ts) exactly — `choice`(search-library, `supertype: "Basic"`)
// + `moveZone`(cards, `to: "battlefield"`, `tapped: true`) + `libraryLook`
// (shuffle) — with an added `{2}` mana leg on the activation cost.
export const terminalMoraine: CardDefinition = {
    id: "353a8ea8-3f1f-4f77-95bc-b09b96996285", // PLS 142
    rarity: "uncommon",
    name: "Terminal Moraine",
    oracleText:
        "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        makeTapForMana({
            id: "terminal-moraine-mana",
            oracleText: "{T}: Add {C}.",
            produces: { C: 1 },
        }),
        {
            id: "terminal-moraine-fetch",
            oracleText:
                "{2}, {T}, Sacrifice this land: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
            cost: { mana: { X: 2 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { supertype: "Basic" },
                    count: 1,
                    prompt: "Search your library for a basic land card.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                    tapped: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// C3 — Domain-driven cost reduction (CR 601.2f / 702 preamble, issue #1958).
// Draco and Stratadon each reduce their OWN cast cost by their controller's
// Domain — the number of distinct basic land types among the lands they
// control (0–5, CR 305.6). Both are `CardDefinition.selfCostReduction` in the
// new `countMode: "domain"` shape (`DomainDrivenCostReduction`,
// `cards/types.ts`), NOT the pre-existing permanent-count shape
// (`countFilter`, Emry / affinity): a permanent filter counts PERMANENTS —
// three Forests would be three — while Domain counts distinct basic land
// TYPES, so three Forests are ONE and a single Tundra contributes TWO. The
// thing being counted differs in kind, which is why it is a count MODE and
// not a `dedupe` flag on the filter.
//
// Everything downstream is pre-existing and shared, so the reduction is
// visible EVERYWHERE, not merely at payment: `getCostModifiers` /
// `applyCostModifiers` (`gre/state.ts`) is the single CR 601.2f authority, and
// its callers are the castability probe (`canPotentiallyPayCost` with
// `foldCostModifiers`, driving `getLegalActions`' plain-cast branch —
// so Draco is reported castable the moment Domain makes it affordable),
// the announce/payment path (`announceCast` parks an ALREADY-reduced
// `pendingCast.manaCost`, which is what the auto-tap solver taps for and what
// the client's payment surface renders), the bot's move enumeration
// (`enumerateCastMoves`, `gre/moves.ts` — which the client-side Brain runs
// verbatim per ADR 0074) and the search-leaf replay (`applyMove.ts`).
//
// Three CR properties fall out of that shared path rather than needing
// Domain-specific code: GENERIC-ONLY (`applyCostModifiers` only ever reduces
// `manaCost.X`, so a coloured pip could never be removed — both cards are
// colourless, but the guarantee is structural); NEVER BELOW ZERO (its
// `Math.max(0, generic - reduction)` clamp); and FIXED AT ANNOUNCEMENT (the
// reduced cost is computed once, at announce, and parked on `pendingCast` —
// a land entering while the cast is being paid for cannot change the total,
// CR 601.2f "the total cost is locked in").
//
// The Domain scan itself is the shared `countDomain` helper (`cards/types.ts`)
// every other Domain site already uses — the `{ domain: { of } }` EffectValue,
// `SpellContext.getDomain`, the Domain-scaled `pt-cda` closures. It reads the
// LIVE `subtypes` array on each battlefield instance, which layer-4
// `subtype-set` / `subtype-add` statics materialize onto the instance, so a
// land whose type was added or changed counts correctly (CR 613.1d).
// ─────────────────────────────────────────────────────────────────────────

// Draco — {16} Artifact Creature — Dragon, 9/9 (PLS, rare). Modern Scryfall
// Oracle text is authoritative (ADR 0004).
//
// Printed at {16}, so the Domain reduction is what makes it castable at all:
// at Domain 5 it costs {6}, at Domain 0 the full {16}.
//
// The upkeep leg — "sacrifice this creature unless you pay {10}. This cost is
// reduced by {2} for each basic land type among lands you control" — is the
// same optional-payment idiom the Lair cycle above uses (`mayPay` + `if
// !$paid` → `sacrifice($source)`, CR 118 "unless"), with a DYNAMICALLY-PRICED
// mana leg: `{ mana: { X: 10 }, reducedBy: { domain: { of: "controller",
// times: 2 } } }`. That is the pre-existing `DynamicMayPayManaCost` shape
// (issue #1150, Flash's "pay its mana cost reduced by {2}") generalized on
// both axes it already had implicitly — the base may now be a LITERAL cost as
// well as a referenced object's printed one, and `reducedBy` is now a full
// `EffectValue` rather than a fixed integer, so it reuses the SAME Domain
// value member the Effect Script grammar already exposes. The interpreter
// floors the result at {0} (`reduceGenericMana`, CR 118.9), so at Domain 5
// there is nothing left to pay — but `requestMayPay` (`gre/state.ts`) has no
// zero-cost shortcut, so the may-pay choice is still enqueued and the player
// still confirms it; it just costs nothing to accept.
//
// NOTE the two Domain reads are INDEPENDENT: the cast reduction is evaluated
// at announcement, the upkeep reduction at each upkeep resolution, off
// whatever board exists then. Neither is snapshotted from the other.
export const draco: CardDefinition = {
    id: "212e3edb-62f1-4680-884f-70323547f8ad", // PLS 131
    rarity: "rare",
    name: "Draco",
    oracleText:
        "Domain — This spell costs {2} less to cast for each basic land type among lands you control.\nFlying\nDomain — At the beginning of your upkeep, sacrifice this creature unless you pay {10}. This cost is reduced by {2} for each basic land type among lands you control.",
    manaCost: { X: 16 },
    types: ["Artifact", "Creature"],
    subtypes: ["Dragon"],
    power: 9,
    toughness: 9,
    staticAbilities: ["flying"],
    selfCostReduction: {
        costReduction: { perCount: { X: 2 }, countMode: "domain" },
    },
    triggeredAbilities: [
        phaseTrigger({
            id: "draco-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this creature unless you pay {10}. This cost is reduced by {2} for each basic land type among lands you control.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: {
                        mana: { X: 10 },
                        reducedBy: {
                            domain: { of: "controller", times: 2 },
                        },
                    },
                    prompt: "Pay Draco's upkeep cost ({10} reduced by {2} per basic land type you control), or sacrifice it?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    // CR 118 — the "unless" consequence.
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ],
        }),
    ],
};

// Stratadon — {10} Artifact Creature — Beast, 5/5 (PLS, uncommon). Modern
// Scryfall Oracle text is authoritative (ADR 0004). The same self-host Domain
// reduction as Draco at {1} per basic land type (so {5} at Domain 5), plus
// plain trample — no upkeep leg.
export const stratadon: CardDefinition = {
    id: "324bc757-9942-4862-b691-5af42e07f682", // PLS 135
    rarity: "uncommon",
    name: "Stratadon",
    oracleText:
        "Domain — This spell costs {1} less to cast for each basic land type among lands you control.\nTrample",
    manaCost: { X: 10 },
    types: ["Artifact", "Creature"],
    subtypes: ["Beast"],
    power: 5,
    toughness: 5,
    staticAbilities: ["trample"],
    selfCostReduction: {
        costReduction: { perCount: { X: 1 }, countMode: "domain" },
    },
};
