type ActionButtonTone = "primary" | "secondary" | "destructive";

const TONE_CLASSES: Record<ActionButtonTone, string> = {
    primary:
        "bg-[#7a5a2e]/30 border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50",
    secondary:
        "bg-zinc-800/40 border-zinc-600/45 text-zinc-300 hover:bg-zinc-700/40",
    destructive:
        "bg-[#5c1e1e]/45 border-[#a04040]/45 text-[#d48080] hover:bg-[#5c1e1e]/65",
};

const DISABLED_CLASS =
    "bg-zinc-900/40 border-zinc-700/40 text-zinc-500 cursor-not-allowed";

export default function ActionButton({
    onClick,
    label,
    tone = "primary",
    disabled = false,
    shortcut,
}: {
    onClick: () => void;
    label: string;
    tone?: ActionButtonTone;
    disabled?: boolean;
    shortcut?: string;
}) {
    const toneClass = disabled ? DISABLED_CLASS : TONE_CLASSES[tone];
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`font-beleren tracking-wide px-5 py-2 rounded-sm text-sm border transition-colors shadow-md ${toneClass} ${disabled ? "" : "cursor-pointer"}`}
        >
            {label}
            {shortcut && (
                <span className="ml-2 text-xs opacity-70 hidden md:inline">
                    [{shortcut}]
                </span>
            )}
        </button>
    );
}
