import type { Player } from "~/types/game";
import {
    matchesPlayerTargetFilters,
    wantsPlayerTarget,
} from "~/lib/card-utils";
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
    /** Manual Board only (PRD #2162 / issue #2169) — the life total on this
     *  nameplate is directly editable: clicking it opens an inline field that
     *  commits an exact value through {@link onLifeCommit}. The GRE hook never
     *  sets it (life is only ever changed by the rules engine, CR 118), so the
     *  GRE nameplate renders exactly as before. */
    lifeEditable?: boolean;
    /** Manual Board only — a wheel gesture over the nameplate adjusts the life
     *  total by one in the scroll direction. Receives the raw `deltaY`.
     *  Absent ⇒ the nameplate binds no wheel handler at all. */
    onLifeWheel?: (deltaY: number) => void;
    /** Manual Board only — commit an exact life total typed into the inline
     *  field. Only consulted when {@link lifeEditable} is set. */
    onLifeCommit?: (life: number) => void;
    /** Manual Board only — step the life total by `delta`, the − / + buttons
     *  flanking it (manual-mode QA round 3, item 4). The wheel gesture and the
     *  typed total both existed; neither is reachable on a touch device, and
     *  the wheel is invisible affordance-wise even on a desktop. Absent ⇒ no
     *  buttons render, so the GRE nameplate is untouched. */
    onLifeStep?: (delta: number) => void;
    /** Manual Board only — extra actions the nameplate offers on right-click /
     *  long-press (manual-mode QA round 3, item 3: "Reveal hand"). Empty or
     *  absent ⇒ the nameplate mounts no context menu whatsoever, which is what
     *  keeps the GRE board's own right-click (the card preview) unaffected. */
    menuActions?: readonly PlayerMenuAction[];
};

/** One entry of {@link PlayerInteraction.menuActions}. */
export type PlayerMenuAction = {
    key: string;
    label: string;
    onSelect: () => void;
};

export function usePlayerInteraction(player: Player): PlayerInteraction {
    const {
        gameId,
        playerId,
        priorityPlayerId,
        activePlayerId,
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
        // CR 109.3 / 115 / 506.2 / 601.2c — EVERY player-kind filter
        // dimension, routed through the SAME target-filter registry
        // (`checkPlayerTargetFilters`, ADR 0068) the server's offered set
        // (`getLegalTargets`) and accepted set (`selectTarget`) already share.
        // The per-dimension clauses that used to live inline here covered
        // `playerAttackedThisTurn` and the CR 601.2c already-picked exclusion
        // but simply did not have `controller` (Word of Command's "target
        // opponent"), so both nameplates lit up and the server rejected the
        // click — the #1697 symptom, player-kind (issue #1734).
        matchesPlayerTargetFilters(
            player,
            pendingTarget,
            activePlayerId,
            allPlayers
        ) &&
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
