/**
 * Shared sub-grammar: VERB FRAMES and the Composition Rules that join them —
 * "Search your library for a card, put that card into your hand, then
 * shuffle." (CR 701.23a, CR 608.2c; issue #6557, the compositional pilot).
 *
 * A Verb Frame is ONE Effect Script Op spelled as Oracle text, its arguments
 * filled by the leaf sub-grammars (object descriptor, quantity, zone
 * reference) rather than by a table of whole printed sentences. Five frames
 * ship here, one per Op:
 *
 *  - `search`   — the `choice` Op over the controller's library:
 *                 "Search your library for <quantity> <descriptor>", with the
 *                 optional reveal of the find ("…, reveal it") as its argument
 *                 (CR 701.20a — how the other players learn what was taken).
 *                 The quantity classes: "a"/"an" (one, compelled when no
 *                 quality is stated — CR 701.23b), a printed count of two or
 *                 more ("three cards"), "up to N", and "any number of" (an
 *                 open count, clamped to the library). The descriptor may end
 *                 in "named <Name>" (CR 201.2 — the English name, one name;
 *                 the card's own name arrives as the normaliser's marker and
 *                 is put back by the lowering) and may read "with mana value
 *                 X or less" (CR 107.3 — the X the source announced, gated by
 *                 the lowering site).
 *  - `moveZone` — "<put|exile|return> <object> <destination>": an object
 *                 changes zone (CR 400.7). The OBJECT is one of the argument
 *                 classes below; the DESTINATION is a zone reference (hand,
 *                 battlefield — tapped when printed, CR 110.5b, under your
 *                 control when printed, CR 110.2a — an end of a library, a
 *                 graveyard), or the exile zone the verb "exile" itself names
 *                 (CR 701.13a: "move it to the exile zone from wherever it
 *                 is"; CR 406.1 — exile is ONE shared holding area, so the
 *                 destination carries no owner slot and no "into exile"
 *                 spelling: the verb is the destination).
 *  - `shuffle`  — the bare "shuffle" (CR 701.24a), the "that player shuffles"
 *                 that closes a search of another player's library, and the
 *                 instant tutors' "shuffle and put <pronoun> on top", whose
 *                 printed order (shuffle BEFORE the placement, or the shuffle
 *                 would bury the card) is kept as two frames.
 *  - `sacrifice` — the `sacrifice` Op (CR 701.21a):
 *                 "Sacrifice <quantity> <descriptor>" (the controller's own
 *                 edict), "<player> sacrifices <quantity> <descriptor>[ of
 *                 their choice]" (the named player's), "Sacrifice <this
 *                 <type>|it>" (the source, no choice) and the "… unless you
 *                 <payment>" rider on the source (CR 118.12a). Quantity,
 *                 descriptor, player and payment are each the shared leaf
 *                 sub-grammar's; the frame reads no word of them itself.
 *  - `bringFromOutsideGame` — "You may reveal <description> you own from
 *                 outside the game and put it into your hand" (the Wish
 *                 cards, CR 400.11b + CR 701.20a): ONE Op owns the optional
 *                 pick, the reveal and the move, because outside the game is
 *                 not a zone (CR 400.11) and no `choice`/`moveZone` pair can
 *                 name it. It produces no referent for a later frame.
 *
 * The `moveZone` frame's OBJECT argument classes (issue #6631), each a
 * fixture in `verbFrames.test.ts`:
 *
 *  - the chain PRONOUN ("it", "that card", "them", …) bound to the find of an
 *    earlier `search` frame;
 *  - an ANNOUNCED or NAMED subject read by the shared `subjectRule` — a
 *    target (on the battlefield or in a graveyard), the source ("this
 *    creature"), "that card" / "it" at a site whose head put a card into a
 *    graveyard (CR 400.7e), "that creature" — lowered by the same path the
 *    retired `move-zone` sentence kind used;
 *  - a SWEEP ("all creatures") returned to their owners' hands;
 *  - a GRAVEYARD END CARD ("the top creature card of your graveyard", "the
 *    bottom card of target player's graveyard": CR 404.2 — the pile is
 *    ordered, so the pick is deterministic);
 *  - a CHOSEN CARD FROM A ZONE ("a basic land card from your hand", "two
 *    cards from your hand", "up to two creature cards from your graveyard"):
 *    the controller picks from
 *    their own hand or graveyard as the effect resolves;
 *  - an OWN PERMANENT ("a Forest you control"): the controller picks one of
 *    their permanents (CR 400.3 — it returns to its OWNER's hand).
 *  - the TOP OF A LIBRARY ("the top card of your library", "the top three
 *    cards of target player's library"), exiled only: the `exileTopOfLibrary`
 *    Op (CR 701.13a). A ONE-card exile may carry the sentence behind it, "You
 *    may play that card this turn" (`impulsePlay.ts`), folded in as the
 *    chain's `play`.
 *
 * A frame CHAIN is the members of one sentence in printed order, joined by
 * ", " or ", then " (CR 608.2c — instructions are followed in the order
 * written, so the comma and the "then" are the same join), or by a bare
 * " and " whose right side opens a frame or a reveal ("search your library
 * for a basic land card and reveal it", "… and put it onto the battlefield
 * tapped" — the same join printed without the comma; an " and " whose right
 * side opens nothing stays inside its member, where the descriptor refuses
 * it: "a Forest card and a Plains card" is two finds, not a chain), or opened
 * by a sentence-initial "Then" (the ". Then" connector, `continuation`). Two
 * Composition Rules act inside the chain:
 *
 *  - the OBJECT PRONOUN ("it", "that card", "the card", "them", "those
 *    cards") binds to the last frame that produced a referent — the search —
 *    and is refused with the wrong number (CR 608.2c: the rules of English
 *    applied to the text — the pronoun names the card the earlier
 *    instruction found); with NO referent in the chain, "it" and "that card"
 *    are the SITE's anaphora (the head's object, CR 608.2h) and every plural
 *    pronoun is refused; a find that no later frame moves, or one moved
 *    twice, is refused as well;
 *  - the chain is REFUSED whole when any member is not a frame: a sentence
 *    half read by frames and half by the sentence table is a reading nobody
 *    has vetted.
 *
 * Fail-closed, like every sub-grammar here: an argument outside a frame's
 * declared classes (a quantity "any number of", a descriptor naming a card,
 * "the top card of your library" — a move no Op spells) fails the member it
 * sits in, and the member is what the attribution names — so
 * `oracle:report --families` groups the gap under the frame it needs
 * ({@link frameOf}). The frame also refuses, BY NAME, every object ×
 * destination pair the sentence table still reads (a battlefield permanent
 * exiled — the `exile` Op's kind; the source returned from the graveyard;
 * a graveyard sweep onto the battlefield): a sentence two readers accept is
 * an ambiguity of the grammar (`wholeSentence`), never a card's.
 */

import { readNumberWord } from "./quantity";
import type { ImpulsePlayIR } from "./impulsePlay";
import type {
    CardType,
    EffectCardFilter,
    EffectChoiceSuperlative,
    TargetRequirement,
} from "../../../cards/types";
import { SELF_MARKER } from "../../normalize";
import {
    fail,
    ok,
    type FailureTrace,
    type RuleContext,
    type RuleResult,
} from "../../rule";
import { isSelfPhrase } from "./cost";
import {
    isLandOnlyTarget,
    readAmount,
    subjectRule,
    type AmountIR,
    type EffectSentenceIR,
    type SubjectIR,
} from "./effectClause";
import { PLAYER_PHRASES, playerRefRule, type PlayerRefIR } from "./playerRef";
import {
    COLOR_OR_LIST,
    descriptorRule,
    librarySearchFilterFromDescriptor,
    opensTargetPhrase,
    ownPermanentChoiceFilterFromDescriptor,
    sacrificeFilterFromDescriptor,
    SUPERLATIVE_TAIL,
    superlativeFromClause,
    zoneChoiceFilterFromDescriptor,
} from "./targetFilter";
import { readUnlessPayment, type UnlessPaymentIR } from "./unlessPayment";
import { zoneRefRule, type ZoneRefIR } from "./zoneRef";
import { massSubjectRule } from "./massSubject";

export const VERB_FRAME = "verb frame";

/** CR 608.2c — the words that name the card an earlier frame found. */
export type PronounIR =
    | "it"
    | "that card"
    | "the card"
    | "them"
    | "those cards";
const SINGULAR_PRONOUNS: ReadonlySet<PronounIR> = new Set([
    "it",
    "that card",
    "the card",
]);
const PRONOUN = "(it|that card|the card|them|those cards)";
const PRONOUN_ONLY = new RegExp(`^${PRONOUN}$`);

