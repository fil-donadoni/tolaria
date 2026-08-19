// PROTOTYPE — throwaway route (`/prototype/touch`). Sub-shape B: the Draft
// Room does not exist yet and the deckbuilder's touch model is the thing
// being re-decided, so the contested pieces of PRD #2405 live on one
// throwaway route with mock data and no persistence:
//
//   ?surface=builder   3-tab deckbuilder, MV rows / pile columns, peek sheet
//   ?surface=draft     pack/pool two-stop snap + strip drop target
//   ?surface=prompt    chamfer prompt A/B
//   ?variant=A|B|C     #G1 gesture model (builder, draft) · A/B (prompt)
//
// Delete `src/components/prototype/` + this route once the decisions land
// (kept on the throwaway branch as the primary source).
import { getRouteApi } from "@tanstack/react-router";
import PrototypeSwitcher from "~/components/prototype/prototype-switcher";
import TouchBuilderSurface from "~/components/prototype/touch/touch-builder-surface";
import TouchDraftSurface from "~/components/prototype/touch/touch-draft-surface";
import TouchPromptSurface from "~/components/prototype/touch/touch-prompt-surface";
import {
    PROMPT_VARIANTS,
    type PromptVariant,
} from "~/components/prototype/touch/prompt-variants";
import {
    GESTURE_MODELS,
    type GestureModel,
} from "~/components/prototype/touch/use-touch-move-engine";

type TouchSurface = "builder" | "draft" | "prompt";
const SURFACES: TouchSurface[] = ["builder", "draft", "prompt"];

const routeApi = getRouteApi("/prototype/touch");

export default function PrototypeTouchRoute() {
    const { variant, surface } = routeApi.useSearch();
    const navigate = routeApi.useNavigate();
    const s: TouchSurface = surface ?? "builder";
    const variants = s === "prompt" ? PROMPT_VARIANTS : GESTURE_MODELS;
    const v =
        variant && variants.some((x) => x.key === variant) ? variant : "A";

    const setVariant = (key: string) =>
        navigate({ search: { surface: s, variant: key }, replace: true });
    const setSurface = (next: TouchSurface) =>
        navigate({ search: { surface: next, variant: "A" }, replace: true });

    return (
        <>
            {s === "builder" ? (
                <TouchBuilderSurface key={v} model={v as GestureModel} />
            ) : null}
            {s === "draft" ? (
                <TouchDraftSurface key={v} model={v as GestureModel} />
            ) : null}
            {s === "prompt" ? (
                <TouchPromptSurface variant={v as PromptVariant} />
            ) : null}
            <PrototypeSwitcher
                variants={variants}
                current={v}
                onChange={setVariant}
                extra={
                    <div className="flex gap-1 rounded-full bg-black/70 p-1 text-[11px] text-white ring-1 ring-white/20">
                        {SURFACES.map((x) => (
                            <button
                                key={x}
                                type="button"
                                onClick={() => setSurface(x)}
                                className={`rounded-full px-2.5 py-1 ${x === s ? "bg-white text-black" : ""}`}
                            >
                                {x}
                            </button>
                        ))}
                    </div>
                }
            />
        </>
    );
}
