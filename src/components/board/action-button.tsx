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
    primary: "btn-tone-primary",
    secondary: "btn-tone-secondary",
    destructive: "btn-tone-destructive",
    ghost: "btn-tone-ghost",
};

const DISABLED_CLASS = "btn-disabled";

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
            className={`btn-base px-5 py-2 text-sm ${toneClass} ${disabled ? "" : "cursor-pointer"}`}
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
