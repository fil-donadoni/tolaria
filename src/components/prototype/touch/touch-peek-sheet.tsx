// PROTOTYPE — throwaway. The peek panel: non-modal strip for the selected
// card with the 44px CTA row (D16: the PRIMARY move path on touch). Portrait =
// bottom sheet; landscape = right rail.
import { getImageUrl } from "~/lib/images";
import type { ProtoCard } from "./mock-pool";

export interface PeekAction {
    label: string;
    primary?: boolean;
    onClick: () => void;
}

export default function TouchPeekSheet({
    card,
    subtitle,
    actions,
    landscape,
    onClose,
}: {
    card: ProtoCard;
    subtitle: string;
    actions: PeekAction[];
    landscape: boolean;
    onClose: () => void;
}) {
    const btn = (a: PeekAction) => (
        <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={`min-h-11 rounded-full border px-3 font-beleren text-[13px] tracking-wide ${a.primary ? "border-accent bg-accent text-surface-base" : "border-accent/50 bg-surface-elevated text-accent-strong"}`}
        >
            {a.label}
        </button>
    );
    if (landscape) {
        return (
            <aside className="flex w-[224px] shrink-0 flex-col gap-2 border-l border-accent bg-surface p-2.5">
                <div className="flex items-start gap-2">
                    <img
                        src={getImageUrl(card.cardId)}
                        alt=""
                        draggable={false}
                        className="w-[52px] rounded-[6%]"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-beleren text-[13px] text-parchment">
                            {card.name}
                        </div>
                        <div className="text-[11px] text-text-muted">
                            {subtitle}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="h-9 w-9 text-text-muted"
                    >
                        ×
                    </button>
                </div>
                <div className="flex flex-col gap-1.5">{actions.map(btn)}</div>
            </aside>
        );
    }
    return (
        <div className="shrink-0 border-t border-accent bg-surface px-3 pt-2.5 pb-2">
            <div className="flex items-center gap-2.5">
                <img
                    src={getImageUrl(card.cardId)}
                    alt=""
                    draggable={false}
                    className="w-10 rounded-[6%]"
                />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-beleren text-[15px] text-parchment">
                        {card.name}
                    </div>
                    <div className="text-[11px] text-text-muted">
                        {subtitle}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="h-10 w-10 text-lg text-text-muted"
                >
                    ×
                </button>
            </div>
            <div
                className="mt-2 grid gap-2"
                style={{
                    gridTemplateColumns: `repeat(${actions.length}, minmax(0,1fr))`,
                }}
            >
                {actions.map(btn)}
            </div>
        </div>
    );
}
