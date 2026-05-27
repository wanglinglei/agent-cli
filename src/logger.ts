/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 封装 CLI 运行过程中的 chalk 彩色日志输出。
 * @FilePath: /agents-cli/src/logger.ts
 * @LastEditTime: 2026-05-27 22:20:00
 */
import chalk from "chalk";

/**
 * 统一的 CLI 日志工具。
 *
 * 所有 Agent 节点都通过该类输出状态，保证普通模式和 verbose 模式的展示一致。
 */
export class Logger {
  constructor(private readonly verboseEnabled: boolean) {}

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
    if (!this.verboseEnabled) {
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
    console.log(chalk.blue(`\n[节点开始] ${nodeName}`));
    console.log(chalk.gray(`  输入: ${summary}`));
  }

  /**
   * 打印节点成功执行日志。
   */
  nodeSuccess(nodeName: string, summary: string): void {
    console.log(chalk.green(`[节点完成] ${nodeName}`));
    console.log(chalk.gray(`  输出: ${summary}`));
  }

  /**
   * 打印节点失败日志。
   */
  nodeError(nodeName: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
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
   * 返回需要用户输入时使用的高亮提示文案。
   */
  userPrompt(message: string): string {
    return `${chalk.black.bgYellow(" 需要输入 ")} ${chalk.yellowBright.bold(message)} `;
  }
}

/**
 * 根据运行参数创建日志器。
 */
export function createLogger(verbose: boolean): Logger {
  return new Logger(verbose);
}
