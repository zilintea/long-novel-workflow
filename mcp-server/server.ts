import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillBundle } from './server/skillBundle.ts';
import {
  applyAtomicChapterCommit,
  applyRetarget,
  clearTrashOnDisk,
  deleteBook,
  deleteTrashOnDisk,
  formatBookAsMarkdownFiles,
  getBook,
  initBookStore,
  listBooks,
  listTrashOnDisk,
  restoreRestructure,
  rollbackChapterCommit,
  saveBook,
  saveTrashOnDisk,
} from './server/bookStore.ts';
import {
  runArcReview,
  runAutoChapterBundle,
  runAiSubReview,
  runBoundedRevise,
  runDraftContract,
  runDraftEnding,
  runForgeCharacter,
  runGenerateBible,
  runImportManuscript,
  runMarketScan,
  runPackaging,
  runPrepareCommit,
  streamWriteChapter,
} from './server/geminiService.ts';
import type { BookProject, CommitProposal, RetargetInput, TrashItem } from './src/shared/types.ts';
import { buildSequelSeed, createBookFromSequelSeed, validateSequelSeed } from './src/shared/sequelSeed.ts';
import { preserveLockedCharacters } from './src/shared/characterUtils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getErrMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function startServer() {
  initBookStore();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Pre-build complete v2.1.0 skill + mcp-server workbench bundle if skill-repo is present
  if (fs.existsSync(path.join(__dirname, 'skill-repo'))) {
    try {
      const info = buildSkillBundle(__dirname, true);
      console.log(
        `Built skill bundle: ${info.fileCount} files (zip=${info.zipSize} bytes, tar.gz=${info.tarGzSize} bytes)`
      );
    } catch (err) {
      console.warn('Pre-build skill bundle skipped:', getErrMessage(err));
    }
  }

  // --- Skill Repo v2.1.0 Full Package Download ---
  const sendZipBundle = (_req: express.Request, res: express.Response) => {
    try {
      const info = buildSkillBundle(__dirname, false);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(info.zipSize));
      res.setHeader('Content-Type', 'application/zip');
      res.download(info.zipPath, 'long-novel-workflow-v2.1.0.zip');
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  };

  const sendTarGzBundle = (_req: express.Request, res: express.Response) => {
    try {
      const info = buildSkillBundle(__dirname, false);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(info.tarGzSize));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.download(info.tarGzPath, 'long-novel-workflow-v2.1.0.tar.gz');
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  };

  app.get('/downloads/long-novel-workflow-v2.1.0.zip', sendZipBundle);
  app.get('/downloads/long-novel-workflow-v2.1.0.tar.gz', sendTarGzBundle);
  app.get('/api/skill-repo/bundle', sendZipBundle);

  // --- Book Persistence API ---
  app.get('/api/books', (_req, res) => {
    try {
      res.json({ books: listBooks() });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.get('/api/books/:id', (req, res) => {
    try {
      const book = getBook(req.params.id);
      if (!book) {
        res.status(404).json({ error: '未找到指定小说工程' });
        return;
      }
      res.json({ book });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/books', (req, res) => {
    try {
      const book = req.body.book as BookProject;
      if (!book || !book.id) {
        res.status(400).json({ error: '无效的小说工程数据' });
        return;
      }
      const saved = saveBook(book);
      res.json({ book: saved });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.put('/api/books/:id', (req, res) => {
    try {
      const book = req.body.book as BookProject;
      if (!book || book.id !== req.params.id) {
        res.status(400).json({ error: '工程 ID 不匹配' });
        return;
      }
      const existing = getBook(req.params.id);
      const protectedBook = preserveLockedCharacters(existing, book);
      const saved = saveBook(protectedBook);
      res.json({ book: saved });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.delete('/api/books/:id', (req, res) => {
    try {
      const ok = deleteBook(req.params.id);
      if (!ok) {
        res.status(400).json({ error: '无法删除示例样书或工程不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  // --- Recycle Bin (Trash) API ---
  app.get('/api/trash', (_req, res) => {
    try {
      res.json({ items: listTrashOnDisk() });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/trash', (req, res) => {
    try {
      const item = req.body.item as TrashItem;
      if (!item || !item.trashId || !item.kind) {
        res.status(400).json({ error: '无效的回收站条目' });
        return;
      }
      const saved = saveTrashOnDisk(item);
      res.json({ item: saved });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.delete('/api/trash/:trashId', (req, res) => {
    try {
      deleteTrashOnDisk(req.params.trashId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.delete('/api/trash', (_req, res) => {
    try {
      clearTrashOnDisk();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.get('/api/books/:id/export', (req, res) => {
    try {
      const book = getBook(req.params.id);
      if (!book) {
        res.status(404).json({ error: '未找到指定小说工程' });
        return;
      }
      const files = formatBookAsMarkdownFiles(book);
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/books/:id/commit', (req, res) => {
    try {
      let book = getBook(req.params.id);
      if (!book && req.body.book && req.body.book.id === req.params.id) {
        book = req.body.book as BookProject;
      }
      if (!book) {
        res.status(404).json({ error: '未找到指定小说工程' });
        return;
      }
      // 乐观锁：提交时携带启动时的 outlineRevision，期间改过卷纲则拒绝，
      // 迟到的提交不覆盖新设定（手册 §十一.1）。仅对已存盘的书校验。
      const stored = getBook(req.params.id);
      const expected = req.body.expectedOutlineRevision;
      if (
        stored &&
        expected != null &&
        (stored.outlineRevision ?? 1) !== Number(expected)
      ) {
        res.status(409).json({
          error: `大纲已在提交期间被修改（当前 outlineRevision=${stored.outlineRevision ?? 1}，提交时为 ${expected}），本次提交已丢弃，请用最新大纲重新生成。`,
        });
        return;
      }
      const proposal = req.body.proposal as CommitProposal;
      if (!proposal || !proposal.chapter) {
        res.status(400).json({ error: '缺少原子提交提案数据' });
        return;
      }
      const updated = applyAtomicChapterCommit(book, proposal);
      res.json({ book: updated });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/books/:id/retarget', (req, res) => {
    try {
      const input = req.body as RetargetInput;
      if (!input || !Number.isFinite(Number(input.targetChapters))) {
        res.status(400).json({ error: '请提供有效的新目标章数' });
        return;
      }
      const updated = applyRetarget(req.params.id, input);
      res.json({ book: updated });
    } catch (err) {
      res.status(400).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/books/:id/restructure-restore', (req, res) => {
    try {
      const logIndex = Number(req.body.logIndex);
      if (!Number.isInteger(logIndex) || logIndex < 0) {
        res.status(400).json({ error: '请提供有效的快照序号' });
        return;
      }
      const updated = restoreRestructure(req.params.id, logIndex);
      res.json({ book: updated });
    } catch (err) {
      res.status(400).json({ error: getErrMessage(err) });
    }
  });

  app.get('/api/books/:id/sequel-seed', (req, res) => {
    try {
      const book = getBook(req.params.id);
      if (!book) {
        res.status(404).json({ error: '未找到指定小说工程' });
        return;
      }
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${book.id}-sequel-seed.json"`
      );
      res.json(buildSequelSeed(book));
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/books/import-seed', (req, res) => {
    try {
      const checked = validateSequelSeed(req.body.seed);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }
      const title = typeof req.body.title === 'string' ? req.body.title : '';
      const book = createBookFromSequelSeed(checked.seed, title);
      const saved = saveBook(book);
      res.json({ book: saved });
    } catch (err) {
      res.status(400).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/books/:id/rollback', (req, res) => {
    try {
      let book = getBook(req.params.id);
      if (!book && req.body.book && req.body.book.id === req.params.id) {
        book = req.body.book as BookProject;
      }
      if (!book) {
        res.status(404).json({ error: '未找到指定小说工程' });
        return;
      }
      const chapterNum = Number(req.body.chapter);
      if (!chapterNum) {
        res.status(400).json({ error: '请提供有效章号' });
        return;
      }
      const updated = rollbackChapterCommit(book, chapterNum);
      res.json({ book: updated });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  // --- AI Workflow API (@google/genai server-side) ---
  app.post('/api/ai/market-scan', async (req, res) => {
    try {
      const result = await runMarketScan(req.body);
      res.json({ marketScan: result });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/generate-bible', async (req, res) => {
    try {
      const result = await runGenerateBible(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/forge-character', async (req, res) => {
    try {
      const { book, promptHint } = req.body;
      const result = await runForgeCharacter(book, promptHint || '');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/packaging', async (req, res) => {
    try {
      const { book } = req.body;
      const packaging = await runPackaging(book);
      res.json({ packaging });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/draft-contract', async (req, res) => {
    try {
      const { book, chapterNum, authorNote, existingContract } = req.body;
      const result = await runDraftContract(book, Number(chapterNum), authorNote, existingContract);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/write-chapter', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { book, contract, extraGuidance } = req.body;
      for await (const chunk of streamWriteChapter(book, contract, extraGuidance)) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: getErrMessage(err) })}\n\n`);
      res.end();
    }
  });

  app.post('/api/ai/sub-review', async (req, res) => {
    try {
      const { book, chapterItem } = req.body;
      const review = await runAiSubReview(book, chapterItem);
      res.json(review);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/bounded-revise', async (req, res) => {
    try {
      const { book, chapterItem, issuesToFix } = req.body;
      const revisedProse = await runBoundedRevise(book, chapterItem, issuesToFix);
      res.json({ prose: revisedProse });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/prepare-commit', async (req, res) => {
    try {
      const { book, chapterItem } = req.body;
      const proposal = await runPrepareCommit(book, chapterItem);
      res.json({ proposal });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/auto-chapter-bundle', async (req, res) => {
    try {
      // 省配额单次合并路径：仅当用户显式勾选「省配额单次合并请求」时才放行；
      // 默认走两步隔离（起草合同 → 盲写正文），本接口拒绝默认调用。
      if (req.body.singleRequest !== true) {
        res.status(400).json({
          error: '默认采用两步隔离（先起草合同，再盲写正文），单次合并仅在设置中显式开启「省配额单次合并请求」后可用。',
        });
        return;
      }
      const { book, chapterNum, existingContract, authorGuidance } = req.body;
      const result = await runAutoChapterBundle(
        book,
        Number(chapterNum),
        existingContract,
        authorGuidance
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/draft-ending', async (req, res) => {
    try {
      const { book } = req.body;
      const result = await runDraftEnding(book);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/arc-review', async (req, res) => {
    try {
      const { book } = req.body;
      const result = await runArcReview(book);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  app.post('/api/ai/import-manuscript', async (req, res) => {
    try {
      const importedBook = await runImportManuscript(req.body);
      const saved = saveBook(importedBook);
      res.json({ book: saved });
    } catch (err) {
      res.status(500).json({ error: getErrMessage(err) });
    }
  });

  // --- Vite Dev Middleware or Static Production ---
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Long Novel Studio server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
