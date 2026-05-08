import { Menu } from "lucide-react";

export default function PauseMenuButton({ onOpen }: { onOpen: () => void }) {
    return (
        <button
            onClick={onOpen}
            aria-label="Open game menu"
            className="bg-black/60 hover:bg-black/80 text-white/80 p-2 rounded-lg text-sm transition-colors shadow-lg"
        >
            <Menu className="w-4 h-4" />
        </button>
    );
}
