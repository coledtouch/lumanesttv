// The owner's new-trial alert email (lib/trial-alert.ts): addresses, headers, encodings and what the body may say.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ALERT_SUBJECT, DEFAULT_ALERT_FROM, alertAddress, alertAddresses, alertBody, alertStatus, alertName, encodeHeader, headerText, quotedPrintable, readableTime, trialAlertMessage} from '../lib/trial-alert.ts';

const addresses = {from: 'alerts@lumanest.tv', to: 'owner@example.test'};
const requested = Date.UTC(2026, 9, 23, 14, 5, 9, 123);
const alert = {name: 'Pat Example', device: 'samsung', requested, pending: 3, sameNetwork: 1, sameEmail: 2};
const sent = new Date(Date.UTC(2026, 9, 23, 14, 5, 10));

function split(raw: string) {
  const end = raw.indexOf('\r\n\r\n');
  assert.ok(end > 0, 'a blank line ends the headers');
  const head = raw.slice(0, end), names: string[] = [], values: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line)) {values[names[names.length - 1]] += line.slice(1); continue;}
    const colon = line.indexOf(':');
    names.push(line.slice(0, colon));
    values[line.slice(0, colon)] = line.slice(colon + 2);
  }
  return {names, values, head, body: raw.slice(end + 4)};
}
function decodeWords(value: string) {
  return value.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_, data: string) => new TextDecoder('utf-8', {fatal: true}).decode(Buffer.from(data, 'base64')));
}
function decodeQP(body: string) {
  const bytes: number[] = [];
  const text = body.replace(/=\r\n/g, '');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '=') {bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2;}
    else bytes.push(text.charCodeAt(i));
  }
  return new TextDecoder('utf-8', {fatal: true}).decode(new Uint8Array(bytes));
}
function assertCRLF(raw: string) {
  assert.doesNotMatch(raw, /[^\r]\n/, 'every line ends in CRLF');
  assert.doesNotMatch(raw, /\r(?!\n)/, 'no bare CR');
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 78, 'line within 78 characters: ' + line);
}

test('alerts need TRIAL_ALERT_TO, default the sender to alerts@lumanest.tv, and take plain addresses only', () => {
  assert.equal(DEFAULT_ALERT_FROM, 'alerts@lumanest.tv');
  assert.equal(alertAddresses({}), null);
  assert.equal(alertAddresses({TRIAL_ALERT_FROM: 'alerts@lumanest.tv'}), null);
  assert.deepEqual(alertAddresses({TRIAL_ALERT_TO: ' owner@example.test '}), {from: 'alerts@lumanest.tv', to: 'owner@example.test'});
  assert.deepEqual(alertAddresses({TRIAL_ALERT_TO: 'owner@example.test', TRIAL_ALERT_FROM: ''}), {from: 'alerts@lumanest.tv', to: 'owner@example.test'});
  assert.deepEqual(alertAddresses({TRIAL_ALERT_TO: 'owner@example.test', TRIAL_ALERT_FROM: 'trials@lumanest.tv'}), {from: 'trials@lumanest.tv', to: 'owner@example.test'});
  assert.equal(alertAddresses({TRIAL_ALERT_TO: 'owner@example.test', TRIAL_ALERT_FROM: 'not an address'}), null, 'an invalid sender sends nothing');
  for (const value of ['owner', 'owner@', '@example.test', 'owner@localhost', 'Owner <owner@example.test>', '"o w"@example.test', 'owner@example.test\r\nBcc: other@example.test',
    'owner@example.test\nX: y', 'owner@exa mple.test', 'o@' + 'a'.repeat(250) + '.test', 'ow\u00f1er@example.test', undefined, null, 7]) {
    assert.equal(alertAddress(value), '', String(value));
    assert.equal(alertAddresses({TRIAL_ALERT_TO: value}), null, String(value));
  }
  for (const value of ['first.last+trials@mail.example.co.uk', 'owner@example.xn--p1ai']) assert.equal(alertAddress(value), value);
});

