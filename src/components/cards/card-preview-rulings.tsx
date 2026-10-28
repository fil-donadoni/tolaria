import { formatOracleText } from "~/lib/oracle-text";
import { scryfallCardPageUrl } from "~/lib/scryfallRulings";
import useCardRulings from "~/hooks/useCardRulings";

/** The `Rulings` view of the card preview (issue #4816, glossary **Ruling**).
 *  Mounted only while that mode is selected, so merely mounting it is the
 *  fetch trigger. Scrolls inside the preview's max height. */
export default function CardPreviewRulings({ printId }: { printId: string }) {
    const { state, retry } = useCardRulings(printId, true);
    return (
        <div
            data-testid="card-preview-rulings"
            className="mx-3 my-2 flex max-h-64 flex-col gap-2 overflow-y-auto text-xs text-parchment"
        >
            {state.status === "loading" && (
                <p className="text-text-muted">Loading rulings…</p>
            )}
            {state.status === "error" && (
                <div className="flex flex-col items-start gap-1">
                    <p className="text-text-muted">
                        Rulings unavailable — Scryfall didn't respond.
                    </p>
                    <button
                        type="button"
                        onClick={retry}
                        className="rounded-sm bg-accent-soft/50 px-2 py-0.5 text-[10px]"
                    >
                        Retry
                    </button>
                </div>
            )}
            {state.status === "loaded" && state.rulings.length === 0 && (
                <p className="text-text-muted">No rulings for this card.</p>
            )}
            {state.status === "loaded" &&
                state.rulings.map((r, i) => (
                    <div key={i} data-ruling-source={r.source}>
                        <div className="flex gap-2 text-[10px] text-text-muted">
                            <span
                                className={
                                    r.source === "wotc"
                                        ? "font-semibold"
                                        : "italic opacity-70"
                                }
                            >
                                {r.source === "wotc"
                                    ? "Wizards"
                                    : "Scryfall note"}
                            </span>
                            <span>{r.publishedAt}</span>
                        </div>
                        <p>{formatOracleText(r.comment)}</p>
                    </div>
                ))}
            <a
                href={scryfallCardPageUrl(printId)}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-accent underline"
            >
                View on Scryfall
            </a>
        </div>
    );
}
