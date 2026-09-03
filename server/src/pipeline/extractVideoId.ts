const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com';

  if (isYouTubeHost) {
    if (parsed.pathname === '/watch') {
      const v = parsed.searchParams.get('v');
      if (v && YT_ID_REGEX.test(v)) return v;
      return null;
    }

    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    if (
      pathSegments.length >= 2 &&
      (pathSegments[0] === 'shorts' ||
        pathSegments[0] === 'embed' ||
        pathSegments[0] === 'live' ||
        pathSegments[0] === 'v')
    ) {
      const candidate = pathSegments[1];
      if (YT_ID_REGEX.test(candidate)) return candidate;
    }
  }

  if (host === 'youtu.be') {
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length >= 1 && YT_ID_REGEX.test(segs[0])) return segs[0];
  }

  return null;
}