test('the alert status tells alerts that aren\'t set up apart from alerts that are set up but can\'t send', () => {
  // Off: TRIAL_ALERT_TO is unset or not a plain address, with or without the binding.
  for (const settings of [{}, {TRIAL_ALERT_FROM: 'alerts@lumanest.tv'}, {TRIAL_ALERT_TO: ''}, {TRIAL_ALERT_TO: 'Owner <owner@example.test>'}]) {
    assert.equal(alertStatus(settings, true), 'off', JSON.stringify(settings));
    assert.equal(alertStatus(settings, false), 'off', JSON.stringify(settings));
  }
  // Set up: TRIAL_ALERT_TO is a plain address. A deploy prepared without --trial-alerts has no binding.
  assert.equal(alertStatus({TRIAL_ALERT_TO: 'owner@example.test'}, true), 'on');
  assert.equal(alertStatus({TRIAL_ALERT_TO: ' owner@example.test ', TRIAL_ALERT_FROM: 'trials@lumanest.tv'}, true), 'on');
  assert.equal(alertStatus({TRIAL_ALERT_TO: 'owner@example.test'}, false), 'binding_missing');
  assert.equal(alertStatus({TRIAL_ALERT_TO: 'owner@example.test', TRIAL_ALERT_FROM: 'Alerts <alerts@lumanest.tv>'}, true), 'sender_invalid');
  assert.equal(alertStatus({TRIAL_ALERT_TO: 'owner@example.test', TRIAL_ALERT_FROM: 'not an address'}, false), 'binding_missing', 'the missing binding is named first');
});

