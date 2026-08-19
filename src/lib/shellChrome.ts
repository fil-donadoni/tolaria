// Which routes wear the app-wide header. Lives beside `AppShell` rather than
// inside it because a component file may only export components (the
// react-refresh rule), and this predicate is the shell's whole rule — worth
// unit-testing on its own.
//
// `/game` is the one exception to "everything has chrome": the board is a
// fullscreen play surface with its own chrome (pause menu, dev rail), and a
// header would take vertical space from the battlefield while duplicating an
// exit the pause menu already offers.

/** Route prefixes that render without the shared header. */
// `/prototype/*` spikes are immersive surfaces too (PRD #2405 touch prototype).
const FULLSCREEN_PREFIXES = ["/game", "/prototype"];

export function shellShowsHeader(pathname: string): boolean {
    return !FULLSCREEN_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}
