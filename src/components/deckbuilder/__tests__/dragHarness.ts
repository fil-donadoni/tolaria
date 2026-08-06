// Shared harness for the MOUNTED drag tests of the deckbuilder zone surface
// (issue #1622). Both builders' surfaces are the same component, so both their
// drag tests drive the drag the same way — this is that one way, not a copy per
// file.
//
// Why the drag is driven through dnd-kit's own `DragDropManager` rather than by
// synthetic pointer events: jsdom has NO layout — every `getBoundingClientRect`
// is a zero rect — so dnd-kit's collision detection can never resolve a drop
// target from pointer coordinates. Faking the geometry would test the fake.
// Driving the manager instead keeps every OTHER link real: the surface renders
// the real components, which register real draggables and real droppables in
// the manager's registry; the lookup below resolves BOTH by their rendered DOM
// element (so a wrong drag payload or a wrong drop id fails here, which is the
// whole point); and the drop runs through the host's real `onDragEnd`, the real
// `resolveDeckZoneDragAction` and the real `applyDeckZoneDragAction`.
import { expect } from "vitest";
import { act } from "@testing-library/react";
import type { DragDropManager } from "@dnd-kit/dom";

/** Browser APIs `@dnd-kit/dom` touches during a real drag operation that jsdom
 *  does not implement. Call from a `beforeAll` in any file that drives a drag. */
export function installDndJsdomShims(): void {
    (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia =
        () => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {},
        });
    if (!("IntersectionObserver" in globalThis)) {
        (
            globalThis as { IntersectionObserver?: unknown }
        ).IntersectionObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() {
                return [];
            }
        };
    }
    for (const target of [document, Element.prototype]) {
        if (!("getAnimations" in target)) {
            (target as { getAnimations?: () => unknown[] }).getAnimations =
                () => [];
        }
    }
    // dnd-kit's auto-scroller hit-tests the pointer position; jsdom has no
    // layout, so there is nothing under any point.
    (
        document as unknown as { elementFromPoint: () => Element | null }
    ).elementFromPoint = () => null;
}

/** Drives one real drag operation: pick up the draggable registered for
 *  `sourceEl`, drop it on the droppable registered for `targetEl`. */
export async function dragOnto(
    manager: DragDropManager,
    sourceEl: Element,
    targetEl: Element
): Promise<void> {
    const source = [...manager.registry.draggables].find(
        (d) => d.element === sourceEl
    );
    const target = [...manager.registry.droppables].find(
        (d) => d.element === targetEl
    );
    expect(source, "no draggable registered for the dragged tile").toBeTruthy();
    expect(target, "no droppable registered for the drop target").toBeTruthy();
    await act(async () => {
        await manager.actions.start({
            source: source!.id,
            coordinates: { x: 0, y: 0 },
        });
        await manager.actions.setDropTarget(target!.id);
        await manager.actions.stop();
    });
}
