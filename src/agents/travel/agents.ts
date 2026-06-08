/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:20:00
 * @Description: 实现旅行规划 ReAct Agent 节点。
 * @FilePath: /agents-cli/src/agents/travel/agents.ts
 * @LastEditTime: 2026-06-05 18:20:00
 */
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { truncateText } from "../../text.js";
import { buildTravelReactPrompt } from "./prompts.js";
import { travelPluginData } from "./pluginData.js";
import { createTravelTools } from "./tools/travelTools.js";
import type { AgentArtifact, AgentRuntime, AgentState } from "../../types.js";

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
