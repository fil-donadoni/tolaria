// Bot Findings — the admin page's tables, read and seeded (ADR 0141, PRD
// #4174, issue #4176). Pure rules (payload shape, field ownership, the write
// plan) live in `botFindingsCore.ts`; this file is the I/O around them.
//
// Every read is `assertIsAdmin`-gated: the page sits behind `AdminRouteGate`,
// and hiding a route is cosmetic — the query is the boundary. The one writer
// is `seed`, an INTERNAL mutation `bun run seed:bot-findings` reaches through
// `convex run`; no public mutation can write a measured field. The public
// mutations (issue #4182) write HUMAN fields only — a report, a note, a linked
// issue, Reproducer labels, a snooze — and are `assertIsAdmin`-gated too.
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
    internalMutation,
    mutation,
    query,
    type QueryCtx,
} from "./_generated/server";
import { assertIsAdmin } from "./auth";
import {
    HUMAN_SOURCE,
    HUMAN_STAMP,
    SWEEP_SOURCE,
    checkedNote,
    classKeysKeptByPlayed,
    measuredFindingValidator,
    measurementValidator,
    normalizeReproducers,
    planClassWrites,
    planFindingWrites,
    requireSnoozeReason,
    seedPayloadValidator,
    storedClassValidator,
    unknownReproducers,
} from "./botFindingsCore";
import {
    computeFindingStatus,
    findingStatusValidator,
    mustBladeEntryFor,
    rankFindingClasses,
    type BladeCardIndex,
} from "./gre/ai/botFindingState";
import bladeCardIndexJson from "../data/blade-card-index.json";
import targetsConfig from "../data/targets.json";

const BLADE_CARD_INDEX = bladeCardIndexJson as BladeCardIndex;

/** Target ids in PRIORITY order (`data/targets.json`) — a class's own
 *  `targetCounts` is written sorted by target ID (`buildBotFindingsPayload`),
 *  never by priority, so the Classes tab's ranking reads the order here
 *  rather than the artifact's. */
const PRIORITY_TARGETS: readonly string[] = targetsConfig.targets
    .filter(
        (
            t
        ): t is (typeof targetsConfig.targets)[number] & { priority: number } =>
            t.priority !== undefined
    )
    .sort((a, b) => a.priority - b.priority)
    .map((t) => t.id);

/** Card names carrying an ACTIVE finding under each Bot Gap key — the join
 *  {@link mustBladeEntryFor} needs, built once per read so a class's proof and
 *  every one of its cards' statuses agree on the same set (ADR 0141 § 3). A
 *  played row keeps its `gap` (`classKeysKeptByPlayed`), so it is exactly the
 *  set of names a `resolved` verdict needs its class's proof checked against. */
function namesByGap(
    rows: readonly { readonly gap?: string; readonly name: string }[]
): Map<string, string[]> {
    const byGap = new Map<string, string[]>();
    for (const row of rows) {
        if (row.gap === undefined) continue;
        const names = byGap.get(row.gap) ?? [];
        names.push(row.name);
        byGap.set(row.gap, names);
    }
    return byGap;
}

/** A finding as the page reads it: measured fields, human fields, id, and the
 *  DERIVED status (ADR 0141 § 3) — computed on every read, never stored. */
const findingRowValidator = v.object({
    _id: v.id("botFindings"),
    ...measuredFindingValidator.fields,
    source: v.string(),
    /** The Bot hash the verdict was produced under — compared against the
     *  measurement's `currentBotHash` for the stale flag (issue #4181). */
    botHash: v.string(),
    measuredAt: v.string(),
    note: v.optional(v.string()),
    reproducers: v.optional(v.array(v.string())),
    linkedIssue: v.optional(v.number()),
    snoozedAt: v.optional(v.number()),
    snoozeReason: v.optional(v.string()),
    status: findingStatusValidator,
});

/** Every ACTIVE finding, by card name. A deactivated row is a record, not a
 *  finding — the page does not show it. */