/**
 * CR 400.7 — where a `moveZone` frame may put a FOUND card (the chain
 * pronoun class): the controller's own hand, the battlefield, an end of the
 * controller's library, the controller's graveyard, or exile.
 */
export type MoveDestination =
    | "hand"
    | "battlefield"
    | "library-top"
    | "library"
    | "graveyard"
    | "exile";

/** The object a `moveZone` frame moves — its argument classes. */
export type MoveObjectIR =
    /** The find of an earlier `search` frame, named by its pronoun. */
    | { readonly kind: "pronoun"; readonly pronoun: PronounIR }
    /** An announced target, the source, the site's anaphora, or a sweep. */
    | { readonly kind: "subject"; readonly subject: SubjectIR }
    /**
     * CR 404.2 — "the top creature card of your graveyard", "the bottom card
     * of target player's graveyard": a deterministic pick out of the ordered
     * pile. `owner` is the graveyard's: the controller or an announced player.
     */
    | {
          readonly kind: "graveyard-end";
          readonly position: "top" | "bottom";
          readonly cardType: CardType | null;
          readonly owner: "you" | "target-player";
      }
    /**
     * CR 400.7 — "<quantity> <descriptor> from your <hand|graveyard>": the
     * controller picks the cards from their own zone as the effect resolves.
     * `count` is the printed quantity: a number ("a", "two") or a range ("up
     * to two").
     */
    | {
          readonly kind: "chosen";
          readonly zone: "hand" | "graveyard";
          readonly filter: EffectCardFilter;
          readonly count: number | { readonly min: 0; readonly max: number };
      }
    /** CR 400.3 — "a Forest you control": one of the controller's permanents. */
    | { readonly kind: "own-permanent"; readonly filter: EffectCardFilter }
    /**
     * CR 701.13a — "the top card of your library", "the top three
     * cards of target player's library": the first cards of an ordered
     * library, a deterministic pick. Exiled only (the `exileTopOfLibrary` Op
     * is the move that names them); `owner` is the library's player.
     */
    | {
          readonly kind: "library-top";
          readonly count: AmountIR;
          readonly owner: PlayerRefIR;
      };

export type FrameIR =
    | {
          readonly frame: "search";
          /** What the search may find (CR 701.23a), as the Op's filter. */
          readonly filter: EffectCardFilter;
          /** The quantity and description as printed, kept for the prompt. */
          readonly phrase: string;
          /** How many cards the quantity names ("a" = 1, "three" = 3,
           *  "up to N" = N; "any number of" = {@link ANY_NUMBER}; "X" = the
           *  X the source announced, CR 107.3). */
          readonly count: number | "X";
          /** "up to N" / "any number of": the quantity itself is a range,
           *  so the find is never compelled, whatever the description. A
           *  printed count ("three cards") is exact, clamped by what the
           *  library holds (CR 609.3) when no quality is stated. */
          readonly upTo: boolean;
          /** CR 701.20a — the reveal of the find, when the line prints one. */
          readonly reveal?: PronounIR;
      }
    | {
          readonly frame: "moveZone";
          readonly object: MoveObjectIR;
          /**
           * The destination zone (CR 400.1). The verb "exile" names
           * `{ zone: "exile", owner: "any" }` (CR 406.1 — one shared zone).
           */
          readonly to: ZoneRefIR;
          /** CR 110.5b — "onto the battlefield tapped". */
          readonly tapped: boolean;
          /** CR 110.2a — "onto the battlefield under your control". */
          readonly under?: "you";
          /** The member as printed, the prompt a chooser reads. */
          readonly phrase: string;
      }
    | {
          readonly frame: "shuffle";
          /** Whose library: the controller's, or the target player's whose
           *  library the sentence before searched ("Then that player
           *  shuffles", folded by sentence assembly). */
          readonly player: "you" | "that-player";
      }
    | {
          readonly frame: "sacrifice";
          /** CR 701.21a — who sacrifices: the controller for the imperative
           *  ("Sacrifice a creature"), the named player otherwise ("Target
           *  player sacrifices …"). The pool is always their own permanents. */
          readonly player: PlayerRefIR;
          readonly object: SacrificedObjectIR;
          /** CR 118.12a — "unless you <payment>": the controller may pay
           *  instead, and the sacrifice happens only when they do not. Read
           *  on the source (or the pronoun for it) only: the payer and the
           *  owner of the loss are the same player. */
          readonly unless?: UnlessPaymentIR;
      }
    | {
          /**
           * CR 707.10 + CR 707.10c — "copy this spell and may choose a new
           * target for that copy": the resolving spell copies itself under the
           * control of the player the gating sentence names. Built by the
           * "If the player does" Composition Rule, never read from a chain
           * member, so it has no `VERB_FRAMES` opener.
           */
          readonly frame: "copySpell";
      }
    | {
          /**
           * CR 702.16j — "you gain protection from everything
           * until your next turn": the controller is protected from every
           * object for the Op's intrinsic span (cleared at the start of their
           * next turn). The controller only: the Op takes a player, and the
           * corpus prints no other recipient this frame has a fixture for.
           */
          readonly frame: "protectionFromEverything";
      }
    | {
          /**
           * CR 500.7 — "Take an extra turn after this one" / "Target player
           * takes an extra turn after this one": `player` is the one who
           * takes the turn. A count ("two extra turns") and a rider on the
           * extra turn ("At the beginning of that turn's end step, you lose
           * the game") are different instructions and are not read.
           */
          readonly frame: "extraTurn";
          readonly player: PlayerRefIR;
      }
    | {
          /**
           * CR 500.8 — "After this phase, there is an additional combat
           * phase": one more combat phase (five steps, CR 506.1) behind the
           * combat phase in progress. A main-phase anchor ("After this main
           * phase …") and a count ("two additional combat phases") are other
           * instructions and are not read.
           */
          readonly frame: "extraCombat";
      }
    | {
          /**
           * CR 614.10 — "You skip your next turn": the controller skips
           * their next turn. Only the controller is read; "target player
           * skips their next turn" earns the wider subject when a card
           * prints it standalone.
           */
          readonly frame: "skipNextTurn";
      }
    | {
          /**
           * CR 504.1 + CR 614.10 — "you skip your draw step this turn": the
           * controller's draw step of the turn in progress does not happen.
           * The one-shot sentence, not the static "Skip your draw step."
           * (every one of their draw steps — a different effect).
           */
          readonly frame: "skipDrawStepThisTurn";
      }
    | {
          /**
           * CR 707.2 + CR 111.1 — "create a token that's a copy of <object>":
           * the controller creates a token whose copiable values are the
           * named object's. The object is the source only ("this creature").
           */
          readonly frame: "copyToken";
          readonly source: SubjectIR;
      }
    | {
          /**
           * CR 601.2 + CR 400.7 — "you may cast target <card> from your
           * graveyard this turn": an impulse window over ONE announced card in
           * the controller's graveyard. `exilesOnResolve` is the folded
           * "If that spell would be put into your graveyard, exile it
           * instead." sentence (CR 614.1).
           */
          readonly frame: "grantCastFromGraveyard";
          readonly card: SubjectIR;
          readonly exilesOnResolve?: true;
      }
    | {
          readonly frame: "bringFromOutsideGame";
          /** What the card may be (`OUTSIDE_GAME_FILTERS`), as the Op's filter. */
          readonly filter: EffectCardFilter;
          /** The description as printed, kept for the prompt. */
          readonly phrase: string;
      };

/**
 * CR 701.21a — what a `sacrifice` frame gives up: ONE named permanent (the
 * source, or the pronoun for it — no choice to make), or the sacrificing
 * player's CHOICE of permanents matching a descriptor.
 */
export type SacrificedObjectIR =
    | { readonly kind: "named"; readonly subject: SubjectIR }
    | {
          readonly kind: "chosen";
          readonly count: SacrificeCountIR;
          readonly filter: EffectCardFilter;
          /** CR 608.2h — "with the greatest power among creatures they
           *  control": the pick narrows to the permanents tied for the
           *  extreme stat. */
          readonly superlative?: EffectChoiceSuperlative;
          /** The printed "a creature" / "two lands", kept for the prompt. */
          readonly phrase: string;
      };

/**
 * The quantity classes the sacrifice frame reads: a printed count ("a",
 * "two"), "X" (CR 107.3), "that many" (the amount the head carried — a
 * damage head's, Phyrexian Negator) and "any number of" — a range the
 * chooser sizes.
 */
export type SacrificeCountIR =
    | Extract<AmountIR, { kind: "fixed" | "x" | "event-amount" }>
    | { readonly kind: "any-number" };

