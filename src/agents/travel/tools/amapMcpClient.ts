/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:20:00
 * @Description: 封装高德地图 MCP 客户端连接、工具发现和工具调用。
 * @FilePath: /agents-cli/src/agents/travel/tools/amapMcpClient.ts
 * @LastEditTime: 2026-06-05 18:20:00
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { requireAmapMcpUrl } from "../../../config.js";
import { truncateText } from "../../../text.js";
import type { AppConfig } from "../../../types.js";

interface AmapMcpTool {
  description?: string;
  name: string;
}

export interface AmapMcpCallInput {
  arguments?: Record<string, unknown>;
  toolName: string;
}

export interface AmapMcpCallOutput {
  availableTools?: AmapMcpTool[];
  result?: unknown;
  reason?: string;
  success: boolean;
  toolName: string;
}

/**
 * 判断输入是否是普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 将 MCP 文本结果尽量解析为 JSON。
 */
function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return truncateText(trimmed, 5_000);
  }
}

/**
 * 压缩 MCP 结果，限制数组和长字符串，避免工具输出撑大模型上下文。
 */
function compactValue(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[嵌套过深，已截断]";
  }

  if (typeof value === "string") {
    return truncateText(value, 800);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => compactValue(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, item]) => [key, compactValue(item, depth + 1)]),
  );
}

/**
 * 将 MCP callTool 返回值转换为可给模型消费的紧凑结构。
 */
function normalizeMcpResult(result: unknown): unknown {
  if (!isRecord(result)) {
    return compactValue(result);
  }

  if (isRecord(result.structuredContent)) {
    return compactValue(result.structuredContent);
  }

  const content = result.content;
  if (!Array.isArray(content)) {
    return compactValue(result);
  }

  const textParts = content
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }

      if (item.type === "resource" && isRecord(item.resource)) {
        const resourceText = item.resource.text;
        return typeof resourceText === "string" ? resourceText : "";
      }

      return "";
    })
    .filter(Boolean);

  if (textParts.length === 1) {
    return compactValue(parseMaybeJson(textParts[0]));
  }

  return compactValue(textParts.map(parseMaybeJson));
}

/**
 * 判断 MCP 工具结果是否是高德业务错误。
 */
function getAmapBusinessError(result: unknown): string | undefined {
  if (typeof result === "string" && /API 调用失败|HAS_EXCEEDED|INVALID|ERROR/i.test(result)) {
    return result;
  }

  if (!isRecord(result)) {
    return undefined;
  }

  const maybeError = result.error ?? result.message ?? result.info ?? result.result;
  return typeof maybeError === "string" &&
    /API 调用失败|HAS_EXCEEDED|INVALID|ERROR/i.test(maybeError)
    ? maybeError
    : undefined;
}

/**
 * 建立高德 MCP 短连接并执行回调。
 */
async function withAmapMcpClient<T>(
  config: AppConfig,
  callback: (client: Client, transport: StreamableHTTPClientTransport) => Promise<T>,
): Promise<T> {
  const client = new Client({
    name: "agents-cli-travel",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(requireAmapMcpUrl(config)),
  );

  await client.connect(transport);

  try {
    return await callback(client, transport);
  } finally {
    try {
      await transport.terminateSession();
    } catch {
      // 部分 MCP 服务不支持显式终止 session，关闭 client 即可。
    }
    await client.close();
  }
}

/**
 * 读取高德 MCP 可用工具列表。
 */
export async function listAmapMcpTools(config: AppConfig): Promise<AmapMcpTool[]> {
  return withAmapMcpClient(config, async (client) => {
    const tools: AmapMcpTool[] = [];
    let cursor: string | undefined;

    do {
      const response = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(
        ...response.tools.map((item) => ({
          description: item.description,
          name: item.name,
        })),
      );
      cursor = response.nextCursor;
    } while (cursor);

    return tools;
  });
}

/**
 * 调用高德 MCP 指定工具。
 *
 * 输入工具名和参数，输出紧凑结果；工具不存在时返回可用工具列表，让上层 Agent
 * 可以选择降级或改用其他工具。
 */
export async function callAmapMcpTool(
  config: AppConfig,
  input: AmapMcpCallInput,
): Promise<AmapMcpCallOutput> {
  return withAmapMcpClient(config, async (client) => {
    const toolResponse = await client.listTools();
    const availableTools = toolResponse.tools.map((item) => ({
      description: item.description,
      name: item.name,
    }));
    const foundTool = availableTools.find((item) => item.name === input.toolName);

    if (!foundTool) {
      return {
        availableTools,
        success: false,
        toolName: input.toolName,
      };
    }

    const result = await client.callTool({
      arguments: input.arguments ?? {},
      name: input.toolName,
    });

    const normalizedResult = normalizeMcpResult(result);
    const businessError = getAmapBusinessError(normalizedResult);

    return {
      ...(businessError ? { reason: businessError } : {}),
      result: normalizedResult,
      success: !businessError,
      toolName: input.toolName,
    };
  });
}
