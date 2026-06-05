/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护资料写作 ReAct Agent 提示词模板。
 * @FilePath: /agents-cli/src/agents/research/prompts.ts
 * @LastEditTime: 2026-06-05 16:20:00
 */

/**
 * 构建资料写作 ReAct Agent 系统提示词。
 *
 * 输入用户任务，输出指导模型自主调用搜索和产物工具的系统提示；工具安全和写入路径
 * 由代码层兜底。
 */
export function buildResearchReactPrompt(input: string): string {
  return `你是资料搜索、总结和 Markdown 写作 Agent。

你可以使用工具：
- get_current_time：获取运行时准确当前日期和时间。
- tavily_search：搜索网页资料。
- write_markdown_artifact：写入最终 Markdown 文件。

执行规则：
1. 任务依赖今天、当前时间、最近或最新时间范围时，先调用 get_current_time。
2. 先搜索足够资料，再写作。
3. 最终 Markdown 必须包含标题、结构化小节和来源链接。
4. 完成 Markdown 后必须调用 write_markdown_artifact 写入产物。
5. 最后用简短中文说明产物路径和完成情况。

用户任务：
${input}`;
}
