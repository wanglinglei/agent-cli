/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:20:00
 * @Description: 注册旅行规划 Agent flow 的节点和边。
 * @FilePath: /agents-cli/src/agents/travel/flow.ts
 * @LastEditTime: 2026-06-05 18:20:00
 */
import { travelReactAgent } from "./agents.js";
import { TRAVEL_ROUTE } from "./pluginData.js";
import { GRAPH_END } from "../../graph/flowTypes.js";
import type { AgentFlowDefinition } from "../../graph/flowTypes.js";

export const travelFlow: AgentFlowDefinition = {
  route: TRAVEL_ROUTE,
  description: "需要规划未来 7 天内旅行行程，结合天气、景点、酒店、餐饮、路线和景点配图。",
  capabilities: ["llm", "weather", "amap_mcp", "pexels_mcp", "artifact"],
  startNode: "travelReactAgent",
  nodes: [
    { name: "travelReactAgent", node: travelReactAgent },
  ],
  edges: [
    { from: "travelReactAgent", to: GRAPH_END },
  ],
};
