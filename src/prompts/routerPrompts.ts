/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护多 Agent 任务路由判断相关提示词。
 * @FilePath: /agents-cli/src/prompts/routerPrompts.ts
 * @LastEditTime: 2026-05-27 20:05:00
 */
/**
 * 构建路由 Agent 提示词。
 *
 * routerAgent 只负责判断任务应该进入哪条 LangGraph 分支，不执行任务本身。
 */
export function buildRouterPrompt(input: string): string {
  return `你是多 Agent CLI 的路由器。请判断用户任务应该进入哪条流程。

可选 route：
1. research_write：需要搜索资料、总结信息、写作、生成 Markdown。
2. local_command：需要生成或执行 Shell 命令、Git 指令、排查命令报错、生成脚本。
3. boundary_svg：需要查询中国城市/区县行政边界，输出 SVG 或 GeoJSON 文件。
4. unknown：任务目标不清晰，或者不属于以上几类。

只输出 JSON 对象：
{
  "route": "research_write | local_command | boundary_svg | unknown",
  "reason": "判断原因",
  "confidence": 0 到 1 的数字
}

用户任务：
${input}`;
}
