// One art-backed tile of the lobby home (PRD #5334, issue #5344): a local
// lobby frame, one deck's featured art, or two decks' art split by a white
// diagonal (Last Match: my deck vs theirs), under a dark foot gradient that
// carries the chip, the title and the lines.
//
// With `onClick` the whole tile is ONE button and its accessible name is its
// visible text; without it the tile is a frame whose `children` hold the
// controls (Last Match's Play again / change setup) — never a button nested
// in a button.
//
// The art is `aria-hidden` decoration, so the ui-gate card probe excludes it
// (`scripts/ui-gate/probe.js` `isDecorativeArt`) instead of scoring a
// background as a card.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { HomeArt } from "~/lib/lobbyHome";
import HomeArtLayer from "./home-art-layer";

interface HomeArtCardProps {
    art: HomeArt;
    title: string;
    /** Small uppercase badge above the title. */
    chip?: string;
    /** Small uppercase line under the title. */
    meta?: string;
    /** Muted supporting line. */
    line?: string;
    titleClass?: string;
    className?: string;
    onClick?: () => void;
    children?: ReactNode;
    /** Walk/test seam on the tile's root. */
    seam?: Record<`data-${string}`, string>;
}

export default function HomeArtCard({
    art,
    title,
    chip,
    meta,
    line,
    titleClass = "text-2xl",
    className,
    onClick,
    children,
    seam,
}: HomeArtCardProps) {
    const body = (
        <>
            <span aria-hidden className="absolute inset-0 -z-10 flex">
                <HomeArtLayer art={art} />
            </span>
            <span
                aria-hidden
                className="absolute inset-0 -z-10"
                style={{
                    background:
                        "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.88) 100%)",
                }}
            />
            <span className="flex w-full flex-col items-start gap-1.5 p-4">
                {chip && (
                    <span className="rounded-sm border border-[var(--hairline-strong)] bg-surface-base/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment">
                        {chip}
                    </span>
                )}
                <span
                    className={cn(
                        "text-display leading-none text-parchment drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]",
                        titleClass
                    )}
                >
                    {title}
                </span>
                {meta && (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment/85">
                        {meta}
                    </span>
                )}
                {line && (
                    <span className="text-xs text-text-muted">{line}</span>
                )}
                {children}
            </span>
        </>
    );
    // Same resting edge as the retired Mode Tiles and the Deck Shelf tiles:
    // over the dark foot the art supplies no boundary, so the border is the
    // tile's only bound (`deck-shelf-tile.tsx`).
    const frame = cn(
        "group relative isolate flex flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-border-strong text-left transition",
        className
    );
    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    frame,
                    "hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                )}
                {...seam}
            >
                {body}
            </button>
        );
    }
    return (
        <div className={frame} {...seam}>
            {body}
        </div>
    );
}
