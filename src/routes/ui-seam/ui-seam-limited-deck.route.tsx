// The `check:ui` seam's Limited deck deep link (issue #9272, ADR 0180):
// `/__uiseam/limited-deck?__uiseam_fixture=<label>&__uiseam_deck_name=<name>`
// saves the lane's seat of that Limited fixture as a Limited deck through
// `uiSeam.saveLimitedFixtureDeck` — the save a builder "Done" makes, without
// driving the builder — and routes to the Limited Deck Archive. A refusal is
// printed for the lane to read. Registered only by
// `src/lib/uiSeam/ui-seam-routes.ts`, i.e. only in a DEV bundle.
import { useMutation } from "convex/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import {
    UI_SEAM_DECK_NAME_PARAM,
    UI_SEAM_FIXTURE_PARAM,
} from "@convex/lib/uiSeamNamespace";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUiSeamAction } from "@/lib/uiSeam/use-ui-seam-action";
import UiSeamStatus from "./ui-seam-status";

export default function UiSeamLimitedDeckRoute() {
    useDocumentTitle("UI seam Limited deck");
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const label = search[UI_SEAM_FIXTURE_PARAM];
    const name = search[UI_SEAM_DECK_NAME_PARAM];
    const saveDeck = useMutation(api.uiSeam.saveLimitedFixtureDeck);
    const navigate = useNavigate();
    const error = useUiSeamAction(
        typeof label === "string" && label.trim() !== ""
            ? async () => {
                  await saveDeck({
                      label,
                      name: typeof name === "string" ? name : "",
                  });
                  await navigate({ to: "/limited/decks", replace: true });
              }
            : null,
        `missing ?${UI_SEAM_FIXTURE_PARAM}=<label>`
    );
    return (
        <UiSeamStatus
            testId="ui-seam-limited-deck"
            pending="Saving the fixture seat's deck…"
            error={error}
        />
    );
}
