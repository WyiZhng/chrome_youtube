import OpenAI from "openai"

export const createLlm = (apiKey: string, model?: string) => {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API key is required. Please add your API key in the extension settings.")
  }

  // Check if using Custom models (Qwen, DeepSeek, Kimi)
  const isCustomModel = model?.startsWith('qwen') || model?.startsWith('deepseek') || model?.startsWith('kimi')
  
  return new OpenAI({
    apiKey: apiKey.trim(),
    baseURL: isCustomModel ? 'https://apis.iflow.cn/v1' : undefined,
    dangerouslyAllowBrowser: true
  })
}
