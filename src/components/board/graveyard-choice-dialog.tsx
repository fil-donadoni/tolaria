import type { EligibleGraveyard } from "~/lib/graveyard-targets";

/** Graveyard-choice step of the graveyard target dialog (issue #314). Shown
 *  only when more than one graveyard is eligible (`controller: "any"` and both
 *  graveyards contain ≥1 legal card). Each option labels the owner ("My
 *  graveyard" / "Opponent's graveyard") and the count of legal cards; picking
 *  one advances to the card picker for that graveyard. Buttons disable while a
 *  mutation is in flight. */
export default function GraveyardChoiceDialog({
    graveyards,
    isPending,
    onSelect,
}: {
    graveyards: EligibleGraveyard[];
    isPending: boolean;
    onSelect: (playerId: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1.5 mt-2">
            {graveyards.map((gy) => (
                <button
                    key={gy.playerId}
                    type="button"
                    disabled={isPending}
                    onClick={() => onSelect(gy.playerId)}
                    className="flex items-center justify-between rounded-sm px-3 py-2.5 text-left hover:bg-white/5 border border-transparent hover:border-zinc-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                    <span className="font-beleren text-sm tracking-wide text-zinc-100">
                        {gy.isMine ? "My graveyard" : "Opponent's graveyard"}
                    </span>
                    <span className="text-xs text-zinc-500">
                        {gy.cards.length}{" "}
                        {gy.cards.length === 1 ? "card" : "cards"}
                    </span>
                </button>
            ))}
        </div>
    );
}
