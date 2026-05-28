/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 检查本地命令计划的风险等级并拦截危险命令。
 * @FilePath: /agents-cli/src/tools/riskChecker.ts
 * @LastEditTime: 2026-05-28 10:56:10
 */
import type {
  CommandPlan,
  GeneratedCommand,
  RiskAssessment,
  RiskLevel,
} from "../types.js";

const blockedPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[^|&;]*r[^|&;]*f\b/, reason: "包含 rm -rf 强制递归删除。" },
  { pattern: /\bchmod\s+-R\b/, reason: "包含 chmod -R 批量权限修改。" },
  { pattern: /\bchown\s+-R\b/, reason: "包含 chown -R 批量属主修改。" },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    reason: "包含 git reset --hard，可能丢失未提交修改。",
  },
  {
    pattern: /\bgit\s+clean\s+-[^\s]*f[^\s]*d\b/,
    reason: "包含 git clean -fd，可能删除未跟踪文件。",
  },
  { pattern: />\s*\/dev\/(disk|rdisk)/, reason: "疑似直接写磁盘设备。" },
];

const highRiskPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/, reason: "包含 sudo 提权操作，需要人工确认。" },
  { pattern: /\brm\b/, reason: "包含删除命令 rm。" },
  { pattern: /\bmv\b.+\s+\/\b/, reason: "疑似移动文件到根目录相关路径。" },
  { pattern: />\s*[^|&;]+/, reason: "包含重定向写入，可能覆盖文件。" },
  { pattern: /\bfind\b.+\b-delete\b/, reason: "包含 find -delete 批量删除。" },
  { pattern: /\bxargs\b.+\brm\b/, reason: "包含 xargs rm 批量删除。" },
];

const mediumRiskPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+pull\b/, reason: "包含 git pull，会改变工作区。" },
  { pattern: /\bgit\s+merge\b/, reason: "包含 git merge，会改变分支状态。" },
  { pattern: /\bgit\s+checkout\b/, reason: "包含 git checkout，会切换或改写文件状态。" },
  { pattern: /\bsips\b/, reason: "包含图片处理命令，需要确认输出路径。" },
  { pattern: /\bfind\b/, reason: "包含批量文件查找，需要确认匹配范围。" },
];

/**
 * 根据命令文本匹配风险规则。
 */
function assessSingleCommand(command: GeneratedCommand): {
  level: RiskLevel;
  reasons: string[];
} {
  const reasons: string[] = [];

  for (const item of blockedPatterns) {
    if (item.pattern.test(command.command)) {
      reasons.push(item.reason);
    }
  }

  if (reasons.length > 0) {
    return { level: "blocked", reasons };
  }

  for (const item of highRiskPatterns) {
    if (item.pattern.test(command.command)) {
      reasons.push(item.reason);
    }
  }

  if (reasons.length > 0) {
    return { level: "high", reasons };
  }

  for (const item of mediumRiskPatterns) {
    if (item.pattern.test(command.command)) {
      reasons.push(item.reason);
    }
  }

  if (reasons.length > 0) {
    return { level: "medium", reasons };
  }

  return { level: "low", reasons: ["未命中高危规则。"] };
}

/**
 * 对命令计划做安全检查。
 *
 * blocked 风险直接拦截；high 风险允许进入人工确认；medium 和 low 风险
 * 通过检查后可直接执行。
 */
export function checkCommandRisk(plan: CommandPlan): RiskAssessment {
  const assessments = plan.commands.map(assessSingleCommand);
  const reasons = assessments.flatMap((item) => item.reasons);

  if (assessments.some((item) => item.level === "blocked")) {
    return {
      level: "blocked",
      blocked: true,
      reasons,
      safeToExecute: false,
    };
  }

  if (assessments.some((item) => item.level === "high")) {
    return {
      level: "high",
      blocked: false,
      reasons,
      safeToExecute: true,
    };
  }

  if (assessments.some((item) => item.level === "medium")) {
    return {
      level: "medium",
      blocked: false,
      reasons,
      safeToExecute: true,
    };
  }

  return {
    level: "low",
    blocked: false,
    reasons,
    safeToExecute: true,
  };
}
