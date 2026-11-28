// Issue #10973: on every controller surface the centre pill morphs in place —
// "Pass" becomes "Attack with all" when combat starts, the waiting status
// becomes "No Blockers" when the opponent attacks — so a reflex click aimed at
// the previous action used to fire the new one. Each surface routes its centre
// click through the ONE shared arming guard (`usePrimaryClickGuard`); these
// pin that wiring on the desktop pod, the portrait command row and the
// landscape strip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { ControllerAction } from "~/hooks/useControllerActions";
import { PRIMARY_ARMING_WINDOW_MS } from "~/hooks/usePrimaryClickGuard";
import {
    selectCommandSlots,
    selectPodCommandSlots,
} from "~/lib/controller-action-slots";
import ControllerPodCommandRow from "../controller-pod-command-row";
import ControllerCommandRow from "../controller-command-row";
import ControllerStripCommandStack from "../controller-strip-command-stack";

function action(
    key: string,
    label: string,
    onClick: () => void,
    extra: Partial<ControllerAction> = {}
): ControllerAction {
    return { key, label, tone: "primary", disabled: false, onClick, ...extra };
}

const SURFACES: {
    name: string;
    draw: (actions: ControllerAction[]) => ReactElement;
}[] = [
    {
        name: "desktop pod",
        draw: (actions) => (
            <ControllerPodCommandRow
                slots={selectPodCommandSlots(actions, {
                    label: "Opponent to act",
                    description: "They hold priority",
                })}
                cueBadge={<div role="status">cue</div>}
            />
        ),
    },
    {
        name: "portrait command row",
        draw: (actions) => (
            <ControllerCommandRow slots={selectCommandSlots(actions)} />
        ),
    },
    {
        name: "landscape strip",
        draw: (actions) => (
            <ControllerStripCommandStack slots={selectCommandSlots(actions)} />
        ),
    },
];

const TRANSITIONS: {
    name: string;
    before: (spy: () => void) => ControllerAction[];
    after: (spy: () => void) => ControllerAction[];
}[] = [
    {
        name: "Pass → Attack with all",
        before: (spy) => [action("pass", "Pass", spy)],
        after: (spy) => [
            action("attack-with-all", "Attack with all (2)", spy),
            action("confirm-attackers", "Skip Attack", () => {}),
        ],
    },
    {
        name: "waiting status → No Blockers",
        before: (spy) => [
            action("waiting", "Waiting for opponent", spy, { pill: true }),
        ],
        after: (spy) => [action("confirm-blockers", "No Blockers", spy)],
    },
];

function primary(container: HTMLElement): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
        "[data-controller-primary]"
    )!;
}

describe("controller centre pill — arming guard on every surface (issue #10973)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    for (const surface of SURFACES) {
        for (const t of TRANSITIONS) {
            it(`${surface.name}: ${t.name} — a click inside the window is dropped, one after it fires`, () => {
                const spy = vi.fn();
                const { container, rerender } = render(
                    surface.draw(t.before(() => {}))
                );
                rerender(surface.draw(t.after(spy)));

                fireEvent.click(primary(container));
                expect(spy).not.toHaveBeenCalled();

                vi.advanceTimersByTime(PRIMARY_ARMING_WINDOW_MS);
                fireEvent.click(primary(container));
                expect(spy).toHaveBeenCalledTimes(1);
            });
        }

        it(`${surface.name}: a pill that never changed fires at once`, () => {
            const spy = vi.fn();
            const { container } = render(
                surface.draw([action("pass", "Pass", spy)])
            );
            fireEvent.click(primary(container));
            expect(spy).toHaveBeenCalledTimes(1);
        });
    }
});
