// Devices a trial requester can say they'll watch on. Plain data so both the API and the client form can import it.
export const TRIAL_DEVICES = [
  ['android', 'Android TV or Google TV'],
  ['fire', 'Fire TV'],
  ['samsung', 'Samsung TV'],
  ['lg', 'LG TV'],
  ['roku', 'Roku'],
  ['apple', 'Apple TV'],
  ['web', 'Web browser'],
  ['other', 'Something else'],
] as const;
export type TrialDevice = typeof TRIAL_DEVICES[number][0];
export function isTrialDevice(value: unknown): value is TrialDevice {
  return typeof value === 'string' && TRIAL_DEVICES.some(([key]) => key === value);
}
