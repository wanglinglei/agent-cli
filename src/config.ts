/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 读取并校验 CLI 运行所需的环境变量配置。
 * @FilePath: /agents-cli/src/config.ts
 * @LastEditTime: 2026-06-10 00:00:00
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import type { AppConfig, PexelsMcpConnectionConfig } from "./types.js";

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
  showFullDebugInfo: z.boolean().default(false),
  tavilyApiKey: z.string().optional(),
  weatherApiHost: z.string().url().optional(),
  weatherApiToken: z.string().optional(),
  amapMcpUrl: z.string().url().optional(),
  amapMapsApiKey: z.string().optional(),
  pexelsMcpCommand: z.string().optional(),
  pexelsMcpArgs: z.string().optional(),
  pexelsApiKey: z.string().optional(),
  llmBaseUrl: z
    .string()
    .url()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  llmModel: z.string().min(1).default("qwen-plus"),
});

/**
 * 解析布尔环境变量。
 *
 * 输入环境变量原始值和默认值，输出布尔配置；支持 true/false、1/0、yes/no、
 * on/off，无法识别时回退默认值，避免日志配置影响主流程启动。
 */
function parseBooleanEnv(rawValue: string | undefined, defaultValue: boolean): boolean {
  const normalized = rawValue?.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

/**
 * 读取是否展示完整调试链路。
 *
 * 输入来自环境变量，输出日志模式开关；默认 false 以减少普通运行输出噪音。
 */
export function isFullDebugInfoEnabled(): boolean {
  return parseBooleanEnv(process.env.DEBUG, false);
}

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
    showFullDebugInfo: isFullDebugInfoEnabled(),
    tavilyApiKey: process.env.TAVILY_API_KEY,
    weatherApiHost: process.env.WEATHER_API_HOST,
    weatherApiToken: process.env.WEATHER_API_TOKEN,
    amapMcpUrl: process.env.AMAP_MCP_URL,
    amapMapsApiKey: process.env.AMAP_MAPS_API_KEY,
    pexelsMcpCommand: process.env.PEXELS_MCP_COMMAND,
    pexelsMcpArgs: process.env.PEXELS_MCP_ARGS,
    pexelsApiKey: process.env.PEXELS_API_KEY,
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

/**
 * 在进入天气流程前校验和风天气配置。
 */
export function requireWeatherApiConfig(config: AppConfig): {
  apiHost: string;
  apiToken: string;
} {
  if (!config.weatherApiHost) {
    throw new Error("缺少 WEATHER_API_HOST，天气查询任务需要配置和风天气 API Host。");
  }

  if (!config.weatherApiToken) {
    throw new Error("缺少 WEATHER_API_TOKEN，天气查询任务需要配置和风天气 API Token。");
  }

  return {
    apiHost: config.weatherApiHost,
    apiToken: config.weatherApiToken,
  };
}

/**
 * 在进入高德地图 MCP 工具前解析连接地址。
 */
export function requireAmapMcpUrl(config: AppConfig): string {
  if (config.amapMcpUrl) {
    return config.amapMcpUrl;
  }

  if (config.amapMapsApiKey) {
    const url = new URL("https://mcp.amap.com/mcp");
    url.searchParams.set("key", config.amapMapsApiKey);
    return url.toString();
  }

  throw new Error(
    "缺少 AMAP_MCP_URL 或 AMAP_MAPS_API_KEY，旅行规划任务需要配置高德地图 MCP。",
  );
}

/**
 * 解析 Pexels stdio MCP 命令参数。
 *
 * 支持 JSON 字符串数组和简单空白分隔两种写法；JSON 解析失败时抛出明确错误，
 * 避免把错误参数传给 MCP 子进程。
 */
function parsePexelsMcpArgs(args?: string): string[] {
  const trimmedArgs = args?.trim();
  if (!trimmedArgs) {
    return [];
  }

  if (trimmedArgs.startsWith("[")) {
    const parsedArgs = JSON.parse(trimmedArgs);
    if (
      Array.isArray(parsedArgs) &&
      parsedArgs.every((item): item is string => typeof item === "string")
    ) {
      return parsedArgs;
    }

    throw new Error("PEXELS_MCP_ARGS 使用 JSON 数组时，数组项必须都是字符串。");
  }

  return trimmedArgs.split(/\s+/);
}

/**
 * 在进入 Pexels MCP 工具前解析连接配置。
 */
export function requirePexelsMcpConfig(
  config: AppConfig,
): PexelsMcpConnectionConfig {
  if (config.pexelsMcpCommand) {
    return {
      ...(config.pexelsApiKey ? { apiKey: config.pexelsApiKey } : {}),
      args: parsePexelsMcpArgs(config.pexelsMcpArgs),
      command: config.pexelsMcpCommand,
      transport: "stdio",
    };
  }

  throw new Error(
    "缺少 PEXELS_MCP_COMMAND，景点配图需要配置本地 Pexels MCP 启动命令。",
  );
}
