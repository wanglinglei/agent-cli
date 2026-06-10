/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:45:00
 * @Description: 封装本地 Pexels MCP 客户端连接、图片搜索工具发现和图片结果标准化。
 * @FilePath: /agents-cli/src/agents/travel/tools/pexelsMcpClient.ts
 * @LastEditTime: 2026-06-10 00:00:00
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

import { requirePexelsMcpConfig } from "../../../config.js";
import { truncateText } from "../../../text.js";
import type { AppConfig } from "../../../types.js";
import type { Logger } from "../../../logger.js";

interface PexelsMcpTool {
  description?: string;
  inputSchema?: {
    properties?: Record<string, object>;
    required?: string[];
  };
  name: string;
}

export interface PexelsImage {
  alt?: string;
  height?: number;
  imageUrl: string;
  photographer?: string;
  photographerUrl?: string;
  photoUrl?: string;
  source: "pexels";
  width?: number;
}

export interface PexelsAttractionImages {
  attractionName: string;
  availableTools?: Array<{
    description?: string;
    name: string;
  }>;
  images: PexelsImage[];
  query: string;
  reason?: string;
  success: boolean;
  toolName?: string;
}

export interface PexelsAttractionSearchInput {
  attractionName: string;
  city?: string;
  count?: number;
}

export interface PexelsMcpLogOptions {
  logger?: Logger;
  parentToolName?: string;
}

const preferredSearchToolNames = [
  "photos_search",
  "pexels_search_photos",
  "search_photos",
  "searchPhotos",
  "search",
  "search-photos",
];

const queryPropertyNames = ["query", "q", "keyword", "keywords", "search"];
const perPagePropertyNames = [
  "per_page",
  "perPage",
  "count",
  "limit",
  "num",
  "number",
  "pageSize",
];

/**
 * 判断输入是否是普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从未知值中读取字符串。
 */
function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 从未知值中读取数字。
 */
function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * 将可能包含 JSON 的文本解析为对象，否则保留截断后的文本。
 */
function parseMaybeJson(text: string): unknown {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return "";
  }

  try {
    return JSON.parse(trimmedText);
  } catch {
    return truncateText(trimmedText, 5_000);
  }
}

/**
 * 生成 MCP 日志摘要。
 *
 * 输入任意 MCP 参数或结果，输出短文本；失败策略是返回类型名，不影响实际 MCP 调用。
 */
function summarizeMcpLogValue(value: unknown): string {
  try {
    if (typeof value === "string") {
      return truncateText(value, 240);
    }

    return truncateText(JSON.stringify(value), 240);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * 生成 MCP 日志详情。
 *
 * 输入可选上层工具名和摘要，输出单行详情；缺失时只展示摘要。
 */
function buildMcpLogDetail(
  options: PexelsMcpLogOptions | undefined,
  summary?: string,
): string | undefined {
  const chunks = [
    options?.parentToolName ? `上层工具: ${options.parentToolName}` : "",
    summary,
  ].filter(Boolean);

  return chunks.length ? chunks.join("；") : undefined;
}

/**
 * 将 MCP callTool 返回值转换为可分析的紧凑数据。
 */
function normalizeMcpResult(result: unknown): unknown {
  if (!isRecord(result)) {
    return result;
  }

  if (isRecord(result.structuredContent)) {
    return result.structuredContent;
  }

  if (!Array.isArray(result.content)) {
    return result;
  }

  const textParts = result.content
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }

      if (item.type === "resource" && isRecord(item.resource)) {
        return typeof item.resource.text === "string" ? item.resource.text : "";
      }

      return "";
    })
    .filter(Boolean);

  if (textParts.length === 1) {
    return parseMaybeJson(textParts[0]);
  }

  return textParts.map(parseMaybeJson);
}

/**
 * 建立 Pexels MCP 短连接并执行回调。
 */
async function withPexelsMcpClient<T>(
  config: AppConfig,
  callback: (client: Client, transport: StdioClientTransport) => Promise<T>,
): Promise<T> {
  const pexelsConfig = requirePexelsMcpConfig(config);
  const client = new Client({
    name: "agents-cli-travel-pexels",
    version: "0.1.0",
  });

  const transport = new StdioClientTransport({
    args: pexelsConfig.args,
    command: pexelsConfig.command,
    env: {
      ...getDefaultEnvironment(),
      ...(pexelsConfig.apiKey ? { PEXELS_API_KEY: pexelsConfig.apiKey } : {}),
    },
    stderr: "pipe",
  });

  await client.connect(transport);

  try {
    return await callback(client, transport);
  } finally {
    await client.close();
  }
}

