/**
 * Shared sub-grammar: TRIGGER HEAD — the clause before the comma on a
 * triggered ability (CR 113.3c, CR 603.2).
 *
 * ── An exact table, not a pattern ──────────────────────────────────────────
 *
 * Every head below is an EXACT phrase looked up in a table (`atom`, the safest
 * leaf there is — the span must BE a key, so residue is impossible without a
 * regex being involved at all). That is a deliberate refusal of the obvious
 * design, which is to match `/^When(ever)? (.+) (enters|dies)$/` and read the
 * middle as a subject: the middle of a trigger head is where "another creature
 * you control", "a creature an opponent controls" and "equipped creature" all
 * live, three different scopes that a subject rule reading only the noun would
 * collapse into one. A collapsed scope is not a parse failure — it is a card
 * that triggers on the wrong events, which is the defect class ADR 0105 exists
 * to prevent.
 *
 * The table therefore grows one row per phrase the corpus actually prints, and
 * a phrase outside it is `unparsed` with the phrase as the fragment — which is
 * precisely the backlog signal that ranks the next row.
 *
 * ── Self phrases ───────────────────────────────────────────────────────────
 *
 * "When this creature enters" and "When {self} enters" are the same head:
 * modern templating writes the noun, older wordings name the card and
 * `normalize.ts` has already substituted `{self}` (CR 201.5). Both go through
 * `isSelfPhrase`, the same predicate the cost grammar uses, so the two
 * grammars cannot disagree about what "this" means.
 */

import type { SpellFilter } from "../../../cards/filters";
import type { CardType, Color } from "../../../cards/types";
import type { Phase } from "../../../gre/types";
import { fail, ok, rule, type Rule, subGrammar } from "../../rule";
import { isSelfPhrase } from "./cost";
import { readSubtypeList } from "./subtypeList";
import { ARTIFACT_SUBTYPES, CREATURE_SUBTYPES } from "./subtypes";
import { COLOR_WORDS } from "./targetFilter";

export const TRIGGER_HEAD = "trigger head";

// CR 603.8 — "when <self>'s power is N or greater" (state trigger).
const POWER_REACHED = /^when (.+)'s power is (\d+) or greater$/i;

// CR 716.2a — the level a bar sets is printed on it, so the head names a number
// and `compile.ts` holds it to the section it is printed in.
const CLASS_LEVEL_GAINED = /^when this class becomes level (\d+)$/i;

/** CR 603.1 — the three words a trigger condition begins with. */
const TRIGGER_OPENER = /^(when|whenever|at) /i;

/**
 * Which permanents' events fire the ability, relative to the source
 * (CR 109.2). The names are the engine's `PermanentScope` vocabulary
 * deliberately: unlike a duration or a zone, a scope has exactly one meaning
 * on both sides and inventing a parallel spelling for it would buy nothing but
 * a mapping table to get wrong.
 */
export type TriggerSubjectScope =
    | "self"
    | "yours"
    | "opponents"
    | "any"
    | "another-yours"
    | "any-other"
    /** CR 303.4b — the Aura's host: "when ENCHANTED creature dies". */
    | "host";

