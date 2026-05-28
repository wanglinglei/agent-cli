/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护本地命令意图、计划和未知任务相关提示词。
 * @FilePath: /agents-cli/src/prompts/commandPrompts.ts
 * @LastEditTime: 2026-05-28 11:01:33
 */
/**
 * 构建命令意图解析提示词。
 */
export function buildCommandIntentPrompt(input: string, cwd: string): string {
  return `你是命令意图解析 Agent。请分析用户想让 CLI 做什么。

输出 JSON：
{
  "goal": "用户真实目标",
  "commandType": "shell | git | script | mixed",
  "target": "主要操作对象",
  "cwd": "执行目录",
  "constraints": ["限制条件"]
}

当前执行目录：
${cwd}

用户任务：
${input}`;
}

/**
 * 构建命令计划生成提示词。
 */
export function buildCommandPlanPrompt(
  input: string,
  commandIntentJson: string,
): string {
  return `你是命令生成 Agent。请把用户目标转换为安全、可执行、可审查的命令计划。

安全要求：
1. 不要生成 rm -rf、git reset --hard、git clean -fd。
2. sudo 只有在用户目标明确需要提权时才可生成，后续会要求人工确认。
3. 默认不要覆盖原文件。
4. 需要批量处理图片时，在 macOS 优先使用 sips，并输出到 compressed/ 目录。
5. 如果需要创建目录，命令可以包含 mkdir -p。
6. 命令必须能在 zsh 中执行。
7. 只输出 JSON，不要 Markdown。

输出 JSON：
{
  "goal": "命令计划目标",
  "commands": [
    {
      "command": "可执行命令",
      "explanation": "为什么执行这条命令",
      "expectedOutput": "预期输出"
    }
  ],
  "requiresScript": false,
  "notes": ["执行前需要知道的注意事项"]
}

命令意图：
${commandIntentJson}

用户原始任务：
${input}`;
}

/**
 * 构建未知任务提示文案。
 */
export function buildUnknownTaskMessage(reason: string | undefined): string {
  return `我无法可靠判断这个任务应该走搜索写作流程还是本地命令流程，因此没有执行任何操作。

路由原因：${reason ?? "未知"}

请补充你希望我完成的具体目标，例如：
- 写一篇包含资料来源的学习笔记
- 帮我批量压缩当前目录所有图片
- 帮我查看最近三次 Git 提交并解释`;
}
