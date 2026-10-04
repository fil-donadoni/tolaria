import { lazy, type ComponentType } from "react";

/** `React.lazy` for a route component that takes props (`DeckBuilderRoute`'s
 *  `mode`/`kind`), so it cannot go through `lazyRouteComponent`. A function of
 *  its own — not a bare `lazy(...)` in `src/router.tsx` — because that module
 *  exports the router instance, and a file that both defines a component and
 *  exports a non-component breaks Fast Refresh. The `import()` stays in
 *  `router.tsx`, where the check:ui surface table and the scoper read which
 *  route modules the router imports (issue #4854). */
export function lazyWithProps<P extends object>(
    load: () => Promise<{ default: ComponentType<P> }>
): ComponentType<P> {
    return lazy(load);
}