export type TriggerHeadIR =
    /** CR 603.6a — "when [this / a creature] enters the battlefield". */
    | {
          readonly kind: "enters";
          readonly scope: TriggerSubjectScope;
          /** CR 603.6a — narrows the entering permanent by card type. */
          readonly creaturesOnly: boolean;
          /**
           * CR 202.3 — "a creature with mana value N or greater": a floor on
           * the entering permanent's mana value (`{X}` as 0 on the
           * battlefield, CR 202.3e). Lowers to `PermanentFilter.manaValueAtLeast`.
           */
          readonly manaValueAtLeast?: number;
          /**
           * CR 208.1 — "a creature you control with power N or greater": a
           * floor on the entering creature's power. Lowers to
           * `PermanentFilter.powerAtLeast`.
           */
          readonly powerAtLeast?: number;
          /**
           * CR 205.3 — "a Forest you control", "another Frog, Rabbit, Raccoon,
           * or Squirrel you control": narrows the entering permanent by
           * SUBTYPE rather than card type, any of the listed (a Forest is any
           * permanent with that land type, Dryad Arbor included, CR 305.6).
           * Lowers to `PermanentFilter.subtypes`.
           */
          readonly subtypes?: readonly string[];
          /** CR 111.1 — "another NONTOKEN Bird": the entering permanent is
           *  not a token. Lowers to `PermanentFilter.isToken: false`. */
          readonly nontoken?: true;
          /** CR 205.2a — "whenever a LAND enters": narrows the entering
           *  permanent by the land card type. Lowers to
           *  `PermanentFilter.types`. */
          readonly permanentType?: "Land";
          /** "THIS CREATURE OR another … you control enters": the source
           *  is one of the entering permanents the head names, under scope
           *  `yours` (see `matchSelfOrAnotherHead`). */
          readonly orSelf?: true;
      }
    /** CR 603.6 — "when [this / a creature] dies". */
    | { readonly kind: "dies"; readonly scope: TriggerSubjectScope }
    /**
     * CR 603.6c + CR 700.4 — "whenever this creature or another creature you
     * control leaves the battlefield without dying": a creature of yours
     * moving from the battlefield to any zone but a graveyard ("dies" is
     * exactly the graveyard move). The source's own departure is one of them
     * (see `matchSelfOrAnotherHead`).
     */
    | {
          readonly kind: "leaves-without-dying";
          readonly scope: "yours";
          readonly orSelf: true;
      }
    /**
     * CR 603.2 + CR 603.6a + CR 701.21a — "when this artifact enters and when
     * you sacrifice it": ONE Oracle line over the source's own entry and its
     * own sacrifice (a departure to the graveyard by its controller as a
     * sacrifice, never a destroy). Self only.
     */
    | { readonly kind: "enters-or-sacrificed" }
    /**
     * CR 603.6c — "when this <permanent> leaves the battlefield": the source
     * moving from the battlefield to ANY zone, whatever the body does
     * (Thragtusk's token, Phyrexian Bloodstock's targeted destroy). Self
     * only: "another creature … leaves" is a different scope, unread.
     */
    | { readonly kind: "leaves"; readonly scope: "self" }
    /**
     * CR 603.2 + CR 603.6a + CR 603.6c — "when this <permanent> enters or
     * leaves the battlefield": ONE Oracle line over the source's own entry
     * and its own departure to any zone. Self only.
     */
    | { readonly kind: "enters-or-leaves" }
    /**
     * CR 701.21a + CR 603.10a — "whenever you sacrifice a land": a permanent
     * of the named type moved by its controller (the ability's) from the
     * battlefield to its owner's graveyard as a sacrifice, never a destroy.
     */
    | {
          readonly kind: "sacrificed";
          readonly scope: "yours";
          readonly permanentType: "Land";
      }
    /**
     * CR 701.23a — "whenever an opponent searches their library": the act of
     * searching, whatever it finds; the searcher is "that player".
     */
    | { readonly kind: "library-searched"; readonly scope: "opponents" }
    /** CR 702.174c — "whenever you give a gift". */
    | { readonly kind: "gift-given"; readonly scope: "you" }
    /** CR 700.14 — "whenever you expend N": the mana the controller spent to
     *  cast spells this turn reaching N with a cost paid. */
    | {
          readonly kind: "expend";
          readonly scope: "you";
          readonly amount: number;
      }
    /** CR 701.61a — "whenever you forage": the controller exiled three
     *  cards from their graveyard or sacrificed a Food. */
    | { readonly kind: "foraged"; readonly scope: "you" }
    /** CR 119.9 — "whenever you gain life": one life-gain event of the
     *  ability's controller (a gain of 0 is no event). */
    | { readonly kind: "life-gained"; readonly scope: "you" }
    /**
     * CR 119.3 + CR 603.2 — "whenever you gain or lose life during your
     * turn": ONE Oracle line over both events of the controller's life total,
     * narrowed to the controller's own turn as the event happens.
     */
    | {
          readonly kind: "life-gained-or-lost";
          readonly scope: "you";
          readonly duringYourTurn: true;
      }
    /**
     * CR 603.6c — "when this <permanent> is put into a graveyard from the
     * battlefield": the battlefield exit that ends in a graveyard, for ANY
     * permanent type (CR 700.4 defines "dies" the same way, but the engine's
     * `CREATURE_DIED` is creature-only, so a non-creature rides
     * `PERMANENT_LEFT`). The Aura's "return it to its owner's hand" (Rancor) rides it.
     * `any` is the non-self form the corpus prints only with the other
     * narrowings below (Sacred Ground): the permanent's type, the graveyard's
     * OWNER (CR 404.1 — "your graveyard", which is not the controller) and who
     * caused the departure (CR 603.2 — "a spell or ability an opponent
     * controls causes").
     */
    | {
          readonly kind: "left-to-graveyard";
          readonly scope: "self" | "any";
          readonly permanentType?: "Land";
          /** CR 205.3 — "a Food is put into a graveyard": the permanent's
           *  subtype, read from its last-known information (CR 603.10a). */
          readonly subtypes?: readonly string[];
          readonly ownedBy?: "you";
          readonly causedBy?: "opponent";
      }
    /**
     * CR 603.6c / 113.6k — "when this card is put into your graveyard from your
     * library": the source is the card that moved (the mill, CR 701.17) and
     * the head fires from the graveyard it reached. Self only.
     */
    | { readonly kind: "library-to-graveyard" }
    /**
     * CR 603.2 / 603.6c — "whenever [another / a black] card is put into [a /
     * an opponent's] graveyard from anywhere": a card reaching a graveyard by
     * ANY route (battlefield, hand, library, stack), read from the graveyard
     * it landed in. `colors` is CR 105.2's narrowing, `excludeSelf` the
     * "another" (the source's own entry does not fire it).
     */
    | {
          readonly kind: "graveyard-entry";
          readonly graveyard: "any" | "yours" | "opponents";
          readonly excludeSelf?: true;
          readonly colors?: readonly Color[];
      }
    /**
     * CR 508.3a — "whenever [this creature / a creature you control] attacks".
     * The rule counts PER CREATURE: the ability triggers once for each
     * creature declared as an attacker that `scope` admits, and each firing
     * names its own ("…, IT gets +2/+2"). Under `self` that is one firing
     * either way, which is why the head shipped without a scope at all.
     */
    | {
          readonly kind: "attacks";
          readonly scope: TriggerSubjectScope;
          /** CR 702.171b — "attacks while saddled": the source must be saddled
           *  as it is declared an attacker (a trigger condition, read when the
           *  event fires — not an intervening-if). Self only. */
          readonly whileSaddled?: true;
          /** CR 506.5 — "attacks alone": the source is the only creature
           *  declared as an attacker. A trigger condition on the declaration,
           *  not an intervening-if. Self only. */
          readonly alone?: true;
      }
    /**
     * CR 603.2 + CR 603.6a + CR 508.3a — "whenever this permanent enters or
     * attacks": ONE Oracle line over the source's own entry and its own
     * declaration as an attacker. Self only (CR 201.5).
     */
    | { readonly kind: "enters-or-attacks" }
    /**
     * CR 603.2 + CR 603.6a + CR 603.2b — "when this permanent enters and at
     * the beginning of your upkeep": ONE Oracle line over the source's own
     * entry and the beginning of its controller's upkeep. Self only
     * (CR 201.5).
     */
    | { readonly kind: "enters-or-upkeep" }
    /**
     * CR 508.3a + CR 509.3a — "whenever a creature attacks or blocks": ONE
     * Oracle line (CR 603.2) over two per-creature trigger conditions. Both
     * halves count per creature, so the head does too, and "it" names whichever
     * creature the firing was for.
     */
    | {
          readonly kind: "attacks-or-blocks";
          readonly scope: TriggerSubjectScope;
      }
    /**
     * CR 509.3a — "when this creature blocks": the source declared as a
     * blocker, once each combat however many creatures it blocks. Self only:
     * the one subject the corpus prints with this head.
     */
    | { readonly kind: "blocks" }
    /**
     * CR 509.3c — "whenever this creature becomes blocked": once each combat
     * for that creature, however many creatures block it. Self only. "becomes
     * blocked BY a creature" counts per blocker (CR 509.3d) and is another
     * head.
     */
    | { readonly kind: "becomes-blocked" }
    /** CR 510.1 — "whenever this creature deals combat damage to a player". */
    | { readonly kind: "combat-damage-to-player" }
    /**
     * CR 120.3 — "whenever [this / enchanted] creature deals damage
     * [to an opponent / to a creature]": damage of ANY kind (the words do not
     * say "combat"), to the recipient the words name. `source: "host"` is
     * CR 303.4b's Aura host.
     */
    | {
          readonly kind: "damage-dealt";
          readonly source: "self" | "host";
          readonly recipient: "any" | "opponent" | "creature" | "player";
          /** CR 510.2 — "deals COMBAT damage": the narrowing the words add. */
          readonly combat?: true;
      }
    /**
     * CR 120.3 / 303.4b — "whenever [enchanted / this] creature is dealt
     * damage": the receiver is the Aura's host (`host`) or the source itself
     * (`self`, CR 109.2).
     */
    | { readonly kind: "damage-taken"; readonly scope: "host" | "self" }
    /**
     * CR 508.3a + CR 509.1h — "whenever this creature attacks and isn't
     * blocked": ONE Oracle line over the `ATTACKER_UNBLOCKED` event, emitted
     * once per unblocked attacker when the block graph is final. A different
     * moment from "attacks" (declaration), so a distinct head, never a flag.
     */
    | { readonly kind: "attacks-unblocked" }
    /**
     * CR 708.8 — "when this creature is turned face up": the source, a
     * face-down permanent, turned face up on the battlefield (the morph
     * special action, CR 702.37e). Self only: the event names the one
     * permanent turned up.
     */
    | { readonly kind: "turned-face-up" }
    | { readonly kind: "transforms" }
    /**
     * CR 701.26a — "whenever this land becomes tapped": the source itself
     * going from untapped to tapped, however it was tapped (a {T} cost, a
     * mana ability, an effect). `host` (CR 303.4b) — "whenever enchanted
     * creature becomes tapped": the Aura's host, however it was tapped.
     */
    | { readonly kind: "becomes-tapped"; readonly scope: "self" | "host" }
    /**
     * CR 603.2 + CR 115.1 — "whenever this creature becomes the target of a
     * spell or ability": the source named as a target by any spell or ability,
     * its controller's or not (Ward's opponent narrowing is CR 702.21a's own).
     * `scope: "host"` (CR 303.4b) — "when enchanted creature becomes the
     * target of a spell or ability": the Aura's host is the one targeted.
     * `scope: "yours"` — "whenever a creature you control becomes the target
     * of …": any creature the source's controller controls, the source
     * included.
     *
     * `by` (CR 109.4 — a spell or ability on the stack has a controller)
     * narrows WHOSE spell or ability did the targeting: "… you control" or
     * "… an opponent controls". Absent, any spell or ability's.
     *
     * `firstTimeEachTurn` (CR 603.2) — "… for the first time each turn": the
     * ability triggers on the first such event each turn and never again
     * that turn, read as a once-per-turn cap on the ability counted on its
     * source object (`TriggeredAbility.maxTriggersPerTurn: 1`). The two agree
     * because every event the cap counts is one the head names.
     */
    | {
          readonly kind: "becomes-target";
          readonly scope?: "host" | "yours";
          readonly by?: "you" | "opponent";
          readonly firstTimeEachTurn?: true;
      }
    /**
     * CR 605.1b + CR 303.4b — "whenever enchanted land is tapped for mana":
     * the Aura's host tapped for a mana ability's cost. The tapped land's
     * controller (`$event.controllerId`) is "its controller" of the body.
     * `any` is "whenever a player taps a land for mana" (CR 106.12): every
     * land, whoever controls it, and the player who tapped it is "that
     * player".
     */
    | { readonly kind: "tapped-for-mana"; readonly scope: "host" | "any" }
    /**
     * CR 702.29c — "when you cycle this card": the source discarded to pay a
     * cycling cost. Fires from the zone the card lands in, so the pronoun "it"
     * of the body names the card itself.
     */
    | { readonly kind: "cycled" }
    /**
     * CR 603.8 — "when this creature's power is N or greater": a STATE trigger,
     * not an event one. It fires whenever the source's power is at least
     * `atLeast` at a checkpoint, once per time the state becomes true.
     */
    | { readonly kind: "power-reached"; readonly atLeast: number }
    /** CR 716.2a — "when this Class becomes level N". */
    | { readonly kind: "class-level-gained"; readonly level: number }
    /** CR 603.6a — "at the beginning of [your/each] <step>". */
    | {
          readonly kind: "phase";
          readonly phase: Phase;
          readonly scope:
              | "your"
              | "each"
              | "opponents"
              | "host-controller"
              | "chosen-player";
          /**
           * CR 603.2b — the head NAMES the player whose step it is ("each
           * PLAYER'S upkeep"), which is what gives a later "that player" its
           * antecedent. "At the beginning of each upkeep" fires on exactly
           * the same events but names no one, so it binds nothing: the flag
           * is a fact about the WORDS, and lowering reads it, never the
           * event.
           */
          readonly namesPlayer?: true;
          /**
           * CR 500.1 — a head naming SEVERAL steps ("each of your main
           * phases"): one ability that fires at the beginning of each, so
           * `phase` is the first and this lists all of them.
           */
          readonly phases?: readonly Phase[];
      }
    /**
     * CR 603.2 — "whenever [you / an opponent / a player] casts a spell", with
     * the colour narrowing of CR 105.2 when the words carry one ("a black
     * spell" / "a nonred spell"). Absent = every spell. `self` is "when you
     * cast this spell": the spell cast IS the source, so the trigger
     * condition functions from the stack (CR 113.6k).
     */
    | {
          readonly kind: "spell-cast";
          readonly scope: "you" | "opponent" | "any" | "self";
          readonly filter?: SpellFilter;
          /** CR 601.2i — only the caster's Nth spell this turn fires it. */
          readonly nthSpellThisTurn?: number;
      };

