import { useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    cycleTheme,
    getTheme,
    subscribeToTheme,
    type Theme,
} from "../lib/theme";

const ICONS: Record<Theme, typeof SunIcon> = {
    light: SunIcon,
    dark: MoonIcon,
    system: MonitorIcon,
};

const LABELS: Record<Theme, string> = {
    light: "Theme: light",
    dark: "Theme: dark",
    system: "Theme: follow system",
};

/**
 * The theme toggle (PRD #3148 S1).
 *
 * THREE states, cycled: light → dark → system. "System" is a real answer and
 * not a synonym for light, so it gets its own rung and its own icon —
 * before the port it was reachable only by toggling twice and could not be
 * told apart from an explicit choice.
 *
 * The label is the state, not the action, because the action is a cycle: "make
 * it dark" would be a lie on two of the three presses.
 */
export function ThemeToggle() {
    const theme = useSyncExternalStore(subscribeToTheme, getTheme);
    const Icon = ICONS[theme];
    return (
        <Button
            id="theme"
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={cycleTheme}
            aria-label={LABELS[theme]}
            title={LABELS[theme]}
        >
            <Icon />
        </Button>
    );
}
