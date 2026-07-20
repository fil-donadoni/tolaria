import { useEffect } from "react";
import { useMutation } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@convex/_generated/api";
import { SLOT_SPRING } from "~/lib/board-motion";
import ArrivalGlow from "./arrival-glow";
import type { StackItem } from "~/types/game";
import {
    getAbilityOracleText,
    getDelayedTriggerOracleText,
    getStackModeLines,
    getTriggeredAbilityOracleText,
    matchesSpellTypeFilter,
    matchesSpellExcludeTypeFilter,
    matchesSpellCreaturePtFilter,
    matchesSpellSingleTargetingController,
    matchesSpellController,
    matchesSpellWouldDestroyLand,
    matchesStackObjectFilter,
    wantsSpellTarget,
} from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useDraggable } from "~/hooks/useDraggable";
import { repositionLeaderLines } from "~/hooks/use-leader-lines";
import { Panel } from "~/components/ui/panel";
import DragHandle from "./drag-handle";
import StackAbilityTile from "./stack-ability-tile";
import StackModeLines from "./stack-mode-lines";
import ColorOverlayCardImage from "../cards/color-overlay-card-image";

type GameStackProps = {
    stack: StackItem[];
};

export default function GameStack({ stack }: GameStackProps) {
    const {
        gameId,
        playerId,
        pendingTarget,
        allPlayers,
        activePlayerId,
        recentArrivals,
    } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const { offset, dragHandlers } = useDraggable();
    const reduceMotion = useReducedMotion();
    // Arrow hover-highlight (combat-read): a stack item dims when a relationship
    // is hovered and it is not part of it, lights when it is, and seeds the
    // channel with its own id on hover so the arrow layer resolves the
    // relationship. No-op on the classic board (no provider).
    const highlight = useArrowHighlight();
    const setSeed = highlight?.setSeed;

    // The panel moves via CSS transform, which fires no resize/scroll event,
    // so target arrows would keep stale endpoints. Re-anchor them on every
    // offset change — this runs each pointermove during a drag.
    useEffect(() => {
        repositionLeaderLines();
    }, [offset.x, offset.y]);

    const canTargetSpell =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsSpellTarget(pendingTarget.targetType);

    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    return (
        <div
            // Play-area layout rule: anchor the stack to the right edge of the
            // play area (just LEFT of the reserved right strip), not the
            // viewport. `--right-piles-w` resolves in-tree under
            // `data-board-root`; portrait ⇒ 0px ⇒ flush to the viewport edge
            // (and the portrait chip path renders the stack differently anyway).
            className="absolute top-1/2 z-modal"
            style={{
                right: "var(--right-piles-w)",
                transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            {/* overflow-visible, NOT -hidden: a spell flying in from the hand
                mounts inside this panel, and clipping it to the panel box would
                hide the flight until it crosses the boundary. */}
            <div className="relative bg-surface border border-border-subtle rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-visible">
                {/* Corner filigree only — the box keeps its own chrome so the
                    flight layout above is untouched (least-intrusive frame). */}
                <Panel overlay />
                <DragHandle label="Stack" handlers={dragHandlers} />
                <div className="flex items-start p-3">
                    {reversed.map((item, i) => {
                        const abilityKind:
                            | "activated"
                            | "triggered"
                            | "delayed"
                            | null = item.abilityId
                            ? "activated"
                            : item.triggeredAbilityId
                              ? "triggered"
                              : item.delayedTriggerId
                                ? "delayed"
                                : null;
                        const abilityText =
                            abilityKind === "activated"
                                ? getAbilityOracleText(
                                      item.card.id,
                                      item.abilityId!
                                  )
                                : abilityKind === "triggered"
                                  ? getTriggeredAbilityOracleText(
                                        item.card.id,
                                        item.triggeredAbilityId!,
                                        item.grantedTriggeredAbilities
                                    )
                                  : abilityKind === "delayed"
                                    ? getDelayedTriggerOracleText(
                                          item.card.id,
                                          item.delayedTriggerId!
                                      )
                                    : null;
                        const isTargetable =
                            canTargetSpell &&
                            matchesSpellTypeFilter(
                                item,
                                pendingTarget?.spellTypeFilter
                            ) &&
                            matchesSpellExcludeTypeFilter(
                                item,
                                pendingTarget?.spellExcludeTypeFilter
                            ) &&
                            matchesSpellCreaturePtFilter(
                                item,
                                pendingTarget?.spellCreaturePtFilter
                            ) &&
                            matchesSpellSingleTargetingController(
                                item,
                                pendingTarget?.spellSingleTargetingController,
                                playerId
                            ) &&
                            matchesSpellController(
                                item,
                                pendingTarget?.controller,
                                playerId,
                                activePlayerId
                            ) &&
                            matchesSpellWouldDestroyLand(
                                item,
                                pendingTarget?.spellWouldDestroyLandYouControl,
                                allPlayers,
                                playerId
                            ) &&
                            matchesStackObjectFilter(
                                item,
                                pendingTarget?.spellStackKind,
                                pendingTarget?.stackSourceTypeFilter,
                                pendingTarget?.spellTargetsInstanceIds
                            );

                        // CR 700.2c (issue #1274) — a modal spell that locked
                        // in a mode at cast shows its modal oracle lines with the
                        // chosen one highlighted, visible to both players.
                        const modeLines = getStackModeLines(item);

                        const litState = highlight?.nodes
                            ? highlight.nodes.has(item.id)
                                ? "lit"
                                : "unlit"
                            : null;

                        return (
                            // Shared-layout wrapper: the layoutId (card instance
                            // id) matches the hand slot the spell was cast from
                            // and the battlefield/pile slot it resolves into, so
                            // motion flies the SAME element hand → stack →
                            // destination. NO `layout` prop — the panel is
                            // user-draggable, and layout-on-render would
                            // rubber-band the items behind the drag.
                            <motion.div
                                key={item.id}
                                layoutId={item.id}
                                data-flight-id={item.id}
                                transition={
                                    reduceMotion
                                        ? { duration: 0 }
                                        : SLOT_SPRING.motion
                                }
                                className="relative shrink-0 transition-opacity duration-150"
                                style={{
                                    marginLeft: i > 0 ? "-4rem" : undefined,
                                    // Lit items ride above the rest of the
                                    // (overlapping) stack while highlighted, so
                                    // the relationship reads on top.
                                    zIndex:
                                        litState === "lit"
                                            ? reversed.length + 100 - i
                                            : reversed.length - i,
                                    opacity: litState === "unlit" ? 0.3 : 1,
                                }}
                            >
                                <button
                                    type="button"
                                    data-arrow-anchor-stack={item.id}
                                    disabled={!isTargetable}
                                    onPointerEnter={
                                        setSeed
                                            ? () => setSeed({ nodeId: item.id })
                                            : undefined
                                    }
                                    onPointerLeave={
                                        setSeed
                                            ? () => setSeed(null)
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (!isTargetable) return;
                                        selectTarget({
                                            gameId,
                                            playerId,
                                            targetType: "spell",
                                            targetId: item.id,
                                        });
                                    }}
                                    className={`w-32 flex flex-col items-center bg-transparent border-0 p-0 ${
                                        isTargetable
                                            ? "cursor-pointer ring-2 ring-signal-target/60 rounded hover:ring-signal-target-strong"
                                            : "cursor-default"
                                    }`}
                                >
                                    {abilityKind && abilityText ? (
                                        <StackAbilityTile
                                            cardId={item.card.id}
                                            abilityText={abilityText}
                                            kind={abilityKind}
                                        />
                                    ) : (
                                        <>
                                            <ColorOverlayCardImage
                                                card={item}
                                                showCopyBadge={item.isCopy}
                                                sizes="128px"
                                                includeThumb={false}
                                            />
                                            {modeLines && (
                                                <StackModeLines
                                                    lines={modeLines}
                                                />
                                            )}
                                        </>
                                    )}
                                </button>
                                <ArrivalGlow
                                    show={recentArrivals?.has(item.id) === true}
                                />
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