/**
 * CR 603.2 + 105.2 — "whenever <caster> casts a <colour> spell" and its
 * negative "a non<colour> spell": one row per (caster, colour word, polarity),
 * generated from the ONE colour vocabulary the target grammar already reads
 * (`COLOR_WORDS`, CR 105.1), so the two grammars cannot disagree about what
 * "blue" is. The row set is still an exact table — the span must BE a key — so
 * a neighbour the rows do not spell ("a multicolored spell", "a black spell
 * from your hand", "a blue spell or an Island you control enters") stays
 * `unparsed`. "Nonred" excludes the colour (CR 105.2): a colourless spell
 * (CR 105.2c) is a nonred spell, which is why the negative is `excludeColors`
 * and never "any of the other four".
 */
function colourSpellCastHeads(): [string, TriggerHeadIR][] {
    const casters = [
        ["you cast", "you"],
        ["an opponent casts", "opponent"],
        ["a player casts", "any"],
    ] as const;
    const rows: [string, TriggerHeadIR][] = [];
    for (const [phrase, scope] of casters)
        for (const [word, color] of COLOR_WORDS) {
            rows.push([
                `whenever ${phrase} a ${word} spell`,
                { kind: "spell-cast", scope, filter: { colors: [color] } },
            ]);
            rows.push([
                `whenever ${phrase} a non${word} spell`,
                {
                    kind: "spell-cast",
                    scope,
                    filter: { excludeColors: [color] },
                },
            ]);
        }
    return rows;
}

/**
 * CR 603.2 + 205.2a — "when[ever] <caster> casts a <type> spell": one row per
 * (opener, caster, card type). Exact rows over the three type words the corpus
 * prints on a cast head (CR 205.2a: creature, enchantment, instant); a
 * neighbour the rows do not spell ("an artifact spell", "a creature spell with
 * flying") stays `unparsed`. The type narrows the SAME `spell-cast` head the
 * colour rows narrow (`SpellFilter.types`), so the event, the scope and the
 * lowering are shared.
 */
function typeSpellCastHeads(): [string, TriggerHeadIR][] {
    const casters = [
        ["you cast", "you"],
        ["an opponent casts", "opponent"],
        ["a player casts", "any"],
    ] as const;
    const types: readonly (readonly [string, readonly CardType[]])[] = [
        ["a creature spell", ["Creature"]],
        ["an enchantment spell", ["Enchantment"]],
        ["an instant spell", ["Instant"]],
        // `SpellFilter.types` is any-of (`matchesSpellFilter`), so "or" is the
        // filter's own semantics, as the colour list below it.
        ["an instant or sorcery spell", ["Instant", "Sorcery"]],
    ];
    const rows: [string, TriggerHeadIR][] = [];
    for (const opener of ["when", "whenever"])
        for (const [phrase, scope] of casters)
            for (const [noun, wanted] of types)
                rows.push([
                    `${opener} ${phrase} ${noun}`,
                    {
                        kind: "spell-cast",
                        scope,
                        filter: { types: [...wanted] },
                    },
                ]);
    return rows;
}

/**
 * Heads whose subject is NOT the source. Exact phrases, lowercase.
 *
 * "the end step" is deliberately absent while "your end step" and "each end
 * step" are present: CR 500.1 gives every turn an end step, so the unqualified
 * phrase means EACH player's — and reading it as the controller's would make a
 * symmetric ability one-sided, which is the shape of bug that survives a whole
 * playtest. It is spelled out as `each` below rather than left to a default.
 */
export const OTHER_HEADS: ReadonlyMap<string, TriggerHeadIR> = new Map<
    string,
    TriggerHeadIR
