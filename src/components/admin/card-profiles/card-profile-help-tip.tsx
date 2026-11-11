import { CircleHelp } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";

export interface HelpTipHalf {
    /** The half's heading — `Tag when`, `Not`, `Provides`, `Requires`. */
    label: string;
    text: string;
    /** A real card for this half, by printed name, when the row names one. */
    example?: string;
}

interface CardProfileHelpTipProps {
    /** The catalogue row id — the trigger's accessible name names it. */
    rowId: string;
    first: HelpTipHalf;
    second: HelpTipHalf;
}

/** The `?` of one focus-dialog line (issue #8904): the row's FULL registry
 *  text, split in its two halves — TAG WHEN / NOT for an Archetype row,
 *  PROVIDES / REQUIRES for a Capability row — each with its example card.
 *  The one place the long text lives: the line itself shows only the gloss. */
export default function CardProfileHelpTip({
    rowId,
    first,
    second,
}: CardProfileHelpTipProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                aria-label={`What ${rowId} means`}
                className="inline-flex size-5 items-center justify-center rounded-sm text-text-muted hover:text-text"
            >
                <CircleHelp className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent
                side="left"
                className="max-w-md flex-col items-stretch gap-3 py-2"
            >
                {[first, second].map((half) =>
                    half.text === "" ? null : (
                        <div key={half.label} data-help-half={half.label}>
                            <span className="block font-semibold tracking-wide uppercase">
                                {half.label}
                            </span>
                            <p className="mt-0.5 text-xs leading-snug">
                                {half.text}
                            </p>
                            {half.example && (
                                <p className="mt-0.5 text-xs italic opacity-80">
                                    e.g. {half.example}
                                </p>
                            )}
                        </div>
                    )
                )}
            </TooltipContent>
        </Tooltip>
    );
}
