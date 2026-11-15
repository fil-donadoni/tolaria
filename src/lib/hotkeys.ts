/**
 * The app's hotkey DECLARATIONS (issue #9833): one row per binding, read by
 * every place a hotkey shows up —
 *
 * - the window `keydown` handlers, through {@link matchesHotkey} (the key a
 *   handler reacts to IS the declared key);
 * - the `Keycap` primitive (`ui/keycap.tsx`), next to a control's label or
 *   inside an icon-only control's tooltip;
 * - `aria-keyshortcuts`, through {@link ariaKeyShortcuts};
 * - the board's hotkeys legend, through {@link hotkeysForScope}.
 *
 * Before this table the legend was a second, hand-written list beside the
 * bindings in the hooks, and the controller's `shortcut` field a third: a new
 * binding could be missing from the legend, and the legend could list a key
 * that no longer worked. A row here is the one place a binding is named.
 *
 * Pure data — no React, no DOM beyond the `KeyboardEvent` shape the matcher
 * reads. Admission guards (typing target, auto-repeat, modifiers, open
 * dialog) stay with each handler: they differ per binding by design.
 */

/** A key a hotkey is pressed with. Letters are upper-case; `"Mod"` is ⌘ on a
 *  Mac and Ctrl elsewhere. */
export type HotkeyKey =
    | "Space"
    | "Enter"
    | "Escape"
    | "Mod"
    | "`"
    | "A"
    | "C"
    | "P"
    | "S"
    | "U";

/** A pointer gesture a hotkey is completed with (`Mod` + click). Drawn as a
 *  keycap in the legend, but never part of `aria-keyshortcuts`, which only
 *  names keys. */
export type HotkeyGesture = "click" | "scroll";

/** Which surface a binding is live on — the legend lists one scope. */
export type HotkeyScope = "board" | "manual" | "draft" | "debug";

export interface Hotkey {
    /** Pressed together, in order: `["Mod", "click"]`. */
    readonly keys: readonly (HotkeyKey | HotkeyGesture)[];
    /** What the binding does, in the legend's words. */
    readonly label: string;
    readonly scopes: readonly HotkeyScope[];
}

/** Every declared binding. Order is the legend's order within a scope. */
export const HOTKEYS = {
    // GRE board — `useControllerActions`, `usePromptCollapseHotkey`,
    // `usePauseMenuHotkey`, `useTargetingCancelGestures`.
    passPriority: {
        keys: ["Space"],
        label: "Pass priority / confirm",
        scopes: ["board"],
    },
    passUntilAction: {
        keys: ["Enter"],
        label: "Pass until opponent acts",
        scopes: ["board"],
    },
    passTurn: { keys: ["P"], label: "Pass turn", scopes: ["board"] },
    autoTap: {
        keys: ["A"],
        label: "Auto-tap while paying a cost",
        scopes: ["board"],
    },
    undo: { keys: ["U"], label: "Undo / cancel cast", scopes: ["board"] },
    collapsePrompt: {
        keys: ["C"],
        label: "Collapse / expand the open prompt",
        scopes: ["board"],
    },
    keepPriority: {
        keys: ["Mod", "click"],
        label: "Keep priority after casting",
        scopes: ["board"],
    },
    cancel: {
        keys: ["Escape"],
        label: "Cancel a payment or a target choice",
        scopes: ["board"],
    },
    pauseMenu: {
        keys: ["Escape"],
        label: "Open the game menu",
        scopes: ["board", "manual"],
    },
    // Manual Board — `useManualHotkeys`, `useManualSeatSwitchHotkey`.
    manualNextPhase: {
        keys: ["Space"],
        label: "Next phase",
        scopes: ["manual"],
    },
    manualEndTurn: { keys: ["Enter"], label: "End turn", scopes: ["manual"] },
    manualSwitchSeat: {
        keys: ["S"],
        label: "Switch seat (solo game)",
        scopes: ["manual"],
    },
    // Draft Room — `useDraftKeyboardPicks`, `useDraftStartNowHotkey`.
    draftPick: {
        keys: ["Enter"],
        label: "Pick the selected card",
        scopes: ["draft"],
    },
    draftPickToSideboard: {
        keys: ["S"],
        label: "Pick the selected card to the sideboard",
        scopes: ["draft"],
    },
    draftStartNow: {
        keys: ["Space"],
        label: "Start the draft now",
        scopes: ["draft"],
    },
    draftResizePack: {
        keys: ["Mod", "scroll"],
        label: "Resize the whole pack",
        scopes: ["draft"],
    },
    // Tester debug sheet — `DebugSheetProvider`.
    toggleDebugSheet: {
        keys: ["`"],
        label: "Toggle the debug sheet",
        scopes: ["debug"],
    },
} as const satisfies Record<string, Hotkey>;

export type HotkeyId = keyof typeof HOTKEYS;

/** The bindings live on one surface, in declaration order — what the hotkeys
 *  legend renders. `registry` is a parameter so a test can prove a row added
 *  to the table reaches the legend. */
export function hotkeysForScope(
    scope: HotkeyScope,
    registry: Readonly<Record<string, Hotkey>> = HOTKEYS
): Hotkey[] {
    return Object.values(registry).filter((h) => h.scopes.includes(scope));
}

const GESTURES: readonly string[] = ["click", "scroll"];

function isGesture(key: string): key is HotkeyGesture {
    return GESTURES.includes(key);
}

/** Does this keystroke press the hotkey's (single, non-modifier) key?
 *
 *  Space and Enter accept either `key` or `code`: the handlers this replaced
 *  read one or the other (`e.code === "Space"` in the controller,
 *  `e.key === " "` on the Manual Board), and both name the same key on every
 *  layout this app runs on. Letters match case-insensitively. A chord or a
 *  gesture (`Mod` + click) never matches a bare keystroke — its handler reads
 *  the pointer event. Guards (repeat, modifiers, typing target) are the
 *  caller's. */
export function matchesHotkey(
    event: Pick<KeyboardEvent, "key" | "code">,
    hotkey: Hotkey
): boolean {
    if (hotkey.keys.length !== 1) return false;
    const key = hotkey.keys[0];
    switch (key) {
        case "Space":
            return event.code === "Space" || event.key === " ";
        case "Enter":
            return event.key === "Enter" || event.code === "Enter";
        case "Escape":
            return event.key === "Escape";
        case "Mod":
        case "click":
        case "scroll":
            return false;
        default:
            // `key` can be absent on a synthetic keydown (Chrome autofill).
            return event.key?.toUpperCase() === key;
    }
}

/** `aria-keyshortcuts` for a hotkey (WAI-ARIA 1.2 § 6.7), or `undefined` when
 *  it involves a pointer gesture the attribute cannot express. */
export function ariaKeyShortcuts(hotkey: Hotkey): string | undefined {
    if (hotkey.keys.some(isGesture)) return undefined;
    return hotkey.keys
        .map((key) =>
            key === "Mod" ? (isMacPlatform() ? "Meta" : "Control") : key
        )
        .join("+");
}

/** ⌘ on Apple platforms, Ctrl elsewhere — what a `Mod` keycap reads. */
export function isMacPlatform(): boolean {
    return (
        typeof navigator !== "undefined" &&
        /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    );
}
