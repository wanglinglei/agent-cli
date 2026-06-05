/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 17:05:00
 * @Description: 封装和风天气城市查询、天气查询和响应标准化逻辑。
 * @FilePath: /agents-cli/src/agents/weather/tools/qweatherClient.ts
 * @LastEditTime: 2026-06-05 17:05:00
 */
import { requireWeatherApiConfig } from "../../../config.js";
import type { AppConfig } from "../../../types.js";

export type QWeatherForecastDays = "3d" | "7d" | "10d" | "15d" | "30d";
export type QWeatherUnit = "m" | "i";

export interface CityLookupInput {
  adm?: string;
  lang?: string;
  location: string;
  number?: number;
  range?: string;
}

export interface QWeatherCityLocation {
  adm1: string;
  adm2: string;
  country: string;
  fxLink: string;
  id: string;
  isDst: string;
  lat: string;
  lon: string;
  name: string;
  rank: string;
  type: string;
  tz: string;
  utcOffset: string;
}

export interface QWeatherRefer {
  license?: string[];
  sources?: string[];
}

export interface CityLookupResult {
  code: string;
  locations: QWeatherCityLocation[];
  refer?: QWeatherRefer;
  source: string;
}

export interface WeatherMetric {
  celsius: string;
  fahrenheit?: string;
}

export interface WeatherQueryInput {
  city: string;
  date?: string;
  dateText?: string;
  days?: QWeatherForecastDays;
  lang?: string;
  language?: string;
  locationId?: string;
  unit?: QWeatherUnit;
}

export interface WeatherResult {
  city: string;
  resolvedCity: string;
  country?: string;
  fxLink?: string;
  region?: string;
  locationId?: string;
  localTime?: string;
  current: {
    description: string;
    feelsLike: WeatherMetric;
    humidity: string;
    observationTime?: string;
    precipitationMm?: string;
    pressure?: string;
    temperature: WeatherMetric;
    uvIndex?: string;
    visibility?: string;
    windDirection?: string;
    windSpeedKmph?: string;
  };
  forecast: Array<{
    avgTemperature: WeatherMetric;
    dateText?: string;
    date: string;
    dayDescription?: string;
    maxTemperature: WeatherMetric;
    minTemperature: WeatherMetric;
    nightDescription?: string;
    precipitationMm?: string;
    pressure?: string;
    uvIndex?: string;
    visibility?: string;
    windDirection?: string;
    windScale?: string;
    windSpeedKmph?: string;
  }>;
  queryDate: string;
  queryType: "daily" | "now";
  refer?: QWeatherRefer;
  source: string;
  updateTime?: string;
}

/**
 * 判断输入是否是普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从对象记录中读取字符串字段。
 */
function getStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/**
 * 从对象记录中读取字符串数组字段。
 */
function getStringArrayValue(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

/**
 * 将日期格式化为本地 YYYY-MM-DD 字符串。
 */
function getToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * 解析本地日期字符串。
 */
function parseLocalDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new Error("日期必须使用 YYYY-MM-DD 格式。");
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * 计算目标日期相对今天的天数偏移。
 */
function getDayOffset(targetDate: string): number {
  const today = parseLocalDate(getToday());
  const target = parseLocalDate(targetDate);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round((target.getTime() - today.getTime()) / millisecondsPerDay);
}

/**
 * 选择覆盖目标日期的和风天气预报窗口。
 */
function getForecastDays(targetDate: string): QWeatherForecastDays {
  const dayOffset = getDayOffset(targetDate);

  if (dayOffset < 1) {
    throw new Error("和风天气逐日预报只支持未来日期。");
  }

  if (dayOffset <= 3) {
    return "3d";
  }

  if (dayOffset <= 7) {
    return "7d";
  }

  if (dayOffset <= 10) {
    return "10d";
  }

  if (dayOffset <= 15) {
    return "15d";
  }

  if (dayOffset <= 30) {
    return "30d";
  }

  throw new Error("和风天气逐日预报最多支持未来 30 天。");
}

/**
 * 规范化和风天气语言代码。
 */
function normalizeLanguage(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalizedLanguage = language.trim().toLowerCase();
  return normalizedLanguage === "zh-cn" ? "zh" : normalizedLanguage;
}

/**
 * 判断 location 是否可以直接用于天气接口。
 */
function isDirectWeatherLocation(location: string): boolean {
  return (
    /^\d{6,}$/.test(location) || /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)
  );
}

