/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 00:00:00
 * @Description: 提供行政边界流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/agents/boundary/tools/boundaryTools.ts
 * @LastEditTime: 2026-06-10 00:00:00
 */
import { tool } from "langchain";
import { z } from "zod";

import { formatArtifactPath, writeAgentArtifact } from "../../../artifacts.js";
import { toPrettyJson } from "../../../text.js";
import { createCurrentTimeTool } from "../../../tools/currentTime.js";
import {
  buildBoundarySvg,
  normalizeBoundaryStylePatch,
} from "./boundarySvg.js";
import {
  fetchBoundaryDataByBatchZip,
  type BoundaryBatchFetchResult,
} from "./boundaryBatchFetch.js";
import { fetchBoundaryDataByCityCode } from "./boundaryFetch.js";
import { searchCityCode } from "./boundaryCityCode.js";
import type {
  AgentArtifact,
  AgentRuntime,
  AgentState,
  BoundarySvgStyle,
} from "../../../types.js";

/**
 * 边界工具创建上下文。
 */
export interface BoundaryToolContext {
  state: AgentState;
  runtime: AgentRuntime;
  artifacts: AgentArtifact[];
}

/**
 * 边界数据缓存项。
 */
interface BoundaryDataCacheItem {
  cityCode: string;
  boundaryData: Record<string, unknown>;
  includesSubBoundaries: boolean;
  source: "ruiduobao" | "ruiduobao_batch";
  adminLevel?: BoundaryBatchFetchResult["adminLevel"];
  selectedDirectory?: string;
  selectedFileCount?: number;
}

const boundaryStylePatchSchema = z
  .object({
    fillColor: z.string().min(1).optional(),
    strokeColor: z.string().min(1).optional(),
    strokeWidth: z.number().positive().optional(),
  })
  .partial()
  .optional();

/**
 * 统计 GeoJSON feature 数量。
 *
 * 输入边界数据，输出 feature 数量；如果不是 FeatureCollection，则返回 0。
 */
function countFeatures(boundaryData: Record<string, unknown>): number {
  const features = boundaryData.features;
  return Array.isArray(features) ? features.length : 0;
}

/**
 * 规范化工具入参中的城市编码。
 */
function normalizeToolCityCode(cityCode: string): string {
  const normalized = cityCode.trim();
  if (!/^\d{6,12}$/.test(normalized)) {
    throw new Error("cityCode 格式无效，应为 6-12 位数字。");
  }

  return normalized.slice(0, 6);
}

/**
 * 构建边界数据缓存 key。
 *
 * 输入城市编码和是否包含下级边界，输出隔离单区域与下级区域数据的缓存键。
 */
function buildBoundaryCacheKey(
  cityCode: string,
  includeSubBoundaries: boolean,
): string {
  return `${cityCode}:${includeSubBoundaries ? "sub" : "single"}`;
}

/**
 * 将缓存的边界数据整理成可返回给模型的摘要。
 *
 * 输入缓存项，输出轻量 JSON 结构；不会返回完整 GeoJSON，避免上下文膨胀。
 */
function summarizeBoundaryData(item: BoundaryDataCacheItem) {
  return {
    adminLevel: item.adminLevel,
    cityCode: item.cityCode,
    featureCount: countFeatures(item.boundaryData),
    includesSubBoundaries: item.includesSubBoundaries,
    selectedDirectory: item.selectedDirectory,
    selectedFileCount: item.selectedFileCount,
    source: item.source,
  };
}

/**
 * 归一化产物命名使用的城市名。
 *
 * 输入工具入参或城市编码解析缓存中的城市名，输出可用作产物 label 的名称；缺失时
 * 回退到行政区划编码，避免生成空文件名。
 */
function resolveArtifactLabel(
  cityCode: string,
  cityName?: string,
  cachedCityName?: string,
): string {
  const normalizedCityName = (cityName ?? cachedCityName)?.trim();
  return normalizedCityName || cityCode;
}

/**
 * 创建行政边界查询、SVG 构建和产物写入工具。
 *
 * 输入当前运行状态和运行时，输出 LangChain 工具集合；大体积 GeoJSON 只在工具闭包
 * 内缓存，不直接返回给模型，避免上下文膨胀。
 */
