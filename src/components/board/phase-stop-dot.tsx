import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";

type PhaseStopDotProps = {
    active: boolean;
    onClick: () => void;
    ariaLabel: string;
    tooltip: React.ReactNode;
};

export default function PhaseStopDot({
    active,
    onClick,
    ariaLabel,
    tooltip,
}: PhaseStopDotProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={<button type="button" />}
                onClick={onClick}
                aria-label={ariaLabel}
                aria-pressed={active}
                className={`h-1.5 w-1.5 rounded-full border transition-colors shrink-0 cursor-pointer ${
                    active
                        ? "bg-transparent border-white hover:border-white"
                        : "bg-transparent border-white/15 hover:border-white/40"
                }`}
            />
            <TooltipContent side="right">{tooltip}</TooltipContent>
        </Tooltip>
    );
}
