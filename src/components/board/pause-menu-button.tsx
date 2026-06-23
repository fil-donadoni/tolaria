import { Menu } from "lucide-react";

export default function PauseMenuButton({ onOpen }: { onOpen: () => void }) {
    return (
        <button
            onClick={onOpen}
            aria-label="Open game menu"
            className="bg-surface-elevated hover:bg-surface-elevated border border-border-accent/40 text-text-muted hover:text-text p-2 rounded-sm transition-colors shadow-md cursor-pointer"
        >
            <Menu className="w-4 h-4" />
        </button>
    );
}
