export const DEFAULT_ALLOWED_HOSTS: string;
export type AllowedHosts = {exact: Set<number>; networks: Set<number>};
export function allowedHosts(value: string | undefined): AllowedHosts | null;
export function hostAllowed(hostname: string, hosts: AllowedHosts | null): boolean;
export function createStreamRelay(connect: unknown, options?: {idleTimeout?: number; idleCheck?: number}): {fetch(request: Request, env?: Record<string, unknown>): Promise<Response>};
