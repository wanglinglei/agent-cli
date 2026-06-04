/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 实现资料搜索、总结、写作和 Markdown 格式化 Agent 节点。
 * @FilePath: /agents-cli/src/agents/research/agents.ts
 * @LastEditTime: 2026-06-01 17:33:08
 */
import { z } from "zod";

import {
  appendArtifact,
  formatArtifactPath,
  writeAgentArtifact,
} from "../../artifacts.js";
import { invokeJson, invokeText } from "../../json.js";
import {
  buildFormatPrompt,
  buildResearchReactPrompt,
  buildSearchQueryPrompt,
  buildSummaryPrompt,
  buildWritingPrompt,
} from "./prompts.js";
import { researchPluginData } from "./pluginData.js";
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { createResearchTools } from "../../tools/researchTools.js";
import { searchWithTavily } from "../../tools/tavilySearch.js";
import { toPrettyJson, truncateText } from "../../text.js";
import type {
  AgentArtifact,
  AgentRuntime,
  AgentState,
  SearchResult,
} from "../../types.js";

const searchQuerySchema = z.object({
  queries: z.array(z.string().min(2)).min(1).max(5),
});

/**
 * 资料写作 ReAct Agent。
 *
 * 输入用户资料型任务，调用 LangChain 标准搜索和产物工具完成搜索、写作和 Markdown
 * 写入；工具调用摘要写入本 flow 私有状态，失败时终止流程。
 */
export async function researchReactAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "researchReactAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  const artifacts: AgentArtifact[] = [];

  try {
    const result = await runReactToolAgent({
      nodeName,
      prompt: buildResearchReactPrompt(state.input),
      state,
      runtime,
      tools: createResearchTools({ state, runtime, artifacts }),
    });

    runtime.logger.nodeSuccess(nodeName, truncateText(result.finalAnswer));
    runtime.logger.debug("ReAct 工具调用摘要", result.toolEvents);

    return {
      pluginData: researchPluginData.update(state, {
        toolEvents: result.toolEvents,
        finalContent: result.finalAnswer,
      }),
      finalAnswer: result.finalAnswer,
      artifacts: [...state.artifacts, ...artifacts],
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "资料写作 ReAct Agent 执行失败，无法生成最终 Markdown。",
    };
  }
}

/**
 * 将搜索结果压缩成适合放入提示词的资料块。
 */
function formatSearchResultsForPrompt(results: SearchResult[]): string {
  return results
    .slice(0, 12)
    .map((item, index) => {
      const content = item.rawContent || item.content;
      return `资料 ${index + 1}
标题：${item.title}
链接：${item.url}
搜索词：${item.query}
内容摘录：
${truncateText(content, 1400)}`;
    })
    .join("\n\n");
}

/**
 * 搜索 Agent。
 *
 * 根据用户目标生成 3-5 个搜索 query，并调用 Tavily 获取网页资料。该节点负责
 * 把开放的自然语言任务转成可检索的问题集合。
 */
export async function searchAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "searchAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  try {
    const queryOutput = await invokeJson(
      runtime.llm,
      buildSearchQueryPrompt(state.input),
      searchQuerySchema,
    );

    const searchResults = await searchWithTavily(
      runtime.config,
      queryOutput.queries,
    );

    runtime.logger.nodeSuccess(
      nodeName,
      `生成 ${queryOutput.queries.length} 个 query，获得 ${searchResults.length} 条结果`,
    );
    runtime.logger.debug("搜索 query", queryOutput.queries);
    runtime.logger.debug("搜索结果", searchResults);

    return {
      pluginData: researchPluginData.update(state, {
        searchQueries: queryOutput.queries,
        searchResults,
      }),
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "搜索 Agent 执行失败，无法继续生成资料型内容。",
    };
  }
}

/**
 * 总结 Agent。
 *
 * 读取 Tavily 搜索结果，提炼主题背景、关键概念、步骤方法、实践建议和来源链接，
 * 为写作 Agent 提供干净的事实基础。
 */
export async function summaryAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "summaryAgent";
  const researchData = researchPluginData.read(state);
  runtime.logger.nodeStart(
    nodeName,
    `搜索结果 ${researchData.searchResults.length} 条`,
  );

  try {
    const summary = await invokeText(
      runtime.llm,
      buildSummaryPrompt(
        state.input,
        formatSearchResultsForPrompt(researchData.searchResults),
      ),
    );

    runtime.logger.nodeSuccess(nodeName, truncateText(summary));
    runtime.logger.debug("资料摘要", summary);

    return { pluginData: researchPluginData.update(state, { summary }) };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "总结 Agent 执行失败，无法继续写作。",
    };
  }
}

/**
 * 写作 Agent。
 *
 * 根据总结 Agent 产出的事实摘要生成完整初稿，关注内容结构和表达完整性，不负责
 * 最终 Markdown 排版。
 */
export async function writingAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "writingAgent";
  const researchData = researchPluginData.read(state);
  runtime.logger.nodeStart(nodeName, truncateText(researchData.summary ?? ""));

  try {
    const draft = await invokeText(
      runtime.llm,
      buildWritingPrompt(state.input, researchData.summary),
    );

    runtime.logger.nodeSuccess(nodeName, truncateText(draft));
    runtime.logger.debug("写作初稿", draft);

    return { pluginData: researchPluginData.update(state, { draft }) };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "写作 Agent 执行失败，无法生成初稿。",
    };
  }
}

/**
 * 格式化 Agent。
 *
 * 将写作初稿整理为标准 Markdown，补充标题、目录、层级标题和资料来源列表，作为
 * 资料型流程的最终输出。
 */
export async function formatAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "formatAgent";
  const researchData = researchPluginData.read(state);
  runtime.logger.nodeStart(nodeName, truncateText(researchData.draft ?? ""));

  try {
    const sources = researchData.searchResults
      .filter((item) => item.url)
      .slice(0, 10)
      .map((item) => ({ title: item.title, url: item.url }));

    const finalMarkdown = await invokeText(
      runtime.llm,
      buildFormatPrompt(state.input, researchData.draft, toPrettyJson(sources)),
    );

    runtime.logger.nodeSuccess(nodeName, "已生成最终 Markdown");
    runtime.logger.debug("最终 Markdown", finalMarkdown);

    const artifact = await writeAgentArtifact(state, runtime, {
      agentName: nodeName,
      label: "final",
      extension: "md",
      content: finalMarkdown,
    });

    return {
      pluginData: researchPluginData.update(state, { finalMarkdown }),
      finalAnswer: `最终 Markdown 已写入：${formatArtifactPath(
        state.cwd,
        artifact.filePath,
      )}`,
      artifacts: appendArtifact(state, artifact),
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "格式化 Agent 执行失败，无法生成 Markdown。",
    };
  }
}
