import Markdown from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { useSummary } from "@/contexts/summary-context"
import { useExtension } from "@/contexts/extension-context"

import SummarySkeleton from "./summary-skeleton"

export default function SummaryContent() {
  const { summaryIsGenerating, summaryContent, summaryIsError, summaryErrorMessage, generateSummary } = useSummary()
  const { extensionData, extensionLoading } = useExtension()

  // Check if transcript data is available
  const hasTranscript = extensionData?.transcript?.events && extensionData.transcript.events.length > 0

  if (summaryIsError) {
    return (
      <div className="flex flex-col justify-center items-center w-full p-6 bg-white dark:bg-[#0f0f0f] space-y-3">
        <div className="text-red-500 dark:text-red-400 text-sm text-center">
          ❌ {summaryErrorMessage || "Failed to generate summary. Please check your API key and try again."}
        </div>
        <Button variant="outline" className="w-full h-12" onClick={generateSummary} disabled={!hasTranscript}>
          <span className="text-sm">Retry</span>
        </Button>
      </div>
    )
  }

  if (!hasTranscript && !extensionLoading) {
    return (
      <div className="flex flex-col justify-center items-center w-full p-6 bg-white dark:bg-[#0f0f0f] space-y-3">
        <div className="text-yellow-600 dark:text-yellow-400 text-sm text-center">
          ⚠️ This video doesn't have captions/subtitles available.
          <br />
          Summary and chat features require captions to work.
        </div>
      </div>
    )
  }

  if (!summaryContent && summaryIsGenerating) {
    return (
      <div className="flex justify-center items-center w-full p-3 bg-white dark:bg-[#0f0f0f]">
        <SummarySkeleton />
      </div>
    )
  }

  if (!summaryContent && !summaryIsGenerating) {
    return (
      <div className="flex justify-center items-center w-full p-3 bg-white dark:bg-[#0f0f0f]">
        <Button 
          variant="outline" 
          className="w-full h-12" 
          onClick={generateSummary}
          disabled={!hasTranscript || extensionLoading}
        >
          <span className="text-sm">
            {extensionLoading ? "Loading video data..." : "Generate Summary"}
          </span>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex justify-center items-center w-full p-3 bg-white dark:bg-[#0f0f0f]">
      <div className="h-[600px] w-full px-3 opacity-80">
        <Markdown markdown={summaryContent} className="pb-6" />
      </div>
    </div>
  )
}
