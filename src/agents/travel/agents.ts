/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:20:00
 * @Description: 实现旅行规划 ReAct Agent 节点。
 * @FilePath: /agents-cli/src/agents/travel/agents.ts
 * @LastEditTime: 2026-06-05 18:20:00
 */
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { formatArtifactPath } from "../../artifacts.js";
import { truncateText } from "../../text.js";
import { buildTravelReactPrompt } from "./prompts.js";
import { travelPluginData } from "./pluginData.js";
import { createTravelTools } from "./tools/travelTools.js";
import type { AgentArtifact, AgentRuntime, AgentState } from "../../types.js";

/**
 * 根据已写入的旅行产物生成最终说明。
 *
 * 输入当前图状态和本节点写入的产物列表，输出面向 CLI 的简短完成文案；当 ReAct
 * 在产物写入后继续循环并抛出停止异常时，用该文案作为成功兜底。
 */
function buildTravelArtifactFinalAnswer(
  state: AgentState,
  artifacts: AgentArtifact[],
): string {
  const artifactPaths = artifacts.map((artifact) =>
    formatArtifactPath(state.cwd, artifact.filePath),
  );

  if (artifactPaths.length === 1) {
    return `旅行计划已生成：${artifactPaths[0]}`;
  }

  return `旅行计划已生成：${artifactPaths.join("、")}`;
}

/**
 * 旅行规划 ReAct Agent。
 *
 * 输入旅行规划任务，调用日期校验、天气、高德 MCP 和 Markdown 产物工具生成最终
 * 行程；工具调用摘要写入本 flow 私有状态，失败时终止并返回错误说明。
 */
export async function travelReactAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "travelReactAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  const artifacts: AgentArtifact[] = [];

  try {
    const result = await runReactToolAgent({
      nodeName,
      prompt: buildTravelReactPrompt(state.input),
      recursionLimit: 60,
      state,
      runtime,
      tools: createTravelTools({ state, runtime, artifacts }),
    });

    runtime.logger.nodeSuccess(nodeName, truncateText(result.finalAnswer));
    runtime.logger.debug("ReAct 工具调用摘要", result.toolEvents);

    return {
      pluginData: travelPluginData.update(state, {
        toolEvents: result.toolEvents,
        finalContent: result.finalAnswer,
      }),
      finalAnswer: result.finalAnswer,
      artifacts: [...state.artifacts, ...artifacts],
    };
  } catch (error) {
    if (artifacts.length > 0) {
      const finalAnswer = buildTravelArtifactFinalAnswer(state, artifacts);
      runtime.logger.warn(
        `${nodeName} 已写入旅行计划产物，后续 ReAct 停止异常按完成处理。`,
      );
      runtime.logger.debug("产物写入后的 ReAct 异常", error);
      runtime.logger.nodeSuccess(nodeName, truncateText(finalAnswer));

      return {
        pluginData: travelPluginData.update(state, {
          toolEvents: [],
          finalContent: finalAnswer,
        }),
        finalAnswer,
        artifacts: [...state.artifacts, ...artifacts],
      };
    }

    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "旅行规划 Agent 执行失败，未能生成旅行计划。",
    };
  }
}
