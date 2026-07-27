// The gate every `/admin/*` page sits behind. One component above the admin
// section's `Outlet` rather than a per-page check: a per-page gate is a gate
// someone forgets to add to page seven.
//
// A non-admin gets the SAME 404 an unknown path produces, never an explanation
// — an admin surface shouldn't confirm its own existence to a viewer who may
// not open it. While the current-user query is in flight the gate renders
// nothing: flashing a 404 at an admin for one frame is worse than a blank beat,
// and rendering the children early would mount hooks that call admin-gated
// queries (the Draft Lab's, notably) for a viewer who may turn out not to be
// an admin.
//
// Cosmetic on its own — the real boundary is `assertIsAdmin` on every
// mutation/query these pages reach for.
import type { ReactNode } from "react";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canViewAdminSection } from "@/lib/adminGating";
import NotFoundPage from "@/components/ui/not-found-page";

export default function AdminRouteGate({ children }: { children: ReactNode }) {
    const user = useCurrentUser();

    if (user === undefined) return null;
    if (!canViewAdminSection(user)) return <NotFoundPage />;
    return <>{children}</>;
}
