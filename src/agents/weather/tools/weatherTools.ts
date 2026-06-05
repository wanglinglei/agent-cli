/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 17:05:00
 * @Description: 提供天气查询流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/agents/weather/tools/weatherTools.ts
 * @LastEditTime: 2026-06-05 17:05:00
 */
import { tool } from "langchain";
import { z } from "zod";

import { toPrettyJson } from "../../../text.js";
import { createCurrentTimeTool } from "../../../tools/currentTime.js";
import {
  lookupQWeatherCityId,
  queryQWeather,
} from "./qweatherClient.js";
import type { AgentRuntime } from "../../../types.js";

/**
 * 天气工具创建上下文。
 */
export interface WeatherToolContext {
  runtime: AgentRuntime;
}

const forecastDaysSchema = z.enum(["3d", "7d", "10d", "15d", "30d"]);

/**
 * 创建和风天气城市查询和天气查询工具。
 *
 * 输入当前运行时，输出 LangChain 工具集合；工具只返回标准化 JSON 文本，不直接
 * 修改图状态，失败时由 ReAct Agent 节点统一捕获。
 */
export function createWeatherTools(context: WeatherToolContext) {
  const cityLookupTool = tool(
    async ({ location, adm, range, number, lang }) => {
      const result = await lookupQWeatherCityId(context.runtime.config, {
        location,
        adm,
        range,
        number,
        lang,
      });

      return toPrettyJson({
        ...result,
        locations: result.locations.slice(0, number ?? 5),
      });
    },
    {
      name: "qweather_city_lookup",
      description:
        "Query QWeather GeoAPI city Location IDs. Use it before weather query when the user provides a city or district name.",
      schema: z.object({
        location: z
          .string()
          .min(1)
          .describe("City, district, LocationID, Adcode, or longitude,latitude."),
        adm: z.string().optional().describe("Optional superior region."),
        range: z.string().optional().describe("Optional lookup range, such as cn."),
        number: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Maximum candidate city count."),
        lang: z.string().optional().describe("QWeather language code."),
      }),
    },
  );

  const weatherQueryTool = tool(
    async ({ city, date, dateText, days, language, lang, locationId, unit }) => {
      const result = await queryQWeather(context.runtime.config, {
        city,
        date,
        dateText,
        days,
        language,
        lang,
        locationId,
        unit,
      });

      return toPrettyJson(result);
    },
    {
      name: "qweather_query",
      description:
        "Query QWeather realtime weather for today or daily forecast for a future date. Prefer passing a resolved locationId.",
      schema: z.object({
        city: z.string().min(1).describe("City name or direct location value."),
        locationId: z
          .string()
          .optional()
          .describe("Resolved QWeather LocationID from qweather_city_lookup."),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Target date in YYYY-MM-DD. Omit for today."),
        dateText: z
          .string()
          .optional()
          .describe("Original date phrase such as 今天, 明天, 后天."),
        days: forecastDaysSchema
          .optional()
          .describe("Optional QWeather forecast window."),
        lang: z.string().optional().describe("QWeather language code."),
        language: z.string().optional().describe("Alias of lang."),
        unit: z
          .enum(["m", "i"])
          .default("m")
          .describe("m for metric, i for imperial."),
      }),
    },
  );

  return [createCurrentTimeTool(), cityLookupTool, weatherQueryTool];
}
