#!/usr/bin/env node
/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 提供自然语言单入口 CLI 并启动多 Agent 执行流程。
 * @FilePath: /agents-cli/src/cli.ts
 * @LastEditTime: 2026-05-27 22:20:00
 */

import chalk from "chalk";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { ZodError } from "zod";

import { formatArtifactPath } from "./artifacts.js";
import { loadConfig } from "./config.js";
import { buildAgentGraph, createInitialState } from "./graph/index.js";
import { createLogger } from "./logger.js";
import { createChatModel } from "./llm.js";
import { InMemoryMemoryStore } from "./memory/InMemoryMemoryStore.js";
import type { Logger } from "./logger.js";
import type { AgentRuntime, CliOptions } from "./types.js";

/**
 * 将 commander 的 variadic 参数拼成用户输入。
 */
function normalizeTaskInput(parts: string[]): string {
  return parts.join(" ").trim();
}

/**
 * 在没有命令行参数时，交互式读取用户任务。
 *
 * 输入为空时会直接抛错终止，避免把空任务送入路由流程。
 */
async function promptForTaskInput(logger: Logger): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(logger.userPrompt("请输入自然语言任务："));
    const normalized = answer.trim();
    if (!normalized) {
      throw new Error("请输入自然语言任务。");
    }

    return normalized;
  } finally {
    rl.close();
  }
}

/**
 * 将环境变量校验错误转换为面向 CLI 用户的提示。
 */
function formatConfigError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("\n");
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * CLI 单入口。
 *
 * 用户只输入自然语言任务，不需要指定 Agent。任务进入 LangGraph 后会先经过
 * routerAgent 自动判断，再调用合适的多 Agent 流程。
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name("agents")
    .description("Node + LangGraph + LangChain 多 Agent 自动化任务执行器")
    .argument("[task...]", "自然语言任务")
    .option("-v, --verbose", "打印详细中间状态", false)
    .option("-y, --yes", "跳过本地命令执行确认", false)
    .action(
      async (
        taskParts: string[] | undefined,
        options: { verbose: boolean; yes: boolean },
      ) => {
        const logger = createLogger(options.verbose);
        const normalizedArgs = taskParts ?? [];
        const taskInput = normalizeTaskInput(normalizedArgs);
        const finalInput = taskInput || (await promptForTaskInput(logger));

        const cliOptions: CliOptions = {
          verbose: options.verbose,
          autoApprove: options.yes,
          cwd: process.cwd(),
          outputDir: path.join(process.cwd(), "output"),
        };

        const memoryStore = new InMemoryMemoryStore();

        let config;
        try {
          config = loadConfig();
        } catch (error) {
          logger.error(formatConfigError(error));
          process.exitCode = 1;
          return;
        }

        const llm = createChatModel(config);
        const runtime: AgentRuntime = {
          config,
          verbose: cliOptions.verbose,
          llm,
          logger,
          outputDir: cliOptions.outputDir,
        };

        const initialState = createInitialState(finalInput, cliOptions);
        await memoryStore.saveRun(initialState.runId, initialState);

        logger.info(`运行 ID：${initialState.runId}`);
        logger.info(`工作目录：${initialState.cwd}`);

        const graph = buildAgentGraph(runtime);
        const finalState = await graph.invoke(initialState);
        await memoryStore.saveRun(initialState.runId, finalState);

        console.log(chalk.bold("\n任务完成\n"));
        console.log(finalState.finalAnswer ?? "任务结束，但没有生成最终说明。");

        if (finalState.artifacts.length > 0) {
          console.log(chalk.bold("\n产物文件\n"));
          for (const artifact of finalState.artifacts) {
            console.log(
              `- ${artifact.agentName}/${artifact.label}: ${formatArtifactPath(
                finalState.cwd,
                artifact.filePath,
              )}`,
            );
          }
        }

        if (finalState.errors.length > 0) {
          logger.warn(`本次运行记录了 ${finalState.errors.length} 个错误。`);
          logger.debug("错误列表", finalState.errors);
        }
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(
    chalk.red(
      `[致命错误] ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
  process.exitCode = 1;
});