test('the message has the required headers, CRLF line ends and a Message-ID on the sender domain', () => {
  const message = trialAlertMessage(alert, addresses, sent);
  assert.equal(message.from, 'alerts@lumanest.tv');
  assert.equal(message.to, 'owner@example.test');
  assertCRLF(message.raw);
  assert.ok(message.raw.endsWith('\r\n'));
  const {names, values} = split(message.raw);
  assert.deepEqual(names, ['From', 'To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
  assert.equal(values.From, 'LumaNest TV <alerts@lumanest.tv>', 'the From address is the envelope sender');
  assert.equal(values.To, '<owner@example.test>');
  assert.equal(values.Date, 'Fri, 23 Oct 2026 14:05:10 +0000');
  assert.match(values['Message-ID'], /^<[0-9a-f-]{36}@lumanest\.tv>$/);
  assert.notEqual(split(trialAlertMessage(alert, addresses, sent).raw).values['Message-ID'], values['Message-ID'], 'a new Message-ID each time');
  assert.equal(values['MIME-Version'], '1.0');
  assert.equal(values['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(values['Content-Transfer-Encoding'], 'quoted-printable');
  assert.match(values.Subject, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/, 'the en dash makes the subject an encoded word');
  assert.equal(decodeWords(values.Subject), 'New free-trial request – LumaNest TV');
  assert.equal(ALERT_SUBJECT, 'New free-trial request – LumaNest TV');
  const custom = split(trialAlertMessage(alert, {from: 'trials@alerts.lumanest.tv', to: 'owner@example.test'}, sent).raw).values;
  assert.equal(custom.From, 'LumaNest TV <trials@alerts.lumanest.tv>');
  assert.match(custom['Message-ID'], /@alerts\.lumanest\.tv>$/);
  assert.throws(() => trialAlertMessage(alert, {from: 'alerts@lumanest.tv', to: 'owner@example.test\r\nBcc: x@example.test'}, sent));
  assert.throws(() => trialAlertMessage(alert, {from: 'Alerts <alerts@lumanest.tv>', to: 'owner@example.test'}, sent));
});

test('the body names the requester, device, time, queue and repeats, and links to /manage', () => {
  const {body} = split(trialAlertMessage(alert, addresses, sent).raw);
  for (const line of body.split('\r\n')) assert.ok(line.length <= 76);
  const text = decodeQP(body);
  assert.equal(text, [
    'Someone asked for a free 24-hour trial of LumaNest TV.',
    '',
    'Name: Pat Example',
    'Device: Samsung TV',
    'Requested: Friday, October 23, 2026, 14:05 UTC (2026-10-23T14:05:09.123Z)',
    'Pending requests: 3',
    '',
    'This home network has made 1 other request in the last 30 days.',
    'This email address has made 2 other requests.',
    '',
    'Review it: https://lumanest.tv/manage',
    '',
    'You get this alert because TRIAL_ALERT_TO is set for the lumanest-tv Worker. Remove it to stop these alerts.',
    ''
  ].join('\r\n'));
  const single = alertBody({...alert, sameNetwork: 3, sameEmail: 1});
  assert.match(single, /made 3 other requests in the last 30 days\./);
  assert.match(single, /This email address has made 1 other request\./);
  const first = alertBody({...alert, pending: 1, sameNetwork: 0, sameEmail: 0});
  assert.doesNotMatch(first, /home network|email address/, 'no repeat lines for a first request');
  assert.match(first, /Pending requests: 1\n\nReview it/);
  const unknown = alertBody({name: 'Pat', device: 'web', requested});
  assert.doesNotMatch(unknown, /Pending|other request/, 'counts that could not be read are left out');
  assert.match(unknown, /Device: Web browser/);
  assert.equal(readableTime(Date.UTC(2027, 0, 3, 9, 7)), 'Sunday, January 3, 2027, 09:07 UTC');
});

test('the body never carries an email address, network, IP or status link', () => {
  const raw = trialAlertMessage({...alert, name: 'Sam Requester'}, addresses, sent).raw;
  const text = decodeQP(split(raw).body);
  assert.doesNotMatch(text, /@/, 'no email address, the owner\'s included');
  assert.doesNotMatch(text, /status|#|token|\d+\.\d+\.\d+\.\d+/i);
  assert.equal(raw.split('owner@example.test').length, 2, 'the owner\'s address appears only in To');
});

test('a name with line breaks or header text stays one body line and can\'t add a header', () => {
  const raw = trialAlertMessage({...alert, name: 'Eve\r\nBcc: victim@example.test\r\n\r\nInjected'}, addresses, sent).raw;
  const {names, body} = split(raw);
  assert.deepEqual(names, ['From', 'To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
  assert.doesNotMatch(raw, /^Bcc:/im);
  assert.match(decodeQP(body), /^Name: Eve Bcc: victim@example\.test Injected$/m);
  assert.equal(headerText('a\r\nb\nc\rd\u0000e\u001bf'), 'a b c def');
  assert.equal(encodeHeader('Line\r\nX-Injected: yes'), 'Line X-Injected: yes');
  assert.equal(alertName('  Pat\u202e evil \u2066x\u0007  '), 'Pat evil x');
  assert.equal(alertName('\u0001'), '(no name)');
  assert.equal(Array.from(alertName('é'.repeat(80) + '🎬'.repeat(40))).length, 100, 'at most 100 characters, never half an emoji');
});

test('non-ASCII text is encoded: RFC 2047 words in headers, quoted-printable UTF-8 in the body', () => {
  const name = 'Zoë Ñúñez 🎬 Łukasz';
  const text = decodeQP(split(trialAlertMessage({...alert, name}, addresses, sent).raw).body);
  assert.match(text, /^Name: Zoë Ñúñez 🎬 Łukasz$/m);
  const long = 'Überraschung – ' + 'ü'.repeat(60) + ' 🎬🎬 fin';
  const encoded = encodeHeader(long);
  const words = encoded.split('\r\n ');
  assert.ok(words.length > 2, 'long text is folded into several words');
  for (const word of words) {
    assert.match(word, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.ok(word.length <= 75, 'an encoded word is at most 75 characters');
    assert.doesNotThrow(() => decodeWords(word), 'no word splits a character');
  }
  assert.equal(words.map(decodeWords).join(''), long);
  assert.equal(encodeHeader('Plain ASCII'), 'Plain ASCII');
  const qp = quotedPrintable('x'.repeat(200) + ' = é \n trailing space ');
  for (const line of qp.split('\r\n')) assert.ok(line.length <= 76, line);
  assert.match(qp, /=3D/);
  assert.match(qp, /=C3=A9/);
  assert.match(qp, / trailing space=20$/, 'a space at a line end is encoded');
  assert.equal(decodeQP(qp), 'x'.repeat(200) + ' = é \r\n trailing space ');
});
