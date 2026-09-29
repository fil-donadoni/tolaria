// Bot Findings — the admin page's tables, read and seeded (ADR 0141, PRD
// #4174, issue #4176). Pure rules (payload shape, field ownership, the write
// plan) live in `botFindingsCore.ts`; this file is the I/O around them.
//
// Every read is `assertIsAdmin`-gated: the page sits behind `AdminRouteGate`,
// and hiding a route is cosmetic — the query is the boundary. The one writer
// is `seed`, an INTERNAL mutation `bun run seed:bot-findings` reaches through
// `convex run`; no public mutation can write a measured field.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { assertIsAdmin } from "./auth";
import {
    SWEEP_SOURCE,
    classKeysKeptByPlayed,
    measuredFindingValidator,
    measurementValidator,
    planClassWrites,
    planFindingWrites,
    seedPayloadValidator,
    storedClassValidator,
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
