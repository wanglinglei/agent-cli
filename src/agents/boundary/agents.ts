/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 20:05:00
 * @Description: 实现行政边界查询、SVG 生成和产物输出 ReAct Agent 节点。
 * @FilePath: /agents-cli/src/agents/boundary/agents.ts
 * @LastEditTime: 2026-06-05 16:20:00
 */
import { boundaryPluginData } from "./pluginData.js";
import { buildBoundaryReactPrompt } from "./prompts.js";
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { createBoundaryTools } from "./tools/boundaryTools.js";
import { truncateText } from "../../text.js";
import type {
  AgentArtifact,
  AgentRuntime,
  AgentState,
} from "../../types.js";

/**
 * 行政边界 ReAct Agent。
 *
 * 输入用户边界生成任务，调用 LangChain 标准城市解析、边界下载、SVG 构建和产物写入
 * 工具完成任务；工具调用摘要写入本 flow 私有状态。
 */
export async function boundaryReactAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "boundaryReactAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  const artifacts: AgentArtifact[] = [];

  try {
    const result = await runReactToolAgent({
      nodeName,
      prompt: buildBoundaryReactPrompt(state.input),
      state,
      runtime,
      tools: createBoundaryTools({ state, runtime, artifacts }),
    });

    runtime.logger.nodeSuccess(nodeName, truncateText(result.finalAnswer));
    runtime.logger.debug("ReAct 工具调用摘要", result.toolEvents);

    return {
      pluginData: boundaryPluginData.update(state, {
        toolEvents: result.toolEvents,
        finalContent: result.finalAnswer,
      }),
      finalAnswer: result.finalAnswer,
      artifacts: [...state.artifacts, ...artifacts],
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "行政边界 ReAct Agent 执行失败，未能输出 SVG 或 GeoJSON 文件。",
    };
  }
}
