// Only one hover card-preview may be open at a time, app-wide. Each card mounts
// its own autonomous CardPreview with local state, so adjacent hand cards under
// the 3D tilt can both pass their hover gate before either closes — without a
// shared owner the two zoom portals stack on screen. This registry holds the
// close handle of the single active preview: opening a new one closes the
// previous, and a preview only releases the slot if it still owns it.
//
// Each `close` function is used as its own identity token, so a preview never
// nulls the slot after another preview has already taken ownership.
let activeClose: (() => void) | null = null;

// Open `close`'s preview as the single active one. If a different preview is
// open, close it first. Idempotent for the already-active preview.
export function requestOpenPreview(close: () => void): void {
    if (activeClose && activeClose !== close) {
        activeClose();
    }
    activeClose = close;
}

// Release the active slot, but only if `close` still owns it. A no-op once
// another preview has taken over (its open already closed this one).
export function releasePreview(close: () => void): void {
    if (activeClose === close) {
        activeClose = null;
    }
}

// Test-only: drop any active preview without invoking its close handle.
export function resetPreviewSingleton(): void {
    activeClose = null;
}
