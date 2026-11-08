// Flip Sequence — the pure half of `SpellContext.requestFlipSequence` (CR 705,
// ADR 0023 Amendment I). Everything here is a function of its arguments: the
// PRNG arrives as a callback, so the drawing loop, the record derivation and
// the Oracle excerpt are testable without a game and carry no engine import.

import type {
    FlipFace,
    FlipOutcome,
    FlipRecord,
    FlipStopRule,
    RealizedOutcome,
} from "./types";

/** Bounds a rule that has no fixed length. Such a sequence ends with
 *  probability 1, so the limit is never reached in play; it only keeps a
 *  predicate that can never hold from looping forever. */
export const FLIP_SEQUENCE_ROUND_LIMIT = 1000;

/** What `SpellContext.requestFlipSequence` takes. `flippers` is who flips each
 *  round, in order, and is stable across replays like `choiceId`: the persisted
 *  faces are read back through it. The first flipper acknowledges the reveal.
 *  `realize` describes the drawn sequence on the Pending Choice, and runs once,
 *  at the draw.
 *
 *  `faceOnly` is CR 705.2's "care only about whether the coin comes up heads or
 *  tails": no player wins or loses, so every record's outcome is `none` and
 *  `untilLoss` could never stop it (the type refuses the pair). */
export type FlipSequenceRequest = {
    choiceId: string;
    flippers: string[];
    /** The number the effect announced as the most flips it may make ("choose
     *  a number … that many times"). Shown to both seats as "Flip k of up to
     *  N"; absent when the effect announced none, so the heading never hints
     *  at the length. */
    announcedLimit?: number;
    realize?: (flips: readonly FlipRecord[]) => RealizedOutcome;
} & (
    | { stop: FlipStopRule; faceOnly?: false }
    | {
          stop: Exclude<FlipStopRule, { kind: "untilLoss" }>;
          faceOnly: true;
      }
);

/** CR 705.2 — heads is the flipper's win, unless the effect only reads the
 *  face, where nobody wins or loses. */
function flipOutcome(face: FlipFace, faceOnly: boolean): FlipOutcome {
    if (faceOnly) return "none";
    return face === "heads" ? "win" : "lose";
}

/** The records one round's faces stand for. */
function roundRecords(
    faces: readonly FlipFace[],
    round: number,
    flippers: readonly string[],
    faceOnly: boolean
): FlipRecord[] {
    return faces.map((face, i) => ({
        flipperId: flippers[i],
        face,
        outcome: flipOutcome(face, faceOnly),
        round,
    }));
}

/** Rebuilds the records from the persisted faces, the only thing stored in
 *  `collectedChoices`: draw order is round order, then flipper order. The same
 *  derivation serves the first call and the resume, so the list a client
 *  animated is the list the consequence reads. */
export function flipRecordsFromFaces(
    faces: readonly FlipFace[],
    flippers: readonly string[],
    faceOnly: boolean
): FlipRecord[] {
    const records: FlipRecord[] = [];
    if (flippers.length === 0) return records;
    for (let i = 0; i < faces.length; i += flippers.length) {
        const round = i / flippers.length;
        records.push(
            ...roundRecords(
                faces.slice(i, i + flippers.length),
                round,
                flippers,
                faceOnly
            )
        );
    }
    return records;
}

/** Whether the rule ends the sequence after a round it has just seen. */
function roundStops(stop: FlipStopRule, round: readonly FlipRecord[]): boolean {
    if (stop.kind === "untilLoss") {
        return round.some((flip) => flip.outcome === "lose");
    }
    return stop.kind === "until" && stop.stop(round);
}

/** How many rounds the rule may run before it stops by length alone. */
function roundCap(stop: FlipStopRule): number {
    const declared =
        stop.kind === "count"
            ? stop.count
            : stop.kind === "untilLoss"
              ? stop.maxRounds
              : undefined;
    return declared === undefined
        ? FLIP_SEQUENCE_ROUND_LIMIT
        : Math.min(declared, FLIP_SEQUENCE_ROUND_LIMIT);
}

/** Draws a whole sequence: one `flip()` per flipper per round, until the stop
 *  rule ends it. Returns the faces in draw order. */
export function drawFlipFaces(
    flip: () => boolean,
    flippers: readonly string[],
    stop: FlipStopRule,
    faceOnly: boolean
): FlipFace[] {
    const faces: FlipFace[] = [];
    if (flippers.length === 0) return faces;
    const cap = roundCap(stop);
    for (let round = 0; round < cap; round += 1) {
        const roundFaces = flippers.map(
            (): FlipFace => (flip() ? "heads" : "tails")
        );
        faces.push(...roundFaces);
        const records = roundRecords(roundFaces, round, flippers, faceOnly);
        if (roundStops(stop, records)) break;
    }
    return faces;
}

const FLIPS_A_COIN = /\bflips?\b.*\bcoins?\b/i;
const MENTIONS_THE_FLIP = /\b(?:flips?|coins?)\b/i;

/** A sentence without its activation cost (CR 602.1a, everything before the
 *  colon), when the flip is on the effect's side of that colon. */
function withoutActivationCost(sentence: string): string {
    const effect = sentence.replace(/^[^:]*:\s+/, "");
    return FLIPS_A_COIN.test(effect) ? effect : sentence;
}

/** The Oracle excerpt a reveal quotes: on the first ability line that flips a
 *  coin, the sentences from that one through the last that still speaks of the
 *  flip or the coin, so the excerpt says what winning and losing mean. Reminder
 *  text and an activation cost are not the flip's words and are dropped.
 *  Undefined when the text holds no coin flip: an ability granted by text that
 *  does not spell it, or a definition with no Oracle text. */
export function flipOracleExcerpt(
    oracleText: string | undefined
): string | undefined {
    if (!oracleText) return undefined;
    for (const line of oracleText.split("\n")) {
        const sentences = line
            .replace(/\s*\([^)]*\)/g, "")
            .split(/(?<=[.!?]["”]?)\s+/)
            .filter((sentence) => sentence.length > 0);
        const first = sentences.findIndex((s) => FLIPS_A_COIN.test(s));
        if (first === -1) continue;
        const last = sentences
            .map((s) => MENTIONS_THE_FLIP.test(s))
            .lastIndexOf(true);
        return [
            withoutActivationCost(sentences[first]),
            ...sentences.slice(first + 1, last + 1),
        ].join(" ");
    }
    return undefined;
}
