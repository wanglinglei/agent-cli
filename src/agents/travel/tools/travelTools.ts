/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:20:00
 * @Description: 提供旅行规划流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/agents/travel/tools/travelTools.ts
 * @LastEditTime: 2026-06-10 00:00:00
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { tool } from "langchain";
import { z } from "zod";

import { formatArtifactPath, writeAgentArtifact } from "../../../artifacts.js";
import { toPrettyJson, truncateText } from "../../../text.js";
import { createCurrentTimeTool } from "../../../tools/currentTime.js";
import { searchWithTavily } from "../../../tools/tavilySearch.js";
import { queryQWeather } from "../../weather/tools/qweatherClient.js";
import { callAmapMcpTool, listAmapMcpTools } from "./amapMcpClient.js";
import { searchPexelsImagesForAttraction } from "./pexelsMcpClient.js";
import type { AgentArtifact, AgentRuntime, AgentState } from "../../../types.js";
import type { AmapMcpCallInput, AmapMcpCallOutput } from "./amapMcpClient.js";
import type {
  PexelsAttractionImages,
  PexelsImage,
} from "./pexelsMcpClient.js";

/**
 * 旅行工具创建上下文。
 */
export interface TravelToolContext {
  artifacts: AgentArtifact[];
  runtime: AgentRuntime;
  state: AgentState;
}

interface DownloadedPexelsImage extends PexelsImage {
  downloadReason?: string;
  downloadSuccess: boolean;
  localImagePath?: string;
  markdownImageUrl: string;
  remoteImageUrl: string;
}

interface TravelPexelsAttractionImages
  extends Omit<PexelsAttractionImages, "images"> {
  images: DownloadedPexelsImage[];
}

const maxImageAssetBytes = 8 * 1024 * 1024;

/**
 * 将日期格式化为本地 YYYY-MM-DD 字符串。
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * 解析本地 YYYY-MM-DD 日期。
 */
function parseLocalDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error("日期必须使用 YYYY-MM-DD 格式。");
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * 给日期增加指定天数。
 */
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * 计算两个本地日期之间的整天差。
 */
function getDayOffset(start: Date, end: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);
}

/**
 * 清理文件名片段，避免景点名称或模型输出影响本地路径。
 */
function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * 根据响应类型和 URL 选择图片文件扩展名。
 */
function getImageExtension(imageUrl: string, contentType?: string): string {
  const normalizedContentType = contentType?.toLowerCase() ?? "";

  if (normalizedContentType.includes("image/png")) {
    return "png";
  }

  if (normalizedContentType.includes("image/webp")) {
    return "webp";
  }

  if (normalizedContentType.includes("image/gif")) {
    return "gif";
  }

  const pathname = new URL(imageUrl).pathname.toLowerCase();
  const match = /\.(jpe?g|png|webp|gif)$/.exec(pathname);
  return match?.[1] === "jpeg" ? "jpg" : match?.[1] ?? "jpg";
}

/**
 * 生成图片资源文件名。
 */
function getImageAssetFileName(
  attractionName: string,
  attractionIndex: number,
  imageIndex: number,
  extension: string,
): string {
  const safeAttractionName = sanitizePathSegment(attractionName) || "attraction";
  const attractionNumber = `${attractionIndex + 1}`.padStart(2, "0");
  const imageNumber = `${imageIndex + 1}`.padStart(2, "0");

  return `${attractionNumber}-${safeAttractionName}-${imageNumber}.${extension}`;
}

/**
 * 将本地图片路径转换为 Markdown 预览器可直接加载的绝对路径。
 */
function getMarkdownAssetPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

/**
 * 下载 Pexels 图片到当前旅行计划的本地 assets 目录。
 *
 * 输入远程图片信息，输出保留摄影归属信息的本地图片记录；下载失败时保留远程
 * URL 作为兜底，并把失败原因返回给模型。
 */
