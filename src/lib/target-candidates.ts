/**
 * The client's ONE notion of "is this a legal click-to-target candidate for
 * the viewer's pending target" (CR 601.2c / 602.2b / 603.3d), per target
 * space: a battlefield permanent, a player, a stack object.
 *
 * Each predicate composes the SAME shared target-filter registry the server's
 * offered set (`getLegalTargets`) and accepted set (`selectTarget`) use
 * (ADR 0068), so the candidate ring, the nameplate glow, the stack row and the
 * targeting arrow (issue #9163) agree on one set. Display only — the server
 * re-validates every pick (ADR 0074).
 */
import type {
    CardInstance,
    PendingTarget,
    Player,
    StackItem,
} from "~/types/game";
import {
    matchesPermanentTargetFilters,
    matchesPlayerTargetFilters,
    matchesSpellPendingTarget,
    matchesTargetRequirement,
    wantsPermanentTarget,
    wantsPlayerTarget,
    wantsSpellTarget,
} from "~/lib/card-utils";
import {
    isBarredByRequiredTargetChoice,
    isPlayerUntargetableByPending,
    isUntargetableByPending,
} from "~/lib/targeting";

/** What every candidate predicate reads besides the candidate itself. */
export type TargetCandidateEnv = {
    viewerId: string;
    activePlayerId: string;
    allPlayers: Player[];
    playerProtectionFromEverything?: string[];
    /** Divide-as-you-choose picks buffered client-side (CR 601.2d). */
    assignedIds?: readonly string[];
};

/** The permanent predicate's extra facts. `controlContinuity` stays REQUIRED
 *  (see {@link matchesPermanentTargetFilters}): `undefined` fails CLOSED. */
export type PermanentCandidateEnv = TargetCandidateEnv & {
    stackItems: StackItem[];
    controlContinuity: Parameters<typeof matchesPermanentTargetFilters>[4];
    emblems: Parameters<typeof matchesPermanentTargetFilters>[5];
    combat: Parameters<typeof matchesPermanentTargetFilters>[6];
};

/** True when `pendingTarget` is the viewer's own selection. */
function isViewersSelection(
    pendingTarget: PendingTarget | undefined | null,
    env: TargetCandidateEnv
): pendingTarget is PendingTarget {
    return !!pendingTarget && pendingTarget.playerId === env.viewerId;
}

/** A battlefield permanent the viewer may pick for `pendingTarget`. */
export function isLegalPermanentTarget(
    card: CardInstance,
    pendingTarget: PendingTarget | undefined | null,
    env: PermanentCandidateEnv
): boolean {
    if (!isViewersSelection(pendingTarget, env)) return false;
    if (!wantsPermanentTarget(pendingTarget.targetType)) return false;
    return (
        matchesTargetRequirement(card, pendingTarget.targetType) &&
        matchesPermanentTargetFilters(
            card,
            pendingTarget,
            env.allPlayers,
            env.activePlayerId,
            env.controlContinuity,
            env.emblems,
            env.combat
        ) &&
        // CR 702.16b / 702.18 / 611 (issue #1120) — a permanent the server
        // would reject (shroud, hexproof vs an opponent's source, protection
        // from the source's quality) is not a candidate.
        !isUntargetableByPending(
            env.allPlayers,
            card,
            pendingTarget.cardInstanceId,
            pendingTarget.kind,
            env.stackItems,
            pendingTarget.playerId
        ) &&
        // CR 601.2c — a target-choice requirement (Flagbearer) narrows the
        // pick to the permanents it names.
        !isBarredByRequiredTargetChoice(pendingTarget, card.id, env.assignedIds)
    );
}

/** A player the viewer may pick for `pendingTarget`. */
export function isLegalPlayerTarget(
    player: Player,
    pendingTarget: PendingTarget | undefined | null,
    env: TargetCandidateEnv
): boolean {
    if (!isViewersSelection(pendingTarget, env)) return false;
    return (
        // Scalar "player"/"any" AND the array form (Lava Spike).
        wantsPlayerTarget(pendingTarget.targetType) &&
        // CR 109.3 / 115 / 506.2 / 601.2c — every player-kind filter dimension
        // through the shared registry (issue #1734).
        matchesPlayerTargetFilters(
            player,
            pendingTarget,
            env.activePlayerId,
            env.allPlayers
        ) &&
        // CR 702.18 via CR 115.4 (issue #1128) / CR 702.16b (issue #674).
        !isPlayerUntargetableByPending(
            env.allPlayers,
            player.id,
            env.playerProtectionFromEverything
        ) &&
        // CR 601.2c — a binding target-choice requirement names permanents
        // only, so no nameplate is a legal click.
        !isBarredByRequiredTargetChoice(
            pendingTarget,
            player.id,
            env.assignedIds
        )
    );
}

/** A stack object the viewer may pick for `pendingTarget` (ADR 0068 /
 *  issue #1956 — one composed spell predicate). */
export function isLegalStackTarget(
    item: StackItem,
    pendingTarget: PendingTarget | undefined | null,
    env: TargetCandidateEnv
): boolean {
    if (!isViewersSelection(pendingTarget, env)) return false;
    return (
        wantsSpellTarget(pendingTarget.targetType) &&
        matchesSpellPendingTarget(item, pendingTarget, {
            playerId: env.viewerId,
            activePlayerId: env.activePlayerId,
            players: env.allPlayers,
        }) &&
        // CR 601.2c — a target-choice requirement narrows the pick to
        // battlefield permanents, so no stack object is legal while one binds.
        !isBarredByRequiredTargetChoice(pendingTarget, item.id)
    );
}
