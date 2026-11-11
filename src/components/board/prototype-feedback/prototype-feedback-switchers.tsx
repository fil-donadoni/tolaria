// PROTOTYPE — throwaway (player-feedback 2026-11). Three variants each of three
// board surfaces, switchable via `?pv-density=`, `?pv-turn=`,
// `?pv-preview-tabs=`, `?pv-target-arrow=` on the existing `/game/...` route. No param = the real
// component, untouched.
import { PrototypeSwitcher } from "~/components/prototype/prototype-switcher";

export default function PrototypeFeedbackSwitchers() {
    return (
        <>
            <PrototypeSwitcher
                title="Card size"
                param="pv-density"
                slot={0}
                primary
                variants={[
                    { key: "A", label: "Grow to fill" },
                    { key: "B", label: "Density tiers L/M/S" },
                    { key: "C", label: "Focus band + land strip" },
                ]}
            />
            <PrototypeSwitcher
                title="Turn cue"
                param="pv-turn"
                slot={1}
                variants={[
                    { key: "A", label: "Thick turn frame" },
                    { key: "B", label: "Frame + handoff + tab" },
                    { key: "C", label: "Split edge (my half / theirs)" },
                ]}
            />
            <PrototypeSwitcher
                title="Preview tabs"
                param="pv-preview-tabs"
                slot={2}
                variants={[
                    { key: "A", label: "Underlined tab bar" },
                    { key: "B", label: "Vertical icon rail" },
                    { key: "C", label: "Bottom segmented + keys" },
                ]}
            />
            <PrototypeSwitcher
                title="Target arrow"
                param="pv-target-arrow"
                slot={3}
                variants={[
                    { key: "A", label: "Arena arrow + dim" },
                    { key: "B", label: "Magnet arrow + chips" },
                    { key: "C", label: "Reticle, arrow on hover" },
                ]}
            />
        </>
    );
}
