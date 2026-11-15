import { Menu } from "lucide-react";
import { HotkeyTooltip } from "~/components/ui/hotkey-tooltip";
import { HOTKEYS } from "~/lib/hotkeys";

/** The pod's game-menu button — icon-only, so its Escape keycap rides in its
 *  tooltip (issue #9833). */
export default function PauseMenuButton({ onOpen }: { onOpen: () => void }) {
    return (
        <HotkeyTooltip
            label="Game menu"
            hotkey={HOTKEYS.pauseMenu}
            trigger={
                <button
                    onClick={onOpen}
                    aria-label="Open game menu"
                    className="bg-surface-elevated hover:bg-surface-elevated border border-border-accent/40 text-text-muted hover:text-text p-2 rounded-sm transition-colors shadow-md cursor-pointer"
                >
                    <Menu className="w-4 h-4" />
                </button>
            }
        />
    );
}
