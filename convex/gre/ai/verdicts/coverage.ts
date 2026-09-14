// What the Verdict corpus COVERS, by decision class (issue #3588, ADR 0124).
//
// The report next door (`report.ts`) answers "how well does the evaluation
// order the pairs we have". This module answers the question that has to come
// FIRST: *which decisions do we have at all*. The two are constantly confused,
// and the confusion is expensive — a corpus collected from a handful of games
// is dominated by the decisions those games happened to offer (land drops and
// casts), so a capacity measurement over it concludes something true of land
// drops and is READ as a conclusion about the evaluation.
//
// So every number here is per class, and a class below a threshold is a
// COLLECTION TARGET, not a result. "Blocking: 4 pairs" is not a finding about
// blocking; it is an instruction to go and author blocking positions.
//
// THE CLASSES COME FROM THE ENGINE. `CLASS_OF_MOVE_KIND` is a total
// `Record<Move["kind"], DecisionClass>`, so a new `Move` kind reds `tsc` here
// until someone says which class it belongs to. A hand-kept parallel list of
// "the kinds we care about" would silently bucket the next kind into nothing,
// and the census would report full coverage of a space that had just grown.
//
// NO REBUILD. A candidate's key IS its move (`moveKey` is `JSON.stringify`),
// so the class is readable off the stored verdict without touching the engine.
// That matters for the one case a rebuild cannot serve: a verdict whose
// position no longer builds still has a class, and still belongs in the
// denominator — dropping it would shrink exactly the classes the engine has
// most recently broken.

import type { Move } from "../../moves";
import type { EvalPair } from "./evalPairs";
import type { VerdictReport } from "./report";
import type { Verdict } from "./types";

/** A decision as a PLAYER would name it, not as the move model spells it.
 *
 *  Several move kinds fold into one class on purpose: `play-land` and
 *  `land-entry` are one decision to a player ("which land, if any"), and the
 *  protocol acknowledgements are one class because none of them is a judgement
 *  anybody would sit down to give. */
export type DecisionClass =
    | "land-drop"
    | "cast"
    | "activate"
    | "declare-attackers"
    | "declare-blockers"
    | "targeting"
    | "resolution-choice"
    | "optional-payment"
    | "mulligan"
    | "protocol"
    | "pass";

/** Every class, in the order a census prints them: the decisions a game is
 *  made of first, the protocol at the end. */
export const DECISION_CLASSES: readonly DecisionClass[] = [
    "land-drop",
    "cast",
    "activate",
    "declare-attackers",
    "declare-blockers",
    "targeting",
    "resolution-choice",
    "optional-payment",
    "mulligan",
    "protocol",
    "pass",
];

/** The engine's move kinds, mapped onto the classes. TOTAL over `Move["kind"]`
 *  — that totality is the point, see the header. */
export const CLASS_OF_MOVE_KIND: Record<Move["kind"], DecisionClass> = {
    pass: "pass",
    "play-land": "land-drop",
    "land-entry": "land-drop",
    "cast-spell": "cast",
    "activate-ability": "activate",
    "activate-granted-ability": "activate",
    "declare-attackers": "declare-attackers",
    "declare-blockers": "declare-blockers",
    "submit-target": "targeting",
    "resolution-choice": "resolution-choice",
    "mulligan-bottom": "mulligan",
    mulligan: "mulligan",
    "may-pay": "optional-payment",
    "name-card": "protocol",
    "number-choice": "protocol",
    "madness-decline": "protocol",
    "rebound-decline": "protocol",
    "draw-replacement": "protocol",
    "random-reveal-ack": "protocol",
    "summon-companion": "protocol",
    "turn-face-up": "protocol",
};

/** The class of one candidate, read off its structural key.
 *
 *  `null` when the key does not parse or names a kind the engine no longer
 *  has — reported as `unclassified` rather than folded into a class, because a
 *  census that quietly absorbs what it cannot read is a census that always
 *  looks complete. */
export function decisionClassOfKey(key: string): DecisionClass | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(key);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (typeof kind !== "string") return null;
    return CLASS_OF_MOVE_KIND[kind as Move["kind"]] ?? null;
}

/** The class a VERDICT teaches: the class of the candidates the judge NAMED
 *  (the right ones, or the forbidden ones when that is all the judgement
 *  says).
 *
 *  `"mixed"` when the named candidates span classes — a real answer, not a
 *  fallback: a judgement that accepts either casting or attacking is about
 *  neither class alone, and counting it under one of them would overstate that
 *  class's coverage. */
export function verdictDecisionClass(
    verdict: Verdict
): DecisionClass | "mixed" | null {
    const named =
        verdict.answer.kind === "right"
            ? verdict.answer.rightIndexes
            : verdict.answer.forbiddenIndexes;
    const classes = new Set<DecisionClass | null>();
    for (const index of named) {
        const candidate = verdict.candidates[index];
        if (candidate === undefined) continue;
        classes.add(decisionClassOfKey(candidate.key));
    }
    if (classes.size === 0) return null;
    if (classes.size > 1) return "mixed";
    const [only] = [...classes];
    return only ?? null;
}

