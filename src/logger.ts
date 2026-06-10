/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 封装 CLI 运行过程中的 chalk 彩色日志输出。
 * @FilePath: /agents-cli/src/logger.ts
 * @LastEditTime: 2026-06-10 00:00:00
 */
import chalk from "chalk";

type ChainLogKind = "mcp" | "subAgent" | "tool";

const CHAIN_KIND_LABEL: Record<ChainLogKind, string> = {
  mcp: "MCP",
  subAgent: "子Agent",
  tool: "Tool",
};

/**
 * 统一的 CLI 日志工具。
 *
 * 所有 Agent 节点都通过该类输出状态，保证普通模式和 verbose 模式的展示一致。
 */
export class Logger {
  constructor(
    private readonly verboseEnabled: boolean,
    private readonly showFullDebugInfo: boolean,
  ) {}

  /**
   * 打印普通信息。
   */
  info(message: string): void {
    console.log(chalk.cyan(`[信息] ${message}`));
  }

  /**
   * 打印提醒信息。
   */
  warn(message: string): void {
    console.log(chalk.yellow(`[提醒] ${message}`));
  }

  /**
   * 打印错误信息。
   */
  error(message: string): void {
    console.error(chalk.red(`[错误] ${message}`));
  }

  /**
   * 仅在 verbose 模式下打印调试信息。
   */
  debug(message: string, payload?: unknown): void {
    if (!this.verboseEnabled || !this.showFullDebugInfo) {
      return;
    }

    console.log(chalk.gray(`[调试] ${message}`));
    if (payload !== undefined) {
      console.dir(payload, { depth: 8, colors: true });
    }
  }

  /**
   * 打印节点开始执行日志。
   */
  nodeStart(nodeName: string, summary: string): void {
    if (!this.showFullDebugInfo) {
      return;
    }

    console.log(chalk.blue(`\n[节点开始] ${nodeName}`));
    console.log(chalk.gray(`  输入: ${summary}`));
  }

  /**
   * 打印节点成功执行日志。
   */
  nodeSuccess(nodeName: string, summary: string): void {
    if (!this.showFullDebugInfo) {
      return;
    }

    console.log(chalk.green(`[节点完成] ${nodeName}`));
    console.log(chalk.gray(`  输出: ${summary}`));
  }

  /**
   * 打印节点失败日志。
   */
  nodeError(nodeName: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (!this.showFullDebugInfo) {
      console.error(chalk.red(`[节点失败] ${nodeName}`));
      return;
    }

    console.error(chalk.red(`[节点失败] ${nodeName}`));
    console.error(chalk.gray(`  原因: ${message}`));
  }

  /**
   * 打印即将执行的命令。
   */
  command(command: string): void {
    console.log(chalk.magenta(`  $ ${command}`));
  }

  /**
   * 打印执行链路开始日志。
   */
  chainStart(kind: ChainLogKind, name: string, detail?: string): void {
    if (!this.showFullDebugInfo) {
      if (kind === "subAgent") {
        console.log(chalk.blue(`\n[节点开始] ${name}`));
      }
      return;
    }

    console.log(chalk.blueBright(`[链路开始] ${CHAIN_KIND_LABEL[kind]} ${name}`));
    if (detail) {
      console.log(chalk.gray(`  ${detail}`));
    }
  }

  /**
   * 打印执行链路成功结束日志。
   */
  chainSuccess(
    kind: ChainLogKind,
    name: string,
    durationMs: number,
    detail?: string,
  ): void {
    if (!this.showFullDebugInfo) {
      if (kind === "subAgent") {
        console.log(chalk.green(`[节点完成] ${name} (${durationMs}ms)`));
      }
      return;
    }

    console.log(
      chalk.greenBright(
        `[链路结束] ${CHAIN_KIND_LABEL[kind]} ${name} (${durationMs}ms)`,
      ),
    );
    if (detail) {
      console.log(chalk.gray(`  ${detail}`));
    }
  }

  /**
   * 打印执行链路失败日志。
   */
  chainError(
    kind: ChainLogKind,
    name: string,
    error: unknown,
    durationMs: number,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    if (!this.showFullDebugInfo) {
      if (kind === "subAgent") {
        console.error(chalk.red(`[节点失败] ${name} (${durationMs}ms)`));
        console.error(chalk.gray(`  原因: ${message}`));
      }
      return;
    }

    console.error(
      chalk.redBright(
        `[链路失败] ${CHAIN_KIND_LABEL[kind]} ${name} (${durationMs}ms)`,
      ),
    );
    console.error(chalk.gray(`  原因: ${message}`));
  }

  /**
   * 返回需要用户输入时使用的高亮提示文案。
   */
  userPrompt(message: string): string {
    return `${chalk.black.bgYellow(" 需要输入 ")} ${chalk.yellowBright.bold(message)} `;
  }
}

/**
 * 根据运行参数创建日志器。
 */
export function createLogger(
  verbose: boolean,
  showFullDebugInfo = true,
): Logger {
  return new Logger(verbose, showFullDebugInfo);
}
