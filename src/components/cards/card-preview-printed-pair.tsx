import PrintedFaceImage from "./printed-face-image";
import type { PreviewBodyContent } from "~/lib/preview-body";

// The Printed card view of a TWO-face preview (issue #9795): the presented
// card's print beside the original card's own print, each under its label.
// A presented double-faced card (CR 712) keeps its printed back beside its
// front INSIDE its own column, so the pair never exceeds the host width.
export default function CardPreviewPrintedPair({
    presented,
    original,
    presentedLabel,
    originalLabel,
    onImageLoaded,
}: {
    presented: PreviewBodyContent;
    original: PreviewBodyContent;
    presentedLabel: string;
    originalLabel: string;
    onImageLoaded?: () => void;
}) {
    const front = presented.printedImageId;
    const back = presented.backFaceHalf?.printedImageId;
    const originalPrint = original.printedImageId;
    return (
        <div className="grid w-full grid-cols-2 items-start gap-1 px-1 pt-1">
            <div className="flex min-w-0 flex-col gap-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {presentedLabel}
                </div>
                {front && (
                    <div
                        className={
                            back ? "grid grid-cols-2 gap-1" : "flex flex-col"
                        }
                    >
                        <PrintedFaceImage
                            imageId={front.id}
                            face={front.face}
                            alt={`${presented.displayName} (printed)`}
                            className="w-full card-corner"
                            onLoad={onImageLoaded}
                        />
                        {back && (
                            <PrintedFaceImage
                                imageId={back.id}
                                face={back.face}
                                alt={`${presented.backFaceHalf?.name} (printed back face)`}
                                className="w-full card-corner"
                                backFaceMarker
                            />
                        )}
                    </div>
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {originalLabel}
                </div>
                {originalPrint && (
                    <PrintedFaceImage
                        imageId={originalPrint.id}
                        face={originalPrint.face}
                        alt={`${original.displayName} (printed)`}
                        className="w-full card-corner"
                    />
                )}
            </div>
        </div>
    );
}
