// Pick Rating layer (ADR 0054/0055, PRD #1107 story 28, issue #1117): an
// OPTIONAL per-set data file (0-5 scale, Draftmancer-style, hand-curated or
// community-imported) that REFINES the Bot Drafter's picks when present.
// A rating ANCHORS ordering: it is the base term of `botDrafter.ts`'s
// `scoreCandidate`, and context can never overturn a rating gap WIDER THAN
// THAT PICK'S CONTEXTUAL CAP (~0.3 rating points at pick 1, ~2.0 by the end of
// the draft). The cap is a bound on the DIFFERENCE between two candidates
// because every candidate's contextual sum is clamped to `[0, cap]` — fit is
// a bonus, never a penalty (ADR 0073). A card
// with no rating entry falls back to the quality heuristic mapped onto the
// SAME 0–5 scale (`heuristicAsRating`) — ratings REFINE, never GATE, and a
// Draftable Set with no checked-in ratings file (or a card missing from one)
// still drafts.
//
// Same "small hand-maintained registry, no `fs` at runtime" shape as
// `registry.ts`'s `CHECKED_IN_BOOSTER_CONFIGS` — Convex functions run in a
// V8 isolate with no Node builtins, so `data/pick-ratings/**` can't be
// discovered dynamically. Add one line to `CHECKED_IN_PICK_RATINGS` below for
// every new checked-in Pick Rating file.
import leaRatingsJson from "../../data/pick-ratings/lea.json";
import vintageCubeRatingsJson from "../../data/pick-ratings/vintage-cube.json";
import { tryGetDefinition } from "../cards";
import { CUBE_SOURCE_KEY, buildCubePool } from "./cube";
import type { BoosterConfig } from "./boosterTypes";

/** A single checked-in Pick Rating file (Draftmancer-style, 0-5 scale,
 *  hand-curated or community-imported). Keyed by the canonical
 *  `CardDefinition.id` (NOT a printing's `scryfallId`) — a rating is a
 *  property of the CARD's role in the set's Limited environment, stable
 *  across whichever printing a future reprint carries (mirrors
 *  `DeckCardMeta.cardId`'s "canonical id, grouped across printings"
 *  discipline, `convex/cards/index.ts`). */
export interface PickRatingFile {
    setCode: string;
    /** cardId -> rating, `PICK_RATING_MIN` (never play) .. `PICK_RATING_MAX`
     *  (first-pick bomb). Fractional values are allowed — Draftmancer itself
     *  rates in finer-than-whole increments — the bounds are the only
     *  enforced constraint (`validatePickRatingFile`). An entry is OPTIONAL
     *  per card: a set's file only needs to rate the cards worth refining
     *  (bombs, format-warping removal, traps); everything absent falls back
     *  to the Pick Heuristic untouched. */
    ratings: Record<string, number>;
}

export const PICK_RATING_MIN = 0;
export const PICK_RATING_MAX = 5;

/** The single bounds check for a Pick Rating value (issue #1297, PRD #1296),
 *  extracted out of `validatePickRatingFile`'s per-entry rule so BOTH the
 *  checked-in seed file guard below AND the (later-slice) Admin write
 *  mutations (`setCardRating`) share one authority — never two copies of
 *  "is this a legal rating" that could drift apart. A finite number in
 *  `[PICK_RATING_MIN, PICK_RATING_MAX]`; rejects `NaN`, `Infinity`, a string,
 *  or anything out of range. */
export function isValidRating(rating: unknown): rating is number {
    return (
        typeof rating === "number" &&
        Number.isFinite(rating) &&
        rating >= PICK_RATING_MIN &&
        rating <= PICK_RATING_MAX
    );
}

const CHECKED_IN_PICK_RATINGS: Record<string, PickRatingFile> = {
    lea: leaRatingsJson as PickRatingFile,
    [CUBE_SOURCE_KEY]: vintageCubeRatingsJson as PickRatingFile,
};

/** Resolves a lowercase set code to its checked-in Pick Rating file, or
 *  `null` when the set ships with no ratings data — the "a Draftable Set
 *  without a ratings file keeps drafting on the heuristic alone" case (this
 *  issue's acceptance criteria, PRD #1107 story 28). Case-insensitive on the
 *  input, mirroring `registry.ts`'s `getBoosterConfig`. */
export function getPickRatingFile(setCode: string): PickRatingFile | null {
    return CHECKED_IN_PICK_RATINGS[setCode.toLowerCase()] ?? null;
}

/** Looks up a single card's rating within one named set's file. `null` when
 *  the set has no checked-in file, or the file has no entry for this card —
 *  both cases fall back to the quality heuristic identically (see
 *  `botDrafter.ts`'s `heuristicAsRating`). */
