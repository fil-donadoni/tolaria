// The `check:ui` seam's declared-position deep link (issue #9272, ADR 0180):
// `/__uiseam/position?__uiseam_position=<label>` loads that `debugScenarios`
// row into the lane's own solo game through `uiSeam.loadPosition`, records
// the load for the lane, and routes to the board — the Debug sheet's
// Scenarios load in one navigation. A refusal (no solo game in play, an
// absent label, a position the loader refuses) is printed, never swallowed:
// the lane reads it as the row's Unreachable reason. Registered only by
// `src/lib/uiSeam/ui-seam-routes.ts`, i.e. only in a DEV bundle.
import { useMutation } from "convex/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import {
    UI_SEAM_POSITION_PARAM,
    UI_SEAM_POSITION_RECORD_KEY,
    UI_SEAM_UNLESS_AT_PARAM,
    type UiSeamPositionRecord,
} from "@convex/lib/uiSeamNamespace";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { readUiSeamPositionArgs } from "@/lib/uiSeam/ui-seam-position-args";
import { useUiSeamAction } from "@/lib/uiSeam/use-ui-seam-action";
import UiSeamStatus from "./ui-seam-status";

export default function UiSeamPositionRoute() {
    useDocumentTitle("UI seam position");
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const args = readUiSeamPositionArgs(
        search[UI_SEAM_POSITION_PARAM],
        search[UI_SEAM_UNLESS_AT_PARAM]
    );
    const loadPosition = useMutation(api.uiSeam.loadPosition);
    const navigate = useNavigate();
    const error = useUiSeamAction(
        args &&
            (async () => {
                const result = await loadPosition(args);
                const record: UiSeamPositionRecord = {
                    label: args.label,
                    gameId: result.gameId,
                    seq: result.seq,
                    loaded: result.loaded,
                };
                try {
                    sessionStorage.setItem(
                        UI_SEAM_POSITION_RECORD_KEY,
                        JSON.stringify(record)
                    );
                } catch {
                    // Storage refused: the lane then reloads the position on
                    // its next row instead of skipping it — slower, never wrong.
                }
                await navigate({ to: "/game", replace: true });
            }),
        `missing ?${UI_SEAM_POSITION_PARAM}=<label>`
    );
    return (
        <UiSeamStatus
            testId="ui-seam-position"
            pending="Loading position…"
            error={error}
        />
    );
}
