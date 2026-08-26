// mh1 — blue cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { constructArtifactsYouControlToken } from "../../sharedTokens";

// Echo of Eons — {4}{U}{U} Sorcery. "Each player shuffles their hand and
// graveyard into their library, then draws seven cards." with Flashback {2}{U}
// (CR 702.34 — cast from the graveyard for the flashback cost, then exile it).
// This is Timetwister (CR 103.4 whole-table hand/graveyard reset) with a
// flashback back-half, and the marquee flashback play: pitch it, then flash it
// back for a two-mana Timetwister. Echo of Eons is on the stack while it
// resolves, so the graveyard shuffle doesn't sweep it; after resolution the
// flashback rider exiles it (exileOnResolve).
//
// Migrated resolve()→effects[] (ADR 0045, issue #1279): the `moveZone` Op's
// THIRD (whole-zone bulk) shape now moves a player's ENTIRE hand/graveyard to
// their library with no selection, a thin skin over `ctx.moveZone`. Identical
// body to lea/2ed Timetwister's migrated `effects[]` (same composed Ops, no
// new primitive) — `flashback` is an orthogonal cost-shape field, unaffected
// by the resolve()→effects[] migration.
export const echoOfEons: CardDefinition = {
    id: "ff590af2-2d6c-4f16-a9b8-1a6dab6e9ad5",
    rarity: "mythic",
    name: "Echo of Eons",
    oracleText:
        "Each player shuffles their hand and graveyard into their library, then draws seven cards.\nFlashback {2}{U}",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    flashback: { X: 2, U: 1 },
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "moveZone",
                    player: { ref: "$each" },
                    from: "hand",
                    to: "library",
                },
                {
                    op: "moveZone",
                    player: { ref: "$each" },
                    from: "graveyard",
                    to: "library",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { ref: "$each" },
                },
                { op: "draw", player: { ref: "$each" }, count: 7 },
            ],
        },
    ],
};

// Force of Negation — {1}{U}{U} Instant. "If it's not your turn, you may exile a
// blue card from your hand rather than pay this spell's mana cost. Counter
// target noncreature spell. If that spell is countered this way, exile it
// instead of putting it into its owner's graveyard." (CR 118.9 alternative pitch
// cost — exile a blue card from hand, gated on not-your-turn; CR 701.6a counter;
// CR 114.1 noncreature spell target; CR 701.6a counter-to-exile.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `handCost.action: "exile"` leg with `condition: not-your-turn`. The
// "noncreature spell" restriction rides `spellExcludeTypeFilter: "Creature"` on
// the spell target (the Spell Pierce shape); the "exile it instead" rider is the
// already-censused `counter` Op's `destination: "exile"` (No More Lies /
// Memory Lapse family) — no new Op or TargetRequirement type (ADR 0045).
export const forceOfNegation: CardDefinition = {
    id: "e9be371c-c688-44ad-ab71-bd4c9f242d58", // MH1 52
    rarity: "rare",
    name: "Force of Negation",
    oracleText:
        "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    manaCost: { X: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellExcludeTypeFilter: "Creature",
    },
    alternativeCosts: [
        {
            id: "pitch-exile-blue",
            description: "Exile a blue card from your hand",
            condition: { kind: "not-your-turn" },
            hand: {
                action: "exile",
                requirements: [{ filter: { color: "U" }, count: 1 }],
            },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 }, destination: "exile" }],
};

