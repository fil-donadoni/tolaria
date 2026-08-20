// Review finding on PR #2620 (issue #2595): the AC "density and motion
// persist per user and switch the tokens live (dom tests through the
// settings route)" was not actually met. `user-preferences-effect.test.tsx`
// only mounted `UserPreferencesEffect` in isolation and proved the live
// switch by manually calling `rerender()` with a new mock return value;
// `settings.route.test.tsx` is a heading smoke test that never mounts the
// effect at all. Nothing joined "click a density radio on the Settings
// surface" to "<html data-density> changes" — `useQuery`/`useMutation` were
// two disconnected `vi.fn()`s.
//
// This test wires a minimal REACTIVE stand-in for the Convex subscription —
// `useMutation`'s returned function writes into a module-level store, and
// every `useQuery()` call (in `SettingsRoute`'s sections AND in
// `UserPreferencesEffect`, mounted together here exactly as `src/router.tsx`
// mounts them both under `<AuthGate>`) reads that SAME store via
// `useSyncExternalStore` — so a single `fireEvent.click` propagates end to
// end inside one React commit, the way the real subscription would, instead
// of a test-authored `rerender()` standing in for it.
//
// It also resolves the density value through `DENSITY_RUNGS`
// (`~/lib/design-tokens.ts` — the same table `src/__tests__/design-tokens.test.ts`
// cross-checks against `src/index.css`'s `[data-density]` rules) rather than
// asserting the raw `dataset.density` string the test itself just wrote:
// that ties the assertion to the v3 token CONTRACT (the "roomy" rung means
// an 8/10/12px rhythm unit), not to an echo of the click handler's own input.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSyncExternalStore } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import SettingsRoute from "../settings.route";
import UserPreferencesEffect from "~/components/settings/user-preferences-effect";
import { DENSITY_RUNGS } from "~/lib/design-tokens";

type SavedRow = {
    density?: string;
    motion?: string;
    previewPreference?: string;
} | null;

let saved: SavedRow = null;
const listeners = new Set<() => void>();

function setSaved(patch: Record<string, string>) {
    saved = { ...(saved ?? {}), ...patch };
    for (const l of listeners) l();
}
function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function getSnapshot(): SavedRow {
    return saved;
}

vi.mock("convex/react", () => ({
    useQuery: () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    useMutation: () => (patch: Record<string, string>) => {
        setSaved(patch);
        return Promise.resolve();
    },
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

// Same stand-in `settings.route.test.tsx` uses — phase stops are unrelated
// to this test (localStorage-backed, no Convex) and just need to render.
vi.mock("~/components/board/phase-stop-dot", () => ({
    default: ({
        active,
        onClick,
        ariaLabel,
    }: {
        active: boolean;
        onClick: () => void;
        ariaLabel: string;
    }) => (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
        />
    ),
}));

beforeEach(() => {
    saved = null;
    listeners.clear();
    delete document.documentElement.dataset.density;
    delete document.documentElement.dataset.motion;
});

afterEach(() => {
    cleanup();
});

describe("Settings route live-switches density through the real route + effect (issue #2595, PR #2620 review)", () => {
    it("clicking Compact on /settings resolves to the compact density token on <html>", () => {
        const { getByRole } = render(
            <>
                <UserPreferencesEffect />
                <SettingsRoute />
            </>
        );
        // No saved row yet — the app's previous hard-coded default.
        expect(document.documentElement.dataset.density).toBe("roomy");

        fireEvent.click(getByRole("radio", { name: /compact/i }));

        expect(document.documentElement.dataset.density).toBe("compact");
        const rung = DENSITY_RUNGS.find(
            (r) => r.density === document.documentElement.dataset.density
        );
        // The v3 contract behind "compact", not the string this test wrote.
        expect(rung?.unit).toBe("8px");
        expect(rung?.panelPad).toBe("8px");
    });

    it("clicking Reduced on /settings resolves to the reduced motion token on <html>", () => {
        const { getByRole } = render(
            <>
                <UserPreferencesEffect />
                <SettingsRoute />
            </>
        );
        expect(document.documentElement.dataset.motion).toBe("system");

        fireEvent.click(getByRole("radio", { name: /reduced/i }));

        expect(document.documentElement.dataset.motion).toBe("reduced");
    });
});
