import { useIsPortrait } from "~/hooks/useIsPortrait";
import ControllerPod from "./controller-pod";
import ControllerBottomBar from "./controller-bottom-bar";

/** The board controller's single high seam (#335). This is the ONE place the
 *  portrait/landscape layout switch lives: portrait renders the fixed bottom
 *  action bar (+ phase bottom sheet); landscape/desktop renders the reduced
 *  right-edge pod. Exactly one branch mounts, so `useControllerActions` (and its
 *  keyboard-shortcut effect + mutations) runs once — never doubled.
 *
 *  Both branches consume the SAME `useControllerActions` descriptors, so every
 *  action dispatches the identical mutation, and the portrait phase sheet reuses
 *  the SAME `useSkipPhasePreferences` stop-toggle path. The switch is LAYOUT-only
 *  (ADR 0009): input handlers stay dual-bound mouse+touch regardless. */
export default function Controller({ onOpenMenu }: { onOpenMenu: () => void }) {
    const isPortrait = useIsPortrait();
    return isPortrait ? (
        <ControllerBottomBar onOpenMenu={onOpenMenu} />
    ) : (
        <ControllerPod onOpenMenu={onOpenMenu} />
    );
}
