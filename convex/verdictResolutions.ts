// The resolution outbox's table functions (issue #3582, PRD #3574, ADR 0128 §6)
// and the review surface's reads of the verdict outbox.
//
// Everything here is INTERNAL. The doors are the actions in
// `verdictReviewActions.ts`, because a resolution must be checked against the
// Verdict Store's contents — does it decide over exactly the verdicts the
// position holds? — and only an action can read the store. Identity still
// comes from `ctx.auth`: an action's `runQuery` / `runMutation` carries the
// caller's, so `assertIsAdmin` here gates the admin who clicked, and the
// resolver author is stamped from that account, never taken from an argument.
//
// The decisions — what a resolution is, what its name is, when a row counts as
// stored — live in `gre/ai/verdicts/resolution.ts` and
// `verdictResolutionsOutbox.ts`; this file binds them to the tables.

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertIsAdmin } from "./auth";
import type { VerdictJudgement } from "./gre/ai/verdicts/identity";
import {
    resolutionIdOf,
    resolutionProblems,
} from "./gre/ai/verdicts/resolution";
import {
    isLaneAccountEmail,
    isLocalDeploymentUrl,
} from "./lib/uiGateLaneAccount";
import { verdictAuthorOf } from "./verdictStore";
import { verdictDeploymentOf, verdictStampOf } from "./verdictsOutbox";

/** The drain, by name — it is a `"use node"` module (`verdicts.ts` does the
 *  same). One drain uploads verdicts and resolutions alike. */
const DRAIN_OUTBOX = makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
>("verdictsDrain:drain");

const rejectedValidator = v.array(
    v.object({ verdictId: v.string(), reason: v.string() })
);

/**
 * Every row the Verdict Store does not hold yet: fat verdict rows and pending
 * resolution rows. On a deployment with the write key these are the few a
 * drain has not reached; on a local backend they are everything.
 *
 * `v.any()` rows: the only caller reads them through `OutboxRow` /
 * `ResolutionOutboxRow`, and restating the table here would be the schema
 * written twice.
 */
export const reviewOutbox = internalQuery({
    args: {},
    returns: v.object({
        verdictRows: v.array(v.any()),
        resolutionRows: v.array(v.any()),
    }),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const verdictRows = await ctx.db
            .query("verdicts")
            .withIndex("by_storedAt", (q) => q.eq("storedAt", undefined))
            .collect();
        const resolutionRows = await ctx.db
            .query("verdictResolutions")
            .withIndex("by_storedAt", (q) => q.eq("storedAt", undefined))
            .collect();
        return { verdictRows, resolutionRows };
    },
});

/** Nicknames of this deployment's accounts, for authors named by user id.
 *  An id that is not a user here — another deployment's, or a deleted
 *  account — is simply absent. */
export const authorNicknames = internalQuery({
    args: { userIds: v.array(v.string()) },
    returns: v.array(v.object({ userId: v.string(), nickname: v.string() })),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const out: { userId: string; nickname: string }[] = [];
        for (const raw of args.userIds) {
            const id = ctx.db.normalizeId("users", raw);
            if (id === null) continue;
            const user = await ctx.db.get(id);
            if (user?.nickname)
                out.push({ userId: raw, nickname: user.nickname });
        }
        return out;
    },
});

/**
 * Record one resolution in the outbox and schedule its upload. Reached only
 * through `verdictReviewActions.resolve`, which has already checked the
 * decision against the position's current verdicts; this checks everything
 * that needs no store — that it is a decision at all, reasons included — and
 * stamps who made it.
 */
export const record = internalMutation({
    args: {
        positionKey: v.string(),
        acceptedVerdictId: v.union(v.string(), v.null()),
        rejected: rejectedValidator,
        note: v.optional(v.string()),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const user = await assertIsAdmin(ctx);
        const here = verdictDeploymentOf(process.env.CONVEX_CLOUD_URL);
        const resolverAuthor = verdictAuthorOf(here.name, user._id);
        const resolution = {
            positionKey: args.positionKey,
            acceptedVerdictId: args.acceptedVerdictId,
            rejected: args.rejected.map(({ verdictId, reason }) => ({
                verdictId,
                reason: reason.trim(),
            })),
            author: resolverAuthor,
        };
        const problems = resolutionProblems(resolution);
        if (problems.length > 0) {
            throw new Error(`not a resolution: ${problems.join("; ")}`);
        }
        const resolutionId = resolutionIdOf(resolution);
        const note = args.note?.trim();
        await ctx.db.insert("verdictResolutions", {
            positionKey: resolution.positionKey,
            resolutionId,
            acceptedVerdictId: resolution.acceptedVerdictId,
            rejected: resolution.rejected,
            authorId: user._id,
            author: user.nickname ?? "admin",
            resolverAuthor,
            createdAt: Date.now(),
            ...(note ? { note } : {}),
            deployment: here.name,
            deploymentKind: here.kind,
        });
        await ctx.scheduler.runAfter(0, DRAIN_OUTBOX, {});
        return resolutionId;
    },
});

