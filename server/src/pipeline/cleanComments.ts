import type { CleaningStats, RawComment } from './types';

const EMOJI_AND_PUNCT_REGEX =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}]|[\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu;

const AT_REPLY_REGEX = /^@\w[\w.]*$/;

const SHORT_REPLY_KEYWORDS = new Set(['lol', 'lmao', 'lmfao', 'same', 'me', 'this']);

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function stripEmojiAndPunctuation(text: string): string {
  return text.replace(EMOJI_AND_PUNCT_REGEX, '').replace(/\s+/g, '');
}

function isAtReplyOnly(text: string): boolean {
  return AT_REPLY_REGEX.test(text.trim());
}

function looksLikeShortSubstantiveReply(text: string, wordCount: number): boolean {
  if (wordCount !== 1) return false;
  const lower = text.trim().toLowerCase();
  return !SHORT_REPLY_KEYWORDS.has(lower);
}

export function cleanComments(
  comments: RawComment[],
): { cleaned: RawComment[]; stats: CleaningStats } {
  const stats: CleaningStats = {
    input: comments.length,
    kept: 0,
    removedShort: 0,
    removedEmojiOnly: 0,
    removedDuplicate: 0,
    removedAtReply: 0,
    totalRemoved: 0,
  };

  const cleaned: RawComment[] = [];
  const seen = new Map<string, RawComment>();

  for (const c of comments) {
    const text = (c.text ?? '').trim();
    const wc = wordCount(text);

    if (wc < 3 && !looksLikeShortSubstantiveReply(text, wc)) {
      stats.removedShort += 1;
      continue;
    }

    if (stripEmojiAndPunctuation(text).length === 0) {
      stats.removedEmojiOnly += 1;
      continue;
    }

    if (isAtReplyOnly(text)) {
      stats.removedAtReply += 1;
      continue;
    }

    const key = text.toLowerCase();
    const prior = seen.get(key);
    if (prior) {
      if (c.likeCount > prior.likeCount) seen.set(key, c);
      stats.removedDuplicate += 1;
      continue;
    }

    seen.set(key, c);
    cleaned.push(c);
  }

  stats.kept = cleaned.length;
  stats.totalRemoved = stats.input - stats.kept;

  console.log(
    `[cleanComments] input=${stats.input} kept=${stats.kept} ` +
      `removed: short=${stats.removedShort}, emojiOnly=${stats.removedEmojiOnly}, ` +
      `duplicate=${stats.removedDuplicate}, atReply=${stats.removedAtReply}`,
  );

  return { cleaned, stats };
}
