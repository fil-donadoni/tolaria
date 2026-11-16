import type { ControllerCue } from "~/hooks/useControllerActions";

/** The plain-language words for each controller cue (#331): the cue badge's
 *  label, and — on the desktop pod (issue #9835) — the primary pill's text
 *  when the step offers the viewer nothing to click, with the 5–8 word
 *  description its hover tooltip adds under it. */
export const CONTROLLER_CUE_COPY: Record<
    ControllerCue,
    { label: string; description: string }
> = {
    mine: {
        label: "Your Go",
        description: "Answer the open prompt to continue",
    },
    opponent: {
        label: "Opponent to act",
        description: "They hold priority; you can queue a pass",
    },
    waiting: {
        label: "Waiting on opponent",
        description: "Nothing to do until they decide",
    },
    "auto-passing": {
        label: "Auto-passing",
        description: "A pass is running for you",
    },
};
