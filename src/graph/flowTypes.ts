/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 定义 Agent flow 注册表使用的共享类型。
 * @FilePath: /agents-cli/src/graph/flowTypes.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import type { AgentRuntime, AgentState } from "../types.js";

export const GRAPH_END = "__agent_graph_end__";

export type AgentNode = (
  state: AgentState,
  runtime: AgentRuntime,
) => Promise<Partial<AgentState>>;

export interface AgentFlowNode {
  name: string;
  node: AgentNode;
}

export interface AgentFlowEdge {
  from: string;
  to: string;
  stopWhenFinalAnswer?: boolean;
}

export interface AgentFlowConditionalEdge {
  from: string;
  choose: (state: AgentState) => string;
  targets: Record<string, string>;
}

export interface AgentFlowDefinition {
  route: string;
  description: string;
  capabilities?: string[];
  startNode: string;
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  conditionalEdges?: AgentFlowConditionalEdge[];
}

