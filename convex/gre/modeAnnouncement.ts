// Server-side readers for an announce-time mode list (ADR 0094). The pure
// cardinality grammar lives in `modeSelection.ts`; this module supplies the
// two answers only the engine's state can give — the board facts a
// conditional count reads, and whether a mode can be chosen at all (CR 700.2a).

import type { TargetRequirement } from "../cards/types";
import { matchesPermanentFilter } from "../cards/filters";
import type { GameState, PlayerState } from "./state";
import { STATIC_EFFECT_CTX } from "./layers";
import { liveSupertypesOf } from "./snow";
import { getLegalTargets, type TargetingSource } from "./rules";
import { announcedTargetCount } from "./pendingTargetOrigin";
import type { ModeSelectionFacts, TargetedMode } from "./modeSelection";

/** The facts a `ModeSelection.when` condition reads as `player` announces:
 *  "if you control a <filter>" against their battlefield (colours through the
 *  layer system, as every cost-leg filter reads them), and the kicker verdict
 *  CR 601.4 lets the mode choice consider. */
export function announcementModeFacts(
    player: PlayerState,
    kicked: boolean
): ModeSelectionFacts {
    return {
        controls: (filter) =>
            player.battlefield.some((c) =>
                matchesPermanentFilter(
                    { ...c, colors: STATIC_EFFECT_CTX.getColors(c) },
                    filter,
                    {
                        selfControllerId: player.id,
                        supertypesOf: liveSupertypesOf,
                    }
                )
            ),
        kicked,
    };
}

/** CR 700.2a — "if one of the modes would be illegal (due to an inability to
 *  choose legal targets, for example), that mode can't be chosen": true when
 *  EVERY target group of `mode` has enough legal candidates. A mode with no
 *  targets is always legal. */
export function modeHasLegalTargets(
    state: GameState,
    mode: TargetedMode,
    source: TargetingSource,
    casterId: string,
    chosenX: number | undefined
): boolean {
    const groups: TargetRequirement[] = [
        ...(mode.targetRequirement ? [mode.targetRequirement] : []),
        ...(mode.additionalTargetRequirements ?? []),
    ];
    return groups.every((req) => {
        const count = announcedTargetCount(req, chosenX);
        if (count === undefined) return true;
        const required = typeof count === "number" ? count : count.min;
        return (
            getLegalTargets(state, req, source, casterId, chosenX).length >=
            required
        );
    });
}
