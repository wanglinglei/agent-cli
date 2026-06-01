/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 实现无法可靠路由任务的兜底 Agent 节点。
 * @FilePath: /agents-cli/src/agents/unknown/agents.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import { truncateText } from "../../text.js";
import type { AgentRuntime, AgentState } from "../../types.js";

/**
 * 构建未知任务提示文案。
 */
function buildUnknownTaskMessage(reason: string | undefined): string {
  return `我无法可靠判断这个任务应该走哪条 Agent 流程，因此没有执行任何操作。

路由原因：${reason ?? "未知"}

请补充你希望我完成的具体目标，例如：
- 写一篇包含资料来源的学习笔记
- 生成高邮市行政边界 SVG
- 帮我查看最近三次 Git 提交并解释`;
}

/**
 * 未知任务处理节点。
 *
 * 当 routerAgent 无法可靠判断任务类型时，不进入任何可能产生副作用的流程，而是
 * 要求用户补充更明确的目标。
 */
export async function unknownAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "unknownAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  const finalAnswer = buildUnknownTaskMessage(state.route?.reason);

  runtime.logger.nodeSuccess(nodeName, "已生成澄清提示");
  return { finalAnswer };
}
