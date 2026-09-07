import { LightButton } from "./LightButton";
import { nowLights } from "../../lib/nowLights";
import type { NowPayload } from "../../lib/nowPayload";

/** The four traffic lights, in reading order (#2630). */
export function Lights({ data }: { data: NowPayload }) {
    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {nowLights(data).map((light) => (
                <LightButton key={light.id} light={light} />
            ))}
        </div>
    );
}
