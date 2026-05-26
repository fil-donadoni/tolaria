import { Menu } from "lucide-react";

export default function PauseMenuButton({ onOpen }: { onOpen: () => void }) {
    return (
        <button
            onClick={onOpen}
            aria-label="Open game menu"
            className="bg-zinc-800/40 hover:bg-zinc-700/40 border border-zinc-600/45 text-zinc-300 hover:text-zinc-100 p-2 rounded-sm transition-colors shadow-md cursor-pointer"
        >
            <Menu className="w-4 h-4" />
        </button>
    );
}
