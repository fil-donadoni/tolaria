import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { prefetchStartMatch, whenIdle } from "~/lib/startMatchPrefetch";

/** Warms the catalogue and the game route once the Setup flow is idle
 *  (issue #5584) — see `~/lib/startMatchPrefetch`. */
export function useStartMatchPrefetch(): void {
    const router = useRouter();
    useEffect(
        () =>
            whenIdle(() => {
                void prefetchStartMatch(() =>
                    router.preloadRoute({ to: "/game" })
                );
            }),
        [router]
    );
}
