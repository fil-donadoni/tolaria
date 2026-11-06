// One deck of an archived origin: name, owner, card counts and the derived
// legality verdict. Presentational — selection lives in
// `LimitedDeckArchivePanel`.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

export type LimitedArchiveDeckItem = FunctionReturnType<
    typeof api.userDecks.listLimitedOriginDecksAdmin
>["page"][number];

export default function LimitedArchiveDeckRow({
    deck,
    selected,
    onSelect,
}: {
    deck: LimitedArchiveDeckItem;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full flex-col gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors ${
                selected
                    ? "border-border-accent bg-surface-elevated/60"
                    : "border-border-subtle hover:border-border-accent/60"
            }`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold text-text">
                    {deck.name}
                </span>
                <span className="text-[10px] tracking-wide uppercase">
                    {deck.isLegal ? "legal" : "illegal"}
                </span>
            </div>
            <div className="text-xs text-text-muted">
                {deck.ownerNickname} · {deck.cardCount} cards
                {deck.sideboardCount > 0 && ` + ${deck.sideboardCount} side`}
            </div>
        </button>
    );
}
