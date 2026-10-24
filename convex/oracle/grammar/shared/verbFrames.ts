/**
 * Shared sub-grammar: VERB FRAMES and the Composition Rules that join them —
 * "Search your library for a card, put that card into your hand, then
 * shuffle." (CR 701.23a, CR 608.2c; issue #6557, the compositional pilot).
 *
 * A Verb Frame is ONE Effect Script Op spelled as Oracle text, its arguments
 * filled by the leaf sub-grammars (object descriptor, quantity, zone
 * reference) rather than by a table of whole printed sentences. Three frames
 * ship here, one per Op:
 *
 *  - `search`   — the `choice` Op over the controller's library:
 *                 "Search your library for <quantity> <descriptor>", with the
 *                 optional reveal of the find ("…, reveal it") as its argument
 *                 (CR 701.20a — how the other players learn what was taken).
 *  - `moveZone` — "put <pronoun> <into|onto|on> <zone>[ tapped]": the found
 *                 card changes zone (CR 400.7), to the hand, the battlefield
 *                 (tapped when printed, CR 110.5b), the top of the library or
 *                 the graveyard — the destinations a corpus card prints.
 *  - `shuffle`  — the bare "shuffle" (CR 701.24a), the "that player shuffles"
 *                 that closes a search of another player's library, and the
 *                 instant tutors' "shuffle and put <pronoun> on top", whose
 *                 printed order (shuffle BEFORE the placement, or the shuffle
 *                 would bury the card) is kept as two frames.
 *
 * A frame CHAIN is the members of one sentence in printed order, joined by
 * ", " or ", then " (CR 608.2c — instructions are followed in the order
 * written, so the comma and the "then" are the same join), or opened by a
 * sentence-initial "Then" (the ". Then" connector, `continuation`). Two
 * Composition Rules act inside the chain:
 *
 *  - the OBJECT PRONOUN ("it", "that card", "the card", "them", "those
 *    cards") binds to the last frame that produced a referent — the search —
 *    and is refused with no referent or with the wrong number (CR 608.2c:
 *    the rules of English applied to the text — the pronoun names the card
 *    the earlier instruction found); a find that no later frame moves, or one
 *    moved twice, is refused as well;
 *  - the chain is REFUSED whole when any member is not a frame: a sentence
 *    half read by frames and half by the sentence table is a reading nobody
 *    has vetted.
 *
 * Fail-closed, like every sub-grammar here: an argument outside a frame's
 * declared classes (a quantity "any number of", a destination "its owner's
 * hand", a descriptor naming a card) fails the member it sits in, and the
 * member is what the attribution names — so `oracle:report --families` groups
 * the gap under the frame it needs ({@link frameOf}).
 */

import { readNumberWord } from "./quantity";
import type { EffectCardFilter } from "../../../cards/types";
import { fail, ok, type FailureTrace, type RuleResult } from "../../rule";
import {
    descriptorRule,
    librarySearchFilterFromDescriptor,
} from "./targetFilter";
import { zoneRefRule } from "./zoneRef";

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

/** CR 400.7 — where a `moveZone` frame may put the found card. */
export type MoveDestination =
    | "hand"
    | "battlefield"
    | "library-top"
    | "graveyard";

export type FrameIR =
    | {
          readonly frame: "search";
          /** What the search may find (CR 701.23a), as the Op's filter. */
          readonly filter: EffectCardFilter;
          /** The quantity and description as printed, kept for the prompt. */
          readonly phrase: string;
          /** How many cards the quantity names ("a" = 1, "up to N" = N). */
          readonly count: number;
          /** "up to N": the find is a range, never compelled. */
          readonly upTo: boolean;
          /** CR 701.20a — the reveal of the find, when the line prints one. */
          readonly reveal?: PronounIR;
      }
    | {
          readonly frame: "moveZone";
          readonly pronoun: PronounIR;
          readonly to: MoveDestination;
          /** CR 110.5b — "onto the battlefield tapped". */
          readonly tapped: boolean;
      }
    | {
          readonly frame: "shuffle";
          /** Whose library: the controller's, or the target player's whose
           *  library the sentence before searched ("Then that player
           *  shuffles", folded by sentence assembly). */
          readonly player: "you" | "that-player";
      };

