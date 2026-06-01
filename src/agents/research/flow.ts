/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 注册资料写作 Agent flow 的节点和边。
 * @FilePath: /agents-cli/src/agents/research/flow.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import {
  formatAgent,
  searchAgent,
  summaryAgent,
  writingAgent,
} from "./agents.js";
import { RESEARCH_ROUTE } from "./pluginData.js";
import { GRAPH_END } from "../../graph/flowTypes.js";
import type { AgentFlowDefinition } from "../../graph/flowTypes.js";

export const researchFlow: AgentFlowDefinition = {
  route: RESEARCH_ROUTE,
  description: "需要联网搜索、总结信息、写作、生成 Markdown。",
  capabilities: ["llm", "search", "artifact"],
  startNode: "searchAgent",
  nodes: [
    { name: "searchAgent", node: searchAgent },
    { name: "summaryAgent", node: summaryAgent },
    { name: "writingAgent", node: writingAgent },
    { name: "formatAgent", node: formatAgent },
  ],
  edges: [
    { from: "searchAgent", to: "summaryAgent", stopWhenFinalAnswer: true },
    { from: "summaryAgent", to: "writingAgent", stopWhenFinalAnswer: true },
    { from: "writingAgent", to: "formatAgent", stopWhenFinalAnswer: true },
    { from: "formatAgent", to: GRAPH_END },
  ],
};
