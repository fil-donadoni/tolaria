// PROTOTYPE — throwaway. An art-backed card: a static lobby image OR one or
// two decks' featured art (split = "my deck vs theirs"), a dark gradient,
// chip / title / line at the foot.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import FeaturedDeckArt from "../featured-deck-art";

export type ArtSource =
    | { image: string }
    | { cards: (string | null)[] };

export default function ProtoArtCard({
    art,
    chip,
    title,
    line,
    meta,
    onClick,
    className,
    titleClass = "text-2xl",
    children,
}: {
    art: ArtSource;
    chip?: string;
    title: string;
    line?: string;
    /** Small uppercase line UNDER the title (the chip sits above it). */
    meta?: string;
    onClick?: () => void;
    className?: string;
    titleClass?: string;
    children?: ReactNode;
}) {
    return (
        <div
            role={onClick ? "button" : undefined}
            onClick={onClick}
            className={cn(
                "group relative isolate flex flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-border-strong text-left transition",
                onClick && "cursor-pointer hover:border-accent/60",
                className
            )}
        >
            <div className="absolute inset-0 -z-10 flex">
                {"image" in art ? (
                    <img
                        src={art.image}
                        alt=""
                        className="h-full w-full object-cover object-[50%_30%] opacity-85 transition group-hover:opacity-100"
                    />
                ) : art.cards.length === 2 ? (
                    <>
                        {/* Diagonal split: each art clipped to its side of
                            a slanted cut, a white rule drawn along it. */}
                        <FeaturedDeckArt
                            featuredCardId={art.cards[0]}
                            className="absolute inset-0 h-full w-full [clip-path:polygon(0_0,58%_0,42%_100%,0_100%)]"
                        />
                        <FeaturedDeckArt
                            featuredCardId={art.cards[1]}
                            className="absolute inset-0 h-full w-full [clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]"
                        />
                    </>
                ) : (
                    <FeaturedDeckArt
                        featuredCardId={art.cards[0]}
                        className="h-full w-full"
                    />
                )}
            </div>
            <span
                aria-hidden
                className="absolute inset-0 -z-10"
                style={{
                    background:
                        "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.88) 100%)",
                }}
            />
            {"cards" in art && art.cards.length === 2 && (
                <svg
                            aria-hidden
                            className="absolute inset-0 -z-10 h-full w-full"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                        >
                            <line
                                x1="58"
                                y1="0"
                                x2="42"
                                y2="100"
                                stroke="white"
                                strokeWidth="3"
                                vectorEffect="non-scaling-stroke"
                            />
                        </svg>
            )}
            <div className="flex flex-col items-start gap-1.5 p-4">
                {chip && (
                    <span className="rounded-sm border border-[var(--hairline-strong)] bg-surface-base/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment">
                        {chip}
                    </span>
                )}
                <span
                    className={cn(
                        "font-display leading-none text-parchment drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]",
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
                {line && <span className="text-xs text-text-muted">{line}</span>}
                {children}
            </div>
        </div>
    );
}
