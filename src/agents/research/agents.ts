/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 实现资料写作 ReAct Agent 节点。
 * @FilePath: /agents-cli/src/agents/research/agents.ts
 * @LastEditTime: 2026-06-05 16:20:00
 */
import { buildResearchReactPrompt } from "./prompts.js";
import { researchPluginData } from "./pluginData.js";
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { createResearchTools } from "./tools/researchTools.js";
import { truncateText } from "../../text.js";
import type {
  AgentArtifact,
  AgentRuntime,
  AgentState,
} from "../../types.js";

/**
 * 资料写作 ReAct Agent。
 *
 * 输入用户资料型任务，调用 LangChain 标准搜索和产物工具完成搜索、写作和 Markdown
 * 写入；工具调用摘要写入本 flow 私有状态，失败时终止流程。
 */
export async function researchReactAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "researchReactAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  const artifacts: AgentArtifact[] = [];

  try {
    const result = await runReactToolAgent({
      nodeName,
      prompt: buildResearchReactPrompt(state.input),
      state,
      runtime,
      tools: createResearchTools({ state, runtime, artifacts }),
    });

    runtime.logger.nodeSuccess(nodeName, truncateText(result.finalAnswer));
    runtime.logger.debug("ReAct 工具调用摘要", result.toolEvents);

    return {
      pluginData: researchPluginData.update(state, {
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
      finalAnswer: "资料写作 ReAct Agent 执行失败，无法生成最终 Markdown。",
    };
  }
}
