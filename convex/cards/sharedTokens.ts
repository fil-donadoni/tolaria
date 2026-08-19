// Shared predefined token specs (CR 111 / 707.2). A canonical `TokenSpec` for a
// named token that multiple cards create, so its characteristics — including a
// token-scoped activated ability (issue #778) — live in ONE place and every
// producer creates the identical token (one synthesized definition, shared art).

import type {
    ActivatedAbilityContext,
    EffectTokenSpec,
    TokenSpec,
} from "./types";

/** Treasure token (issue #778 / #1265). "Artifact — Treasure" with "{T},
 *  Sacrifice this artifact: Add one mana of any color." (CR 707.2.)
 *
 *  The mana ability is the Black Lotus shape (`sets/lea/colorless.ts`): a
 *  `useStack: false` mana ability (CR 605.1a) whose `cost: { tap: true,
 *  sacrifice: true }` taps AND sacrifices the source, with `manaChoices`
 *  offering one mana of each of the five colors — the color is chosen at
 *  activation and applied by the engine (the `effect` body is the default
 *  first option). Carried on `TokenSpec.activatedAbilities`, registered onto
 *  the synthesized token definition by `createTokenPermanents`
 *  (`gre/state.ts`). Created today by Hullbreacher's draw-replacement redirect;
 *  reusable by any future Treasure producer (Magda, khm). */
