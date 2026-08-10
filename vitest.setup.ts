import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// base-ui renders overlays (Dialog, Popover, Tooltip, Select, …) through a
// `data-base-ui-portal` root attached to `document.body`, OUTSIDE the React
// Testing Library render container. On close, base-ui defers unmounting the
// popup until its exit animations settle: `useAnimationsFinished` resolves
// `Promise.all(el.getAnimations().map(a => a.finished))` and only then flushes
// the unmount. Under jsdom that promise chain is a microtask with no real
// animation to complete, so a `cleanup()` (synchronous `root.unmount()`) can
// win the race and strand a detached portal subtree in `document.body`. That
// stray subtree survives into later tests, whose global (body-scoped) queries
// then see two copies of a shared label → intermittent "found multiple
// elements" flakes (issue #910).
//
// The root-cause guard is the flag base-ui itself checks: with
// `BASE_UI_ANIMATIONS_DISABLED` set, `useAnimationsFinished` runs the unmount
// synchronously and never enters the deferred `getAnimations()` path, so the
// popup is removed in the same tick as the close. Today's jsdom happens to
// lack `Element.prototype.getAnimations` (which also forces the sync path), but
// the flag makes the guarantee independent of that — surviving a jsdom upgrade
// or a test that polyfills `getAnimations` for animation assertions.
(
    globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }
).BASE_UI_ANIMATIONS_DISABLED = true;

// jsdom lacks ResizeObserver, which @dnd-kit/dom touches at import time. A
// no-op stub is enough for component tests (no real layout to observe).
// happy-dom ships one, so this only fires under jsdom.
if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
        ResizeObserverStub;
}

