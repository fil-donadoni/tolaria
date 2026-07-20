import { CornerDownLeft, Space } from "lucide-react";
import { Button } from "@/components/ui/button";

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

/** Board action button — thin domain wrapper over the unified ui/Button
 *  (phase-3): tone → variant, plus the keyboard-shortcut hint. */
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
    return (
        <Button
            variant={tone}
            disabled={disabled}
            onClick={onClick}
            className="px-5 py-2 text-sm"
        >
            <span className="inline-flex items-center gap-2">
                {label}
                {shortcut && (
                    <span className="hidden md:inline-flex items-center">
                        <ShortcutHint shortcut={shortcut} />
                    </span>
                )}
            </span>
        </Button>
    );
}
