// Publishes the signed-in user's saved card-preview default (issue #2595,
// `previewPreference` — Oracle "computed" text vs "printed") for
// `CardPreviewBody` to read WITHOUT taking a Convex dependency of its own.
//
// `CardPreviewBody` mounts deep in the tree, on every board/lobby/deck-
// builder surface, and its existing test suite (`card-preview.test.tsx`,
// `card-preview-copy.test.tsx`, board card tests, …) renders it with no
// `ConvexProvider` in scope — calling `useQuery`/`useMutation` directly from
// inside it would throw in every one of those tests. `UserPreferencesEffect`
// already owns the one Convex subscription to Settings (mounted once at the
// router root, `src/router.tsx`) and already "renders nothing, publishes onto
// a shared surface" for density/motion (`applyDocumentPreferences` → `<html>`
// dataset). This module is the same shape for the preview default: one
// module-level value, written by `UserPreferencesEffect`, read by
// `CardPreviewBody` via `getPreviewPreferenceDefault` — a plain synchronous
// getter, called once from a `useState` lazy initializer.
//
// Deliberately a SEED, not a live binding (matches `SettingsPreviewSection`'s
// docblock): `CardPreviewBody` reads this getter only inside its `useState`
// lazy initializer, once, at mount — a card preview already open when the
// Settings value changes elsewhere keeps whatever the viewer toggled it to.
// No subscribe/notify surface: nothing needs to follow this value live (if a
// future consumer does, add `useSyncExternalStore` support then — see
// `~/lib/ai/trace-store.ts` for the shape).
import {
    DEFAULT_PREVIEW_PREFERENCE,
    type PreviewPreference,
} from "./user-preferences";

let current: PreviewPreference = DEFAULT_PREVIEW_PREFERENCE;

export function setPreviewPreferenceDefault(value: PreviewPreference): void {
    current = value;
}

export function getPreviewPreferenceDefault(): PreviewPreference {
    return current;
}

// Test-only reset — mirrors `resetPreviewSingleton` (`card-preview-singleton.ts`):
// module state outlives `cleanup()` between test files unless something resets
// it, and vitest reuses worker processes across files.
export function resetPreviewPreferenceDefaultForTests(): void {
    current = DEFAULT_PREVIEW_PREFERENCE;
}
