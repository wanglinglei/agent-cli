/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 封装本地 shell 命令执行、超时和输出捕获逻辑。
 * @FilePath: /agents-cli/src/tools/shellExecutor.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import { spawn } from "node:child_process";

import type {
  ExecutionResult,
  GeneratedCommand,
  SingleCommandResult,
} from "../types.js";

const MAX_CAPTURED_OUTPUT = 80_000;

/**
 * 追加命令输出，并限制最大捕获长度。
 *
 * 防止长时间命令或大量日志把内存撑爆，同时保留足够内容供结果解释 Agent 分析。
 */
function appendLimitedOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  if (next.length <= MAX_CAPTURED_OUTPUT) {
    return next;
  }

  return next.slice(0, MAX_CAPTURED_OUTPUT) + "\n[输出过长，已截断]";
}

/**
 * 执行单条已通过确认的 shell 命令。
 *
 * 命令固定在 CLI 启动目录执行，使用当前用户 shell，不额外提升权限。
 */
export function executeShellCommand(
  command: string,
  options: { cwd: string; timeoutMs: number },
): Promise<SingleCommandResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: options.cwd,
      shell: process.env.SHELL || "/bin/zsh",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimitedOutput(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimitedOutput(stderr, chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        stdout,
        stderr: stderr + error.message,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        command,
        stdout,
        stderr,
        exitCode: timedOut ? 124 : code,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

/**
 * 顺序执行命令计划中的所有命令。
 *
 * 如果某条命令失败，后续命令不会继续执行，避免在未知状态下扩大影响。
 */
export async function executeCommandPlan(
  commands: GeneratedCommand[],
  cwd: string,
): Promise<ExecutionResult> {
  const results: SingleCommandResult[] = [];

  for (const command of commands) {
    const result = await executeShellCommand(command.command, {
      cwd,
      timeoutMs: 60_000,
    });
    results.push(result);

    if (result.exitCode !== 0) {
      break;
    }
  }

  return {
    success: results.every((item) => item.exitCode === 0),
    results,
  };
}
