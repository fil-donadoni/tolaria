// PROTOTYPE — throwaway. A: recap rail, Pack Source as art tiles.
import SetupFrame from "./setup-frame";
import SetupRailLayout from "./setup-rail-layout";
import SetupPackTiles from "./setup-pack-tiles";

export default function VariantARail() {
    return (
        <SetupFrame>
            {(api) => (
                <SetupRailLayout
                    api={api}
                    packStep={<SetupPackTiles {...api} />}
                />
            )}
        </SetupFrame>
    );
}