/**
 * 规范化和风天气 API Host。
 */
function normalizeApiHost(host: string): string {
  return host.replace(/\/+$/, "");
}

/**
 * 判断 token 是否是 JWT 形态。
 */
function isJwtToken(token: string): boolean {
  return token.split(".").length === 3;
}

/**
 * 将和风天气鉴权信息应用到请求。
 */
function applyWeatherApiAuth(
  url: URL,
  apiToken: string,
): Record<string, string> {
  if (isJwtToken(apiToken)) {
    return {
      Authorization: `Bearer ${apiToken}`,
    };
  }

  url.searchParams.set("key", apiToken);
  return {};
}

/**
 * 读取并规范化和风天气配置。
 */
function getWeatherApiConfig(config: AppConfig): {
  apiHost: string;
  apiToken: string;
} {
  const weatherConfig = requireWeatherApiConfig(config);
  return {
    apiHost: normalizeApiHost(weatherConfig.apiHost),
    apiToken: weatherConfig.apiToken,
  };
}

/**
 * 标准化和风天气城市记录。
 */
function normalizeLocation(
  location: Record<string, unknown>,
): QWeatherCityLocation {
  return {
    adm1: getStringValue(location, "adm1"),
    adm2: getStringValue(location, "adm2"),
    country: getStringValue(location, "country"),
    fxLink: getStringValue(location, "fxLink"),
    id: getStringValue(location, "id"),
    isDst: getStringValue(location, "isDst"),
    lat: getStringValue(location, "lat"),
    lon: getStringValue(location, "lon"),
    name: getStringValue(location, "name"),
    rank: getStringValue(location, "rank"),
    type: getStringValue(location, "type"),
    tz: getStringValue(location, "tz"),
    utcOffset: getStringValue(location, "utcOffset"),
  };
}

/**
 * 标准化和风天气城市查询响应。
 */
function normalizeCityLookupData(data: unknown): CityLookupResult {
  if (!isRecord(data)) {
    throw new Error("和风天气城市查询返回了无效响应。");
  }

  const code = getStringValue(data, "code");
  if (code !== "200") {
    throw new Error(`和风天气城市查询失败：${code || "unknown"}`);
  }

  const refer = isRecord(data.refer)
    ? {
        license: getStringArrayValue(data.refer, "license"),
        sources: getStringArrayValue(data.refer, "sources"),
      }
    : undefined;

  return {
    code,
    locations: Array.isArray(data.location)
      ? data.location.filter(isRecord).map(normalizeLocation)
      : [],
    refer,
    source: "QWeather",
  };
}

/**
 * 查询和风天气城市 LocationID。
 *
 * 输入城市、区县、行政区域或经纬度，输出和风天气标准城市候选；远端接口失败时抛错。
 */
export async function lookupQWeatherCityId(
  config: AppConfig,
  input: CityLookupInput,
): Promise<CityLookupResult> {
  const location = input.location.trim();
  if (!location) {
    throw new Error("location 不能为空，无法查询城市。");
  }

  const { apiHost, apiToken } = getWeatherApiConfig(config);
  const url = new URL(`${apiHost}/geo/v2/city/lookup`);
  url.searchParams.set("location", location);

  if (input.adm) {
    url.searchParams.set("adm", input.adm);
  }

  if (input.range) {
    url.searchParams.set("range", input.range);
  }

  if (input.number) {
    url.searchParams.set("number", String(input.number));
  }

  if (input.lang) {
    url.searchParams.set("lang", input.lang);
  }

  const response = await fetch(url, {
    headers: applyWeatherApiAuth(url, apiToken),
  });

  if (!response.ok) {
    throw new Error(`和风天气城市查询请求失败：${response.status}`);
  }

  return normalizeCityLookupData(await response.json());
}

/**
 * 读取和风天气 refer 元数据。
 */