// happy-dom/jsdom CSSOM divergence (issue #2435): happy-dom's `getComputedStyle`
// leaves several properties at "unset" (`undefined` via direct property access,
// `""` via `getPropertyValue`) where jsdom fills in the CSS spec's INITIAL value
// because it ships a default UA stylesheet happy-dom does not. Two confirmed
// consumers break on the gap:
//
// 1. `@dnd-kit/dom` parses the individual-transform-property longhands
//    (`scale`, `translate`) off `getComputedStyle(el)` at DRAGGABLE/DROPPABLE
//    REGISTRATION — i.e. component MOUNT, not only during a simulated drag
//    (`utilities.js` `parseScale`/`parseTranslate`/`parseTransform`, called
//    from `new DOMRectangle`). `"none".split` exists, `undefined.split`
//    throws. Confirmed via `bunx vitest run --project dom` on the un-shimmed
//    branch: 20 collection-time `TypeError: Cannot read properties of
//    undefined (reading 'split')`, all with this exact stack, across every
//    deckbuilder/limited/lobby-deck-builder file that renders a `@dnd-kit`
//    draggable/droppable.
// 2. `dom-accessibility-api` (the engine behind Testing Library's
//    `getByRole(…, { name })`) inserts a `" "` separator around any CHILD
//    ELEMENT whose computed `display !== "inline"` when flattening an
//    accessible name (`accessible-name-and-description.js`: `separator =
//    display !== "inline" ? " " : ""`). A Kicker/Buyback checkbox's implicit
//    `<label>` name is "Pay " + mana-symbol `<img alt="{U}">` runs
//    (`cast-cost-kicker-field.tsx`); jsdom's `getComputedStyle(img).display`
//    defaults to the spec-initial `"inline"` (confirmed: a debug run with
//    `// @vitest-environment jsdom` on the exact same rendered markup returns
//    `"Pay Kicker {2}{U}"`), so no separator is added. happy-dom returns `""`
//    for the SAME unstyled `<img>` (confirmed directly against a bare
//    `happy-dom` `Window`, no React involved) — `"" !== "inline"` — so a
//    space is inserted before AND after each symbol, splitting
//    `"Pay Kicker {2}{U}"` into `"Pay Kicker {2} {U}"` and breaking
//    `getByRole("checkbox", { name: "Pay Kicker {2}{U}" })`. Neither browser
//    ever runs this code path against a REAL Tailwind stylesheet (no CSS is
//    loaded into either test DOM) — jsdom's result is what its default UA
//    STYLESHEET fills in for an unstyled element (NOT the CSS spec's
//    "initial value" — see the `display` note below), not proof the
//    authored `className="inline …"` is honoured; happy-dom's is the gap.
// 3. happy-dom performs NO CSS INHERITANCE AT ALL: an inherited property
//    (`pointer-events`, `visibility`, `color`, …) with no rule of its own
//    computes `""` regardless of what an ancestor sets — a child of an
//    element with inline `pointer-events: none` computes `""`, not jsdom's
//    inherited `"none"`; an unset element computes `""`, not jsdom's initial
//    `"auto"` (confirmed against a bare happy-dom `Window`). This is the
//    quietest of the three gaps: an assertion of the shape
//    `expect(getComputedStyle(x).prop).not.toBe("none")` PASSES VACUOUSLY
//    against happy-dom's `""` no matter what the real cascade would compute,
//    so a broken nesting reads as a passing test. That is exactly how it was
//    found — `board-battlefield-card-tap-inert-layer.test.tsx`'s round-4
//    regression guard for #1994 (`[data-card-tilt-root]` must NOT inherit a
//    tapped ancestor's `pointer-events: none`) went silently blind to the
//    round-3 regression it exists to catch, caught only by deliberately
//    reintroducing that regression during #2435's review and watching the
//    assertion stay green under happy-dom (red under jsdom). Fixed as a
//    general INHERITED_PROPERTIES table + a `parentElement` walk
//    (`resolveInherited`), not a `pointer-events` special case — a
//    one-property patch only defers the next property that hits the same
//    silent-pass shape.
//
// Shimmed here (not per-file) because all three fire at MOUNT/query time, for
// any component either library touches — a per-file shim would miss the next
// one.
//
// Remaining gap: only the properties enumerated below are patched. For any
// OTHER property, `getComputedStyle(x).prop` still returns happy-dom's raw
// `""`/`undefined` when unset, so `expect(getComputedStyle(x).prop).not.toBe(
// <bad>)` still passes vacuously for it — extend the tables below when a real
// gap surfaces; do not trust an un-audited `.not.toBe` on a property that
// isn't listed here.
{
    const nativeGetComputedStyle = globalThis.getComputedStyle.bind(globalThis);
    // Property (kebab-case) → the value to report when happy-dom leaves it
    // unset. For `scale`/`translate`/`rotate` (not inherited) and the
    // `pointer-events`/`visibility` fallback (inherited, but only once no
    // ancestor supplies a value either — see INHERITED_PROPERTIES below) this
    // is genuinely the CSS spec's INITIAL value. `display` is different: what
    // jsdom actually supplies is its default UA-STYLESHEET value, which is
    // per-TAG, not a single CSS-spec initial — `"inline"` here is right for
    // span/img/a/label/svg/strong (jsdom's default for all of them) but WRONG
    // for `<td>`/`<th>` (jsdom: `"table-cell"`, the HTML UA stylesheet's
    // table rule) — see DISPLAY_TAG_OVERRIDES.
    const INITIAL_VALUES: Record<string, string> = {
        scale: "none",
        translate: "none",
        rotate: "none",
        display: "inline",
        "pointer-events": "auto",
        visibility: "visible",
    };
    // Per-tag override for `display`, checked before the flat INITIAL_VALUES
    // default above.
    const DISPLAY_TAG_OVERRIDES: Record<string, string> = {
        TD: "table-cell",
        TH: "table-cell",
    };
    // CSS properties that INHERIT from the nearest ancestor's own value
    // (CSS2.1 §6.1's initial inherited-properties list + the CSS-UI/CSS-Text
    // additions this suite is positioned to hit). Not exhaustive of the CSS
    // spec — exhaustive of "inherited AND worth resolving here"; extend it
    // when the next gap surfaces per the remaining-gap note above.
    const INHERITED_PROPERTIES = new Set([
        "pointer-events",
        "visibility",
        "color",
        "cursor",
        "direction",
        "font",
        "font-family",
        "font-size",
        "font-style",
        "font-variant",
        "font-weight",
        "letter-spacing",
        "line-height",
        "list-style",
        "list-style-image",
        "list-style-position",
        "list-style-type",
        "text-align",
        "text-indent",
        "text-transform",
        "white-space",
        "word-spacing",
    ]);
    const toKebab = (prop: string): string =>
        prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    // The nearest ancestor's OWN inline value for `kebabProp`, or `undefined`
    // if none of them set it either. Inline-only cascade: neither test DOM
    // ever loads a real stylesheet (only inline styles are ever set, by
    // React), so an ancestor's own `style.getPropertyValue` IS its full
    // contribution to the cascade — no specificity to emulate, just "closest
    // ancestor with a declared value wins," which is what this loop computes.
    function resolveInherited(
        el: Element,
        kebabProp: string
    ): string | undefined {
        for (
            let node: Element | null = el.parentElement;
            node;
            node = node.parentElement
        ) {
            const own = (node as HTMLElement).style?.getPropertyValue(
                kebabProp
            );
            if (own) return own;
        }
        return undefined;
    }
    function withInitialValue(
        el: Element,
        prop: string,
        raw: unknown
    ): unknown {
        if (raw !== undefined && raw !== "") return raw;
        const kebab = toKebab(prop);
        if (INHERITED_PROPERTIES.has(kebab)) {
            const inherited = resolveInherited(el, kebab);
            if (inherited) return inherited;
        }
        if (kebab === "display") {
            const override = DISPLAY_TAG_OVERRIDES[el.tagName];
            if (override) return override;
        }
        return kebab in INITIAL_VALUES ? INITIAL_VALUES[kebab] : raw;
    }
    (
        globalThis as { getComputedStyle: typeof getComputedStyle }
    ).getComputedStyle = (...args: Parameters<typeof getComputedStyle>) => {
        const el = args[0];
        return new Proxy(nativeGetComputedStyle(...args), {
            // Pass `target` (not `receiver`, the Proxy itself) as Reflect.get's
            // receiver, and bind any returned method to `target` too: happy-dom's
            // CSSStyleDeclaration getters/methods (e.g. `getPropertyValue`) run
            // with `this` set to the receiver/call-site object, and several
            // assert `this instanceof CSSStyleDeclaration` — a check the Proxy
            // itself fails ("Receiver must be an instance of class
            // CSSStyleDeclaration").
            get(target, prop) {
                const value: unknown = Reflect.get(target, prop, target);
                if (typeof prop === "string" && prop === "getPropertyValue") {
                    const original = value as (name: string) => string;
                    return (name: string) =>
                        withInitialValue(el, name, original.call(target, name));
                }
                if (typeof value === "function") return value.bind(target);
                return typeof prop === "string"
                    ? withInitialValue(el, prop, value)
                    : value;
            },
        });
    };
}