export const listFindings = query({
    args: {},
    returns: v.array(findingRowValidator),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const rows = await ctx.db.query("botFindings").collect();
        const active = rows.filter((row) => row.active);
        const byGap = namesByGap(active);
        return active
            .map((row) => {
                const provingEntry =
                    row.gap === undefined
                        ? undefined
                        : mustBladeEntryFor(
                              byGap.get(row.gap) ?? [],
                              BLADE_CARD_INDEX
                          );
                return {
                    _id: row._id,
                    oracleId: row.oracleId,
                    source: row.source,
                    name: row.name,
                    targets: row.targets,
                    outcome: row.outcome,
                    botHash: row.botHash,
                    measuredAt: row.measuredAt,
                    ...(row.printId === undefined
                        ? {}
                        : { printId: row.printId }),
                    ...(row.cause === undefined ? {} : { cause: row.cause }),
                    ...(row.form === undefined ? {} : { form: row.form }),
                    ...(row.gap === undefined ? {} : { gap: row.gap }),
                    ...(row.blame === undefined ? {} : { blame: row.blame }),
                    ...(row.compileSource === undefined
                        ? {}
                        : { compileSource: row.compileSource }),
                    ...(row.trace === undefined ? {} : { trace: row.trace }),
                    ...(row.note === undefined ? {} : { note: row.note }),
                    ...(row.reproducers === undefined
                        ? {}
                        : { reproducers: row.reproducers }),
                    ...(row.linkedIssue === undefined
                        ? {}
                        : { linkedIssue: row.linkedIssue }),
                    ...(row.snoozedAt === undefined
                        ? {}
                        : { snoozedAt: row.snoozedAt }),
                    ...(row.snoozeReason === undefined
                        ? {}
                        : { snoozeReason: row.snoozeReason }),
                    status: computeFindingStatus({
                        outcome: row.outcome,
                        cause: row.cause,
                        classHasMustBladeEntry: provingEntry !== undefined,
                    }),
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    },
});

/** A class row plus its DERIVED proof — the `must` blade entry naming any
 *  card currently carrying the key (ADR 0141 § 3), never stored. */
const findingClassRowValidator = v.object({
    ...storedClassValidator.fields,
    provingEntry: v.optional(v.string()),
});

/** Every ACTIVE Bot Gap class, ranked by per-Target leverage in Target
 *  priority order — the same ranking the Grammar Gaps use (issue #3869). */
export const listClasses = query({
    args: {},
    returns: v.array(findingClassRowValidator),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const [classRows, findingRows] = await Promise.all([
            ctx.db.query("botFindingClasses").collect(),
            ctx.db.query("botFindings").collect(),
        ]);
        const byGap = namesByGap(findingRows.filter((row) => row.active));
        const active = classRows
            .filter((row) => row.active)
            .map((row) => ({
                key: row.key,
                cause: row.cause,
                blame: row.blame,
                causeText: row.causeText,
                cardCount: row.cardCount,
                targetCounts: row.targetCounts,
                ...(row.previousCardCount === undefined
                    ? {}
                    : { previousCardCount: row.previousCardCount }),
                ...(row.issue === undefined ? {} : { issue: row.issue }),
                provingEntry: mustBladeEntryFor(
                    byGap.get(row.key) ?? [],
                    BLADE_CARD_INDEX
                ),
            }));
        return rankFindingClasses(active, PRIORITY_TARGETS);
    },
});

/** The measurement the rows came from, or `null` before the first seed. */
export const latestMeasurement = query({
    args: {},
    returns: v.union(measurementValidator, v.null()),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const [row] = await ctx.db.query("botFindingMeasurements").collect();
        if (row === undefined) return null;
        return {
            sha: row.sha,
            botHash: row.botHash,
            ...(row.currentBotHash === undefined
                ? {}
                : { currentBotHash: row.currentBotHash }),
            measuredAt: row.measuredAt,
            targets: row.targets,
            targetCardCount: row.targetCardCount,
            measuredCount: row.measuredCount,
            unmeasuredHandWrittenCount: row.unmeasuredHandWrittenCount,
        };
    },
});

/**
 * The ONE writer of a measured field (ADR 0141 § 4). Plans with the pure
 * `planFindingWrites` / `planClassWrites`, whose patches name measured fields
 * only — a human field on a stored row is never in a write.
 */
