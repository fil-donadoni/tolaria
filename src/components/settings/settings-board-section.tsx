import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import BattlefieldGroupingOptions from "~/components/board/battlefield-grouping-options";

/**
 * Board Settings section (issue #7429). Per-device board presentation — not a
 * server-side user setting like density or motion: the value lives in
 * localStorage (`src/lib/boardViewPrefs.ts`), so it needs no loading state.
 */
export default function SettingsBoardSection() {
    return (
        <Panel>
            <PanelHeader
                title="Board"
                subtitle="How identical permanents lay out on the battlefield"
            />
            <PanelBody>
                <BattlefieldGroupingOptions legendVisible={false} />
            </PanelBody>
        </Panel>
    );
}