/**
 * One sentence read as frames. Deliberately WITHOUT a `kind`: the frame layer
 * is not a row of the sentence table (`EffectSentenceIR`'s kinds), and the
 * shrink-only kind census (`scripts/lib/sentence-kinds.ts`, read off this
 * source at two trees) counts the table alone — `FrameChainIR` is its one
 * declared kindless member. `kind?: undefined` lets every
 * `switch (sentence.kind)` fall through to the frame lowering without
 * narrowing by hand at each consumer.
 */
export interface FrameChainIR {
    readonly kind?: undefined;
    readonly frames: readonly FrameIR[];
    /** Opened by a sentence-initial "Then" (the ". Then" connector). */
    readonly continuation?: true;
    /**
     * CR 601.2 + CR 305.1 — "You may play that card this turn.": the
     * sentence behind a ONE-card exile of a library's top, folded in by
     * `assembleSentences` because "that card" means nothing alone.
     */
    readonly play?: ImpulsePlayIR;
    /**
     * CR 118.12 — the "If you do, <effect>." sentence behind the chain, folded
     * in by `assembleSentences` (the `If you do` Composition Rule): the
     * effect runs only on the evidence the chain's sacrifice left.
     */
    readonly then?: EffectSentenceIR;
    /** CR 603.12 — the sentence text when `then` is a reflexive ability. */
    readonly reflexive?: string;
}

export type FrameName = FrameIR["frame"];

/**
 * The frames, each with the words that OPEN it — the one table the chain
 * reader dispatches on and `oracle:report --families` classifies by. A member
 * matching none is not a frame; a member matching one and failing inside is
 * that frame's gap.
 */
export const VERB_FRAMES: readonly {
    readonly name: FrameName;
    readonly opens: RegExp;
}[] = [
    { name: "search", opens: /^search your library for /i },
    { name: "moveZone", opens: /^(?:put|exile|return) /i },
    {
        name: "shuffle",
        opens: /^(?:shuffle(?:$| and put )|(?:that|the) player shuffles\b)/i,
    },
    {
        name: "sacrifice",
        // The imperative, or a player reference the shared sub-grammar
        // reads followed by the finite verb. The phrases are plain words,
        // nothing to escape.
        opens: new RegExp(
            `^(?:sacrifice|(?:${PLAYER_PHRASES.join("|")}) sacrifices?) `,
            "i"
        ),
    },
    {
        name: "protectionFromEverything",
        opens: /^you gain protection from everything\b/i,
    },
    {
        name: "extraTurn",
        opens: /^(?:take|(?:you take|target player takes)) an extra turn\b/i,
    },
    {
        name: "extraCombat",
        // Whole spellings only: a bare "there is an additional …" must not
        // open a member, or the comma split would cut the sentence in two.
        opens: /^(?:after this phase, there is an additional combat phase)\b/i,
    },
    { name: "skipNextTurn", opens: /^you skip your next turn$/i },
    {
        name: "skipDrawStepThisTurn",
        opens: /^you skip your draw step this turn$/i,
    },
    {
        name: "copyToken",
        opens: /^create a token that's a copy of /i,
    },
    {
        name: "grantCastFromGraveyard",
        opens: /^you may cast target /i,
    },
    {
        name: "bringFromOutsideGame",
        opens: /^you may reveal an? [^,]+? card you own from outside the game /i,
    },
];

function opensFrame(name: FrameName, member: string): boolean {
    return VERB_FRAMES.some(
        (frame) => frame.name === name && frame.opens.test(member)
    );
}

/** A chain piece that opens a member: a frame, its "then", a reveal, a shuffle. */
function opensMember(piece: string): boolean {
    return (
        frameOf(piece) !== null ||
        /^(?:then |reveal |shuffle|that player shuffles)/i.test(piece)
    );
}

/** The frame a span (a member, or a gap's unconsumed span) opens, if any. */
export function frameOf(span: string): FrameName | null {
    const member = span.replace(/^then /i, "");
    for (const frame of VERB_FRAMES)
        if (frame.opens.test(member)) return frame.name;
    return null;
}

/** CR 701.23a — the quantity classes the search frame reads. */
const SEARCH_ONE = /^(an?) (.+)$/;
const SEARCH_UP_TO = /^up to (\S+) (.+)$/;
const SEARCH_ANY_NUMBER = /^any number of (.+)$/;
const SEARCH_X = /^X (.+)$/;
const SEARCH_COUNT = /^(\S+) (.+)$/;
/**
 * "any number of": the engine's open-count idiom — the `choice` Op clamps a
 * range's `max` to the cards available, so the largest safe integer is "every
 * matching card" (Skyship Weatherlight's hand-written definition is the
 * reference). Lowered as `{ min: 0, max: ANY_NUMBER }`.
 */
export const ANY_NUMBER = Number.MAX_SAFE_INTEGER;
/**
 * CR 201.2 — "<descriptor> named <Name>": the name is the English name, taken
 * whole (lazy left side, so the first " named " splits). The filter carries
 * ONE name, so a name list is two finds and is refused: "named A or B",
 * "named A and/or a card named B", "named A and a card named B" — any "and",
 * "or", "and/or" or a second "named" inside the name. A name that holds the
 * card's own marker beside other words is no printed form either.
 */
const NAMED = /^(.+?) named (.+)$/;
const NAME_LIST = /\b(and|or|and\/or|named)\b/i;
const PROTECTION_FROM_EVERYTHING =
    "you gain protection from everything until your next turn";
const COPY_TOKEN_OPENER = "create a token that's a copy of ";
const CAST_FROM_GRAVEYARD_THIS_TURN =
    /^you may cast target (.+?) from your graveyard this turn$/;
/** CR 500.7 — the one extra-turn spelling per subject; nothing trails "this one". */
const EXTRA_TURN =
    /^(?:(take)|(you take|target player takes)) an extra turn after this one$/;
/** CR 500.8 — the combat-anchored spellings, each ending at the phase noun. */
const EXTRA_COMBAT =
    /^(?:after this phase, there is an additional combat phase)$/;
const REVEAL = new RegExp(`^reveal ${PRONOUN}$`);
const SHUFFLE_AND_TOP = new RegExp(`^shuffle and put ${PRONOUN} on top$`);
/** CR 401.4 — "in any order" after a plural find on top of the library: the
 *  searcher's pick order is the order the cards stack in. */
const PUT_ON_TOP_ANY_ORDER = /^((?:them|those cards) on top) in any order$/;
const THAT_PLAYER_SHUFFLES =
    /^(?:that|the) player shuffles(?: their library)?$/;
/** CR 400.11b + CR 701.20a — the Wish cards' whole member. */
const BRING_FROM_OUTSIDE_GAME =
    /^you may reveal (.+?) you own from outside the game and put it into your hand$/;
/**
 * What a Wish may bring in from outside the game, as an `EffectCardFilter`.
 * Fail-closed by construction: a description with no row is one this grammar
 * has no fixture for, and the member is refused. A row is earned by a printed
 * form.
 */
const OUTSIDE_GAME_FILTERS = new Map<string, EffectCardFilter>([
    ["a sorcery card", { type: "Sorcery" }],
]);

/** The three spellings of the zone-change verb and their destination joins. */
const MOVE_VERB = /^(put|exile|return) (.+)$/;
/** "put <object> <into|onto|on> <zone>" — the first preposition splits. */
const PUT_SPLIT = /^(.+?) (into|onto|on) (.+)$/;
/** "return <object> to <zone>" — the LAST " to " splits (CR 400.3 zones). */
const UNDER_YOUR_CONTROL = " under your control";
const TAPPED = " tapped";
/** CR 400.3 — the plural owners' hands a sweep returns to. */
const THEIR_OWNERS_HANDS = "their owners' hands";
const THEIR_OWNERS_HAND = "their owner's hand";
/**
 * CR 400.3 — the singular-owner spelling of a sweep bounce: "Return all
 * artifacts target player owns to their hand" (Hurkyl's Recall). The
 * announced player is the sweep's whole scope, so the zone is "their hand";
 * the sweep is scoped by the announced player's battlefield (the selector has
 * no owner axis), the same reading the hand-written card carries
 * (tracked-by: #2785).
 */
const TARGET_PLAYER_OWNS = / target player owns$/;
const THEIR_HAND = "their hand";

