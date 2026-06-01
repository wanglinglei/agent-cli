/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 注册本地命令 Agent flow 的节点和边。
 * @FilePath: /agents-cli/src/agents/command/flow.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import {
  commandAgent,
  confirmNode,
  feedbackAgent,
  intentAgent,
  riskAgent,
  shellExecutorAgent,
} from "./agents.js";
import { COMMAND_ROUTE, commandPluginData } from "./pluginData.js";
import { GRAPH_END } from "../../graph/flowTypes.js";
import type { AgentFlowDefinition } from "../../graph/flowTypes.js";
import type { AgentState } from "../../types.js";

/**
 * 风险检查后的命令流程分支。
 */
function routeAfterRisk(state: AgentState): string {
  const commandData = commandPluginData.read(state);

  if (state.finalAnswer) {
    return GRAPH_END;
  }

  if (commandData.risk?.blocked || !commandData.risk?.safeToExecute) {
    return "feedbackAgent";
  }

  if (commandData.risk.level === "high") {
    return "confirmNode";
  }

  return "shellExecutor";
}

/**
 * 用户确认后的命令流程分支。
 */
function routeAfterConfirm(state: AgentState): string {
  return commandPluginData.read(state).userApproved
    ? "shellExecutor"
    : "feedbackAgent";
}

export const commandFlow: AgentFlowDefinition = {
  route: COMMAND_ROUTE,
  description: "需要生成或执行 Shell 命令、Git 指令、排查命令报错、生成脚本。",
  capabilities: ["llm", "shell", "risk_check"],
  startNode: "intentAgent",
  nodes: [
    { name: "intentAgent", node: intentAgent },
    { name: "commandAgent", node: commandAgent },
    { name: "riskAgent", node: riskAgent },
    { name: "confirmNode", node: confirmNode },
    { name: "shellExecutor", node: shellExecutorAgent },
    { name: "feedbackAgent", node: feedbackAgent },
  ],
  edges: [
    { from: "intentAgent", to: "commandAgent", stopWhenFinalAnswer: true },
    { from: "commandAgent", to: "riskAgent", stopWhenFinalAnswer: true },
    { from: "shellExecutor", to: "feedbackAgent" },
    { from: "feedbackAgent", to: GRAPH_END },
  ],
  conditionalEdges: [
    {
      from: "riskAgent",
      choose: routeAfterRisk,
      targets: {
        confirmNode: "confirmNode",
        shellExecutor: "shellExecutor",
        feedbackAgent: "feedbackAgent",
        [GRAPH_END]: GRAPH_END,
      },
    },
    {
      from: "confirmNode",
      choose: routeAfterConfirm,
      targets: {
        shellExecutor: "shellExecutor",
        feedbackAgent: "feedbackAgent",
      },
    },
  ],
};
