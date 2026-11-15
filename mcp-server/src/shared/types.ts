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

export type ForeshadowingStatus = 'open' | 'progressing' | 'paid' | 'deferred';

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

export interface BookProject {
  id: string;
  title: string;
  language: NovelLanguage;
  platform: string;
  genreId: string;
  formula: string;
  gate1Approved: boolean;
  gate2Approved: boolean;
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

