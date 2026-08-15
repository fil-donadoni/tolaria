import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";

// The app's single `<RouterProvider>` mount.
//
// It lives here rather than in `router.tsx` because that module exports the
// `router` instance itself — issue #2357's static-vs-dynamic precedence test
// (`/limited/events` vs `/limited/$eventId`) calls
// `router.getMatchedRoutes(path)` against the REAL route tree, not a hand-built
// replica that could silently drift from it. A file exporting both a component
// and a non-component breaks Fast Refresh (`react-refresh/only-export-components`),
// so the component moves out and `router.tsx` stays pure wiring.
export function AppRouter() {
    return <RouterProvider router={router} />;
}
