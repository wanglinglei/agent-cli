/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 注册本地命令 Agent flow 的节点和边。
 * @FilePath: /agents-cli/src/agents/command/flow.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import { commandReactAgent } from "./agents.js";
import { COMMAND_ROUTE } from "./pluginData.js";
import { GRAPH_END } from "../../graph/flowTypes.js";
import type { AgentFlowDefinition } from "../../graph/flowTypes.js";

export const commandFlow: AgentFlowDefinition = {
  route: COMMAND_ROUTE,
  description: "需要生成或执行 Shell 命令、Git 指令、排查命令报错、生成脚本。",
  capabilities: ["llm", "shell", "risk_check"],
  startNode: "commandReactAgent",
  nodes: [
    { name: "commandReactAgent", node: commandReactAgent },
  ],
  edges: [
    { from: "commandReactAgent", to: GRAPH_END },
  ],
};
