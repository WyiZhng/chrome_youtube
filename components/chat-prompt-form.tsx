import { Button } from "@/components/ui/button"
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper"
import { useChat } from "@/contexts/chat-context"
import { useExtension } from "@/contexts/extension-context"
import { openAIKeyAtom } from "@/lib/atoms/openai"
import { useEnterSubmit } from "@/lib/hooks/use-enter-submit"
import { cn } from "@/lib/utils"
import { PaperPlaneIcon } from "@radix-ui/react-icons"
import { useAtomValue } from "jotai"
import React, { useEffect, useRef } from "react"
import Textarea from "react-textarea-autosize"

import { usePort } from "@plasmohq/messaging/hook"

interface PromptFormProps {
  className?: string
}

type Message = {
  role: string
  content: string
}

export default function PromptForm({ className }: PromptFormProps) {
  const port = usePort("chat")
  const { extensionData } = useExtension()
  const openAIKey = useAtomValue(openAIKeyAtom)

  const {
    chatMessages,
    chatPrompt,
    setChatPrompt,
    setChatMessages,
    setChatIsGenerating,
    setChatIsError,
    chatModel
  } = useChat()

  const { formRef, onKeyDown, onKeyUp } = useEnterSubmit()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  async function generateChat(model: string, messages: any) {
    console.log("Function That Generates Chat Called")

    // Validate that we have the necessary data
    if (!extensionData?.transcript?.events || extensionData.transcript.events.length === 0) {
      console.error("Cannot generate chat: No transcript data available")
      setChatIsError(true)
      setChatIsGenerating(false)
      // Add error message to chat
      setChatMessages([
        ...chatMessages,
        {
          role: "assistant",
          content: "Error: This video doesn't have captions/subtitles. Chat functionality requires captions to work."
        }
      ])
      return
    }

    if (!openAIKey || openAIKey.trim() === "") {
      console.error("Cannot generate chat: No OpenAI API key")
      setChatIsError(true)
      setChatIsGenerating(false)
      // Add error message to chat
      setChatMessages([
        ...chatMessages,
        {
          role: "assistant",
          content: "Error: OpenAI API key is not set. Please add your API key in the settings."
        }
      ])
      return
    }

    setChatIsGenerating(true)
    setChatIsError(false)

    console.log("Chat messages Before server")
    console.log(chatMessages)

    port.send({
      model: model,
      messages: messages,
      context: { ...extensionData, openAIKey }
    })
  }

  React.useEffect(() => {
    console.log("Use Effect That Generates Chat Called")
    console.log("Port data:", port.data)
    
    if (!port.data) return

    if (port.data?.message !== undefined && port.data?.message !== null) {
      // 处理非流式响应（isEnd=true）
      if (port.data.isEnd === true) {
        console.log("Received final chat message (non-streaming):", port.data.message)
        
        // 移除末尾的 "END" 标记
        const content = port.data.message.replace(/\nEND$/, '').replace(/END$/, '')
        
        // 如果最后一条是用户消息，添加新的助手消息
        if (chatMessages[chatMessages.length - 1].role === "user") {
          setChatMessages([
            ...chatMessages,
            {
              role: "assistant",
              content: content
            }
          ])
        } else {
          // 否则更新最后一条助手消息
          const newMessages = [...chatMessages]
          newMessages[newMessages.length - 1].content = content
          setChatMessages(newMessages)
        }
        
        setChatIsGenerating(false)
        setChatIsError(false)
      } 
      // 处理流式响应（isEnd=false）
      else if (port.data.isEnd === false) {
        console.log("Streaming chat message:", port.data.message)
        
        if (chatMessages[chatMessages.length - 1].role === "user") {
          setChatMessages([
            ...chatMessages,
            {
              role: "assistant",
              content: port.data.message
            }
          ])
        } else {
          const newMessages = [...chatMessages]
          newMessages[newMessages.length - 1].content = port.data.message
          setChatMessages(newMessages)
        }
        
        setChatIsError(false)
      }
    }
  }, [port.data?.message, port.data?.isEnd])

  // React.useEffect(() => {
  //       setChatMessages([
  //     ...chatMessages,
  //     {
  //       role: "assistant",
  //       content: port.data.message
  //     }
  //   ])
  // },

  return (
    <form
      ref={formRef}
      className={cn(
        "absolute bottom-0 z-10 p-4 w-full dark:bg-[#0f0f0f] bg-white",
        className
      )}
      onSubmit={async (e: any) => {
        e.preventDefault()

        // Blur focus on mobile
        if (window.innerWidth < 600) {
          e.target["message"]?.blur()
        }

        const value = chatPrompt.trim()
        setChatPrompt("")
        if (!value) return

        console.log("value")
        console.log(value)

        const initialMessages = [...chatMessages]

        // Optimistically add user message UI
        setChatMessages([
          ...initialMessages,
          {
            role: "user",
            content: value
          }
        ])

        console.log("Chat messages Before")
        console.log(chatMessages)

        // Send message to chat context
        await generateChat(chatModel.content, [
          ...initialMessages,
          {
            role: "user",
            content: value
          }
        ])

        // var response = await generateChat(e)
      }}>
      <div className="relative flex max-h-60 w-full grow flex-col overflow-hidden rounded-md  border border-zinc-200 dark:border-zinc-800">
        {/* <div className="absolute left-0 top-4 pl-3">
          <TooltipWrapper text="Tools">
            <Button variant="outline" size="icon">
              <LightningBoltIcon className="h-4 w-4 opacity-50" />
            </Button>
          </TooltipWrapper>
        </div> */}

        <Textarea
          ref={inputRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          placeholder="Send a message."
          className="min-h-[50px] w-full resize-none bg-transparent px-6 py-6 focus-within:outline-none text-[12px]"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          name="message"
          rows={1}
          value={chatPrompt}
          onChange={(e) => setChatPrompt(e.target.value)}
        />

        {/* Center using top */}
        <div className="absolute right-0 top-[10px] pr-3">
          <TooltipWrapper text="Send message">
            <Button
              type="submit"
              size="icon"
              variant="outline"
              disabled={chatPrompt === ""}
              className="size-[32px]">
              <PaperPlaneIcon className="h-4.5 w-4.5" />
            </Button>
          </TooltipWrapper>
        </div>
      </div>
    </form>
  )
}
