export interface MuseTask {
  kind: string;
  title: string;
  systemInstruction: string;
  prompt: string;
  expectedOutput: string;
  bookTitle?: string;
  chapter?: number;
}

export type NovelLanguage = 'zh' | 'en';

export type DesireKey =
  | 'curiosity'
  | 'identification-upgrade'
  | 'revenge-compensation'
  | 'being-loved'
  | 'escape-comfort'
  | 'survival-breakout'
  | 'power-scheme'
  | 'bond-resonance';

export type ContractDesireSetting = DesireKey | 'auto';

export type PayoffSize = 'auto' | 'small' | 'big' | 'none';

export type ForeshadowingStatus = 'open' | 'progressing' | 'paid' | 'deferred' | 'archived';

export type ForeshadowingScope = 'series' | 'volume' | 'episode';

export type ForeshadowingKind = 'reveal' | 'conflict' | 'relationship' | 'other';

export type ChapterKind = 'main' | 'epilogue' | 'extra';

export type ChapterStatus = 'draft' | 'committed';

export interface CharacterProfile {
  id: string;
  name: string;
  age: string;
  role: string;
  dna: string;
  want: string;
  need: string;
  flaw: string;
  arc: string;
  speechStyle?: string;
  debutPlan?: string;
  introducedChapter?: number;
  /** 临时出场配角：合同选项卡由 AI 判定锻造，仅为本章出场服务；圣经页锻造的为常驻角色。 */
  temporary?: boolean;
}

export interface KnowsEntry {
  id: string;
  characterName: string;
  fact: string;
  learnedChapter: number | null; // null means explicitly does NOT know
  knows: boolean;
  note?: string;
}

export interface ForeshadowingThread {
  id: string; // e.g. F01
  planted: number;
  payoffDue: number;
  status: ForeshadowingStatus;
  thread: string;
  paidChapter?: number;
  targetChapter?: number;
  deferReason?: string;
  /** 伏笔级别：series 全书主线 / volume 卷级 / episode 单集线（本章内开合）。v1 默认 'series'。 */
  scope?: ForeshadowingScope;
  /** 伏笔类型（提交提取时 AI 自动标定，仅展示与 triage 提示用）。 */
  kind?: ForeshadowingKind;
}

export interface CultureAnchors {
  clothing: string;
  food: string;
  objects: string;
  landscape: string;
  colour: string;
}

export interface VoiceConfig {
  narrator: string;
  dialogueDistinctness: string;
  customBanned: string[];
}

export interface BibleData {
  premise: string;
  era: string;
  setting: string;
  worldRules: string;
  locations: string[];
  hardConstraints: string[];
  cultureAnchors: CultureAnchors;
  voice: VoiceConfig;
  characters: CharacterProfile[];
}

export interface OutlineRoadmapRow {
  chapter: number;
  goal: string;
  desire: DesireKey;
  hook: string;
  status: ChapterStatus | 'planned';
}

export interface OutlineData {
  compass: {
    endDirection: string;
    activeLongThreads: string;
    scaleEstimate: string;
    centralQuestion: string;
    whatBookIsNot: string;
    /** 目标完结章数；新建长篇默认 100；可随时修改或清空（清空即退化为无终点模式）。 */
    targetChapters?: number;
    /** 浮动半宽；未填时按手册 §三.2 自动推导（T>=50 为 10，否则 max(1, roundHalfUp(0.1T))）。 */
    tolerance?: number;
    /** 一句话核心结局，供起草合同、阶段复盘与收官提示参考（绝不进正文提示词）。 */
    endingSummary?: string;
    /** 完整终局蓝图（3 落点），可留空或由 AI 拟草案，随时可改（绝不进正文提示词）。 */
    plannedEnding?: string;
    /** 短篇模式用目标总字数（5000 / 10000 / 20000 或自定义）。 */
    targetWords?: number;
  };
  currentArc: {
    rangeLabel: string;
    goal: string;
    beats: string[];
    payoff: string;
    newElementsNote: string;
  };
  roadmap: OutlineRoadmapRow[];
}

export interface ChapterSummaryEntry {
  chapter: number;
  summary: string;
}

export interface TimelineEntry {
  chapter: number;
  dayLabel: string;
  event: string;
}

export interface CharacterStateEntry {
  characterName: string;
  currentState: string;
}

export interface BookStateData {
  committedChapters: number[];
  nextChapter: number;
  summaries: ChapterSummaryEntry[];
  characterStates: CharacterStateEntry[];
  foreshadowing: ForeshadowingThread[];
  knows: KnowsEntry[];
  timeline: TimelineEntry[];
}

export interface ChapterContract {
  chapter: number;
  title: string;
  language: NovelLanguage;
  desire: ContractDesireSetting;
  desirePayoff: string;
  payoffSize: PayoffSize;
  hook: string;
  transition: string;
  mustHappen: string;
  mustNot: string;
  characters: string[];
  foreshadowingPlanted: string[];
  foreshadowingPaid: string[];
  isProbe?: boolean;
  /** 章类型：main 主线正篇；完结后创建的后记/番外为 epilogue / extra（缺省即 main）。 */
  chapterKind?: ChapterKind;
  /** 本章提交时记录的 bigCadence 快照，防止中途调小 T 导致历史已提交章被回溯判错。 */
  bigCadenceSnapshot?: number;
}

export interface ChapterItem {
  chapter: number;
  status: ChapterStatus;
  contract: ChapterContract;
  prose: string;
  updatedAt: string;
}

export interface PackagingInfo {
  titleCandidates: string[];
  selectedTitle: string;
  coverBrief: string;
  blurb: string;
  keywords: string[];
  coverImageUrl?: string;
}

