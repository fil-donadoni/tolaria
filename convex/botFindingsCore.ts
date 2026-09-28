// Bot Findings — the pure half of the admin page's data (ADR 0141, PRD #4174,
// issue #4176): the seed payload's shape and the plan that turns one seed into
// row writes. `convex/botFindings.ts` owns every byte of I/O; this module owns
// the one rule every later slice imitates — WHO OWNS WHICH FIELD.
//
// ── Field ownership (ADR 0141 § 4) ───────────────────────────────────────
//
// MEASURED fields belong to the committed artifact
// (`data/bot-reach-findings.json`) and are rewritten by every seed. HUMAN
// fields (note, reproducers, linked issue, snooze) are never touched by a
// seed: every write's type is {@link MeasuredFindingFields} (or a part of
// it), pinned to {@link MEASURED_FINDING_FIELDS}, so a human field in a seed
// write reds `tsc` instead of riding along by accident. No mutation writes a measured field except the seed.
import { v, type Infer } from "convex/values";

/** A finding produced by the Bot-play sweep. Human-reported findings (issue
 *  #4182) take another source, so the two never overwrite each other on one
 *  card (ADR 0141 § 1: the key is `(oracleId, source)`). */
export const SWEEP_SOURCE = "sweep";

/** Which definition the measured card shipped with — `ShippedSource` in
 *  `scripts/lib/oracle-bot-reach.ts`, restated: that module drags the engine. */
export const compileSourceValidator = v.union(
    v.literal("hand-written"),
    v.literal("compiled")
);

/** The measured outcomes a finding row can carry. `unplayable` (no
 *  definition) is never a finding: nothing was played, so nothing is owed. */
export const findingOutcomeValidator = v.union(
    v.literal("played"),
    v.literal("ignored"),
    v.literal("frozen")
);

export const findingBlameValidator = v.union(
    v.literal("bot"),
    v.literal("harness")
);

/** One card the sweep saw the Bot NOT play — the measured half of a row. */
export const measuredFindingValidator = v.object({
    oracleId: v.string(),
    name: v.string(),
    /** The card's first print (`data/card-index.json`), for its image. */
    printId: v.optional(v.string()),
    targets: v.array(v.string()),
    outcome: findingOutcomeValidator,
    cause: v.optional(v.string()),
    form: v.optional(v.string()),
    /** The Bot Gap key — the class this card is blocked by. */
    gap: v.optional(v.string()),
    blame: v.optional(findingBlameValidator),
    compileSource: v.optional(compileSourceValidator),
});
export type MeasuredFinding = Infer<typeof measuredFindingValidator>;

/** One Bot Gap class — keyed by its Bot Gap key; every field is measured. */
export const findingClassValidator = v.object({
    key: v.string(),
    cause: v.string(),
    blame: findingBlameValidator,
    /** The filer's own triage prose (`botCauseText`, `gap-kinds.ts`). */
    causeText: v.string(),
    /** Measured cards carrying the key. */
    cardCount: v.number(),
    targetCounts: v.array(v.object({ target: v.string(), count: v.number() })),
    /** The issue `gaps:sync` filed for the key (`data/grammar-gaps.json`). */
    issue: v.optional(v.number()),
});
export type FindingClass = Infer<typeof findingClassValidator>;

/** The measurement's header, and the honesty numbers the page states. */
export const measurementValidator = v.object({
    sha: v.string(),
    botHash: v.string(),
    measuredAt: v.string(),
    /** The Target Lists measured, sorted. */
    targets: v.array(v.string()),
    /** Cards of those Targets — every artifact row. */
    targetCardCount: v.number(),
    /** Of them, the ones that ship a definition and were played. */
    measuredCount: v.number(),
    /** Hand-written catalogue cards outside every measured Target — never
     *  played by the Bot at all, and therefore absent from the page. */
    unmeasuredHandWrittenCount: v.number(),
});
export type Measurement = Infer<typeof measurementValidator>;

/** What one seed carries: the non-`played` rows in full, the `played` ones by
 *  id only (all a played card changes on a row that exists is its outcome). */
export const seedPayloadValidator = v.object({
    measurement: measurementValidator,
    findings: v.array(measuredFindingValidator),
    played: v.array(v.string()),
    classes: v.array(findingClassValidator),
});
export type SeedPayload = Infer<typeof seedPayloadValidator>;

/** The fields a seed owns on a finding row. Everything else on the row is
 *  human-owned and a seed never names it. */
export const MEASURED_FINDING_FIELDS = [
    "name",
    "printId",
    "targets",
    "outcome",
    "cause",
    "form",
    "gap",
    "blame",
    "compileSource",
    "sha",
    "botHash",
    "measuredAt",
    "active",
] as const;
export type MeasuredFindingField = (typeof MEASURED_FINDING_FIELDS)[number];

/** A stored sweep finding, as far as the plan needs to see it. */
export interface ExistingFinding {
    readonly id: string;
    readonly oracleId: string;
    readonly active: boolean;
    readonly gap?: string;
}

export interface ExistingClass {
    readonly id: string;
    readonly key: string;
}

/** Every measured field of a finding row, as a seed writes it. */
export type MeasuredFindingFields = Omit<MeasuredFinding, "oracleId"> & {
    sha: string;
    botHash: string;
    measuredAt: string;
    active: boolean;
};

// Pins MEASURED_FINDING_FIELDS to the type: a field added to one and not the
// other reds `tsc` here.
type AssertSame<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : never
    : never;
