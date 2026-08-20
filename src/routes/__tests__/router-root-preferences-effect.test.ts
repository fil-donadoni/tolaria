// Review finding on PR #2620 (issue #2595): `<UserPreferencesEffect />` at
// the router root (`src/router.tsx`) is the ONLY thing that makes
// density/motion — and, since the preview-default fix, the card-preview
// seed — apply. The reviewer deleted that one JSX line and ran the full
// settings/router/chrome test suites (18 files / 254 tests): every one
// stayed green with the feature unmounted, because nothing asserted the
// mount itself. This test closes that hole by inspecting the root route's
// element tree directly (no render, no Convex/auth mocking needed — pure
// `React.createElement` introspection) for a `UserPreferencesEffect` node.
import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { router } from "~/router";
import UserPreferencesEffect from "~/components/settings/user-preferences-effect";

function containsElementType(node: ReactNode, type: unknown): boolean {
    if (node == null || typeof node !== "object") return false;
    if (Array.isArray(node)) {
        return node.some((child) => containsElementType(child, type));
    }
    const el = node as ReactElement;
    if (!("type" in el)) return false;
    if (el.type === type) return true;
    const children = (el.props as { children?: ReactNode } | undefined)
        ?.children;
    return containsElementType(children, type);
}

describe("router root mounts UserPreferencesEffect (issue #2595, PR #2620 review)", () => {
    it("renders <UserPreferencesEffect /> in the root route's element tree", () => {
        const rootComponent = router.routeTree.options.component as
            | (() => ReactElement)
            | undefined;
        expect(rootComponent).toBeTypeOf("function");
        const tree = rootComponent!();
        expect(containsElementType(tree, UserPreferencesEffect)).toBe(true);
    });
});