// happy-dom inline-`style` CSS-parser gap (issue #2435): `element.style.<prop>
// = "calc(var(--x) * n / m)"` (exactly how React sets inline styles —
// react-dom's `setValueForStyles` assigns each style key as a property, never
// a single `cssText` string) is silently DROPPED — not merely unreadable
// through one API, genuinely unstored: `style.height` reads back `""`,
// `style.cssText` is `""`, and `getAttribute("style")` is `null` (confirmed
// directly against a bare `happy-dom` `Window`, no React/no vitest
// involved — a plain `calc(10px * 7 / 5)` or a bare `var(--x)` each parse
// fine; only `calc()` WRAPPING a `var()` reference fails, and the failure
// drops the whole declaration with no trace anywhere public). Two card-tile
// sizing components hit this: `player-emblems.tsx`'s fan slot
// (`height: "calc(var(--card-w-sm) * 7 / 5)"`) and `card-layout.ts`'s
// `pileCardTop` (`top: "calc(var(--card-h) * 0.23 * i)"`, applied in
// `deck-card-tile.tsx`). Since happy-dom's own parser is the thing at fault
// and there is no OTHER public surface still holding the value, this is
// shimmed as a side-channel: wrap the `CSSStyleDeclaration` `element.style`
// returns, remembering the last raw string assigned to a property whenever
// that string is a `calc()` containing a `var()`, and serving it back only
// when happy-dom's own getter comes up empty for that exact property. The
// shadow entry for a property is DELETED the moment that same property is
// next written with a value that is NOT an unreliable calc() — an
// explicitly-set empty string (`style.height = ""`) or `removeProperty`
// included — so a later cleared/overwritten value is never masked by a
// stale shadow of the earlier one.
//
// Narrower than it may read: only DIRECT property reads (`el.style.height`)
// are patched. `style.cssText`, `getAttribute("style")`,
// `style.getPropertyValue(...)`, and `outerHTML` all still see nothing — the
// value genuinely never made it into happy-dom's own CSSOM, so anything
// attribute-/snapshot-/`getPropertyValue`-based is unaffected by this shim
// and will still see the value as absent. A value written via
// `style.setProperty(...)` (rather than the property-assignment form React
// uses) is likewise not shadowed. Nothing in the suite exercises those paths
// today (`toHaveStyle` has 0 occurrences in `src`), which is why the gap
// hasn't bitten yet.
{
    const isUnreliableCalc = (value: unknown): value is string =>
        typeof value === "string" &&
        value.includes("calc(") &&
        value.includes("var(");
    const shadowByStyle = new WeakMap<
        CSSStyleDeclaration,
        Map<string, string>
    >();
    const proxyByStyle = new WeakMap<
        CSSStyleDeclaration,
        CSSStyleDeclaration
    >();
    const nativeStyleDescriptor = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "style"
    )!;
    const nativeStyleGetter = nativeStyleDescriptor.get!;
    Object.defineProperty(HTMLElement.prototype, "style", {
        ...nativeStyleDescriptor,
        get(this: HTMLElement) {
            const native: CSSStyleDeclaration = nativeStyleGetter.call(this);
            const cached = proxyByStyle.get(native);
            if (cached) return cached;
            const proxy = new Proxy(native, {
                set(target, prop, value) {
                    const ok = Reflect.set(target, prop, value, target);
                    if (typeof prop === "string") {
                        if (isUnreliableCalc(value)) {
                            let shadow = shadowByStyle.get(target);
                            if (!shadow) {
                                shadow = new Map();
                                shadowByStyle.set(target, shadow);
                            }
                            shadow.set(prop, value);
                        } else {
                            // A reliable value (including an explicit empty
                            // string) overwrites whatever the previous calc()
                            // shadowed — the shadow must not outlive it.
                            shadowByStyle.get(target)?.delete(prop);
                        }
                    }
                    return ok;
                },
                get(target, prop) {
                    const value: unknown = Reflect.get(target, prop, target);
                    if (typeof prop === "string" && prop === "removeProperty") {
                        const original = value as (name: string) => string;
                        return (name: string) => {
                            shadowByStyle.get(target)?.delete(name);
                            return original.call(target, name);
                        };
                    }
                    if (
                        (value === "" || value === undefined) &&
                        typeof prop === "string"
                    ) {
                        const shadow = shadowByStyle.get(target)?.get(prop);
                        if (shadow !== undefined) return shadow;
                    }
                    return typeof value === "function"
                        ? value.bind(target)
                        : value;
                },
            });
            proxyByStyle.set(native, proxy);
            return proxy;
        },
    });
}

