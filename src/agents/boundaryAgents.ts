/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 20:05:00
 * @Description: 实现行政边界查询、SVG 生成和产物输出 Agent 节点。
 * @FilePath: /agents-cli/src/agents/boundaryAgents.ts
 * @LastEditTime: 2026-05-27 20:10:00
 */
import { z } from "zod";

import { appendArtifact, formatArtifactPath, writeAgentArtifact } from "../artifacts.js";
import { invokeJson } from "../json.js";
import { buildBoundaryIntentPrompt } from "../prompts/boundaryPrompts.js";
import { fetchBoundaryDataByCityCode } from "../tools/boundaryFetch.js";
import { searchCityCode } from "../tools/boundaryCityCode.js";
import { buildBoundarySvg, normalizeBoundaryStylePatch } from "../tools/boundarySvg.js";
import { truncateText } from "../text.js";
import type {
  AgentRuntime,
  AgentState,
  BoundaryCityResolution,
  BoundaryIntent,
  BoundarySvgStyle,
} from "../types.js";

const boundaryIntentSchema = z.object({
  action: z.enum(["generate_boundary", "update_svg_style"]),
  cityCode: z.string().regex(/^\d{6,12}$/).optional(),
  cityName: z.string().min(2).optional(),
  needSvg: z.boolean(),
  year: z.literal(2023),
  stylePatch: z
    .object({
      fillColor: z.string().min(1).optional(),
      strokeColor: z.string().min(1).optional(),
      strokeWidth: z.number().positive().optional(),
    })
    .partial()
    .optional(),
});

/**
 * 拼接边界产物写入后的最终说明。
 *
 * 输入主产物与可选附属产物，输出简短终态文案；不会修改状态，失败策略是返回基础文案。
 */
function buildBoundaryFinalAnswer(
  cwd: string,
  primaryArtifactPath: string,
  secondaryArtifactPath?: string,
): string {
  const primaryPath = formatArtifactPath(cwd, primaryArtifactPath);
  if (!secondaryArtifactPath) {
    return `边界产物已写入：${primaryPath}`;
  }

  return `边界产物已写入：${primaryPath}；附带数据：${formatArtifactPath(
    cwd,
    secondaryArtifactPath,
  )}`;
}

/**
 * 生成面向用户的 SVG 结果摘要。
 *
 * 输入城市名称、城市编码和样式，输出日志摘要；仅用于日志和最终反馈，不参与业务判断。
 */
function summarizeSvgResult(
  cityName: string | undefined,
  cityCode: string,
  style: BoundarySvgStyle,
): string {
  const target = cityName ? `${cityName}（${cityCode}）` : cityCode;
  return `${target}，fill=${style.fillColor}，stroke=${style.strokeColor}，width=${style.strokeWidth}`;
}

/**
 * 边界意图解析 Agent。
 *
 * 读取用户自然语言任务，输出结构化边界请求；如果用户只要求“改上一个 SVG”
 * 但没有提供城市上下文，会直接终止流程并返回可执行的 CLI 使用限制说明。
 */
export async function boundaryIntentAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "boundaryIntentAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  try {
    const parsed = await invokeJson<BoundaryIntent>(
      runtime.llm,
      buildBoundaryIntentPrompt(state.input),
      boundaryIntentSchema,
    );

    const normalizedStylePatch = normalizeBoundaryStylePatch(parsed.stylePatch);
    const boundaryIntent: BoundaryIntent = {
      ...parsed,
      needSvg: parsed.needSvg || parsed.action === "update_svg_style" || Boolean(normalizedStylePatch),
      ...(normalizedStylePatch ? { stylePatch: normalizedStylePatch } : {}),
    };

    if (
      boundaryIntent.action === "update_svg_style" &&
      !boundaryIntent.cityCode &&
      !boundaryIntent.cityName
    ) {
      runtime.logger.nodeSuccess(nodeName, "缺少会话上下文，终止样式更新");
      return {
        boundaryIntent,
        finalAnswer:
          "当前 CLI 不维护跨运行 SVG 会话。请在同一条命令里明确提供城市名称或 cityCode，再指定样式。",
      };
    }

    runtime.logger.nodeSuccess(
      nodeName,
      `${boundaryIntent.action} / ${boundaryIntent.needSvg ? "svg" : "geojson"}`,
    );
    runtime.logger.debug("边界意图", boundaryIntent);

    return { boundaryIntent };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "边界任务意图解析失败，无法继续生成行政区划边界产物。",
    };
  }
}

