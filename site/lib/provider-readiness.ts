import {retailPrice} from './plans.ts';

type Site = {status?: string; address?: string; email_ready?: boolean};

function httpsPortalOrigin(value: string) {
  const address = new URL(value);
  if (address.protocol !== 'https:' || address.username || address.password || address.port || address.hostname.includes('*')) return undefined;
  return address.origin;
}

export function portalReady(site: Site | undefined, configuredAddress?: string, providerPrimaryAddress?: string) {
  if (!site?.address || !['approved', 'active'].includes(site.status || '')) return false;
  try {
    const providerOrigin = httpsPortalOrigin(site.address);
    const publicOrigin = configuredAddress === undefined ? undefined : httpsPortalOrigin(configuredAddress);
    const primaryOrigin = providerPrimaryAddress === undefined ? undefined : httpsPortalOrigin(providerPrimaryAddress);
    if (!providerOrigin || (configuredAddress !== undefined && !publicOrigin) || (providerPrimaryAddress !== undefined && !primaryOrigin)) return false;
    // An alias is accepted only when the server explicitly identifies the approved provider origin.
    return providerOrigin === (primaryOrigin ?? publicOrigin ?? providerOrigin);
  } catch { return false; }
}

function providerAmount(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return NaN;
  return Number(value);
}

export function walletCanActivate(balance: unknown, quote: unknown) {
  const funds = providerAmount(balance), cost = providerAmount(quote);
  return Number.isFinite(funds) && Number.isFinite(cost) && cost > 0 && funds >= cost;
}

export function newLineQuote(prices: {new_line?: {devices: number; months: number; price: unknown}[]}, devices: number, months: number) {
  retailPrice(devices, months);
  return prices?.new_line?.find(p => p.devices === devices && p.months === months)?.price;
}

export function renewalOffer(line: {devices: unknown; prices?: {renew?: {months: number; price: number | string}[]}}, months: number) {
  const devices = Number(line.devices), amount = retailPrice(devices, months);
  const cost = providerAmount(line.prices?.renew?.find(p => p.months === months)?.price);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('A renewal quote is not available for this line.');
  return {devices, amount, cost};
}

export function activatedLineId(data: any, renewalLineId?: number | null) {
  const id = data?.line?.id ?? data?.id;
  if (!Number.isSafeInteger(id) || id <= 0 || (renewalLineId && id !== renewalLineId)) {
    throw new Error('The provider has not confirmed the activated line.');
  }
  return id as number;
}