async function downloadPexelsImageAsset(
  context: TravelToolContext,
  image: PexelsImage,
  attractionName: string,
  attractionIndex: number,
  imageIndex: number,
): Promise<DownloadedPexelsImage> {
  const remoteImageUrl = image.imageUrl;

  try {
    const response = await fetch(remoteImageUrl);
    if (!response.ok) {
      throw new Error(`图片下载失败：HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`图片响应类型不是 image/*：${contentType || "unknown"}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxImageAssetBytes) {
      throw new Error("图片超过本地保存大小限制。");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxImageAssetBytes) {
      throw new Error("图片超过本地保存大小限制。");
    }

    const agentDir = path.join(context.runtime.outputDir, "travelReactAgent");
    const assetsDirName = `${sanitizePathSegment(
      context.state.runId,
    )}-travel-plan-assets`;
    const assetsDir = path.join(agentDir, assetsDirName);
    await mkdir(assetsDir, { recursive: true });

    const extension = getImageExtension(remoteImageUrl, contentType);
    const fileName = getImageAssetFileName(
      attractionName,
      attractionIndex,
      imageIndex,
      extension,
    );
    const filePath = path.join(assetsDir, fileName);
    await writeFile(filePath, buffer);

    const markdownImageUrl = getMarkdownAssetPath(filePath);

    return {
      ...image,
      downloadSuccess: true,
      imageUrl: markdownImageUrl,
      localImagePath: formatArtifactPath(context.state.cwd, filePath),
      markdownImageUrl,
      remoteImageUrl,
    };
  } catch (error) {
    return {
      ...image,
      downloadReason: error instanceof Error ? error.message : String(error),
      downloadSuccess: false,
      markdownImageUrl: remoteImageUrl,
      remoteImageUrl,
    };
  }
}

/**
 * 将最终 Markdown 中残留的远程 Pexels 图片地址替换为本地资源路径。
 */
function replaceDownloadedImageUrls(
  markdown: string,
  imagePathMap: Map<string, string>,
): string {
  let nextMarkdown = markdown;

  for (const [remoteImageUrl, markdownImageUrl] of imagePathMap.entries()) {
    nextMarkdown = nextMarkdown.split(remoteImageUrl).join(markdownImageUrl);
  }

  return nextMarkdown;
}

interface TravelMarkdownImageBlock {
  altText: string;
  captionMarkdown?: string;
  imageUrl: string;
}

interface ParsedTravelMarkdownImageBlock {
  block: TravelMarkdownImageBlock;
  nextIndex: number;
}

/**
 * 判断某一行是否是独立的 Markdown 图片语法。
 */
function isMarkdownImageLine(line: string | undefined): boolean {
  return /^!\[[^\]]*\]\([^)]+\)\s*$/.test(line?.trim() ?? "");
}

/**
 * 读取从指定行开始的一组 Markdown 图片及其摄影说明。
 */
function parseTravelMarkdownImageBlock(
  lines: string[],
  index: number,
): ParsedTravelMarkdownImageBlock | undefined {
  const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(
    lines[index]?.trim() ?? "",
  );
  if (!imageMatch) {
    return undefined;
  }

  let captionIndex = index + 1;
  while (lines[captionIndex]?.trim() === "") {
    captionIndex += 1;
  }

  const captionLines: string[] = [];
  while (/^\s*>\s?/.test(lines[captionIndex] ?? "")) {
    captionLines.push((lines[captionIndex] ?? "").replace(/^\s*>\s?/, ""));
    captionIndex += 1;
  }

  return {
    block: {
      altText: imageMatch[1] ?? "",
      ...(captionLines.length > 0
        ? { captionMarkdown: captionLines.join("\n") }
        : {}),
      imageUrl: imageMatch[2] ?? "",
    },
    nextIndex: captionLines.length > 0 ? captionIndex : index + 1,
  };
}

/**
 * 查找下一行非空 Markdown 内容。
 */
function getNextNonEmptyLineIndex(lines: string[], index: number): number {
  let nextIndex = index;

  while (lines[nextIndex]?.trim() === "") {
    nextIndex += 1;
  }

  return nextIndex;
}

/**
 * 清理 Markdown 表格单元格文本。
 */
function sanitizeMarkdownTableCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

/**
 * 清理 Markdown 图片说明文本。
 */
function sanitizeMarkdownImageAlt(value: string): string {
  return value.replace(/[\]\r\n|]/g, " ").trim();
}

/**
 * 渲染每行最多三张的旅行图片表格。
 */
function renderTravelMarkdownImageGrid(
  blocks: TravelMarkdownImageBlock[],
): string {
  const tables: string[] = [];

  for (let index = 0; index < blocks.length; index += 3) {
    const rowBlocks = blocks.slice(index, index + 3);
    const imageCells = rowBlocks.map(
      (block) =>
        `![${sanitizeMarkdownImageAlt(block.altText)}](${block.imageUrl})`,
    );
    const captionCells = rowBlocks.map((block) =>
      sanitizeMarkdownTableCell(block.captionMarkdown ?? ""),
    );

    tables.push(
      [
        `| ${imageCells.join(" | ")} |`,
        `| ${rowBlocks.map(() => "---").join(" | ")} |`,
        `| ${captionCells.join(" | ")} |`,
      ].join("\n"),
    );
  }

  return tables.join("\n\n");
}

/**
 * 将连续的旅行配图 Markdown 归一为三列图片表格。
 *
 * 输入模型可能输出的一张张 Markdown 图片，输出最多三张一行的 Markdown 表格；保留摄影
 * 归属和原图链接。
 */
function normalizeTravelImageGridLayout(markdown: string): string {
  const lines = markdown.split("\n");
  const nextLines: string[] = [];

  for (let index = 0; index < lines.length;) {
    const firstBlock = parseTravelMarkdownImageBlock(lines, index);
    if (!firstBlock) {
      nextLines.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    const blocks = [firstBlock.block];
    let groupEndIndex = firstBlock.nextIndex;

    while (true) {
      const nextImageIndex = getNextNonEmptyLineIndex(lines, groupEndIndex);
      if (!isMarkdownImageLine(lines[nextImageIndex])) {
        break;
      }

      const nextBlock = parseTravelMarkdownImageBlock(lines, nextImageIndex);
      if (!nextBlock) {
        break;
      }

      blocks.push(nextBlock.block);
      groupEndIndex = nextBlock.nextIndex;
    }

    if (blocks.length < 2) {
      nextLines.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    nextLines.push(renderTravelMarkdownImageGrid(blocks));
    index = groupEndIndex;
  }

  return nextLines.join("\n");
}

interface AttractionTableRow {
  fields: Array<[string, string]>;
  name: string;
}

/**
 * 拆分 Markdown 表格行。
 */
function splitMarkdownTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((item) => item.trim());
}

/**
 * 从景点表格中解析景点信息。
 */
function parseAttractionTableRows(markdown: string): AttractionTableRow[] {
  const lines = markdown.split("\n");
  const tableStartIndex = lines.findIndex(
    (line, index) =>
      /^\|/.test(line.trim()) &&
      /(景点|名称)/.test(line) &&
      /^\|/.test(lines[index + 1]?.trim() ?? "") &&
      /^[-:|\s]+$/.test(lines[index + 1]?.trim() ?? ""),
  );

  if (tableStartIndex < 0) {
    return [];
  }

  const headers = splitMarkdownTableRow(lines[tableStartIndex] ?? "");
  const tableRows = lines
    .slice(tableStartIndex + 2)
    .filter((line) => /^\|/.test(line.trim()))
    .map(splitMarkdownTableRow);
  const nameIndex = headers.findIndex((header) => /(景点|名称)/.test(header));

  if (nameIndex < 0) {
    return [];
  }

  return tableRows
    .map((cells) => {
      const name = cells[nameIndex]?.trim() ?? "";
      const fields = headers
        .map((header, index): [string, string] => [
          header,
          cells[index]?.trim() || "未查询到",
        ])
        .filter(([header]) => !/(景点|名称)/.test(header));

      return { fields, name };
    })
    .filter((row) => row.name);
}

/**
 * 从独立配图章节中解析每个景点的图片 Markdown。
 */
function parseAttractionImageSections(markdown: string): Map<string, string> {
  const imageSections = new Map<string, string>();
  const imageSectionPattern = /^###\s*(.+?)\s*\n([\s\S]*?)(?=^###\s+|^##\s+|\s*$)/gm;
  let match: RegExpExecArray | null;

  while ((match = imageSectionPattern.exec(markdown))) {
    const attractionName = match[1]?.trim();
    const imageMarkdown = match[2]?.trim();
    if (attractionName && imageMarkdown) {
      imageSections.set(attractionName, imageMarkdown);
    }
  }

  return imageSections;
}

/**
 * 为景点名匹配对应图片 Markdown。
 */
function getImageMarkdownForAttraction(
  attractionName: string,
  imageSections: Map<string, string>,
): string | undefined {
  const exactImageMarkdown = imageSections.get(attractionName);
  if (exactImageMarkdown) {
    return exactImageMarkdown;
  }

  const normalizedAttractionName = attractionName.replace(/景区|风景名胜区/g, "");

  for (const [imageSectionName, imageMarkdown] of imageSections.entries()) {
    const normalizedImageSectionName = imageSectionName.replace(
      /景区|风景名胜区/g,
      "",
    );

    if (
      normalizedAttractionName.includes(normalizedImageSectionName) ||
      normalizedImageSectionName.includes(normalizedAttractionName)
    ) {
      return imageMarkdown;
    }
  }

  return undefined;
}

/**
 * 将景点表格和独立配图章节归并为景点卡片。
 */
function normalizeAttractionCardLayout(markdown: string): string {
  const imageSectionMatch = /^##\s*景点配图\s*\n([\s\S]*?)(?=^##\s+|\s*$)/m.exec(
    markdown,
  );
  if (!imageSectionMatch) {
    return markdown;
  }

  const imageSections = parseAttractionImageSections(imageSectionMatch[1] ?? "");
  const withoutImageSection = markdown.replace(imageSectionMatch[0], "").trimEnd();
  const candidatesSectionMatch =
    /^##\s*景点\/餐饮候选\s*\n([\s\S]*?)(?=^##\s+|\s*$)/m.exec(
      withoutImageSection,
    );
  if (!candidatesSectionMatch) {
    return withoutImageSection;
  }

  const candidatesSection = candidatesSectionMatch[1] ?? "";
  const attractionSectionMatch =
    /^###\s*景点(?:详情)?\s*\n([\s\S]*?)(?=^###\s+|^##\s+|\s*$)/m.exec(
      candidatesSection,
    );
  if (!attractionSectionMatch) {
    return withoutImageSection;
  }

  const attractionRows = parseAttractionTableRows(attractionSectionMatch[1] ?? "");
  if (attractionRows.length === 0) {
    return withoutImageSection;
  }

  const attractionCards = attractionRows
    .map((row) => {
      const fieldLines = row.fields.map(
        ([fieldName, value]) => `- ${fieldName}：${value || "未查询到"}`,
      );
      const imageMarkdown =
        getImageMarkdownForAttraction(row.name, imageSections) ??
        "- 未查询到 Pexels 配图";

      return [
        `#### ${row.name}`,
        "",
        ...fieldLines,
        "",
        imageMarkdown,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const nextCandidatesSection = candidatesSection.replace(
    attractionSectionMatch[0],
    `### 景点\n\n${attractionCards}\n\n`,
  );

  return withoutImageSection.replace(
    candidatesSectionMatch[0],
    `## 景点/餐饮候选\n${nextCandidatesSection}`,
  );
}

/**
 * 创建旅行规划日期校验工具。
 */
function createTravelDateValidationTool() {
  return tool(
    async ({ startDate, durationDays }) => {
      const today = parseLocalDate(formatLocalDate(new Date()));
      const start = parseLocalDate(startDate);
      const duration = durationDays;
      const end = addDays(start, duration - 1);
      const maxDate = addDays(today, 7);
      const reasons: string[] = [];

      if (duration < 1 || duration > 7) {
        reasons.push("行程天数必须是 1 到 7 天。");
      }

      if (getDayOffset(today, start) < 0) {
        reasons.push("出发日期不能早于今天。");
      }

      if (end.getTime() > maxDate.getTime()) {
        reasons.push("当前只支持今天起未来 7 天窗口内的行程，最晚到第七天。");
      }

      const dates =
        reasons.length === 0
          ? Array.from({ length: duration }, (_, index) =>
              formatLocalDate(addDays(start, index)),
            )
          : [];

      return toPrettyJson({
        dates,
        durationDays: duration,
        maxDate: formatLocalDate(maxDate),
        startDate,
        success: reasons.length === 0,
        today: formatLocalDate(today),
        reasons,
      });
    },
    {
      name: "validate_travel_dates",
      description:
        "Validate travel start date and duration. The trip must be within today plus 7 days and last at most 7 days.",
      schema: z.object({
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Trip start date in YYYY-MM-DD."),
        durationDays: z
          .number()
          .int()
          .min(1)
          .max(14)
          .describe("Trip duration in days."),
      }),
    },
  );
}

/**
 * 检查最终 Markdown 是否包含明显未校验的估算价格。
 */
function findUnverifiedPriceText(markdown: string): string | undefined {
  const match = markdown.match(/约\s*\d+(?:\.\d+)?\s*元/);
  return match?.[0];
}

/**
 * 检查最终 Markdown 是否仍有独立的景点配图章节。
 */
function findStandaloneAttractionImageSection(markdown: string): string | undefined {
  const match = markdown.match(/^##\s*景点配图\s*$/m);
  return match?.[0];
}

/**
 * 检查景点候选是否仍使用表格展示。
 */
function findAttractionTableText(markdown: string): string | undefined {
  const candidatesSection =
    /^##\s*景点\/餐饮候选\s*$([\s\S]*?)(?=^##\s+)/m.exec(markdown)?.[1] ??
    markdown;
  const attractionSection =
    /^###\s*景点(?:详情)?\s*$([\s\S]*?)(?=^###\s+|^##\s+)/m.exec(
      candidatesSection,
    )?.[1] ?? candidatesSection;
  const match = attractionSection.match(
    /^\|[^\n]*(景点|名称)[^\n]*\|[^\n]*(地址|开放时间|评分)[^\n]*\|/m,
  );

  return match?.[0];
}

/**
 * 安全调用高德 MCP 工具。
 *
 * 输入 MCP 工具名和参数，输出成功或失败的结构化结果；失败时不抛出，允许 Agent
 * 改用通用搜索兜底。
 */
async function safeAmapMcpCall(
  context: TravelToolContext,
  input: AmapMcpCallInput,
): Promise<AmapMcpCallOutput> {
  try {
    return await callAmapMcpTool(context.runtime.config, input, {
      logger: context.runtime.logger,
      parentToolName: input.toolName,
    });
  } catch (error) {
    return {
      result: {
        reason: error instanceof Error ? error.message : String(error),
      },
      success: false,
      toolName: input.toolName,
    };
  }
}

/**
 * 创建旅行规划工具集合。
 *
 * 输入当前运行状态、运行时和产物收集器，输出 LangChain 工具；工具返回短 JSON 文本，
 * 由 Agent 节点统一更新状态和产物记录。
 */
export function createTravelTools(context: TravelToolContext) {
  const pexelsImagePathMap = new Map<string, string>();

  const weatherQueryTool = tool(
    async ({ city, date, dateText, locationId }) => {
      const result = await queryQWeather(context.runtime.config, {
        city,
        date,
        dateText,
        language: "zh",
        locationId,
        unit: "m",
      });

      return toPrettyJson({
        city: result.resolvedCity,
        current: result.current,
        forecast: result.forecast.slice(0, 7),
        locationId: result.locationId,
        queryDate: result.queryDate,
        queryType: result.queryType,
        updateTime: result.updateTime,
      });
    },
    {
      name: "travel_weather_query",
      description:
        "Query weather for one city and one trip date using the existing QWeather capability.",
      schema: z.object({
        city: z.string().min(1).describe("Destination city."),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Trip date in YYYY-MM-DD."),
        dateText: z.string().optional().describe("Original date phrase."),
        locationId: z.string().optional().describe("Optional QWeather LocationID."),
      }),
    },
  );

  const amapListToolsTool = tool(
    async () => {
      try {
        const tools = await listAmapMcpTools(context.runtime.config, {
          logger: context.runtime.logger,
          parentToolName: "amap_list_tools",
        });
        return toPrettyJson({
          count: tools.length,
          success: true,
          tools,
        });
      } catch (error) {
        return toPrettyJson({
          reason: error instanceof Error ? error.message : String(error),
          success: false,
        });
      }
    },
    {
      name: "amap_list_tools",
      description:
        "List available AMap MCP tools. Use only when a wrapped AMap tool reports an unavailable MCP tool.",
      schema: z.object({}),
    },
  );

  const amapTextSearchTool = tool(
    async ({ keywords, city, cityLimit }) => {
      const result = await safeAmapMcpCall(context, {
        arguments: {
          keywords,
          ...(city ? { city } : {}),
          citylimit: cityLimit,
        },
        toolName: "maps_text_search",
      });
      return toPrettyJson(result);
    },
    {
      name: "amap_text_search",
      description:
        "Search AMap POIs by keywords, such as attractions, hotels, restaurants, museums, or shopping areas.",
      schema: z.object({
        keywords: z.string().min(1).describe("POI search keywords."),
        city: z.string().optional().describe("City name or city code."),
        cityLimit: z
          .boolean()
          .default(true)
          .describe("Whether to limit results to the specified city."),
      }),
    },
  );

  const amapSearchDetailTool = tool(
    async ({ id }) => {
      const result = await safeAmapMcpCall(context, {
        arguments: { id },
        toolName: "maps_search_detail",
      });
      return toPrettyJson(result);
    },
    {
      name: "amap_search_detail",
      description:
        "Query AMap POI detail by POI id returned from text search.",
      schema: z.object({
        id: z.string().min(1).describe("AMap POI id."),
      }),
    },
  );

  const amapGeoTool = tool(
    async ({ address, city }) => {
      const result = await safeAmapMcpCall(context, {
        arguments: {
          address,
          ...(city ? { city } : {}),
        },
        toolName: "maps_geo",
      });
      return toPrettyJson(result);
    },
    {
      name: "amap_geo",
      description:
        "Geocode an address with AMap MCP and return longitude,latitude candidates.",
      schema: z.object({
        address: z.string().min(1).describe("Address or POI name."),
        city: z.string().optional().describe("Optional city name."),
      }),
    },
  );

  const amapDistanceTool = tool(
    async ({ origins, destination, type }) => {
      const result = await safeAmapMcpCall(context, {
        arguments: {
          destination,
          origins,
          type,
        },
        toolName: "maps_distance",
      });
      return toPrettyJson(result);
    },
    {
      name: "amap_distance",
      description:
        "Estimate distance between coordinates with AMap MCP. Coordinates use longitude,latitude.",
      schema: z.object({
        origins: z
          .string()
          .min(1)
          .describe("Origin coordinate, or multiple origins separated by |."),
        destination: z.string().min(1).describe("Destination coordinate."),
        type: z
          .enum(["0", "1", "3"])
          .default("1")
          .describe("AMap distance type: 0 straight, 1 driving, 3 walking."),
      }),
    },
  );

  const webSearchTool = tool(
    async ({ queries }) => {
      const results = await searchWithTavily(context.runtime.config, queries);
      return toPrettyJson({
        count: results.length,
        results: results.slice(0, 8).map((item) => ({
          content: truncateText(item.rawContent ?? item.content, 800),
          query: item.query,
          title: item.title,
          url: item.url,
        })),
      });
    },
    {
      name: "travel_web_search",
      description:
        "Fallback web search for travel facts when AMap MCP is unavailable.",
      schema: z.object({
        queries: z.array(z.string().min(2)).min(1).max(5),
      }),
    },
  );

  const pexelsAttractionImagesTool = tool(
    async ({ attractions, city, imagesPerAttraction }) => {
      const results: TravelPexelsAttractionImages[] = [];

      for (const [attractionIndex, attractionName] of attractions.entries()) {
        const result = await searchPexelsImagesForAttraction(
          context.runtime.config,
          {
            attractionName,
            city,
            count: imagesPerAttraction,
          },
          {
            logger: context.runtime.logger,
            parentToolName: "pexels_attraction_images",
          },
        );
        const images: DownloadedPexelsImage[] = [];

        for (const [imageIndex, image] of result.images.entries()) {
          const downloadedImage = await downloadPexelsImageAsset(
            context,
            image,
            attractionName,
            attractionIndex,
            imageIndex,
          );

          if (downloadedImage.downloadSuccess) {
            pexelsImagePathMap.set(
              downloadedImage.remoteImageUrl,
              downloadedImage.markdownImageUrl,
            );
          }

          images.push(downloadedImage);
        }

        results.push({
          ...result,
          images,
        });
      }

      return toPrettyJson({
        results,
        success: results.some((item) => item.success),
      });
    },
    {
      name: "pexels_attraction_images",
      description:
        "Search Pexels MCP for 1-3 landscape images for each selected attraction, download them to local assets, and return Markdown-ready local image paths.",
      schema: z.object({
        attractions: z
          .array(z.string().min(1))
          .min(1)
          .max(10)
          .describe("Final attraction names that need images."),
        city: z.string().min(1).describe("Destination city name."),
        imagesPerAttraction: z
          .number()
          .int()
          .min(1)
          .max(3)
          .default(3)
          .describe("Image count per attraction, from 1 to 3."),
      }),
    },
  );

  const writeTravelPlanArtifactTool = tool(
    async ({ markdown, label }) => {
      const normalizedMarkdown = normalizeAttractionCardLayout(
        replaceDownloadedImageUrls(markdown, pexelsImagePathMap),
      );
      const finalMarkdown = normalizeTravelImageGridLayout(normalizedMarkdown);
      const unverifiedPriceText = findUnverifiedPriceText(finalMarkdown);
      if (unverifiedPriceText) {
        return toPrettyJson({
          reason: `最终计划包含疑似未由工具校验的估算价格“${unverifiedPriceText}”。请删除该具体价格，改写为“未查询到”或提示出行前确认。`,
          success: false,
        });
      }

      const standaloneAttractionImageSection =
        findStandaloneAttractionImageSection(finalMarkdown);
      if (standaloneAttractionImageSection) {
        return toPrettyJson({
          reason:
            "最终计划仍包含独立的“景点配图”章节。请删除该章节，把每个景点的配图移动到“景点/餐饮候选”里的对应景点卡片中。",
          success: false,
        });
      }

      const attractionTableText = findAttractionTableText(finalMarkdown);
      if (attractionTableText) {
        return toPrettyJson({
          reason:
            "最终计划仍把景点候选写成表格。请改为每个景点一个卡片块，卡片内包含地址、开放时间、评分、亮点和该景点配图；餐饮候选可以保留表格。",
          success: false,
        });
      }

      const artifact = await writeAgentArtifact(context.state, context.runtime, {
        agentName: "travelReactAgent",
        label,
        extension: "md",
        content: finalMarkdown,
      });
      context.artifacts.push(artifact);

      return toPrettyJson({
        path: formatArtifactPath(context.state.cwd, artifact.filePath),
        success: true,
      });
    },
    {
      name: "write_travel_plan_artifact",
      description:
        "Write the final travel plan Markdown artifact. Call this once after the final plan is complete. If the tool returns success:true, stop calling tools and provide the final answer.",
      schema: z.object({
        markdown: z.string().min(1).describe("Complete final travel plan Markdown."),
        label: z.string().min(1).default("travel-plan"),
      }),
    },
  );

  return [
    createCurrentTimeTool(),
    createTravelDateValidationTool(),
    weatherQueryTool,
    amapListToolsTool,
    amapTextSearchTool,
    amapSearchDetailTool,
    amapGeoTool,
    amapDistanceTool,
    webSearchTool,
    pexelsAttractionImagesTool,
    writeTravelPlanArtifactTool,
  ];
}