// Urza, Lord High Artificer — {2}{U}{U} Legendary Creature — Human Artificer,
// 1/4 (MH1 75, issue #2371, parent tracker #1525). Three clauses, each a
// distinct engine seam:
//
//   1. ETB — "create a 0/0 colorless Construct artifact creature token with
//      'This token gets +1/+1 for each artifact you control.'" (CR 603.6a /
//      111.1 / 604.3.) The IDENTICAL token Urza's Saga's chapter II grant
//      creates (`sets/mh2/colorless.ts`, issue #1884) — shared shape/CDA-key
//      extracted to `constructArtifactsYouControlToken` (`sharedTokens.ts`,
//      "two consumers earns extraction" — Urza's Saga was retrofitted onto it
//      in the same change, so both call sites really do share one spec); see
//      that factory's own doc comment for why it's a factory rather than a
//      bare shared constant.
//
//      DSL-first exception (ADR 0045), PROTOCOL-LIKE, recorded justification
//      — identical to Urza's Saga's own: the token's "+1/+1 for each artifact
//      you control" is a characteristic-defining ability (CR 604.3), i.e. a
//      `pt-cda` `compute` CLOSURE. The DSL's `createToken` Op only accepts a
//      JSON-pure `EffectTokenSpec` (ADR 0046) with no `staticEffects`/
//      `staticEffectKeys` slot — a CDA genuinely cannot ride there. This is
//      NOT "the Op doesn't exist yet": `createToken` exists and is used
//      everywhere; a CDA specifically cannot be expressed as JSON.
//      `TokenSpec.staticEffectKeys` + `SpellContext.createToken` is the
//      shipped mechanism (`ncc/colorless.ts`, `mh2/colorless.ts` precedent).
//
//   2. "Tap an untapped artifact you control: Add {U}." (CR 605.1a mana
//      ability, `useStack: false` per CR 605.3a.) `cost.tapOtherFilter`
//      (existing shape — Hand of Justice `fem/white.ts`, Vodalian War Machine
//      `fem/blue.ts`) filtered to untapped artifacts, `count: 1`; Urza has NO
//      `cost.tap` of its own, so activating this ability never taps Urza —
//      only the chosen artifact. `manaProduced: { U: 1 }` is the standard
//      mana-ability output declaration. This is the FIRST catalogue ability
//      to pair `tapOtherFilter` with a non-tap (`useStack: false`) mana
//      ability — every existing `tapOtherFilter` cost belongs to a
//      `useStack: true` ability paid through the stack-ability picker
//      (`selectActivationCost`, `convex/game.ts`), which parks the picks on
//      `pendingActivation.tapOtherChoice` and therefore assumes a stack item
//      to park them against. A mana ability resolves inside ONE mutation call
//      (CR 605.3c), so the whole pick set travels up front instead:
//      `activateManaAbility` gained a `tapOtherIds` arg and a sibling payment
//      path, `payTapOtherAbilityCost` (see its doc comment there).
//
//      Client side, `useBattlefieldInteraction` collects those picks before
//      dispatching: the menu entry is withheld when no untapped artifact
//      matches (`getManaCostMenuAbility`, `lib/card-utils.ts`), a forced pick
//      auto-commits (`isTapOtherPickForced`), and anything else opens the
//      board picker — gold rings on the legal artifacts, `ManaTapOtherBanner`
//      for the prompt, one click per pick. Both the click gate and the rings
//      read the SAME `tapOtherCostCandidates` list the affordability gate
//      does, which is the whole point of that helper existing.
//
//      RESOLVED 2026-08-26 (#1841 audit): this paragraph used to say the BOT
//      could not reach this ability and pointed at #2420 as the tracker.
//      #2420 closed 2026-08-25 (PR #2806) by generalizing exactly the seam
//      this paragraph named — `planManaPayment`'s one-card-one-tap
//      `PlanSource` model now has a "taps a DIFFERENT permanent" shape
//      (`tapOtherIds`, `moves.ts:139,436,724`), and `activateManaAbility` /
//      `payTapOtherAbilityCost` apply whatever pick the plan makes. The bot
//      pays a blue spell's cost with Urza's ability like a human would,
//      without ever tapping Urza itself (CR 602.1); see the Urza/Farrelite
//      coverage in `moves.bot.test.ts` and `applyMove.bot.test.ts`. No
//      standalone "activate and float the mana with no spend plan" Move was
//      added — the bot only ever taps this ability as part of paying a
//      cost, which is the ordinary use of a mana ability (CR 605.1a) and not
//      a residual gap. Shape shared with Farrelite Priest (`fem/white.ts`).
//
//   3. "{5}: Shuffle your library, then exile the top card. Until end of
//      turn, you may play that card without paying its mana cost." (CR
//      601.3e / 608.2g impulse-play idiom, CR 701.24 shuffle.) Composes
//      shipped `SpellContext` primitives exactly like Elkin Bottle
//      (`ice/colorless.ts`) plus a leading shuffle: `shuffleLibrary` →
//      `peekLibraryTop` → `exileFaceDown` (CR 406.3 — hidden to the opponent,
//      known to the controller) → `grantCastFromExile` with `"this-turn"` +
//      `withoutPayingManaCost: true` (Dauthi Voidwalker's own
//      `withoutPayingManaCost` precedent, `mh2/black.ts`).
//
//      DSL-first exception (ADR 0045), PROTOCOL-LIKE, recorded justification
//      — identical to Elkin Bottle's: "exile the (unconditional) top card of
//      a library, then grant cast-from-exile" has no Op skin. `moveZone`'s
//      six shapes all require either an ANNOUNCED target, a preceding
//      `choice`'s picks, or a graveyard-only positional selector — none
//      reaches "the top card of a library, no target, no choice" the way
//      this clause needs. `grantCastFromExile` (the Op) only accepts a
//      `choice`-bound ref or an `exiledWithSource` selector, neither of which
//      a plain top-of-library exile produces. `useStack: true` (CR 601.2 —
//      this ability has no {T} symbol and uses the stack, unlike clause 2).
const URZA_CONSTRUCT_TOKEN = constructArtifactsYouControlToken(
    // mh1 Urza's OWN printing's Construct token (Scryfall `all_parts` on the
    // mh1/75 print, set `tmh1` "Modern Horizons Tokens") — the card's own
    // printing's token per the CR token-print rule, distinct from Urza's
    // Saga's mh2 Construct print.
    "85f212cd-4fc6-42fe-b268-22d8e3b2b7eb"
);

