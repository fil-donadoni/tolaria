import { tryGetDefinition } from "@convex/cards";
import { motion, useReducedMotion } from "motion/react";
import type { Player, StackItem } from "~/types/game";
import {
    getAbilityOracleText,
    getDelayedTriggerOracleText,
    getStackModeLines,
    getTriggeredAbilityOracleText,
    manaCostToString,
} from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { ART_CROP_RATIO, getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import { SLOT_SPRING } from "~/lib/board-motion";
import ArrivalGlow from "./arrival-glow";
import ColorOverlayCardImage from "../cards/color-overlay-card-image";
import TokenPlaceholder from "../cards/token-placeholder";

type AbilityKind = "activated" | "triggered" | "delayed";

function abilityKindOf(item: StackItem): AbilityKind | null {
    if (item.abilityId) return "activated";
    if (item.triggeredAbilityId) return "triggered";
    if (item.delayedTriggerId) return "delayed";
    return null;
}

function abilityOracleText(item: StackItem, kind: AbilityKind): string | null {
    if (kind === "activated")
        return getAbilityOracleText(item.card.id, item.abilityId!);
    if (kind === "triggered")
        return getTriggeredAbilityOracleText(
            item.card.id,
            item.triggeredAbilityId!,
            item.grantedTriggeredAbilities
        );
    return getDelayedTriggerOracleText(
        item.card.id,
        item.delayedTriggerId!,
        item.delayedOracleText
    );
}

const KIND_LABEL: Record<AbilityKind, string> = {
    activated: "Activated ability",
    triggered: "Triggered ability",
    delayed: "Delayed trigger",
};

/** Resolve one wire target to a readable name (permanent → card name, player →
 *  seat name, spell → the stack item's name, graveyard card → card name). */
function targetLabel(
    target: NonNullable<StackItem["targets"]>[number],
    allPlayers: Player[],
    stack: StackItem[]
): string {
    switch (target.type) {
        case "player": {
            const p = allPlayers.find((x) => x.id === target.id);
            return p?.name ?? "player";
        }
        case "spell": {
            const item = stack.find((x) => x.id === target.id);
            return item ? (tryGetDefinition(item.card.id)?.name ?? "spell") : "spell";
        }
        case "permanent": {
            for (const p of allPlayers) {
                const c = p.battlefield.find((x) => x.id === target.id);
                if (c) return tryGetDefinition(c.card.id)?.name ?? "permanent";
            }
            return "permanent";
        }
        case "graveyard-card": {
            for (const p of allPlayers) {
                const c = p.graveyard.find((x) => x.id === target.id);
                if (c) return tryGetDefinition(c.card.id)?.name ?? "card";
            }
            return "card";
        }
        case "hand-card":
            return "card";
    }
}

function ControllerChip({
    item,
    allPlayers,
    viewerId,
}: {
    item: StackItem;
    allPlayers: Player[];
    viewerId: string;
}) {
    const mine = item.castById === viewerId;
    const name =
        allPlayers.find((p) => p.id === item.castById)?.name ?? item.castById;
    return (
        <span
            className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                mine
                    ? "bg-signal-self/15 text-signal-self-strong"
                    : "bg-signal-opponent/15 text-signal-opponent-strong"
            }`}
        >
            <span
                className={`h-1.5 w-1.5 rounded-full ${
                    mine ? "bg-signal-self" : "bg-signal-opponent"
                }`}
            />
            {name}
        </span>
    );
}

/** One card-forward row of the readable stack list (phase 2, winner B): art
 *  tile + resolve-order badge, name + mana pips + controller chip, chosen-mode
 *  lines, FULL oracle text (never truncated), and one chip per target. */
export default function StackRow({
    item,
    order,
    isTop,
    isTargetable,
    onSelect,
    onHoverSeed,
    dimmed,
    arrived,
    allPlayers,
    viewerId,
    stack,
}: {
    item: StackItem;
    /** 1-based resolve order — 1 resolves first (top of stack). */
    order: number;
    isTop: boolean;
    isTargetable: boolean;
    onSelect: () => void;
    onHoverSeed: (seeding: boolean) => void;
    /** Dimmed out of the hovered arrow relationship (combat-read dimming). */
    dimmed: boolean;
    arrived: boolean;
    allPlayers: Player[];
    viewerId: string;
    stack: StackItem[];
}) {
    const reduceMotion = useReducedMotion();
    const kind = abilityKindOf(item);
    const def = tryGetDefinition(item.card.id);
    const name = def?.name ?? item.card.id;
    const oracle = kind ? abilityOracleText(item, kind) : (def?.oracleText ?? null);
    const modeLines = getStackModeLines(item);
    const imageId = resolveCardImageId(item.card.id);

    return (
        <motion.div
            layoutId={item.id}
            data-flight-id={item.id}
            transition={reduceMotion ? { duration: 0 } : SLOT_SPRING.motion}
            className="relative shrink-0 transition-opacity duration-150"
            style={{ opacity: dimmed ? 0.3 : 1 }}
        >
            <button
                type="button"
                data-arrow-anchor-stack={item.id}
                disabled={!isTargetable}
                onPointerEnter={() => onHoverSeed(true)}
                onPointerLeave={() => onHoverSeed(false)}
                onClick={onSelect}
                className={`flex w-full gap-3 rounded-sm border p-2 text-left ${
                    isTop
                        ? "border-accent/60 bg-accent-soft/15 shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                        : "border-border-subtle"
                } ${
                    isTargetable
                        ? "cursor-pointer ring-2 ring-signal-target/60 hover:ring-signal-target-strong"
                        : "cursor-default"
                }`}
            >
                <span className="relative block w-12 shrink-0 self-start">
                    {kind ? (
                        // Ability/trigger tile: art crop + kind badge (never a
                        // bare card image for a non-spell stack object).
                        <span className="block">
                            <span
                                className="relative block overflow-hidden rounded-sm"
                                style={{ aspectRatio: ART_CROP_RATIO }}
                            >
                                {imageId ? (
                                    <img
                                        src={getArtCropImageUrl(imageId)}
                                        alt=""
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                ) : (
                                    <TokenPlaceholder
                                        name={name}
                                        types={def?.types ?? []}
                                    />
                                )}
                            </span>
                            <span className="mt-0.5 block rounded-sm bg-black/70 px-1 py-0.5 text-center text-[8px] font-semibold tracking-wider text-text uppercase">
                                {KIND_LABEL[kind]}
                            </span>
                        </span>
                    ) : (
                        <ColorOverlayCardImage
                            card={item}
                            showCopyBadge={item.isCopy}
                            sizes="96px"
                        />
                    )}
                    <span className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent font-beleren text-[10px] font-bold text-primary-foreground">
                        {order}
                    </span>
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold text-text">
                            {name}
                        </span>
                        {def?.manaCost && (
                            <span className="text-[10px]">
                                {formatOracleText(manaCostToString(def.manaCost))}
                            </span>
                        )}
                        <ControllerChip
                            item={item}
                            allPlayers={allPlayers}
                            viewerId={viewerId}
                        />
                    </span>

                    {modeLines?.map((line) => (
                        <span
                            key={line.modeId}
                            data-mode-id={line.modeId}
                            data-mode-chosen={line.chosen}
                            className={
                                line.chosen
                                    ? "flex gap-1 text-[10px] leading-tight font-semibold text-accent"
                                    : "flex gap-1 text-[10px] leading-tight text-text-muted/60"
                            }
                        >
                            <span aria-hidden>{line.chosen ? "▸" : "•"}</span>
                            <span className="min-w-0">
                                {formatOracleText(line.oracleText)}
                            </span>
                        </span>
                    ))}

                    {kind && (
                        <span className="text-[9px] font-semibold tracking-wider text-text-muted uppercase">
                            {KIND_LABEL[kind]}
                        </span>
                    )}
                    {oracle && !modeLines && (
                        <span className="text-[11px] leading-snug whitespace-pre-line text-text-muted">
                            {formatOracleText(oracle)}
                        </span>
                    )}

                    {item.targets && item.targets.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                            {item.targets.map((t, ti) => (
                                <span
                                    key={`${t.type}:${t.id}:${ti}`}
                                    className="inline-flex items-center gap-1 rounded-sm bg-accent-soft/40 px-1.5 py-0.5 text-[10px] font-semibold text-accent-strong"
                                >
                                    <span aria-hidden>→</span>
                                    {targetLabel(t, allPlayers, stack)}
                                </span>
                            ))}
                        </span>
                    )}
                </span>
            </button>
            <ArrivalGlow show={arrived} />
        </motion.div>
    );
}
