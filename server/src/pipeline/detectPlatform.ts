import type { Platform } from './types';

export function detectPlatform(url: string): Platform {
  if (typeof url !== 'string') return 'unknown';
  const host = url.trim().toLowerCase();
  if (!host) return 'unknown';

  if (
    host.includes('youtube.com') ||
    host.includes('youtu.be') ||
    host.includes('youtube-nocookie.com')
  ) {
    return 'youtube';
  }

  if (host.includes('instagram.com') || host.includes('instagr.am')) {
    return 'instagram';
  }

  return 'unknown';
}
