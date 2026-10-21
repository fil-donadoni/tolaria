import { CockpitView } from "./components/cockpit/CockpitView";
import { useCockpit } from "./lib/cockpit";

/**
 * The cockpit (issue #5652, ADR 0156 Amendment I § The dashboard is
 * simplified, not removed): one page of trends over the reading
 * `bun run cockpit` took. The Now and History views of PRD #3148 are gone.
 */
export function App() {
    return <CockpitView state={useCockpit()} />;
}