export const seed = internalMutation({
    args: { payload: seedPayloadValidator },
    returns: v.object({
        inserted: v.number(),
        patched: v.number(),
        deactivated: v.number(),
        classes: v.number(),
    }),
    handler: async (ctx, { payload }) => {
        const stored = await ctx.db
            .query("botFindings")
            .withIndex("by_source_oracle", (q) => q.eq("source", SWEEP_SOURCE))
            .collect();
        let inserted = 0;
        let patched = 0;
        let deactivated = 0;
        const existing = stored.map((row) => ({
            id: row._id,
            oracleId: row.oracleId,
            active: row.active,
            ...(row.gap === undefined ? {} : { gap: row.gap }),
        }));
        for (const write of planFindingWrites(existing, payload)) {
            if (write.kind === "insert") {
                await ctx.db.insert("botFindings", {
                    ...write.fields,
                    oracleId: write.oracleId,
                    source: SWEEP_SOURCE,
                });
                inserted++;
            } else {
                await ctx.db.patch(write.id as Id<"botFindings">, write.fields);
                if (write.fields.active === false) deactivated++;
                else patched++;
            }
        }

        // Read BEFORE it is rewritten below: the class delta is "cards now vs
        // cards at the measurement this seed replaces" (issue #4181).
        const [current] = await ctx.db
            .query("botFindingMeasurements")
            .collect();
        const classes = await ctx.db.query("botFindingClasses").collect();
        for (const write of planClassWrites(
            classes.map((row) => ({
                id: row._id,
                key: row.key,
                active: row.active,
                cardCount: row.cardCount,
                targetCounts: row.targetCounts,
                ...(row.previousCardCount === undefined
                    ? {}
                    : { previousCardCount: row.previousCardCount }),
            })),
            payload.classes,
            classKeysKeptByPlayed(existing, payload),
            {
                previous:
                    current === undefined
                        ? null
                        : {
                              sha: current.sha,
                              botHash: current.botHash,
                              measuredAt: current.measuredAt,
                              targets: current.targets,
                              targetCardCount: current.targetCardCount,
                              measuredCount: current.measuredCount,
                              unmeasuredHandWrittenCount:
                                  current.unmeasuredHandWrittenCount,
                          },
                next: payload.measurement,
            }
        )) {
            if (write.kind === "insert")
                await ctx.db.insert("botFindingClasses", write.fields);
            else
                await ctx.db.patch(
                    write.id as Id<"botFindingClasses">,
                    write.fields
                );
        }

        // ONE row, rewritten in place: every field is measured.
        if (current === undefined)
            await ctx.db.insert("botFindingMeasurements", payload.measurement);
        else
            await ctx.db.patch(current._id, {
                ...payload.measurement,
                // Named even when absent: a seed that carries no current hash
                // must not keep the previous one, which would flag rows stale
                // against a Bot nobody measured.
                currentBotHash: payload.measurement.currentBotHash,
            });

        return {
            inserted,
            patched,
            deactivated,
            classes: payload.classes.length,
        };
    },
});

// ── Human findings (issue #4182, ADR 0141 § 7 and § 10) ───────────────────

/** Every label a Reproducer may name: a blade entry (the committed registry's
 *  index) or a saved scenario (`debugScenarios`, deployment-local). */
async function knownReproducerLabels(ctx: QueryCtx): Promise<Set<string>> {
    const labels = new Set<string>();
    for (const entries of Object.values(BLADE_CARD_INDEX))
        for (const entry of entries) labels.add(entry.label);
    for (const scenario of await ctx.db.query("debugScenarios").collect())
        labels.add(scenario.label);
    return labels;
}

/** Normalise and validate Reproducer labels: each must resolve to a blade
 *  entry or a saved scenario, or the report is refused. */
async function checkedReproducers(
    ctx: QueryCtx,
    labels: readonly string[]
): Promise<string[]> {
    const normalised = normalizeReproducers(labels);
    if (normalised.length === 0) return normalised;
    const unknown = unknownReproducers(
        normalised,
        await knownReproducerLabels(ctx)
    );
    if (unknown.length > 0)
        throw new ConvexError(
            `Unknown reproducer label${unknown.length > 1 ? "s" : ""}: ${unknown.join("; ")}`
        );
    return normalised;
}