// happy-dom `<label>` click-forwarding TIMING bug (issue #2435) — a genuine
// event-dispatch-order divergence, not a CSSOM quirk. Native `<label>`
// behaviour: clicking anywhere inside a label (with no `htmlFor`, whose
// implicit associated control is the first labelable descendant) also fires a
// "click" on that control — UNLESS the original click's `preventDefault()`
// was called anywhere during its dispatch (DOM spec: default actions run once,
// after the FULL bubble — including delegated listeners at the root — has
// completed). happy-dom's `HTMLLabelElement.prototype.dispatchEvent`
// (`node_modules/happy-dom/src/nodes/html-label-element/HTMLLabelElement.ts`)
// instead runs this check INLINE, the moment the event's bubble reaches the
// label node — before it continues bubbling to the root container where
// React 19's single delegated listener lives. Confirmed with a bare
// React-only repro (no base-ui): a `<label><span role="checkbox" onClick={e
// => { e.preventDefault(); input.dispatchEvent(new PointerEvent("click")) }}
// /><input type="checkbox" /></label>` — clicking the span logs, in this
// order, "input click (native label-forward)" WITH a toggle, THEN "span
// onClick" (too late to matter) triggering the SPAN's own manual re-dispatch,
// toggling a SECOND time back to unchecked. `base-ui`'s `Checkbox` (used by
// every Kicker/Buyback field, `cast-cost-kicker-field.tsx`) uses exactly this
// span+manual-input-dispatch pattern specifically so it also works OUTSIDE a
// `<label>` — it is not a bug in application code.
//
// Confirmed narrow: of 2207 `dom`-project tests, only
// `cast-cost-dialog.test.tsx`'s checkbox-click assertions hit this (a `click`
// on a non-native control WRAPPED in a label-with-no-`htmlFor`, driven through
// React's root-delegated handler). Fixed once, globally, by REPLACING
// happy-dom's early, inline forwarding with the same feature evaluated at the
// correct point: a single capture-nothing, bubble-phase "click" listener on
// `document` — the last stop on the bubble path, guaranteed to run after
// every ancestor including React's root listener — that re-implements "click
// bubbled through a label forwards to its control" using the PUBLIC
// `label.control` getter and checking `event.defaultPrevented` at the point
// where the DOM spec says default actions run.
if (typeof HTMLLabelElement !== "undefined") {
    const dispatchOnHTMLElement = HTMLElement.prototype.dispatchEvent;
    // Drop happy-dom's early forward; `super.dispatchEvent` (HTMLElement's,
    // skipping HTMLLabelElement's own override) still runs every listener
    // registered on the label itself — only the extra, mistimed "also click
    // the control" step is removed.
    HTMLLabelElement.prototype.dispatchEvent = function (
        this: HTMLLabelElement,
        event: Event
    ): boolean {
        return dispatchOnHTMLElement.call(this, event);
    };
    document.addEventListener(
        "click",
        (event) => {
            if (event.defaultPrevented || !(event instanceof MouseEvent)) {
                return;
            }
            for (
                let node = event.target as Element | null;
                node;
                node = node.parentElement
            ) {
                if (node instanceof HTMLLabelElement) {
                    const control = node.control;
                    if (control && control !== event.target) {
                        control.dispatchEvent(
                            new MouseEvent("click", {
                                bubbles: true,
                                cancelable: true,
                            })
                        );
                    }
                    break;
                }
            }
        },
        // Bubble phase (the default) — this must be the LAST listener to see
        // the event, so it needs no special ordering beyond being attached to
        // `document`, the top of the bubble chain.
        false
    );
}

afterEach(() => {
    cleanup();
    // Defense in depth: `cleanup()` unmounts the render container but does not
    // reap base-ui portal roots that were stranded outside it. Remove any that
    // survived so the next test starts from a portal-free `document.body` and
    // its global queries only ever see its own markup. This fixes the whole
    // class (every base-ui overlay portal), not just Dialog. With the animation
    // flag above this should already be empty; the sweep keeps isolation
    // guaranteed even if a future test reintroduces a deferred-unmount path.
    document
        .querySelectorAll("[data-base-ui-portal]")
        .forEach((node) => node.remove());
});
