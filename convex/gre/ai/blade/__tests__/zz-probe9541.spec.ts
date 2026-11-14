import { it } from "vitest";
import {
    runBladeScenario,
    buildBladeState,
    bladeDeckKnowledge,
} from "../runner";
import { searchWithTrace } from "../../../search";
import { seatPlayerId } from "../matcher";
import type { BladeScenario } from "../types";

const opp = [
    { name: "Serra Angel", owner: "opp", zone: "hand" },
    { name: "Swords to Plowshares", owner: "opp", zone: "hand" },
    { name: "Swords to Plowshares", owner: "opp", zone: "hand" },
    {
        name: "Serra Angel",
        owner: "opp",
        zone: "battlefield",
        summoningSick: false,
    },
    {
        name: "Serra Angel",
        owner: "opp",
        zone: "battlefield",
        summoningSick: false,
    },
    ...Array.from({ length: 5 }, () => ({
        name: "Plains",
        owner: "opp",
        zone: "battlefield",
    })),
];
const mine = (process.env.PROBE_MINE ?? "")
    .split(",")
    .filter(Boolean)
    .map((name) => ({
        name,
        owner: "me",
        zone: "battlefield",
        summoningSick: false,
    }));
const deck = {
    seat: "opp",
    cards: [
        ...Array(6).fill("Serra Angel"),
        ...Array(6).fill("Swords to Plowshares"),
        ...Array(18).fill("Plains"),
    ],
};
const iters = Number(process.env.PROBE_ITERS ?? 400);
const phase = (process.env.PROBE_PHASE ?? "PRECOMBAT_MAIN") as never;
const scenarios: BladeScenario[] = [
    {
        label: "probe mindslaver",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Mindslaver", owner: "me", zone: "battlefield" },
                ...Array.from({ length: 4 }, () => ({
                    name: "Island",
                    owner: "me",
                    zone: "battlefield",
                })),
                ...mine,
                ...opp,
            ],
            phase,
            turn: 6,
            landCount: 0,
            libraryCount: 20,
            ...(process.env.PROBE_OPPTURN
                ? { activePlayer: "opp", priority: "me" }
                : {}),
        },
        deckKnowledge: [deck],
        bot: "me",
        budget: { iterations: iters },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
        note: "probe",
    } as unknown as BladeScenario,
    {
        label: "probe worst fears",
        classification: { kind: "absolute" },
        spec: {
            cards: [
                { name: "Worst Fears", owner: "me", zone: "hand" },
                ...Array.from({ length: 8 }, () => ({
                    name: "Swamp",
                    owner: "me",
                    zone: "battlefield",
                })),
                ...mine,
                ...opp,
            ],
            phase: (process.env.PROBE_WF_PHASE ?? "PRECOMBAT_MAIN") as never,
            turn: 6,
            landCount: 0,
            libraryCount: 20,
        },
        deckKnowledge: [deck],
        bot: "me",
        budget: { iterations: iters },
        seeds: [0xb1ade, 1, 2, 3, 4],
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
        note: "probe",
    } as unknown as BladeScenario,
];
const only = process.env.PROBE_ONLY;
for (const s of scenarios) {
    if (only && !s.label.includes(only)) continue;
    it(
        s.label,
        () => {
            if (process.env.PROBE_TRACE) {
                const st = buildBladeState(s);
                const bot = seatPlayerId(st, "me");
                const t = searchWithTrace(
                    st,
                    bot,
                    { iterations: iters },
                    0xb1ade,
                    bladeDeckKnowledge(st, s)
                ).trace!;
                console.log(`PROBE TRACE ${s.label} mech=${t.mechanism}`);
                for (const c of t.candidates)
                    console.log(
                        `PROBE   ${c.label} v=${c.visits} mean=${c.meanReward.toFixed(4)} one=${c.oneplyReward?.toFixed(4)} score=${c.score.toFixed(4)} margin=${c.meanMargin.toFixed(1)}`
                    );
            }
            const r = runBladeScenario(s);
            for (const x of r.seeds)
                console.log(
                    `PROBE ${s.label} seed=${x.seed} move=[${x.moveDescription}] mech=${x.mechanism}`
                );
        },
        600000
    );
}
