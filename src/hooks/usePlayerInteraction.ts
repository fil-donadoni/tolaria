import type { Player } from "~/types/game";
import { wantsPlayerTarget } from "~/lib/card-utils";
import { isPlayerUntargetableByPending } from "~/lib/targeting";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useDivideBuffer } from "~/hooks/useDivideBuffer";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/** Player-facing interaction controller for one player nameplate/face (PRD
 *  #249, slice #280). Mirrors how {@link useBattlefieldInteraction} (#272) was
 *  extracted from `PlayerBattlefield`: the classic life chrome
 *  (`player-life.tsx`) and the spatial player (`board-player.tsx`) both
 *  consume this hook, so clicking a player as a target / damage-choice
 *  dispatches the SAME GRE-boundary mutation / toggles the SAME buffer on
 *  either board.
 *
 *  This hook OWNS, for one player:
 *  - the `selectTarget` mutation (player-as-target, `targetType: "player"`),
 *  - the pending-choice-buffer toggle for a mid-resolution
 *    "any target of an opponent's choice" damage-target pick
 *    (Cuombajj Witches, CR 115.4 / 608.2),
 *  - the derived flags the view layer needs to render the targeting / choice
 *    ring and the priority glow.
 *
 *  Reads ONLY projected (`PublicGameState` / `FullGameState`) fields exposed by
 *  `useGameContext()` — no GRE engine import, consistent with the wire-format
 *  rule in CLAUDE.md. The one exception is `isPlayerUntargetableByPending`
 *  (`~/lib/targeting.ts`), a PURE guard helper re-exported through the same
 *  boundary relaxation `useBattlefieldInteraction` already uses for
 *  `isUntargetableByPending` — it never touches a mutation or transport
 *  module. */
export type PlayerInteraction = {
    /** This nameplate represents the local viewer's own seat. */
    isMe: boolean;
    /** This player currently holds priority. */
    hasPriority: boolean;
    /** A spell/ability targeting a player can legally target this one and the
     *  viewer is the one choosing. */
    isTargetable: boolean;
    /** A choose-damage-target choice owed to the viewer lists this player as an
     *  eligible candidate. */
    isDamageTargetPickable: boolean;
    /** Whether this player is currently buffered in the damage-target pick. */
    isPlayerPicked: boolean;
    /** CR 601.2d — this player is a legal target of an active divide-as-you-
     *  choose spell ("any target" — Fire Covenant / Meteor Shower), so the
     *  nameplate carries a [−] N [+] stepper instead of being click-to-target. */
    isDivideTarget: boolean;
    /** Points currently assigned to this player in the divide buffer. */
    divideAssigned: number;
    /** Whether more of the divide budget remains to assign. */
    divideCanPlus: boolean;
    /** Assign one more / one fewer point to this player. */
    incDivide: () => void;
    decDivide: () => void;
    /** Click handler: routes to `selectTarget` (target) or the choice-buffer
     *  toggle (damage-target), or no-ops when neither applies (incl. divide,
     *  which the stepper owns). */
    handleClick: () => void;
};

export function usePlayerInteraction(player: Player): PlayerInteraction {
    const {
        gameId,
        playerId,
        priorityPlayerId,
        pendingTarget,
        pendingChoices,
        allPlayers,
        playerProtectionFromEverything,
    } = useGameContext();
    const isMe = player.id === playerId;
    const hasPriority = player.id === priorityPlayerId;

    const selectTargetMut = useMutation(api.game.selectTarget);
    const bufferCtx = usePendingChoiceBuffer();
    const divide = useDivideBuffer();

    const isTargetable =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        // Accepts scalar "player"/"any" AND the array form (Lava Spike's
        // ["player", "Planeswalker"]) — a raw === "player" missed arrays.
        wantsPlayerTarget(pendingTarget.targetType) &&
        // CR 506.2 — "target player who attacked this turn" (Fire and
        // Brimstone): a player is only clickable when they control a creature
        // flagged as having attacked. The server enforces this too, but gating
        // clickability keeps the Arena-style UX honest.
        (!pendingTarget.playerAttackedThisTurn ||
            player.battlefield.some((c) => c.hasAttackedThisTurn)) &&
        // CR 702.18 (applied to a player via CR 115.4) — don't offer a
        // shrouded player as a click-to-target candidate; the server would
        // reject it anyway (issue #1128, mirrors the battlefield's
        // `isUntargetableByPending` gate for shrouded permanents, #382).
        // CR 702.16b/i (issue #674) — same treatment for a player with
        // protection from everything (The One Ring), folded into the same
        // guard; it arrives as the wire designation, not a permanent's static.
        !isPlayerUntargetableByPending(
            allPlayers,
            player.id,
            playerProtectionFromEverything
        );

    // Mid-resolution "any target of an opponent's choice" (CR 115.4 / 608.2,
    // Cuombajj Witches). The chooser (viewer == choice.playerId) may pick a
    // player as the damage target — routed through the same client buffer as
    // the battlefield permanent picks (toggle then Done).
    const damageTargetChoice = pendingChoices?.[0];
    const isDamageTargetPickable =
        !!damageTargetChoice &&
        // `choose-player` (CR 115.1a — Endurance's trigger-time player target)
        // is picked through the SAME player-nameplate buffer path.
        (damageTargetChoice.kind === "choose-damage-target" ||
            damageTargetChoice.kind === "choose-player") &&
        damageTargetChoice.playerId === playerId &&
        (damageTargetChoice.candidatePlayerIds?.includes(player.id) ?? false);
    const isPlayerPicked =
        isDamageTargetPickable && bufferCtx.buffer.includes(player.id);

    // CR 601.2d — divide-as-you-choose "any target" (Fire Covenant / Meteor
    // Shower): this player is a divide target when it is a legal player target
    // AND the active selection divides a budget. The nameplate then shows a
    // stepper (driven by the shared divide buffer) instead of click-to-target.
    const isDivideTarget =
        isTargetable &&
        divide.active &&
        pendingTarget?.divideTotal !== undefined;

    function handleClick() {
        // A divide target is dialed via its nameplate stepper, never clicked.
        if (isTargetable && pendingTarget?.divideTotal === undefined) {
            selectTargetMut({
                gameId,
                playerId,
                targetType: "player",
                targetId: player.id,
            });
            return;
        }
        if (isDamageTargetPickable) {
            bufferCtx.toggle(player.id);
        }
    }

    return {
        isMe,
        hasPriority,
        isTargetable,
        isDamageTargetPickable,
        isPlayerPicked,
        isDivideTarget,
        divideAssigned: isDivideTarget ? divide.get(player.id) : 0,
        divideCanPlus: divide.remaining > 0,
        incDivide: () => divide.inc(player.id, "player"),
        decDivide: () => divide.dec(player.id),
        handleClick,
    };
}
