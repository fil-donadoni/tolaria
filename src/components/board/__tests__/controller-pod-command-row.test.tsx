// The desktop pod's command row (issue #9835): ONE pill, two always-mounted
// icon passes and a fixed shelf, in EVERY controller state — the pod used to
// mount a button per action (174px without priority, 360px declaring
// attackers) and the stack panel anchored above it jumped with it. These pin
// the slot assignment per state and the constant shape; the pixel height is
// the browser's (`check:ui`), since happy-dom has no layout.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ControllerAction } from "~/hooks/useControllerActions";
import { HOTKEYS } from "~/lib/hotkeys";
import { selectPodCommandSlots } from "~/lib/controller-action-slots";
import ControllerPodCommandRow from "../controller-pod-command-row";

afterEach(cleanup);

function action(
    key: string,
    label: string,
    extra: Partial<ControllerAction> = {}
): ControllerAction {
    return {
        key,
        label,
        tone: "primary",
        disabled: false,
        onClick: () => {},
        ...extra,
    };
}

const PASS = action("pass", "Pass", { shortcut: HOTKEYS.passPriority });
const PASS_TURN = action("pass-turn", "Pass Turn", {
    tone: "destructive",
    shortcut: HOTKEYS.passTurn,
});
const UNTIL = action("pass-until-action", "Pass Until Action", {
    tone: "destructive",
    shortcut: HOTKEYS.passUntilAction,
});
const QUEUED = (disabled: boolean) => ({
    passTurn: action("queue-pass-turn", "Pass Turn", { disabled }),
    passUntilAction: action("queue-pass-until-action", "Pass Until Action", {
        disabled,
    }),
});
const IDLE = { label: "Opponent to act", description: "They hold priority" };

type Case = {
    state: string;
    actions: ControllerAction[];
    queued?: ReturnType<typeof QUEUED>;
    pill: { mark: "action" | "status"; text: string; enabled: boolean };
    chips: string[];
    passes: { turn: boolean; until: boolean };
};

const CASES: Case[] = [
    {
        state: "holding priority",
        actions: [PASS, PASS_TURN, UNTIL],
        pill: { mark: "action", text: "Pass", enabled: true },
        chips: [],
        passes: { turn: true, until: true },
    },
    {
        state: "no priority — passes queue",
        actions: [],
        queued: QUEUED(false),
        pill: { mark: "status", text: "Opponent to act", enabled: false },
        chips: [],
        passes: { turn: true, until: true },
    },
    {
        state: "waiting on the opponent",
        actions: [
            action("waiting-opponent", "Opponent declaring blockers...", {
                pill: true,
                disabled: true,
            }),
        ],
        queued: QUEUED(false),
        pill: {
            mark: "status",
            text: "Opponent declaring blockers...",
            enabled: false,
        },
        chips: [],
        passes: { turn: true, until: true },
    },
    {
        state: "auto-passing — the pill cancels, the passes are off",
        actions: [
            action("auto-pass", "Auto-passing... (cancel)", { pill: true }),
        ],
        queued: QUEUED(true),
        pill: {
            mark: "status",
            text: "Auto-passing... (cancel)",
            enabled: true,
        },
        chips: [],
        passes: { turn: false, until: false },
    },
    {
        state: "queued Pass Turn without priority",
        actions: [
            action("queued-end-turn", "Pass Turn queued (cancel)", {
                pill: true,
            }),
        ],
        queued: QUEUED(true),
        pill: {
            mark: "status",
            text: "Pass Turn queued (cancel)",
            enabled: true,
        },
        chips: [],
        passes: { turn: false, until: false },
    },
    {
        state: "declaring attackers with four actions",
        actions: [
            action("confirm-attackers", "Confirm Attackers (12)", {
                shortcut: HOTKEYS.passPriority,
            }),
            action("attack-with-all", "Attack with all (12)"),
            { ...PASS_TURN, key: "pass-turn-attackers" },
            UNTIL,
        ],
        pill: { mark: "action", text: "Confirm Attackers (12)", enabled: true },
        chips: ["attack-with-all"],
        passes: { turn: true, until: true },
    },
    {
        state: "paying a cast",
        actions: [
            action("cancel-cast", "Cancel Cast", {
                tone: "destructive",
                shortcut: HOTKEYS.undo,
            }),
        ],
        pill: { mark: "action", text: "Cancel Cast", enabled: true },
        chips: [],
        passes: { turn: false, until: false },
    },
    {
        state: "holding priority with a queued Pass Turn",
        actions: [
            PASS,
            PASS_TURN,
            UNTIL,
            action("queued-end-turn", "Pass Turn queued (cancel)", {
                pill: true,
            }),
        ],
        pill: { mark: "action", text: "Pass", enabled: true },
        chips: ["queued-end-turn"],
        passes: { turn: true, until: true },
    },
];

function renderRow(c: Case) {
    return render(
        <ControllerPodCommandRow
            slots={selectPodCommandSlots(c.actions, IDLE, c.queued)}
            cueBadge={<div role="status">cue</div>}
        />
    );
}

describe("ControllerPodCommandRow — slots per controller state (issue #9835)", () => {
    it.each(CASES)("$state", (c) => {
        const { container } = renderRow(c);
        const primaries = container.querySelectorAll<HTMLButtonElement>(
            "[data-controller-primary]"
        );
        expect(primaries).toHaveLength(1);
        const pill = primaries[0]!;
        expect(pill.dataset.controllerPrimary).toBe(c.pill.mark);
        // The label alone — a keycap after it is `aria-hidden` chrome.
        expect(pill.firstElementChild?.textContent).toBe(c.pill.text);
        expect(pill.disabled).toBe(!c.pill.enabled);

        expect(
            [
                ...container.querySelectorAll<HTMLElement>(
                    "[data-controller-pod-chip]"
                ),
            ].map((chip) => chip.dataset.controllerPodChip)
        ).toEqual(c.chips);

        const turn = container.querySelector<HTMLButtonElement>(
            '[data-controller-pod-pass="turn"]'
        );
        const until = container.querySelector<HTMLButtonElement>(
            '[data-controller-pod-pass="until-action"]'
        );
        expect(turn?.disabled).toBe(!c.passes.turn);
        expect(until?.disabled).toBe(!c.passes.until);
    });

    it.each(CASES)(
        "$state: the same fixed-height shape — one shelf, one row of three",
        (c) => {
            const { container } = renderRow(c);
            const shelf = container.querySelector<HTMLElement>(
                "[data-controller-pod-shelf]"
            );
            const row = container.querySelector<HTMLElement>(
                "[data-controller-pod-row]"
            );
            expect(shelf?.className.split(/\s+/)).toContain("h-7");
            expect(row?.className.split(/\s+/)).toContain("h-11");
            expect(row?.querySelectorAll(":scope > button")).toHaveLength(3);
            // The cue stays live for assistive tech even when chips take the
            // shelf.
            expect(shelf?.querySelector('[role="status"]')).not.toBeNull();
        }
    );

    it("the primary pill's keycap never joins its accessible name", () => {
        const c = CASES.find((x) => x.chips.includes("attack-with-all"))!;
        const { getByRole } = renderRow(c);
        const pill = getByRole("button", { name: "Confirm Attackers (12)" });
        expect(pill.getAttribute("aria-keyshortcuts")).toBe("Space");
        expect(pill.querySelector('[data-slot="keycap"]')).not.toBeNull();
    });
});
