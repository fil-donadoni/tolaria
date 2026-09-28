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
    findingClassValidator,
    measuredFindingValidator,
    measurementValidator,
    planClassWrites,
    planFindingWrites,
    seedPayloadValidator,
} from "./botFindingsCore";

/** A finding as the page reads it: measured fields, human fields, id. */
const findingRowValidator = v.object({
    _id: v.id("botFindings"),
    ...measuredFindingValidator.fields,
    source: v.string(),
    measuredAt: v.string(),
    note: v.optional(v.string()),
    reproducers: v.optional(v.array(v.string())),
    linkedIssue: v.optional(v.number()),
    snoozedAt: v.optional(v.number()),
    snoozeReason: v.optional(v.string()),
});

/** Every ACTIVE finding, by card name. A deactivated row is a record, not a
 *  finding — the page does not show it. */
export const listFindings = query({
    args: {},
    returns: v.array(findingRowValidator),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const rows = await ctx.db.query("botFindings").collect();
        return rows
            .filter((row) => row.active)
            .map((row) => ({
                _id: row._id,
                oracleId: row.oracleId,
                source: row.source,
                name: row.name,
                targets: row.targets,
                outcome: row.outcome,
                measuredAt: row.measuredAt,
                ...(row.printId === undefined ? {} : { printId: row.printId }),
                ...(row.cause === undefined ? {} : { cause: row.cause }),
                ...(row.form === undefined ? {} : { form: row.form }),
                ...(row.gap === undefined ? {} : { gap: row.gap }),
                ...(row.blame === undefined ? {} : { blame: row.blame }),
                ...(row.compileSource === undefined
                    ? {}
                    : { compileSource: row.compileSource }),
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
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    },
});

/** Every ACTIVE Bot Gap class, by key. */
export const listClasses = query({
    args: {},
    returns: v.array(findingClassValidator),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const rows = await ctx.db.query("botFindingClasses").collect();
        return rows
            .filter((row) => row.active)
            .map((row) => ({
                key: row.key,
                cause: row.cause,
                blame: row.blame,
                causeText: row.causeText,
                cardCount: row.cardCount,
                targetCounts: row.targetCounts,
                ...(row.issue === undefined ? {} : { issue: row.issue }),
            }))
            .sort((a, b) => a.key.localeCompare(b.key));
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
        for (const write of planFindingWrites(
            stored.map((row) => ({ id: row._id, oracleId: row.oracleId })),
            payload
        )) {
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

        const classes = await ctx.db.query("botFindingClasses").collect();
        for (const write of planClassWrites(
            classes.map((row) => ({ id: row._id, key: row.key })),
            payload.classes
        )) {
            if (write.kind === "insert")
                await ctx.db.insert("botFindingClasses", write.fields);
            else
                await ctx.db.patch(
                    write.id as Id<"botFindingClasses">,
                    write.fields
                );
        }

        // ONE row, rewritten in place: every field is measured and required.
        const [current] = await ctx.db
            .query("botFindingMeasurements")
            .collect();
        if (current === undefined)
            await ctx.db.insert("botFindingMeasurements", payload.measurement);
        else await ctx.db.patch(current._id, payload.measurement);

        return {
            inserted,
            patched,
            deactivated,
            classes: payload.classes.length,
        };
    },
});
