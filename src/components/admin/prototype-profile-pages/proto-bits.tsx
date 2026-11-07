// PROTOTYPE — throwaway. Small shared presentational bits (several in one
// file on purpose: this never ships, and the variants need to be judged
// against each other, not the bits).
import CardImage from "~/components/cards/card-image";
import ManaSymbol from "~/components/cards/mana-symbol";
import type { Color } from "@convex/cards/types";
import {
    COLOR_SWATCH,
    STATUS_LABEL,
    WUBRG,
    type ProfileStatus,
} from "./proto-data";

export function StatusBadge({ status }: { status: ProfileStatus }) {
    const tone =
        status === "reviewed"
            ? "bg-success-soft text-success-strong"
            : status === "proposed"
              ? "bg-danger-strong/15 text-danger-strong"
              : status === "override"
                ? "bg-accent/20 text-accent-strong"
                : "bg-surface-elevated/60 text-text-muted";
    return (
        <span
            className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[10px] font-medium tracking-wide uppercase ${tone}`}
        >
            {STATUS_LABEL[status]}
        </span>
    );
}

export function ManaCost({ symbols }: { symbols: string[] }) {
    if (symbols.length === 0)
        return <span className="text-text-disabled">—</span>;
    return (
        <span className="inline-flex items-center gap-px">
            {symbols.map((s, i) => (
                <ManaSymbol key={i} symbol={s} className="size-3.5" />
            ))}
        </span>
    );
}

export function ColourBar({
    signature,
    height = "h-1.5",
}: {
    signature: Record<Color, number>;
    height?: string;
}) {
    const total = WUBRG.reduce((s, c) => s + signature[c], 0);
    if (total === 0)
        return (
            <div
                className={`${height} w-full rounded-full bg-surface-elevated/60`}
            />
        );
    return (
        <div
            className={`flex ${height} w-full overflow-hidden rounded-full bg-surface-elevated/60`}
            title={WUBRG.map(
                (c) => `${c} ${Math.round(signature[c] * 100)}%`
            ).join(" · ")}
        >
            {WUBRG.map((c) =>
                signature[c] > 0 ? (
                    <div
                        key={c}
                        style={{
                            width: `${(signature[c] / total) * 100}%`,
                            background: COLOR_SWATCH[c],
                        }}
                    />
                ) : null
            )}
        </div>
    );
}

export function ColourPips({ colors }: { colors: Color[] }) {
    if (colors.length === 0)
        return (
            <span className="size-2.5 rounded-full border border-border-subtle/60" />
        );
    return (
        <span className="inline-flex gap-0.5">
            {colors.map((c) => (
                <span
                    key={c}
                    className="size-2.5 rounded-full"
                    style={{ background: COLOR_SWATCH[c] }}
                />
            ))}
        </span>
    );
}

export function Chip({
    label,
    on,
    onClick,
    title,
    tone = "neutral",
}: {
    label: string;
    on: boolean;
    onClick?: () => void;
    title?: string;
    tone?: "neutral" | "provides" | "requires";
}) {
    const onTone =
        tone === "provides"
            ? "border-success-strong/60 bg-success-soft text-success-strong"
            : tone === "requires"
              ? "border-secondary-accent-strong/60 bg-secondary-accent-strong/15 text-secondary-accent-strong"
              : "border-accent-strong/60 bg-accent/25 text-parchment";
    return (
        <button
            type="button"
            title={title}
            aria-pressed={on}
            onClick={onClick}
            className={
                "rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition " +
                (on
                    ? onTone
                    : "border-border-subtle/40 bg-transparent text-text-muted hover:border-border-subtle hover:text-text")
            }
        >
            {label}
        </button>
    );
}

export function ArtTile({
    cardId,
    name,
    width = "w-full",
    sizes = "160px",
    children,
}: {
    cardId: string;
    name: string;
    width?: string;
    sizes?: string;
    children?: React.ReactNode;
}) {
    return (
        <div
            className={`relative aspect-5/7 ${width} overflow-hidden rounded-md`}
            title={name}
        >
            <CardImage card={{ id: cardId }} lazy sizes={sizes} />
            {children}
        </div>
    );
}

export function RatingDots({ rating }: { rating: number | null }) {
    if (rating === null)
        return <span className="text-text-disabled">unrated</span>;
    return (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-parchment">
            {rating.toFixed(1)}
            <span className="inline-flex gap-px">
                {[1, 2, 3, 4, 5].map((n) => (
                    <span
                        key={n}
                        className={
                            "h-2 w-1.5 rounded-xs " +
                            (rating >= n
                                ? "bg-accent-strong"
                                : rating >= n - 0.5
                                  ? "bg-accent-strong/50"
                                  : "bg-surface-elevated")
                        }
                    />
                ))}
            </span>
        </span>
    );
}
