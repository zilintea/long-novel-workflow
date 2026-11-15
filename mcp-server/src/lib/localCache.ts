import type { BookProject, TrashItem } from '../shared/types.ts';

const DB_NAME = 'long_novel_studio_db';
const DB_VERSION = 2;
const STORE_BOOKS = 'books';
const STORE_TRASH = 'trash';

const LS_FALLBACK_BOOKS_KEY = 'lnw_books_fallback_v1';
const LS_FALLBACK_TRASH_KEY = 'lnw_trash_fallback_v1';
const LS_ACTIVE_BOOK_KEY = 'lnw_active_book_id_v1';
const LS_LAST_BACKUP_AT_KEY = 'lnw_last_backup_at_v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TRASH)) {
        db.createObjectStore(STORE_TRASH, { keyPath: 'trashId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export async function loadCachedBooks(): Promise<BookProject[]> {
  try {
    const db = await openDb();
    const books = await new Promise<BookProject[]>((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, 'readonly');
      const store = tx.objectStore(STORE_BOOKS);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as BookProject[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (books.length > 0) return books;
  } catch {
    // Fallback to localStorage below
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_BOOKS_KEY);
    if (raw) return JSON.parse(raw) as BookProject[];
  } catch {
    // ignore corrupted fallback
  }
  return [];
}

export async function saveCachedBook(book: BookProject): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, 'readwrite');
      tx.objectStore(STORE_BOOKS).put(book);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // fallback handled below
  }

  try {
    const currentRaw = localStorage.getItem(LS_FALLBACK_BOOKS_KEY);
    const list: BookProject[] = currentRaw ? JSON.parse(currentRaw) : [];
    const next = [book, ...list.filter((b) => b.id !== book.id)];
    localStorage.setItem(LS_FALLBACK_BOOKS_KEY, JSON.stringify(next));
  } catch {
    // localStorage quota exceeded on huge novels; IndexedDB remains authoritative
  }
}

export async function saveAllCachedBooks(books: BookProject[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(STORE_BOOKS);
      for (const b of books) {
        store.put(b);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(LS_FALLBACK_BOOKS_KEY, JSON.stringify(books));
  } catch {
    // ignore quota error
  }
}

export async function deleteCachedBook(bookId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, 'readwrite');
      tx.objectStore(STORE_BOOKS).delete(bookId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    const currentRaw = localStorage.getItem(LS_FALLBACK_BOOKS_KEY);
    if (currentRaw) {
      const list: BookProject[] = JSON.parse(currentRaw);
      localStorage.setItem(
        LS_FALLBACK_BOOKS_KEY,
        JSON.stringify(list.filter((b) => b.id !== bookId))
      );
    }
  } catch {
    // ignore
  }
}

// --- Recycle Bin (Trash) Persistence ---

export async function loadCachedTrash(): Promise<TrashItem[]> {
  try {
    const db = await openDb();
    const items = await new Promise<TrashItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_TRASH, 'readonly');
      const req = tx.objectStore(STORE_TRASH).getAll();
      req.onsuccess = () => resolve((req.result as TrashItem[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (items.length > 0) {
      return items.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    }
  } catch {
    // fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_TRASH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TrashItem[];
      return parsed.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    }
  } catch {
    // ignore
  }
  return [];
}

export async function saveCachedTrashItem(item: TrashItem): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRASH, 'readwrite');
      tx.objectStore(STORE_TRASH).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // fallback below
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_TRASH_KEY);
    const list: TrashItem[] = raw ? JSON.parse(raw) : [];
    const next = [item, ...list.filter((t) => t.trashId !== item.trashId)];
    localStorage.setItem(LS_FALLBACK_TRASH_KEY, JSON.stringify(next));
  } catch {
    // ignore quota error
  }
}

export async function saveAllCachedTrash(items: TrashItem[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRASH, 'readwrite');
      const store = tx.objectStore(STORE_TRASH);
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(LS_FALLBACK_TRASH_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export async function deleteCachedTrashItem(trashId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRASH, 'readwrite');
      tx.objectStore(STORE_TRASH).delete(trashId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_TRASH_KEY);
    if (raw) {
      const list: TrashItem[] = JSON.parse(raw);
      localStorage.setItem(
        LS_FALLBACK_TRASH_KEY,
        JSON.stringify(list.filter((t) => t.trashId !== trashId))
      );
    }
  } catch {
    // ignore
  }
}

export async function clearCachedTrash(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRASH, 'readwrite');
      tx.objectStore(STORE_TRASH).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    localStorage.removeItem(LS_FALLBACK_TRASH_KEY);
  } catch {
    // ignore
  }
}

export function getActiveBookIdCache(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE_BOOK_KEY);
  } catch {
    return null;
  }
}

export function setActiveBookIdCache(id: string): void {
  try {
    localStorage.setItem(LS_ACTIVE_BOOK_KEY, id);
  } catch {
    // ignore
  }
}

export function getLastBackupTime(): string | null {
  try {
    return localStorage.getItem(LS_LAST_BACKUP_AT_KEY);
  } catch {
    return null;
  }
}

export function markBackupDone(): string {
  const iso = new Date().toISOString();
  try {
    localStorage.setItem(LS_LAST_BACKUP_AT_KEY, iso);
  } catch {
    // ignore
  }
  return iso;
}

export interface StudioBackupPayload {
  format: 'long-novel-studio-backup';
  version: 1;
  exportedAt: string;
  books: BookProject[];
  trash?: TrashItem[];
  slopZh: string[];
  slopEn: string[];
}

export function buildWorkspaceBackupJson(
  books: BookProject[],
  slopZh: string[],
  slopEn: string[],
  trash: TrashItem[] = []
): string {
  const payload: StudioBackupPayload = {
    format: 'long-novel-studio-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    books,
    trash,
    slopZh,
    slopEn,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseWorkspaceBackupJson(rawText: string): StudioBackupPayload {
  const parsed = JSON.parse(rawText) as Partial<StudioBackupPayload>;
  if (
    !parsed ||
    parsed.format !== 'long-novel-studio-backup' ||
    !Array.isArray(parsed.books)
  ) {
    throw new Error('无效的备份文件格式，请选择 Long Novel Studio 导出的 .json 备份文件。');
  }
  return {
    format: 'long-novel-studio-backup',
    version: 1,
    exportedAt: parsed.exportedAt || new Date().toISOString(),
    books: parsed.books,
    trash: Array.isArray(parsed.trash) ? parsed.trash : [],
    slopZh: Array.isArray(parsed.slopZh) ? parsed.slopZh : [],
    slopEn: Array.isArray(parsed.slopEn) ? parsed.slopEn : [],
  };
}
