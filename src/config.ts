/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 读取并校验 CLI 运行所需的环境变量配置。
 * @FilePath: /agents-cli/src/config.ts
 * @LastEditTime: 2026-05-28 10:39:03
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import type { AppConfig } from "./types.js";

const currentFilePath = fileURLToPath(import.meta.url);
const cliProjectEnvPath = path.resolve(
  path.dirname(currentFilePath),
  "..",
  ".env",
);
const cwdEnvPath = path.resolve(process.cwd(), ".env");

/**
 * 加载运行目录和 CLI 项目目录下的 .env 配置。
 *
 * 先加载当前工作目录，允许目标项目提供自己的配置；再加载 CLI 项目根目录，
 * 作为全局命令在其他目录运行时的兜底配置。
 */
function loadEnvFiles(): void {
  loadDotenv({ path: cwdEnvPath, quiet: true });

  if (cliProjectEnvPath !== cwdEnvPath) {
    loadDotenv({ path: cliProjectEnvPath, quiet: true });
  }
}

loadEnvFiles();

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