/** The classes a verdict OFFERED, whatever the judge chose. Coverage of the
 *  option space rather than of the answers: it is what says how many judged
 *  decisions even had an attack available to reject. */
export function offeredDecisionClasses(verdict: Verdict): Set<DecisionClass> {
    const out = new Set<DecisionClass>();
    for (const candidate of verdict.candidates) {
        const cls = decisionClassOfKey(candidate.key);
        if (cls !== null) out.add(cls);
    }
    return out;
}

/** Was the judgement given with objects on the stack — i.e. is it about
 *  RESPONDING rather than acting? Read from the spec, which has carried the
 *  stack since issue #3515; before that the lowering refused those positions
 *  outright, which is why the axis matters more than its width suggests. */
export function isResponseVerdict(verdict: Verdict): boolean {
    return (verdict.spec.stack ?? []).length > 0;
}

/** One class's row of the census. */
export type CoverageRow = {
    class: DecisionClass | "mixed" | "unclassified";
    /** Verdicts whose ANSWER is in this class. */
    verdicts: number;
    /** Of those, how many were judged with a non-empty stack. */
    responses: number;
    /** Verdicts that OFFERED this class among their candidates, whatever the
     *  answer was. Never smaller than `verdicts`. */
    offered: number;
    /** Verdicts in this class whose position no longer rebuilds. Counted, and
     *  kept in `verdicts`: a stale verdict is a gap in the class, not an
     *  absence from it. */
    stale: number;
    pairs: number;
    satisfied: number;
    violated: number;
    /** Violated pairs whose two candidates carry IDENTICAL feature vectors —
     *  no weight vector, linear or otherwise, can order them. A limit of the
     *  feature space, never of the model class. */
    blind: number;
    /** Violated pairs that belong to a contradictory couple: two pairs whose
     *  basis deltas are anti-parallel, so satisfying one unsatisfies the
     *  other. Also unreachable by any weights over these features. */
    contradictory: number;
    /** `violated − blind − contradictory`: the pairs a better-fitted or
     *  richer model could actually buy. The ONLY number in this row that a
     *  model-class experiment may claim. */
    addressable: number;
};

export type CoverageCensus = {
    rows: CoverageRow[];
    totals: Omit<CoverageRow, "class">;
};

const EMPTY = (cls: CoverageRow["class"]): CoverageRow => ({
    class: cls,
    verdicts: 0,
    responses: 0,
    offered: 0,
    stale: 0,
    pairs: 0,
    satisfied: 0,
    violated: 0,
    blind: 0,
    contradictory: 0,
    addressable: 0,
});

/** The class a PAIR belongs to: the class of the candidate the judge named,
 *  not of the one it is compared against. A pair says "this move beats that
 *  one", and the class of the move being defended is what the pair teaches. */
export function pairDecisionClass(
    pair: EvalPair
): DecisionClass | "unclassified" {
    return decisionClassOfKey(pair.right.key) ?? "unclassified";
}

/**
 * The census: every class's verdicts, pairs and reachable remainder.
 *
 * Takes the report the fit already produces, so the pair-level facts (blind,
 * contradictory) are the SAME ones the fit reasons about rather than a second
 * derivation of them.
 */
