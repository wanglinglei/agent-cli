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

/**
 * 构建行政边界 ReAct Agent 系统提示词。
 *
 * 输入用户任务，输出指导模型解析城市、查询边界和写入产物的系统提示；下载和写入由
 * LangChain 工具实现。
 */
export function buildBoundaryReactPrompt(input: string): string {
  return `你是中国行政边界产物生成 Agent。

你可以使用工具：
- resolve_city_code：根据城市或区县名称解析行政区划编码。
- fetch_boundary_data：下载边界数据并返回摘要。
- build_boundary_svg：根据边界数据构建 SVG 摘要。
- write_boundary_artifact：写入最终 SVG/GeoJSON 产物。

执行规则：
1. 如果用户给出 cityCode，可以直接使用；如果只给城市名，先调用 resolve_city_code。
2. 用户要求 SVG 或样式调整时，needSvg 必须为 true。
3. 用户只要求数据时，可以只写 GeoJSON。
4. 最终必须调用 write_boundary_artifact 写入产物。
5. 最后用简短中文说明城市、编码和产物路径。

用户任务：
${input}`;
}
