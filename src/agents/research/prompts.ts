/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护资料搜索、总结、写作和格式化相关提示词。
 * @FilePath: /agents-cli/src/agents/research/prompts.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
/**
 * 构建搜索 query 生成提示词。
 */
export function buildSearchQueryPrompt(input: string): string {
  return `你是搜索 Agent。请把用户任务拆成适合 Tavily 搜索的 query。

要求：
1. 输出 3 到 5 个中文或英文搜索 query。
2. query 应覆盖背景概念、最新资料、实践案例和关键争议。
3. 只输出 JSON：{"queries":["..."]}

用户任务：
${input}`;
}

/**
 * 构建资料总结提示词。
 */
export function buildSummaryPrompt(input: string, formattedSearchResults: string): string {
  return `你是总结 Agent。请基于搜索资料整理一份事实摘要，供后续写作使用。

要求：
1. 不要编造搜索资料中没有的信息。
2. 按“核心结论、关键概念、实践步骤、注意事项、可引用来源”组织。
3. 每条重要结论尽量标注来源链接。

用户任务：
${input}

搜索资料：
${formattedSearchResults}`;
}

/**
 * 构建写作初稿提示词。
 */
export function buildWritingPrompt(input: string, summary: string | undefined): string {
  return `你是写作 Agent。请基于资料摘要写一份完整内容初稿。

写作目标：
${input}

资料摘要：
${summary ?? "无"}

要求：
1. 面向初学者，解释清楚概念和实践路径。
2. 保留资料来源线索，不要删除链接。
3. 内容要完整，但不要输出最终 Markdown 目录。`;
}

/**
 * 构建最终 Markdown 格式化提示词。
 */
export function buildFormatPrompt(
  input: string,
  draft: string | undefined,
  sourcesJson: string,
): string {
  return `你是格式化 Agent。请把初稿整理成标准 Markdown。

要求：
1. 输出完整 Markdown，不要额外解释。
2. 包含标题、目录、正文、要点总结、资料来源。
3. 资料来源使用 Markdown 链接。
4. 不要编造不存在的来源。

用户任务：
${input}

初稿：
${draft ?? "无"}

可用来源：
${sourcesJson}`;
}
