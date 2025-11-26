import { openAIKeyAtom } from "@/lib/atoms/openai"
import { models, prompts, type Model, type Prompt } from "@/lib/constants"
import { useAtomValue } from "jotai"
import * as React from "react"

import { usePort } from "@plasmohq/messaging/hook"

import { useExtension } from "./extension-context"

interface SummaryContext {
  summaryModel: Model
  setSummaryModel: (model: Model) => void
  summaryPrompt: Prompt
  setSummaryPrompt: (prompt: Prompt) => void
  summaryContent: string | null
  setSummaryContent: (content: string | null) => void
  summaryIsError: boolean
  setSummaryIsError: (isError: boolean) => void
  summaryErrorMessage: string | null
  setSummaryErrorMessage: (message: string | null) => void
  summaryIsGenerating: boolean
  setSummaryIsGenerating: (isGenerating: boolean) => void
  generateSummary: (e: any) => void
}

const SummaryContext = React.createContext<SummaryContext | undefined>(undefined)

export function useSummary() {
  const context = React.useContext(SummaryContext)
  if (!context) {
    throw new Error("useSummary must be used within a SummaryProvider")
  }
  return context
}

interface SummaryProviderProps {
  children: React.ReactNode
}

export function SummaryProvider({ children }: SummaryProviderProps) {
  const port = usePort("completion")
  const openAIKey = useAtomValue(openAIKeyAtom)

  const [summaryModel, setSummaryModel] = React.useState<Model>(models[0])
  const [summaryPrompt, setSummaryPrompt] = React.useState<Prompt>(prompts[0])
  const [summaryContent, setSummaryContent] = React.useState<string | null>(null)
  const [summaryIsError, setSummaryIsError] = React.useState<boolean>(false)
  const [summaryErrorMessage, setSummaryErrorMessage] = React.useState<string | null>(null)
  const [summaryIsGenerating, setSummaryIsGenerating] = React.useState<boolean>(false)

  const { extensionData, extensionLoading } = useExtension()

  // functions to be used in the context

  async function generateSummary(e: any) {
    console.log("Function That Generates Summary Called")
    e.preventDefault()

    // Validate that we have the necessary data
    if (!extensionData?.transcript?.events || extensionData.transcript.events.length === 0) {
      console.error("Cannot generate summary: No transcript data available")
      setSummaryIsError(true)
      setSummaryErrorMessage("No transcript data available")
      setSummaryContent(null)
      return
    }

    if (!openAIKey || openAIKey.trim() === "") {
      console.error("Cannot generate summary: No OpenAI API key")
      setSummaryIsError(true)
      setSummaryErrorMessage("No OpenAI API key")
      setSummaryContent(null)
      return
    }

    if (summaryContent !== null) {
      setSummaryContent(null)
    }

    setSummaryIsGenerating(true)
    setSummaryIsError(false)
    setSummaryErrorMessage(null)
    port.send({
      prompt: summaryPrompt.content,
      model: summaryModel.content,
      context: { ...extensionData, openAIKey }
    })
  }

  // 只在视频切换时重置状态，不在 extensionLoading 变化时重置
  React.useEffect(() => {
    // 当扩展真正加载新视频时才重置（而不是每次 loading 状态变化）
    if (extensionData?.metadata?.title) {
      setSummaryContent(null)
      setSummaryIsGenerating(false)
      setSummaryIsError(false)
      setSummaryErrorMessage(null)
    }
  }, [extensionData?.metadata?.title])

  React.useEffect(() => {
    console.log("Use Effect That Streams Summary Called")
    console.log("Port data:", port.data)
    
    if (!port.data) return
    
    if (port.data?.message !== undefined && port.data?.message !== null) {
      // 对于非流式响应（isEnd=true），也要设置内容
      if (port.data.isEnd === true) {
        console.log("Received final message (non-streaming):", port.data.message)
        // 移除末尾的 "END" 标记
        const content = port.data.message.replace(/\nEND$/, '').replace(/END$/, '')
        setSummaryContent(content)
        setSummaryIsGenerating(false)
        setSummaryIsError(false)
        setSummaryErrorMessage(null)
      } else if (port.data.isEnd === false) {
        // 流式响应，持续更新
        console.log("Streaming message:", port.data.message)
        setSummaryContent(port.data.message)
        setSummaryIsError(false)
        setSummaryErrorMessage(null)
      }
    }
  }, [port.data?.message, port.data?.isEnd])

  React.useEffect(() => {
    console.log("Use Effect That Streams Summary Error Called")
    if (!port.data) return
    
    if (port.data?.error !== undefined && port.data?.error !== null && port.data?.error !== "") {
      setSummaryIsError(true)
      setSummaryErrorMessage(port.data.error)
      setSummaryContent(null)
      setSummaryIsGenerating(false)
    }
  }, [port.data?.error])

  const value = {
    summaryModel,
    setSummaryModel,
    summaryPrompt,
    setSummaryPrompt,
    summaryContent,
    setSummaryContent,
    summaryIsError,
    setSummaryIsError,
    summaryErrorMessage,
    setSummaryErrorMessage,
    summaryIsGenerating,
    setSummaryIsGenerating,
    generateSummary
  }

  return <SummaryContext.Provider value={value}>{children}</SummaryContext.Provider>
}
