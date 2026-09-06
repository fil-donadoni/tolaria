import { useEffect, useState, type ReactNode } from "react";
import { hydrateCatalogue } from "@/lib/catalogueArtifact";
import LoadingScreen from "@/components/ui/loading-screen";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import AmbientPageGround from "@/components/ui/ambient-page-ground";

/**
 * The loading gate for the card catalogue (ADR 0113 §3, issue #3053).
 *
 * The card definitions are no longer in the bundle: they are one
 * content-addressed asset the client FETCHES
 * (`src/lib/catalogueArtifact.ts`). `getDefinition`/`tryGetDefinition` stay
 * synchronous (ADR 0113 §1), which is only true if the registry is FULLY
 * hydrated before any consumer runs — so nothing that reads it may render
 * first. This gate is what makes that a structural property rather than a
 * convention: it sits above the whole route tree in `src/router.tsx`, and its
 * children do not exist as elements until the promise has resolved.
 *
 * The fetch itself starts at module load of `src/main.tsx`, not here, so it
 * overlaps the auth round trip instead of queuing behind it; both await the
 * same promise singleton.
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
            <div className="relative flex h-svh flex-col items-center justify-center bg-surface-base text-text">
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
            // A DEFINITE height, not a minimum: this gate renders above
            // `AppShell`, so there is no `<main>` to claim a remainder of, and
            // `LoadingScreen`'s own `min-h-full` needs a sized parent to
            // resolve against (issue #2274 — the shell contract works the
            // other way round INSIDE the shell). Same position and the same
            // reason as `auth-gate.tsx`'s `AuthLoading` branch, which is why
            // this file joins its allowlist entry in
            // `shell-height-claims.guard.test.tsx`.
            <div className="flex h-svh flex-col">
                <LoadingScreen message="Loading cards..." />
            </div>
        );

    return <>{children}</>;
}
