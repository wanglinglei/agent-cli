/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护模型 JSON 输出修复相关提示词。
 * @FilePath: /agents-cli/src/prompts/jsonRepairPrompts.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
/**
 * 构建 JSON 修复提示词。
 */
export function buildJsonRepairPrompt(rawText: string, parseError: string): string {
  return `请把下面内容修复为严格 JSON。
要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. 字段必须符合任务要求。

原始内容：
${rawText}

解析错误：
${parseError}
`;
}