>([
    // CR 603.6a — entering permanents, by controller relation.
    [
        "whenever another creature enters",
        { kind: "enters", scope: "any-other", creaturesOnly: true },
    ],
    [
        "whenever another creature you control enters",
        { kind: "enters", scope: "another-yours", creaturesOnly: true },
    ],
    [
        "whenever a creature enters",
        { kind: "enters", scope: "any", creaturesOnly: true },
    ],
    [
        "whenever a creature you control enters",
        { kind: "enters", scope: "yours", creaturesOnly: true },
    ],
    [
        "whenever a creature an opponent controls enters",
        { kind: "enters", scope: "opponents", creaturesOnly: true },
    ],
    // CR 603.6a + CR 205.3i — an entering permanent of yours narrowed by a
    // land subtype. The one subtype the corpus prints on this head; another
    // land type, "a land you control" or "an opponent controls" is a
    // neighbour that earns its own row and fixture.
    [
        "whenever a forest you control enters",
        {
            kind: "enters",
            scope: "yours",
            creaturesOnly: false,
            subtypes: ["Forest"],
        },
    ],
    // CR 603.6a + CR 205.2a — a land entering, whoever controls it. "A land
    // you control" and "an opponent controls" are neighbours that earn their
    // own row and fixture.
    [
        "whenever a land enters",
        {
            kind: "enters",
            scope: "any",
            creaturesOnly: false,
            permanentType: "Land",
        },
    ],
    // CR 603.6 — a creature dying. The event is `CREATURE_DIED`, so the type
    // narrowing is the EVENT's, not a filter's — a "creaturesOnly" flag here
    // would be a second, redundant authority on the same fact.
    // CR 508.3a — an attack declaration, read per attacking creature. Only the
    // two scopes the corpus prints: "a creature you control attacks" and the
    // symmetric "a creature attacks or blocks". Every neighbouring phrase
    // ("attacks a player", "attacks or enters attacking", "attacks this turn")
    // narrows the condition further and stays refused under its own gap key —
    // a head that swallowed the narrowing would fire on attacks the card does
    // not mean.
    [
        "whenever a creature you control attacks",
        { kind: "attacks", scope: "yours" },
    ],
    // CR 509.3a — the blocking half is symmetric too ("a creature", not "a
    // creature you control"): Powerstone Minefield hits either player's.
    [
        "whenever a creature attacks or blocks",
        { kind: "attacks-or-blocks", scope: "any" },
    ],
    // CR 603.6c + 400.7e — a card reaching a graveyard from ANYWHERE. Exact
    // rows over the two forms the corpus prints; "a creature card", "from the
    // battlefield" and the other owners are separate heads that earn their own
    // row and fixture.
    [
        "whenever another card is put into a graveyard from anywhere",
        { kind: "graveyard-entry", graveyard: "any", excludeSelf: true },
    ],
    [
        "whenever a black card is put into an opponent's graveyard from anywhere",
        { kind: "graveyard-entry", graveyard: "opponents", colors: ["B"] },
    ],
    // CR 603.6c + 404.1 + 603.2 — Sacred Ground's one printed phrase: a LAND
    // put into YOUR graveyard from the battlefield by an opponent's spell or
    // ability (a state-based action or a cost is no such cause).
    [
        "whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield",
        {
            kind: "left-to-graveyard",
            scope: "any",
            permanentType: "Land",
            ownedBy: "you",
            causedBy: "opponent",
        },
    ],
    ["whenever a creature dies", { kind: "dies", scope: "any" }],
    ["whenever another creature dies", { kind: "dies", scope: "any-other" }],
    ["whenever a creature you control dies", { kind: "dies", scope: "yours" }],
    [
        "whenever another creature you control dies",
        { kind: "dies", scope: "another-yours" },
    ],
    [
        "whenever a creature an opponent controls dies",
        { kind: "dies", scope: "opponents" },
    ],
    // CR 303.4b / 603.10a — the Aura's host dying. A leaves-the-battlefield
    // trigger looks back in time, so the Aura (put into the graveyard by the
    // SBA only afterwards, CR 704.5m) still sees what it enchanted.
    ["when enchanted creature dies", { kind: "dies", scope: "host" }],
    // CR 701.26a + CR 303.4b — the Aura's host becoming tapped, by any means.
    [
        "whenever enchanted creature becomes tapped",
        { kind: "becomes-tapped", scope: "host" },
    ],
    // CR 603.2 + CR 303.4b — the Aura's host becoming the target of a spell
    // or ability. The corpus prints "when", and only "when", for it.
    [
        "when enchanted creature becomes the target of a spell or ability",
        { kind: "becomes-target", scope: "host" },
    ],
    // CR 603.2 + CR 109.4 — any creature the source's controller controls
    // becoming the target of a spell or ability an opponent controls.
    [
        "whenever a creature you control becomes the target of a spell or ability an opponent controls",
        { kind: "becomes-target", scope: "yours", by: "opponent" },
    ],
    // CR 120.3 / 303.4b — the Aura host dealing or being dealt damage. Only the
    // forms the corpus prints: "…deals damage to an opponent" on an Aura is a
    // different recipient scope and earns its own row when a card needs it.
    [
        "whenever enchanted creature deals damage",
        { kind: "damage-dealt", source: "host", recipient: "any" },
    ],
    [
        "whenever enchanted creature is dealt damage",
        { kind: "damage-taken", scope: "host" },
    ],
    // CR 605.1b + CR 303.4b — the Aura host tapped for mana.
    [
        "whenever enchanted land is tapped for mana",
        { kind: "tapped-for-mana", scope: "host" },
    ],
    // CR 106.12 + CR 605.1b — any land tapped for a mana ability's cost; the
    // player who tapped it is its controller (CR 602.2: only an object's
    // controller activates its activated abilities).
    [
        "whenever a player taps a land for mana",
        { kind: "tapped-for-mana", scope: "any" },
    ],
    // CR 603.6a — step boundaries (CR 500.1).
    [
        "at the beginning of your upkeep",
        { kind: "phase", phase: "UPKEEP", scope: "your" },
    ],
    [
        "at the beginning of each upkeep",
        { kind: "phase", phase: "UPKEEP", scope: "each" },
    ],
    [
        "at the beginning of each player's upkeep",
        { kind: "phase", phase: "UPKEEP", scope: "each", namesPlayer: true },
    ],
    // CR 603.2b — the upkeep of each player other than the controller; the
    // head names that player ("that player"), as an opponent.
    [
        "at the beginning of each opponent's upkeep",
        {
            kind: "phase",
            phase: "UPKEEP",
            scope: "opponents",
            namesPlayer: true,
        },
    ],
    // CR 614.12 + CR 603.2b — the player the source chose as it entered ("As
    // this artifact enters, choose an opponent"): the head fires on THAT
    // player's upkeep and names them, so "that player" has its antecedent.
    [
        "at the beginning of the chosen player's upkeep",
        {
            kind: "phase",
            phase: "UPKEEP",
            scope: "chosen-player",
            namesPlayer: true,
        },
    ],
    [
        "at the beginning of your draw step",
        { kind: "phase", phase: "DRAW", scope: "your" },
    ],
    [
        "at the beginning of your end step",
        { kind: "phase", phase: "END_STEP", scope: "your" },
    ],
    [
        "at the beginning of each end step",
        { kind: "phase", phase: "END_STEP", scope: "each" },
    ],
    // CR 513.1 + CR 603.2b — the same events as "each end step", but the
    // head NAMES the player whose end step it is: "that player".
    [
        "at the beginning of each player's end step",
        { kind: "phase", phase: "END_STEP", scope: "each", namesPlayer: true },
    ],
    // CR 500.1 — every turn has an end step, and the unqualified phrase names
    // each player's (see the header note above): the same event as "each end
    // step", so the same descriptor.
    [
        "at the beginning of the end step",
        { kind: "phase", phase: "END_STEP", scope: "each" },
    ],
    // CR 303.4b + CR 603.2b — an Aura's upkeep trigger fires on the upkeep of
    // the player controlling the enchanted creature, who is "that player".
    [
        "at the beginning of the upkeep of enchanted creature's controller",
        {
            kind: "phase",
            phase: "UPKEEP",
            scope: "host-controller",
            namesPlayer: true,
        },
    ],
    // CR 505.1 — the first main phase is the precombat main phase.
    [
        "at the beginning of each player's first main phase",
        {
            kind: "phase",
            phase: "PRECOMBAT_MAIN",
            scope: "each",
            namesPlayer: true,
        },
    ],
    // CR 505.1 + CR 505.1a — a turn has a precombat and a postcombat main
    // phase; "each of your main phases" is ONE ability firing at the
    // beginning of both (CR 603.2), not two.
    [
        "at the beginning of each of your main phases",
        {
            kind: "phase",
            phase: "PRECOMBAT_MAIN",
            phases: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
            scope: "your",
        },
    ],
    [
        "at the beginning of combat on your turn",
        { kind: "phase", phase: "BEGINNING_OF_COMBAT", scope: "your" },
    ],
    // CR 603.2b — the combat of a player other than the
    // controller; the head names that player ("that player", "that opponent").
    [
        "at the beginning of combat on each opponent's turn",
        {
            kind: "phase",
            phase: "BEGINNING_OF_COMBAT",
            scope: "opponents",
            namesPlayer: true,
        },
    ],
    // CR 603.2 — casting.
    ["whenever you cast a spell", { kind: "spell-cast", scope: "you" }],
    // CR 601.2i — the caster's own tally of spells this turn.
    [
        "whenever you cast your second spell each turn",
        { kind: "spell-cast", scope: "you", nthSpellThisTurn: 2 },
    ],
    [
        "whenever an opponent casts a spell",
        { kind: "spell-cast", scope: "opponent" },
    ],
    ["whenever a player casts a spell", { kind: "spell-cast", scope: "any" }],
    // The "when" opener reads the same event as "whenever" (CR 603.1): only
    // the plain "a player casts a spell" is printed with it.
    ["when a player casts a spell", { kind: "spell-cast", scope: "any" }],
    ...colourSpellCastHeads(),
    // CR 105.2 — a colour LIST: any-of, which is `SpellFilter.colors`' own
    // semantics (`matchesSpellFilter` — "some wanted colour is on the spell").
    [
        "whenever you cast a spell that's white, blue, black, or red",
        {
            kind: "spell-cast",
            scope: "you",
            filter: { colors: ["W", "U", "B", "R"] },
        },
    ],
    // CR 105.2b — "a multicolored spell" names no colour: two or more of the
    // five, a COUNT bound (`SpellFilter.colorCountAtLeast`), never an OR over
    // the colours (that reading admits every monocolored spell). Colourless
    // fails it (CR 105.2c). Only "you" and "an opponent" are printed with it.
    [
        "whenever you cast a multicolored spell",
        { kind: "spell-cast", scope: "you", filter: { colorCountAtLeast: 2 } },
    ],
    [
        "whenever an opponent casts a multicolored spell",
        {
            kind: "spell-cast",
            scope: "opponent",
            filter: { colorCountAtLeast: 2 },
        },
    ],
    ...typeSpellCastHeads(),
    // CR 603.2 + 205.2a — "a noncreature spell" is a spell without the
    // creature card type: the negative of the type rows above, the same
    // `SpellFilter.excludeTypes` a hand-written "noncreature" cast trigger
    // declares. Only the "you" caster is printed on a cast head with it.
    [
        "whenever you cast a noncreature spell",
        {
            kind: "spell-cast",
            scope: "you",
            filter: { excludeTypes: ["Creature"] },
        },
    ],
    // CR 603.2 + CR 113.6k — the spell being cast is the source itself; the
    // condition cannot trigger from the battlefield, so it functions from the
    // stack.
    ["when you cast this spell", { kind: "spell-cast", scope: "self" }],
    // CR 505.1 + CR 505.1a — the first main phase is the precombat main
    // phase, and a turn has only one.
    [
        "at the beginning of your first main phase",
        { kind: "phase", phase: "PRECOMBAT_MAIN", scope: "your" },
    ],
    // CR 701.21a — only a permanent's controller can sacrifice it, so "you
    // sacrifice" is a land YOU control moved to its owner's graveyard by a
    // sacrifice.
    [
        "whenever you sacrifice a land",
        { kind: "sacrificed", scope: "yours", permanentType: "Land" },
    ],
    // CR 701.23a — the act of searching triggers it, found or not; "their
    // library" is the searcher's own.
    [
        "whenever an opponent searches their library",
        { kind: "library-searched", scope: "opponents" },
    ],
    // CR 702.174c — a gift-paid instant or sorcery of yours, or a gift
    // trigger of a permanent you control, resolving.
    ["whenever you give a gift", { kind: "gift-given", scope: "you" }],
    // CR 701.61a — the controller performed either half of forage.
    ["whenever you forage", { kind: "foraged", scope: "you" }],
    // CR 119.9 — "you" is the ability's controller; an opponent's gain is
    // another head.
    ["whenever you gain life", { kind: "life-gained", scope: "you" }],
    // CR 119.3 + CR 603.2 — either change of the controller's life total,
    // only while it is the controller's turn.
    [
        "whenever you gain or lose life during your turn",
        { kind: "life-gained-or-lost", scope: "you", duringYourTurn: true },
    ],
]);