function getRefer(data: Record<string, unknown>): QWeatherRefer | undefined {
  if (!isRecord(data.refer)) {
    return undefined;
  }

  return {
    license: getStringArrayValue(data.refer, "license"),
    sources: getStringArrayValue(data.refer, "sources"),
  };
}

/**
 * 根据最高温和最低温计算平均温度。
 */
function getAverageTemperature(
  minTemperature: string,
  maxTemperature: string,
): string {
  const min = Number(minTemperature);
  const max = Number(maxTemperature);

  if (Number.isNaN(min) || Number.isNaN(max)) {
    return "";
  }

  return String(Math.round((min + max) / 2));
}

/**
 * 解析城市为和风天气天气接口可用的 location。
 */
async function resolveWeatherLocation(
  config: AppConfig,
  city: string,
  lang?: string,
  locationId?: string,
): Promise<{ location: string; cityLocation?: QWeatherCityLocation }> {
  if (locationId) {
    return { location: locationId };
  }

  if (isDirectWeatherLocation(city)) {
    return { location: city };
  }

  const lookupResult = await lookupQWeatherCityId(config, {
    lang,
    location: city,
    number: 1,
  });
  const cityLocation = lookupResult.locations[0];

  if (!cityLocation?.id) {
    throw new Error(`无法解析 ${city} 的和风天气 LocationID。`);
  }

  return { location: cityLocation.id, cityLocation };
}

/**
 * 标准化和风天气实时天气响应。
 */
function normalizeQWeatherNowData(
  data: unknown,
  query: WeatherQueryInput,
  cityLocation?: QWeatherCityLocation,
): WeatherResult {
  if (!isRecord(data)) {
    throw new Error("和风天气实时天气返回了无效响应。");
  }

  const code = getStringValue(data, "code");
  if (code !== "200") {
    throw new Error(`和风天气实时天气查询失败：${code || "unknown"}`);
  }

  const now = isRecord(data.now) ? data.now : {};

  return {
    city: query.city,
    resolvedCity: cityLocation?.name || query.city,
    country: cityLocation?.country,
    fxLink: getStringValue(data, "fxLink"),
    region: cityLocation?.adm1,
    locationId: cityLocation?.id ?? query.locationId,
    localTime: getStringValue(data, "updateTime"),
    current: {
      description: getStringValue(now, "text"),
      feelsLike: {
        celsius: getStringValue(now, "feelsLike"),
      },
      humidity: getStringValue(now, "humidity"),
      observationTime: getStringValue(now, "obsTime"),
      precipitationMm: getStringValue(now, "precip"),
      pressure: getStringValue(now, "pressure"),
      temperature: {
        celsius: getStringValue(now, "temp"),
      },
      visibility: getStringValue(now, "vis"),
      windDirection: getStringValue(now, "windDir"),
      windSpeedKmph: getStringValue(now, "windSpeed"),
    },
    forecast: [],
    queryDate: query.date || getToday(),
    queryType: "now",
    refer: getRefer(data),
    source: "QWeather",
    updateTime: getStringValue(data, "updateTime"),
  };
}

/**
 * 标准化和风天气逐日天气响应。
 */
