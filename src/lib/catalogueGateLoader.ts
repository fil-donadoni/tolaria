// The catalogue gate's lazy chunk, loaded through ONE memoised promise that
// carries its own outcome (issue #5584).
//
// `RouteOutlet` used `React.lazy`, which suspends on its first render even
// when the chunk is already in memory — the lazy payload only learns of the
// module in a `then` callback — and React keeps a revealed fallback up for a
// throttle window: measured on a production build, Start match showed
// "Loading cards..." and took 0.87 s although the Setup flow's idle prefetch
// had already loaded the gate and hydrated the catalogue (0.33 s before the
// Setup flow became a light surface).
//
// So the promise is tagged with React's thenable fields (`status`, `value`)
// the moment it settles: `use()` reads a `fulfilled` thenable synchronously
// and renders without suspending. Not yet loaded, it suspends exactly as the
// lazy component did. A rejection is not memoised: the next render retries.
//
// A dynamic import, never a static one: the gate imports the catalogue glue,
// and the shell must not (issue #4854).
import type { ComponentType, ReactNode, ReactPromise } from "react";

export type CatalogueGateComponent = ComponentType<{ children: ReactNode }>;

type GatePromise = Promise<CatalogueGateComponent> &
    ReactPromise<CatalogueGateComponent>;

let gate: GatePromise | null = null;

const importGate = (): Promise<CatalogueGateComponent> =>
    import("~/components/ui/catalogue-gate").then((m) => m.default);

/** The gate's one loading promise. `load` is the chunk import; a test passes
 *  its own to control when, and whether, it settles. */
export function loadCatalogueGate(
    load: () => Promise<CatalogueGateComponent> = importGate
): GatePromise {
    if (gate === null) {
        const loading = load() as GatePromise;
        loading.then(
            (value) => {
                Object.assign(loading, { status: "fulfilled", value });
            },
            (reason: unknown) => {
                Object.assign(loading, { status: "rejected", reason });
                if (gate === loading) gate = null;
            }
        );
        gate = loading;
    }
    return gate;
}

/** TEST-ONLY. Forgets the loaded gate so a test can load it again. */
export function resetCatalogueGateForTests(): void {
    gate = null;
}