/** Self-subject heads: `<opener> <self phrase> <tail>` (CR 109.2). */
export const SELF_HEADS: readonly {
    readonly opener: string;
    readonly tail: string;
    readonly ir: TriggerHeadIR;
}[] = [
    {
        opener: "when ",
        tail: " enters",
        ir: { kind: "enters", scope: "self", creaturesOnly: false },
    },
    { opener: "when ", tail: " dies", ir: { kind: "dies", scope: "self" } },
    {
        opener: "when ",
        tail: " leaves the battlefield",
        ir: { kind: "leaves", scope: "self" },
    },
    // CR 603.2 + 603.6a + 603.6c — the source's own entry OR its own
    // departure, one line.
    {
        opener: "when ",
        tail: " enters or leaves the battlefield",
        ir: { kind: "enters-or-leaves" },
    },
    // CR 603.6c — a battlefield exit that ends in a graveyard, any permanent.
    {
        opener: "when ",
        tail: " is put into a graveyard from the battlefield",
        ir: { kind: "left-to-graveyard", scope: "self" },
    },
    // CR 603.6c / 113.6k — the card's own trip from your library to your
    // graveyard (the mill).
    {
        opener: "when ",
        tail: " is put into your graveyard from your library",
        ir: { kind: "library-to-graveyard" },
    },
    {
        opener: "whenever ",
        tail: " attacks",
        ir: { kind: "attacks", scope: "self" },
    },
    // CR 603.1 — the "when" opener reads the same event as "whenever".
    {
        opener: "when ",
        tail: " attacks",
        ir: { kind: "attacks", scope: "self" },
    },
    // CR 702.171b — the Mount's "attacks while saddled": the source's own
    // attack, triggering only while it carries the saddled designation.
    {
        opener: "whenever ",
        tail: " attacks while saddled",
        ir: { kind: "attacks", scope: "self", whileSaddled: true },
    },
    // CR 506.5 — the source is the only creature declared as an attacker.
    {
        opener: "whenever ",
        tail: " attacks alone",
        ir: { kind: "attacks", scope: "self", alone: true },
    },
    // CR 508.3a + CR 509.3a — the source's own attack OR its own block, one
    // line.
    {
        opener: "whenever ",
        tail: " attacks or blocks",
        ir: { kind: "attacks-or-blocks", scope: "self" },
    },
    // CR 509.3c — the source becoming a blocked creature, by any number of
    // blockers.
    {
        opener: "whenever ",
        tail: " becomes blocked",
        ir: { kind: "becomes-blocked" },
    },
    // CR 603.2 — the source's own entry OR its own attack, one line.
    {
        opener: "whenever ",
        tail: " enters or attacks",
        ir: { kind: "enters-or-attacks" },
    },
    // CR 603.2 + CR 603.6a + CR 603.2b — the source's own entry AND its
    // controller's every upkeep, one line. The corpus prints only "your".
    {
        opener: "when ",
        tail: " enters and at the beginning of your upkeep",
        ir: { kind: "enters-or-upkeep" },
    },
    // CR 603.2 + CR 603.6a + CR 701.21a — the source's own entry AND its own
    // sacrifice, one line. "When you sacrifice it" names the source, which
    // only its controller can sacrifice.
    {
        opener: "when ",
        tail: " enters and when you sacrifice it",
        ir: { kind: "enters-or-sacrificed" },
    },
    // CR 509.3a — the source's own declaration as a blocker. "blocks a
    // creature", "blocks or becomes blocked" and the "whenever" opener are
    // other heads, refused until a rule reads them.
    {
        opener: "when ",
        tail: " blocks",
        ir: { kind: "blocks" },
    },
    {
        opener: "whenever ",
        tail: " deals combat damage to a player",
        ir: { kind: "combat-damage-to-player" },
    },
    // CR 120.3 — damage of any kind, to the recipient the tail names.
    {
        opener: "whenever ",
        tail: " deals damage",
        ir: { kind: "damage-dealt", source: "self", recipient: "any" },
    },
    {
        opener: "whenever ",
        tail: " deals damage to an opponent",
        ir: { kind: "damage-dealt", source: "self", recipient: "opponent" },
    },
    {
        opener: "whenever ",
        tail: " deals damage to a creature",
        ir: { kind: "damage-dealt", source: "self", recipient: "creature" },
    },
    // CR 510.2 + CR 120.3 — the combat damage alone, to a creature.
    {
        opener: "whenever ",
        tail: " deals combat damage to a creature",
        ir: {
            kind: "damage-dealt",
            source: "self",
            recipient: "creature",
            combat: true,
        },
    },
    // CR 120.3 + CR 102.1 — damage of any kind to a PLAYER (either one: "a
    // player" is symmetric, unlike "an opponent").
    {
        opener: "whenever ",
        tail: " deals damage to a player",
        ir: { kind: "damage-dealt", source: "self", recipient: "player" },
    },
    // CR 120.3 — the source as the receiver; "that much" is the amount dealt.
    {
        opener: "whenever ",
        tail: " is dealt damage",
        ir: { kind: "damage-taken", scope: "self" },
    },
    // CR 509.1h — the block graph is final and this attacker has no blocker.
    {
        opener: "whenever ",
        tail: " attacks and isn't blocked",
        ir: { kind: "attacks-unblocked" },
    },
    // CR 708.8 — the source itself turned face up on the battlefield.
    {
        opener: "when ",
        tail: " is turned face up",
        ir: { kind: "turned-face-up" },
    },
    // CR 701.27e — the source transformed and has the named characteristic
    // right after. `{self}` names the face now up, and only that face carries
    // the ability, so the two openers read the same event (CR 603.1).
    {
        opener: "when ",
        tail: " transforms into {self}",
        ir: { kind: "transforms" },
    },
    {
        opener: "whenever ",
        tail: " transforms into {self}",
        ir: { kind: "transforms" },
    },
    // CR 701.26a — the source itself becoming tapped, by any means.
    {
        opener: "whenever ",
        tail: " becomes tapped",
        ir: { kind: "becomes-tapped", scope: "self" },
    },
    // CR 603.2 — the source becoming the target of a spell or ability.
    {
        opener: "whenever ",
        tail: " becomes the target of a spell or ability",
        ir: { kind: "becomes-target" },
    },
    // CR 603.2 + CR 109.4 — the source becoming the target of a spell or
    // ability its own controller controls, the first time each turn (the
    // Valiant ability word, CR 207.2c, is dropped by the triggered slot).
    {
        opener: "whenever ",
        tail: " becomes the target of a spell or ability you control for the first time each turn",
        ir: { kind: "becomes-target", by: "you", firstTimeEachTurn: true },
    },
    // CR 702.29c — "when you cycle this card" (the subject is "you cycle X").
    {
        opener: "when you cycle ",
        tail: "",
        ir: { kind: "cycled" },
    },
];