const _measuredFieldsPinned: AssertSame<
    MeasuredFindingField,
    keyof MeasuredFindingFields
> = true;
void _measuredFieldsPinned;

export type FindingWrite =
    | {
          readonly kind: "insert";
          readonly oracleId: string;
          readonly fields: MeasuredFindingFields;
      }
    | {
          readonly kind: "patch";
          readonly id: string;
          readonly fields: Partial<MeasuredFindingFields>;
      };

export type ClassWrite =
    | {
          readonly kind: "insert";
          readonly fields: FindingClass & { active: true };
      }
    | {
          readonly kind: "patch";
          readonly id: string;
          readonly fields: Partial<FindingClass> & { active: boolean };
      };

/** The provenance every measured row is stamped with. */
function stamps(m: Measurement) {
    return { sha: m.sha, botHash: m.botHash, measuredAt: m.measuredAt };
}

/**
 * The patch a seed writes onto a finding row: exactly the measured fields,
 * every one of them named — an optional one the new measurement lacks is
 * written `undefined`, which Convex's `patch` reads as "remove", so a cause
 * the card no longer has cannot survive from the previous measurement.
 */
export function measuredFindingPatch(
    finding: MeasuredFinding,
    m: Measurement
): MeasuredFindingFields {
    return {
        name: finding.name,
        printId: finding.printId,
        targets: finding.targets,
        outcome: finding.outcome,
        cause: finding.cause,
        form: finding.form,
        gap: finding.gap,
        blame: finding.blame,
        compileSource: finding.compileSource,
        ...stamps(m),
        active: true,
    };
}

/**
 * One seed's writes to `botFindings` (sweep source only):
 *
 * - a measured non-`played` card → its row's measured fields rewritten, or a
 *   new row;
 * - a stored card the sweep now sees PLAYED → outcome and stamps only (and
 *   active again, if it had left the Targets and came back played). Its
 *   class stays: "played" alone proves nothing, and the class it was blocked
 *   by is what a later slice checks for a green `must` blade entry before the
 *   row may read `resolved` (ADR 0141 § 3);
 * - a stored card absent from the artifact altogether → DEACTIVATED, never
 *   deleted: its human fields are a record, and a card re-entering a Target
 *   gets them back.
 *
 * A `played` card with no stored row writes nothing — it was never a finding.
 */
export function planFindingWrites(
    existing: readonly ExistingFinding[],
    payload: SeedPayload
): FindingWrite[] {
    const m = payload.measurement;
    const stored = new Map(existing.map((row) => [row.oracleId, row.id]));
    const writes: FindingWrite[] = [];
    const seen = new Set<string>();
    for (const finding of payload.findings) {
        seen.add(finding.oracleId);
        const id = stored.get(finding.oracleId);
        const fields = measuredFindingPatch(finding, m);
        writes.push(
            id === undefined
                ? { kind: "insert", oracleId: finding.oracleId, fields }
                : { kind: "patch", id, fields }
        );
    }
    const played = new Set(payload.played);
    for (const row of existing) {
        if (seen.has(row.oracleId)) continue;
        if (played.has(row.oracleId))
            writes.push({
                kind: "patch",
                id: row.id,
                fields: { outcome: "played", ...stamps(m), active: true },
            });
        // Already inactive: nothing to write, and nothing to count as a drop
        // of THIS seed.
        else if (row.active)
            writes.push({
                kind: "patch",
                id: row.id,
                fields: { active: false },
            });
    }
    return writes;
}

/**
 * The class keys a stored finding the sweep now PLAYS still points at. The
 * payload's classes are built from non-`played` rows only, so without this a
 * class whose last card now plays would be deactivated while the row keeps
 * naming it — and the row is exactly the one whose `played-unproven` /
 * `resolved` state needs its class (ADR 0141 § 3).
 */
export function classKeysKeptByPlayed(
    existing: readonly ExistingFinding[],
    payload: SeedPayload
): Set<string> {
    const measured = new Set(payload.findings.map((f) => f.oracleId));
    const played = new Set(payload.played);
    const kept = new Set<string>();
    for (const row of existing)
        if (
            row.gap !== undefined &&
            !measured.has(row.oracleId) &&
            played.has(row.oracleId)
        )
            kept.add(row.gap);
    return kept;
}

/** One seed's writes to `botFindingClasses`: every class the artifact carries
 *  upserted whole (all its fields are measured); a stored class it no longer
 *  carries deactivated — unless a played finding still names it
 *  ({@link classKeysKeptByPlayed}), which leaves its last measurement standing. */
export function planClassWrites(
    existing: readonly ExistingClass[],
    classes: readonly FindingClass[],
    keptByPlayed: ReadonlySet<string> = new Set()
): ClassWrite[] {
    const stored = new Map(existing.map((row) => [row.key, row.id]));
    const writes: ClassWrite[] = [];
    const seen = new Set<string>();
    for (const cls of classes) {
        seen.add(cls.key);
        const id = stored.get(cls.key);
        writes.push(
            id === undefined
                ? { kind: "insert", fields: { ...cls, active: true } }
                : {
                      kind: "patch",
                      id,
                      // `issue` named even when absent, so a released claim
                      // does not keep linking its old issue.
                      fields: { ...cls, issue: cls.issue, active: true },
                  }
        );
    }
    for (const row of existing) {
        if (!seen.has(row.key) && !keptByPlayed.has(row.key))
            writes.push({
                kind: "patch",
                id: row.id,
                fields: { active: false },
            });
    }
    return writes;
}
