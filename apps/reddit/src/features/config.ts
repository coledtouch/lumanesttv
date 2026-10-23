import { settings } from '@devvit/web/server';

export type AppVersions = {
  android: string;
  lg: string;
  samsung: string;
  roku: string;
  appleTv: string;
};

export type AppConfig = {
  helpReplyEnabled: boolean;
  helpFlairs: string[];
  helpKeywords: string[];
  flairReminderEnabled: boolean;
  privateInfoFilterEnabled: boolean;
  versionCommandEnabled: boolean;
  versions: AppVersions;
};

// Defaults match devvit.json. They also apply before a moderator has saved the settings page once.
export const DEFAULT_VERSIONS: AppVersions = {
  android: '1.8.3',
  lg: '1.2.1',
  samsung: '1.6.1',
  roku: '1.1.0',
  appleTv: 'Coming soon to the App Store',
};

const DEFAULT_HELP_FLAIRS = 'Help, Support, Setup';
const DEFAULT_HELP_KEYWORDS =
  "help\nnot working\nwon't load\nwont load\ncan't log in\ncant log in\nbuffering\nerror\nhow do i\nhow to install\nsetup\nset up\ninstall\nfrozen\nblack screen";

/** Splits a moderator-entered list on commas and newlines, lowercased, trimmed and without duplicates. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  const values = raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}

async function readBoolean(key: string, fallback: boolean): Promise<boolean> {
  const value = await settings.get<boolean>(key);
  return typeof value === 'boolean' ? value : fallback;
}

async function readString(key: string, fallback: string): Promise<string> {
  const value = (await settings.get<string>(key))?.trim();
  return value ? value : fallback;
}

// Read on every event so a moderator's change applies to the next post or comment.
export async function getConfig(): Promise<AppConfig> {
  const [
    helpReplyEnabled,
    helpFlairs,
    helpKeywords,
    flairReminderEnabled,
    privateInfoFilterEnabled,
    versionCommandEnabled,
    android,
    lg,
    samsung,
    roku,
    appleTv,
  ] = await Promise.all([
    readBoolean('helpReplyEnabled', true),
    readString('helpFlairs', DEFAULT_HELP_FLAIRS),
    readString('helpKeywords', DEFAULT_HELP_KEYWORDS),
    readBoolean('flairReminderEnabled', true),
    readBoolean('privateInfoFilterEnabled', true),
    readBoolean('versionCommandEnabled', true),
    readString('versionAndroid', DEFAULT_VERSIONS.android),
    readString('versionLg', DEFAULT_VERSIONS.lg),
    readString('versionSamsung', DEFAULT_VERSIONS.samsung),
    readString('versionRoku', DEFAULT_VERSIONS.roku),
    readString('versionAppleTv', DEFAULT_VERSIONS.appleTv),
  ]);

  return {
    helpReplyEnabled,
    helpFlairs: parseList(helpFlairs),
    helpKeywords: parseList(helpKeywords),
    flairReminderEnabled,
    privateInfoFilterEnabled,
    versionCommandEnabled,
    versions: { android, lg, samsung, roku, appleTv },
  };
}
