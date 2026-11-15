import { CornerDownLeft, Space } from "lucide-react";
import type { ReactNode } from "react";
import { isMacPlatform, type Hotkey, type HotkeyKey } from "~/lib/hotkeys";
import { cn } from "~/lib/utils";

/** What one key draws: Space and Enter as their glyphs, everything else as
 *  text. A plain function, not a component — it is the cap's content. */
function keyGlyph(key: Hotkey["keys"][number]): ReactNode {
    switch (key as HotkeyKey) {
        case "Space":
            return <Space className="size-3" aria-hidden />;
        case "Enter":
            return <CornerDownLeft className="size-3" aria-hidden />;
        case "Escape":
            return "Esc";
        case "Mod":
            return isMacPlatform() ? "⌘" : "Ctrl";
        default:
            return key;
    }
}

/** THE keycap (issue #9833): every hotkey the UI shows is drawn by this, from
 *  its declaration in `~/lib/hotkeys` — next to a control's label, inside an
 *  icon-only control's tooltip, and in the hotkeys legend. No other component
 *  draws a `<kbd>` or a `[X]` hint (`keycap-single-source.guard.test.ts`).
 *
 *  `aria-hidden`: the cap is a visual cue, never part of the control's
 *  accessible name ("Pass Turn [P]" broke every exact-name lookup, issue
 *  #9088) — the key reaches assistive tech through the control's
 *  `aria-keyshortcuts` (`ariaKeyShortcuts`). Hidden under a coarse pointer:
 *  a touch screen has no keyboard to press it on.
 *
 *  Each `<kbd>` carries `data-slot="kbd"`, the slot `TooltipContent` already
 *  styles, so a cap drops into a tooltip unchanged. */
export function Keycap({
    hotkey,
    className,
}: {
    hotkey: Hotkey;
    className?: string;
}) {
    return (
        <span
            aria-hidden
            data-slot="keycap"
            className={cn(
                "inline-flex shrink-0 items-center gap-1 pointer-coarse:hidden!",
                className
            )}
        >
            {hotkey.keys.map((key, i) => (
                <span key={key} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-text-disabled">+</span>}
                    <kbd
                        data-slot="kbd"
                        data-key={key}
                        className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm border border-[var(--hairline-strong)] bg-surface-elevated px-1 font-mono text-[10px] leading-none font-normal text-text normal-case tracking-normal"
                    >
                        {keyGlyph(key)}
                    </kbd>
                </span>
            ))}
        </span>
    );
}
