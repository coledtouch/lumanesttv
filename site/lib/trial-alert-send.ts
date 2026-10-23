// Sends the owner's new-trial alert (lib/trial-alert.ts) through the optional TRIAL_ALERT_EMAIL send_email binding
// (Cloudflare Email Routing; docs/trials.md, Email alerts). The only module that imports cloudflare:email.
import {EmailMessage} from 'cloudflare:email';
import * as workers from 'cloudflare:workers';
import {alertAddresses, alertStatus, trialAlertMessage, type AlertAddresses, type AlertStatus, type TrialAlert} from './trial-alert.ts';

function settings() {return workers.env as unknown as Record<string, unknown>;}
function binding() {
  const value = settings().TRIAL_ALERT_EMAIL as Partial<SendEmail> | null | undefined;
  return value && typeof value.send === 'function' ? value as SendEmail : null;
}
function current(): {status: AlertStatus; mail: SendEmail | null; addresses: AlertAddresses | null} {
  try {
    const values = settings(), mail = binding();
    return {status: alertStatus(values, Boolean(mail)), mail, addresses: alertAddresses(values)};
  } catch {return {status: 'off', mail: null, addresses: null};}
}

/** Whether alerts go out ('on'), aren't set up ('off'), or are set up but can't send; shown in the /manage Trial requests panel. */
export function trialAlertStatus(): AlertStatus {return current().status;}

/**
 * Emails the owner about a stored trial request after the response (waitUntil), when the binding and TRIAL_ALERT_TO
 * are set; `details` runs only then. A failure is logged with a fixed code, with no address or name, and never reaches
 * the requester. Alerts that are set up (TRIAL_ALERT_TO) but can't send, such as after a deploy prepared without
 * --trial-alerts, are logged the same way for each request. Returns the background job, or null when nothing is sent.
 */
export function sendTrialAlertSoon(details: () => Promise<TrialAlert>): Promise<void> | null {
  const {status, mail, addresses} = current();
  if (status !== 'on' || !mail || !addresses) {
    if (status === 'binding_missing' || status === 'sender_invalid') console.error('lumanest_trial_alert_failed', JSON.stringify({code: 'alert_' + status}));
    return null;
  }
  const job = (async () => {
    let message: ReturnType<typeof trialAlertMessage>;
    try {message = trialAlertMessage(await details(), addresses);}
    catch {return 'alert_not_built';}
    try {await mail.send(new EmailMessage(message.from, message.to, message.raw));}
    catch {return 'alert_not_sent';}
    return null;
  })().then(code => {
    if (code) console.error('lumanest_trial_alert_failed', JSON.stringify({code}));
  });
  try {workers.waitUntil?.(job);} catch {}
  return job;
}
