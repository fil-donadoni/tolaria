import { useEffect, useState, type ReactNode } from "react";
import {
    hydrateCatalogue,
    hydrateCompiledCorpus,
    isCatalogueHydrated,
    isCompiledCorpusHydrated,
} from "@/lib/catalogueArtifact";
import LoadingScreen from "@/components/ui/loading-screen";
import CatalogueLoadError from "@/components/ui/catalogue-load-error";

/** What a gated surface needs resident before it renders (issue #5615, ADR
 *  0113 Amendment V):
 *  - `whole` — the packed corpus and every hand-written Set: the deck
 *    builder, deck detail, the Draft Lab, admin, the join antechamber.
 *  - `game` — the packed corpus only. The game route then loads the Sets of
 *    its Definition Manifest itself (`DefinitionManifestGate`), so a game
 *    downloads its own cards and never the catalogue. */
export type CatalogueGateMode = "whole" | "game";

/**
 * The loading gate for the card catalogue (ADR 0113 §3, issue #3053).
 *
 * The compiled card definitions are not in the bundle: they are one
 * immutable packed asset the client FETCHES (`src/lib/catalogueArtifact.ts`)
 * and decodes a block at a time on first request (issue #4861); the
 * hand-written ones are one lazily imported chunk per Set (issue #5615).
 * `getDefinition`/`tryGetDefinition` stay synchronous (ADR 0113 §1), which is
 * only true if that data is RESIDENT before any consumer runs — so nothing
 * that reads it may render first. This gate is what makes that a structural
 * property rather than a convention: `RouteOutlet` mounts it around every
 * route that is not a declared `lightSurface`, and its children do not exist
 * as elements until the promise has resolved.
 *
 * Since issue #4854 the fetch starts HERE, when a surface that needs the
 * catalogue opens — no longer at module load of `src/main.tsx`: the login page
 * and the lobby download neither the engine, the catalogue chunk nor this
 * artifact. The gate is a lazy chunk for the same reason (it imports the
 * catalogue glue).
 *
 * A failure is offered a retry rather than swallowed — the hydrations
 * deliberately do not memoise a rejection, so the button really re-loads.
 */
export default function CatalogueGate({
    mode = "whole",
    children,
}: {
    mode?: CatalogueGateMode;
    children: ReactNode;
}) {
    const [error, setError] = useState<Error | null>(null);
    // Already resident (the Setup flow prefetches the corpus, issue #5584):
    // no loading frame at all. The whole catalogue resident satisfies either
    // mode.
    const [ready, setReady] = useState(
        () =>
            isCatalogueHydrated() ||
            (mode === "game" && isCompiledCorpusHydrated())
    );
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const hydrate =
            mode === "game" ? hydrateCompiledCorpus : hydrateCatalogue;
        hydrate().then(
            () => {
                if (!cancelled) setReady(true);
            },
            (cause: unknown) => {
                if (!cancelled)
                    setError(
                        cause instanceof Error
                            ? cause
                            : new Error(String(cause))
                    );
            }
        );
        return () => {
            cancelled = true;
        };
    }, [attempt, mode]);

    if (error) {
        return (
            <CatalogueLoadError
                error={error}
                onRetry={() => {
                    // Cleared HERE, in the event, not in the effect that
                    // follows: a synchronous setState in an effect body is a
                    // cascading render (`react-hooks/set-state-in-effect`).
                    setError(null);
                    setAttempt((n) => n + 1);
                }}
            />
        );
    }

    if (!ready)
        return (
            // Inside the shell's `<main>` since issue #4854 (it used to sit
            // above `AppShell`, which is why it claimed `h-svh`): fills the
            // remainder like every route root, instead of a whole viewport
            // beneath the header.
            <div className="flex min-h-0 flex-1 flex-col">
                <LoadingScreen message="Loading cards..." />
            </div>
        );

    return <>{children}</>;
}