/**
 * One sentence read as frames. Deliberately WITHOUT a `kind`: the frame layer
 * is not a row of the sentence table (`EffectSentenceIR`'s kinds), and the
 * shrink-only kind census (`scripts/lib/sentence-kinds.ts`, read off this
 * source at two trees) counts the table alone. `kind?: undefined` lets every `switch (sentence.kind)` fall through
 * to the frame lowering without narrowing by hand at each consumer.
 */
export interface FrameChainIR {
    readonly kind?: undefined;
    readonly frames: readonly FrameIR[];
    /** Opened by a sentence-initial "Then" (the ". Then" connector). */
    readonly continuation?: true;
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
    {
        name: "moveZone",
        opens: new RegExp(`^put ${PRONOUN} (into|onto|on) `, "i"),
    },
    {
        name: "shuffle",
        opens: /^(?:shuffle(?:$| and put )|(?:that|the) player shuffles\b)/i,
    },
];

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
const REVEAL = new RegExp(`^reveal ${PRONOUN}$`);
const PUT = new RegExp(`^put ${PRONOUN} (into|onto|on) (.+?)( tapped)?$`);
const SHUFFLE_AND_TOP = new RegExp(`^shuffle and put ${PRONOUN} on top$`);
const THAT_PLAYER_SHUFFLES =
    /^(?:that|the) player shuffles(?: their library)?$/;

/**
 * CR 400.1 — the destinations a `moveZone` frame reads, by preposition. The
 * elided "on top" (the instant tutors' spelling) names the library the search
 * just looked through; every other destination is a zone reference the shared
 * sub-grammar reads, owned by the controller or by no one (the battlefield,
 * exile).
 */
function readDestination(
    preposition: string,
    zone: string
): MoveDestination | string {
    if (preposition === "on") {
        if (zone === "top") return "library-top";
        const ref = zoneRefRule.run(zone, undefined);
        if (
            ref.ok &&
            ref.value.zone === "library" &&
            ref.value.position === "top"
        )
            return ref.value.owner === "you"
                ? "library-top"
                : "a found card goes on top of your own library";
        return `"on ${zone}" is not a destination the moveZone frame reads`;
    }
    const ref = zoneRefRule.run(zone, undefined);
    if (!ref.ok) return ref.reason;
    const { zone: kind, owner, position } = ref.value;
    if (position !== undefined)
        return `"${preposition} ${zone}" is not a destination the moveZone frame reads`;
    if (kind === "battlefield")
        return preposition === "onto"
            ? "battlefield"
            : '"into the battlefield" is not how a card enters';
    if (preposition !== "into")
        return `"onto ${zone}" is not a destination the moveZone frame reads`;
    if (kind === "library")
        return "a found card goes on top of the library, not back into it";
    // "put it into exile" is a destination no corpus card prints for a found
    // card (the printed verb is "exile it"), so it has no argument class here.
    if (kind === "exile")
        return '"into exile" is not a destination the moveZone frame reads';
    if (owner !== "you")
        return "a found card goes to your own hand or graveyard";
    return kind;
}

/** The referent the chain has produced so far: the find of the last search. */
interface Referent {
    readonly plural: boolean;
    /** A `moveZone` has already taken the find out of the library. */
    readonly consumed: boolean;
}

