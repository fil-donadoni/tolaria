import { CONTROLLER_STRIP_WIDTH_VAR } from "~/lib/controller-bar-metrics";
import { useCssSizeVar } from "./useCssSizeVar";

/** Publishes the landscape-compact control strip's measured WIDTH to the
 *  document root as `--controller-strip-w` (#1769) — the lateral twin of
 *  {@link useControllerBarHeight}.
 *
 *  The strip is docked to the right edge, so what its neighbours must reserve
 *  is horizontal, not vertical. Its width is nominally fixed but the surface is
 *  still measured rather than assumed: the phase panel anchors BESIDE it (see
 *  {@link BESIDE_CONTROLLER_STRIP}), and the landscape board layout (#1768)
 *  gets the same seam for free without either side importing the other. */
export function useControllerStripWidth<T extends HTMLElement>() {
    return useCssSizeVar<T>(CONTROLLER_STRIP_WIDTH_VAR, "width");
}
