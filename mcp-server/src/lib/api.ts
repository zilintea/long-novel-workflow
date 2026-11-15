import type {
  AuditIssue,
  BookProject,
  ChapterContract,
  ChapterItem,
  CharacterProfile,
  CommitProposal,
  MarketScanRecord,
  PackagingInfo,
  TrashItem,
} from '../shared/types.ts';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export async function fetchBooks(): Promise<BookProject[]> {
  const data = await requestJson<{ books: BookProject[] }>('/api/books');
  return data.books;
}

export async function saveBookApi(book: BookProject): Promise<BookProject> {
  const data = await requestJson<{ book: BookProject }>(`/api/books/${encodeURIComponent(book.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ book }),
  });
  return data.book;
}

export async function createBookApi(book: BookProject): Promise<BookProject> {
  const data = await requestJson<{ book: BookProject }>('/api/books', {
    method: 'POST',
    body: JSON.stringify({ book }),
  });
  return data.book;
}

export async function deleteBookApi(bookId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/books/${encodeURIComponent(bookId)}`, {
    method: 'DELETE',
  });
}

export async function fetchTrashApi(): Promise<TrashItem[]> {
  const data = await requestJson<{ items: TrashItem[] }>('/api/trash');
  return data.items;
}

export async function saveTrashApi(item: TrashItem): Promise<TrashItem> {
  const data = await requestJson<{ item: TrashItem }>('/api/trash', {
    method: 'POST',
    body: JSON.stringify({ item }),
  });
  return data.item;
}

export async function deleteTrashApi(trashId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/trash/${encodeURIComponent(trashId)}`, {
    method: 'DELETE',
  });
}

export async function clearTrashApi(): Promise<void> {
  await requestJson<{ ok: boolean }>('/api/trash', {
    method: 'DELETE',
  });
}

export async function exportBookMarkdownApi(bookId: string): Promise<Record<string, string>> {
  const data = await requestJson<{ files: Record<string, string> }>(
    `/api/books/${encodeURIComponent(bookId)}/export`
  );
  return data.files;
}

export async function commitChapterApi(
  book: BookProject,
  proposal: CommitProposal
): Promise<BookProject> {
  const data = await requestJson<{ book: BookProject }>(
    `/api/books/${encodeURIComponent(book.id)}/commit`,
    {
      method: 'POST',
      body: JSON.stringify({ proposal, book }),
    }
  );
  return data.book;
}

export async function rollbackChapterApi(
  book: BookProject,
  chapter: number
): Promise<BookProject> {
  const data = await requestJson<{ book: BookProject }>(
    `/api/books/${encodeURIComponent(book.id)}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ chapter, book }),
    }
  );
  return data.book;
}

export async function marketScanApi(params: {
  seedIdea: string;
  platform: string;
  genreId: string;
  language: 'zh' | 'en';
  preferredNames?: string;
}): Promise<MarketScanRecord> {
  const data = await requestJson<{ marketScan: MarketScanRecord }>('/api/ai/market-scan', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.marketScan;
}

export async function generateBibleApi(params: {
  seedIdea: string;
  platform: string;
  genreId: string;
  language: 'zh' | 'en';
  marketScan?: MarketScanRecord;
  preferredNames?: string;
}): Promise<Pick<BookProject, 'title' | 'formula' | 'bible' | 'outline' | 'state'>> {
  return requestJson('/api/ai/generate-bible', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function forgeCharacterApi(
  book: BookProject,
  promptHint: string
): Promise<{
  character: CharacterProfile;
  knowsHints: { fact: string; knows: boolean; note: string }[];
}> {
  return requestJson('/api/ai/forge-character', {
    method: 'POST',
    body: JSON.stringify({ book, promptHint }),
  });
}

export async function generatePackagingApi(book: BookProject): Promise<PackagingInfo> {
  const data = await requestJson<{ packaging: PackagingInfo }>('/api/ai/packaging', {
    method: 'POST',
    body: JSON.stringify({ book }),
  });
  return data.packaging;
}

export async function draftContractApi(
  book: BookProject,
  chapterNum: number,
  authorNote?: string,
  existingContract?: Partial<ChapterContract>
): Promise<{ contract: ChapterContract; newCharacters: Omit<CharacterProfile, 'id'>[] }> {
  return requestJson<{ contract: ChapterContract; newCharacters: Omit<CharacterProfile, 'id'>[] }>(
    '/api/ai/draft-contract',
    {
      method: 'POST',
      body: JSON.stringify({ book, chapterNum, authorNote, existingContract }),
    }
  );
}

export async function streamWriteChapterApi(
  book: BookProject,
  contract: ChapterContract,
  extraGuidance: string,
  onChunk: (chunkText: string) => void
): Promise<void> {
  const res = await fetch('/api/ai/write-chapter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ book, contract, extraGuidance }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`流式写作请求失败 (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;
      const evt = JSON.parse(jsonStr) as { text?: string; done?: boolean; error?: string };
      if (evt.error) throw new Error(evt.error);
      if (evt.text) onChunk(evt.text);
    }
  }
}

export async function subReviewApi(
  book: BookProject,
  chapterItem: ChapterItem
): Promise<{ aiSummary: string; issues: AuditIssue[] }> {
  return requestJson('/api/ai/sub-review', {
    method: 'POST',
    body: JSON.stringify({ book, chapterItem }),
  });
}

export async function boundedReviseApi(
  book: BookProject,
  chapterItem: ChapterItem,
  issuesToFix: string
): Promise<string> {
  const data = await requestJson<{ prose: string }>('/api/ai/bounded-revise', {
    method: 'POST',
    body: JSON.stringify({ book, chapterItem, issuesToFix }),
  });
  return data.prose;
}

export async function prepareCommitApi(
  book: BookProject,
  chapterItem: ChapterItem
): Promise<CommitProposal> {
  const data = await requestJson<{ proposal: CommitProposal }>('/api/ai/prepare-commit', {
    method: 'POST',
    body: JSON.stringify({ book, chapterItem }),
  });
  return data.proposal;
}

export async function arcReviewApi(book: BookProject): Promise<{
  diagnosis: string;
  staleThreadAdvice: string[];
  nextArcGoal: string;
  nextArcBeats: string[];
  nextChaptersPlan: { chapter: number; goal: string; desire: string; hook: string }[];
}> {
  return requestJson('/api/ai/arc-review', {
    method: 'POST',
    body: JSON.stringify({ book }),
  });
}

export async function importManuscriptApi(params: {
  title: string;
  language: 'zh' | 'en';
  platform: string;
  rawText: string;
}): Promise<BookProject> {
  const data = await requestJson<{ book: BookProject }>('/api/ai/import-manuscript', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.book;
}

export async function autoChapterBundleApi(params: {
  book: BookProject;
  chapterNum: number;
  existingContract?: ChapterContract;
  authorGuidance?: string;
}): Promise<{
  contract: ChapterContract;
  prose: string;
  proposal: CommitProposal;
}> {
  return requestJson('/api/ai/auto-chapter-bundle', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
