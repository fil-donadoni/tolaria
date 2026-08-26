import { tryGetDefinition } from "@convex/cards";
import { tryGetStateDesignation } from "@convex/cards/designations";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import { motion, useReducedMotion } from "motion/react";
import type { Player, StackItem } from "~/types/game";
import {
    getStackAbilityOracleText,
    getStackModeLines,
    manaCostToString,
    stackAbilityKindOf,
} from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import {
    ART_CROP_RATIO,
    getArtCropImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "~/lib/images";
import { SLOT_SPRING } from "~/lib/board-motion";
import { V4_EYEBROW_FAINT } from "~/lib/board-chrome-v4";
import { stackTargetNames } from "~/lib/stack-target-line";
import ArrivalGlow from "./arrival-glow";
import ColorOverlayCardImage from "../cards/color-overlay-card-image";
import TokenPlaceholder from "../cards/token-placeholder";

type AbilityKind = "activated" | "triggered" | "delayed";

const KIND_LABEL: Record<AbilityKind, string> = {
    activated: "Activated ability",
    triggered: "Triggered ability",
    delayed: "Delayed trigger",
};

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
            className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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
 *  lines and FULL oracle text (never truncated).
 *
 *  Targets are NOT listed as chips: the board-crossing SVG arrows
 *  (`board-arrows.tsx`) are the representation of "what this targets", which a
 *  chip cannot be — it says the name without saying WHERE. That decision is
 *  pinned by `game-stack-order.test.tsx` ("targets are arrows, not text
 *  chips") and this slice does not relitigate it: on desktop the row prints no
 *  target name, exactly as before.
 *
 *  `showTargetLine` (issue #2727) is the ONE case that decision did not cover.
 *  The desktop panel floats beside a board where the arrow is fully visible;
 *  the PHONE panels are not that. In portrait the panel spans the viewer's
 *  whole half (`PORTRAIT_STACK_PANEL_TOP` → `NARROW_BOTTOM_CLASS`) and in
 *  landscape-compact it covers the right rail, so while the panel is open the
 *  arrow's far end is behind it. There the line is not a duplicate of the
 *  arrow — it is the only representation the player can see. See
 *  `stackTargetNames`. */
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
    showTargetLine = false,
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
    /** The whole stack — the only way to name a `spell`-type target (CR
     *  601.2c), which is another item on this same stack. */
    stack: StackItem[];
    /** Print the muted target line under the header. Set only by the phone
     *  stack panels, where the panel occludes the arrows — see the doc block
     *  above for why desktop deliberately stays without it. */
    showTargetLine?: boolean;
}) {
    const reduceMotion = useReducedMotion();
    const kind = stackAbilityKindOf(item);
    // CR 725 (issue #1305) — a source-less inherent designation triggered
    // ability (the Monarch's end-step draw) carries `designationId` but no card
    // (`card.id` is ""). Render its marker-card art + name and label it a plain
    // triggered ability rather than the internal "Delayed trigger".
    const designation = tryGetStateDesignation(item.designationId);
    // CR 114 — an emblem-sourced trigger's `card.id` is an emblem KEY, absent
    // from the card registry; resolve its name/art from the emblem registry so
    // the stack tile shows the emblem card instead of a raw id / missing image.
    const emblem = tryGetEmblemDefinition(item.card.id);
    const def = tryGetDefinition(item.card.id);
    const name = designation?.name ?? def?.name ?? emblem?.name ?? item.card.id;
    const oracle = kind
        ? getStackAbilityOracleText(item)
        : (def?.oracleText ?? null);
    const kindLabel = designation
        ? "Triggered ability"
        : kind
          ? KIND_LABEL[kind]
          : null;
    const modeLines = getStackModeLines(item);
    // Per-source marker art (issue #1305) wins over the designation's global
    // printing, so the Monarch tile matches the card that crowned the player.
    const imageId =
        item.designationImagePrintId ??
        designation?.imagePrintId ??
        emblem?.imagePrintId ??
        resolveCardImageId(item.card.id);
    // Only the permanent-sourced fallback above can be a transformed
    // permanent's back face (a designation/emblem marker never transforms) —
    // resolving on `item.card.id` regardless is still correct since neither
    // has a registered `imagePrintFace` (issue #1595).
    const imageFace = resolveCardImageFace(item.card.id);
    const targetNames = showTargetLine
        ? stackTargetNames(item, allPlayers, stack)
        : [];

    return (
        // The shared-layout flight identity lives on the CARD TILE below, not on
        // this row. A row is a wide text block; matching a 5:7 hand card to it
        // made the FLIP interpolate between two different aspect ratios and the
        // card art visibly SQUASHED across the flight. The tile keeps the card's
        // own proportions, so the flight is a pure translate + uniform scale.
        <div
            data-flight-id={item.id}
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
                // v4 (ADR 0103 §5): a hairline row on the panel corner. The
                // TOP row — the one about to resolve — is the only one that
                // gets the stronger ivory edge, so "what happens next" is the
                // single thing the eye lands on.
                className={`flex w-full gap-3 rounded-[var(--panel-radius)] border p-2 text-left ${
                    isTop
                        ? "border-accent/50 bg-accent-soft/40"
                        : "border-[var(--hairline)]"
                } ${
                    isTargetable
                        ? "cursor-pointer ring-2 ring-signal-target/60 hover:ring-signal-target-strong"
                        : "cursor-default"
                }`}
            >
                <span className="relative block w-16 shrink-0 self-start">
                    {kind ? (
                        // Ability/trigger tile: art crop + kind badge (never a
                        // bare card image for a non-spell stack object).
                        <span className="block">
                            <span
                                className="relative block overflow-hidden card-corner"
                                style={{ aspectRatio: ART_CROP_RATIO }}
                            >
                                {imageId ? (
                                    <img
                                        src={getArtCropImageUrl(
                                            imageId,
                                            imageFace
                                        )}
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
                                {kindLabel}
                            </span>
                        </span>
                    ) : (
                        <motion.span
                            layoutId={item.id}
                            transition={
                                reduceMotion
                                    ? { duration: 0 }
                                    : SLOT_SPRING.motion
                            }
                            className="block"
                        >
                            <ColorOverlayCardImage
                                card={item}
                                showCopyBadge={item.isCopy}
                                sizes="96px"
                            />
                        </motion.span>
                    )}
                    <span className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent font-display text-[10px] font-bold tabular-nums text-surface-base">
                        {order}
                    </span>
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-display text-sm text-text">
                            {name}
                        </span>
                        {def?.manaCost && (
                            <span className="text-[10px]">
                                {formatOracleText(
                                    manaCostToString(def.manaCost)
                                )}
                            </span>
                        )}
                        <ControllerChip
                            item={item}
                            allPlayers={allPlayers}
                            viewerId={viewerId}
                        />
                    </span>

                    {/* Target line (issue #2727), phone panels only — see
                        the component doc for why desktop keeps the
                        arrows-only rule this row has always followed. */}
                    {targetNames.length > 0 && (
                        <span
                            data-stack-target-line
                            className="truncate text-[11px] leading-tight text-text-muted"
                        >
                            <span aria-hidden>→ </span>
                            {targetNames.join(", ")}
                        </span>
                    )}

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

                    {kindLabel && (
                        <span className={V4_EYEBROW_FAINT}>{kindLabel}</span>
                    )}
                    {oracle && !modeLines && (
                        <span className="text-[11px] leading-snug whitespace-pre-line text-text-muted">
                            {formatOracleText(oracle)}
                        </span>
                    )}
                </span>
            </button>
            <ArrivalGlow show={arrived} />
        </div>
    );
}
