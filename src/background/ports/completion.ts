import { createLlm } from "@/utils/llm"

import type { PlasmoMessaging } from "@plasmohq/messaging"

// const SYSTEM = "Given the transcript of a YouTube video along with relevant video metadata (such as video title, description), produce contextually relevant content as requested by the user. The output should be engaging and informative."

type CompletionResult =
  | { mode: "stream"; stream: any }
  | { mode: "standard"; content: string }

async function createCompletion(model: string, prompt: string, context: any): Promise<CompletionResult> {
  console.log("Context received:", {
    hasOpenAIKey: !!context?.openAIKey,
    hasTranscript: !!context?.transcript,
    hasEvents: !!context?.transcript?.events,
    hasMetadata: !!context?.metadata,
    transcriptType: typeof context?.transcript
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
  const isCustomModel = model?.startsWith("qwen") || model?.startsWith("deepseek") || model?.startsWith("kimi")

  console.log("Creating Completion with model:", model)

  const parsed = context.transcript.events
    .filter((x: { segs: any }) => x.segs)
    .map((x: { segs: any[] }) => x.segs.map((y: { utf8: any }) => y.utf8).join(" "))
    .join(" ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")

  const USER = `${prompt}\n\nVideo Title: ${context.metadata.title}\nVideo Transcript: ${parsed}`

  console.log("User Prompt")
  console.log(USER)

  if (isCustomModel) {
    console.log("Using non-streaming mode for Custom model")
    console.log("API Request to iFlow:", {
      baseURL: "https://apis.iflow.cn/v1",
      model: model || "qwen3-max",
      messageLength: USER.length,
      hasApiKey: !!context.openAIKey
    })
    
    const completion = await llm.chat.completions.create({
      messages: [{ role: "user", content: USER }],
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
    messages: [{ role: "user", content: USER }],
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

  const prompt = req.body.prompt
  const model = req.body.model
  const context = req.body.context

  console.log("=== COMPLETION PORT DEBUG ===")
  console.log("Prompt:", prompt)
  console.log("Model:", model)
  console.log("Context keys:", Object.keys(context || {}))
  console.log("Has OpenAI Key:", !!context?.openAIKey)
  console.log("API Key (first 10 chars):", context?.openAIKey?.substring(0, 10))
  console.log("Has Transcript:", !!context?.transcript)
  console.log("Transcript events count:", context?.transcript?.events?.length)
  console.log("=============================")

  const safeSend = (data: any) => {
    try {
      res.send(data)
    } catch (error) {
      console.warn("Failed to send message to port (likely disconnected):", error)
    }
  }

  try {
    const completion = await createCompletion(model, prompt, context)

    if (completion.mode === "standard") {
      // 对于非流式响应(Qwen),一次性发送完整内容和结束标记
      safeSend({ 
        message: completion.content + "\nEND", 
        error: "", 
        isEnd: true 
      })
      return
    }

    completion.stream.on("content", (delta, snapshot) => {
      cumulativeDelta += delta
      safeSend({ message: cumulativeDelta, error: "", isEnd: false })
    })

    completion.stream.on("end", () => {
      safeSend({ message: "END", error: "", isEnd: true })
    })
  } catch (error) {
    console.error("=== COMPLETION ERROR ===")
    console.error("Error type:", error?.constructor?.name)
    console.error("Error message:", error instanceof Error ? error.message : String(error))
    console.error("Error stack:", error instanceof Error ? error.stack : "N/A")
    console.error("Full error object:", error)
    console.error("========================")
    
    const errorMessage = error instanceof Error ? error.message : "Something went wrong"
    safeSend({ error: errorMessage, message: null, isEnd: true })
  }
}

export default handler