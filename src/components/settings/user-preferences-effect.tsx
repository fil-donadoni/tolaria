import { useEffect } from "react";
import { useUserPreferences } from "~/hooks/useUserPreferences";
import { applyDocumentPreferences } from "~/lib/user-preferences";

/**
 * Renders nothing. Publishes the signed-in user's density/motion Settings
 * (issue #2595) onto `<html>` as `[data-density]`/`[data-motion]` — the
 * mechanism `src/index.css` reads (`applyDocumentPreferences`). Mounted once
 * at the router root, alongside `AppShell`, inside `<AuthGate>`'s
 * `<Authenticated>` branch (`src/router.tsx`) — so it only ever runs for a
 * signed-in user and never races the sign-in screen.
 *
 * A bare Panel that renders no explicit `density` prop inherits whatever
 * this sets, via ordinary CSS custom-property inheritance — no React context
 * needed for that half, per ADR 0101 §2 and the `[data-density]` rules this
 * writes into.
 */
export default function UserPreferencesEffect() {
    const { density, motion } = useUserPreferences();

    useEffect(() => {
        applyDocumentPreferences(document.documentElement, density, motion);
    }, [density, motion]);

    return null;
}
