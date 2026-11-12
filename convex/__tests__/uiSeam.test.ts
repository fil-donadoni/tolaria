// The `check:ui` seam's server boundary (issue #9271, ADR 0179).
//
// Two halves:
//   1. DYNAMIC — the real `uiSeam.echo` handler against the in-memory ctx: a
//      non-local deployment, a signed-out caller and a non-lane account
//      (admin included) are each refused, naming the failed condition, before
//      any database access beyond the gate's own `users` read.
//   2. STATIC — every export of `convex/uiSeam.ts` is a public query/mutation
//      whose handler's FIRST statement awaits `assertUiSeamCaller(ctx)`. A seam
//      function that skips the double gate reds here, not in production.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as uiSeam from "../uiSeam";
import { laneAccountEmail } from "../lib/uiGateLaneAccount";
import { UI_SEAM_REFUSED } from "../lib/uiSeamGate";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;

function handlerOf(fn: unknown): Handler {
    return (fn as { _handler: Handler })._handler;
}

const LOCAL_URL = "http://127.0.0.1:3210";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const RUN_ID = "a1b2c3d4e5f6";
const LANE = "userlane";
const ADMIN = "useradmin";

/** A ctx over the in-memory db whose `db` records every method called on it,
 *  so a test can assert exactly which reads the gate made. */
function recordingCtx(identitySubject?: string) {
    const db = makeInMemoryDb(
        {
            users: [
                {
                    _id: LANE,
                    email: laneAccountEmail(RUN_ID),
                    isAdmin: true,
                },
                { _id: ADMIN, email: "admin@example.com", isAdmin: true },
            ],
        },
        identitySubject === undefined ? {} : { identitySubject }
    );
    const calls: string[] = [];
    const realDb = (db.ctx as unknown as { db: Record<string, unknown> }).db;
    const proxied = new Proxy(realDb, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
                calls.push(`${String(prop)}(${String(args[0])})`);
                return (value as (...a: unknown[]) => unknown).apply(
                    target,
                    args
                );
            };
        },
    });
    const authCalls: number[] = [];
    const realAuth = (db.ctx as unknown as { auth: Record<string, unknown> })
        .auth;
    const ctx = {
        ...(db.ctx as unknown as Record<string, unknown>),
        db: proxied,
        auth: {
            getUserIdentity: async () => {
                authCalls.push(1);
                return await (
                    realAuth.getUserIdentity as () => Promise<unknown>
                )();
            },
        },
    };
    return { ctx, calls, authCalls };
}

const echo = handlerOf(uiSeam.echo);

