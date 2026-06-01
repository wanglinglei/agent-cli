/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 维护资料写作 Agent flow 的私有状态存储。
 * @FilePath: /agents-cli/src/agents/research/pluginData.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import { PluginDataStore } from "../../graph/pluginData.js";
import type { SearchResult } from "../../types.js";

export const RESEARCH_ROUTE = "research_write";

/**
 * 资料写作流程的私有状态。
 */
export interface ResearchPluginData {
  searchQueries: string[];
  searchResults: SearchResult[];
  summary?: string;
  draft?: string;
  finalMarkdown?: string;
}

/**
 * 资料写作流程状态存储。
 *
 * 当前只使用基类读写能力，后续可扩展追加来源、清理草稿等专用状态方法。
 */
class ResearchPluginDataStore extends PluginDataStore<ResearchPluginData> {}

export const researchPluginData = new ResearchPluginDataStore(RESEARCH_ROUTE, {
  searchQueries: [],
  searchResults: [],
});

