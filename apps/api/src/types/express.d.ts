/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal express type shim.
 * Provides `Request` and `Response` types so the project compiles
 * before `@types/express` is installed via `pnpm install`.
 * Once @types/express is resolved, those declarations take precedence.
 */
declare module 'express' {
  export interface Request {
    ip?: string;
    ips?: string[];
    method: string;
    url: string;
    path: string;
    headers: Record<string, string | undefined> & { [key: string]: string | undefined };
    cookies: Record<string, string>;
    body: any;
    params: Record<string, string>;
    query: Record<string, unknown>;
    user?: unknown;
    connection: { remoteAddress?: string };
    socket: { remoteAddress?: string };
  }

  export interface Response {
    statusCode: number;
    cookie(name: string, val: string, options?: any): this;
    clearCookie(name: string, options?: any): this;
    json(body?: any): this;
    status(code: number): this;
    send(body?: any): this;
    setHeader(name: string, value: string | string[]): this;
  }

  export interface NextFunction {
    (err?: unknown): void;
  }
}