function normalizeQWeatherDailyData(
  data: unknown,
  query: WeatherQueryInput,
  cityLocation?: QWeatherCityLocation,
): WeatherResult {
  if (!isRecord(data)) {
    throw new Error("和风天气逐日天气返回了无效响应。");
  }

  const code = getStringValue(data, "code");
  if (code !== "200") {
    throw new Error(`和风天气逐日天气查询失败：${code || "unknown"}`);
  }

  const dailyRecords = Array.isArray(data.daily)
    ? data.daily.filter(isRecord)
    : [];
  const targetDaily =
    dailyRecords.find((day) => getStringValue(day, "fxDate") === query.date) ??
    dailyRecords[0] ??
    {};
  const targetMinTemperature = getStringValue(targetDaily, "tempMin");
  const targetMaxTemperature = getStringValue(targetDaily, "tempMax");

  return {
    city: query.city,
    resolvedCity: cityLocation?.name || query.city,
    country: cityLocation?.country,
    fxLink: getStringValue(data, "fxLink"),
    region: cityLocation?.adm1,
    locationId: cityLocation?.id ?? query.locationId,
    localTime: getStringValue(data, "updateTime"),
    current: {
      description: getStringValue(targetDaily, "textDay"),
      feelsLike: {
        celsius: getAverageTemperature(
          targetMinTemperature,
          targetMaxTemperature,
        ),
      },
      humidity: getStringValue(targetDaily, "humidity"),
      precipitationMm: getStringValue(targetDaily, "precip"),
      pressure: getStringValue(targetDaily, "pressure"),
      temperature: {
        celsius: getAverageTemperature(
          targetMinTemperature,
          targetMaxTemperature,
        ),
      },
      uvIndex: getStringValue(targetDaily, "uvIndex"),
      visibility: getStringValue(targetDaily, "vis"),
      windDirection: getStringValue(targetDaily, "windDirDay"),
      windSpeedKmph: getStringValue(targetDaily, "windSpeedDay"),
    },
    forecast: dailyRecords.map((day) => {
      const minTemperature = getStringValue(day, "tempMin");
      const maxTemperature = getStringValue(day, "tempMax");

      return {
        avgTemperature: {
          celsius: getAverageTemperature(minTemperature, maxTemperature),
        },
        date: getStringValue(day, "fxDate"),
        dateText:
          getStringValue(day, "fxDate") === query.date
            ? query.dateText
            : undefined,
        dayDescription: getStringValue(day, "textDay"),
        maxTemperature: {
          celsius: maxTemperature,
        },
        minTemperature: {
          celsius: minTemperature,
        },
        nightDescription: getStringValue(day, "textNight"),
        precipitationMm: getStringValue(day, "precip"),
        pressure: getStringValue(day, "pressure"),
        uvIndex: getStringValue(day, "uvIndex"),
        visibility: getStringValue(day, "vis"),
        windDirection: getStringValue(day, "windDirDay"),
        windScale: getStringValue(day, "windScaleDay"),
        windSpeedKmph: getStringValue(day, "windSpeedDay"),
      };
    }),
    queryDate: query.date || getToday(),
    queryType: "daily",
    refer: getRefer(data),
    source: "QWeather",
    updateTime: getStringValue(data, "updateTime"),
  };
}

/**
 * 查询和风天气实时或逐日天气。
 *
 * 输入城市、LocationID 和目标日期，输出标准化天气数据；今天调用实时天气接口，
 * 未来日期调用逐日预报接口，超出和风天气支持范围时抛错。
 */
export async function queryQWeather(
  config: AppConfig,
  input: WeatherQueryInput,
): Promise<WeatherResult> {
  const city = input.city.trim() || input.locationId?.trim() || "";
  if (!city) {
    throw new Error("city 或 locationId 不能为空，无法查询天气。");
  }

  const targetDate = input.date?.trim() || getToday();
  parseLocalDate(targetDate);

  const lang = normalizeLanguage(input.lang ?? input.language) ?? "zh";
  const unit = input.unit === "i" ? "i" : "m";
  const query: WeatherQueryInput = {
    ...input,
    city,
    date: targetDate,
    lang,
    unit,
  };
  const { location, cityLocation } = await resolveWeatherLocation(
    config,
    city,
    lang,
    input.locationId?.trim(),
  );
  const isToday = targetDate === getToday();
  const path = isToday
    ? "/v7/weather/now"
    : `/v7/weather/${input.days ?? getForecastDays(targetDate)}`;
  const { apiHost, apiToken } = getWeatherApiConfig(config);
  const url = new URL(`${apiHost}${path}`);
  url.searchParams.set("location", location);
  url.searchParams.set("lang", lang);
  url.searchParams.set("unit", unit);

  const response = await fetch(url, {
    headers: applyWeatherApiAuth(url, apiToken),
  });

  if (!response.ok) {
    throw new Error(`和风天气查询请求失败：${response.status}`);
  }

  const data = await response.json();
  return isToday
    ? normalizeQWeatherNowData(data, query, cityLocation)
    : normalizeQWeatherDailyData(data, query, cityLocation);
}