/**
 * Report a finding a human noticed. Keyed `(oracleId, "human")`, so the
 * measured row on the same card is untouched; one report per card. With a
 * Reproducer it is an ordinary row; without one it waits in triage.
 */
export const reportFinding = mutation({
    args: {
        oracleId: v.string(),
        name: v.string(),
        printId: v.optional(v.string()),
        note: v.optional(v.string()),
        reproducers: v.optional(v.array(v.string())),
    },
    returns: v.id("botFindings"),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const oracleId = args.oracleId.trim();
        const name = args.name.trim();
        if (oracleId === "" || name === "")
            throw new ConvexError(
                "A report needs a card name and an oracle id"
            );
        const existing = await ctx.db
            .query("botFindings")
            .withIndex("by_source_oracle", (q) =>
                q.eq("source", HUMAN_SOURCE).eq("oracleId", oracleId)
            )
            .first();
        if (existing !== null)
            throw new ConvexError(`${name} already has a human report`);
        const reproducers = await checkedReproducers(
            ctx,
            args.reproducers ?? []
        );
        const note = checkedNote(args.note ?? "");
        const printId = args.printId?.trim();
        return await ctx.db.insert("botFindings", {
            oracleId,
            source: HUMAN_SOURCE,
            name,
            targets: [],
            outcome: "ignored",
            sha: HUMAN_STAMP,
            botHash: "",
            measuredAt: new Date().toISOString(),
            active: true,
            ...(printId ? { printId } : {}),
            ...(note ? { note } : {}),
            ...(reproducers.length > 0 ? { reproducers } : {}),
        });
    },
});

/** Replace a finding's note and linked issue — the only free-form fields; an
 *  empty note / a `null` issue clears them. There is no workflow state: the
 *  GitHub issue already carries it (ADR 0141 § 10). */
export const annotateFinding = mutation({
    args: {
        id: v.id("botFindings"),
        note: v.string(),
        linkedIssue: v.union(v.number(), v.null()),
    },
    returns: v.null(),
    handler: async (ctx, { id, note, linkedIssue }) => {
        await assertIsAdmin(ctx);
        if (
            linkedIssue !== null &&
            (!Number.isInteger(linkedIssue) || linkedIssue <= 0)
        )
            throw new ConvexError("A linked issue is a positive issue number");
        if ((await ctx.db.get(id)) === null)
            throw new ConvexError("No such finding");
        const trimmed = checkedNote(note);
        await ctx.db.patch(id, {
            note: trimmed === "" ? undefined : trimmed,
            linkedIssue: linkedIssue ?? undefined,
        });
        return null;
    },
});

/** Replace a finding's Reproducer labels — how a triage row is admitted. */
export const setFindingReproducers = mutation({
    args: { id: v.id("botFindings"), reproducers: v.array(v.string()) },
    returns: v.null(),
    handler: async (ctx, { id, reproducers }) => {
        await assertIsAdmin(ctx);
        if ((await ctx.db.get(id)) === null)
            throw new ConvexError("No such finding");
        const checked = await checkedReproducers(ctx, reproducers);
        await ctx.db.patch(id, {
            reproducers: checked.length > 0 ? checked : undefined,
        });
        return null;
    },
});

/** Snooze a finding: out of every count, still on the record and reachable by
 *  filter. The reason is mandatory (ADR 0141 § 10). */
export const snoozeFinding = mutation({
    args: { id: v.id("botFindings"), reason: v.string() },
    returns: v.null(),
    handler: async (ctx, { id, reason }) => {
        await assertIsAdmin(ctx);
        const snoozeReason = requireSnoozeReason(reason);
        if ((await ctx.db.get(id)) === null)
            throw new ConvexError("No such finding");
        await ctx.db.patch(id, { snoozedAt: Date.now(), snoozeReason });
        return null;
    },
});

/** Bring a snoozed finding back into the counts. */
export const unsnoozeFinding = mutation({
    args: { id: v.id("botFindings") },
    returns: v.null(),
    handler: async (ctx, { id }) => {
        await assertIsAdmin(ctx);
        if ((await ctx.db.get(id)) === null)
            throw new ConvexError("No such finding");
        await ctx.db.patch(id, {
            snoozedAt: undefined,
            snoozeReason: undefined,
        });
        return null;
    },
});
