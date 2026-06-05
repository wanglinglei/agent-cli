/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 实现本地命令 ReAct Agent 节点。
 * @FilePath: /agents-cli/src/agents/command/agents.ts
 * @LastEditTime: 2026-06-05 16:20:00
 */
import { z } from "zod";

import { invokeJson } from "../../json.js";
import { commandPluginData } from "./pluginData.js";
import type { OperationIntentDecision } from "./pluginData.js";
import {
  buildCommandReactPrompt,
  buildOperationIntentPrompt,
} from "./prompts.js";
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { truncateText } from "../../text.js";
import { createCommandTools } from "./tools/commandTools.js";
import type {
  AgentRuntime,
  AgentState,
} from "../../types.js";

const operationIntentSchema = z.object({
  goal: z.string(),
  requestedOperations: z.array(z.string()),
  forbiddenOperations: z.array(z.string()),
  allowedCommandPrefixes: z.array(z.string()),
  blockedCommandPrefixes: z.array(z.string()),
  requiredInformation: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

/**
 * 本地命令 ReAct Agent。
 *
 * 输入用户命令型任务，调用 LangChain 标准风险评估和执行工具完成规划与执行；命令
 * 执行工具内部会重新做风险检查和必要确认；用户操作边界先由大模型结构化分析，
 * 再传给工具做代码兜底拦截，失败时返回最终说明。
 */
export async function commandReactAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "commandReactAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  try {
    const operationIntent = await invokeJson<OperationIntentDecision>(
      runtime.llm,
      buildOperationIntentPrompt(state.input, state.cwd),
      operationIntentSchema,
    );

    runtime.logger.debug("用户操作意图", operationIntent);

    const result = await runReactToolAgent({
      nodeName,
      prompt: buildCommandReactPrompt(state.input, state.cwd, operationIntent),
      state,
      runtime,
      tools: createCommandTools({ state, runtime, operationIntent }),
    });

    runtime.logger.nodeSuccess(nodeName, truncateText(result.finalAnswer));
    runtime.logger.debug("ReAct 工具调用摘要", result.toolEvents);

    return {
      pluginData: commandPluginData.update(state, {
        operationIntent,
        toolEvents: result.toolEvents,
        finalContent: result.finalAnswer,
      }),
      finalAnswer: result.finalAnswer,
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "命令 ReAct Agent 执行失败，未执行或未完成本地命令任务。",
    };
  }
}
