// The `check:ui` seam's Limited screen deep link (issue #9560, ADR 0180):
// `/__uiseam/limited-screen?__uiseam_fixture=<label>&__uiseam_screen=<screen>`
// resolves the Limited fixture's event through `uiSeam.limitedFixtureEvent`
// and routes to that screen — the event page, the Draft Room or the pool
// builder — in one navigation. A refusal is printed for the lane to read.
// Registered only by `src/lib/uiSeam/ui-seam-routes.ts`, i.e. only in a DEV
// bundle.
import { useConvex } from "convex/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import {
    UI_SEAM_FIXTURE_PARAM,
    UI_SEAM_SCREEN_PARAM,
} from "@convex/lib/uiSeamNamespace";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { readUiSeamLimitedScreen } from "@/lib/uiSeam/ui-seam-limited-screen";
import { useUiSeamAction } from "@/lib/uiSeam/use-ui-seam-action";
import UiSeamStatus from "./ui-seam-status";

export default function UiSeamLimitedScreenRoute() {
    useDocumentTitle("UI seam Limited screen");
    const search = useSearch({ strict: false }) as Record<string, unknown>;
    const label = search[UI_SEAM_FIXTURE_PARAM];
    const screen = readUiSeamLimitedScreen(search[UI_SEAM_SCREEN_PARAM]);
    const convex = useConvex();
    const navigate = useNavigate();
    const error = useUiSeamAction(
        typeof label === "string" && label.trim() !== "" && screen
            ? async () => {
                  const eventId = await convex.query(
                      api.uiSeam.limitedFixtureEvent,
                      { label }
                  );
                  if (screen === "draft") {
                      await navigate({
                          to: "/limited/$eventId/draft",
                          params: { eventId },
                          replace: true,
                      });
                  } else if (screen === "build") {
                      await navigate({
                          to: "/limited/$eventId/build",
                          params: { eventId },
                          replace: true,
                      });
                  } else {
                      await navigate({
                          to: "/limited/$eventId",
                          params: { eventId },
                          replace: true,
                      });
                  }
              }
            : null,
        `missing ?${UI_SEAM_FIXTURE_PARAM}=<label> or a valid ?${UI_SEAM_SCREEN_PARAM}=`
    );
    return (
        <UiSeamStatus
            testId="ui-seam-limited-screen"
            pending="Opening the Limited fixture's screen…"
            error={error}
        />
    );
}
