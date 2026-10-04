import { lazy } from "react";

// `DeckBuilderRoute` takes props (`mode`, `kind`), so `router.tsx` cannot hand
// it to `lazyRouteComponent` as a bare route component: it goes through
// `React.lazy` and is wrapped inline by each route (issue #4854). A module of
// its own because `router.tsx` exports the router instance, and a file that
// exports both a component and a non-component breaks Fast Refresh.
export const LazyDeckBuilderRoute = lazy(() => import("./deck-builder.route"));
