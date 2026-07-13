// Shared condition for exile-and-return "bundle" cards (ADR 0028): a permanent
// that exiles cards keyed to its own instance id (`exileWithAttachments`) and
// returns them when it leaves the battlefield (`returnExiledForSource`). The
// return half is an armed leaves-the-battlefield trigger whose `condition`
// gates on a bundle still being held, so it never fires with nothing exiled.
//
// Extracted from Banishing Light's inline `banishingLightHoldsSomething`
// (jou/white.ts) on its second reuse — the Parallax Wave / Parallax Tide cycle
// (NEM), which exile via a repeatable activated ability rather than an ETB and
// so may hold several bundles at once under the same `sourceId`.

/** True when `self` currently holds at least one exile-and-return bundle
 *  (matching `state.exileHeld[].sourceId`). Shaped to drop straight into a
 *  `leftTrigger` / `phaseTrigger` `condition` slot (CR 603.4). */
export const holdsExileBundle = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);