describe("uiSeam double gate (issue #9271, ADR 0179)", () => {
    beforeEach(() => {
        vi.stubEnv("CONVEX_CLOUD_URL", LOCAL_URL);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("answers a lane account on a local deployment", async () => {
        const { ctx } = recordingCtx(`${LANE}|s1`);
        await expect(echo(ctx, { value: "ping" })).resolves.toEqual({
            runId: RUN_ID,
            value: "ping",
        });
    });

    it.each([
        ["a cloud deployment", CLOUD_URL],
        ["an unparsable URL", "not a url"],
        ["a missing URL", ""],
    ])("refuses %s before any auth or database access", async (_label, url) => {
        vi.stubEnv("CONVEX_CLOUD_URL", url);
        const { ctx, calls, authCalls } = recordingCtx(`${LANE}|s1`);
        await expect(echo(ctx, {})).rejects.toThrow(
            `${UI_SEAM_REFUSED}: deployment is not local`
        );
        expect(calls).toEqual([]);
        expect(authCalls).toEqual([]);
    });

    it("refuses a signed-out caller before any database access", async () => {
        const { ctx, calls } = recordingCtx();
        await expect(echo(ctx, {})).rejects.toThrow(
            `${UI_SEAM_REFUSED}: caller is not signed in`
        );
        expect(calls).toEqual([]);
    });

    it("refuses an admin that is not a lane account, after only the gate's own user read", async () => {
        const { ctx, calls } = recordingCtx(`${ADMIN}|s1`);
        await expect(echo(ctx, {})).rejects.toThrow(
            `${UI_SEAM_REFUSED}: caller is not a check:ui lane account`
        );
        expect(calls).toEqual([`get(${ADMIN})`]);
    });

    it("refuses a session whose user row is gone", async () => {
        const { ctx } = recordingCtx("userdeleted|s1");
        await expect(echo(ctx, {})).rejects.toThrow(
            `${UI_SEAM_REFUSED}: caller is not a check:ui lane account`
        );
    });
});

// ─── static half ────────────────────────────────────────────────────────

const SEAM_SOURCE_PATH = path.resolve(__dirname, "..", "uiSeam.ts");
const ALLOWED_BUILDERS = new Set(["query", "mutation"]);
const GATE = "assertUiSeamCaller";

/** Why each export of a seam module breaks the contract; empty when it holds. */
function seamGateViolations(source: string): string[] {
    const file = ts.createSourceFile(
        "uiSeam.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const violations: string[] = [];
    let exportCount = 0;
    for (const stmt of file.statements) {
        const exported = ts
            .getModifiers(stmt as ts.HasModifiers)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!exported) {
            if (ts.isExportAssignment(stmt) || ts.isExportDeclaration(stmt)) {
                violations.push(
                    `line ${lineOf(file, stmt)}: re-exports and default exports are not allowed in the seam module`
                );
            }
            continue;
        }
        if (!ts.isVariableStatement(stmt)) {
            violations.push(
                `line ${lineOf(file, stmt)}: only \`export const name = query|mutation({...})\` is allowed`
            );
            continue;
        }
        for (const decl of stmt.declarationList.declarations) {
            exportCount++;
            const name = decl.name.getText(file);
            const why = declarationViolation(decl, file);
            if (why) violations.push(`${name}: ${why}`);
        }
    }
    if (exportCount === 0) violations.push("the seam module exports nothing");
    return violations;
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
    return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function declarationViolation(
    decl: ts.VariableDeclaration,
    file: ts.SourceFile
): string | null {
    const init = decl.initializer;
    if (
        !init ||
        !ts.isCallExpression(init) ||
        !ts.isIdentifier(init.expression) ||
        !ALLOWED_BUILDERS.has(init.expression.text)
    ) {
        return "must be a public query(...) or mutation(...)";
    }
    const [def] = init.arguments;
    if (!def || !ts.isObjectLiteralExpression(def)) {
        return "its definition must be an object literal";
    }
    const handlerProp = def.properties.find(
        (p) => p.name?.getText(file) === "handler"
    );
    let body: ts.ConciseBody | undefined;
    let ctxName: string | undefined;
    if (
        handlerProp &&
        ts.isPropertyAssignment(handlerProp) &&
        (ts.isArrowFunction(handlerProp.initializer) ||
            ts.isFunctionExpression(handlerProp.initializer))
    ) {
        body = handlerProp.initializer.body;
        ctxName = handlerProp.initializer.parameters[0]?.name.getText(file);
    } else if (handlerProp && ts.isMethodDeclaration(handlerProp)) {
        body = handlerProp.body;
        ctxName = handlerProp.parameters[0]?.name.getText(file);
    }
    if (!body || !ts.isBlock(body) || !ctxName) {
        return "needs an inline `handler: async (ctx, args) => { ... }`";
    }
    const first = body.statements[0];
    if (!first || !opensOnGate(first, ctxName)) {
        return `handler's FIRST statement must await ${GATE}(${ctxName})`;
    }
    return null;
}

function opensOnGate(stmt: ts.Statement, ctxName: string): boolean {
    let expr: ts.Expression | undefined;
    if (ts.isExpressionStatement(stmt)) expr = stmt.expression;
    else if (
        ts.isVariableStatement(stmt) &&
        stmt.declarationList.declarations.length === 1
    ) {
        expr = stmt.declarationList.declarations[0].initializer;
    }
    if (!expr || !ts.isAwaitExpression(expr)) return false;
    const call = expr.expression;
    return (
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === GATE &&
        call.arguments.length === 1 &&
        ts.isIdentifier(call.arguments[0]) &&
        call.arguments[0].text === ctxName
    );
}

describe("uiSeam module contract (static, issue #9271)", () => {
    it("every seam function opens on the double gate", () => {
        const source = readFileSync(SEAM_SOURCE_PATH, "utf8");
        expect(seamGateViolations(source)).toEqual([]);
    });

    it.each([
        [
            "a handler that reads before the gate",
            `export const f = query({ args: {}, handler: async (ctx) => { await ctx.db.query("users").first(); await assertUiSeamCaller(ctx); } });`,
            "FIRST statement",
        ],
        [
            "a handler with no gate",
            `export const f = mutation({ args: {}, handler: async (ctx) => { return null; } });`,
            "FIRST statement",
        ],
        [
            "an action",
            `export const f = action({ args: {}, handler: async (ctx) => { await assertUiSeamCaller(ctx); } });`,
            "public query(...) or mutation(...)",
        ],
        [
            "an internal mutation",
            `export const f = internalMutation({ args: {}, handler: async (ctx) => { await assertUiSeamCaller(ctx); } });`,
            "public query(...) or mutation(...)",
        ],
        [
            "a gate called on the wrong value",
            `export const f = query({ args: {}, handler: async (ctx, args) => { await assertUiSeamCaller(args); } });`,
            "FIRST statement",
        ],
        [
            "a gate not awaited",
            `export const f = query({ args: {}, handler: async (ctx) => { assertUiSeamCaller(ctx); } });`,
            "FIRST statement",
        ],
        [
            "a handler passed by reference",
            `export const f = query({ args: {}, handler: impl });`,
            "inline",
        ],
        [
            "an exported helper function",
            `export function helper() {}`,
            "only `export const",
        ],
        ["a re-export", `export { f } from "./elsewhere";`, "re-exports"],
    ])("reds on %s", (_label, source, expected) => {
        const violations = seamGateViolations(source);
        expect(violations.join("\n")).toContain(expected);
    });

    it("accepts a gated mutation whose gate result is bound", () => {
        expect(
            seamGateViolations(
                `export const f = mutation({ args: {}, handler: async (ctx) => { const user = await assertUiSeamCaller(ctx); return user._id; } });`
            )
        ).toEqual([]);
    });
});
