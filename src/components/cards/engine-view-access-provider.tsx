import type { ReactNode } from "react";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { EngineViewAccessContext } from "~/hooks/engineViewAccessContext";
import { canViewEngineView } from "@/lib/adminGating";

// Resolves `canViewEngineView` once for the app shell (issue #7430) so every
// card preview surface reads a boolean from context instead of each running
// the current-user query.
export default function EngineViewAccessProvider({
    children,
}: {
    children: ReactNode;
}) {
    const user = useCurrentUser();
    return (
        <EngineViewAccessContext.Provider value={canViewEngineView(user)}>
            {children}
        </EngineViewAccessContext.Provider>
    );
}
