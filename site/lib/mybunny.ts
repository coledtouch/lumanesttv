import {env} from 'cloudflare:workers';

export function settings() { return env as unknown as Record<string, string>; }
export class ServiceError extends Error {
  status: number;
  code: string;
  retryAfter?: string;
  constructor(status: number, code: string, message: string, retryAfter?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function bunny(path: string, method = 'GET', body?: unknown, key?: string) {
  const token = settings().MYBUNNY_API_KEY;
  if (!token) throw new ServiceError(503, 'not_configured', 'The reseller connection has not been configured.');
  const headers: Record<string, string> = {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
  if (key) headers['Idempotency-Key'] = key;
  let response: Response;
  try {
    response = await fetch('https://connect.turbobunny.net/api/v1' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(25000)
    });
  } catch {
    throw new ServiceError(504, 'outcome_unknown', 'The provider did not respond. Check the line and transactions before retrying any paid operation.');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ServiceError(502, 'provider_redirect_rejected', 'The provider returned an unexpected redirect. Check the line and transactions before retrying any paid operation.');
  }
  let result: {data?: unknown; error?: {code?: string; message?: string}};
  try { result = await response.json(); } catch {
    throw new ServiceError(502, 'outcome_unknown', 'The provider returned an unreadable response. Check the line and transactions before retrying any paid operation.');
  }
  if (!response.ok) {
    const code = typeof result?.error?.code === 'string' ? result.error.code.slice(0, 64) : 'provider_error';
    // Authentication, quota and server faults are ours to fix: log the provider code, never show it to customers.
    if ([401, 403, 429].includes(response.status) || response.status >= 500) {
      console.error('lumanest_provider_request_failed', JSON.stringify({http_status: response.status, code: /^[A-Za-z0-9_.-]+$/.test(code) ? code : 'provider_error'}));
      throw new ServiceError(response.status === 429 ? 503 : 502, 'provider_unavailable', 'The TV service is temporarily unavailable. Please try again shortly.', response.headers.get('Retry-After') || undefined);
    }
    throw new ServiceError(response.status, code, result?.error?.message || 'The provider could not complete this operation.', response.headers.get('Retry-After') || undefined);
  }
  if (!result || !Object.hasOwn(result, 'data') || result.data === undefined || result.data === null) {
    throw new ServiceError(502, 'outcome_unknown', 'The provider returned an incomplete response. Check the line and transactions before retrying any paid operation.');
  }
  return result.data;
}