export function censusByClass(
    report: VerdictReport,
    verdicts: readonly Verdict[]
): CoverageCensus {
    const rows = new Map<CoverageRow["class"], CoverageRow>();
    const row = (cls: CoverageRow["class"]): CoverageRow => {
        const existing = rows.get(cls);
        if (existing !== undefined) return existing;
        const created = EMPTY(cls);
        rows.set(cls, created);
        return created;
    };

    const staleIds = new Set(report.errors.map((e) => e.verdictId));

    for (const verdict of verdicts) {
        const cls = verdictDecisionClass(verdict) ?? "unclassified";
        const target = row(cls);
        target.verdicts += 1;
        if (isResponseVerdict(verdict)) target.responses += 1;
        if (staleIds.has(verdict.id)) target.stale += 1;
        for (const offered of offeredDecisionClasses(verdict)) {
            row(offered).offered += 1;
        }
    }

    const satisfied = new Set(report.satisfied);
    const blind = new Set(report.blind);
    const contradictory = new Set<EvalPair>();
    for (const couple of report.contradictions) {
        contradictory.add(couple.a);
        contradictory.add(couple.b);
    }

    for (const pair of report.pairs) {
        const target = row(pairDecisionClass(pair));
        target.pairs += 1;
        if (satisfied.has(pair)) {
            target.satisfied += 1;
            continue;
        }
        target.violated += 1;
        // A pair can be BOTH blind and half of a contradictory couple. It is
        // counted in both columns and subtracted once: `addressable` is what
        // is left after every unreachable pair, however it is unreachable, and
        // double-subtracting would make it negative and meaningless.
        const isBlind = blind.has(pair);
        const isContradictory = contradictory.has(pair);
        if (isBlind) target.blind += 1;
        if (isContradictory) target.contradictory += 1;
        if (!isBlind && !isContradictory) target.addressable += 1;
    }

    const ordered: CoverageRow[] = [];
    for (const cls of DECISION_CLASSES) {
        const found = rows.get(cls);
        if (found !== undefined) ordered.push(found);
    }
    for (const cls of ["mixed", "unclassified"] as const) {
        const found = rows.get(cls);
        if (found !== undefined) ordered.push(found);
    }

    const totals = ordered.reduce<Omit<CoverageRow, "class">>(
        (acc, r) => ({
            // `offered` is NOT summed: one verdict offering three classes adds
            // to three rows, so a total would count it three times. The total
            // that means something is the verdict count, which is summed.
            verdicts: acc.verdicts + r.verdicts,
            responses: acc.responses + r.responses,
            offered: acc.offered,
            stale: acc.stale + r.stale,
            pairs: acc.pairs + r.pairs,
            satisfied: acc.satisfied + r.satisfied,
            violated: acc.violated + r.violated,
            blind: acc.blind + r.blind,
            contradictory: acc.contradictory + r.contradictory,
            addressable: acc.addressable + r.addressable,
        }),
        {
            verdicts: 0,
            responses: 0,
            offered: 0,
            stale: 0,
            pairs: 0,
            satisfied: 0,
            violated: 0,
            blind: 0,
            contradictory: 0,
            addressable: 0,
        }
    );

    return { rows: ordered, totals };
}

/** Pairs below which a class states nothing (issue #3588's pre-registered
 *  rule). Not a statistical threshold — a floor under which the class is a
 *  collection target and no conclusion may be drawn from it. */
export const CLASS_EVIDENCE_FLOOR = 50;

/** The classes that cannot speak: present but under the floor, or absent
 *  altogether. The census's actionable half. */
export function classesBelowFloor(
    census: CoverageCensus,
    floor: number = CLASS_EVIDENCE_FLOOR
): { class: DecisionClass; pairs: number }[] {
    const byClass = new Map(census.rows.map((r) => [r.class, r]));
    return DECISION_CLASSES.filter((cls) => cls !== "pass").flatMap((cls) => {
        const pairs = byClass.get(cls)?.pairs ?? 0;
        return pairs < floor ? [{ class: cls, pairs }] : [];
    });
}

function pad(value: string, width: number): string {
    return value.length >= width
        ? value
        : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
    return value.length >= width
        ? value
        : " ".repeat(width - value.length) + value;
}

/** The census as a fixed-width table, for a console receipt and for pasting
 *  into a research document unchanged. */
export function formatCensus(
    census: CoverageCensus,
    floor: number = CLASS_EVIDENCE_FLOOR
): string {
    const header = [
        pad("class", 18),
        padStart("verdicts", 9),
        padStart("resp", 5),
        padStart("stale", 6),
        padStart("pairs", 6),
        padStart("sat", 5),
        padStart("blind", 6),
        padStart("contra", 7),
        padStart("addressable", 12),
    ].join(" ");

    const lines = census.rows.map((r) =>
        [
            pad(r.class, 18),
            padStart(`${r.verdicts}`, 9),
            padStart(`${r.responses}`, 5),
            padStart(`${r.stale}`, 6),
            padStart(`${r.pairs}`, 6),
            padStart(`${r.satisfied}`, 5),
            padStart(`${r.blind}`, 6),
            padStart(`${r.contradictory}`, 7),
            padStart(`${r.addressable}`, 12),
        ].join(" ")
    );

    const t = census.totals;
    const total = [
        pad("TOTAL", 18),
        padStart(`${t.verdicts}`, 9),
        padStart(`${t.responses}`, 5),
        padStart(`${t.stale}`, 6),
        padStart(`${t.pairs}`, 6),
        padStart(`${t.satisfied}`, 5),
        padStart(`${t.blind}`, 6),
        padStart(`${t.contradictory}`, 7),
        padStart(`${t.addressable}`, 12),
    ].join(" ");

    const below = classesBelowFloor(census, floor);
    const shopping =
        below.length === 0
            ? ["every class clears the evidence floor"]
            : [
                  `classes under the ${floor}-pair evidence floor — collection targets, NOT results:`,
                  ...below.map(
                      (b) =>
                          `  ${pad(b.class, 18)} ${padStart(`${b.pairs}`, 6)} pair(s)`
                  ),
              ];

    return [header, ...lines, total, "", ...shopping].join("\n");
}
