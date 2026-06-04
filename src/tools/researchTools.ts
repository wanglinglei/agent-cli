/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 00:00:00
 * @Description: 提供资料写作流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/tools/researchTools.ts
 * @LastEditTime: 2026-06-04 00:00:00
 */
import { tool } from "langchain";
import { z } from "zod";

import { formatArtifactPath, writeAgentArtifact } from "../artifacts.js";
import { toPrettyJson, truncateText } from "../text.js";
import { searchWithTavily } from "./tavilySearch.js";
import type { AgentArtifact, AgentRuntime, AgentState } from "../types.js";

/**
 * 资料工具创建上下文。
 */
export interface ResearchToolContext {
  state: AgentState;
  runtime: AgentRuntime;
  artifacts: AgentArtifact[];
}

/**
 * 创建资料搜索和 Markdown 写入工具。
 *
 * 输入当前运行状态和运行时，输出 LangChain 工具集合；工具只返回结构化文本结果，
 * 产物记录通过上下文收集器交回 Agent 节点。
 */
export function createResearchTools(context: ResearchToolContext) {
  const tavilySearchTool = tool(
    async ({ queries }) => {
      const results = await searchWithTavily(context.runtime.config, queries);
      return toPrettyJson({
        count: results.length,
        results: results.slice(0, 10).map((item) => ({
          query: item.query,
          title: item.title,
          url: item.url,
          content: truncateText(item.rawContent ?? item.content, 1200),
          score: item.score,
        })),
      });
    },
    {
      name: "tavily_search",
      description:
        "Search the web with Tavily and return normalized source snippets for research writing.",
      schema: z.object({
        queries: z
          .array(z.string().min(2).describe("Search query."))
          .min(1)
          .max(5)
          .describe("One to five focused search queries."),
      }),
    },
  );

  const writeMarkdownArtifactTool = tool(
    async ({ markdown, label }) => {
      const artifact = await writeAgentArtifact(context.state, context.runtime, {
        agentName: "researchReactAgent",
        label,
        extension: "md",
        content: markdown,
      });
      context.artifacts.push(artifact);

      return toPrettyJson({
        path: formatArtifactPath(context.state.cwd, artifact.filePath),
      });
    },
    {
      name: "write_markdown_artifact",
      description:
        "Write the final research Markdown artifact. Call this once after the final markdown is complete.",
      schema: z.object({
        markdown: z.string().min(1).describe("Complete final Markdown content."),
        label: z
          .string()
          .min(1)
          .default("final")
          .describe("Artifact label without file extension."),
      }),
    },
  );

  return [tavilySearchTool, writeMarkdownArtifactTool];
}
