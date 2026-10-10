// PROTOTYPE — throwaway. B: recap rail, Pack Source as a hero showcase.
import SetupFrame from "./setup-frame";
import SetupRailLayout from "./setup-rail-layout";
import SetupPackHero from "./setup-pack-hero";

export default function VariantBHero() {
    return (
        <SetupFrame>
            {(api) => (
                <SetupRailLayout
                    api={api}
                    packStep={<SetupPackHero {...api} />}
                />
            )}
        </SetupFrame>
    );
}
