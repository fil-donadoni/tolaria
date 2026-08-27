import type { EligibleGraveyard } from "~/lib/graveyard-targets";
import { cn } from "@/lib/utils";

/** Persistent graveyard switcher for the graveyard target dialog (issue #314).
 *  Shown whenever more than one graveyard is eligible (`controller: "any"` and
 *  both graveyards hold ≥1 legal card). Unlike a one-shot choice screen, the tab
 *  strip stays visible above the card picker so the chooser can switch
 *  graveyards at any time without cancelling the spell (Arena parity). The
 *  active tab is highlighted; each labels the owner and its legal-card count.
 *  Buttons disable while a mutation is in flight. */
export default function GraveyardTabs({
    graveyards,
    activeId,
    onSelect,
    isPending,
}: {
    graveyards: EligibleGraveyard[];
    activeId: string;
    onSelect: (playerId: string) => void;
    isPending: boolean;
}) {
    return (
        <div
            role="tablist"
            className="flex gap-1 border-b border-border-subtle"
        >
            {graveyards.map((gy) => {
                const active = gy.playerId === activeId;
                return (
                    <button
                        key={gy.playerId}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        disabled={isPending}
                        onClick={() => onSelect(gy.playerId)}
                        className={cn(
                            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-display text-sm tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
                            active
                                ? "border-border-accent text-text"
                                : "border-transparent text-text-muted hover:text-text"
                        )}
                    >
                        {gy.isMine ? "My graveyard" : "Opponent's graveyard"}
                        <span className="text-xs text-text-disabled">
                            {gy.cards.length}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
