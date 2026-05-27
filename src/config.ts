/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 读取并校验 CLI 运行所需的环境变量配置。
 * @FilePath: /agents-cli/src/config.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import "dotenv/config";

import { z } from "zod";

import type { AppConfig } from "./types.js";

const configSchema = z.object({
  dashscopeApiKey: z.string().min(1, "缺少 DASHSCOPE_API_KEY"),
  tavilyApiKey: z.string().optional(),
  llmBaseUrl: z
    .string()
    .url()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  llmModel: z.string().min(1).default("qwen-plus"),
});

/**
 * 读取并校验运行所需的环境变量。
 *
 * Tavily Key 是可选项，因为命令型任务不需要联网搜索；当任务实际进入搜索 Agent
 * 时，再由搜索工具进行强校验。
 */
export function loadConfig(): AppConfig {
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error("缺少 DASHSCOPE_API_KEY，请在 .env 中配置通义 API Key。");
  }

  return configSchema.parse({
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
    tavilyApiKey: process.env.TAVILY_API_KEY,
    llmBaseUrl:
      process.env.LLM_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    llmModel: process.env.LLM_MODEL ?? "qwen-plus",
  });
}

/**
 * 在进入搜索流程前校验 Tavily Key。
 */
export function requireTavilyApiKey(config: AppConfig): string {
  if (!config.tavilyApiKey) {
    throw new Error("缺少 TAVILY_API_KEY，资料搜索任务需要配置 Tavily API Key。");
  }

  return config.tavilyApiKey;
}
