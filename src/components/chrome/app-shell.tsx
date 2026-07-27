// The app shell: one place that decides which routes wear the shared header.
// Before this, the header (`DashboardTopBar`) was mounted by `lobby.tsx`, so
// every other section — the whole `/limited` flow, the deck builder, the
// developer surfaces — rendered with no wordmark, no way back home, and no
// sign-out. Mounting it here makes "has chrome" the default and "fullscreen"
// the explicit exception.
//
// `/game` is that exception: the board is a fullscreen play surface with its
// own chrome (pause menu, dev rail) and a header would take ~5rem of vertical
// space from the battlefield while duplicating an exit the pause menu already
// offers.
import { Outlet, useRouterState } from "@tanstack/react-router";
import { shellShowsHeader } from "@/lib/shellChrome";
import AppHeader from "./app-header";

export default function AppShell() {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    });

    return (
        // Column layout, not "header then page": pages fill the REMAINING
        // height (`flex-1`) instead of each claiming `min-h-dvh`, which would
        // otherwise add the header's height to every page and leave a
        // permanent stray scrollbar.
        <div className="flex min-h-dvh flex-col bg-surface-base text-text">
            {shellShowsHeader(pathname) && (
                <div className="relative z-20 mx-auto w-full max-w-6xl shrink-0 px-6 pt-6">
                    <AppHeader />
                </div>
            )}
            <main className="flex flex-1 flex-col">
                <Outlet />
            </main>
        </div>
    );
}
