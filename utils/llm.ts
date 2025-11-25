import OpenAI from "openai"

export const createLlm = (apiKey: string, model?: string) => {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API key is required. Please add your API key in the extension settings.")
  }

  // Check if using Qwen models
  const isQwen = model?.startsWith('qwen')
  
  return new OpenAI({
    apiKey: apiKey.trim(),
    baseURL: isQwen ? 'https://apis.iflow.cn/v1' : undefined,
    dangerouslyAllowBrowser: true
  })
}