/**
 * CR 201.5 — text naming the object it is on means just that object. A plural
 * name ("Gert and Old Lace", "The Neutrinos") prints the plural verb, nothing
 * more: the same self head, spelled for the name alone, so the
 * key is the literal `{self}` and "this creature attack" (no English) stays
 * unread. One row per phrase the corpus prints, each the IR of its singular row
 * in `SELF_HEADS`; a plural with no singular head ("attack or block", "become
 * untapped") has nothing to be the spelling of and stays refused.
 */
const PLURAL_NAME_HEADS: ReadonlyMap<string, TriggerHeadIR> = new Map<
    string,
    TriggerHeadIR
>([
    [
        "when {self} enter",
        { kind: "enters", scope: "self", creaturesOnly: false },
    ],
    ["when {self} die", { kind: "dies", scope: "self" }],
    ["whenever {self} attack", { kind: "attacks", scope: "self" }],
    ["whenever {self} enter or attack", { kind: "enters-or-attacks" }],
    [
        "whenever {self} deal combat damage to a player",
        { kind: "combat-damage-to-player" },
    ],
    [
        "whenever {self} become tapped",
        { kind: "becomes-tapped", scope: "self" },
    ],
]);

/**
 * The SELF-subject branch, on its own, so the disjointness claim below is
 * testable rather than asserted in prose (review of PR #3024).
 *
 * Returns the head when the span is `<opener><self phrase><tail>`, else null.
 */
export function matchSelfHead(span: string): TriggerHeadIR | null {
    const probe = span.toLowerCase();
    // CR 603.8 — the one self head with a number in its tail, so it is a
    // pattern rather than a table row.
    const power = POWER_REACHED.exec(span);
    if (power !== null && isSelfPhrase(power[1]!))
        return { kind: "power-reached", atLeast: Number(power[2]) };
    const gained = CLASS_LEVEL_GAINED.exec(span);
    if (gained !== null)
        return { kind: "class-level-gained", level: Number(gained[1]) };
    const pluralName = PLURAL_NAME_HEADS.get(probe);
    if (pluralName !== undefined) return pluralName;
    for (const head of SELF_HEADS) {
        if (!probe.startsWith(head.opener)) continue;
        if (!probe.endsWith(head.tail)) continue;
        const subject = span.slice(
            head.opener.length,
            span.length - head.tail.length
        );
        if (!isSelfPhrase(subject)) continue;
        return head.ir;
    }
    return null;
}