/**
 * 读取 Pexels MCP 可用工具列表。
 */
async function listPexelsMcpTools(
  client: Client,
  options?: PexelsMcpLogOptions,
): Promise<PexelsMcpTool[]> {
  const startedAt = Date.now();
  options?.logger?.chainStart(
    "mcp",
    "pexels.listTools",
    buildMcpLogDetail(options),
  );

  const tools: PexelsMcpTool[] = [];
  let cursor: string | undefined;

  try {
    do {
      const response = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(
        ...response.tools.map((item) => ({
          description: item.description,
          inputSchema: item.inputSchema,
          name: item.name,
        })),
      );
      cursor = response.nextCursor;
    } while (cursor);

    options?.logger?.chainSuccess(
      "mcp",
      "pexels.listTools",
      Date.now() - startedAt,
      `工具数: ${tools.length}`,
    );
    return tools;
  } catch (error) {
    options?.logger?.chainError(
      "mcp",
      "pexels.listTools",
      error,
      Date.now() - startedAt,
    );
    throw error;
  }
}

/**
 * 从工具列表中选择最可能的 Pexels 图片搜索工具。
 */
function findPexelsSearchTool(tools: PexelsMcpTool[]): PexelsMcpTool | undefined {
  const exactTool = preferredSearchToolNames
    .map((name) => tools.find((item) => item.name === name))
    .find(Boolean);

  if (exactTool) {
    return exactTool;
  }

  return tools.find((item) => {
    const searchText = `${item.name} ${item.description ?? ""}`.toLowerCase();
    return (
      searchText.includes("pexels") &&
      searchText.includes("search") &&
      /(photo|image|picture)/i.test(searchText)
    );
  }) ?? tools.find((item) => {
    const searchText = `${item.name} ${item.description ?? ""}`.toLowerCase();
    return (
      searchText.includes("search") &&
      /(photo|image|picture)/i.test(searchText)
    );
  });
}

/**
 * 根据 MCP 工具 inputSchema 组装图片搜索参数。
 */
function buildSearchToolArguments(
  toolInfo: PexelsMcpTool,
  query: string,
  count: number,
): Record<string, unknown> {
  const properties = toolInfo.inputSchema?.properties;
  if (!properties || Object.keys(properties).length === 0) {
    return {
      orientation: "landscape",
      page: 1,
      per_page: count,
      query,
    };
  }

  const args: Record<string, unknown> = {};
  const propertyNames = Object.keys(properties);
  const addFirstExisting = (names: string[], value: unknown) => {
    const propertyName = names.find((name) => propertyNames.includes(name));
    if (propertyName) {
      args[propertyName] = value;
    }
  };

  addFirstExisting(queryPropertyNames, query);
  addFirstExisting(perPagePropertyNames, count);
  addFirstExisting(["page"], 1);
  addFirstExisting(["orientation"], "landscape");
  addFirstExisting(["locale", "language", "lang"], "zh-CN");

  for (const requiredName of toolInfo.inputSchema?.required ?? []) {
    if (requiredName in args) {
      continue;
    }

    if (/query|keyword|search|q/i.test(requiredName)) {
      args[requiredName] = query;
    } else if (/count|limit|page|num|size|per/i.test(requiredName)) {
      args[requiredName] = count;
    } else if (/orientation/i.test(requiredName)) {
      args[requiredName] = "landscape";
    }
  }

  return args;
}

/**
 * 从标准 Pexels REST 照片对象中抽取图片。
 */
