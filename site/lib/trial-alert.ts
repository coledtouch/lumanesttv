// The owner's email alert for a new free-trial request (docs/trials.md, Email alerts). This module only builds the
// message, a plain-text RFC 5322 email, so it stays pure and is unit-tested in tests/trial-alert.test.ts;
// lib/trial-alert-send.ts sends it through the Worker's send_email binding. The alert carries the requester's name,
// device and request time, the pending count and any repeat-request counts (same network, same email address), never
// their email address, network or status link.
import {SITE_URL} from '../app/site.ts';
import {TRIAL_DEVICES} from './trial-devices.ts';

export const DEFAULT_ALERT_FROM = 'alerts@lumanest.tv';
export const ALERT_SUBJECT = 'New free-trial request – LumaNest TV';
const SENDER_NAME = 'LumaNest TV';
const REVIEW_URL = SITE_URL + '/manage';
/** A plain address (a dot-atom local part and a domain): no display name, quotes, spaces or line breaks. */
const plainAddress = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type AlertAddresses = {from: string; to: string};
/** What the alert says about one stored request. The counts are left out when they couldn't be read. */
export type TrialAlert = {name: string; device: string; requested: number; pending?: number | null; sameNetwork?: number | null; sameEmail?: number | null};

/** The trimmed address when it is a plain email address, otherwise ''. */
export function alertAddress(value: unknown) {
  const address = typeof value === 'string' ? value.trim() : '';
  return address.length <= 254 && plainAddress.test(address) ? address : '';
}

/** Where alerts go: TRIAL_ALERT_TO is required, TRIAL_ALERT_FROM defaults to alerts@lumanest.tv. Null sends nothing. */
export function alertAddresses(settings: Record<string, unknown>): AlertAddresses | null {
  const to = alertAddress(settings.TRIAL_ALERT_TO);
  const from = alertAddress(typeof settings.TRIAL_ALERT_FROM === 'string' && settings.TRIAL_ALERT_FROM.trim() ? settings.TRIAL_ALERT_FROM : DEFAULT_ALERT_FROM);
  return to && from ? {from, to} : null;
}

/**
 * Whether alerts go out, for the log and the /manage Trial requests panel: 'off' while TRIAL_ALERT_TO isn't a plain
 * address (alerts not set up); otherwise 'binding_missing' when the deploy has no TRIAL_ALERT_EMAIL binding (prepared
 * without --trial-alerts), 'sender_invalid' when TRIAL_ALERT_FROM isn't a plain address, or 'on'.
 */
export type AlertStatus = 'on' | 'off' | 'binding_missing' | 'sender_invalid';
export function alertStatus(settings: Record<string, unknown>, hasBinding: boolean): AlertStatus {
  if (!alertAddress(settings.TRIAL_ALERT_TO)) return 'off';
  if (!hasBinding) return 'binding_missing';
  return alertAddresses(settings) ? 'on' : 'sender_invalid';
}

/** One header value: line breaks become spaces and other control characters go, so no value can start a new header. */
export function headerText(value: string) {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
}

function utf8(value: string) {return new TextEncoder().encode(value);}
function base64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** An unstructured header value (RFC 2047): ASCII as it is, anything else as UTF-8 encoded words of at most 45 bytes each. */
export function encodeHeader(value: string) {
  const text = headerText(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let word = '';
  for (const character of text) {
    if (word && utf8(word + character).length > 45) {words.push(word); word = '';}
    word += character;
  }
  if (word) words.push(word);
  return words.map(part => '=?UTF-8?B?' + base64(utf8(part)) + '?=').join('\r\n ');
}

/** Quoted-printable (RFC 2045) with CRLF line ends and encoded lines of at most 76 characters. */
export function quotedPrintable(text: string) {
  return text.split(/\r?\n/).map(line => {
    const bytes = utf8(line);
    let encoded = '', length = 0;
    bytes.forEach((byte, index) => {
      const literal = (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && index < bytes.length - 1);
      const piece = literal ? String.fromCharCode(byte) : '=' + byte.toString(16).toUpperCase().padStart(2, '0');
      if (length + piece.length > 75) {encoded += '=\r\n'; length = 0;}
      encoded += piece;
      length += piece.length;
    });
    return encoded;
  }).join('\r\n');
}

/** The requester's name on one line: no control, line-separator or bidirectional-override characters, at most 100 characters. */
export function alertName(name: string) {
  const line = name.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(line).slice(0, 100).join('') || '(no name)';
}

function deviceLabel(device: string) {
  return TRIAL_DEVICES.find(([key]) => key === device)?.[1] || 'Not given';
}
function two(value: number) {return String(value).padStart(2, '0');}
/** For example "Friday, October 23, 2026, 14:05 UTC". */
export function readableTime(ms: number) {
  const date = new Date(ms);
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`;
}
/** RFC 5322 date-time, for example "Fri, 23 Oct 2026 14:05:09 +0000". */
function mailDate(date: Date) {return date.toUTCString().replace(/GMT$/, '+0000');}
function count(value: number | null | undefined) {return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;}
function requests(n: number) {return n + ' other request' + (n === 1 ? '' : 's');}

/**
 * The alert's plain-text body: the requester's name, device and request time, the pending count and any repeat-request
 * counts, never the email address, network or status link.
 */
export function alertBody(alert: TrialAlert) {
  const pending = count(alert.pending), network = count(alert.sameNetwork), email = count(alert.sameEmail);
  const lines = [
    'Someone asked for a free 24-hour trial of LumaNest TV.',
    '',
    'Name: ' + alertName(alert.name),
    'Device: ' + deviceLabel(alert.device),
    'Requested: ' + readableTime(alert.requested) + ' (' + new Date(alert.requested).toISOString() + ')',
    ...(pending === null ? [] : ['Pending requests: ' + pending])
  ];
  const repeats = [
    ...(network ? ['This home network has made ' + requests(network) + ' in the last 30 days.'] : []),
    ...(email ? ['This email address has made ' + requests(email) + '.'] : [])
  ];
  if (repeats.length) lines.push('', ...repeats);
  lines.push('', 'Review it: ' + REVIEW_URL, '', 'You get this alert because TRIAL_ALERT_TO is set for the lumanest-tv Worker. Remove it to stop these alerts.');
  return lines.join('\n');
}

/**
 * The whole message for the send_email binding: envelope addresses and the raw RFC 5322 text with CRLF line ends.
 * The From header's address matches the envelope sender, and the Message-ID is on the sender's domain.
 */
export function trialAlertMessage(alert: TrialAlert, addresses: AlertAddresses, now = new Date()) {
  const from = alertAddress(addresses.from), to = alertAddress(addresses.to);
  if (!from || !to) throw new Error('Invalid alert address.');
  const headers = [
    ['From', SENDER_NAME + ' <' + from + '>'],
    ['To', '<' + to + '>'],
    ['Subject', encodeHeader(ALERT_SUBJECT)],
    ['Date', mailDate(now)],
    ['Message-ID', '<' + crypto.randomUUID() + '@' + from.slice(from.lastIndexOf('@') + 1) + '>'],
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['Content-Transfer-Encoding', 'quoted-printable']
  ];
  // encodeHeader already folded the subject with CRLF + space; every other value is one line.
  const head = headers.map(([name, value]) => name + ': ' + (name === 'Subject' ? value : headerText(value))).join('\r\n');
  return {from, to, raw: head + '\r\n\r\n' + quotedPrintable(alertBody(alert)) + '\r\n'};
}
