// The Verdict — a player's answer to "which move here?" — as DATA
// (issue #3400, PRD #3397, ADR 0124 §1).
//
// A Verdict is a POSITION AND AN ANSWER, never a feature vector. That is the
// whole point: the evaluation's terms will change, and a record made of
// numbers would be invalidated by every one of those changes, while a record
// made of a board and "the right move was X" survives all of them. The
// feature vector is DERIVED at fit time (`evalPairs.ts`) and thrown away.
//
// Everything here is plain, serialisable data in the same NAME-BASED
// vocabulary the blade registry and the Debug panel's "Copy as scenario"
// already speak: a `ScenarioSpec` for the board, `BladeSetupStep`s for the
// walk to the decision, and candidates identified by a structural move key
// plus the move describer's sentence. No `Move` object is stored — moves
// carry instance ids, which are an artefact of how a state was BUILT, so a
// stored move would rot the first time the builder allocated differently.
// `evalPairsOf` rebuilds the position and re-enumerates, and a key that no
// longer resolves is REPORTED as stale rather than silently dropped.

import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { BladeSeat, BladeSetupStep } from "../blade/types";

/** Where a Verdict came from. `registry` verdicts are DERIVED (from the blade
 *  registry, at fit time — never stored); `in-play` ones come from a tester
 *  judging a real Bot decision; `authored` ones are written by hand, which is
 *  what a test fixture and a hand-cut counter-example are. */
export type VerdictSource = "registry" | "in-play" | "authored";

/** One move the Bot's enumerator offered at the decision under judgement. */
export type VerdictCandidate = {
    /** The structural move key (`search.ts`'s `moveKey`) — how the candidate
     *  is found again on a rebuilt position. */
    key: string;
    /** The existing move describer's sentence (`describeMove`), so a verdict
     *  reads as a decision in a diff and a UI need not re-derive it. */
    description: string;
};

/** What the judge SAID about the candidate list.
 *
 *  `right` is a Verdict proper: the play had to be one of these. `forbidden`
 *  is the weaker constraint a blade `forbidden` expectation carries — "not
 *  this, whatever else" — which names no right answer at all. Kept a
 *  discriminated union rather than one optional index so no consumer can read
 *  a forbidden record as if it named a right move.
 *
 *  WHY `rightIndexes` IS A LIST, and not "the index of the right candidate"
 *  as PRD #3397 first wrote it. A blade `moves` expectation is explicitly
 *  "the chosen move must match AT LEAST ONE matcher — these are all
 *  acceptable best plays" (`blade/types.ts`), and its matchers are PARTIAL:
 *  `{ kind: "cast-spell", card: "Stone Rain" }` accepts the cast whatever it
 *  targets. On the registry's own Stone Rain entry that is SIX candidates,
 *  three of which point the spell at the Bot's own Mountains — so "the first
 *  enumerated move the matcher accepts" names destroying your own land as the
 *  right play, and the pair built from it asserts the opposite of what the
 *  entry says. A tester's in-play verdict names exactly one candidate and
 *  arrives here as a singleton, which is the shape the PRD described. */
export type VerdictAnswer =
    | { kind: "right"; rightIndexes: number[] }
    | { kind: "forbidden"; forbiddenIndexes: number[] };

/** A judged decision: the position, the candidates, and the answer. */
export type Verdict = {
    /** Stable, unique id. `registry:<blade label>` for a derived one. */
    id: string;
    /** The board, in the `ScenarioSpec` vocabulary (name-based, diff-readable). */
    spec: ScenarioSpec;
    /** Engine-real steps that walk the built board to the decision, exactly as
     *  a blade entry's `setup` does. Omitted for a decision on a fresh board. */
    setup?: BladeSetupStep[];
    /** The seat that owed the decision. */
    seat: BladeSeat;
    /** The candidates, in the order `enumerateMoves` produced them. */
    candidates: VerdictCandidate[];
    /** The judgement. */
    answer: VerdictAnswer;
    /** The Bot's OWN pick at the time, by candidate index, when it is known.
     *  A registry verdict does not know it (deriving it would mean running the
     *  search for every entry, which is the blade suite's job, not this one's). */
    botPickIndex?: number;
    /** Who judged. `blade-registry` for a derived verdict. */
    author: string;
    /** ISO 8601. For a derived verdict, the registry's own provenance has no
     *  date, so the constant `REGISTRY_VERDICT_TIMESTAMP` stands in — a fixed
     *  value, never `Date.now()`, or the derivation stops being deterministic. */
    createdAt: string;
    source: VerdictSource;
    /** Optional prose carried over from the source (a blade entry's `note`). */
    note?: string;
};

/** Why a blade entry produced NO verdict — listed by the report, never
 *  silently skipped (PRD #3397, "both are reported"). */
export type VerdictGap = {
    label: string;
    tier: string;
    /** `predicate`: the expectation is a closure, so there is no candidate to
     *  name. `build`: the position could not be built or walked (the entry's
     *  own `setup` threw). `no-match`: no enumerated move satisfies the
     *  entry's matchers, which is an authoring error in the entry, not a
     *  property of the Bot. `not-deciding`: the declared seat owes nothing.
     *  `unconstraining`: the expectation partitions the candidate list into
     *  everything and nothing, so it states no preference — the forced-move
     *  position (one legal line, which every decider takes) and the entry
     *  whose forbidden move is not even enumerable. A real outcome, not a
     *  failure, and the reason the verdict count is `moves` entries MINUS
     *  these. */
    reason:
        | "predicate"
        | "build"
        | "no-match"
        | "not-deciding"
        | "unconstraining";
    detail: string;
};