function normalizePexelsPhotoRecord(record: Record<string, unknown>): PexelsImage | undefined {
  const src = isRecord(record.src) ? record.src : undefined;
  const imageUrl =
    getString(record.imageUrl) ??
    getString(record.image_url) ??
    getString(record.image) ??
    getString(record.thumbnail) ??
    getString(record.thumbnailUrl) ??
    (src
      ? getString(src.large2x) ??
        getString(src.large) ??
        getString(src.medium) ??
        getString(src.original) ??
        getString(src.landscape)
      : undefined);

  if (!imageUrl) {
    return undefined;
  }

  return {
    ...(getString(record.alt) ? { alt: getString(record.alt) } : {}),
    ...(getNumber(record.height) ? { height: getNumber(record.height) } : {}),
    imageUrl,
    ...(getString(record.photographer)
      ? { photographer: getString(record.photographer) }
      : {}),
    ...(getString(record.photographer_url)
      ? { photographerUrl: getString(record.photographer_url) }
      : {}),
    ...(getString(record.url) ? { photoUrl: getString(record.url) } : {}),
    source: "pexels",
    ...(getNumber(record.width) ? { width: getNumber(record.width) } : {}),
  };
}

/**
 * 递归遍历 MCP 返回值，抽取可能的 Pexels 图片对象。
 */
function collectPexelsImages(value: unknown, images: PexelsImage[]): void {
  if (images.length >= 20) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPexelsImages(item, images);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const normalizedPhoto = normalizePexelsPhotoRecord(value);
  if (
    normalizedPhoto &&
    !images.some((item) => item.imageUrl === normalizedPhoto.imageUrl)
  ) {
    images.push(normalizedPhoto);
  }

  for (const key of ["photos", "images", "results", "data", "items"]) {
    if (key in value) {
      collectPexelsImages(value[key], images);
    }
  }
}

/**
 * 搜索单个景点的 Pexels 配图。
 *
 * 输入景点名、城市和数量，输出 1 到 3 张标准化图片信息；MCP 缺配置、工具不存在或
 * 搜索失败时返回 success:false，不抛出到 ReAct 主流程。
 */
export async function searchPexelsImagesForAttraction(
  config: AppConfig,
  input: PexelsAttractionSearchInput,
  options?: PexelsMcpLogOptions,
): Promise<PexelsAttractionImages> {
  const count = Math.min(Math.max(input.count ?? 3, 1), 3);
  const query = [input.city, input.attractionName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const operationStartedAt = Date.now();
  const operationName = "pexels.searchImages";
  options?.logger?.chainStart(
    "mcp",
    operationName,
    buildMcpLogDetail(options, `查询: ${query}`),
  );

  try {
    const output = await withPexelsMcpClient(config, async (client) => {
      const tools = await listPexelsMcpTools(client, options);
      const searchTool = findPexelsSearchTool(tools);
      const availableTools = tools.map((item) => ({
        description: item.description,
        name: item.name,
      }));

      if (!searchTool) {
        return {
          attractionName: input.attractionName,
          availableTools,
          images: [],
          query,
          reason: "Pexels MCP 未暴露可识别的图片搜索工具。",
          success: false,
        };
      }

      const toolArguments = buildSearchToolArguments(searchTool, query, count);
      const startedAt = Date.now();
      const mcpName = `pexels.callTool:${searchTool.name}`;
      options?.logger?.chainStart(
        "mcp",
        mcpName,
        buildMcpLogDetail(
          options,
          `参数: ${summarizeMcpLogValue(toolArguments)}`,
        ),
      );
      let result: unknown;
      try {
        result = await client.callTool({
          arguments: toolArguments,
          name: searchTool.name,
        });
        options?.logger?.chainSuccess(
          "mcp",
          mcpName,
          Date.now() - startedAt,
          `查询: ${query}`,
        );
      } catch (error) {
        options?.logger?.chainError(
          "mcp",
          mcpName,
          error,
          Date.now() - startedAt,
        );
        throw error;
      }

      const normalizedResult = normalizeMcpResult(result);
      const images: PexelsImage[] = [];
      collectPexelsImages(normalizedResult, images);

      return {
        attractionName: input.attractionName,
        images: images.slice(0, count),
        query,
        ...(images.length === 0
          ? { reason: "Pexels MCP 搜索成功，但未解析到图片 URL。" }
          : {}),
        success: images.length > 0,
        toolName: searchTool.name,
      };
    });
    options?.logger?.chainSuccess(
      "mcp",
      operationName,
      Date.now() - operationStartedAt,
      `成功: ${output.success}；图片数: ${output.images.length}`,
    );
    return output;
  } catch (error) {
    options?.logger?.chainError(
      "mcp",
      operationName,
      error,
      Date.now() - operationStartedAt,
    );
    return {
      attractionName: input.attractionName,
      images: [],
      query,
      reason: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}
