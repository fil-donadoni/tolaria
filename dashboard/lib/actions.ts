/**
 * The three reversible driver actions (PRD #3148 S2), ported from
 * `scripts/dashboard/actions.js` (#2636) — the remedy a verdict names becomes
 * something an operator can DO from the page they noticed the problem on,
 * wired to `/api/action` (#2628).
 *
 * All three are named STRUCTURALLY, never by pattern-matching rendered prose:
 *
 *   - `driver.stop` / `driver.resume` — offered when `verdict.remedyAction`
 *     (`scripts/lib/loop-status.ts`) names one. `deriveLoopVerdict` is the SOLE
 *     place that decides which of the two (or neither) makes sense, so nothing
 *     here re-derives that judgement from `verdict.state` or the remedy's text.
 *   - `claim.release` — offered per ROW, on exactly the rows whose
 *     `verdict.state` is `orphan`; that predicate is `classifyClaim`'s own
 *     output, consumed the way the rest of this dashboard consumes it.
 *
 * This module is the transport and the vocabulary. The dialog is a component
 * (`ConfirmDialog.tsx`); the re-entrancy guard that stops a double click
 * sending two requests lives with it.
 */

import type { RemedyAction } from "./nowPayload";

const ACTION_PATH = "/api/action";
const ACTION_TOKEN_META = "loop-action-token";
const ACTION_TOKEN_HEADER = "x-loop-action-token";

export type ActionId = RemedyAction | "claim.release";

/** What each action is CALLED on a button. */
export const ACTION_LABEL: Record<ActionId, string> = {
    "driver.stop": "Stop driver",
    "driver.resume": "Resume driver",
    "claim.release": "Release claim",
};

/**
 * The two VERDICT-level actions. `claim.release` is deliberately absent: it
 * acts on one claim, not on the driver, and is offered per-row instead. A
 * `remedyAction` this map does not name renders NO button rather than a guess
 * — the same "unknown must never look like an offered action" posture the
 * verdict tone's `bad` fallback takes for an unrecognised state.
 */
export const VERDICT_ACTION_LABEL: Record<RemedyAction, string> = {
    "driver.stop": "Stop driver",
    "driver.resume": "Resume driver",
};

const ACTION_EFFECT: Record<RemedyAction, string> = {
    "driver.stop": "Ask the running driver to stop after its current pass.",
    "driver.resume":
        "Arm the loop if needed, clear any stop-file, and start a detached driver.",
};

/** The sentence a confirmation states before anything is sent (AC: "naming
 *  its exact effect"). `claim.release` names the specific issue, so it is
 *  built per-click rather than listed above. */
export function effectFor(action: ActionId, issue?: number): string {
    if (action === "claim.release") {
        return `Remove the in-progress label from #${issue}. The next pass may claim it again.`;
    }
    return ACTION_EFFECT[action] ?? "";
}

/**
 * Coerces a row's issue number to the positive integer `/api/action`'s
 * `claim.release` handler requires (`ACTION_ALLOW_LIST`, #2628). That handler
 * deliberately REFUSES a numeric string rather than coercing it itself
 * (`"2628 2629"` and `"2628"` are both strings), so the coercion happens here,
 * once, before the request is built. Anything that is not a clean positive
 * integer returns `undefined` — a malformed row then fails closed by never
 * opening a dialog, rather than opening one for a request the server would
 * 400 anyway (#2636 review round 1, finding 1).
 */
export function coerceIssue(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** The per-boot token, injected into the document by `telemetry-serve.ts`
 *  (and by the dev server's own plugin). Absent → the request 401s, which is
 *  the honest outcome: an empty token authenticates nothing. */
export function actionToken(): string {
    return (
        document.querySelector<HTMLMetaElement>(
            `meta[name="${ACTION_TOKEN_META}"]`
        )?.content ?? ""
    );
}

export interface ActionResult {
    ok: boolean;
    error?: string;
}

/**
 * POSTs one action. Returns the parsed `{ok, ...}` body ALWAYS — a network
 * failure and a non-JSON response are both folded into `{ok:false, error}`, so
 * the caller has exactly one shape to branch on and never a thrown exception
 * to also catch.
 */
export async function postAction(
    action: ActionId,
    extra: Record<string, unknown> = {}
): Promise<ActionResult> {
    try {
        const res = await fetch(ACTION_PATH, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                [ACTION_TOKEN_HEADER]: actionToken(),
            },
            body: JSON.stringify({ action, ...extra }),
        });
        let body: ActionResult;
        try {
            body = (await res.json()) as ActionResult;
        } catch {
            body = { ok: false, error: `HTTP ${res.status}` };
        }
        if (typeof body?.ok !== "boolean") {
            body = { ok: false, error: `HTTP ${res.status}` };
        }
        return body;
    } catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e.message : "network error",
        };
    }
}