function agreeing(
    pronoun: PronounIR,
    referent: Referent | null
): string | null {
    if (referent === null)
        return `"${pronoun}" names a card no frame before it found`;
    if (SINGULAR_PRONOUNS.has(pronoun) === referent.plural)
        return `"${pronoun}" does not agree in number with the cards found`;
    return null;
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
    | { readonly refused: string }
    | null {
    const lower = member[0]!.toLowerCase() + member.slice(1);

    if (VERB_FRAMES[0]!.opens.test(lower)) {
        const rest = lower.slice("search your library for ".length);
        const one = rest.match(SEARCH_ONE);
        const upTo = rest.match(SEARCH_UP_TO);
        let count: number;
        let noun: string;
        if (one !== null) {
            count = 1;
            noun = one[2]!;
        } else if (upTo !== null) {
            const n = readNumberWord(upTo[1]!);
            if (n === null || n < 2)
                return {
                    refused: `"up to ${upTo[1]}" is not a count of two or more`,
                };
            count = n;
            noun = upTo[2]!;
        } else {
            return {
                refused: `"${rest}" is not a quantity class the search frame reads ("a", "an", "up to N")`,
            };
        }
        const descriptor = descriptorRule.run(noun, ctx);
        if (!descriptor.ok) return { refused: descriptor.reason };
        if ((descriptor.value.plural === true) !== count > 1)
            return {
                refused: `"${rest}" pairs the quantity with the wrong number`,
            };
        const filter = librarySearchFilterFromDescriptor(descriptor.value);
        if (!filter.ok) return { refused: filter.reason };
        return {
            frames: [
                {
                    frame: "search",
                    filter: filter.value,
                    phrase: rest,
                    count,
                    upTo: upTo !== null,
                },
            ],
            referent: { plural: count > 1, consumed: false },
        };
    }

    const reveal = lower.match(REVEAL);
    if (reveal !== null) {
        const pronoun = reveal[1] as PronounIR;
        const disagreement = agreeing(pronoun, referent);
        if (disagreement !== null) return { refused: disagreement };
        if (lastSearch === null || lastSearch.reveal !== undefined)
            return {
                refused:
                    '"reveal" follows no search, or a search already revealed',
            };
        return { reveal: pronoun };
    }

    const put = lower.match(PUT);
    if (put !== null) {
        const pronoun = put[1] as PronounIR;
        const disagreement = agreeing(pronoun, referent);
        if (disagreement !== null) return { refused: disagreement };
        const to = readDestination(put[2]!, put[3]!);
        const known: readonly string[] = [
            "hand",
            "battlefield",
            "library-top",
            "graveyard",
        ];
        if (!known.includes(to)) return { refused: to };
        if (referent!.consumed)
            return {
                refused: `"put ${pronoun} …" moves a card an earlier frame already put somewhere`,
            };
        const tapped = put[4] !== undefined;
        if (tapped && to !== "battlefield")
            return {
                refused:
                    '"tapped" is a state only a permanent entering the battlefield has (CR 110.5b)',
            };
        return {
            frames: [
                {
                    frame: "moveZone",
                    pronoun,
                    to: to as MoveDestination,
                    tapped,
                },
            ],
            referent: { ...referent!, consumed: true },
        };
    }

    if (lower === "shuffle")
        return { frames: [{ frame: "shuffle", player: "you" }], referent };
    const shuffleTop = lower.match(SHUFFLE_AND_TOP);
    if (shuffleTop !== null) {
        const pronoun = shuffleTop[1] as PronounIR;
        const disagreement = agreeing(pronoun, referent);
        if (disagreement !== null) return { refused: disagreement };
        if (referent!.consumed)
            return {
                refused: `"put ${pronoun} on top" moves a card an earlier frame already put somewhere`,
            };
        return {
            frames: [
                { frame: "shuffle", player: "you" },
                {
                    frame: "moveZone",
                    pronoun,
                    to: "library-top",
                    tapped: false,
                },
            ],
            referent: { ...referent!, consumed: true },
        };
    }
    if (THAT_PLAYER_SHUFFLES.test(lower))
        return {
            frames: [{ frame: "shuffle", player: "that-player" }],
            referent,
        };
    if (VERB_FRAMES[1]!.opens.test(lower) || VERB_FRAMES[2]!.opens.test(lower))
        return { refused: `"${member}" is not a form of the frame it opens` };
    return null;
}

/**
 * Read a whole sentence as a frame chain. `null` when its first member opens
 * no frame (the sentence is the table's to read); a refusal when it opens one
 * and a member fails — attributed to THAT member, with the chain's progress
 * (how many members before it were read) so the deepest failure wins.
 */
export function readFrameChain(
    span: string,
    ctx: unknown
): RuleResult<FrameChainIR> | null {
    const continuation = /^Then /.test(span);
    const body = continuation ? span.slice("Then ".length) : span;
    const members = body
        .split(", ")
        .map((m, i) => (i === 0 ? m : m.replace(/^then /, "")));
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
        if (read === null)
            return refuse(
                `"${member}" is not a verb frame this chain reads`,
                member,
                i
            );
        if ("refused" in read) return refuse(read.refused, member, i);
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
