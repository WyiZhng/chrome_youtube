import Chat from "@/components/chat"
import Summary from "@/components/summary"
import Transcript from "@/components/transcript"
import { useExtension } from "@/contexts/extension-context"
import { openAIKeyAtom } from "@/lib/atoms/openai"
import { useAtomValue } from "jotai"
import React from "react"

import OpenAISetup from "./openai-setup"

interface ExtensionPanelsProps {}

export default function ExtensionPanels({}: ExtensionPanelsProps) {
  const { extensionPanel } = useExtension()
  const openAIKey = useAtomValue(openAIKeyAtom)

  // 添加 key 属性强制重新挂载组件，避免状态污染
  const panelKey = `${extensionPanel}-panel`

  if (!openAIKey) {
    return (
      <div>
        <OpenAISetup />
      </div>
    )
  }
  
  return (
    <div key={panelKey}>
      {extensionPanel === "Summary" && <Summary key="summary" />}
      {extensionPanel === "Transcript" && <Transcript key="transcript" />}
      {extensionPanel === "Chat" && <Chat key="chat" />}
    </div>
  )
}
