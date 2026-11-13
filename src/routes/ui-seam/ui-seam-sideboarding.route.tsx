// The `check:ui` seam's sideboarding deep link (issue #9560, ADR 0180):
// `/__uiseam/sideboarding` puts the lane's own solo game's Match at the Bo3
// sideboarding gate through `uiSeam.forceSideboarding` — the Debug panel's
// "Bo3 Sideboard", minus the panel — and routes to the board, whose
// Game-Over interstitial offers "Continue to Sideboarding". A refusal (no
// solo game in play) is printed for the lane to read. Registered only by
// `src/lib/uiSeam/ui-seam-routes.ts`, i.e. only in a DEV bundle.
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUiSeamAction } from "@/lib/uiSeam/use-ui-seam-action";
import UiSeamStatus from "./ui-seam-status";

export default function UiSeamSideboardingRoute() {
    useDocumentTitle("UI seam sideboarding");
    const forceSideboarding = useMutation(api.uiSeam.forceSideboarding);
    const navigate = useNavigate();
    const error = useUiSeamAction(async () => {
        await forceSideboarding({});
        await navigate({ to: "/game", replace: true });
    }, "");
    return (
        <UiSeamStatus
            testId="ui-seam-sideboarding"
            pending="Moving the match to the sideboarding gate…"
            error={error}
        />
    );
}
