/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 16:17:30
 * @Description: 提供跨流程复用的当前时间 LangChain 工具。
 * @FilePath: /agents-cli/src/tools/currentTime.ts
 * @LastEditTime: 2026-06-04 16:17:30
 */
import { tool } from "langchain";
import { z } from "zod";

import { toPrettyJson } from "../text.js";
import type { CurrentTimeInput, CurrentTimeResult } from "../types.js";

const DEFAULT_LOCALE = "zh-CN";

/**
 * 获取运行环境默认时区。
 *
 * 输入为空，输出 Node.js 运行环境解析出的 IANA 时区名；如果运行时无法提供时区，
 * 失败策略是返回 UTC，保证工具仍能给出准确 UTC 时间。
 */
function getDefaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * 把分钟级 UTC 偏移格式化为 +08:00 形式。
 *
 * 输入正负分钟数，输出标准 UTC 偏移字符串；该函数不抛错，异常数值由调用方控制。
 */
function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60).toString().padStart(2, "0");
  const minutes = (absoluteMinutes % 60).toString().padStart(2, "0");

  return `${sign}${hours}:${minutes}`;
}

/**
 * 计算指定时区相对 UTC 的分钟偏移。
 *
 * 输入当前时间和 IANA 时区名，输出该时刻目标时区的 UTC 偏移分钟；如果时区非法，
 * Intl 会抛出 RangeError，由上层工具把错误返回给 Agent。
 */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  const targetUtcMs = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return Math.round((targetUtcMs - date.getTime()) / 60_000);
}

/**
 * 格式化指定时区下的当前时间。
 *
 * 输入当前时间和 IANA 时区名，输出中文本地化时间；如果时区非法，Intl 会抛出
 * RangeError，由上层工具把错误返回给 Agent。
 */
function formatLocalizedTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

/**
 * 读取当前准确时间。
 *
 * 输入可选 IANA 时区，输出 UTC ISO、Unix 时间戳和目标时区展示信息；失败策略是对
 * 非法时区抛出明确错误，避免 Agent 使用错误时间继续推理。
 */
export function getCurrentTime(input: CurrentTimeInput = {}): CurrentTimeResult {
  const now = new Date();
  const timeZone = input.timeZone?.trim() || getDefaultTimeZone();
  const utcOffset = formatUtcOffset(getTimeZoneOffsetMinutes(now, timeZone));

  return {
    isoUtc: now.toISOString(),
    epochMs: now.getTime(),
    unixSeconds: Math.floor(now.getTime() / 1000),
    timeZone,
    utcOffset,
    localizedTime: formatLocalizedTime(now, timeZone),
  };
}

/**
 * 创建公共当前时间 LangChain 工具。
 *
 * 输入为空或指定 IANA 时区，输出序列化后的当前时间结构；工具不修改状态、不访问
 * 网络，适合所有 ReAct flow 在需要准确当前日期或时间时调用。
 */
export function createCurrentTimeTool() {
  return tool(
    async ({ timeZone }) => {
      try {
        return toPrettyJson(getCurrentTime({ timeZone }));
      } catch (error) {
        return toPrettyJson({
          success: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: "get_current_time",
      description:
        "Get the accurate current date and time from the local runtime. Call this whenever the answer depends on today, now, recent, latest, or an exact timestamp.",
      schema: z.object({
        timeZone: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional IANA time zone, such as Asia/Shanghai or America/New_York. Omit to use the host system time zone.",
          ),
      }),
    },
  );
}
