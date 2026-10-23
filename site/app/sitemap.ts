import type {MetadataRoute} from 'next';
import {trialsReady} from '../lib/trials';
import {SITE_URL} from './site';

// Read per request, so /trial is listed only while free trials are offered.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{url: SITE_URL + '/', changeFrequency: 'weekly', priority: 1}, {url: SITE_URL + '/apps', changeFrequency: 'monthly', priority: 0.7}, {url: SITE_URL + '/watch', changeFrequency: 'monthly', priority: 0.6}, ...(trialsReady() ? [{url: SITE_URL + '/trial', changeFrequency: 'monthly' as const, priority: 0.6}] : []), ...['/terms', '/privacy', '/refunds'].map(path => ({url: SITE_URL + path, changeFrequency: 'yearly' as const, priority: 0.2}))];
}
