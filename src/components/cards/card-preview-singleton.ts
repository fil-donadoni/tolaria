// Only one hover card-preview may be open at a time, app-wide. Each card mounts
// its own autonomous CardPreview with local state, so adjacent hand cards under
// the 3D tilt can both pass their hover gate before either closes — without a
// shared owner the two zoom portals stack on screen. This registry holds the
// close handles of every currently-open preview: opening a new one closes ALL
// others, and a preview releases its own handle when it closes.
//
// Tracking the full set (not a single active handle) makes the invariant
// self-healing: even if a stale dock lingered (a card slid under a stationary
// cursor with no pointermove to fire its exit watcher, or two opens raced),
// the next open sweeps every other handle, so at most one preview survives.
//
// Each `close` function is used as its own identity token, so a preview only
// removes its own handle and never disturbs another's.
const openPreviews = new Set<() => void>();

let clickListenerAttached = false;

// Any pointerdown anywhere dismisses the open preview(s). The dock portal is
// `pointer-events-none`, so a click "on the preview" actually lands on whatever
// is behind it — a document-level capture listener catches the click wherever
// it falls and closes the preview regardless.
function onDocumentPointerDown(): void {
    closeAll();
}

function attachClickListener(): void {
    if (clickListenerAttached) return;
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    clickListenerAttached = true;
}

function detachClickListener(): void {
    if (!clickListenerAttached) return;
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    clickListenerAttached = false;
}

// Close every currently-open preview. Iterates a snapshot because each `close`
// calls back into `releasePreview` and mutates the live set.
function closeAll(): void {
    for (const close of [...openPreviews]) {
        close();
    }
}

// Open `close`'s preview as the single active one, closing every other open
// preview first. Idempotent for an already-open preview.
export function requestOpenPreview(close: () => void): void {
    for (const other of [...openPreviews]) {
        if (other !== close) other();
    }
    openPreviews.add(close);
    attachClickListener();
}

// Release `close`'s handle. A no-op if it was already removed (e.g. closed by a
// newer open). Detaches the global click listener once nothing is open.
export function releasePreview(close: () => void): void {
    openPreviews.delete(close);
    if (openPreviews.size === 0) detachClickListener();
}

// Test-only: drop all handles without invoking them and detach the listener.
export function resetPreviewSingleton(): void {
    openPreviews.clear();
    detachClickListener();
}