/**
 * CR 608.2h — what a sentence-leading "it" names behind this head, or null
 * when the head names no object at all and the pronoun must stay unread.
 *
 * ONE authority for a fact two layers need: the GRAMMAR asks only whether the
 * pronoun has a referent (a head that names none refuses the line rather than
 * pointing it at a guess), and the LOWERING turns the answer into the selector
 * the Effect Script carries. Splitting them would let the two disagree — a
 * line the grammar accepts and the lowering then binds to the wrong object is
 * exactly the silent misread this compiler exists to prevent.
 *
 *  - `"source"` — the head's subject IS the object the ability is printed on
 *    ("Whenever {self} attacks, IT gets …", CR 109.2).
 *  - `"combatant"` — the head fires per attacking or blocking CREATURE and
 *    names that creature (CR 508.3a / 509.3a), which is not the source.
 */
export function headPronounReferent(
    head: TriggerHeadIR
): "source" | "combatant" | "host" | null {
    switch (head.kind) {
        case "enters":
        case "dies":
            return head.scope === "self" ? "source" : null;
        // CR 508.3a / 509.3a — under `self` the creature the firing names is
        // the source.
        case "attacks":
        case "attacks-or-blocks":
            return head.scope === "self" ? "source" : "combatant";
        // CR 201.5 — both halves name the source itself.
        case "enters-or-attacks":
        case "enters-or-upkeep":
        case "combat-damage-to-player":
        case "attacks-unblocked":
        case "becomes-blocked":
            return "source";
        // CR 509.3a — the blocker the head names is the source itself.
        case "blocks":
            return "source";
        // CR 708.8 — the permanent turned face up is the source itself.
        case "turned-face-up":
            return "source";
        // CR 701.27e — the permanent that transformed is the source itself.
        case "transforms":
            return "source";
        // CR 303.4b — "enchanted creature" names the Aura's host, not the Aura.
        // CR 608.2h — "deals damage to a creature" names a second creature,
        // nearer than the source, so "it" is a guess between the two.
        case "damage-dealt":
            return head.source === "self" && head.recipient !== "creature"
                ? "source"
                : null;
        // CR 603.6c — the source has LEFT; "it" would name a new object in
        // whatever zone it went to (CR 400.7), which no selector here reads.
        // An enters-or-leaves firing may be either, so "it" stays unread too.
        case "leaves":
        case "enters-or-leaves":
        case "enters-or-sacrificed":
        case "leaves-without-dying":
            return null;
        // CR 400.7 — the source went to a graveyard and is the object "it"
        // names there; the engine recovers `$source` from that graveyard
        // (`moveZone`). Only the self form: the non-self ones name another card.
        case "left-to-graveyard":
            return head.scope === "self" ? "source" : null;
        // CR 400.7 — the source is the card that moved and sits in the graveyard
        // it reached; `$source` finds it there (`moveZone`).
        case "library-to-graveyard":
            return "source";
        case "graveyard-entry":
            return null;
        // CR 120.3 — `self`: the source is the receiver and is still the
        // object "it" names; `host` names the Aura's host, not the Aura.
        case "damage-taken":
            return head.scope === "self" ? "source" : null;
        // CR 701.26a — the tapped permanent: the source itself, or the
        // Aura's host (CR 303.4b).
        case "becomes-tapped":
            return head.scope === "host" ? "host" : "source";
        // CR 603.2 — the targeted permanent: the source itself, or the
        // Aura's host (CR 303.4b).
        // `yours` names a creature the event picks, which "it" never does.
        case "becomes-target":
            return head.scope === "host"
                ? "host"
                : head.scope === "yours"
                  ? null
                  : "source";
        // CR 303.4b — "its controller" names the host's, not the Aura's.
        case "tapped-for-mana":
            return null;
        // CR 702.29c — "it" is the cycled card, i.e. the source.
        case "cycled":
            return "source";
        // CR 603.8 — the state belongs to the source itself.
        case "power-reached":
            return "source";
        // CR 716.2a — so does the level.
        case "class-level-gained":
            return "source";
        // CR 119.3 — a life-change head names a player, never an object.
        case "phase":
        case "spell-cast":
        case "sacrificed":
        case "library-searched":
        case "gift-given":
        case "expend":
        case "foraged":
        case "life-gained":
        case "life-gained-or-lost":
            return null;
    }
}

/**
 * CR 102.2 — true when the head's own words name ONE player who is an opponent
 * of the ability's controller, so "that player controls" in the body is that
 * opponent's side of the battlefield.
 */
export function headNamesOpponent(head: TriggerHeadIR): boolean {
    return head.kind === "phase" && head.scope === "opponents";
}

/** CR 700.14 — "whenever you expend N": the numeral is the threshold. Only
 *  "you" is printed; the leading-zero and multi-digit-zero forms are no
 *  printed N and stay refused. */
const YOU_EXPEND = /^whenever you expend ([1-9]\d*)$/;

/** CR 603.6a + 202.3 — an entering creature gated on a mana-value floor. */
const ENTERS_MANA_VALUE_FLOOR =
    /^when(?:ever)? a creature with mana value (\d+) or greater enters$/;

/** CR 603.6a + 208.1 — an entering creature of yours gated on a power floor. */
const YOURS_ENTERS_POWER_FLOOR =
    /^whenever a creature you control with power (\d+) or greater enters$/;

/**
 * CR 603.6a + 205.3 — "whenever another [nontoken] <subtypes> you control
 * enters": the entering permanent of yours, other than the source, narrowed by
 * the subtype words between. Only the frame is a pattern; the middle must BE
 * one creature or artifact type (CR 205.3m / 205.3g) or an "or" list of them
 * (`readSubtypeList`), so "another creature or artifact", "another Shrine" (an
 * enchantment type), "another Forest" (a land type, no fixture here) and a
 * plural "one or more other Elves … enter" (CR 603.2c) stay refused.
 */
const ANOTHER_SUBTYPE_YOURS_ENTERS =
    /^whenever another (nontoken )?(.+) you control enters$/i;

/**
 * CR 603.2 + 205.3m — "whenever you cast a <creature type> spell": ONE creature
 * subtype narrowing the cast spell (`SpellFilter.subtypes`). A spell subtype
 * ("a Spirit or Arcane spell", "an Adventure spell"), a list and the other
 * casters are neighbours with no fixture here and stay refused.
 */
const YOU_CAST_SUBTYPE_SPELL = /^whenever you cast an? (\S+) spell$/i;

/**
 * CR 603.2 + 205.2a + 205.3m — "whenever you cast a noncreature or <creature
 * type> spell": a union over two filter dimensions, so it is `SpellFilter.any`
 * (a creature spell of the type qualifies, a noncreature spell of any type).
 */
const YOU_CAST_NONCREATURE_OR_SUBTYPE_SPELL =
    /^whenever you cast a noncreature or (\S+) spell$/i;

/**
 * CR 603.6c + 205.3 — "whenever a <subtype> is put into a graveyard from the
 * battlefield": ANY player's permanent of that subtype (a token included —
 * it goes to the graveyard before it ceases to exist, CR 111.7).
 */
