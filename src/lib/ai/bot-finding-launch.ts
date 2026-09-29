// What a Bot Findings Reproducer label can DO on the page (PRD #4174 stories
// 32-35, issue #4178). A label names either a saved scenario or a blade entry;
// the page offers only the action that can work:
//
//   - a saved scenario, or a blade entry whose position is a plain board →
//     `launch`, through the one scenario-launch path (`useScenarioTestGame`);
//   - a blade entry that needs `setup`/`revisit` steps to exist → `command`, a
//     copy-command that re-runs it — never a launch button that could not work;
//   - a label that names nothing this build knows → `unknown`, shown as text.
import type { ScenarioLaunch } from "~/hooks/useScenarioTestGame";
import bladeReproducers from "../../../data/blade-reproducers.json";

/** `data/blade-reproducers.json`: label → the spec (plain board) or `null`
 *  (needs setup steps) — `bun run blade:card-index` writes it. */
const BLADE_REPRODUCERS: Readonly<Record<string, unknown>> = bladeReproducers;

export type ReproducerAction =
    | {
          readonly kind: "launch";
          readonly label: string;
          readonly launch: ScenarioLaunch;
      }
    | {
          readonly kind: "command";
          readonly label: string;
          readonly command: string;
      }
    | { readonly kind: "unknown"; readonly label: string };

/** The shell command that re-runs ONE blade entry by its label. Single-quoted
 *  so a label carrying `'`, `:` or `(` survives a paste into a shell. */
export function bladeEntryCommand(label: string): string {
    return `bunx vitest run --config vitest.blade.config.ts -t '${label.replaceAll("'", `'\\''`)}'`;
}

/** Resolve one label. A saved scenario wins over a blade entry of the same
 *  name: it is the row the admin can open and edit. */
export function resolveReproducer(
    label: string,
    savedScenarios: readonly ScenarioLaunch[],
    blade: Readonly<Record<string, unknown>> = BLADE_REPRODUCERS
): ReproducerAction {
    const saved = savedScenarios.find((s) => s.label === label);
    if (saved !== undefined) return { kind: "launch", label, launch: saved };
    if (!Object.hasOwn(blade, label)) return { kind: "unknown", label };
    const spec = blade[label];
    if (spec === null)
        return { kind: "command", label, command: bladeEntryCommand(label) };
    // A blade position has no row of its own: its label is its stable key.
    return {
        kind: "launch",
        label,
        launch: { _id: `blade:${label}`, label, spec },
    };
}

/** What the page hands every row so it can launch a Reproducer: the saved
 *  scenarios labels resolve against, and the one launcher
 *  (`useScenarioTestGame`) owned by the page. */
export interface FindingLaunchActions {
    readonly savedScenarios: readonly ScenarioLaunch[];
    readonly launchingId: string | null;
    readonly onLaunch: (launch: ScenarioLaunch) => void;
}
