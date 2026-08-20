import { useEffect } from "react";
import { useUserPreferences } from "~/hooks/useUserPreferences";
import { applyDocumentPreferences } from "~/lib/user-preferences";
import { setPreviewPreferenceDefault } from "~/lib/preview-preference-store";

/**
 * Renders nothing. Publishes the signed-in user's Settings (issue #2595) to
 * the two mechanisms their consumers read:
 *  - density/motion onto `<html>` as `[data-density]`/`[data-motion]` — the
 *    CSS layer `src/index.css` reads (`applyDocumentPreferences`).
 *  - the card-preview default into `~/lib/preview-preference-store` — the
 *    module-level seed `CardPreviewBody` reads at mount
 *    (`getPreviewPreferenceDefault`, `src/components/cards/card-preview-body.tsx`).
 *    A getter rather than a second Convex subscription because
 *    `CardPreviewBody` mounts deep in the tree, in tests that render it with
 *    no `ConvexProvider` in scope — see the store module's docblock.
 * Mounted once at the router root, alongside `AppShell`, inside
 * `<AuthGate>`'s `<Authenticated>` branch (`src/router.tsx`) — so it only
 * ever runs for a signed-in user and never races the sign-in screen.
 *
 * A bare Panel that renders no explicit `density` prop inherits whatever
 * this sets, via ordinary CSS custom-property inheritance — no React context
 * needed for that half, per ADR 0101 §2 and the `[data-density]` rules this
 * writes into.
 */
export default function UserPreferencesEffect() {
    const { density, motion, previewPreference } = useUserPreferences();

    useEffect(() => {
        applyDocumentPreferences(document.documentElement, density, motion);
    }, [density, motion]);

    useEffect(() => {
        setPreviewPreferenceDefault(previewPreference);
    }, [previewPreference]);

    return null;
}
