import { CONTROLLER_BAR_HEIGHT_VAR } from "~/lib/controller-bar-metrics";
import { useCssSizeVar } from "./useCssSizeVar";

/** Publishes the portrait bottom bar's measured height to the document root as
 *  `--controller-bar-h` (#1759), so every consumer that must sit clear of the
 *  bar reserves the height the bar ACTUALLY has instead of a hard-coded guess.
 *
 *  The bar's command row wraps, so its height is state-dependent: ~106px on one
 *  line, ~150px once DECLARE_ATTACKERS pushes the side pills onto their own
 *  line. A `ResizeObserver` republishes on every such change, which is what
 *  keeps the portrait hand strip and the Zones drawer above the bar in states
 *  nobody enumerated (see {@link ABOVE_CONTROLLER_BAR}).
 *
 *  The measuring/publishing plumbing itself lives in {@link useCssSizeVar},
 *  shared with the landscape-compact strip's width twin (#1769). */
export function useControllerBarHeight<T extends HTMLElement>() {
    return useCssSizeVar<T>(CONTROLLER_BAR_HEIGHT_VAR, "height");
}
