/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 00:00:00
 * @Description: 提供行政边界流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/agents/boundary/tools/boundaryTools.ts
 * @LastEditTime: 2026-06-04 16:17:30
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
 * 创建行政边界查询、SVG 构建和产物写入工具。
 *
 * 输入当前运行状态和运行时，输出 LangChain 工具集合；大体积 GeoJSON 只在工具闭包
 * 内缓存，不直接返回给模型，避免上下文膨胀。
 */
export function createBoundaryTools(context: BoundaryToolContext) {
  const cache = new Map<string, BoundaryDataCacheItem>();

  const getBoundaryData = async (cityCode: string): Promise<BoundaryDataCacheItem> => {
    const normalizedCityCode = normalizeToolCityCode(cityCode);
    const cached = cache.get(normalizedCityCode);
    if (cached) {
      return cached;
    }

    const boundaryData = await fetchBoundaryDataByCityCode(normalizedCityCode);
    const item = { cityCode: normalizedCityCode, boundaryData };
    cache.set(normalizedCityCode, item);
    return item;
  };

  const resolveCityCodeTool = tool(
    async ({ cityName }) => {
      const result = await searchCityCode(context.runtime.config, cityName);
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
    async ({ cityCode }) => {
      const item = await getBoundaryData(cityCode);
      return toPrettyJson({
        cityCode: item.cityCode,
        featureCount: countFeatures(item.boundaryData),
      });
    },
    {
      name: "fetch_boundary_data",
      description:
        "Fetch boundary GeoJSON data by cityCode and return only a compact summary.",
      schema: z.object({
        cityCode: z.string().regex(/^\d{6,12}$/).describe("Administrative code."),
      }),
    },
  );

  const buildBoundarySvgTool = tool(
    async ({ cityCode, stylePatch }) => {
      const item = await getBoundaryData(cityCode);
      const svgResult = buildBoundarySvg({
        boundaryData: item.boundaryData,
        style: normalizeBoundaryStylePatch(stylePatch as Partial<BoundarySvgStyle>),
      });

      return toPrettyJson({
        cityCode: item.cityCode,
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
        stylePatch: boundaryStylePatchSchema,
      }),
    },
  );

  const writeBoundaryArtifactTool = tool(
    async ({ cityCode, cityName, needSvg, stylePatch }) => {
      const item = await getBoundaryData(cityCode);
      const artifacts: AgentArtifact[] = [];

      if (needSvg) {
        const svgResult = buildBoundarySvg({
          boundaryData: item.boundaryData,
          style: normalizeBoundaryStylePatch(stylePatch as Partial<BoundarySvgStyle>),
        });
        artifacts.push(
          await writeAgentArtifact(context.state, context.runtime, {
            agentName: "boundaryReactAgent",
            label: "boundary-svg",
            extension: "svg",
            content: svgResult.svg,
          }),
        );
      }

      artifacts.push(
        await writeAgentArtifact(context.state, context.runtime, {
          agentName: "boundaryReactAgent",
          label: "boundary-geojson",
          extension: "geojson",
          content: item.boundaryData,
        }),
      );

      context.artifacts.push(...artifacts);

      return toPrettyJson({
        cityCode: item.cityCode,
        cityName,
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
