import { useEffect, useState, type SyntheticEvent } from "react";
import { Crosshair } from "lucide-react";
import type { Player, StackItem } from "~/types/game";
import { stackTargetLines } from "~/lib/stack-target-line";
import {
    stackTargetHeaderAnchorId,
    stackTargetLineAnchorId,
} from "~/lib/target-arrow-geometry";
import { repositionAnchors } from "~/hooks/anchor-reposition";
import TargetThumb from "./target-thumb";

/** Width of a target line's card thumbnail (px). */
const LINE_THUMB_W = 26;

/**
 * A stack row's Targets block (issue #9326, variant B): every announced target
 * (CR 601.2c), whatever its kind, on its own line — a small card image, a
 * crosshair + the name, and WHERE it is ("#4 in Opponent's graveyard", "#5 on
 * the stack (spell)", "on your battlefield", "player"). It collapses like
 * every other game box (header only).
 *
 * A zone-card target's arrow leaves its line's left edge (the header's while
 * collapsed): each line and the header carry a `data-arrow-anchor-stack-target`
 * anchor the arrow layer measures.
 *
 * The header toggle is a plain clickable span, not a `role="button"`: the
 * whole row is already a button (spell targeting), and a control nested in a
 * control is invalid HTML and an axe `nested-interactive` red (issue #3556's
 * reason for keeping the yield toggle a sibling).
 */
export default function StackRowTargets({
    item,
    allPlayers,
    stack,
    viewerId,
}: {
    item: StackItem;
    allPlayers: readonly Player[];
    stack: readonly StackItem[];
    viewerId: string;
}) {
    const [open, setOpen] = useState(true);
    // Collapsing moves every line (and the rows below) with no resize or
    // scroll event: ask the anchor publishers to re-measure.
    useEffect(() => {
        repositionAnchors();
    }, [open]);
    const lines = stackTargetLines(item, allPlayers, stack, viewerId);
    if (lines.length === 0) return null;
    const toggle = (e: SyntheticEvent) => {
        // Inside the row's own button: never select the row.
        e.stopPropagation();
        e.preventDefault();
        setOpen((o) => !o);
    };
    return (
        <span
            data-stack-targets
            data-open={open ? "true" : "false"}
            className="mt-0.5 flex flex-col gap-1 border-t border-border-strong/60 pt-1"
        >
            <span
                data-arrow-anchor-stack-target={stackTargetHeaderAnchorId(
                    item.id
                )}
                data-stack-targets-toggle
                onClick={toggle}
                className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase hover:text-text"
            >
                <span
                    aria-hidden
                    className="inline-block transition-transform"
                    style={{ transform: open ? "rotate(90deg)" : "none" }}
                >
                    ▸
                </span>
                Targets · {lines.length}
            </span>
            {open &&
                lines.map((line) => (
                    <span
                        key={`${line.target.type}:${line.target.id}`}
                        data-arrow-anchor-stack-target={stackTargetLineAnchorId(
                            item.id,
                            line.target
                        )}
                        data-stack-target-line
                        className="flex items-center gap-2"
                    >
                        {line.card ? (
                            <TargetThumb
                                card={line.card}
                                width={LINE_THUMB_W}
                            />
                        ) : (
                            <span
                                aria-hidden
                                className="flex h-[36px] w-[26px] shrink-0 items-center justify-center rounded bg-white/10 text-[10px] font-bold text-text"
                            >
                                {line.title.slice(0, 1)}
                            </span>
                        )}
                        <span className="flex min-w-0 flex-col leading-tight">
                            <span className="flex items-center gap-1 text-[11px] font-medium text-text">
                                <Crosshair
                                    aria-hidden
                                    className="size-[11px] shrink-0 text-accent-strong"
                                />
                                <span className="truncate">{line.title}</span>
                            </span>
                            <span className="text-[10px] text-text-muted">
                                {line.where}
                            </span>
                        </span>
                    </span>
                ))}
        </span>
    );
}
