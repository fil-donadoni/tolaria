// The `check:ui` seam's trivial page (issue #9271, ADR 0180): prints the
// server seam's echo of `?__uiseam_echo=` plus the lane run id the caller's
// account carries. Rendering a value proves the client gate (this route exists
// only in a DEV bundle) and both server gates (local deployment, lane account)
// end to end; a refusal surfaces as the query's error. Registered only by
// `src/lib/uiSeam/ui-seam-routes.ts`.
import { useQuery } from "convex/react";
import { useSearch } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { UI_SEAM_ECHO_PARAM } from "@convex/lib/uiSeamNamespace";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function UiSeamEchoRoute() {
    useDocumentTitle("UI seam echo");
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const raw = search[UI_SEAM_ECHO_PARAM];
    const value = typeof raw === "string" ? raw : undefined;
    const answer = useQuery(api.uiSeam.echo, { value });
    return (
        <div className="p-6 text-text" data-testid="ui-seam-echo">
            {answer === undefined ? (
                <p>Loading…</p>
            ) : (
                <dl>
                    <dt>run</dt>
                    <dd data-testid="ui-seam-echo-run">{answer.runId}</dd>
                    <dt>value</dt>
                    <dd data-testid="ui-seam-echo-value">{answer.value}</dd>
                </dl>
            )}
        </div>
    );
}
