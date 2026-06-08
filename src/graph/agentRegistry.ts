/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 注册内部 Agent flow 并提供图构建所需的流程元数据。
 * @FilePath: /agents-cli/src/graph/agentRegistry.ts
 * @LastEditTime: 2026-06-05 18:20:00
 */
import { boundaryFlow } from "../agents/boundary/flow.js";
import { commandFlow } from "../agents/command/flow.js";
import { researchFlow } from "../agents/research/flow.js";
import { travelFlow } from "../agents/travel/flow.js";
import { weatherFlow } from "../agents/weather/flow.js";
import type { AgentFlowDefinition } from "./flowTypes.js";

export const agentFlowRegistry: AgentFlowDefinition[] = [
  travelFlow,
  weatherFlow,
  researchFlow,
  boundaryFlow,
  commandFlow,
];

/**
 * 返回已注册 route 名称列表。
 */
export function getRegisteredRoutes(): string[] {
  return agentFlowRegistry.map((flow) => flow.route);
}

/**
 * 判断 route 是否已经注册。
 */
export function isRegisteredRoute(route: string | undefined): boolean {
  return Boolean(route && getRegisteredRoutes().includes(route));
}
