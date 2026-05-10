import { Keyboard } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";

type HotkeyRow = { keys: string[]; label: string };

const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

const HOTKEYS: HotkeyRow[] = [
    { keys: ["Space"], label: "Pass priority / confirm" },
    { keys: ["Enter"], label: "Pass turn" },
    { keys: ["Z or right click"], label: "Zoom card" },
    { keys: ["U"], label: "Undo / cancel cast" },
    { keys: [modKey, "click"], label: "Keep priority after casting" },
    { keys: ["Esc"], label: "Concede" },
];

export default function HotkeysLegend() {
    return (
        <Popover>
            <PopoverTrigger
                className="bg-black/60 hover:bg-black/80 text-white/80 p-2 rounded-lg text-sm transition-colors shadow-lg hidden md:inline-flex"
                aria-label="Show hotkeys"
            >
                <Keyboard className="w-4 h-4" />
            </PopoverTrigger>
            <PopoverContent>
                <div className="font-semibold mb-2 text-white/90">Hotkeys</div>
                <div className="flex flex-col gap-1.5">
                    {HOTKEYS.map((row) => (
                        <div
                            key={row.label}
                            className="flex items-center gap-2"
                        >
                            <div className="flex gap-1">
                                {row.keys.map((k, i) => (
                                    <span key={i} className="inline-flex">
                                        {i > 0 && (
                                            <span className="text-white/40 mr-1">
                                                +
                                            </span>
                                        )}
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[10px] font-mono text-white/90">
                                            {k}
                                        </kbd>
                                    </span>
                                ))}
                            </div>
                            <span className="text-white/70">{row.label}</span>
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
