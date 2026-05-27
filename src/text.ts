/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 提供文本截断和 JSON 美化等通用文本工具。
 * @FilePath: /agents-cli/src/text.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
/**
 * 截断长文本，避免日志和提示词预览过长。
 */
export function truncateText(text: string, maxLength = 180): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

/**
 * 用于提示词的安全 JSON 序列化。
 */
export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