export function createBoundaryTools(context: BoundaryToolContext) {
  const cache = new Map<string, BoundaryDataCacheItem>();
  const cityNameCache = new Map<string, string>();

  const getBoundaryData = async (
    cityCode: string,
    options?: {
      includeSubBoundaries?: boolean;
    },
  ): Promise<BoundaryDataCacheItem> => {
    const normalizedCityCode = normalizeToolCityCode(cityCode);
    const includeSubBoundaries = Boolean(options?.includeSubBoundaries);
    const cacheKey = buildBoundaryCacheKey(
      normalizedCityCode,
      includeSubBoundaries,
    );
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (includeSubBoundaries) {
      const batchResult = await fetchBoundaryDataByBatchZip(normalizedCityCode);
      const batchItem: BoundaryDataCacheItem = {
        adminLevel: batchResult.adminLevel,
        boundaryData: batchResult.boundaryData,
        cityCode: batchResult.cityCode,
        includesSubBoundaries: true,
        selectedDirectory: batchResult.selectedDirectory,
        selectedFileCount: batchResult.selectedFileCount,
        source: batchResult.source,
      };
      cache.set(cacheKey, batchItem);
      return batchItem;
    }

    const item: BoundaryDataCacheItem = {
      boundaryData: await fetchBoundaryDataByCityCode(normalizedCityCode),
      cityCode: normalizedCityCode,
      includesSubBoundaries: false,
      source: "ruiduobao",
    };
    cache.set(cacheKey, item);
    return item;
  };

  const resolveCityCodeTool = tool(
    async ({ cityName }) => {
      const result = await searchCityCode(context.runtime.config, cityName);
      if (result.cityName) {
        cityNameCache.set(normalizeToolCityCode(result.cityCode), result.cityName);
      }
      return toPrettyJson(result);
    },
    {
      name: "resolve_city_code",
      description:
        "Resolve a Chinese city or district name to an administrative cityCode.",
      schema: z.object({
        cityName: z.string().min(2).describe("Chinese city or district name."),
      }),
    },
  );

  const fetchBoundaryDataTool = tool(
    async ({ cityCode, includeSubBoundaries }) => {
      const item = await getBoundaryData(cityCode, {
        includeSubBoundaries: includeSubBoundaries ?? true,
      });
      return toPrettyJson(summarizeBoundaryData(item));
    },
    {
      name: "fetch_boundary_data",
      description:
        "Fetch boundary GeoJSON data by cityCode and return only a compact summary. For SVG, keep includeSubBoundaries true to include lower-level borders.",
      schema: z.object({
        cityCode: z.string().regex(/^\d{6,12}$/).describe("Administrative code."),
        includeSubBoundaries: z
          .boolean()
          .optional()
          .describe("Whether to fetch lower-level borders. Defaults to true."),
      }),
    },
  );

  const buildBoundarySvgTool = tool(
    async ({ cityCode, includeSubBoundaries, stylePatch }) => {
      const item = await getBoundaryData(cityCode, {
        includeSubBoundaries: includeSubBoundaries ?? true,
      });
      const svgResult = buildBoundarySvg({
        boundaryData: item.boundaryData,
        style: normalizeBoundaryStylePatch(stylePatch as Partial<BoundarySvgStyle>),
      });

      return toPrettyJson({
        cityCode: item.cityCode,
        includesSubBoundaries: item.includesSubBoundaries,
        svgLength: svgResult.svg.length,
        style: svgResult.style,
      });
    },
    {
      name: "build_boundary_svg",
      description:
        "Build SVG from cached or fetched boundary data and return a compact SVG summary.",
      schema: z.object({
        cityCode: z.string().regex(/^\d{6,12}$/).describe("Administrative code."),
        includeSubBoundaries: z
          .boolean()
          .optional()
          .describe("Whether to include lower-level borders in SVG. Defaults to true."),
        stylePatch: boundaryStylePatchSchema,
      }),
    },
  );

  const writeBoundaryArtifactTool = tool(
    async ({ cityCode, cityName, includeSubBoundaries, needSvg, stylePatch }) => {
      const shouldWriteSvg = needSvg ?? true;
      const item = await getBoundaryData(cityCode, {
        includeSubBoundaries: includeSubBoundaries ?? shouldWriteSvg,
      });
      const artifacts: AgentArtifact[] = [];
      const artifactLabel = resolveArtifactLabel(
        item.cityCode,
        cityName,
        cityNameCache.get(item.cityCode),
      );

      if (shouldWriteSvg) {
        const svgResult = buildBoundarySvg({
          boundaryData: item.boundaryData,
          style: normalizeBoundaryStylePatch(stylePatch as Partial<BoundarySvgStyle>),
        });
        artifacts.push(
          await writeAgentArtifact(context.state, context.runtime, {
            agentName: "boundaryReactAgent",
            label: artifactLabel,
            extension: "svg",
            content: svgResult.svg,
          }),
        );
      }

      artifacts.push(
        await writeAgentArtifact(context.state, context.runtime, {
          agentName: "boundaryReactAgent",
          label: artifactLabel,
          extension: "geojson",
          content: item.boundaryData,
        }),
      );

      context.artifacts.push(...artifacts);

      return toPrettyJson({
        cityCode: item.cityCode,
        cityName: artifactLabel,
        includesSubBoundaries: item.includesSubBoundaries,
        paths: artifacts.map((artifact) => ({
          label: artifact.label,
          path: formatArtifactPath(context.state.cwd, artifact.filePath),
        })),
      });
    },
    {
      name: "write_boundary_artifact",
      description:
        "Write final boundary artifacts. Use this once after cityCode and output type are known.",
      schema: z.object({
        cityCode: z.string().regex(/^\d{6,12}$/).describe("Administrative code."),
        cityName: z.string().optional().describe("Resolved city name."),
        includeSubBoundaries: z
          .boolean()
          .optional()
          .describe("Whether to write lower-level borders. Defaults to needSvg."),
        needSvg: z.boolean().default(true).describe("Whether to write SVG too."),
        stylePatch: boundaryStylePatchSchema,
      }),
    },
  );

  return [
    createCurrentTimeTool(),
    resolveCityCodeTool,
    fetchBoundaryDataTool,
    buildBoundarySvgTool,
    writeBoundaryArtifactTool,
  ];
}