export function getPickRating(setCode: string, cardId: string): number | null {
    const file = getPickRatingFile(setCode);
    if (!file) return null;
    const rating = file.ratings[cardId];
    return rating === undefined ? null : rating;
}

/** Looks up a card's rating across EVERY checked-in Pick Rating file,
 *  regardless of which set(s) an event's `packSlots` actually draws from —
 *  mirrors `botDrafter.ts`'s own registry-agnostic `GetCardEvalMeta` shape,
 *  where a candidate resolves purely from its id and the scoring closure
 *  never threads "which set is this pack from" through the call
 *  (`convex/limitedEvents.ts`'s `botChoosePick` wiring). A card id is
 *  expected to own at most one entry across every checked-in file today
 *  (each Draftable Set's cards are disjoint); if that ever changes, the
 *  first file found wins (stable registry iteration order) — a fine
 *  tie-break for a case that can't occur yet. */
export function getPickRatingByCardId(cardId: string): number | null {
    for (const file of Object.values(CHECKED_IN_PICK_RATINGS)) {
        const rating = file.ratings[cardId];
        if (rating !== undefined) return rating;
    }
    return null;
}

export interface PickRatingValidationResult {
    valid: boolean;
    errors: string[];
}

/** Validates a Pick Rating file against the Booster Config of the set it
 *  claims to rate (this issue's acceptance criteria: "every entry resolves
 *  to a card of the set; scale bounds enforced by a guard test"). Two checks
 *  per entry:
 *
 *  1. **Resolves to a card of the set** — the cardId must be one of the
 *     canonical card ids reachable from `config`'s sheets (every sheet
 *     scryfallId's `CardDefinition.id`, via the single registry seam —
 *     mirrors `draftable.ts`'s `computeDraftability` walk).
 *  2. **In-bounds** — `PICK_RATING_MIN <= rating <= PICK_RATING_MAX`, and a
 *     finite number (guards against a hand-edited file smuggling in `NaN`,
 *     a string, or `Infinity`).
 *
 *  Pure — no I/O — so it runs identically over checked-in JSON (the
 *  catalogue-wide guard test) or a hand-built fixture (an out-of-bounds /
 *  unknown-card negative test). */
export function validatePickRatingFile(
    file: PickRatingFile,
    config: BoosterConfig
): PickRatingValidationResult {
    const errors: string[] = [];
    const validCardIds = new Set<string>();
    for (const sheet of Object.values(config.sheets)) {
        for (const scryfallId of Object.keys(sheet.cards)) {
            const def = tryGetDefinition(scryfallId);
            if (def) validCardIds.add(def.id);
        }
    }

    for (const [cardId, rating] of Object.entries(file.ratings)) {
        if (!validCardIds.has(cardId)) {
            errors.push(
                `${file.setCode}: rated cardId "${cardId}" does not resolve to a card of the set`
            );
        }
        if (!isValidRating(rating)) {
            errors.push(
                `${file.setCode}: rating for "${cardId}" (${rating}) is out of bounds [${PICK_RATING_MIN}, ${PICK_RATING_MAX}]`
            );
        }
    }

    return { valid: errors.length === 0, errors };
}

/** Validates a Pick Rating file against the Vintage Cube pool
 *  (`cube.ts#buildCubePool`) instead of a set's Booster Config — the cube has
 *  no print sheets (ADR 0062), so `validatePickRatingFile`'s sheet walk
 *  doesn't apply. Same two checks, against the pool's card ids instead:
 *
 *  1. **Resolves to a cube card** — the cardId must be one of the currently
 *     implemented cube pool's canonical card ids (issue #1299's "covers the
 *     currently-implemented cube pool" acceptance).
 *  2. **In-bounds** — identical `isValidRating` check as the set path.
 *
 *  Pure — no I/O — `buildCubePool` is memoized off the static card registry. */
export function validateCubePickRatingFile(
    file: PickRatingFile
): PickRatingValidationResult {
    const errors: string[] = [];
    const validCardIds = new Set(buildCubePool());

    for (const [cardId, rating] of Object.entries(file.ratings)) {
        if (!validCardIds.has(cardId)) {
            errors.push(
                `${file.setCode}: rated cardId "${cardId}" does not resolve to a card of the implemented Vintage Cube pool`
            );
        }
        if (!isValidRating(rating)) {
            errors.push(
                `${file.setCode}: rating for "${cardId}" (${rating}) is out of bounds [${PICK_RATING_MIN}, ${PICK_RATING_MAX}]`
            );
        }
    }

    return { valid: errors.length === 0, errors };
}
