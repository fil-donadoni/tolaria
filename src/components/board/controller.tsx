import { useViewportMode } from "~/hooks/useViewportMode";
import ControllerPod from "./controller-pod";
import ControllerBottomBar from "./controller-bottom-bar";
import ControllerLandscapeStrip from "./controller-landscape-strip";

/** The board controller's single high seam (#335, widened to three modes in
 *  #1769). This is the ONE place the layout switch lives, and it reads
 *  {@link useViewportMode} directly rather than the `useIsPortrait` projection
 *  — the switch is now three-way, not boolean:
 *
 *  - `portrait`          → fixed bottom action bar + phase bottom sheet (#1759)
 *  - `landscape-compact` → thin right-edge control strip + phase panel (#1769)
 *  - `desktop`           → the reduced right-edge pod (#331)
 *
 *  Exactly ONE branch mounts in every mode, so `useControllerActions` (and its
 *  keyboard-shortcut effect + mutations) runs once — never doubled. That
 *  invariant is the reason the switch stays here as a single expression instead
 *  of each surface gating itself on a media query: three self-gating surfaces
 *  would double the hook wherever two queries overlapped.
 *
 *  All three branches consume the SAME `useControllerActions` descriptors, so
 *  every action dispatches the identical mutation, both mobile branches share
 *  the SAME {@link selectCommandSlots} morphing rule, and every phase surface
 *  reuses the SAME `useSkipPhasePreferences` stop-toggle path. The switch is
 *  LAYOUT-only (ADR 0009): input handlers stay dual-bound mouse+touch
 *  regardless. */
export default function Controller({ onOpenMenu }: { onOpenMenu: () => void }) {
    const mode = useViewportMode();
    if (mode === "portrait")
        return <ControllerBottomBar onOpenMenu={onOpenMenu} />;
    if (mode === "landscape-compact")
        return <ControllerLandscapeStrip onOpenMenu={onOpenMenu} />;
    return <ControllerPod onOpenMenu={onOpenMenu} />;
}
