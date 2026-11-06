"use client";

import { transcriptFilename, transcriptText, type TranscriptInput } from "@/lib/transcript";

/** "Download transcript (.txt)" for a finished debate (Practice Debate's full transcripts). */
export default function DownloadTranscript(props: TranscriptInput) {
  function download() {
    const blob = new Blob([transcriptText(props)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = transcriptFilename(props.day);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" className="btn btn-ghost self-start px-3 py-1.5 text-xs" onClick={download} data-testid="download-transcript">
      Download transcript (.txt)
    </button>
  );
}
