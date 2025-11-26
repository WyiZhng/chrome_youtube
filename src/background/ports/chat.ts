import { createLlm } from "@/utils/llm"
import type { ChatCompletionMessageParam } from "openai/resources"

import type { PlasmoMessaging } from "@plasmohq/messaging"

const SYSTEM = `
You are a helpful assistant, Given the metadata and transcript of a YouTube video. Your primary task is to provide accurate and relevant answers to any questions based on this information. Use the available details effectively to assist users with their inquiries about the video's content, context, or any other related aspects.

START OF METADATA
Video Title: {title}
END OF METADATA

START OF TRANSCRIPT
{transcript}
END OF TRANSCRIPT
`

type ChatCompletionResult =
  | { mode: "stream"; stream: any }
  | { mode: "standard"; content: string }

async function createChatCompletion(
  model: string,
  messages: ChatCompletionMessageParam[],
  context: any
): Promise<ChatCompletionResult> {
  console.log("Context received:", {
    hasOpenAIKey: !!context?.openAIKey,
    hasTranscript: !!context?.transcript,
    hasEvents: !!context?.transcript?.events,
    hasMetadata: !!context?.metadata
  })

  if (!context.openAIKey) {
    throw new Error("OpenAI API key is not set")
  }

  if (!context.transcript || !context.transcript.events) {
    throw new Error("Transcript data is missing. Please make sure the video has captions/subtitles.")
  }

  if (!context.metadata || !context.metadata.title) {
    throw new Error("Video metadata is missing")
  }

  const llm = createLlm(context.openAIKey, model)
  console.log("Creating Chat Completion with model:", model)
  const isCustomModel = model?.startsWith("qwen") || model?.startsWith("deepseek") || model?.startsWith("kimi")

  const parsed = context.transcript.events
    .filter((x: { segs: any }) => x.segs)
    .map((x: { segs: any[] }) => x.segs.map((y: { utf8: any }) => y.utf8).join(" "))
    .join(" ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")

  const SYSTEM_WITH_CONTEXT = SYSTEM.replace("{title}", context.metadata.title).replace(
    "{transcript}",
    parsed
  )
  messages.unshift({ role: "system", content: SYSTEM_WITH_CONTEXT })

  console.log("Messages sent to OpenAI")
  console.log(messages)

  if (isCustomModel) {
    console.log("Using non-streaming mode for Custom model")
    console.log("API Request to iFlow:", {
      baseURL: "https://apis.iflow.cn/v1",
      model: model || "qwen3-max",
      messagesCount: messages.length,
      hasApiKey: !!context.openAIKey
    })
    
    const completion = await llm.chat.completions.create({
      messages,
      model: model || "qwen3-max",
      stream: false,
      max_tokens: 4096,
      temperature: 0.7
    })
    
    console.log("iFlow API Response:", {
      hasChoices: !!completion.choices,
      choicesCount: completion.choices?.length,
      firstChoice: completion.choices?.[0]
    })

    const content =
      completion.choices?.map((choice) => choice.message?.content).join("\n") || ""

    return {
      mode: "standard",
      content
    }
  }

  const stream = await llm.beta.chat.completions.stream({
    messages: messages,
    model: model || "gpt-4o-mini",
    stream: true
  })

  return {
    mode: "stream",
    stream
  }
}

const handler: PlasmoMessaging.PortHandler = async (req, res) => {
  let cumulativeDelta = ""

  const model = req.body.model
  const messages = req.body.messages
  const context = req.body.context

  console.log("=== CHAT PORT DEBUG ===")
  console.log("Model:", model)
  console.log("Messages count:", messages?.length)
  console.log("Has OpenAI Key:", !!context?.openAIKey)
  console.log("API Key (first 10 chars):", context?.openAIKey?.substring(0, 10))
  console.log("Has Transcript:", !!context?.transcript)
  console.log("Transcript events count:", context?.transcript?.events?.length)
  console.log("======================")

  const safeSend = (data: any) => {
    try {
      res.send(data)
    } catch (error) {
      console.warn("Failed to send message to port (likely disconnected):", error)
    }
  }

  try {
    const completion = await createChatCompletion(model, messages, context)

    if (completion.mode === "standard") {
      // 对于非流式响应(Qwen),一次性发送完整内容和结束标记
      safeSend({ 
        message: completion.content + "\nEND", 
        error: null, 
        isEnd: true 
      })
      return
    }

    completion.stream.on("content", (delta, snapshot) => {
      cumulativeDelta += delta
      safeSend({ message: cumulativeDelta, error: null, isEnd: false })
    })

    completion.stream.on("end", () => {
      safeSend({ message: "END", error: null, isEnd: true })
    })
  } catch (error) {
    console.error("=== CHAT ERROR ===")
    console.error("Error type:", error?.constructor?.name)
    console.error("Error message:", error instanceof Error ? error.message : String(error))
    console.error("Error stack:", error instanceof Error ? error.stack : "N/A")
    console.error("Full error object:", error)
    console.error("==================")
    
    const errorMessage = error instanceof Error ? error.message : "Something went wrong"
    safeSend({ error: errorMessage, message: null, isEnd: true })
  }
}

export default handler
