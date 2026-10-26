import { CONTROLLER_POD_HEIGHT_VAR } from "~/lib/controller-bar-metrics";
import { useCssSizeVar } from "./useCssSizeVar";

/** Publishes the desktop controller pod's measured HEIGHT to the document root
 *  as `--controller-pod-h` (issue #6970) — the pod grows with its action list
 *  and an expanded phase panel, so the desktop stack panel anchors above what
 *  it ACTUALLY occupies rather than a guess. */
export function useControllerPodHeight<T extends HTMLElement>() {
    return useCssSizeVar<T>(CONTROLLER_POD_HEIGHT_VAR, "height");
}
