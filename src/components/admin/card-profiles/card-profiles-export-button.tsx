import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
    useCardProfileExport,
    type CardProfileExportLayer,
} from "~/hooks/useCardProfiles";
import { downloadTextFile } from "~/lib/downloadTextFile";

interface CardProfilesExportButtonProps {
    layer: CardProfileExportLayer;
    /** The Archetype layer's scope; the Capability layer has none. */
    scope: string | undefined;
}

/** The rail's Export (PRD #8772, issue #8907): downloads the tab's layer —
 *  its effective rows, DB over seed — in seed-file format
 *  (`capabilities.json` / `<scope>.json`), ready for
 *  `bun run profiles:promote <file>`. Disabled while the export is in
 *  flight, and on the Archetypes tab until a scope is chosen. */
export default function CardProfilesExportButton({
    layer,
    scope,
}: CardProfilesExportButtonProps) {
    const exportLayer = useCardProfileExport();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function run() {
        setPending(true);
        setError(null);
        try {
            const { fileName, text } = await exportLayer(layer, scope);
            downloadTextFile(fileName, text);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-1">
            <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={pending || (layer === "archetypes" && !scope)}
                onClick={() => void run()}
                title="Download this layer in seed-file format for bun run profiles:promote"
                className="self-start"
            >
                <Download aria-hidden="true" />
                {pending ? "Exporting…" : "Export seed file"}
            </Button>
            {error !== null && (
                <p role="alert" className="text-xs text-danger-strong">
                    {error}
                </p>
            )}
        </div>
    );
}
