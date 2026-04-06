import { useGameContext } from "~/hooks/useGameContext";

type PhaseGroup = {
    label: string;
    steps: { id: string; short: string }[];
};

const PHASE_GROUPS: PhaseGroup[] = [
    {
        label: "Beginning",
        steps: [
            { id: "UNTAP", short: "UT" },
            { id: "UPKEEP", short: "UK" },
            { id: "DRAW", short: "DR" },
        ],
    },
    {
        label: "Main 1",
        steps: [{ id: "PRECOMBAT_MAIN", short: "M1" }],
    },
    {
        label: "Combat",
        steps: [
            { id: "BEGINNING_OF_COMBAT", short: "BC" },
            { id: "DECLARE_ATTACKERS", short: "DA" },
            { id: "DECLARE_BLOCKERS", short: "DB" },
            { id: "COMBAT_DAMAGE", short: "CD" },
            { id: "END_OF_COMBAT", short: "EC" },
        ],
    },
    {
        label: "Main 2",
        steps: [{ id: "POSTCOMBAT_MAIN", short: "M2" }],
    },
    {
        label: "Ending",
        steps: [
            { id: "END_STEP", short: "ES" },
            { id: "CLEANUP", short: "CL" },
        ],
    },
];

export default function PhaseTracker() {
    const { phase, turn, activePlayerId, playerId } = useGameContext();
    const isMyTurn = activePlayerId === playerId;

    return (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1 px-1.5 py-2 bg-black/60 rounded-r-lg">
            <div
                className={`text-[10px] font-bold text-center mb-0.5 ${isMyTurn ? "text-green-400" : "text-red-400"}`}
            >
                T{turn}
            </div>
            {PHASE_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-px">
                    {group.steps.map((step) => {
                        const isCurrent = step.id === phase;
                        return (
                            <div
                                key={step.id}
                                className={`text-[9px] leading-tight px-1 py-px rounded text-center transition-colors ${
                                    isCurrent
                                        ? "bg-amber-400 text-black font-bold"
                                        : "text-white/40"
                                }`}
                                title={step.id}
                            >
                                {step.short}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
