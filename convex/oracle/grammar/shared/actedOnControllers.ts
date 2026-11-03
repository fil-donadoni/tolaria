/**
 * Shared sub-grammar: the PER-CONTROLLER tail of a removal — "For each
 * creature exiled this way, its controller searches their library for a basic
 * land card. Those players put those cards onto the battlefield tapped, then
 * shuffle." (Winds of Abandon; issue #7531).
 *
 * Two sentences, one instruction. The first names who acts — every player who
 * controlled an object the sentence before it exiled — and what each of them
 * searches for, once per such object; the second is the rest of the chain
 * those same players perform with what they found. Neither means anything
 * alone ("those players" and "those cards" have no antecedent without the
 * first; the first's find goes nowhere without the second), so each sentence
 * is a ROLE of the sentence list — never a row of the sentence-kind table —
 * and `assembleSentences` folds the pair into ONE Verb Frame chain carrying
 * `perActedOnController` (`verbFrames.ts`).
 *
 * The chain reuses the frames' own readers: the search argument is
 * `readSearchFrame`'s, the second sentence's body is read by `readFrameChain`
 * with the first sentence's find as its pronoun's referent. Only the
 * third-person spelling is this file's: "its controller searches their
 * library for" is the `search` frame performed by someone other than the
 * controller, and "Those players <verb>" is a plural subject whose verb is
 * the imperative form — "put", "shuffle" — so the body behind it is read
 * verbatim, no word rewritten.
 *
 * Fail-closed: only the noun and verb the corpus prints ("creature",
 * "exiled") are read; a find of more than one card per object ("for two basic
 * land cards"), an optional search ("may search"), and a second sentence with
 * any other subject are refused, as is either sentence without the other.
 */

import type { CardType } from "../../../cards/types";
import { fail, ok, type RuleResult } from "../../rule";
import type { EffectSentenceIR, SentenceIR } from "./effectClause";
import {
    readFrameChain,
    readSearchFrame,
    type FrameChainIR,
    type FrameIR,
} from "./verbFrames";

/**
 * CR 608.2c + CR 608.2h — "For each <noun> <verb> this way, its controller
 * searches their library for <a card>": the searchers are the last-known
 * controllers of the objects the sentence before acted on.
 */
const FOR_EACH_ACTED_ON_CONTROLLER_SEARCHES =
    /^For each (\S+) (\S+) this way, its controller searches their library for (.+)$/;

/** The nouns and verbs the per-controller head reads, as the corpus prints them. */
const ACTED_ON_NOUNS: ReadonlyMap<string, CardType> = new Map([
    ["creature", "Creature"],
]);
const ACTED_ON_VERBS: ReadonlyMap<string, "exile"> = new Map([
    ["exiled", "exile"],
]);

/** "Those players <imperative chain>": the searchers of the sentence before. */
const THOSE_PLAYERS = /^Those players (.+)$/;

/** The first sentence: who searches, and for what (per acted-on object). */
export interface ActedOnControllersSearchIR {
    readonly role: "acted-on-controllers-search";
    readonly noun: CardType;
    readonly verb: "exile";
    readonly search: Extract<FrameIR, { frame: "search" }>;
}

/** The second sentence: the chain those players perform with their find. */
export interface ThosePlayersChainIR {
    readonly role: "those-players-chain";
    readonly chain: FrameChainIR;
}

/**
 * Read either sentence of the pair; `null` when the span is neither (the
 * sentence is someone else's to read).
 */
export function readActedOnControllersSentence(
    span: string,
    ctx: unknown
): RuleResult<SentenceIR> | null {
    const head = span.match(FOR_EACH_ACTED_ON_CONTROLLER_SEARCHES);
    if (head !== null) {
        const noun = ACTED_ON_NOUNS.get(head[1]!);
        const verb = ACTED_ON_VERBS.get(head[2]!);
        if (noun === undefined || verb === undefined)
            return fail(
                `"each ${head[1]} ${head[2]} this way" is not an acted-on object the per-controller search reads`,
                span
            );
        const search = readSearchFrame(head[3]!, ctx);
        if ("refused" in search) return fail(search.refused, span);
        // CR 701.23h — the per-object find is ONE card: the player's single
        // search is for as many as they had objects acted on. A printed count
        // per object would multiply, which no lowering here reads.
        if (search.count !== 1 || search.upTo)
            return fail(
                `"${head[3]}" is not one card per ${head[1]} — the per-controller search reads "a"/"an" only`,
                span
            );
        return ok({
            role: "acted-on-controllers-search" as const,
            noun,
            verb,
            search,
        } satisfies SentenceIR);
    }
    const those = span.match(THOSE_PLAYERS);
    if (those !== null) {
        // CR 608.2c — "those cards" are every searcher's finds: plural.
        const chain = readFrameChain(capitalise(those[1]!), ctx, {
            found: { plural: true },
        });
        if (chain === null)
            return fail(
                `"Those players ${those[1]}" opens no verb frame`,
                span
            );
        if (!chain.ok) return chain;
        if (chain.value.continuation === true)
            return fail('"Those players then …" is no chain', span);
        return ok({
            role: "those-players-chain" as const,
            chain: chain.value,
        } satisfies SentenceIR);
    }
    return null;
}

/**
 * CR 608.2c — fold the pair onto the removal before it: the first sentence
 * must follow an `exile` of ONE announced <noun> (the object whose controller
 * "its controller" names), and the second must follow the first.
 */
export function foldActedOnControllers(
    previous: EffectSentenceIR | undefined,
    head: ActedOnControllersSearchIR,
    tail: ThosePlayersChainIR
):
    | { readonly ok: true; readonly effect: FrameChainIR }
    | { readonly ok: false; readonly reason: string } {
    if (
        previous?.kind !== head.verb ||
        previous.returnsToBattlefield === true ||
        previous.subject.kind !== "target" ||
        previous.subject.requirement.type !== head.noun
    )
        return {
            ok: false,
            reason: `"For each ${head.noun.toLowerCase()} ${head.verb}d this way, its controller …" follows no ${head.verb} of one targeted ${head.noun.toLowerCase()}`,
        };
    return {
        ok: true,
        effect: {
            frames: [head.search, ...tail.chain.frames],
            perActedOnController: { noun: head.noun, verb: head.verb },
        },
    };
}

function capitalise(text: string): string {
    return text[0]!.toUpperCase() + text.slice(1);
}
