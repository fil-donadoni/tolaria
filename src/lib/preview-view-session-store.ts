// The viewer's LAST chosen card-preview mode (Live text / Printed / Rulings)
// for the Sideboarding window (issue #9820) — beside `preview-preference-store`,
// which holds the saved Settings default this one falls back to.
//
// Session-scoped on purpose: one module-level value, alive for the page's
// lifetime. Choosing Printed on one card keeps Printed on the next card AND on
// the next between-games window; a reload starts again from the Settings
// default. Nothing renders from it live — a host seeds its own state from
// `getSessionPreviewView()` and writes every change back
// (`useSessionPreviewView`).
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";
import { getPreviewPreferenceDefault } from "./preview-preference-store";

let last: CardPreviewView | null = null;

/** The last mode chosen this session, else the saved Settings default. */
export function getSessionPreviewView(): CardPreviewView {
    return last ?? getPreviewPreferenceDefault();
}

export function setSessionPreviewView(view: CardPreviewView): void {
    last = view;
}

// Test-only reset: module state outlives `cleanup()` between test files.
export function resetSessionPreviewViewForTests(): void {
    last = null;
}
