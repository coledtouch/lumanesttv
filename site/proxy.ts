import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';
import {canonicalRedirectTarget} from './lib/canonical-host';

export function proxy(request: NextRequest) {
  const target = canonicalRedirectTarget(request);
  if (!target) return NextResponse.next();
  const response = NextResponse.redirect(target, 308);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
