import { tryGetDefinition } from "@convex/cards";
import { manaCostToString } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { ART_CROP_RATIO, getArtCropImageUrl } from "~/lib/images";
import { sourceKindLabel } from "~/lib/random-reveal-flip";
import ControllerChip from "~/components/board/controller-chip";

/** The object a Random Reveal comes from, laid out like a stack row
 *  (`stack-row.tsx`): art crop with its kind badge, name, mana pips,
 *  controller chip, then the Oracle excerpt that flips the coin. */
export default function RandomRevealSourceRow({
    cardId,
    controllerName,
    controllerIsViewer,
    excerpt,
}: {
    cardId: string;
    controllerName: string;
    controllerIsViewer: boolean;
    excerpt?: string;
}) {
    const def = tryGetDefinition(cardId);
    return (
        <div
            data-testid="reveal-source-row"
            className="flex w-full gap-3 rounded-[var(--panel-radius)] border border-accent/50 bg-accent-soft/40 p-2 text-left"
        >
            <span className="relative block w-16 shrink-0 self-start">
                <span
                    className="relative block overflow-hidden card-corner"
                    style={{ aspectRatio: ART_CROP_RATIO }}
                >
                    <img
                        src={getArtCropImageUrl(cardId)}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                </span>
                <span
                    data-testid="reveal-source-kind"
                    className="mt-0.5 block rounded-sm bg-black/70 px-1 py-0.5 text-center text-[8px] font-semibold tracking-wider text-text uppercase"
                >
                    {sourceKindLabel(def?.types)}
                </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-display text-sm text-text">
                        {def?.name ?? cardId}
                    </span>
                    {def?.manaCost && (
                        <span className="text-[10px]">
                            {formatOracleText(manaCostToString(def.manaCost))}
                        </span>
                    )}
                    <ControllerChip
                        name={controllerName}
                        mine={controllerIsViewer}
                    />
                </span>
                {excerpt && (
                    <span
                        data-testid="reveal-source-excerpt"
                        className="text-[11px] leading-snug whitespace-pre-line text-text-muted"
                    >
                        {formatOracleText(excerpt)}
                    </span>
                )}
            </span>
        </div>
    );
}
