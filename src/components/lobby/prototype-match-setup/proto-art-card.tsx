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
    onClick,
    className,
    titleClass = "text-2xl",
    children,
}: {
    art: ArtSource;
    chip?: string;
    title: string;
    line?: string;
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
                ) : (
                    art.cards.map((c, i) => (
                        <FeaturedDeckArt
                            key={i}
                            featuredCardId={c}
                            className="h-full flex-1"
                        />
                    ))
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
                <span className="absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 font-display text-3xl text-parchment drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
                    vs
                </span>
            )}
            <div className="flex flex-col items-start gap-1 p-4">
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
                {line && <span className="text-xs text-text-muted">{line}</span>}
                {children}
            </div>
        </div>
    );
}