// NOT-DSL-migratable — assessed, not merely un-migrated. `createToken`'s Op
// takes a JSON-pure `EffectTokenSpec` (ADR 0046) with no `staticEffectKeys`
// slot, and this token's P/T is a characteristic-defining ability (CR 604.3),
// i.e. a `compute` closure. See clause 1 of the card comment above; the
// migration classifier reads this marker (`scripts/migration-classifier.mjs`)
// so the FREE tranche stops re-listing a closure already confirmed unskinnable.
function createUrzaConstruct(ctx: SpellContext): void {
    ctx.createToken(URZA_CONSTRUCT_TOKEN, ctx.controller, 1);
}

export const urzaLordHighArtificer: CardDefinition = {
    id: "9e7fb3c0-5159-4d1f-8490-ce4c9a60f567", // MH1 75
    rarity: "mythic",
    name: "Urza, Lord High Artificer",
    oracleText:
        'When Urza enters, create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."\nTap an untapped artifact you control: Add {U}.\n{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.',
    manaCost: { X: 2, U: 2 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 4,
    triggeredAbilities: [
        enteredTrigger({
            id: "urza-lha-construct",
            oracleText:
                'When Urza enters, create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."',
            scope: "self",
            resolve: createUrzaConstruct,
            // aiEffects (PRD #1423, issue #1431/#1519) — this trigger is a
            // bare `resolve()` (the CDA-carrying token, see the header
            // comment), so the bot's value model has nothing to walk without
            // a shadow script. `createToken`'s valuer reads `power`/
            // `toughness` off the spec directly (`gre/ai/opValuers.ts`); the
            // REAL body is 0/0 + 1/1 per artifact you control (itself
            // included), which the static model can't compute, so a
            // representative 2/2 stands in ("itself + one other artifact", a
            // common early-game count) — the SAME "representative 2/2 for an
            // unknowable body" convention `createTokenCopy`'s own valuer
            // comment documents just above this one in `opValuers.ts`.
            aiEffects: [
                {
                    op: "createToken",
                    token: {
                        name: "Construct",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Construct"],
                        power: 2,
                        toughness: 2,
                    },
                    controller: "controller",
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "urza-lha-mana",
            oracleText: "Tap an untapped artifact you control: Add {U}.",
            cost: {
                tapOtherFilter: {
                    filter: { types: "Artifact", controllerRelation: "you" },
                    count: 1,
                },
            },
            useStack: false,
            manaProduced: { U: 1 },
            // ADR 0045 DSL-first: unlike a TAP/sacrifice mana ability (whose
            // fixed `manaProduced` output is deposited structurally,
            // bypassing `effects`/`resolve` entirely), a `tapOtherFilter`-only
            // ability resolves through `activateManaAbility`'s real
            // `resolveTopOfStack` dispatch (see the card-level comment
            // above), which DOES execute this body — so the trivial "add
            // {U}" is the registered `addMana` Op, not an unjustified
            // `resolve()` escape hatch (Eldrazi Spawn's own "Sacrifice this
            // token: Add {C}." is the same-shaped precedent,
            // `sharedTokens.ts`).
            effects: [{ op: "addMana", mana: { U: 1 } }],
        },
        {
            id: "urza-lha-impulse",
            oracleText:
                "{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.",
            cost: { mana: { X: 5 } },
            useStack: true,
            // NOT-DSL-migratable — assessed, not merely un-migrated. No Op
            // reaches "exile the top card of a library, no target, no choice"
            // and then grants cast-from-exile over it; see clause 3 of the card
            // comment above for the per-Op walk. The migration classifier reads
            // this marker (`scripts/migration-classifier.mjs`) so the FREE
            // tranche stops re-listing a closure already confirmed unskinnable.
            resolve: (ctx: SpellContext) => {
                // CR 701.24 — shuffle FIRST (the oracle's own ordering), then
                // exile the (new) top card.
                ctx.shuffleLibrary(ctx.caster);
                const top = ctx.peekLibraryTop(ctx.caster, 1);
                if (top.length === 0) return; // empty library (CR 608.2b)
                const cardId = top[0];
                // CR 406.3 — exiled hidden to the opponent, known to the
                // controller.
                ctx.exileFaceDown(ctx.caster, cardId, "library", ctx.caster);
                // CR 601.3e / 117.6 — cast/play permission until end of turn,
                // without paying the mana cost. `includesLand: true`: the
                // oracle says "play", not "cast" (CR 305.9, issue #1689).
                ctx.grantCastFromExile(
                    cardId,
                    ctx.caster,
                    undefined,
                    "this-turn",
                    {
                        withoutPayingManaCost: true,
                        includesLand: true,
                    }
                );
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — bare `resolve()`
            // (see the header comment: no Op skin for an unconditional
            // top-of-library exile). `lookDistribute` is this codebase's own
            // precedent for standing in for a "look at N, keep 1" impulse
            // upside (`CARD_SELECTION_VALUE`, `gre/ai/opValuers.ts`) —
            // Ragavan, Nimble Pilferer's own exile-and-may-cast clause uses
            // the identical shadow (`mh2/red.ts`), even though the real
            // effect casts from exile without paying mana cost rather than
            // drawing to hand; the shuffle itself carries no separate
            // valuation (a shuffle of a fair library is value-neutral).
            aiEffects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 1,
                },
            ],
        },
    ],
};
