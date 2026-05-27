/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 封装 Tavily 搜索工具并标准化搜索结果结构。
 * @FilePath: /agents-cli/src/tools/tavilySearch.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import { TavilySearch } from "@langchain/tavily";

import { requireTavilyApiKey } from "../config.js";
import type { AppConfig, SearchResult } from "../types.js";

/**
 * 将 Tavily 原始返回值标准化为项目内部 SearchResult。
 *
 * Tavily 的字段名可能包含 snake_case，这里集中做兼容，避免上层 Agent 直接依赖
 * 第三方返回结构。
 */
function normalizeTavilyResults(query: string, raw: unknown): SearchResult[] {
  if (raw && typeof raw === "object" && "error" in raw) {
    throw new Error(String((raw as { error: unknown }).error));
  }

  if (!raw || typeof raw !== "object" || !("results" in raw)) {
    return [];
  }

  const results = (raw as { results: unknown }).results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      query,
      title: String(record.title ?? "未命名来源"),
      url: String(record.url ?? ""),
      content: String(record.content ?? ""),
      rawContent:
        typeof record.raw_content === "string"
          ? record.raw_content
          : typeof record.rawContent === "string"
            ? record.rawContent
            : undefined,
      score: typeof record.score === "number" ? record.score : undefined,
    };
  });
}

/**
 * 使用 Tavily 对多个 query 执行搜索。
 *
 * 第一版采用简单并发搜索，并把所有结果拍平成一个数组；后续如需去重、排序或
 * 来源可信度评估，可以继续在这里扩展。
 */
export async function searchWithTavily(
  config: AppConfig,
  queries: string[],
): Promise<SearchResult[]> {
  const tavilyApiKey = requireTavilyApiKey(config);
  const tool = new TavilySearch({
    tavilyApiKey,
    maxResults: 3,
    topic: "general",
    searchDepth: "basic",
    includeAnswer: true,
    includeRawContent: "markdown",
  });

  const batches = await Promise.all(
    queries.map(async (query) => {
      const raw = await tool.invoke({ query });
      return normalizeTavilyResults(query, raw);
    }),
  );

  return batches.flat();
}
