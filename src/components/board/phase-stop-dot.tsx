type PhaseStopDotProps = {
    active: boolean;
    onClick: () => void;
    label: string;
};

export default function PhaseStopDot({
    active,
    onClick,
    label,
}: PhaseStopDotProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={`h-1.5 w-1.5 rounded-full border transition-colors shrink-0 cursor-pointer ${
                active
                    ? "bg-transparent border-white hover:border-white"
                    : "bg-transparent border-white/15 hover:border-white/40"
            }`}
        />
    );
}
