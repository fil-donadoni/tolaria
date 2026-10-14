import type { RouteCatalogueNeed } from "./catalogueGateMode";

/** `none` — every non-root match is a declared `lightSurface`; `game` —
 *  every gated match declares `catalogue: "game"` and loads its own Sets
 *  behind the Definition Manifest (issue #5615); else `whole`, the default. */
export function routeCatalogueNeed(
    matches: readonly {
        routeId: string;
        staticData: { lightSurface?: boolean; catalogue?: "game" };
    }[]
): RouteCatalogueNeed {
    const gated = matches.filter(
        (match) =>
            match.routeId !== "__root__" &&
            match.staticData.lightSurface !== true
    );
    if (gated.length === 0) return "none";
    return gated.every((match) => match.staticData.catalogue === "game")
        ? "game"
        : "whole";
}
