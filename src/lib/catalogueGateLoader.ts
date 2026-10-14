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
// lazy component did.
//
// A REJECTION IS MEMOISED on the render path, as `React.lazy` memoises it: a
// fresh promise per render would suspend again on every retry and keep the
// boundary on "Loading cards..." forever instead of reaching the error
// component. The PREFETCH must not poison that memo, so it loads on its own
// promise and installs the gate only once it has loaded
// (`prefetchCatalogueGate`).
//
// A dynamic import, never a static one: the gate imports the catalogue glue,
// and the shell must not (issue #4854).
import type { ComponentType, ReactNode, ReactPromise } from "react";
import type { CatalogueGateMode } from "~/lib/catalogueGateMode";

export type CatalogueGateComponent = ComponentType<{
    mode?: CatalogueGateMode;
    children: ReactNode;
}>;

type GatePromise = Promise<CatalogueGateComponent> &
    ReactPromise<CatalogueGateComponent>;

let gate: GatePromise | null = null;

const importGate = (): Promise<CatalogueGateComponent> =>
    import("~/components/ui/catalogue-gate").then((m) => m.default);

/** Tags `loading` with its outcome as React's `use()` reads it. */
function tracked(loading: Promise<CatalogueGateComponent>): GatePromise {
    const promise = loading as GatePromise;
    promise.then(
        (value) => {
            Object.assign(promise, { status: "fulfilled", value });
        },
        (reason: unknown) => {
            Object.assign(promise, { status: "rejected", reason });
        }
    );
    return promise;
}

/** The gate's one loading promise, for `use()`. `load` is the chunk import;
 *  a test passes its own to control when, and whether, it settles. */
export function loadCatalogueGate(
    load: () => Promise<CatalogueGateComponent> = importGate
): GatePromise {
    gate ??= tracked(load());
    return gate;
}

/** Load the gate ahead of its first render (the Setup flow, at idle). A
 *  failure is swallowed and leaves nothing behind: the gate's own first render
 *  loads it again. */
export async function prefetchCatalogueGate(
    load: () => Promise<CatalogueGateComponent> = importGate
): Promise<void> {
    if (gate !== null) return;
    try {
        const value = await load();
        if (gate === null) {
            const loaded = Promise.resolve(value) as GatePromise;
            Object.assign(loaded, { status: "fulfilled", value });
            gate = loaded;
        }
    } catch {
        // Not memoised: see above.
    }
}

/** TEST-ONLY. Forgets the loaded gate so a test can load it again. */
export function resetCatalogueGateForTests(): void {
    gate = null;
}
