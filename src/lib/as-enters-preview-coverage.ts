import type { AsEntersChoice } from "@convex/cards/types";

/** How the card preview surfaces each as-enters choice kind (CR 614.12):
 *  - `annotated`: the choice persists a field on the instance that the Live
 *    text annotates in place (`buildPreviewBody` → `resolveChosen*`);
 *  - `card-state`: shown through state the preview already renders (P/T, types,
 *    counters, attachment, copy, granted abilities);
 *  - `no-state`: a cost or one-shot answer that leaves nothing on the permanent.
 *
 *  `Record` over the union makes `tsc` red on a new `AsEntersChoice` kind until
 *  it is classified here — a kind cannot ship invisible (issue #10224). */
export type AsEntersPreviewCoverage = "annotated" | "card-state" | "no-state";

export const AS_ENTERS_PREVIEW_COVERAGE: Record<
    AsEntersChoice["kind"],
    AsEntersPreviewCoverage
> = {
    mode: "annotated",
    name: "annotated",
    subtypes: "annotated",
    opponent: "annotated",
    body: "card-state",
    payLife: "card-state",
    copy: "card-state",
    "aura-host": "card-state",
    mayEnterWithCounters: "card-state",
    anchor: "card-state",
    "attack-target": "no-state",
    pay: "no-state",
    discard: "no-state",
    exileFromGraveyard: "no-state",
    sacrifice: "no-state",
};
