/*
 * @Author: wanglinglei
 * @Date: 2026-06-11 00:00:00
 * @Description: 提供行政边界数据源专用 HTTP 下载能力。
 * @FilePath: /agents-cli/src/agents/boundary/tools/boundaryHttpClient.ts
 * @LastEditTime: 2026-06-11 00:00:00
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const MAX_REDIRECT_COUNT = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const RUIDUOBAO_HOSTNAME = "map.ruiduobao.com";

/**
 * 边界数据源请求配置。
 */
export interface BoundaryHttpRequestOptions {
  headers?: Record<string, string>;
}

/**
 * 判断请求是否命中瑞多宝边界数据源。
 *
 * 输入 URL 对象，输出是否允许使用瑞多宝的证书兼容策略；失败策略是返回 false，
 * 避免影响其他 HTTPS 请求。
 */
function isRuiduobaoUrl(url: URL): boolean {
  return url.hostname === RUIDUOBAO_HOSTNAME;
}

/**
 * 发起边界数据源 GET 请求并返回二进制内容。
 *
 * 输入 URL 和请求头，输出响应 Buffer；支持有限重定向。瑞多宝站点当前 HTTPS
 * 证书过期，因此只对该 host 放宽证书校验，不修改全局 TLS 策略。
 */
export async function fetchBoundaryBuffer(
  urlString: string,
  options: BoundaryHttpRequestOptions = {},
  redirectCount = 0,
): Promise<Buffer> {
  const url = new URL(urlString);
  const client = url.protocol === "https:" ? https : http;
  const requestOptions: http.RequestOptions | https.RequestOptions = {
    headers: options.headers,
    method: "GET",
    timeout: REQUEST_TIMEOUT_MS,
  };

  if (url.protocol === "https:" && isRuiduobaoUrl(url)) {
    (requestOptions as https.RequestOptions).rejectUnauthorized = false;
  }

  return new Promise((resolve, reject) => {
    const request = client.request(url, requestOptions, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (
        location &&
        [301, 302, 303, 307, 308].includes(statusCode)
      ) {
        response.resume();
        if (redirectCount >= MAX_REDIRECT_COUNT) {
          reject(new Error("边界数据源重定向次数过多。"));
          return;
        }

        fetchBoundaryBuffer(new URL(location, url).toString(), options, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`边界数据源请求失败：${statusCode}`));
          return;
        }

        resolve(body);
      });
      response.on("error", reject);
    });

    request.on("timeout", () => {
      request.destroy(new Error(`边界数据源请求超时：${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on("error", (error) => {
      reject(new Error(`边界数据源请求失败：${error.message}`));
    });
    request.end();
  });
}

/**
 * 发起边界数据源 GET 请求并解析 JSON。
 *
 * 输入 URL 和请求头，输出 JSON 对象；JSON 解析失败时抛出明确错误，交由上层工具
 * 决定是否中断或降级。
 */
export async function fetchBoundaryJson<T>(
  urlString: string,
  options?: BoundaryHttpRequestOptions,
): Promise<T> {
  const body = await fetchBoundaryBuffer(urlString, options);

  try {
    return JSON.parse(body.toString("utf-8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`边界数据源 JSON 解析失败：${message}`);
  }
}
