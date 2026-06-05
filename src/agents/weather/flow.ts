/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 17:05:00
 * @Description: 注册天气查询 Agent flow 的节点和边。
 * @FilePath: /agents-cli/src/agents/weather/flow.ts
 * @LastEditTime: 2026-06-05 17:05:00
 */
import { weatherReactAgent } from "./agents.js";
import { WEATHER_ROUTE } from "./pluginData.js";
import { GRAPH_END } from "../../graph/flowTypes.js";
import type { AgentFlowDefinition } from "../../graph/flowTypes.js";

export const weatherFlow: AgentFlowDefinition = {
  route: WEATHER_ROUTE,
  description: "需要查询城市天气、未来预报、穿衣出行跑步等天气生活建议。",
  capabilities: ["llm", "weather", "network"],
  startNode: "weatherReactAgent",
  nodes: [
    { name: "weatherReactAgent", node: weatherReactAgent },
  ],
  edges: [
    { from: "weatherReactAgent", to: GRAPH_END },
  ],
};
