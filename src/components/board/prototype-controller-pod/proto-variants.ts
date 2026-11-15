// PROTOTYPE — throwaway (branch prototype/controller-pod-shift, never merge).
// Question: how should the DESKTOP controller pod keep a constant height when
// priority comes and goes? Today the action list unmounts without priority, the
// pod shrinks ~120px and the stack panel anchored above it jumps.
//
// URL is the truth: ?variant=0|A|B|C  &  ?state=<scenario key>.
import type {
    ControllerAction,
    ControllerCue,
} from "~/hooks/useControllerActions";

export const PROTO_VARIANTS = [
    { key: "0", name: "Current pod (baseline)" },
    { key: "A", name: "Fixed slots — always mounted" },
    { key: "B", name: "Ghost dock — reserved height" },
    { key: "C", name: "Command row — one line" },
] as const;

export const PROTO_SCENARIOS = [
    { key: "live", name: "live game" },
    { key: "flip", name: "flip priority ⇄ opponent (1.5s)" },
    { key: "priority", name: "priority: Pass" },
    { key: "opponent", name: "no priority" },
    { key: "waiting", name: "opp declaring blockers" },
    { key: "auto-pass", name: "auto-passing" },
    { key: "queued", name: "no priority + Pass Turn queued" },
    { key: "attackers", name: "declare attackers (4 actions)" },
    { key: "cast", name: "paying a cast" },
] as const;

export type ProtoVariantKey = (typeof PROTO_VARIANTS)[number]["key"];
export type ProtoScenarioKey = (typeof PROTO_SCENARIOS)[number]["key"];

function readParam<T extends string>(
    name: string,
    list: readonly { key: T }[],
    fallback: T
): T {
    const v = new URLSearchParams(window.location.search).get(name);
    return list.find((p) => p.key === v)?.key ?? fallback;
}

export const readVariant = () =>
    readParam<ProtoVariantKey>("variant", PROTO_VARIANTS, "A");
export const readScenario = () =>
    readParam<ProtoScenarioKey>("state", PROTO_SCENARIOS, "flip");

export function writeParam(name: string, key: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set(name, key);
    window.history.replaceState(null, "", url.toString());
}

const noop = () => {};
const act = (
    key: string,
    label: string,
    extra: Partial<ControllerAction> = {}
): ControllerAction => ({
    key,
    label,
    tone: "primary",
    disabled: false,
    onClick: noop,
    ...extra,
});

const PASS_TURN = act("pass-turn", "Pass Turn", {
    tone: "destructive",
    shortcut: "P",
});
const UNTIL = act("pass-until-action", "Pass Until Action", {
    tone: "destructive",
    shortcut: "enter",
});

/** Fake controller states — no-op handlers, the question is layout only. */
export function scenarioState(
    key: Exclude<ProtoScenarioKey, "live" | "flip">
): { cue: ControllerCue; actions: ControllerAction[] } {
    switch (key) {
        case "priority":
            return {
                cue: "mine",
                actions: [act("pass", "Pass"), PASS_TURN, UNTIL],
            };
        case "opponent":
            return { cue: "opponent", actions: [] };
        case "waiting":
            return {
                cue: "waiting",
                actions: [
                    act("waiting-opponent", "Opponent declaring blockers...", {
                        disabled: true,
                        pill: true,
                    }),
                ],
            };
        case "auto-pass":
            return {
                cue: "auto-passing",
                actions: [
                    act("auto-pass", "Auto-passing... (cancel)", {
                        tone: "destructive",
                        pill: true,
                    }),
                ],
            };
        case "queued":
            return {
                cue: "auto-passing",
                actions: [
                    act("queued-end-turn", "Pass Turn queued (cancel)", {
                        tone: "destructive",
                        pill: true,
                    }),
                ],
            };
        case "attackers":
            return {
                cue: "mine",
                actions: [
                    act("confirm-attackers", "Confirm Attackers (3)"),
                    act("attack-with-all", "Attack with all (5)"),
                    { ...PASS_TURN, key: "pass-turn-attackers" },
                    UNTIL,
                ],
            };
        case "cast":
            return {
                cue: "mine",
                actions: [
                    act("cancel-cast", "Cancel Cast", { tone: "destructive" }),
                ],
            };
    }
}
