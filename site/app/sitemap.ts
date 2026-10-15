import type {MetadataRoute} from 'next';
import {SITE_URL} from './site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{url: SITE_URL + '/', changeFrequency: 'weekly', priority: 1}, {url: SITE_URL + '/apps', changeFrequency: 'monthly', priority: 0.7}, {url: SITE_URL + '/watch', changeFrequency: 'monthly', priority: 0.6}, ...['/terms', '/privacy', '/refunds'].map(path => ({url: SITE_URL + path, changeFrequency: 'yearly' as const, priority: 0.2}))];
}
