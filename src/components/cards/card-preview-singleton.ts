// Only one card-preview may be open at a time, app-wide. Each card mounts its
// own autonomous CardPreview with local state, so opening a preview on one card
// must close whatever preview another card left open. This registry holds the
// close handles of every currently-open preview: opening a new one closes ALL
// others, and a preview releases its own handle when it closes.
//
// Outside-click / Escape dismissal is NOT owned here anymore (the model moved
// from hover to click, #332 → Arena click model). Each open CardPreview binds
// its own document `pointerdown` listener that ignores presses landing inside
// its own card (so a second right-click on the SAME card toggles it shut via
// the card's own handler rather than being pre-closed here). This registry is
// now purely the one-open-at-a-time invariant.
//
// Tracking the full set (not a single active handle) keeps the invariant
// self-healing: even if a stale preview lingered (two opens raced), the next
// open sweeps every other handle, so at most one preview survives. Each `close`
// function is its own identity token, so a preview only removes its own handle.
const openPreviews = new Set<() => void>();

// Open `close`'s preview as the single active one, closing every other open
// preview first. Idempotent for an already-open preview.
export function requestOpenPreview(close: () => void): void {
    for (const other of [...openPreviews]) {
        if (other !== close) other();
    }
    openPreviews.add(close);
}

// Release `close`'s handle. A no-op if it was already removed (e.g. closed by a
// newer open).
export function releasePreview(close: () => void): void {
    openPreviews.delete(close);
}

// Test-only: drop all handles without invoking them.
export function resetPreviewSingleton(): void {
    openPreviews.clear();
}
