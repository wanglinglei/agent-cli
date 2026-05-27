/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 实现自然语言任务的多 Agent 自动路由节点。
 * @FilePath: /agents-cli/src/agents/routerAgent.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import { z } from "zod";

import { invokeJson } from "../json.js";
import { buildRouterPrompt } from "../prompts/routerPrompts.js";
import { truncateText } from "../text.js";
import type { AgentRuntime, AgentState, RouteDecision } from "../types.js";

const routeSchema = z.object({
  route: z.enum(["research_write", "local_command", "unknown"]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

/**
 * 自动路由 Agent。
 *
 * 输入用户自然语言任务，输出结构化 route。用户不需要显式指定 Agent 名称，
 * 后续 LangGraph 会根据该结果选择资料写作流程或本地命令流程。
 */
export async function routerAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "routerAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  try {
    const decision = await invokeJson<RouteDecision>(
      runtime.llm,
      buildRouterPrompt(state.input),
      routeSchema,
    );

    const normalized =
      decision.confidence < 0.55
        ? {
            ...decision,
            route: "unknown" as const,
            reason: `置信度过低：${decision.reason}`,
          }
        : decision;

    runtime.logger.nodeSuccess(
      nodeName,
      `${normalized.route}，置信度 ${normalized.confidence}`,
    );
    runtime.logger.debug("路由结果", normalized);

    return { route: normalized };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      route: {
        route: "unknown",
        reason: "路由 Agent 执行失败，无法安全判断任务类型。",
        confidence: 0,
      },
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
    };
  }
}