/** CR 404.2 — an end of an ordered graveyard. */
const GRAVEYARD_END =
    /^the (top|bottom) (?:(\w+) )?card of (your|target player(?:'|’)s) graveyard$/;
/** CR 401.2 — an end of an ordered library: a move no Op spells, refused by name. */
const LIBRARY_TOP_CARDS = /^the top (?:\S+ )?cards? of (?:your|.+?) library$/;
/** The library ends the `library-top` class reads, exactly. */
const LIBRARY_TOP_EXACT =
    /^the top (?:(card)|(\S+) cards) of (your|target player's|target opponent's) library$/;
/** CR 400.7 — "<quantity> <descriptor> from <zone>". */
const FROM_ZONE = /^(.+) from (your hand|your graveyard|a graveyard|.+)$/;
/** CR 400.3 — "<a|an> <descriptor> you control". */
const OWN_PERMANENT = /^(an? .+ you control)$/;

/**
 * CR 400.1 — the destination a `put` member prints, by preposition. The
 * elided "on top" (the instant tutors' spelling) names the library the search
 * just looked through; every other destination is a zone reference the shared
 * sub-grammar reads.
 */
function readPutDestination(
    preposition: string,
    zone: string
): RuleResult<ZoneRefIR> {
    if (preposition === "on") {
        if (zone === "top")
            return ok({ zone: "library", owner: "you", position: "top" });
        // "on top of its owner's library" — the zone reference spells "the
        // top of …"; the article is the preposition's, not the phrase's.
        const ref = zoneRefRule.run(
            /^(?:top|bottom) of /.test(zone) ? `the ${zone}` : zone,
            undefined
        );
        if (ref.ok && ref.value.zone === "library" && ref.value.position)
            return ref;
        return fail(
            `"on ${zone}" is not a destination the moveZone frame reads`,
            zone
        );
    }
    const ref = zoneRefRule.run(zone, undefined);
    if (!ref.ok) return ref;
    const { zone: kind, position } = ref.value;
    if (position !== undefined)
        return fail(
            `"${preposition} ${zone}" is not a destination the moveZone frame reads`,
            zone
        );
    if (kind === "battlefield")
        return preposition === "onto"
            ? ref
            : fail('"into the battlefield" is not how a card enters', zone);
    if (preposition !== "into")
        return fail(
            `"onto ${zone}" is not a destination the moveZone frame reads`,
            zone
        );
    if (kind === "library")
        return fail(
            "a card goes on top of or on the bottom of a library, not back into it",
            zone
        );
    // CR 406.1 — exile is one shared zone with no owner; the verb "exile" is
    // its only spelling here, so "put … into exile" names no destination.
    if (kind === "exile")
        return fail(
            '"into exile" is not a destination the moveZone frame reads — the verb is "exile" (CR 406.1)',
            zone
        );
    return ref;
}

/** CR 400.3 — the plural spellings of the owners' hands a SWEEP returns to. */
function isSweepDestination(zone: string): boolean {
    return (
        zone === THEIR_OWNERS_HANDS ||
        zone === THEIR_OWNERS_HAND ||
        zone === THEIR_HAND
    );
}

/** CR 400.3 — the destination a `return` member prints after " to ". */
function readReturnDestination(zone: string): RuleResult<ZoneRefIR> {
    if (isSweepDestination(zone))
        return ok({ zone: "hand", owner: "its-owner" });
    const ref = zoneRefRule.run(zone, undefined);
    if (!ref.ok) return ref;
    if (ref.value.zone === "exile")
        return fail('a card is exiled, never "returned to exile"', zone);
    return ref;
}

/** The referent the chain has produced so far: the find of the last search. */
interface Referent {
    readonly plural: boolean;
    /** A `moveZone` has already taken the find out of the library. */
    readonly consumed: boolean;
}

function agreeing(pronoun: PronounIR, referent: Referent): string | null {
    if (SINGULAR_PRONOUNS.has(pronoun) === referent.plural)
        return `"${pronoun}" does not agree in number with the cards found`;
    return null;
}

/** The quantity word(s) a chosen-card or own-permanent phrase opens with. */
function readChosenQuantity(
    phrase: string
): { readonly count: ChosenCount; readonly noun: string } | string {
    const upTo = phrase.match(/^up to (\S+) (.+)$/);
    if (upTo !== null) {
        const n = readNumberWord(upTo[1]!);
        if (n === null || n < 1)
            return `"up to ${upTo[1]}" is not a count the moveZone frame reads`;
        return { count: { min: 0, max: n }, noun: upTo[2]! };
    }
    if (/^any number of /.test(phrase))
        return '"any number of" is not a quantity class the moveZone frame reads';
    const one = phrase.match(/^an? (.+)$/);
    if (one !== null) return { count: 1, noun: one[1]! };
    // CR 107.3 — "X cards" is printed only as an additional COST (Skeletal
    // Scrying, Haunting Misery), the cost sub-grammar's; no effect prints it.
    if (/^X /.test(phrase))
        return '"X" is not a quantity class the moveZone frame reads — no effect prints it';
    const counted = phrase.match(/^(\S+) (.+)$/);
    if (counted !== null) {
        const n = readNumberWord(counted[1]!);
        if (n !== null && n >= 1) return { count: n, noun: counted[2]! };
    }
    return `"${phrase}" opens with no quantity the moveZone frame reads ("a", "N", "up to N")`;
}
type ChosenCount = Extract<MoveObjectIR, { kind: "chosen" }>["count"];

/**
 * Read the OBJECT of a `moveZone` member — one of the argument classes the
 * frame declares — or the reason it is none of them. `referent` is the find
 * of the chain's last search, when one is still in scope.
 */
function readMoveObject(
    span: string,
    ctx: unknown,
    referent: Referent | null
): RuleResult<MoveObjectIR> {
    const pronoun = span.match(PRONOUN_ONLY);
    if (pronoun !== null) {
        const word = pronoun[1] as PronounIR;
        if (referent !== null) {
            const disagreement = agreeing(word, referent);
            if (disagreement !== null) return fail(disagreement, span);
            return ok({ kind: "pronoun", pronoun: word });
        }
        // CR 608.2h / CR 400.7e — with no find in the chain, "it" is the
        // head's object and "that card" the card the head put into a
        // graveyard; both are the lowering site's to bind.
        if (word === "it")
            return ok({ kind: "subject", subject: { kind: "pronoun" } });
        if (word === "that card")
            return ok({ kind: "subject", subject: { kind: "that-card" } });
        return fail(`"${word}" names a card no frame before it found`, span);
    }
    if (opensTargetPhrase(span) || span.startsWith("another target ")) {
        const subject = subjectRule.run(span, ctx);
        return subject.ok
            ? ok({ kind: "subject", subject: subject.value })
            : subject;
    }
    if (/^(all|each) /.test(span)) {
        if (span.includes(" from "))
            return fail(
                "a sweep of cards in a zone is not an object the moveZone frame reads",
                span
            );
        const owned = TARGET_PLAYER_OWNS.test(span);
        const mass = massSubjectRule.run(
            owned ? span.replace(TARGET_PLAYER_OWNS, "") : span,
            ctx
        );
        if (!mass.ok) return mass;
        if (owned && mass.value.select.controller !== undefined)
            return fail("two owner clauses", span);
        return ok({
            kind: "subject",
            subject: {
                kind: "mass",
                ...mass.value,
                ...(owned ? { targetPlayerControls: true as const } : {}),
            } as SubjectIR,
        });
    }
    const end = span.match(GRAVEYARD_END);
    if (end !== null) {
        let cardType: CardType | null = null;
        if (end[2] !== undefined) {
            const type = end[2].charAt(0).toUpperCase() + end[2].slice(1);
            if (!PERMANENT_CARD_TYPES.has(type))
                return fail(`"${end[2]}" is not a permanent card type`, span);
            cardType = type as CardType;
        }
        return ok({
            kind: "graveyard-end",
            position: end[1] as "top" | "bottom",
            cardType,
            owner: end[3] === "your" ? "you" : "target-player",
        });
    }
    const libraryTop = span.match(LIBRARY_TOP_EXACT);
    if (libraryTop !== null) {
        const word = libraryTop[1] === undefined ? libraryTop[2]! : "one";
        // The frame text is lower-cased: the printed "X" arrives as "x".
        const count = readAmount(word === "x" ? "X" : word);
        if (count === null) return fail(`"${word}" is not a count`, span);
        // "your" is "you"'s possessive; the others drop their "'s".
        const owner = playerRefRule.run(
            libraryTop[3] === "your"
                ? "you"
                : libraryTop[3]!.replace(/'s$/, ""),
            ctx
        );
        if (!owner.ok) return owner;
        return ok({ kind: "library-top", count, owner: owner.value });
    }
    if (LIBRARY_TOP_CARDS.test(span))
        return fail(
            "only the top of your library, or of an announced player's, is a move the moveZone frame reads",
            span
        );
    const own = span.match(OWN_PERMANENT);
    if (own !== null) {
        const quantity = readChosenQuantity(own[1]!);
        if (typeof quantity === "string") return fail(quantity, span);
        if (quantity.count !== 1)
            return fail(
                "an own-permanent choice reads exactly one permanent",
                span
            );
        const descriptor = descriptorRule.run(quantity.noun, ctx);
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural === true)
            return fail(`"${span}" is not one permanent`, span);
        const filter = ownPermanentChoiceFilterFromDescriptor(descriptor.value);
        if (!filter.ok) return filter;
        return ok({ kind: "own-permanent", filter: filter.value });
    }
    const from = span.match(FROM_ZONE);
    if (from !== null) {
        const zone = from[2]!;
        if (zone !== "your hand" && zone !== "your graveyard")
            return fail(
                `"from ${zone}" is not a zone the moveZone frame picks a card from (your hand, your graveyard)`,
                span
            );
        const quantity = readChosenQuantity(from[1]!);
        if (typeof quantity === "string") return fail(quantity, span);
        const descriptor = descriptorRule.run(quantity.noun, ctx);
        if (!descriptor.ok) return descriptor;
        const plural =
            typeof quantity.count === "number"
                ? quantity.count > 1
                : quantity.count.max > 1;
        if ((descriptor.value.plural === true) !== plural)
            return fail(
                `"${from[1]}" pairs the quantity with the wrong number`,
                span
            );
        const filter = zoneChoiceFilterFromDescriptor(descriptor.value);
        if (!filter.ok) return filter;
        return ok({
            kind: "chosen",
            zone: zone === "your hand" ? "hand" : "graveyard",
            filter: filter.value,
            count: quantity.count,
        });
    }
    const subject = subjectRule.run(span, ctx);
    if (!subject.ok) return subject;
    if (subject.value.kind === "player")
        return fail("a player is not an object a zone change moves", span);
    return ok({ kind: "subject", subject: subject.value });
}

/** CR 110.4 — the card types a permanent card may have. */
const PERMANENT_CARD_TYPES: ReadonlySet<string> = new Set([
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
]);

/** CR 110.4 — a chosen-card filter that admits permanent cards only. */
function isPermanentCardFilter(filter: EffectCardFilter): boolean {
    if (filter.excludeType !== undefined) return true;
    const types = filter.type;
    if (types === undefined) return false;
    return (Array.isArray(types) ? types : [types]).every((type) =>
        PERMANENT_CARD_TYPES.has(type)
    );
}

/** CR 601.2c — a target count that may announce more than one object. */
function announcesMany(count: TargetRequirement["count"]): boolean {
    if (typeof count === "number") return count > 1;
    if (count === "X") return true;
    return (
        count.max === undefined ||
        count.max === "X" ||
        typeof count.max !== "number" ||
        count.max > 1
    );
}

/**
 * The object × destination pairs the frame ADMITS at grammar time. Only the
 * pairs the sentence table STILL READS are refused here — a battlefield
 * permanent exiled (the `exile` Op's kind), the source exiled ("Exile
 * {self}", CR 608.2n) or returned from its graveyard to your hand (CR
 * 113.6b), a sweep sent anywhere but its owners' hands — so that a sentence
 * keeps ONE reader (`wholeSentence`'s ambiguity rule); the declared classes
 * (a found card, a graveyard's end card, a chosen card, an own permanent)
 * name their destinations outright; every other pair is the lowering's to
 * admit or refuse by name.
 */
function admits(
    object: MoveObjectIR,
    to: ZoneRefIR,
    verb: string,
    tapped: boolean,
    under: boolean,
    sweepDestination: boolean
): string | null {
    const dest = `${to.zone}${to.position ? `-${to.position}` : ""}`;
    if (tapped && to.zone !== "battlefield")
        return '"tapped" is a state only a permanent entering the battlefield has (CR 110.5b)';
    if (under && to.zone !== "battlefield")
        return '"under your control" is printed only with a battlefield destination (CR 110.2a)';
    // CR 400.3 — "their owners' hands" is the destination of MANY objects: a
    // sweep, or an announced group wider than one ("up to two target
    // nonblack creatures", Nightscape Battlemage); one object has one owner.
    if (
        sweepDestination &&
        !(
            object.kind === "subject" &&
            (object.subject.kind === "mass" ||
                (object.subject.kind === "target" &&
                    announcesMany(object.subject.requirement.count)))
        )
    )
        return "a plural owners' hands is the destination of a sweep or of a group of targets, not of one object (CR 400.3)";
    switch (object.kind) {
        case "library-top":
            // CR 701.13a — only exiling the top of a library has an Op
            // (`exileTopOfLibrary`); putting it elsewhere is another verb.
            return verb === "exile" && to.zone === "exile"
                ? null
                : "the top of a library is only exiled by this frame";
        case "pronoun":
            if (to.zone === "exile" || to.zone === "battlefield") return null;
            if (to.owner !== "you")
                return "a found card goes to your own hand, library or graveyard";
            return null;
        case "graveyard-end":
            if (tapped)
                return '"tapped" is not a rider of a graveyard\'s end card';
            // CR 404.2 — an announced player's graveyard: only its bottom
            // card exiled is printed (the end-card classes a fixture pins).
            if (object.owner === "target-player")
                return to.zone === "exile"
                    ? null
                    : "another player's graveyard end card is only exiled";
            if (to.zone === "exile" || to.zone === "battlefield") return null;
            if (
                to.zone === "library" &&
                to.position === "bottom" &&
                to.owner === "you"
            )
                return null;
            if (to.zone === "hand" && to.owner === "you") return null;
            return `"${dest}" is not where the moveZone frame puts a graveyard's end card`;
        case "chosen":
            if (to.zone === "exile") return null;
            // CR 110.4 — only a permanent card can be put onto the
            // battlefield: a filter naming a permanent type, or the
            // "<Subtype> permanent card" exclusion of instants and sorceries.
            if (to.zone === "battlefield")
                return isPermanentCardFilter(object.filter)
                    ? null
                    : "only a permanent card is put onto the battlefield (CR 110.4)";
            if (
                to.zone === "library" &&
                to.position === "bottom" &&
                to.owner === "you"
            )
                return null;
            if (to.zone === "library" && to.position === "top")
                return 'cards put from the hand on top of the library in any order are the "putBack" sentence, not this frame (CR 401.4)';
            if (
                object.zone === "graveyard" &&
                to.zone === "hand" &&
                to.owner === "you"
            )
                return null;
            return `"${dest}" is not where the moveZone frame puts a chosen card from your ${object.zone}`;
        case "own-permanent":
            return to.zone === "hand" && to.owner === "its-owner"
                ? null
                : "a permanent you control is returned to its owner's hand (CR 400.3)";
        case "subject": {
            const subject = object.subject;
            if (subject.kind === "mass")
                return verb === "return" &&
                    to.zone === "hand" &&
                    to.owner === "its-owner" &&
                    sweepDestination
                    ? null
                    : "a sweep is returned to its owners' hands only";
            if (subject.kind === "self") {
                // CR 608.2n — "Exile {self}" is the resolving spell's own
                // kind; CR 113.6b — "Return this card to your hand" the
                // graveyard-functioning kind's.
                if (to.zone === "exile")
                    return "the source exiling itself is the exile-self kind, not this frame";
                if (to.zone === "hand" && to.owner === "you")
                    return "the source returned from your graveyard is the return-self-from-graveyard kind, not this frame";
                return null;
            }
            // CR 701.13a — a battlefield permanent is exiled by the `exile`
            // Op, the sentence table's kind, not moved by this frame.
            if (
                subject.kind === "target" &&
                subject.requirement.zone === undefined &&
                to.zone === "exile"
            )
                return "a battlefield permanent is exiled by the exile kind, not moved by this frame";
            return null;
        }
    }
}

/**
 * Read one `moveZone` member: the verb, its object and its destination.
 * `null` when the member opens no zone-change verb.
 */
function readMoveMember(
    lower: string,
    ctx: unknown,
    referent: Referent | null
): RuleResult<Extract<FrameIR, { frame: "moveZone" }>> | null {
    const verb = lower.match(MOVE_VERB);
    if (verb === null) return null;
    const word = verb[1]!;
    let rest = verb[2]!;
    let under = false;
    let tapped = false;
    if (rest.endsWith(UNDER_YOUR_CONTROL)) {
        under = true;
        rest = rest.slice(0, -UNDER_YOUR_CONTROL.length);
    }
    if (rest.endsWith(TAPPED)) {
        tapped = true;
        rest = rest.slice(0, -TAPPED.length);
    }
    let objectSpan: string;
    let to: RuleResult<ZoneRefIR>;
    let sweepDestination = false;
    if (word === "exile") {
        objectSpan = rest;
        to = ok({ zone: "exile", owner: "any" });
    } else if (word === "put") {
        const split = rest.replace(PUT_ON_TOP_ANY_ORDER, "$1").match(PUT_SPLIT);
        if (split === null)
            return fail(
                '"put" needs a destination ("into", "onto", "on")',
                lower
            );
        objectSpan = split[1]!;
        to = readPutDestination(split[2]!, split[3]!);
    } else {
        const at = rest.lastIndexOf(" to ");
        if (at === -1)
            return fail('"return" needs a destination zone ("to …")', lower);
        objectSpan = rest.slice(0, at);
        const zone = rest.slice(at + " to ".length);
        sweepDestination = isSweepDestination(zone);
        to = readReturnDestination(zone);
    }
    if (!to.ok) return to;
    const object = readMoveObject(objectSpan, ctx, referent);
    if (!object.ok) return object;
    const refused = admits(
        object.value,
        to.value,
        word,
        tapped,
        under,
        sweepDestination
    );
    if (refused !== null) return fail(refused, lower);
    return ok({
        frame: "moveZone",
        object: object.value,
        to: to.value,
        tapped,
        ...(under ? { under: "you" as const } : {}),
        phrase: lower,
    });
}

/** CR 118.12a — where the sacrifice frame's payment rider begins. */
const UNLESS = " unless ";
/** CR 101.4 — "of their choice" names the chooser the edict already has
 *  (the rule's own example, "Each player sacrifices a creature", has each
 *  player choose). Read behind a player head only: the imperative has no
 *  "their" to agree with. */
const OF_THEIR_CHOICE = " of their choice";
/** CR 107.3 / CR 120.3 — the quantity words that are not a printed count. */
const ANY_NUMBER_OF = /^any number of (.+)$/;
const THAT_MANY = /^that many (.+)$/;
const X_OF = /^X (.+)$/;
/** The two printed spellings of "not the source itself". */
const ANOTHER = "another ";
const OTHER_THAN = " other than ";
/**
 * "any number of" as a `choice` range: the chooser sizes the pick, so the
 * ceiling is above any reachable battlefield and the floor is zero — the
 * encoding the cost grammar's "Discard your hand" already uses for a count
 * no board reaches (`cost.ts`).
 */
export const ANY_NUMBER_CEILING = 99;

/**
 * CR 701.21a — the object of a `sacrifice` frame. A NAMED permanent is the
 * source (`{self}` / "this <noun>", the table `isSelfPhrase` keeps) or the
 * pronoun for it ("it") — both the controller's own, so the sacrifice is
 * legal by construction. "Enchanted creature" is NOT one: an Aura on an
 * opponent's creature names a permanent its controller cannot sacrifice, and
 * no corpus effect prints the form (the one printing is a cost). Anything
 * else is read as "<quantity> <descriptor>": a CHOSEN set, the shared
 * descriptor converted by `sacrificeFilterFromDescriptor`, which refuses
 * every clause the filter cannot say rather than widening the pool.
 */
function readSacrificedObject(
    text: string,
    ctx: unknown
): RuleResult<SacrificedObjectIR> {
    if (isSelfPhrase(text))
        return ok({ kind: "named" as const, subject: { kind: "self" } });
    if (text === "it")
        return ok({ kind: "named" as const, subject: { kind: "pronoun" } });
    let count: SacrificeCountIR;
    let noun: string;
    // "another creature" / "a creature other than this creature": the pool
    // is the chooser's permanents less the source itself — the filter's
    // `excludeSource`, the one encoding the hand-written edicts write.
    let excludeSource = false;
    const anyNumber = text.match(ANY_NUMBER_OF);
    const thatMany = text.match(THAT_MANY);
    const x = text.match(X_OF);
    if (text.startsWith(ANOTHER)) {
        count = { kind: "fixed", value: 1 };
        noun = text.slice(ANOTHER.length);
        excludeSource = true;
    } else if (anyNumber !== null) {
        count = { kind: "any-number" };
        noun = anyNumber[1]!;
    } else if (thatMany !== null) {
        count = { kind: "event-amount" };
        noun = thatMany[1]!;
    } else if (x !== null) {
        count = { kind: "x" };
        noun = x[1]!;
    } else {
        const at = text.indexOf(" ");
        const n = at === -1 ? null : readNumberWord(text.slice(0, at));
        if (n === null)
            return fail(
                `"${text}" is not an object the sacrifice frame reads (the source, "it", or "<quantity> <descriptor>")`,
                text
            );
        count = { kind: "fixed", value: n };
        noun = text.slice(at + 1);
    }
    const otherThan = noun.indexOf(OTHER_THAN);
    if (otherThan !== -1) {
        const excluded = noun.slice(otherThan + OTHER_THAN.length);
        if (!isSelfPhrase(excluded))
            return fail(
                `"other than ${excluded}" excludes something that is not the source`,
                excluded
            );
        noun = noun.slice(0, otherThan);
        excludeSource = true;
    }
    const tail = SUPERLATIVE_TAIL.exec(noun);
    const descriptor = descriptorRule.run(tail === null ? noun : tail[1]!, ctx);
    if (!descriptor.ok) return descriptor;
    // The noun's number is the quantity's: "a creature", "two creatures",
    // "X lands", "any number of permanents".
    const plural = count.kind !== "fixed" || count.value !== 1;
    if ((descriptor.value.plural === true) !== plural)
        return fail(`"${text}" disagrees in number`, noun);
    const filter = sacrificeFilterFromDescriptor(
        descriptor.value,
        COLOR_OR_LIST.test(noun)
    );
    if (!filter.ok) return filter;
    let superlative: EffectChoiceSuperlative | undefined;
    if (tail !== null) {
        // "two creatures with the greatest power" ranks each pick, not the
        // pool once — no encoding, so refused rather than read as one.
        if (count.kind !== "fixed" || count.value !== 1)
            return fail("a superlative selects ONE permanent", text);
        const read = superlativeFromClause(
            tail[2]!,
            tail[3]!,
            tail[4]!,
            filter.value,
            ctx
        );
        if (!read.ok) return read;
        superlative = read.value;
    }
    return ok({
        kind: "chosen" as const,
        count,
        filter: excludeSource
            ? { ...filter.value, excludeSource: true }
            : filter.value,
        ...(superlative === undefined ? {} : { superlative }),
        phrase: text,
    });
}

/**
 * CR 701.21a — one `sacrifice` member: "sacrifice <object>" (the controller)
 * or "<player> sacrifices <object>[ of their choice]" (the named player), with
 * the CR 118.12a rider "unless you <payment>" on a named permanent. `null`
 * when the member opens no sacrifice frame.
 */
function readSacrificeMember(
    lower: string,
    ctx: unknown
): RuleResult<FrameIR> | null {
    let player: PlayerRefIR;
    let rest: string;
    const imperative = lower.startsWith("sacrifice ");
    if (imperative) {
        player = { kind: "you" };
        rest = lower.slice("sacrifice ".length);
    } else {
        const head = lower.match(/^(.+?) (sacrifices?) (.+)$/);
        if (head === null) return null;
        const ref = playerRefRule.run(head[1]!, ctx);
        if (!ref.ok) return null;
        // The verb agrees with its subject: "you sacrifice", "each player
        // sacrifices" — a line that disagrees is one we have misread.
        const plural = ref.value.kind === "you";
        if ((head[2] === "sacrifice") !== plural)
            return fail(
                `"${head[1]} ${head[2]}" — the verb does not agree with its subject`,
                lower
            );
        player = ref.value;
        rest = head[3]!;
    }
    let unless: UnlessPaymentIR | undefined;
    const unlessAt = rest.indexOf(UNLESS);
    if (unlessAt !== -1) {
        const rider = rest.slice(unlessAt + UNLESS.length);
        // CR 118.12a — "[a player may do something else]": the payer this
        // frame reads is the controller ("you"), who also owns the loss;
        // "unless they pay" (Slow Motion) and "unless any player pays" (Icy
        // Prison) are payer classes it does not declare, refused by name.
        if (!rider.startsWith("you "))
            return fail(
                `"unless ${rider}" — only "unless you <payment>" is a rider the sacrifice frame reads`,
                rider
            );
        const payment = readUnlessPayment(
            rider.slice("you ".length),
            ctx as RuleContext
        );
        if (!payment.ok) return payment;
        unless = payment.value;
        rest = rest.slice(0, unlessAt);
    }
    if (!imperative && rest.endsWith(OF_THEIR_CHOICE))
        rest = rest.slice(0, -OF_THEIR_CHOICE.length);
    const object = readSacrificedObject(rest, ctx);
    if (!object.ok) return object;
    // Only the source (or the pronoun for it) is sacrificed unless paid for;
    // "sacrifice a creature unless …" is not a printed form.
    if (unless !== undefined && object.value.kind !== "named")
        return fail("only the source is sacrificed unless paid for", rest);
    // CR 701.21a — a named permanent is the controller's to sacrifice; the
    // player reference belongs to the edict ("target player sacrifices a
    // creature"), never to "target player sacrifices it".
    if (object.value.kind === "named" && player.kind !== "you")
        return fail(
            `"${rest}" is a named permanent — only its controller sacrifices it`,
            rest
        );
    return ok({
        frame: "sacrifice" as const,
        player,
        object: object.value,
        ...(unless === undefined ? {} : { unless }),
    });
}

/**
 * CR 701.23a — the quantity that opens the search's object: how many cards,
 * whether the count is a range, and the noun phrase left for the descriptor.
 * A count word that is not one ("exactly two", "that many", "X") is refused by
 * name — a count the engine would have to invent is a card that resolves and
 * does nothing. "up to one" is refused too: no corpus card prints it, and
 * reading it would make "up to" and "a" two spellings of one class.
 */
function readSearchQuantity(rest: string):
    | {
          readonly count: number | "X";
          readonly upTo: boolean;
          readonly noun: string;
      }
    | { readonly refused: string } {
    const one = rest.match(SEARCH_ONE);
    if (one !== null) return { count: 1, upTo: false, noun: one[2]! };
    const upTo = rest.match(SEARCH_UP_TO);
    if (upTo !== null) {
        const n = readNumberWord(upTo[1]!);
        if (n === null || n < 2)
            return {
                refused: `"up to ${upTo[1]}" is not a count of two or more`,
            };
        return { count: n, upTo: true, noun: upTo[2]! };
    }
    const anyNumber = rest.match(SEARCH_ANY_NUMBER);
    if (anyNumber !== null)
        return { count: ANY_NUMBER, upTo: true, noun: anyNumber[1]! };
    const x = rest.match(SEARCH_X);
    if (x !== null) return { count: "X", upTo: false, noun: x[1]! };
    const counted = rest.match(SEARCH_COUNT);
    const n = counted === null ? null : readNumberWord(counted[1]!);
    if (counted !== null && n !== null && n >= 2)
        return { count: n, upTo: false, noun: counted[2]! };
    return {
        refused: `"${rest}" is not a quantity class the search frame reads ("a", "an", a count of two or more, "up to N", "any number of")`,
    };
}

/**
 * Read one member of the chain. Returns the frames it adds (a member may add
 * two: "shuffle and put that card on top"), the reveal it attaches to the
 * last search (`reveal`), or the reason it is refused. `null` when the member
 * opens no frame at all — the caller decides whether that fails the chain.
 */
function readMember(
    member: string,
    ctx: unknown,
    referent: Referent | null,
    lastSearch: Extract<FrameIR, { frame: "search" }> | null
):
    | {
          readonly frames: readonly FrameIR[];
          readonly referent: Referent | null;
      }
    | { readonly reveal: PronounIR }
    | { readonly refused: string; readonly failure?: RuleResult<never> }
    | null {
    const lower = member[0]!.toLowerCase() + member.slice(1);

    if (VERB_FRAMES[0]!.opens.test(lower)) {
        const rest = lower.slice("search your library for ".length);
        const quantity = readSearchQuantity(rest);
        if ("refused" in quantity) return quantity;
        const { count, upTo } = quantity;
        // CR 201.2 — "a card named <Name>": the name is split off before the
        // descriptor reads the noun, and joins the filter after it.
        const named = quantity.noun.match(NAMED);
        const descriptor = descriptorRule.run(
            named === null ? quantity.noun : named[1]!,
            ctx
        );
        if (!descriptor.ok) return { refused: descriptor.reason };
        if ((descriptor.value.plural === true) !== (count === "X" || count > 1))
            return {
                refused: `"${rest}" pairs the quantity with the wrong number`,
            };
        const filter = librarySearchFilterFromDescriptor(descriptor.value);
        if (!filter.ok) return { refused: filter.reason };
        if (named !== null && NAME_LIST.test(named[2]!))
            return {
                refused: `"named ${named[2]}" names more than one card name — a search filter carries one name (CR 201.2)`,
            };
        if (
            named !== null &&
            named[2]!.includes(SELF_MARKER) &&
            named[2] !== SELF_MARKER
        )
            return {
                refused: `"named ${named[2]}" puts the card's own name beside other words — not a name any card prints`,
            };
        return {
            frames: [
                {
                    frame: "search",
                    filter:
                        named === null
                            ? filter.value
                            : { ...filter.value, name: named[2]! },
                    phrase: rest,
                    count,
                    upTo,
                },
            ],
            referent: { plural: count === "X" || count > 1, consumed: false },
        };
    }

    const reveal = lower.match(REVEAL);
    if (reveal !== null) {
        const pronoun = reveal[1] as PronounIR;
        if (referent === null)
            return {
                refused: `"${pronoun}" names a card no frame before it found`,
            };
        const disagreement = agreeing(pronoun, referent);
        if (disagreement !== null) return { refused: disagreement };
        if (lastSearch === null || lastSearch.reveal !== undefined)
            return {
                refused:
                    '"reveal" follows no search, or a search already revealed',
            };
        return { reveal: pronoun };
    }

    const shuffleTop = lower.match(SHUFFLE_AND_TOP);
    if (shuffleTop !== null) {
        const pronoun = shuffleTop[1] as PronounIR;

        if (referent === null)
            return {
                refused: `"${pronoun}" names a card no frame before it found`,
            };
        const disagreement = agreeing(pronoun, referent);
        if (disagreement !== null) return { refused: disagreement };
        if (referent.consumed)
            return {
                refused: `"put ${pronoun} on top" moves a card an earlier frame already put somewhere`,
            };
        return {
            frames: [
                { frame: "shuffle", player: "you" },
                {
                    frame: "moveZone",
                    object: { kind: "pronoun", pronoun },
                    to: { zone: "library", owner: "you", position: "top" },
                    tapped: false,
                    phrase: lower,
                },
            ],
            referent: { ...referent, consumed: true },
        };
    }

    const move = readMoveMember(lower, ctx, referent);
    if (move !== null) {
        // A sub-grammar's refusal (a target phrase, a descriptor) keeps its
        // own fragment and trace, as it did under the sentence table.
        if (!move.ok) return { refused: move.reason, failure: move };
        if (move.value.object.kind === "pronoun") {
            if (referent!.consumed)
                return {
                    refused: `"${move.value.phrase}" moves a card an earlier frame already put somewhere`,
                };
            return {
                frames: [move.value],
                referent: { ...referent!, consumed: true },
            };
        }
        return { frames: [move.value], referent };
    }

    if (lower === "shuffle")
        return { frames: [{ frame: "shuffle", player: "you" }], referent };
    if (THAT_PLAYER_SHUFFLES.test(lower))
        return {
            frames: [{ frame: "shuffle", player: "that-player" }],
            referent,
        };
    const sacrifice = readSacrificeMember(lower, ctx);
    if (sacrifice !== null) {
        // The refusal names the WHOLE member, whatever sub-grammar refused
        // inside it: the gap keys the retired kinds' backlog issues claim
        // stay where the refusal tables pin them (`playerEdict.test.ts`).
        if (!sacrifice.ok) return { refused: sacrifice.reason };
        // CR 608.2c — behind a find, "it" is the card the chain found (the
        // nearest antecedent), which this frame does not read: the source's
        // pronoun is the only "it" it sacrifices, so the member is refused
        // rather than read as the source.
        if (
            referent !== null &&
            sacrifice.value.frame === "sacrifice" &&
            sacrifice.value.object.kind === "named" &&
            sacrifice.value.object.subject.kind === "pronoun"
        )
            return {
                refused: `"${member}" — "it" names the card an earlier frame found; the sacrifice frame reads only the source's pronoun`,
            };
        // A sacrifice produces no referent a later frame could name: the
        // pronoun rule binds the LAST find, and this is not one.
        return { frames: [sacrifice.value], referent };
    }
    if (opensFrame("protectionFromEverything", lower)) {
        // CR 702.16j — the Op's span is "until your next turn", fixed: any
        // other duration is a different effect.
        if (lower !== PROTECTION_FROM_EVERYTHING)
            return {
                refused: `"${member}" — only "you gain protection from everything until your next turn" is read`,
            };
        return {
            frames: [{ frame: "protectionFromEverything" }],
            referent,
        };
    }
    if (opensFrame("extraTurn", lower)) {
        // CR 500.7 — "after this one" ends the instruction: a count or a
        // rider on the turn is a different effect.
        const taken = lower.match(EXTRA_TURN);
        if (taken === null)
            return {
                refused: `"${member}" — only "take an extra turn after this one" is read`,
            };
        const player = playerRefRule.run(
            taken[2] === undefined ? "you" : taken[2].replace(/ takes?$/, ""),
            ctx
        );
        if (!player.ok) return { refused: player.reason, failure: player };
        return {
            frames: [{ frame: "extraTurn", player: player.value }],
            referent,
        };
    }
    if (opensFrame("extraCombat", lower)) {
        if (!EXTRA_COMBAT.test(lower))
            return {
                refused: `"${member}" — only "After this phase, there is an additional combat phase" is read`,
            };
        return { frames: [{ frame: "extraCombat" }], referent };
    }
    if (opensFrame("skipNextTurn", lower))
        return { frames: [{ frame: "skipNextTurn" }], referent };
    if (opensFrame("skipDrawStepThisTurn", lower))
        return { frames: [{ frame: "skipDrawStepThisTurn" }], referent };
    if (opensFrame("copyToken", lower)) {
        const objectSpan = lower.slice(COPY_TOKEN_OPENER.length);
        const subject = subjectRule.run(objectSpan, ctx);
        if (!subject.ok) return { refused: subject.reason, failure: subject };
        // CR 707.2 — only the source is read: an announced target or the
        // site's creature needs a whole-card fixture no card compiles to yet
        // (Schema Thief, Necroduality), and a pronoun, a card or a sweep is
        // another copy effect (Populate, Clone Legion's for-each).
        if (subject.value.kind !== "self")
            return {
                refused: `"${objectSpan}" is not an object a token copy is read from — only the source is`,
            };
        return {
            frames: [{ frame: "copyToken", source: subject.value }],
            referent,
        };
    }
    if (opensFrame("grantCastFromGraveyard", lower)) {
        // CR 601.2 + CR 400.7 — only the announced card of the controller's
        // own graveyard, for this turn: "from a graveyard", a window-less
        // grant (cast during resolution) and a "without paying" waiver are
        // other effects.
        const grant = lower.match(CAST_FROM_GRAVEYARD_THIS_TURN);
        if (grant === null)
            return {
                refused: `"${member}" — only "you may cast target <card> from your graveyard this turn" is read`,
            };
        const card = subjectRule.run(
            `target ${grant[1]!} from your graveyard`,
            ctx
        );
        if (!card.ok) return { refused: card.reason, failure: card };
        if (card.value.kind !== "target" || isLandOnlyTarget(card.value))
            return {
                refused: `"${grant[1]!}" is not an announced castable card`,
            };
        return {
            frames: [{ frame: "grantCastFromGraveyard", card: card.value }],
            referent,
        };
    }
    const fromOutside = lower.match(BRING_FROM_OUTSIDE_GAME);
    if (fromOutside !== null) {
        // CR 608.2c — the member's own "it" is the Wish card; a find an
        // earlier search left unmoved would leave a later pronoun two
        // antecedents.
        if (referent !== null && !referent.consumed)
            return {
                refused:
                    "a card from outside the game is brought in while a found card is still put nowhere",
            };
        const phrase = fromOutside[1]!;
        const filter = OUTSIDE_GAME_FILTERS.get(phrase);
        if (filter === undefined)
            return {
                refused: `"${phrase}" is not a description of a card from outside the game`,
            };
        return {
            frames: [{ frame: "bringFromOutsideGame", filter, phrase }],
            referent,
        };
    }
    // A member a frame opens but reads no form of: the shuffle and the Wish
    // frames refuse it; a move or sacrifice member is the table's to read.
    if (
        VERB_FRAMES.some(
            (frame) =>
                (frame.name === "shuffle" ||
                    frame.name === "bringFromOutsideGame") &&
                frame.opens.test(lower)
        )
    )
        return { refused: `"${member}" is not a form of the frame it opens` };
    return null;
}

/**
 * CR 608.2c — the members of one sentence: split at ", " (a leading "then"
 * dropped), then at a bare " and " whose right side opens a frame or is the
 * reveal argument — the comma-less spelling of the same join ("…for a basic
 * land card and reveal it", "…and put it onto the battlefield tapped"). An
 * " and " whose right side opens nothing stays in its member, so "a Forest
 * card and a Plains card" reaches the descriptor whole and is refused there.
 */
function splitMembers(body: string): string[] {
    // CR 608.2c — ", " joins members; a comma INSIDE a member (a type list,
    // "target artifact, creature, or enchantment") opens nothing and is
    // rejoined to the member it belongs to.
    const pieces: string[] = [];
    for (const piece of body.split(", ")) {
        if (pieces.length > 0 && !opensMember(piece))
            pieces[pieces.length - 1] += `, ${piece}`;
        else pieces.push(piece);
    }
    // " and " joins two frames inside one member ("…for a card and reveal
    // it"); an "and" inside a descriptor opens nothing. The Wish frame's
    // "… and put it into your hand" is its OWN move (one Op), never a second
    // member.
    const out: string[] = [];
    for (const [i, member] of pieces.entries()) {
        if (frameOf(member) === "bringFromOutsideGame") {
            out.push(member);
            continue;
        }
        const parts = (i === 0 ? member : member.replace(/^then /, "")).split(
            " and "
        );
        let current = parts[0]!;
        for (const part of parts.slice(1)) {
            if (frameOf(part) !== null || REVEAL.test(part)) {
                out.push(current);
                current = part;
            } else current = `${current} and ${part}`;
        }
        out.push(current);
    }
    return out;
}

/**
 * Read a whole sentence as a frame chain. `null` when its first member opens
 * no frame (the sentence is the table's to read), or when a sacrifice-only
 * chain meets a tail that is no frame (the `, then` rule's); a refusal when it opens one
 * and a member fails — attributed to THAT member, with the chain's progress
 * (how many members before it were read) so the deepest failure wins.
 */
export function readFrameChain(
    span: string,
    ctx: unknown
): RuleResult<FrameChainIR> | null {
    const continuation = /^Then /.test(span);
    const body = continuation ? span.slice("Then ".length) : span;
    const members = splitMembers(body);
    if (members.length === 0 || frameOf(members[0]!) === null) return null;
    const frames: FrameIR[] = [];
    let referent: Referent | null = null;
    const refuse = (reason: string, member: string, at: number) => {
        const trace: FailureTrace = {
            path: [VERB_FRAME],
            span: member,
            progress: at,
        };
        return fail(reason, member, trace);
    };
    for (const [i, member] of members.entries()) {
        const lastSearch = [...frames]
            .reverse()
            .find(
                (f): f is Extract<FrameIR, { frame: "search" }> =>
                    f.frame === "search"
            );
        const read = readMember(member, ctx, referent, lastSearch ?? null);
        if (read === null) {
            // CR 608.2c — "Sacrifice a creature, then draw a card": a chain of
            // sacrifice frames alone binds no pronoun a split could lose, so
            // the sentence is handed back to the `, then` Composition Rule,
            // which reads the head as this chain and the tail as the table's.
            // The parse is the same either way (`sentenceRule` falls back to
            // the `, then` read); what the hand-back changes is the gap's
            // attribution — the table's for the tail, not this frame's.
            if (i > 0 && frames.every((frame) => frame.frame === "sacrifice"))
                return null;
            return refuse(
                `"${member}" is not a verb frame this chain reads`,
                member,
                i
            );
        }
        if ("refused" in read)
            return read.failure !== undefined &&
                !read.failure.ok &&
                read.failure.fragment !== member
                ? read.failure
                : refuse(read.refused, member, i);
        if ("reveal" in read) {
            const at = frames.lastIndexOf(lastSearch!);
            frames[at] = { ...lastSearch!, reveal: read.reveal };
            continue;
        }
        frames.push(...read.frames);
        referent = read.referent;
    }
    // CR 701.23a — a search finds a card for a reason: a find no later frame
    // puts anywhere is a sentence we have misread, not a search that ends in
    // the library.
    if (referent !== null && !referent.consumed) {
        const last = members[members.length - 1]!;
        return refuse(
            "the found card is put nowhere — no frame after the search moves it",
            last,
            members.length
        );
    }
    return ok(
        continuation ? { frames, continuation: true as const } : { frames }
    );
}