export const TREASURE_TOKEN: TokenSpec = {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
    activatedAbilities: [
        {
            id: "treasure-token-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    // Real printed Treasure token art (tcmr, Commander Legends tokens).
    imagePrintId: "284ec798-2725-4741-8748-578c259d0623",
};

/** Treasure token (issue #778 / #1265 / #2423), DSL-authorable sibling of
 *  `TREASURE_TOKEN` above. Identical characteristics and mana ability —
 *  "{T}, Sacrifice this artifact: Add one mana of any color." — but typed
 *  `EffectTokenSpec` (JSON-pure, ADR 0046) so a `createToken` Effect Script
 *  Op can carry it: the ability carries NO `effects` body (see the doc
 *  comment on `activatedAbilities` below for why a `manaChoices` ability
 *  needs none), rather than `TREASURE_TOKEN`'s imperative `effect` closure.
 *
 *  Deliberately a SEPARATE constant, not a promotion of `TREASURE_TOKEN`
 *  itself: `TREASURE_TOKEN` stays `TokenSpec`-typed for its existing
 *  `resolve()` callers (Ragavan, Currency Converter), which pass an
 *  `ActivatedAbilityContext`-driven `effect` closure `EffectTokenSpec` has no
 *  slot for. "Generalize, don't add" (primitive reuse) argues for widening an
 *  ALMOST-right primitive; a spec's *type* isn't a primitive to overload with
 *  two incompatible shapes — hence a sibling constant, not a promotion. Any
 *  future DSL `createToken` producer of a Treasure shares THIS one. */
export const EFFECT_TREASURE_TOKEN: EffectTokenSpec = {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
    activatedAbilities: [
        {
            id: "treasure-token-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            // Deliberately NO `effects` body. A `manaChoices` ability (CR
            // 605.1a) never executes an `effects`/`effect` body at all: the
            // choice branch in `game.ts`'s `tapUntap` resolves the chosen
            // index via `resolveManaTapChoice` and adds THAT `ManaCost`
            // directly to the pool — `effects`/`effect` is read only for a
            // FIXED-output mana ability with no choice. An `effects` array
            // here would be dead weight at best; at worst it changes this
            // spec's structural-hash `tokenDefinitionId` (the JSON-encoded
            // ability segment) relative to `TREASURE_TOKEN` above — whose
            // `effect` closure is silently dropped by `JSON.stringify` — so
            // the two Treasure specs would hash to DIFFERENT definition ids
            // and `listTokenCatalogue()` would emit two "Treasure" entries
            // instead of one shared identity (caught in review, #2423).
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    // Real printed Treasure token art (tcmr, Commander Legends tokens) — same
    // print as `TREASURE_TOKEN` above (one shared Treasure identity, two spec
    // types).
    imagePrintId: "284ec798-2725-4741-8748-578c259d0623",
};

/** Eldrazi Spawn token (CR 707.2, issue #1531). "0/1 colorless Eldrazi Spawn
 *  creature token with 'Sacrifice this token: Add {C}.'" — a mana ability
 *  shaped like `TREASURE_TOKEN`'s (`cost.sacrifice`, `useStack: false`, CR
 *  605.3a), minus the tap leg and the color choice (a single fixed colorless
 *  mana). Typed `EffectTokenSpec` (JSON-pure, ADR 0046) rather than
 *  `TokenSpec` — its only consumer is Malevolent Rumble's DSL `createToken`
 *  Op (`sets/mh3/green.ts`), so the ability body is `effects: [{ op:
 *  "addMana" }]`, not an imperative closure. Any future Eldrazi Spawn
 *  producer shares this one spec/definition. */
export const ELDRAZI_SPAWN_TOKEN: EffectTokenSpec = {
    name: "Eldrazi Spawn",
    types: ["Creature"],
    subtypes: ["Eldrazi", "Spawn"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "eldrazi-spawn-sacrifice-mana",
            oracleText: "Sacrifice this token: Add {C}.",
            cost: { sacrifice: true },
            useStack: false,
            // CR 605.1a (issue #2021) — `manaProduced` is the DESCRIPTOR every
            // mana authority reads: `getManaTapOptionsDetailed` (engine tap
            // options + the bot's mana census), `findClientManaAbility` (the
            // board's tap-for-mana affordance) and the fixed-sacrifice
            // activation path itself. None of them reads an `effects`/`effect`
            // body — a fixed-output mana ability never executes one, its mana
            // is deposited structurally from this field. Without it the token
            // was inert as a mana source on every surface at once.
            manaProduced: { C: 1 },
            effects: [{ op: "addMana", mana: { C: 1 } }],
        },
    ],
    // Real printed Eldrazi Spawn token art (Malevolent Rumble's own MH3
    // printing's `all_parts` token link).
    imagePrintId: "e32795e1-5548-43ef-8cd6-c605a19ef708",
};

/** Rabbit token (CR 111 / 707.2, issue #674). "1/1 white Rabbit creature
 *  token" — the Bloomburrow-block staple, created today by Jacked Rabbit
 *  (`sets/blc/white.ts`) once per point of its power when it attacks. A
 *  vanilla token: no abilities, so `EffectTokenSpec` (JSON-pure, ADR 0046)
 *  rather than `TokenSpec`.
 *
 *  Deliberately NO pinned `imagePrintId`, unlike `TREASURE_TOKEN` /
 *  `ELDRAZI_SPAWN_TOKEN` above. Rabbit is a printed token in many sets, and
 *  the art-match rule is "the token associated with the PRODUCING card's own
 *  printing" — so leaving it unpinned is what keeps that true as the spec is
 *  reused: `SpellContext.createToken` falls back to
 *  `tokenPrintIdFor(<producing card id>, "Rabbit")`, which reads the
 *  reverse-linked Scryfall `all_parts` lockfile
 *  (`generated/token-prints.json`) and resolves per producer. Jacked Rabbit's
 *  entry is already in the lockfile and resolves to the BLC Rabbit print. A
 *  pinned id here would instead freeze one set's art onto every future
 *  producer. */
export const RABBIT_TOKEN: EffectTokenSpec = {
    name: "Rabbit",
    types: ["Creature"],
    subtypes: ["Rabbit"],
    power: 1,
    toughness: 1,
    colors: ["W"],
};

/** Knight token (CR 111 / 707.2, ADR 0078). "2/2 white Knight creature token
 *  with vigilance" — created today by History of Benalia's chapters I and II
 *  (`sets/dom/white.ts`). Vanilla apart from the keyword, so `EffectTokenSpec`
 *  (JSON-pure, ADR 0046) rather than `TokenSpec`.
 *
 *  No pinned `imagePrintId`, the `RABBIT_TOKEN` treatment: Knight is a printed
 *  token in many sets with different characteristics, and the art-match rule
 *  is "the token associated with the PRODUCING card's own printing". The
 *  producer's own DOM Knight print is reverse-linked in
 *  `generated/token-prints.json` and resolved per producer by
 *  `tokenPrintIdFor`, so a later Knight producer picks up ITS printing's art
 *  instead of inheriting DOM's. */
export const KNIGHT_TOKEN: EffectTokenSpec = {
    name: "Knight",
    types: ["Creature"],
    subtypes: ["Knight"],
    power: 2,
    toughness: 2,
    colors: ["W"],
    staticAbilities: ["vigilance"],
};

/** Human token (CR 111 / 707.2, issue #2370). "1/1 white Human creature
 *  token" — created today by Adeline, Resplendent Cathar's attack trigger
 *  (`sets/mid/white.ts`). Vanilla: no abilities, so `EffectTokenSpec`
 *  (JSON-pure, ADR 0046) rather than `TokenSpec`. `entersTapped`/
 *  `entersAttacking` are per-ability flags (Adeline's own "that's tapped and
 *  attacking"), NOT baked into this shared spec — a future non-attacking
 *  Human producer spreads this base spec without inheriting them, the same
 *  split the `createToken` Op call site owns for every other card.
 *
 *  Deliberately NO pinned `imagePrintId`, the `RABBIT_TOKEN`/`KNIGHT_TOKEN`
 *  treatment: Human is a printed token in many sets with different art, and
 *  the art-match rule is "the token associated with the PRODUCING card's own
 *  printing" — `SpellContext.createToken` resolves it per producer from
 *  `generated/token-prints.json` (`tokenPrintIdFor`), reverse-linked from
 *  Adeline's own MID #1 printing's `all_parts` Human token. */
export const HUMAN_TOKEN: EffectTokenSpec = {
    name: "Human",
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 1,
    colors: ["W"],
};

/** Phyrexian Germ token (CR 707.2, issue #1340) — the "0/0 black Phyrexian
 *  Germ creature token" every Living Weapon Equipment creates (CR 702.92a:
 *  Batterskull, Kaldra Compleat, Nettlecyst, …). Vanilla: no abilities, no
 *  counters; the Equipment attached to it is the only thing keeping it above
 *  0 toughness (CR 704.5f — once the Equipment detaches, the unbuffed 0/0
 *  Germ dies).
 *
 *  Deliberately carries NO `imagePrintId`, unlike the Treasure / Eldrazi Spawn
 *  specs above: every Living Weapon card has its OWN printed Germ token, so
 *  pinning one id here would stamp (say) Batterskull's NPH Germ onto Kaldra
 *  Compleat. `SpellContext.createToken` auto-resolves the art per PRODUCING
 *  card from `generated/token-prints.json` keyed by (card id, "Phyrexian
 *  Germ") — the token/emblem art-match rule. A new Living Weapon card must
 *  therefore refresh the lockfile (`node scripts/fetch-token-prints.mjs
 *  <its set file>`) or `tokenPrintLookup.test.ts` fails CI. */
export const PHYREXIAN_GERM_TOKEN: EffectTokenSpec = {
    name: "Phyrexian Germ",
    types: ["Creature"],
    subtypes: ["Phyrexian", "Germ"],
    power: 0,
    toughness: 0,
    colors: ["B"],
};

/** Skeleton token (CR 111 / 707.2, issue #2373). "4/1 black Skeleton creature
 *  token with menace" — created today by Gut, True Soul Zealot's attack
 *  trigger (`sets/clb/red.ts`). Vanilla apart from the keyword, the
 *  `KNIGHT_TOKEN` shape: `EffectTokenSpec` (JSON-pure, ADR 0046) with a
 *  `staticAbilities` entry. `entersTapped`/`entersAttacking` are per-ability
 *  flags (Gut's own "that's tapped and attacking"), NOT baked into this
 *  shared spec — the `HUMAN_TOKEN`/Adeline split: a future non-attacking
 *  Skeleton producer spreads this base spec without inheriting them.
 *
 *  Deliberately NO pinned `imagePrintId`, the `RABBIT_TOKEN`/`KNIGHT_TOKEN`/
 *  `HUMAN_TOKEN` treatment: Skeleton is a printed token in many sets with
 *  different art, and the art-match rule is "the token associated with the
 *  PRODUCING card's own printing" — `SpellContext.createToken` resolves it
 *  per producer from `generated/token-prints.json` (`tokenPrintIdFor`),
 *  reverse-linked from Gut's own CLB #180 printing's `all_parts` Skeleton
 *  token. */
export const SKELETON_TOKEN: EffectTokenSpec = {
    name: "Skeleton",
    types: ["Creature"],
    subtypes: ["Skeleton"],
    power: 4,
    toughness: 1,
    colors: ["B"],
    staticAbilities: ["menace"],
};
/** Construct token (CR 111.1 / 707.2, issue #2371) — the "0/0 colorless
 *  Construct artifact creature token with 'This token gets +1/+1 for each
 *  artifact you control'" shape TWO cards create verbatim: Urza's Saga's
 *  chapter II grant (`sets/mh2/colorless.ts`, issue #1884) and Urza, Lord
 *  High Artificer's ETB (`sets/mh1/blue.ts`, issue #2371). Extracted here per
 *  CLAUDE.md primitive reuse ("two consumers earns extraction").
 *
 *  A FACTORY, not a bare constant — unlike every other shared spec in this
 *  file, the two consumers do NOT share one `imagePrintId`: each has its OWN
 *  printing's Construct token (CR token-print rule, CLAUDE.md § Token/emblem
 *  art — "the card's OWN printing's token where it exists"), confirmed via
 *  Scryfall `all_parts` on each card's own set printing (mh1 Urza →
 *  `tmh1`/Modern Horizons Tokens; mh2 Urza's Saga → `tmh2`/Modern Horizons 2
 *  Tokens — two distinct token prints, same characteristics). What's shared
 *  is the STRUCTURAL shape and the CDA registry key
 *  (`pt-cda-artifacts-you-control`, `cards/tokenStaticEffects.ts`), not the
 *  art.
 *
 *  `TokenSpec` (not `EffectTokenSpec`): the "+1/+1 for each artifact you
 *  control" clause is a characteristic-defining ability (CR 604.3) — a
 *  `pt-cda` `compute` CLOSURE the JSON-pure DSL token spec has no slot for
 *  (see `TokenSpec.staticEffectKeys`'s own doc comment). Both consumers stay
 *  `resolve()` cards for this reason (ADR 0045 protocol-like exception,
 *  recorded on each card).
 *
 *  BOTH consumers call it: Urza's Saga's `URZAS_SAGA_CONSTRUCT_TOKEN`
 *  (`sets/mh2/colorless.ts`) was retrofitted onto this factory in the same
 *  change, so the duplication the extraction exists to remove is actually
 *  gone — "two consumers earns extraction" is a statement about the code, not
 *  an intention. */
export function constructArtifactsYouControlToken(
    imagePrintId: string
): TokenSpec {
    return {
        name: "Construct",
        types: ["Artifact", "Creature"],
        subtypes: ["Construct"],
        power: 0,
        toughness: 0,
        imagePrintId,
        staticEffectKeys: ["pt-cda-artifacts-you-control"],
    };
}

/** Golem token (CR 111 / 707.2, issue #2367). "3/3 colorless Golem artifact
 *  creature token" — the vanilla Mirrodin-block staple. Created by Sandstorm
 *  Salvager's ETB (`sets/big/green.ts`) and by Legion Extruder's activated
 *  ability (`sets/big/red.ts`); extracted here on the SECOND consumer per
 *  CLAUDE.md primitive reuse.
 *
 *  `EffectTokenSpec` (JSON-pure, ADR 0046) rather than `TokenSpec`: a vanilla
 *  token has no abilities, and both consumers create it from a DSL
 *  `createToken` Op.
 *
 *  Deliberately NO pinned `imagePrintId`, following `RABBIT_TOKEN` above:
 *  Golem is a printed token in many sets and the art-match rule is "the token
 *  associated with the PRODUCING card's own printing", so
 *  `tokenPrintIdFor(<producing card id>, "Golem")` resolves it per producer
 *  from the reverse-linked Scryfall `all_parts` lockfile
 *  (`generated/token-prints.json`). Both producers are already in that
 *  lockfile (they happen to share the same Golem print today — pinning would
 *  freeze that coincidence onto every future producer). */
export const GOLEM_TOKEN: EffectTokenSpec = {
    name: "Golem",
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 3,
};

/** Pest token (CR 111 / 707.2, issue #2364 / #2369). "1/1 black and green
 *  Pest creature token with 'When this token dies, you gain 1 life.'" —
 *  shared between Pest Infestation (`sets/c21/green.ts`) and Sedgemoor Witch
 *  (`sets/stx/black.ts`, still stubbed on the unrelated Magecraft-"or copy"
 *  gap, #2087). The FIRST card-shipped consumer of
 *  `EffectTokenSpec.triggeredAbilities` (issue #2364's shipped primitive,
 *  landed with zero card consumers until now): the dies-trigger is a
 *  `TokenTriggeredAbility` descriptor (`event: "CREATURE_DIED"`, always
 *  self-scoped per CR 109.2 — the token gains ITS OWN controller 1 life),
 *  converted into a real `TriggeredAbility` by
 *  `resolveTokenTriggeredAbilities` (`cards/tokenTriggeredAbilities.ts`) at
 *  the `createToken` Op executor. `EffectTokenSpec` (JSON-pure, ADR 0046),
 *  not `TokenSpec` — both consumers are DSL `createToken` producers, neither
 *  needs a `resolve()` closure.
 *
 *  Deliberately NO pinned `imagePrintId`, the `RABBIT_TOKEN`/`KNIGHT_TOKEN`/
 *  `HUMAN_TOKEN`/`SKELETON_TOKEN` treatment: Pest is a printed token across
 *  several sets, and the art-match rule is "the token associated with the
 *  PRODUCING card's own printing" — `SpellContext.createToken` resolves it
 *  per producer from `generated/token-prints.json` (`tokenPrintIdFor`),
 *  reverse-linked from each producer's own printing's `all_parts` Pest
 *  token entry. */
export const PEST_TOKEN: EffectTokenSpec = {
    name: "Pest",
    types: ["Creature"],
    subtypes: ["Pest"],
    power: 1,
    toughness: 1,
    colors: ["B", "G"],
    triggeredAbilities: [
        {
            id: "pest-dies-gain-1-life",
            oracleText: "When this token dies, you gain 1 life.",
            event: "CREATURE_DIED",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};

/** Insect token (CR 111 / 707.2, issue #2391). "1/1 black and green Insect
 *  creature token" — created today by Grist, the Hunger Tide's `+1` loyalty
 *  ability (`sets/mh2/multicolor.ts`), once per iteration of its repeat loop.
 *  Vanilla: no abilities, so the JSON-pure `EffectTokenSpec` shape (ADR 0046)
 *  rather than `TokenSpec`.
 *
 *  Distinct from The Hive's Wasp (`sets/lea/colorless.ts`), which is also an
 *  Insect but a COLORLESS artifact creature with flying and its own name — a
 *  different token, not a candidate for this spec.
 *
 *  Deliberately NO pinned `imagePrintId`, the `RABBIT_TOKEN`/`KNIGHT_TOKEN`/
 *  `HUMAN_TOKEN` treatment: the art-match rule is "the token associated with
 *  the PRODUCING card's own printing", resolved per producer from
 *  `generated/token-prints.json` (`tokenPrintIdFor`). Grist's own MH2 #202
 *  printing reverse-links to the TMH2 #13 black-and-green Insect token, and
 *  its `resolve()` body passes that id explicitly — `tokenPrintLookup.test.ts`
 *  is blind to `resolve()`-created tokens (CLAUDE.md § Card definition
 *  checklist), so the producer, not this spec, carries the lookup. */
export const INSECT_TOKEN: EffectTokenSpec = {
    name: "Insect",
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    colors: ["B", "G"],
};

/** Green Insect token (CR 111, issue #2388). "1/1 green Insect creature
 *  token" — created today by Springheart Nantuko's landfall trigger
 *  (`sets/mh3/green.ts`) on the branch where no copy token was made.
 *
 *  A SEPARATE spec from `INSECT_TOKEN` above rather than a colour override on
 *  it: `INSECT_TOKEN` is Grist's BLACK AND GREEN Insect (CR 105.2 — a
 *  two-colour object), and colour is a copiable characteristic that every
 *  colour-matters effect reads (`getEffectiveColors`, `sharesColor`, protection
 *  from black). Two tokens that differ in colour are two tokens; folding them
 *  into one spec with a per-producer override would make the shared spec a
 *  lie and hash both to the same synthesized `tokenDefinitionId`.
 *
 *  Deliberately NO pinned `imagePrintId`, the `INSECT_TOKEN` treatment: the
 *  art-match rule is "the token associated with the PRODUCING card's own
 *  printing", resolved per producer from `generated/token-prints.json`
 *  (`tokenPrintIdFor`). Springheart Nantuko's MH3 #171 printing reverse-links
 *  to the TMH3 #25 mono-green Insect token, which is exactly this spec. */
export const GREEN_INSECT_TOKEN: EffectTokenSpec = {
    name: "Insect",
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    colors: ["G"],
};

/** Food token (CR 111.10b — "A Food token is a colorless Food artifact token
 *  with '{2}, {T}, Sacrifice this token: You gain 3 life.'"; issue #2361).
 *  Created today by Oko, Thief of Crowns' `+2` (`sets/eld/multicolor.ts`);
 *  every future Food producer shares THIS spec, so all Food tokens hash to one
 *  synthesized `tokenDefinitionId` and one client rehydration path.
 *
 *  Shaped like `CLUE_TOKEN_SPEC` (`cards/abilities/tokens/clueToken.ts`) — a
 *  colorless artifact whose single ability spends `cost.mana` + a
 *  `cost.sacrifice` of its own source (CR 602.1) and carries a DSL-only
 *  `effects` body — plus the `{T}` leg Food has and Clue does not. NOT a mana
 *  ability, so `useStack: true` (CR 605.1a): it uses the stack and can be
 *  responded to.
 *
 *  `colors` omitted = colorless (CR 105.2 / 110.5), which is what CR 111.10b
 *  specifies; `Food` is an ARTIFACT type (CR 205.3g), never a creature type,
 *  so the token has no P/T.
 *
 *  Deliberately NO pinned `imagePrintId`, the `RABBIT_TOKEN` / `KNIGHT_TOKEN` /
 *  `HUMAN_TOKEN` treatment: Food is a printed token across many sets and the
 *  art-match rule is "the token associated with the PRODUCING card's own
 *  printing", which `SpellContext.createToken` resolves per producer from
 *  `generated/token-prints.json` (`tokenPrintIdFor`) — Oko's own ELD #197
 *  printing reverse-links to the ELD Food token. */
export const FOOD_TOKEN: EffectTokenSpec = {
    name: "Food",
    types: ["Artifact"],
    subtypes: ["Food"],
    activatedAbilities: [
        {
            id: "food-token-sacrifice-gain-life",
            oracleText: "{2}, {T}, Sacrifice this token: You gain 3 life.",
            cost: { mana: { generic: 2 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 3 }],
        },
    ],
};
