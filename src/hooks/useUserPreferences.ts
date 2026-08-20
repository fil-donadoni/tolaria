import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    DEFAULT_DENSITY_PREFERENCE,
    DEFAULT_MOTION_PREFERENCE,
    DEFAULT_PREVIEW_PREFERENCE,
    type DensityPreference,
    type MotionPreference,
    type PreviewPreference,
} from "~/lib/user-preferences";

/**
 * The one hook every consumer of a per-user Settings value reads through
 * (issue #2595) — the settings page's own controls, the document-root
 * density/motion effect, and `CardPreviewBody`'s seeded default. Backed by
 * `convex/userSettings.ts`: `saved` is `undefined` while the initial query is
 * in flight (mirrors `useCurrentUser`), `null` for a user who has never
 * saved a row, or the row itself with any subset of fields present (a
 * per-field save patches only that field). Every field resolves through a
 * `??` fallback to the SAME default this app always hard-coded, so a user
 * who predates this table — or who saved only one of the three fields —
 * never sees an undefined/blank state.
 */
export function useUserPreferences() {
    const saved = useQuery(api.userSettings.getUserSettings);
    const update = useMutation(api.userSettings.updateUserSettings);

    const density: DensityPreference =
        saved?.density ?? DEFAULT_DENSITY_PREFERENCE;
    const motion: MotionPreference = saved?.motion ?? DEFAULT_MOTION_PREFERENCE;
    const previewPreference: PreviewPreference =
        saved?.previewPreference ?? DEFAULT_PREVIEW_PREFERENCE;

    return {
        density,
        motion,
        previewPreference,
        /** `true` until the initial query resolves (matches `useQuery`'s own
         *  `undefined`-while-loading contract). */
        isLoading: saved === undefined,
        setDensity: (value: DensityPreference) => update({ density: value }),
        setMotion: (value: MotionPreference) => update({ motion: value }),
        setPreviewPreference: (value: PreviewPreference) =>
            update({ previewPreference: value }),
    };
}
