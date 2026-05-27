/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 创建通义千问 OpenAI 兼容模型实例。
 * @FilePath: /agents-cli/src/llm.ts
 * @LastEditTime: 2026-05-27 19:18:14
 */
import { ChatOpenAI } from "@langchain/openai";

import type { AppConfig } from "./types.js";

/**
 * 创建通义千问 OpenAI 兼容模型实例。
 *
 * LangChain 的 ChatOpenAI 底层使用 OpenAI SDK，这里通过 baseURL 指向
 * 阿里云百炼兼容接口，从而复用 LangChain 的标准模型调用能力。
 */
export function createChatModel(config: AppConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.llmModel,
    apiKey: config.dashscopeApiKey,
    temperature: 0.2,
    maxRetries: 2,
    configuration: {
      baseURL: config.llmBaseUrl,
    },
  });
}