const SUBTYPE_LEFT_TO_GRAVEYARD =
    /^whenever an? (\S+) is put into a graveyard from the battlefield$/i;

/** CR 205.3m / 205.3g — a creature type or an artifact type. */
function isCreatureOrArtifactType(word: string): boolean {
    return CREATURE_SUBTYPES.has(word) || ARTIFACT_SUBTYPES.has(word);
}

/** One creature or artifact type, or an "or" list of singular ones; else null. */
function readSubtypeOrList(phrase: string): readonly string[] | null {
    if (isCreatureOrArtifactType(phrase)) return [phrase];
    const list = readSubtypeList(phrase);
    return list !== null &&
        list.conjunction === "or" &&
        list.number === "singular" &&
        list.subtypes.every(isCreatureOrArtifactType)
        ? list.subtypes
        : null;
}

/** The subtype-narrowed heads above, or null when the span is none of them. */
function matchSubtypeHead(span: string): TriggerHeadIR | null {
    const entering = ANOTHER_SUBTYPE_YOURS_ENTERS.exec(span);
    if (entering !== null) {
        const subtypes = readSubtypeOrList(entering[2]!);
        if (subtypes === null) return null;
        return {
            kind: "enters",
            scope: "another-yours",
            creaturesOnly: false,
            subtypes,
            ...(entering[1] !== undefined ? { nontoken: true as const } : {}),
        };
    }
    const union = YOU_CAST_NONCREATURE_OR_SUBTYPE_SPELL.exec(span);
    if (union !== null)
        return CREATURE_SUBTYPES.has(union[1]!)
            ? {
                  kind: "spell-cast",
                  scope: "you",
                  filter: {
                      any: [
                          { excludeTypes: ["Creature"] },
                          { subtypes: [union[1]!] },
                      ],
                  },
              }
            : null;
    const cast = YOU_CAST_SUBTYPE_SPELL.exec(span);
    if (cast !== null)
        return CREATURE_SUBTYPES.has(cast[1]!)
            ? {
                  kind: "spell-cast",
                  scope: "you",
                  filter: { subtypes: [cast[1]!] },
              }
            : null;
    const left = SUBTYPE_LEFT_TO_GRAVEYARD.exec(span);
    if (left !== null)
        return isCreatureOrArtifactType(left[1]!)
            ? { kind: "left-to-graveyard", scope: "any", subtypes: [left[1]!] }
            : null;
    return null;
}

/**
 * "whenever <self> or another <noun> you control <event>": the subject is a
 * disjunction of the source (CR 201.5) and every OTHER permanent of yours the
 * noun names (CR 109.2). Only the frame is a pattern; the noun and the event
 * are read from the combinations the corpus prints, each with its fixture:
 *
 *  - CR 603.6a — "or another creature you control enters";
 *  - CR 603.6a + 205.3m — "or another <one creature type> you control enters";
 *  - CR 603.6c + 700.4 — "or another creature you control leaves the
 *    battlefield without dying".
 *
 * Every reading is scope `yours`: the source is one of the permanents of yours
 * the noun names, so "this or another X of yours" is "an X of yours". That
 * collapse holds only when the source IS an X, which the lowering checks
 * against the card's printed type line (`lower.ts`, fail-closed): a card whose
 * printed subtypes lack the type the head names is refused, never read as if
 * it had it. CR 201.5 — the source is the X it is printed as unless an effect
 * changes it; a source stripped of the type before the event does not fire
 * its own half here, the reading every hand-written "this or another" head
 * already makes (scope `yours` + the noun's filter).
 *
 * Refused neighbours: "… with flying" (a keyword narrowing — no zone-change
 * event carries the moving permanent's abilities, so `requireAbility` there
 * would never match), "… with toughness greater than its power" (no filter
 * field), "another artifact", a plural or a type list, and "dies" (no
 * fixture here), each under its own gap key.
 */
const SELF_OR_ANOTHER_YOURS =
    /^whenever (.+?) or another (.+?) you control (enters|leaves the battlefield without dying)$/i;

export function matchSelfOrAnotherHead(span: string): TriggerHeadIR | null {
    const m = SELF_OR_ANOTHER_YOURS.exec(span);
    if (m === null || !isSelfPhrase(m[1]!)) return null;
    const noun = m[2]!;
    const event = m[3]!.toLowerCase();
    if (event === "enters") {
        if (noun.toLowerCase() === "creature")
            return {
                kind: "enters",
                scope: "yours",
                creaturesOnly: true,
                orSelf: true,
            };
        return CREATURE_SUBTYPES.has(noun)
            ? {
                  kind: "enters",
                  scope: "yours",
                  creaturesOnly: false,
                  subtypes: [noun],
                  orSelf: true,
              }
            : null;
    }
    return noun.toLowerCase() === "creature"
        ? { kind: "leaves-without-dying", scope: "yours", orSelf: true }
        : null;
}

/**
 * The head of a triggered ability, consumed whole.
 *
 * The self branch is tried first and returns immediately, but that is NOT a
 * priority ladder: the two tables are disjoint by construction — every
 * `OTHER_HEADS` key names a subject `isSelfPhrase` rejects ("a creature",
 * "another creature you control"), and every `SELF_HEADS` match requires a
 * subject it accepts. `__tests__/triggered.test.ts` sweeps BOTH tables against
 * the other branch and asserts no phrase is read by both, so an overlap
 * introduced later reds the suite instead of silently making the reading order
 * load-bearing.
 */
export const triggerHeadRule: Rule<TriggerHeadIR> = subGrammar(
    TRIGGER_HEAD,
    rule(TRIGGER_HEAD, (span) => {
        const self = matchSelfHead(span);
        if (self !== null) return ok(self);
        const other = OTHER_HEADS.get(span.toLowerCase());
        if (other !== undefined) return ok(other);
        // CR 603.6a + 202.3 — "when[ever] a creature with mana value N or
        // greater enters": the numeral is read, not enumerated.
        const floor = ENTERS_MANA_VALUE_FLOOR.exec(span.toLowerCase());
        if (floor !== null)
            return ok({
                kind: "enters",
                scope: "any",
                creaturesOnly: true,
                manaValueAtLeast: Number(floor[1]),
            });
        // CR 700.14 — "whenever you expend N": the numeral is read, not
        // enumerated.
        const expend = YOU_EXPEND.exec(span.toLowerCase());
        if (expend !== null)
            return ok({
                kind: "expend",
                scope: "you",
                amount: Number(expend[1]),
            });
        // CR 201.5 + CR 109.2 — "<self> or another <noun> you control …".
        const selfOrAnother = matchSelfOrAnotherHead(span);
        if (selfOrAnother !== null) return ok(selfOrAnother);
        // CR 205.3 — a head narrowed by subtype words.
        const subtyped = matchSubtypeHead(span);
        if (subtyped !== null) return ok(subtyped);
        // CR 603.6a + 208.1 — the power floor, read the same way.
        const powerFloor = YOURS_ENTERS_POWER_FLOOR.exec(span.toLowerCase());
        if (powerFloor !== null)
            return ok({
                kind: "enters",
                scope: "yours",
                creaturesOnly: true,
                powerAtLeast: Number(powerFloor[1]),
            });
        return fail("not a trigger head this grammar knows", span);
    }),
    // CR 603.1 — a triggered ability opens with "when", "whenever" or "at".
    (span) => TRIGGER_OPENER.test(span)
);
