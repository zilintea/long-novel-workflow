import type { BookProject, CharacterProfile } from './types.ts';

export interface CharacterAppearanceInfo {
  firstChapter: number;
  chapters: number[];
  locked: boolean;
}

function doesCharacterAppearInChapter(
  char: CharacterProfile,
  chapterItem: BookProject['chapters'][number]
): boolean {
  const cleanName = char.name.trim();
  if (!cleanName) return false;

  const hasProse = chapterItem.prose.trim().length > 0;
  const isCommitted = chapterItem.status === 'committed';
  if (!isCommitted && !hasProse) {
    return false;
  }

  if (chapterItem.contract.characters.some((n) => n.trim() === cleanName)) {
    return true;
  }

  if (cleanName.length >= 2 && hasProse && chapterItem.prose.includes(cleanName)) {
    return true;
  }

  if (char.introducedChapter && char.introducedChapter === chapterItem.chapter) {
    return true;
  }

  return false;
}

/**
 * Computes which characters have already appeared in committed chapters or drafted prose.
 * Returns a Map keyed by CharacterProfile.id.
 */
export function getCharacterAppearanceMap(
  book: Pick<BookProject, 'bible' | 'chapters'>
): Map<string, CharacterAppearanceInfo> {
  const map = new Map<string, CharacterAppearanceInfo>();
  const sortedChapters = [...book.chapters].sort((a, b) => a.chapter - b.chapter);

  for (const char of book.bible.characters) {
    const appeared: number[] = [];
    for (const ch of sortedChapters) {
      if (doesCharacterAppearInChapter(char, ch)) {
        appeared.push(ch.chapter);
      }
    }
    map.set(char.id, {
      firstChapter: appeared[0] ?? 0,
      chapters: appeared,
      locked: appeared.length > 0,
    });
  }

  return map;
}

/**
 * Ensures canonical attributes of characters who have already appeared in committed or
 * written chapters remain immutable across saves, while preserving any edits to un-appeared
 * characters and allowing dynamic state / knows updates.
 */
export function preserveLockedCharacters(
  previousBook: BookProject | null | undefined,
  incomingBook: BookProject
): BookProject {
  if (!previousBook) return incomingBook;

  // Consider a chapter "active in canon/prose" if it is committed on disk OR still has written prose in incomingBook.
  // This ensures rolling back or deleting an uncommitted draft chapter cleanly unlocks its characters.
  const effectivePrevChapters = previousBook.chapters.filter(
    (pch) =>
      pch.status === 'committed' ||
      incomingBook.chapters.some(
        (ich) => ich.chapter === pch.chapter && ich.prose.trim().length > 0
      )
  );

  const prevAppearanceMap = getCharacterAppearanceMap({
    bible: previousBook.bible,
    chapters: effectivePrevChapters,
  });

  const prevCharById = new Map(previousBook.bible.characters.map((c) => [c.id, c]));
  const incomingIds = new Set<string>();

  const protectedCharacters: CharacterProfile[] = incomingBook.bible.characters.map((inc) => {
    incomingIds.add(inc.id);
    const prev = prevCharById.get(inc.id);
    const app = prevAppearanceMap.get(inc.id);
    if (prev && app?.locked) {
      return {
        ...prev,
      };
    }
    return inc;
  });

  // Never allow silent deletion of an already-appeared character
  for (const prev of previousBook.bible.characters) {
    const app = prevAppearanceMap.get(prev.id);
    if (app?.locked && !incomingIds.has(prev.id)) {
      protectedCharacters.push({ ...prev });
    }
  }

  return {
    ...incomingBook,
    bible: {
      ...incomingBook.bible,
      characters: protectedCharacters,
    },
  };
}
