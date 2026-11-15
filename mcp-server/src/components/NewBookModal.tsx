import React, { useRef, useState } from 'react';
import { ArchiveRestore, BookPlus, FileUp, Sparkles, X } from 'lucide-react';
import type { BookProject, MarketScanRecord, NovelLanguage } from '../shared/types.ts';
import { formatChapterTitle, GENRE_PACKS, LANGUAGE_SPECS } from '../shared/skillSpecs.ts';
import {
  createBookApi,
  generateBibleApi,
  importManuscriptApi,
  marketScanApi,
} from '../lib/api.ts';

interface NewBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (book: BookProject) => void;
  onImportBackupFile?: (file: File) => Promise<void>;
}

type ModalMode = 'wizard' | 'import' | 'blank' | 'backup';

export const NewBookModal: React.FC<NewBookModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  onImportBackupFile,
}) => {
  const [mode, setMode] = useState<ModalMode>('wizard');
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<NovelLanguage>('zh');
  const [genreId, setGenreId] = useState<string>('fanqie_rebirth_revenge');
  const [platform, setPlatform] = useState<string>('番茄小说 (Fanqie)');
  const [seedIdea, setSeedIdea] = useState<string>('');
  const [preferredNames, setPreferredNames] = useState<string>('');
  const [scanResult, setScanResult] = useState<MarketScanRecord | null>(null);

  // Import state
  const [importTitle, setImportTitle] = useState('');
  const [importRaw, setImportRaw] = useState('');

  // Blank state
  const [blankTitle, setBlankTitle] = useState('');
  const [blankLeadName, setBlankLeadName] = useState('');
  const [blankLeadRole, setBlankLeadRole] = useState('主角');
  const [blankPremise, setBlankPremise] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  if (!isOpen) return null;

  const handleLanguageChange = (lang: NovelLanguage) => {
    setLanguage(lang);
    const matchingGenre = GENRE_PACKS.find((g) => g.language === lang);
    if (matchingGenre) {
      setGenreId(matchingGenre.id);
      setPlatform(matchingGenre.platform);
    } else {
      setPlatform(LANGUAGE_SPECS[lang].platforms[0]);
    }
  };

  const handleRunScan = async () => {
    if (!seedIdea.trim()) {
      setErrorMsg('请先输入您的一句话故事灵感或核心设定方向');
      return;
    }
    setErrorMsg(null);
    setBusy('scan');
    try {
      const scan = await marketScanApi({
        seedIdea,
        platform,
        genreId,
        language,
        preferredNames: preferredNames.trim() || undefined,
      });
      setScanResult(scan);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateAndCreate = async () => {
    if (!seedIdea.trim()) {
      setErrorMsg('请先输入核心灵感');
      return;
    }
    setErrorMsg(null);
    setBusy('bible');
    try {
      const generated = await generateBibleApi({
        seedIdea,
        platform,
        genreId,
        language,
        marketScan: scanResult || undefined,
        preferredNames: preferredNames.trim() || undefined,
      });

      const now = new Date().toISOString();
      const firstRoadmap = generated.outline.roadmap[0];
      const newBook: BookProject = {
        id: `book-${Date.now()}`,
        title: generated.title,
        language,
        platform,
        genreId,
        formula: generated.formula,
        gate1Approved: true,
        gate2Approved: true,
        marketScan: scanResult || undefined,
        bible: generated.bible,
        outline: generated.outline,
        state: generated.state,
        chapters: [
          {
            chapter: 1,
            status: 'draft',
            updatedAt: now,
            contract: {
              chapter: 1,
              title: formatChapterTitle(
                1,
                firstRoadmap?.goal ? firstRoadmap.goal.split(/[，。；：]/)[0].slice(0, 16) : '',
                language
              ),
              language,
              desire: 'auto',
              desirePayoff: firstRoadmap?.goal || generated.bible.premise,
              payoffSize: 'auto',
              hook:
                firstRoadmap?.hook && firstRoadmap.hook.length >= 10
                  ? firstRoadmap.hook
                  : `${generated.outline.compass.centralQuestion || generated.bible.premise}（悬念初现）`,
              transition: '开篇第一幕，承接后续主线冲突展开',
              mustHappen: firstRoadmap?.goal || generated.bible.premise,
              mustNot: '不可违背圣经硬约束',
              characters: generated.bible.characters.slice(0, 3).map((c) => c.name),
              foreshadowingPlanted: generated.state.foreshadowing[0]?.id
                ? [generated.state.foreshadowing[0].id]
                : [],
              foreshadowingPaid: [],
              isProbe: false,
            },
            prose: '',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const saved = await createBookApi(newBook);
      onCreated(saved);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleImportManuscript = async () => {
    if (!importRaw.trim()) {
      setErrorMsg('请粘贴您已有的旧稿文本（至少 1 章）');
      return;
    }
    setErrorMsg(null);
    setBusy('import');
    try {
      const book = await importManuscriptApi({
        title: importTitle.trim(),
        language,
        platform,
        rawText: importRaw,
      });
      onCreated(book);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleCreateBlank = async () => {
    const cleanLead = blankLeadName.trim();
    if (!blankTitle.trim() || !blankPremise.trim() || !cleanLead) {
      setErrorMsg('请输入书名、主角姓名与一句话核心前提（人物名称需由您自定义，不使用固定默认值）');
      return;
    }
    setErrorMsg(null);
    setBusy('blank');
    try {
      const now = new Date().toISOString();
      const blankBook: BookProject = {
        id: `book-${Date.now()}`,
        title: blankTitle.trim(),
        language,
        platform,
        genreId,
        formula: 'custom-long-serial',
        gate1Approved: true,
        gate2Approved: true,
        bible: {
          premise: blankPremise.trim(),
          era: language === 'zh' ? '待定时代' : 'Contemporary',
          setting: '请在此补充核心舞台与空间关系',
          worldRules: '请填写什么可能、什么绝对不可能',
          locations: ['主舞台地点 1'],
          hardConstraints: ['死去的人不复活；任何角色不得提前知道未告知的信息。'],
          cultureAnchors: {
            clothing: '待补充',
            food: '待补充',
            objects: '待补充',
            landscape: '待补充',
            colour: '待补充',
          },
          voice: {
            narrator: '克制写实，多写动作与对白',
            dialogueDistinctness: '为每位主要角色设计不同句长与口癖',
            customBanned: [],
          },
          characters: [
            {
              id: `char-${Date.now()}-lead`,
              name: cleanLead,
              age: '24',
              role: blankLeadRole.trim() || (language === 'zh' ? '核心人物' : 'Lead'),
              dna: '待补充外貌、主色调与信物',
              want: '明确表层目标',
              need: '深层成长需求',
              flaw: '核心性格缺陷',
              arc: '贯穿全卷的蜕变弧线',
            },
          ],
        },
        outline: {
          compass: {
            endDirection: '待补充终局方向',
            activeLongThreads: 'F01',
            scaleEstimate: '120–180 章',
            centralQuestion: blankPremise.trim(),
            whatBookIsNot: '不写与核心前提冲突的水字桥段',
          },
          currentArc: {
            rangeLabel: '第 1–30 章',
            goal: '完成开篇黄金三章并站稳核心冲突',
            beats: ['第 1 章破局入戏', '第 2 章推进矛盾', '第 3 章首次小高潮'],
            payoff: '第 3 章小兑现',
            newElementsNote: '每卷至多新增 1 处核心新地点',
          },
          roadmap: [
            {
              chapter: 1,
              goal: '开篇建立核心危机与反差',
              desire: 'curiosity',
              hook: `${blankPremise.trim()}——第一夜的异常才刚刚浮现`,
              status: 'draft',
            },
          ],
        },
        state: {
          committedChapters: [],
          nextChapter: 1,
          summaries: [],
          characterStates: [
            {
              characterName: cleanLead,
              currentState: `${blankLeadRole.trim() || '核心人物'}，开篇待启`,
            },
          ],
          foreshadowing: [],
          knows: [],
          timeline: [],
        },
        chapters: [
          {
            chapter: 1,
            status: 'draft',
            updatedAt: now,
            contract: {
              chapter: 1,
              title: formatChapterTitle(1, '', language),
              language,
              desire: 'auto',
              desirePayoff: blankPremise.trim(),
              payoffSize: 'auto',
              hook: `${blankPremise.trim()}——危机在第一夜骤然降临`,
              transition: '开篇第一幕',
              mustHappen: blankPremise.trim(),
              mustNot: '不可违背圣经硬约束',
              characters: [cleanLead],
              foreshadowingPlanted: [],
              foreshadowingPaid: [],
              isProbe: false,
            },
            prose: '',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      const saved = await createBookApi(blankBook);
      onCreated(saved);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-book-modal-title"
    >
      <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Editorial Artwork Banner */}
        <div className="relative h-36 bg-zinc-100 overflow-hidden">
          {!heroImgFailed ? (
            <img
              src="/src/assets/images/editorial_writing_desk_1794547810669.jpg"
              alt="静谧的作家创作书桌"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-zinc-800" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent flex items-end justify-between p-5">
            <div>
              <h2 id="new-book-modal-title" className="font-display text-xl font-semibold text-white">
                开启新长篇小说工程
              </h2>
              <p className="text-xs text-zinc-200 mt-0.5">
                先定圣经与大纲（Gate 1），再写黄金三章（Gate 2），全程文件当真相
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭窗口"
              className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Mode Tabs */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setMode('wizard')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                mode === 'wizard' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'
              }`}
            >
              Step 0 扫榜立项 → 圣经
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                mode === 'import' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'
              }`}
            >
              Step 5 简版旧稿导入
            </button>
            <button
              type="button"
              onClick={() => setMode('blank')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                mode === 'blank' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'
              }`}
            >
              空白模板建书
            </button>
            {onImportBackupFile && (
              <button
                type="button"
                onClick={() => setMode('backup')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                  mode === 'backup' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'
                }`}
              >
                恢复 .json 备份
              </button>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-900 rounded-lg text-xs">
              {errorMsg}
            </div>
          )}

          {mode === 'backup' && onImportBackupFile && (
            <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  从本地 .json 备份文件恢复小说工程与去 AI 味配置
                </h3>
                <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                  支持恢复此前导出的 <code className="font-mono">long-novel-studio-backup</code> 完整备份文件，导入后将自动合并至当前工作台并写入本地浏览器持久缓存与服务端文件目录。
                </p>
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => backupInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <ArchiveRestore className="w-4 h-4" />
                  <span>{busy === 'backup' ? '正在导入恢复...' : '选择 .json 备份文件'}</span>
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setErrorMsg(null);
                    setBusy('backup');
                    try {
                      await onImportBackupFile(file);
                      onClose();
                    } catch (err) {
                      setErrorMsg(err instanceof Error ? err.message : String(err));
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Language & Platform shared row */}
          {mode !== 'backup' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">语言</label>
                <select
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value as NovelLanguage)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white"
                >
                  <option value="zh">中文 (2000–4000 字/章)</option>
                  <option value="en">English (1500–2500 words/ch)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">首发平台</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white"
                >
                  {LANGUAGE_SPECS[language].platforms.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {mode !== 'import' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">题材预设包</label>
                  <select
                    value={genreId}
                    onChange={(e) => setGenreId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white"
                  >
                    {GENRE_PACKS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {mode === 'wizard' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  输入您的一句话小说创意 / 核心设定方向
                </label>
                <textarea
                  rows={3}
                  value={seedIdea}
                  onChange={(e) => setSeedIdea(e.target.value)}
                  placeholder="例如：女法医重生回十年前一桩悬案发生前夜，手握只有她知道的尸检时间差证据，联手冷面刑侦队长追查连环凶手。"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  自定义角色姓名偏好（可选，留空由 AI 按题材与时代动态命名并避开撞名）
                </label>
                <input
                  type="text"
                  value={preferredNames}
                  onChange={(e) => setPreferredNames(e.target.value)}
                  placeholder="例如：女主想姓许，男主想偏冷僻双字名；或直接写出指定姓名"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={handleRunScan}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{busy === 'scan' ? '扫榜拆文中...' : '1. 执行 Step 0 扫榜拆文'}</span>
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={handleGenerateAndCreate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <BookPlus className="w-4 h-4" />
                  <span>
                    {busy === 'bible' ? '生成圣经与大纲中...' : '2. 生成 Step 1 故事圣经并建书'}
                  </span>
                </button>
              </div>

              {scanResult && (
                <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl text-xs space-y-2">
                  <div className="font-semibold text-zinc-900">Step 0 扫榜结论证据</div>
                  <div>
                    <strong>平台趋势：</strong>
                    {scanResult.trendSummary}
                  </div>
                  <div>
                    <strong>钩子公式：</strong>
                    {scanResult.hookFormula}
                  </div>
                  <div>
                    <strong>书名与人名方向：</strong>
                    {scanResult.titleDirection} · {scanResult.namingNotes}
                  </div>
                  <div className="text-amber-800">
                    <strong>风控提示：</strong>
                    {scanResult.riskWarnings.join('；')}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'import' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  旧稿书名（可选，留空由 AI 从文稿识别）
                </label>
                <input
                  type="text"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="例如：暗巷来信"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  粘贴既有章节正文（支持 1–5 章，AI 将反推出圣经、Knows 边界与伏笔台账提案）
                </label>
                <textarea
                  rows={8}
                  value={importRaw}
                  onChange={(e) => setImportRaw(e.target.value)}
                  placeholder="第1章 ...&#10;&#10;第2章 ..."
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg font-prose"
                />
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={handleImportManuscript}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <FileUp className="w-4 h-4" />
                  <span>{busy === 'import' ? '反推重建正史中...' : '导入并反推故事圣经提案'}</span>
                </button>
              </div>
            </div>
          )}

          {mode === 'blank' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">书名</label>
                  <input
                    type="text"
                    value={blankTitle}
                    onChange={(e) => setBlankTitle(e.target.value)}
                    placeholder="输入书名"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    核心人物姓名（必填）
                  </label>
                  <input
                    type="text"
                    value={blankLeadName}
                    onChange={(e) => setBlankLeadName(e.target.value)}
                    placeholder="自定义角色姓名（禁止默认值）"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    角色定位
                  </label>
                  <input
                    type="text"
                    value={blankLeadRole}
                    onChange={(e) => setBlankLeadRole(e.target.value)}
                    placeholder="例如：女法医 / 破局者"
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  一句话核心前提 (Premise)
                </label>
                <textarea
                  rows={3}
                  value={blankPremise}
                  onChange={(e) => setBlankPremise(e.target.value)}
                  placeholder="这本书一句话讲了一个什么故事？"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={handleCreateBlank}
                  className="px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {busy === 'blank' ? '创建中...' : '从空白模板创建工程'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
