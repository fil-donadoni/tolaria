import { useEffect, useState, type ReactNode } from "react";
import { hydrateCatalogue } from "@/lib/catalogueArtifact";
import LoadingScreen from "@/components/ui/loading-screen";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import AmbientPageGround from "@/components/ui/ambient-page-ground";

/**
 * The loading gate for the card catalogue (ADR 0113 §3, issue #3053).
 *
 * The compiled card definitions are not in the bundle: they are one
 * immutable packed asset the client FETCHES (`src/lib/catalogueArtifact.ts`)
 * and decodes a block at a time on first request (issue #4861).
 * `getDefinition`/`tryGetDefinition` stay synchronous (ADR 0113 §1), which is
 * only true if that packed data is RESIDENT before any consumer runs — so
 * nothing that reads it may render first. This gate is what makes that a structural property rather than a
 * convention: `RouteOutlet` mounts it around every route that is not a
 * declared `lightSurface`, and its children do not exist as elements until the
 * promise has resolved.
 *
 * Since issue #4854 the fetch starts HERE, when a surface that needs the
 * catalogue opens — no longer at module load of `src/main.tsx`: the login page
 * and the lobby download neither the engine, the catalogue chunk nor this
 * artifact. The gate is a lazy chunk for the same reason (it imports the
 * catalogue glue).
 *
 * A failure is offered a retry rather than swallowed. A catalogue that never
 * arrives is an app with no cards at all, and the alternative to a named
 * error is a white screen — `hydrateCatalogue` deliberately does not memoise a
 * rejection, so the button really re-fetches.
 */
export default function CatalogueGate({ children }: { children: ReactNode }) {
    const [error, setError] = useState<Error | null>(null);
    const [ready, setReady] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        hydrateCatalogue().then(
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
    }, [attempt]);

    if (error) {
        return (
            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-base text-text">
                <AmbientPageGround ring />
                <Panel className="relative z-10 flex max-w-md flex-col items-center gap-4 text-center">
                    <p className="text-sm">
                        Could not load the card catalogue.
                    </p>
                    <p className="text-xs text-text-muted">{error.message}</p>
                    <Button
                        onClick={() => {
                            // Cleared HERE, in the event, not in the effect
                            // that follows: a synchronous setState in an
                            // effect body is a cascading render
                            // (`react-hooks/set-state-in-effect`).
                            setError(null);
                            setAttempt((n) => n + 1);
                        }}
                    >
                        Retry
                    </Button>
                </Panel>
            </div>
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
