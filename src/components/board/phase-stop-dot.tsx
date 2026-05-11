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
    // WCAG 2.5.8 requires a 24×24 hit area. The dot visually stays 6×6 so the
    // tracker keeps its compact vertical density; the button expands its
    // interactive surface with padding and collapses the surplus via negative
    // margin so surrounding layout (gap-1 between dot and label) is unchanged.
    return (
        <Tooltip>
            <TooltipTrigger
                render={<button type="button" />}
                onClick={onClick}
                aria-label={ariaLabel}
                aria-pressed={active}
                className="group grid place-items-center h-6 w-6 -m-[9px] shrink-0 cursor-pointer"
            >
                <span
                    className={`block h-1.5 w-1.5 rounded-full border transition-colors ${
                        active
                            ? "bg-transparent border-white"
                            : "bg-transparent border-white/15 group-hover:border-white/40"
                    }`}
                />
            </TooltipTrigger>
            <TooltipContent side="right">{tooltip}</TooltipContent>
        </Tooltip>
    );
}