export interface MarketScanRecord {
  platform: string;
  genreId: string;
  seedIdea: string;
  trendSummary: string;
  hookFormula: string;
  titleDirection: string;
  namingNotes: string;
  riskWarnings: string[];
}

/** 分卷结构预留（v1 留接口，v2 启用）。v1 阶段函数签名即为三参形式，固定传 startChapter=1。 */
export interface VolumeSpec {
  id: string;
  number: number;
  title: string;
  targetChapters: number;
  startChapter: number;
  status: 'active' | 'completed' | 'archived';
  volumeQuestion: string;
  endingSummary?: string;
}

/** 调整卷纲快照（每次改 target / 容差 / 结局 / 卷配置前存一份，可一键恢复）。 */
export interface RestructureSnapshot {
  targetChapters?: number;
  tolerance?: number;
  plannedEnding?: string;
  endingSummary?: string;
  threads: { id: string; payoffDue: number; status: ForeshadowingStatus }[];
}

export interface RestructureLogEntry {
  at: string;
  kind: 'retarget' | 'restore';
  before: RestructureSnapshot;
  after: RestructureSnapshot;
  note?: string;
}

/** 续作种子 JSON（手册 §八.4）。 */
export interface SequelSeed {
  seedVersion: 1;
  sourceBookId: string;
  sourceBookTitle: string;
  language: NovelLanguage;
  genreId: string;
  completedAtChapter?: number;
  endingSummary?: string;
  worldRules?: string;
  hardConstraints?: string[];
  survivingCharacters: { name: string; role: string; dna: string; lastState: string }[];
  unresolvedThreads: { id: string; thread: string; scope: ForeshadowingScope; kind?: ForeshadowingKind }[];
}

export interface BookProject {
  id: string;
  title: string;
  language: NovelLanguage;
  platform: string;
  genreId: string;
  formula: string;
  gate1Approved: boolean;
  gate2Approved: boolean;
  /** 书状态；仅作者在 Gate 3 确认后改为 'completed'。缺省即 'ongoing'（老书兼容）。 */
  bookStatus?: 'ongoing' | 'completed';
  /** 完结确认时的最后主线章号；用于区分番外/后记与删章恢复。 */
  completedAtChapter?: number;
  /** 乐观锁版本号；每次修改 targetChapters / tolerance / plannedEnding / endingSummary / volumes 时 +1。缺省即 1。 */
  outlineRevision?: number;
  /** 调整卷纲快照日志（可恢复）。 */
  restructureLog?: RestructureLogEntry[];
  /** 分卷结构（v1 留接口，v2 启用）。 */
  volumes?: VolumeSpec[];
  marketScan?: MarketScanRecord;
  packaging?: PackagingInfo;
  bible: BibleData;
  outline: OutlineData;
  state: BookStateData;
  chapters: ChapterItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditIssue {
  id: string;
  dimension:
    | 'canon'
    | 'character_voice'
    | 'timeline'
    | 'knows'
    | 'foreshadowing'
    | 'hook_desire'
    | 'pacing'
    | 'prose_deslop'
    | 'length'
    | 'contract';
  severity: 'blocking' | 'warning';
  source: 'deterministic' | 'ai_review';
  message: string;
  citation?: string;
  suggestion?: string;
}

export interface AuditReport {
  chapter: number;
  passed: boolean;
  blockingCount: number;
  warningCount: number;
  proseSize: number;
  sizeUnit: 'chars' | 'words';
  issues: AuditIssue[];
  aiSummary?: string;
  checkedAt: string;
}

export interface ForeshadowingProgressUpdate {
  id: string;
  status: 'progressing' | 'deferred';
  newPayoffDue: number;
  note?: string;
}

export interface CommitProposal {
  chapter: number;
  summaryLine: string;
  timelineDayLabel: string;
  timelineEvent: string;
  characterStateUpdates: CharacterStateEntry[];
  newKnowsEntries: Omit<KnowsEntry, 'id'>[];
  newForeshadowing: ForeshadowingThread[];
  paidForeshadowingIds: string[];
  updatedForeshadowing?: ForeshadowingProgressUpdate[];
  newCharacters?: Omit<CharacterProfile, 'id'>[];
}

export interface GenrePackSpec {
  id: string;
  label: string;
  language: NovelLanguage;
  platform: string;
  formula: string;
  lengthLabel: string;
  primaryDesires: DesireKey[];
  hookTypes: string[];
  payoffShape: string;
  risks: string[];
  notes: string;
}

export interface LanguageSpec {
  code: NovelLanguage;
  name: string;
  minSize: number;
  maxSize: number;
  probeMinSize: number;
  unit: 'chars' | 'words';
  unitLabel: string;
  hookFirstWindow: number;
  paragraphStyle: string;
  tokenBudgetPerChapter: number;
  platforms: string[];
}

/** 调整卷纲（改 target / 容差）输入：服务端原子校验 + 快照。 */
export interface RetargetThreadResolution {
  id: string;
  action: 'compress' | 'archive' | 'keep';
  newPayoffDue?: number;
}

export interface RetargetInput {
  targetChapters: number;
  tolerance?: number;
  plannedEnding?: string;
  endingSummary?: string;
  threadResolutions: RetargetThreadResolution[];
  note?: string;
}

export interface DeletedBookTrashItem {
  trashId: string;
  kind: 'book';
  deletedAt: string;
  book: BookProject;
}

export interface DeletedChapterTrashItem {
  trashId: string;
  kind: 'chapter';
  deletedAt: string;
  bookId: string;
  bookTitle: string;
  chapter: ChapterItem;
}

export type TrashItem = DeletedBookTrashItem | DeletedChapterTrashItem;