/**
 * 城市编码解析 Agent。
 *
 * 优先复用用户显式给出的 cityCode；如果只有城市名称，则通过 Tavily 搜索解析。
 * 该节点只产出结构化编码结果，不负责下载边界数据。
 */
export async function boundaryResolveAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "boundaryResolveAgent";
  runtime.logger.nodeStart(
    nodeName,
    truncateText(state.boundaryIntent?.cityName ?? state.boundaryIntent?.cityCode ?? state.input),
  );

  try {
    if (!state.boundaryIntent) {
      throw new Error("缺少边界意图，无法解析城市编码。");
    }

    const boundaryResolution: BoundaryCityResolution = state.boundaryIntent.cityCode
      ? {
          cityCode: state.boundaryIntent.cityCode,
          cityName: state.boundaryIntent.cityName,
          source: "explicit_input",
        }
      : state.boundaryIntent.cityName
        ? await searchCityCode(runtime.config, state.boundaryIntent.cityName)
        : (() => {
            throw new Error("未识别到城市名称或 cityCode，请明确指定查询目标。");
          })();

    runtime.logger.nodeSuccess(
      nodeName,
      `${boundaryResolution.cityName ?? "未知城市"} / ${boundaryResolution.cityCode}`,
    );
    runtime.logger.debug("城市编码解析结果", boundaryResolution);

    return { boundaryResolution };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "城市编码解析失败，无法继续下载行政区划边界。",
    };
  }
}

/**
 * 边界产物输出 Agent。
 *
 * 下载边界数据并生成最终文件产物。SVG 场景会同时写入 `.svg` 和 `.geojson`，
 * 便于用户二次处理；纯数据场景只写入 `.geojson`。
 */
export async function boundaryOutputAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "boundaryOutputAgent";
  runtime.logger.nodeStart(nodeName, "下载边界并写入最终产物");

  try {
    if (!state.boundaryIntent || !state.boundaryResolution) {
      throw new Error("缺少边界意图或城市编码结果，无法生成产物。");
    }

    const boundaryData = await fetchBoundaryDataByCityCode(state.boundaryResolution.cityCode);

    if (state.boundaryIntent.needSvg) {
      const svgResult = buildBoundarySvg({
        boundaryData,
        style: state.boundaryIntent.stylePatch,
      });

      const svgArtifact = await writeAgentArtifact(state, runtime, {
        agentName: nodeName,
        label: "boundary-svg",
        extension: "svg",
        content: svgResult.svg,
      });
      const geojsonArtifact = await writeAgentArtifact(state, runtime, {
        agentName: nodeName,
        label: "boundary-geojson",
        extension: "geojson",
        content: boundaryData,
      });

      runtime.logger.nodeSuccess(
        nodeName,
        summarizeSvgResult(
          state.boundaryResolution.cityName,
          state.boundaryResolution.cityCode,
          svgResult.style,
        ),
      );

      return {
        finalAnswer: buildBoundaryFinalAnswer(
          state.cwd,
          svgArtifact.filePath,
          geojsonArtifact.filePath,
        ),
        artifacts: [...state.artifacts, svgArtifact, geojsonArtifact],
      };
    }

    const geojsonArtifact = await writeAgentArtifact(state, runtime, {
      agentName: nodeName,
      label: "boundary-geojson",
      extension: "geojson",
      content: boundaryData,
    });

    runtime.logger.nodeSuccess(
      nodeName,
      `${state.boundaryResolution.cityName ?? "未知城市"} / ${state.boundaryResolution.cityCode}`,
    );

    return {
      finalAnswer: buildBoundaryFinalAnswer(state.cwd, geojsonArtifact.filePath),
      artifacts: appendArtifact(state, geojsonArtifact),
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "边界产物生成失败，未能输出 SVG 或 GeoJSON 文件。",
    };
  }
}
