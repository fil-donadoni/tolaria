import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";

interface CardProfilesInfoTipProps {
    label: string;
    children: string;
}

/** A small "?" that explains a number or a term on hover or focus. */
export default function CardProfilesInfoTip({
    label,
    children,
}: CardProfilesInfoTipProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                type="button"
                aria-label={label}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-subtle text-[10px] text-text-muted hover:text-text"
            >
                ?
            </TooltipTrigger>
            <TooltipContent>{children}</TooltipContent>
        </Tooltip>
    );
}
