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
  const isQwenModel = model?.startsWith("qwen")

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

  if (isQwenModel) {
    console.log("Using non-streaming mode for Qwen model")
    const completion = await llm.chat.completions.create({
      messages,
      model: model || "qwen-plus",
      stream: false
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

  console.log("Model")
  console.log(model)
  console.log("Messages")
  console.log(messages)
  console.log("Context")
  console.log(context)

  try {
    const completion = await createChatCompletion(model, messages, context)

    if (completion.mode === "standard") {
      res.send({ message: completion.content, error: null, isEnd: false })
      res.send({ message: "END", error: null, isEnd: true })
      return
    }

    completion.stream.on("content", (delta, snapshot) => {
      cumulativeDelta += delta
      res.send({ message: cumulativeDelta, error: null, isEnd: false })
    })

    completion.stream.on("end", () => {
      res.send({ message: "END", error: null, isEnd: true })
    })
  } catch (error) {
    console.error("Chat completion error:", error)
    const errorMessage = error instanceof Error ? error.message : "Something went wrong"
    res.send({ error: errorMessage, message: null, isEnd: true })
  }
}

export default handler
