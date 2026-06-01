/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 20:05:00
 * @Description: 维护行政边界 SVG 流程的提示词模板。
 * @FilePath: /agents-cli/src/agents/boundary/prompts.ts
 * @LastEditTime: 2026-05-27 20:05:00
 */

/**
 * 构建边界任务意图解析提示词。
 *
 * 该提示词只负责把用户自然语言约束整理成结构化 JSON，不直接联网、不生成文件。
 */
export function buildBoundaryIntentPrompt(input: string): string {
  return `你是行政区划边界 SVG CLI 的意图解析器。请从用户输入中提取严格 JSON。

任务目标：
1. 判断用户是要生成边界文件，还是想修改 SVG 样式。
2. 识别 cityCode 或 cityName。
3. 判断是否需要输出 SVG；如果用户提到 svg、颜色、填充、描边、线宽、样式，needSvg 必须为 true。
4. 提取样式补丁 stylePatch，可包含 fillColor、strokeColor、strokeWidth。
5. year 固定输出 2023。

字段约束：
- action 只能是 "generate_boundary" 或 "update_svg_style"
- cityCode 必须是字符串数字；没有就省略
- cityName 必须是明确的中国城市/区县/州/盟名称；没有就省略
- needSvg 必须是布尔值
- stylePatch 只允许 fillColor、strokeColor、strokeWidth
- fillColor/strokeColor 优先输出十六进制颜色；无法确定时可输出常见英文颜色名
- strokeWidth 必须是数字
- 不要输出 answer、reason、markdown、代码块或任何额外字段

示例：
{"action":"generate_boundary","cityName":"高邮市","needSvg":true,"year":2023}
{"action":"generate_boundary","cityCode":"321084","needSvg":false,"year":2023}
{"action":"update_svg_style","cityName":"高邮市","needSvg":true,"year":2023,"stylePatch":{"fillColor":"#ff0000","strokeColor":"#111111","strokeWidth":2}}

用户输入：
${input}`;
}
