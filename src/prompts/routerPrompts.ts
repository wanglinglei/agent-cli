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
export function buildRouterPrompt(
  input: string,
  routeOptions: Array<{ route: string; description: string }>,
): string {
  const formattedRoutes = routeOptions
    .map((item, index) => `${index + 1}. ${item.route}：${item.description}`)
    .join("\n");

  return `你是多 Agent CLI 的路由器。请判断用户任务应该进入哪条流程。

可选 route：
${formattedRoutes}
${routeOptions.length + 1}. unknown：任务目标不清晰，或者不属于以上几类。

只输出 JSON 对象：
{
  "route": "${routeOptions.map((item) => item.route).join(" | ")} | unknown",
  "reason": "判断原因",
  "confidence": 0 到 1 的数字
}

用户任务：
${input}`;
}