/** Resolution rows per drain. Each is a few hundred bytes. */
const RESOLUTION_DRAIN_BATCH = 100;

/** Resolution rows not yet confirmed stored — the drain's read. */
export const pendingResolutions = internalQuery({
    args: {},
    returns: v.array(v.any()),
    handler: async (ctx) => {
        return await ctx.db
            .query("verdictResolutions")
            .withIndex("by_storedAt", (q) => q.eq("storedAt", undefined))
            .take(RESOLUTION_DRAIN_BATCH);
    },
});

/** Mark one resolution row stored, once the drain has read its object back.
 *  Refuses a row whose recorded id is not the one stored. */
export const markResolutionStored = internalMutation({
    args: {
        rowId: v.id("verdictResolutions"),
        resolutionId: v.string(),
        storedAt: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const row = await ctx.db.get(args.rowId);
        if (row === null) {
            throw new Error(`resolution row ${args.rowId} does not exist`);
        }
        if (row.resolutionId !== args.resolutionId) {
            throw new Error(
                `resolution row ${args.rowId} records ${row.resolutionId}, not the stored ${args.resolutionId}`
            );
        }
        if (row.storedAt === undefined) {
            await ctx.db.patch(row._id, { storedAt: args.storedAt });
        }
        return null;
    },
});

// ── The check:ui lane's contested position ───────────────────────────────────

/** One position, two answers: what the browser lane walks the review surface
 *  over. Real card names, so the board renders as a real one would. */
const UI_GATE_POSITION: Omit<VerdictJudgement, "answer"> = {
    spec: {
        cards: [
            { name: "Mountain", owner: "me" },
            { name: "Mountain", owner: "me" },
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "opp" },
        ],
        life: { me: 20, opp: 3 },
        turn: 5,
        phase: "PRECOMBAT_MAIN",
    },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "Pass priority" },
        {
            key: '{"kind":"cast-spell","card":"Lightning Bolt","target":"player"}',
            description: "Cast Lightning Bolt targeting the opponent",
        },
        {
            key: '{"kind":"cast-spell","card":"Lightning Bolt","target":"Grizzly Bears"}',
            description: "Cast Lightning Bolt targeting Grizzly Bears",
        },
    ],
};

const UI_GATE_ANSWERS: VerdictJudgement["answer"][] = [
    { kind: "right", rightIndexes: [1] },
    { kind: "right", rightIndexes: [2] },
];

/**
 * Seed the lane account's contested position (issue #3582): two fat verdict
 * rows, one position, two answers. Local deployments and lane accounts only;
 * idempotent per account. The rows are the account's own (`authorId`), so the
 * lane's teardown removes them with the account, and they stay `local`, so
 * nothing downstream mistakes them for a tester's judgement. No drain is
 * scheduled: a local backend holds no write key.
 */
export const seedUiGateContestedPosition = internalMutation({
    args: { email: v.string() },
    returns: v.object({ positionKey: v.string(), inserted: v.number() }),
    handler: async (ctx, args) => {
        if (!isLaneAccountEmail(args.email)) {
            throw new Error(
                `refusing to seed verdicts for "${args.email}": not a check:ui lane account`
            );
        }
        const url = process.env.CONVEX_CLOUD_URL;
        if (!isLocalDeploymentUrl(url)) {
            throw new Error(
                `refusing to seed verdicts on ${url ?? "an unidentified deployment"}: lane fixtures exist only on a local deployment`
            );
        }
        const user = await ctx.db
            .query("users")
            .withIndex("email", (q) => q.eq("email", args.email))
            .unique();
        if (user === null) {
            throw new Error(`no user "${args.email}" on this deployment`);
        }
        const here = verdictDeploymentOf(url);
        let positionKey = "";
        let inserted = 0;
        for (const answer of UI_GATE_ANSWERS) {
            const judgement = { ...UI_GATE_POSITION, answer };
            const stamp = verdictStampOf(judgement);
            positionKey = stamp.positionKey;
            const existing = await ctx.db
                .query("verdicts")
                .withIndex("by_storedAt", (q) => q.eq("storedAt", undefined))
                .filter((q) =>
                    q.and(
                        q.eq(q.field("authorId"), user._id),
                        q.eq(q.field("verdictHash"), stamp.verdictHash)
                    )
                )
                .first();
            if (existing !== null) continue;
            await ctx.db.insert("verdicts", {
                spec: judgement.spec,
                seat: judgement.seat,
                candidates: judgement.candidates,
                answer,
                authorId: user._id,
                author: user.nickname ?? "ui-gate",
                createdAt: Date.now(),
                note: "check:ui fixture",
                ...stamp,
                attestationAuthor: verdictAuthorOf(here.name, user._id),
                deployment: here.name,
                deploymentKind: here.kind,
            });
            inserted += 1;
        }
        return { positionKey, inserted };
    },
});
