/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 注册行政边界 Agent flow 的节点和边。
 * @FilePath: /agents-cli/src/agents/boundary/flow.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import { boundaryReactAgent } from "./agents.js";
import { BOUNDARY_ROUTE } from "./pluginData.js";
import { GRAPH_END } from "../../graph/flowTypes.js";
import type { AgentFlowDefinition } from "../../graph/flowTypes.js";

export const boundaryFlow: AgentFlowDefinition = {
  route: BOUNDARY_ROUTE,
  description: "需要查询中国城市/区县行政边界，输出 SVG 或 GeoJSON 文件。",
  capabilities: ["llm", "network", "artifact"],
  startNode: "boundaryReactAgent",
  nodes: [
    { name: "boundaryReactAgent", node: boundaryReactAgent },
  ],
  edges: [
    { from: "boundaryReactAgent", to: GRAPH_END },
  ],
};
