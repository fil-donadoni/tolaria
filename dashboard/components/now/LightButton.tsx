import { cn } from "@/lib/utils";
import { toneRuleClass, toneTextClass } from "../../lib/tones";
import { FOCUS_RING } from "../../lib/controls";
import { lightGlyph, type Light } from "../../lib/nowLights";
import { jumpToSection } from "../../lib/sections";

/**
 * One traffic light (#2630, ported in PRD #3148 S2): a colour, one number and
 * one line of prose. Clicking it scrolls to its detail section and marks it.
 *
 * A `<button>`, not a `<div>`: the click target is keyboard-reachable and
 * announced as an action, which is what makes "clicking a light scrolls to its
 * section" usable without a mouse.
 *
 * COLOUR IS NEVER THE ONLY CARRIER (#2630 AC). Three channels ship together:
 * the hue, the WORD (`ALIVE` / `UNAVAILABLE` / `ORPHANED`), and a shape-based
 * glyph (`● ▲ ■ ?`) for a reader who sees neither hue nor prose weight.
 *
 * The light's own `ⓘ` is deliberately absent here, unlike the vanilla markup
 * that smuggled one in with `tabindex="-1"`: interactive content is not
 * permitted inside a `<button>`, and a tooltip trigger inside the click target
 * is interactive content. The same `section.<id>` explanation sits on the
 * detail section this light jumps to — one explanation per subsystem, reachable
 * from the thing the light points at.
 */
export function LightButton({ light }: { light: Light }) {
    return (
        <button
            type="button"
            data-light={light.id}
            title={light.title}
            onClick={() => jumpToSection(light.target)}
            className={cn(
                "bg-card flex flex-col gap-1.5 rounded-lg border border-l-2 p-3 text-left transition-colors hover:bg-muted/50",
                toneRuleClass(light.tone),
                FOCUS_RING
            )}
        >
            <span className="flex items-center gap-1.5 text-xs">
                <span aria-hidden="true" className={toneTextClass(light.tone)}>
                    {lightGlyph(light.tone)}
                </span>
                <span className="font-medium">{light.label}</span>
                <span
                    className={cn(
                        "ml-auto font-semibold",
                        toneTextClass(light.tone)
                    )}
                >
                    {light.word}
                </span>
            </span>
            <span className="flex items-baseline gap-1.5">
                <span className="text-2xl leading-none font-semibold tabular-nums">
                    {light.number}
                </span>
                <span className="text-muted-foreground text-xs">
                    {light.numberLabel}
                </span>
            </span>
            <span className="text-muted-foreground text-xs">{light.prose}</span>
        </button>
    );
}
