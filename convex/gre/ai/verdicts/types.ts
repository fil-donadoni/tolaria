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
 *  what a test fixture and a hand-cut counter-example are. `store` ones were
 *  read from the Verdict Store through the Verdict Lock (issue #3578): the
 *  stored object carries only the judgement, so whether it was given in play
 *  or by hand is its attestations' to say (ADR 0128 §4), not the corpus's. */
export type VerdictSource = "registry" | "in-play" | "authored" | "store";

/** The second axis of where a judgement came from (ADR 0128 §11,
 *  issue #3579). `explicit`: a person GAVE it — "this move is right" — in play, in a
 *  quiz, by hand, or by confirming a Verdict Proposal. `implicit`: it was
 *  read off play — "this move was chosen" — which is a weaker claim, since two
 *  good moves in one position are normal. Only explicit judgements can
 *  contradict each other; implicit ones need aggregation and a reduced trust
 *  weight instead, and no producer writes one yet. Recorded on the
 *  attestation, not the judgement, because the Verdict Store object is the
 *  judgement alone (ADR 0128 §4). */
export type VerdictSourceAxis = "explicit" | "implicit";

/** One author's word for a stored verdict — the shape of the Verdict Store's
 *  `attestations/<verdictId>/<author>` object. It carries what contradiction
 *  detection reads today; the provenance the outbox stores beside it (when,
 *  note, originating deployment — issue #3580) is added to THIS type, not to a
 *  second one. */
export type VerdictAttestation = {
    /** The verdict id (`identity.ts`) of the judgement attested. */
    verdictId: string;
    /** `${deployment}:${userId}` — never an email (ADR 0128 §4). */
    author: string;
    sourceAxis: VerdictSourceAxis;
    // Provenance the outbox writes (issue #3580). Optional on the TYPE because
    // contradiction detection reads none of it; every attestation the outbox
    // uploads carries `createdAt`, `deployment` and `deploymentKind`.
    /** When the judgement was given (epoch ms). */
    createdAt?: number;
    /** The judge's own note, verbatim. */
    note?: string;
    /** The deployment the judgement entered the outbox on. */
    deployment?: string;
    /** `local` marks test traffic, so a reader can filter it out. */
    deploymentKind?: "cloud" | "local";
    /** The Bot's own pick at the time, by candidate index — what makes an
     *  in-play verdict a counter-example rather than a bare preference. */
    botPickIndex?: number;
    /** The game and the `seq` the decision was taken at, on `deployment`. */
    gameId?: string;
    seq?: number;
};

/** A human's decision about a Contested Position (issue #3582, ADR 0128 §6):
 *  which of its verdicts is right, and why each other one is not. The shape
 *  of the Verdict Store's `resolutions/<positionKey>/<resolutionId>` object.
 *
 *  A resolution DECIDES OVER A SET — the accepted verdict plus the rejected
 *  ones — and applies only while that set is exactly the position's explicit
 *  verdicts (`quarantine.ts`). A third answer arriving later reopens the
 *  position rather than riding in under a decision nobody made about it.
 *
 *  The rejected judgement is never removed: it stays in the store and is
 *  named here WITH its reason, because a position that keeps producing
 *  disagreement is itself a finding. */
export type VerdictResolution = {
    /** The position key (`identity.ts`) every decided verdict shares. */
    positionKey: string;
    /** The verdict judged right, or `null` when none of them is — every
     *  decided verdict is then rejected and the position states nothing. */
    acceptedVerdictId: string | null;
    /** Every other decided verdict, each with the resolver's reason. */
    rejected: { verdictId: string; reason: string }[];
    /** `${deployment}:${userId}` of the resolver — never an email. */
    author: string;
    // Provenance, outside the resolution id like an attestation's.
    /** When the resolution was given (epoch ms). */
    createdAt?: number;
    /** The resolver's own note about the position, verbatim. */
    note?: string;
    /** The deployment the resolution entered the outbox on. */
    deployment?: string;
    /** `local` marks test traffic. */
    deploymentKind?: "cloud" | "local";
};

/** Two authors who are one person (issue #3585, ADR 0128 §4). User ids are
 *  per-deployment, so the same human judging on dev and on production is two
 *  `${deployment}:${userId}` authors until an alias joins them. Symmetric and
 *  unordered — `authors` is sorted — so one fact has one encoding; chains
 *  join transitively (`testerQuality.ts`). The shape of the Verdict Store's
 *  `aliases/<author>/<author>` object. */
export type VerdictAuthorAlias = {
    authors: [string, string];
};

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
    /** Decklists the SEARCH was allowed to know when this decision was judged,
     *  carried in the blade entry's own vocabulary (card NAMES, per seat) —
     *  issue #3533.
     *
     *  Without it a verdict derived from an informed blade entry rebuilds as a
     *  BLIND position: the two candidates the entry exists to separate then
     *  carry identical feature vectors, the pair is reported as "the
     *  evaluation cannot separate them at all", and the fit spends the entry's
     *  pairs on whatever incidental comparisons the position still offers. */
    deckKnowledge?: { seat: BladeSeat; cards: string[] }[];
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
    /** Where an `in-play` verdict was taken, when it is known (issue #3402).
     *  Provenance only — nothing rebuilds from it, because the game it names
     *  may be long deleted and the position is already here in `spec`. It
     *  exists so that a verdict can still be traced back to the match that
     *  produced it while anyone remembers it. */
    origin?: { gameId?: string; seq?: number };
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
     *  these. `history`: the entry declares a `revisit` loop (issue #3590) —
     *  its answer depends on the seat's decision history, which is not in the
     *  position, so both candidates carry ONE feature vector by construction
     *  and no weight could ever be fitted to it. */
    reason:
        | "history"
        | "predicate"
        | "build"
        | "no-match"
        | "not-deciding"
        | "unconstraining";
    detail: string;
};
