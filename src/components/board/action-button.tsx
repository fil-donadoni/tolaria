import { CornerDownLeft, Space } from "lucide-react";

type ActionButtonTone = "primary" | "secondary" | "destructive" | "ghost";

function ShortcutHint({ shortcut }: { shortcut: string }) {
    const key = shortcut.toLowerCase();
    if (key === "space") {
        return <Space className="w-3.5 h-3.5 opacity-70" aria-label="Space" />;
    }
    if (key === "enter") {
        return (
            <CornerDownLeft
                className="w-3.5 h-3.5 opacity-70"
                aria-label="Enter"
            />
        );
    }
    return <span className="text-xs opacity-70">[{shortcut}]</span>;
}

const TONE_CLASSES: Record<ActionButtonTone, string> = {
    primary:
        "bg-accent-soft/30 border-accent/45 text-accent-strong hover:bg-accent-soft/50 active:bg-accent-soft/65",
    secondary:
        "bg-secondary-accent-soft/30 border-secondary-accent/45 text-secondary-accent-strong hover:bg-secondary-accent-soft/50 active:bg-secondary-accent-soft/65",
    destructive:
        "bg-danger-soft/45 border-danger/45 text-danger-strong hover:bg-danger-soft/65 active:bg-danger-soft/80",
    ghost: "bg-transparent border-transparent text-text-muted hover:text-parchment active:text-parchment shadow-none",
};

const DISABLED_CLASS =
    "bg-surface/40 border-border-subtle/40 text-text-disabled cursor-not-allowed";

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
            <span className="inline-flex items-center gap-2">
                {label}
                {shortcut && (
                    <span className="hidden md:inline-flex items-center">
                        <ShortcutHint shortcut={shortcut} />
                    </span>
                )}
            </span>
        </button>
    );
}
