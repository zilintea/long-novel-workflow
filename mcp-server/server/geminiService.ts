import { GoogleGenAI, Type } from '@google/genai';
import type {
  AuditIssue,
  BookProject,
  ChapterContract,
  ChapterItem,
  CharacterProfile,
  CommitProposal,
  DesireKey,
  ForeshadowingProgressUpdate,
  ForeshadowingThread,
  MarketScanRecord,
  PackagingInfo,
  PayoffSize,
} from '../src/shared/types.ts';
import {
  allocateNextForeshadowingId,
  DEFAULT_SLOP_LIST,
  DESIRE_SPECS,
  formatChapterTitle,
  GENRE_PACKS,
  LANGUAGE_SPECS,
} from '../src/shared/skillSpecs.ts';
import { bigCadenceFor, effectiveTolerance, getPhaseInfo } from '../src/shared/phase.ts';

// 终局规划辅助（手册 §四、§六）：合同起草用的动态大节奏规则 + 罗盘目标摘要。
function cadenceRule(book: BookProject, chapterNum: number): string {
  const target = book.outline.compass.targetChapters;
  const cadence = bigCadenceFor(target);
  if (cadence == null) {
    return target == null
      ? `本书未设目标章数（老书退化）：沿用旧规则，第 ${chapterNum} 章是 10 的倍数卷节点时 payoffSize 必须为 "big"。`
      : `本书目标 ${target} 章（短篇/中篇分支）：不设大兑现节点，payoffSize 按 3 章小节奏自主选择 small。`;
  }
  return `本书目标 ${target} 章，动态大节奏 bigCadence=${cadence}：第 ${chapterNum} 章${
    chapterNum % cadence === 0 ? `是 ${cadence} 的倍数大节点，payoffSize 必须为 "big"` : `不是大节点，按 3 章小节奏自主选择`
  }。`;
}

function targetSummaryLine(book: BookProject): string {
  const c = book.outline.compass;
  if (c.targetChapters == null) return '本书未设目标章数（自由连载）。';
  const tol = effectiveTolerance(c.targetChapters, c.tolerance);
  return `本书目标 ${c.targetChapters} 章（±${tol}，收官窗口 ${c.targetChapters - tol}–${c.targetChapters + tol} 章）${
    c.targetWords != null ? `，短篇目标 ${c.targetWords} 字` : ''
  }。`;
}

const ALL_DESIRE_KEYS_LIST = Object.keys(DESIRE_SPECS).join(' / ');
const ALL_DESIRE_GUIDE = Object.values(DESIRE_SPECS)
  .map((d) => `${d.key}(${d.labelZh}: ${d.description})`)
  .join('；');

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const PRIMARY_PROSE_MODEL = 'gemini-4-hydrogen';
const FALLBACK_LITE_MODEL = 'gemini-3.1-flash-lite';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRawErrText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = getRawErrText(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE')
  );
}

function formatRetryDelayLabel(rawMsg: string): string {
  const match = rawMsg.match(/"retryDelay"\s*:\s*"(\d+)s"/i) || rawMsg.match(/retry in\s+([^\n."]+)/i);
  if (!match) return '稍后';
  const raw = match[1];
  const secs = Number(raw);
  if (!Number.isNaN(secs) && secs > 0) {
    if (secs >= 3600) {
      const h = Math.floor(secs / 3600);
      const m = Math.round((secs % 3600) / 60);
      return `约 ${h} 小时 ${m} 分钟`;
    }
    if (secs >= 60) {
      return `约 ${Math.ceil(secs / 60)} 分钟`;
    }
    return `${secs} 秒`;
  }
  return raw;
}

function formatFriendlyGeminiError(err: unknown): Error {
  const msg = getRawErrText(err);
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
    const waitLabel = formatRetryDelayLabel(msg);
    return new Error(
      `API 请求配额已达上限（429 RESOURCE_EXHAUSTED）：当前免费版 Key 的每日请求限额已用尽（如 gemini-4-hydrogen 免费版限额 20 次/天）。请在 AI Studio 右上角「Settings > Secrets」配置已开通计费（Pay-as-you-go）的 API Key 以提升配额，或等待 ${waitLabel} 后重试。`
    );
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
    return new Error(
      'Gemini API Key 无效或无权限（403/400），请在 AI Studio 的「Settings > Secrets」面板检查并重新设置 API Key。'
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

async function callGenerateContent(
  params: {
    contents: string;
    config?: Record<string, unknown>;
  },
  preferLite = false
) {
  const ai = getAiClient();
  const primary = preferLite ? FALLBACK_LITE_MODEL : PRIMARY_PROSE_MODEL;
  const secondary = preferLite ? PRIMARY_PROSE_MODEL : FALLBACK_LITE_MODEL;

  try {
    return await ai.models.generateContent({
      model: primary,
      contents: params.contents,
      config: params.config as any,
    });
  } catch (err) {
    if (!isQuotaOrRateLimitError(err)) {
      throw formatFriendlyGeminiError(err);
    }
    // Brief backoff then switch to alternate model quota bucket
    await sleep(600);
    try {
      return await ai.models.generateContent({
        model: secondary,
        contents: params.contents,
        config: params.config as any,
      });
    } catch (err2) {
      throw formatFriendlyGeminiError(err2);
    }
  }
}

async function* callGenerateContentStream(params: {
  contents: string;
  config?: Record<string, unknown>;
}): AsyncGenerator<string> {
  const ai = getAiClient();
  const modelsToTry = [PRIMARY_PROSE_MODEL, FALLBACK_LITE_MODEL];
  let lastErr: unknown = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let yieldedAny = false;
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents: params.contents,
        config: params.config as any,
      });
      for await (const chunk of stream) {
        if (chunk.text) {
          yieldedAny = true;
          yield chunk.text;
        }
      }
      return;
    } catch (err) {
      lastErr = err;
      if (yieldedAny || !isQuotaOrRateLimitError(err) || i === modelsToTry.length - 1) {
        throw formatFriendlyGeminiError(err);
      }
      await sleep(600);
    }
  }
  if (lastErr) throw formatFriendlyGeminiError(lastErr);
}

function parseJsonSafe<T>(raw: string | undefined, fallbackMsg: string): T {
  if (!raw) throw new Error(fallbackMsg);
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(fallbackMsg);
  }
}

function buildNamingConstraint(language: 'zh' | 'en', preferredNames?: string): string {
  const baseRule =
    language === 'zh'
      ? '【人物命名铁律】严禁使用固定编码、示例名或高频 AI 撞名（明确禁止：沈昭、陆明远、顾言舟、林默、陈默、顾沉、陆霆骁、苏清颜、苏晚、叶尘、萧炎、林浅、主角）。必须结合本作时代、地域、阶层与人物性格现造自然可信且姓氏、音节各不相同的姓名。'
      : 'Character Naming Rule: Never reuse sample names or overused AI cliché names (strictly avoid: Elena, Marcus, Vance, Thorne, Kaelen, Aria, Lyra, Julian, Protagonist). Craft culturally grounded, distinct names with varied surnames and syllables.';
  return preferredNames && preferredNames.trim()
    ? `${baseRule}\n作者指定优先采用的人物名称：${preferredNames.trim()}`
    : baseRule;
}

const GENERIC_PLACEHOLDER_NAME_RE =
  /^(黑衣人|神秘人|陌生人|路人|过路人|行人|群众|围观者|侍卫|护卫|士兵|家丁|管家|掌柜|店小二|小二|老板|老者|老头|老妇|少女|少年|男子|女子|男人|女人|杀手|刺客|打手|保镖|医生|大夫|护士|秘书|助理|司机|主角|反派|男主|女主|配角|龙套|甲|乙|丙|丁|某人|无名|unknown|stranger|guard|assassin|passerby|protagonist|waiter|doctor)[0-9一二三四五六七八九十甲乙丙丁]*$/i;

function isPlaceholderCharacterName(rawName: string): boolean {
  const clean = rawName.trim();
  if (!clean) return true;
  if (GENERIC_PLACEHOLDER_NAME_RE.test(clean)) return true;
  if (/^(某|第[一二三四五五六七八九十\d]+号|未知)/.test(clean)) return true;
  return false;
}

function buildCastRosterPromptContext(book: BookProject, chapterNum: number): string {
  const previousChapters = book.chapters
    .filter((c) => c.chapter < chapterNum)
    .sort((a, b) => a.chapter - b.chapter);

  const lines = book.bible.characters.map((c, idx) => {
    const stateObj = book.state.characterStates.find((cs) => cs.characterName === c.name);
    let lastAppeared = 0;
    for (const ch of previousChapters) {
      if (ch.contract.characters.includes(c.name) || (ch.prose && ch.prose.includes(c.name))) {
        lastAppeared = ch.chapter;
      }
    }
    const gap = chapterNum > 1 ? chapterNum - 1 - lastAppeared : 0;
    const attendanceTag =
      idx === 0
        ? '核心人物'
        : lastAppeared === 0
        ? chapterNum >= 2
          ? `待切入新角色！${c.debutPlan ? `预设切入方案：${c.debutPlan}` : '建议结合当前剧情冲突顺势安排入戏互动'}`
          : `待出场${c.debutPlan ? `（切入方案：${c.debutPlan}）` : ''}`
        : gap >= 2
        ? `上次出场 Ch${lastAppeared}（已缺席 ${gap} 章，建议适时召回或交代动向）`
        : `近期活跃（Ch${lastAppeared} 出场）`;
    const voicePart = c.speechStyle ? ` | 腔调: ${c.speechStyle}` : '';
    return `- ${c.name}（${c.age}，${c.role}）[调度状态：${attendanceTag}] | DNA: ${c.dna}${voicePart} | Want: ${c.want} | 当前状态: ${stateObj?.currentState || '初始待命'}`;
  });

  return [
    `【全书已登记人物花名册（含近期出场节奏与待切入角色，共 ${book.bible.characters.length} 人）】`,
    lines.length > 0 ? lines.join('\n') : '暂无已登记角色',
  ].join('\n');
}

function sanitizeNewCharacters(
  book: BookProject,
  rawNewChars: unknown,
  chapterNum: number
): Omit<CharacterProfile, 'id'>[] {
  const existingNames = new Set(book.bible.characters.map((c) => c.name.trim()));
  const seen = new Set<string>();
  const cleaned: Omit<CharacterProfile, 'id'>[] = [];

  for (const item of Array.isArray(rawNewChars) ? rawNewChars : []) {
    if (!item || typeof item !== 'object') continue;
    const rawName = String((item as any).name || '').trim();
    if (!rawName || rawName.length > 24) continue;
    if (isPlaceholderCharacterName(rawName)) continue;
    if (existingNames.has(rawName) || seen.has(rawName)) continue;

    seen.add(rawName);
    const speechStyle = String((item as any).speechStyle || '').trim();
    const debutPlan = String((item as any).debutPlan || '').trim();
    cleaned.push({
      name: rawName,
      age: String((item as any).age || '').trim() || '未知年龄',
      role: String((item as any).role || '').trim() || '重要配角',
      dna: String((item as any).dna || '').trim() || '衣着与随身特征鲜明',
      want: String((item as any).want || '').trim() || '在本场冲突中保全自身利益',
      need: String((item as any).need || '').trim() || '面对局势变化做出抉择',
      flaw: String((item as any).flaw || '').trim() || '各有执念或算计',
      arc: String((item as any).arc || '').trim() || `第 ${chapterNum} 章登场后的阶段轨迹`,
      ...(speechStyle ? { speechStyle } : {}),
      ...(debutPlan ? { debutPlan } : {}),
      introducedChapter: chapterNum,
    });
  }

  return cleaned;
}

function stripLeadingFrontmatter(prose: string): string {
  const trimmed = prose.trim();
  if (trimmed.startsWith('---')) {
    const endIdx = trimmed.indexOf('\n---', 3);
    if (endIdx !== -1) {
      return trimmed.slice(endIdx + 4).trim();
    }
  }
  return trimmed;
}

function buildForeshadowingPromptContext(book: BookProject, chapterNum: number) {
  const openOrProgressing = book.state.foreshadowing.filter(
    (f) => f.status === 'open' || f.status === 'progressing'
  );
  const overdueOrTargeted = openOrProgressing.filter(
    (f) => f.targetChapter === chapterNum || chapterNum >= f.payoffDue
  );
  const approaching = openOrProgressing.filter(
    (f) =>
      !overdueOrTargeted.includes(f) && f.payoffDue > chapterNum && f.payoffDue - chapterNum <= 2
  );
  const normalOpen = openOrProgressing.filter(
    (f) => !overdueOrTargeted.includes(f) && !approaching.includes(f)
  );
  const alreadyPaid = book.state.foreshadowing.filter((f) => f.status === 'paid');
  const nextSuggestedId = allocateNextForeshadowingId(book.state.foreshadowing.map((f) => f.id));

  const sections: string[] = [];

  if (overdueOrTargeted.length > 0) {
    sections.push(
      `【重要：已逾期 / 指定本章引入的伏笔（第 ${chapterNum} 章必须明确处理，不可遗漏）】\n` +
        overdueOrTargeted
          .map((f) => {
            const tag =
              f.targetChapter === chapterNum
                ? `作者指定第 ${chapterNum} 章引入`
                : `已逾期！埋于第 ${f.planted} 章，原定第 ${f.payoffDue} 章兑现`;
            return `- ${f.id} [${tag}]：${f.thread}`;
          })
          .join('\n') +
        `\n处置要求：上述每条伏笔必须二选一处理：(A) 在本章安排引入并推进/兑现（写入 mustHappen；若本章彻底揭晓则写入 foreshadowingPaid/paidForeshadowingIds，若仅推进未全收则通过 updatedForeshadowing 将其状态设为 progressing 并顺延 newPayoffDue > ${chapterNum}）；(B) 若本章场景确实冲突，必须在 updatedForeshadowing 设为 deferred 并写明顺延章号与理由。`
    );
  }

  if (approaching.length > 0) {
    sections.push(
      `【临近到期伏笔】\n` +
        approaching
          .map((f) => `- ${f.id} (埋于 Ch${f.planted}，约定 Ch${f.payoffDue} 兑现)：${f.thread}`)
          .join('\n')
    );
  }

  sections.push(
    `【其余未结伏笔台账（仅可从此列或上述逾期列表中选用 ID 进行兑现）】\n` +
      (normalOpen.length > 0
        ? normalOpen
            .map((f) => `- ${f.id} [${f.status}] (planted:${f.planted}, due:${f.payoffDue}): ${f.thread}`)
            .join('\n')
        : '暂无其余未结伏笔')
  );

  if (alreadyPaid.length > 0) {
    sections.push(
      `【已完结 (paid) 伏笔（切勿重复兑现或篡改）】：` +
        alreadyPaid.map((f) => `${f.id}(${f.thread})`).join('；')
    );
  }

  sections.push(
    `【严禁凭空产生伪伏笔】\n` +
      `1. foreshadowingPaid / paidForeshadowingIds 只能填写【台账中已存在且未 paid】的 ID，严禁编造台账外的新编号！\n` +
      `2. 严禁在正文中将前文（摘要/台账）从未埋设过的事物写成“早有伏笔/上一章提到的线索”。\n` +
      `3. 若本章确实在正文中新埋伏笔，新 ID 必须从 ${nextSuggestedId} 起顺延，严禁复用已有 ID。`
  );

  return {
    text: sections.join('\n\n'),
    overdueOrTargeted,
    nextSuggestedId,
  };
}

function sanitizeContractForeshadowing(
  book: BookProject,
  chapterNum: number,
  rawPlanted: unknown,
  rawPaid: unknown
): { foreshadowingPlanted: string[]; foreshadowingPaid: string[] } {
  const existingMap = new Map(book.state.foreshadowing.map((f) => [f.id.trim().toUpperCase(), f]));
  const existingKeys = new Set(existingMap.keys());

  const cleanPaid: string[] = [];
  const seenPaid = new Set<string>();
  for (const item of Array.isArray(rawPaid) ? rawPaid : []) {
    const key = String(item || '').trim().toUpperCase();
    if (!key || seenPaid.has(key)) continue;
    const match = existingMap.get(key);
    if (match && match.status !== 'paid') {
      seenPaid.add(key);
      cleanPaid.push(match.id);
    }
  }

  const cleanPlanted: string[] = [];
  const reserved = new Set<string>();
  for (const item of Array.isArray(rawPlanted) ? rawPlanted : []) {
    const rawId = String(item || '').trim();
    if (!rawId) continue;
    const upper = rawId.toUpperCase();
    const existing = existingMap.get(upper);
    if ((existing && existing.planted !== chapterNum) || reserved.has(upper)) {
      const freshId = allocateNextForeshadowingId(existingKeys, reserved);
      reserved.add(freshId.toUpperCase());
      cleanPlanted.push(freshId);
    } else {
      reserved.add(upper);
      cleanPlanted.push(rawId);
    }
  }

  return {
    foreshadowingPlanted: cleanPlanted,
    foreshadowingPaid: cleanPaid,
  };
}

function sanitizeCommitForeshadowing(
  book: BookProject,
  chapterNum: number,
  rawNew: unknown,
  rawPaidIds: unknown,
  rawUpdated: unknown
): {
  newForeshadowing: ForeshadowingThread[];
  paidForeshadowingIds: string[];
  updatedForeshadowing: ForeshadowingProgressUpdate[];
} {
  const existingMap = new Map(book.state.foreshadowing.map((f) => [f.id.trim().toUpperCase(), f]));
  const existingKeys = new Set(existingMap.keys());

  const paidForeshadowingIds: string[] = [];
  const paidKeys = new Set<string>();
  for (const id of Array.isArray(rawPaidIds) ? rawPaidIds : []) {
    const key = String(id || '').trim().toUpperCase();
    if (!key || paidKeys.has(key)) continue;
    const match = existingMap.get(key);
    if (match && match.status !== 'paid') {
      paidKeys.add(key);
      paidForeshadowingIds.push(match.id);
    }
  }

  const updatedForeshadowing: ForeshadowingProgressUpdate[] = [];
  const seenUpdated = new Set<string>();
  for (const u of Array.isArray(rawUpdated) ? rawUpdated : []) {
    if (!u || typeof u !== 'object') continue;
    const key = String((u as any).id || '').trim().toUpperCase();
    if (!key || paidKeys.has(key) || seenUpdated.has(key)) continue;
    const match = existingMap.get(key);
    if (match && match.status !== 'paid') {
      seenUpdated.add(key);
      const status = (u as any).status === 'deferred' ? 'deferred' : 'progressing';
      const rawDue = Number((u as any).newPayoffDue);
      const newPayoffDue = Number.isFinite(rawDue) && rawDue > chapterNum ? rawDue : chapterNum + 4;
      updatedForeshadowing.push({
        id: match.id,
        status,
        newPayoffDue,
        note: typeof (u as any).note === 'string' ? (u as any).note : undefined,
      });
    }
  }

  const reserved = new Set<string>();
  const existingThreadTexts = new Set(
    book.state.foreshadowing.map((f) => f.thread.trim().toLowerCase())
  );
  const newForeshadowing: ForeshadowingThread[] = [];
  for (const nf of Array.isArray(rawNew) ? rawNew : []) {
    if (!nf || typeof nf !== 'object') continue;
    const threadText = String((nf as any).thread || '').trim();
    if (!threadText) continue;
    if (existingThreadTexts.has(threadText.toLowerCase())) continue;

    const rawId = String((nf as any).id || '').trim();
    const upper = rawId.toUpperCase();
    const existing = existingMap.get(upper);
    const finalId =
      !rawId || (existing && existing.planted !== chapterNum) || reserved.has(upper)
        ? allocateNextForeshadowingId(existingKeys, reserved)
        : rawId;
    reserved.add(finalId.toUpperCase());

    const rawDue = Number((nf as any).payoffDue);
    const payoffDue = Number.isFinite(rawDue) && rawDue > chapterNum ? rawDue : chapterNum + 5;
    // 提交提取时 AI 自动标定 scope/kind；缺失时默认 series/other。
    const scope = ['series', 'volume', 'episode'].includes((nf as any).scope)
      ? (nf as any).scope
      : 'series';
    const kind = ['reveal', 'conflict', 'relationship', 'other'].includes((nf as any).kind)
      ? (nf as any).kind
      : 'other';
    newForeshadowing.push({
      id: finalId,
      planted: chapterNum,
      payoffDue,
      status: 'open',
      thread: threadText,
      scope,
      kind,
    });
  }

  return { newForeshadowing, paidForeshadowingIds, updatedForeshadowing };
}

export async function runMarketScan(params: {
  seedIdea: string;
  platform: string;
  genreId: string;
  language: 'zh' | 'en';
  preferredNames?: string;
}): Promise<MarketScanRecord> {
  const genre = GENRE_PACKS.find((g) => g.id === params.genreId);

  const response = await callGenerateContent(
    {
      contents: [
      `执行 long-novel-workflow Step 0（扫榜 / 拆文）。`,
      `目标平台：${params.platform}`,
      `语言：${params.language}`,
      `流派预设：${genre ? `${genre.label} (${genre.formula})，常见爆款结构：${genre.payoffShape}` : params.genreId}`,
      `作者灵感种子：${params.seedIdea}`,
      buildNamingConstraint(params.language, params.preferredNames),
      `请输出该赛道当下的市场趋势拆解、开篇前三章钩子公式、书名取向、人名建议以及同质化风险警告。`,
    ].join('\n'),
    config: {
      systemInstruction:
        '你是 long-novel-workflow 的 Step 0 扫榜策划编辑。输出客观、可落地的平台流派分析，禁止空话、套话与撞名模板。',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          trendSummary: { type: Type.STRING },
          hookFormula: { type: Type.STRING },
          titleDirection: { type: Type.STRING },
          namingNotes: { type: Type.STRING },
          riskWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['trendSummary', 'hookFormula', 'titleDirection', 'namingNotes', 'riskWarnings'],
      },
    },
  },
    true
  );

  const data = parseJsonSafe<{
    trendSummary: string;
    hookFormula: string;
    titleDirection: string;
    namingNotes: string;
    riskWarnings: string[];
  }>(response.text, '扫榜分析生成失败');

  return {
    platform: params.platform,
    genreId: params.genreId,
    seedIdea: params.seedIdea,
    ...data,
  };
}

export async function runGenerateBible(params: {
  seedIdea: string;
  platform: string;
  genreId: string;
  language: 'zh' | 'en';
  marketScan?: MarketScanRecord;
  preferredNames?: string;
  endingSummary?: string;
  plannedEnding?: string;
  targetChapters?: number;
}): Promise<Pick<BookProject, 'title' | 'formula' | 'bible' | 'outline' | 'state'>> {
  const genre = GENRE_PACKS.find((g) => g.id === params.genreId);

  const response = await callGenerateContent({
    contents: [
      `根据 long-novel-workflow Step 1 生成完整《故事圣经 (Bible)》、《滚动画卷大纲 (Outline)》与初始状态 (Knows + Foreshadowing)。`,
      `语言：${params.language}`,
      `目标平台：${params.platform}`,
      `题材配方：${genre ? genre.formula : params.genreId}`,
      `核心灵感：${params.seedIdea}`,
      buildNamingConstraint(params.language, params.preferredNames),
      params.marketScan
        ? `Step 0 扫榜结论：\n- 趋势：${params.marketScan.trendSummary}\n- 钩子公式：${params.marketScan.hookFormula}\n- 书名与人名方向：${params.marketScan.titleDirection} / ${params.marketScan.namingNotes}`
        : '',
      `要求：`,
      `1. hardConstraints 必须是 3-5 条“绝不能为了救场而打破的硬约束”（例如信息隔离、能力代价、死亡不可逆）。`,
      `2. characters 先构建 3–5 位核心首发角色即可（并非全书人数上限！长篇连载切忌在规划阶段一次塞入几十个无戏份的背景板；中后期随时可通过「人物锻造」或章节推进滚动扩充）。每位角色必须有独特鲜明且不落俗套的姓名，以及 DNA（外形+主色+信物+衣着）、Want、Need、Flaw、Arc、speechStyle（独特说话腔调与节奏）与 debutPlan（预计在哪一章、通过什么事自然切入出场）。`,
      `3. cultureAnchors 必须具体到衣食住行器物色调，不可写空泛大词。`,
      `4. roadmap 先规划前 10 章（包含开篇黄金三章与第 4-10 章大节点铺垫），desire 只能取 ${ALL_DESIRE_KEYS_LIST} 之一，每章 hook 必须不少于 15 字。`,
      `5. initialKnows 列出第 1 章前各角色已知/明确不知的核心边界；initialForeshadowing 列出 F01-F03 并标注预期兑现章号 payoffDue。`,
      params.targetChapters != null
        ? `6. 终局规划：本书目标 ${params.targetChapters} 章（浮动 ±${effectiveTolerance(params.targetChapters)}，不是死线）；罗盘 compass 须带上 targetChapters=${params.targetChapters}。`
        : `6. 终局规划：本书目标章数暂不定，罗盘 compass 不填 targetChapters（自由连载，开写后再补）。`,
      params.endingSummary
        ? `7. 一句话核心结局（endingSummary，供合同与复盘把关，绝不进正文）：${params.endingSummary}`
        : `7. 一句话核心结局暂不定，endingSummary 留空（立局期末再补）。`,
      params.plannedEnding
        ? `8. 完整终局蓝图（plannedEnding，3 落点：终局高潮、人物归宿、核心问题答案；导演专用，绝不进正文提示词）：${params.plannedEnding}`
        : `8. 完整终局蓝图暂不定，plannedEnding 留空。`,
    ].join('\n\n'),
    config: {
      systemInstruction:
        '你是 long-novel-workflow 的架构师。文件当真相，人物即时间线，严格保证硬约束、信息差严谨与人物命名差异化。',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          formula: { type: Type.STRING },
          bible: {
            type: Type.OBJECT,
            properties: {
              premise: { type: Type.STRING },
              era: { type: Type.STRING },
              setting: { type: Type.STRING },
              worldRules: { type: Type.STRING },
              locations: { type: Type.ARRAY, items: { type: Type.STRING } },
              hardConstraints: { type: Type.ARRAY, items: { type: Type.STRING } },
              cultureAnchors: {
                type: Type.OBJECT,
                properties: {
                  clothing: { type: Type.STRING },
                  food: { type: Type.STRING },
                  objects: { type: Type.STRING },
                  landscape: { type: Type.STRING },
                  colour: { type: Type.STRING },
                },
                required: ['clothing', 'food', 'objects', 'landscape', 'colour'],
              },
              voice: {
                type: Type.OBJECT,
                properties: {
                  narrator: { type: Type.STRING },
                  dialogueDistinctness: { type: Type.STRING },
                },
                required: ['narrator', 'dialogueDistinctness'],
              },
              characters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    age: { type: Type.STRING },
                    role: { type: Type.STRING },
                    dna: { type: Type.STRING },
                    want: { type: Type.STRING },
                    need: { type: Type.STRING },
                    flaw: { type: Type.STRING },
                    arc: { type: Type.STRING },
                    speechStyle: { type: Type.STRING },
                    debutPlan: { type: Type.STRING },
                  },
                  required: [
                    'name',
                    'age',
                    'role',
                    'dna',
                    'want',
                    'need',
                    'flaw',
                    'arc',
                    'speechStyle',
                    'debutPlan',
                  ],
                },
              },
            },
            required: [
              'premise',
              'era',
              'setting',
              'worldRules',
              'locations',
              'hardConstraints',
              'cultureAnchors',
              'voice',
              'characters',
            ],
          },
          outline: {
            type: Type.OBJECT,
            properties: {
              compass: {
                type: Type.OBJECT,
                properties: {
                  endDirection: { type: Type.STRING },
                  activeLongThreads: { type: Type.STRING },
                  scaleEstimate: { type: Type.STRING },
                  centralQuestion: { type: Type.STRING },
                  whatBookIsNot: { type: Type.STRING },
                  targetChapters: { type: Type.INTEGER },
                  endingSummary: { type: Type.STRING },
                  plannedEnding: { type: Type.STRING },
                },
                required: ['endDirection', 'activeLongThreads', 'scaleEstimate', 'centralQuestion', 'whatBookIsNot'],
              },
              currentArc: {
                type: Type.OBJECT,
                properties: {
                  rangeLabel: { type: Type.STRING },
                  goal: { type: Type.STRING },
                  beats: { type: Type.ARRAY, items: { type: Type.STRING } },
                  payoff: { type: Type.STRING },
                  newElementsNote: { type: Type.STRING },
                },
                required: ['rangeLabel', 'goal', 'beats', 'payoff', 'newElementsNote'],
              },
              roadmap: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chapter: { type: Type.INTEGER },
                    goal: { type: Type.STRING },
                    desire: { type: Type.STRING },
                    hook: { type: Type.STRING },
                  },
                  required: ['chapter', 'goal', 'desire', 'hook'],
                },
              },
            },
            required: ['compass', 'currentArc', 'roadmap'],
          },
          initialKnows: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                characterName: { type: Type.STRING },
                fact: { type: Type.STRING },
                knows: { type: Type.BOOLEAN },
                note: { type: Type.STRING },
              },
              required: ['characterName', 'fact', 'knows'],
            },
          },
          initialForeshadowing: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                planted: { type: Type.INTEGER },
                payoffDue: { type: Type.INTEGER },
                thread: { type: Type.STRING },
              },
              required: ['id', 'planted', 'payoffDue', 'thread'],
            },
          },
        },
        required: ['title', 'formula', 'bible', 'outline', 'initialKnows', 'initialForeshadowing'],
      },
    },
  });

  const parsed = parseJsonSafe<any>(response.text, '圣经与大纲生成失败');

  const characters: CharacterProfile[] = (parsed.bible.characters || []).map((c: any, idx: number) => ({
    id: `char-${Date.now()}-${idx}`,
    ...c,
  }));

  const validDesire = (d: string) =>
    d in DESIRE_SPECS ? (d as keyof typeof DESIRE_SPECS) : 'curiosity';

  return {
    title: parsed.title,
    formula: parsed.formula,
    bible: {
      ...parsed.bible,
      voice: {
        ...parsed.bible.voice,
        customBanned: [],
      },
      characters,
    },
    outline: {
      ...parsed.outline,
      roadmap: (parsed.outline.roadmap || []).map((r: any) => ({
        chapter: r.chapter,
        goal: r.goal,
        desire: validDesire(r.desire),
        hook: r.hook,
        status: 'planned' as const,
      })),
    },
    state: {
      committedChapters: [],
      nextChapter: 1,
      summaries: [],
      characterStates: characters.map((c) => ({
        characterName: c.name,
        currentState: `${c.role}，初始动机：${c.want}`,
      })),
      foreshadowing: (parsed.initialForeshadowing || []).map((f: any) => ({
        id: f.id,
        planted: f.planted || 1,
        payoffDue: f.payoffDue || 5,
        status: 'open' as const,
        thread: f.thread,
      })),
      knows: (parsed.initialKnows || []).map((k: any, idx: number) => ({
        id: `k-init-${idx}`,
        characterName: k.characterName,
        fact: k.fact,
        learnedChapter: k.knows ? 1 : null,
        knows: Boolean(k.knows),
        note: k.note,
      })),
      timeline: [],
    },
  };
}

export async function runDraftEnding(book: BookProject): Promise<{
  endingSummary: string;
  plannedEnding: string;
}> {
  const response = await callGenerateContent(
    {
      contents: [
        `为《${book.title}》拟定结局草案（只出结局，不写正文）。`,
        `核心前提：${book.bible.premise}`,
        `终局方向：${book.outline.compass.endDirection}`,
        `核心悬念：${book.outline.compass.centralQuestion}`,
        `目标：${targetSummaryLine(book)}`,
        `已提交摘要：\n${book.state.summaries.map((s) => `Ch${s.chapter}: ${s.summary}`).join('\n') || '无'}`,
        `未结伏笔：\n${book.state.foreshadowing
          .filter((f) => f.status === 'open' || f.status === 'progressing')
          .map((f) => `${f.id} [${f.scope ?? 'series'}/${f.kind ?? 'other'}] due:${f.payoffDue}: ${f.thread}`)
          .join('\n') || '无'}`,
        `要求：只输出两项——(1) endingSummary：一句话核心结局；(2) plannedEnding：完整终局蓝图 3 落点（终局高潮、人物归宿、核心问题答案），每落点一句话。结局必须能收束上方未结伏笔，不得另开与前提冲突的新线。`,
      ].join('\n\n'),
      config: {
        systemInstruction:
          '你是 long-novel-workflow 的终局设计师。只拟定结局草案，不写正文、不编新主线；结局是作者可改的草案，不是定稿。',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            endingSummary: { type: Type.STRING },
            plannedEnding: { type: Type.STRING },
          },
          required: ['endingSummary', 'plannedEnding'],
        },
      },
    },
    true
  );

  return parseJsonSafe(response.text, '结局草案生成失败');
}

export async function runForgeCharacter(book: BookProject, promptHint: string): Promise<{
  character: CharacterProfile;
  knowsHints: { fact: string; knows: boolean; note: string }[];
}> {
  const recentSummaries = book.state.summaries
    .slice(-4)
    .map((s) => `- 第 ${s.chapter} 章：${s.summary}`)
    .join('\n');
  const activeThreads = book.state.foreshadowing
    .filter((f) => f.status !== 'paid')
    .slice(0, 6)
    .map((f) => `- ${f.id} (约定 Ch${f.payoffDue} 兑现)：${f.thread}`)
    .join('\n');

  const response = await callGenerateContent({
    contents: [
      `为长篇小说《${book.title}》锻造一名新角色（Launch Skill 3: 人物锻造）。`,
      `语言：${book.language} | 题材配方：${book.formula} | 目标平台：${book.platform}`,
      `核心前提：${book.bible.premise}`,
      `时代与舞台设定：${book.bible.era} | ${book.bible.setting}`,
      `世界运转规则：${book.bible.worldRules}`,
      `核心地标：${book.bible.locations.join('、') || '暂无'}`,
      `硬约束（绝不可打破）：${book.bible.hardConstraints.join('；')}`,
      `文化锚点（外貌 DNA 与随身器物务必贴合以下质感）：衣(${book.bible.cultureAnchors.clothing}) / 食(${book.bible.cultureAnchors.food}) / 器(${book.bible.cultureAnchors.objects}) / 景(${book.bible.cultureAnchors.landscape}) / 色(${book.bible.cultureAnchors.colour})`,
      `全书叙事声音规范：叙述者=${book.bible.voice.narrator} | 对白区分度=${book.bible.voice.dialogueDistinctness}`,
      `当前连载进度：即将进入第 ${book.state.nextChapter} 章`,
      `最近已提交章节前情：\n${recentSummaries || '尚在开篇筹备阶段（第 1 章前）'}`,
      `当前未结伏笔线索：\n${activeThreads || '暂无未结伏笔'}`,
      `已有角色花名册（严禁撞姓、撞音节、撞人设定位或撞腔调）：\n${book.bible.characters.map((c) => `- ${c.name}（${c.age}，${c.role}）| 诉求: ${c.want} | 腔调: ${c.speechStyle || '未注明'}`).join('\n')}`,
      `作者本次锻造需求：${promptHint}`,
      buildNamingConstraint(book.language),
      `设计要求：`,
      `1. 叙事与风格一致性：角色的身份、衣着、信物与动机必须严丝合缝嵌合当前时代背景、世界规则与全书叙述语调，不可出现跳戏或时代错位。`,
      `2. 鲜明对白声线（speechStyle）：明确给出该人物在对话中的语气节奏、常用词汇特征或习惯动作，与已有角色形成听觉区分度。`,
      `3. 适时切入出场故事（debutPlan）：结合当前进度（第 ${book.state.nextChapter} 章及后续卷目标「${book.outline.currentArc.goal}」）与未结线索，设计自然且有冲突张力的切入章号区间与出场引子，避免天降工具人。`,
      `4. 严格对齐 Knows 边界：knowsHints 列出 2–4 条该角色在第 ${book.state.nextChapter} 章登场时“已知”或“明确不知”的关键事实，严禁全知剧透。`,
    ].join('\n'),
    config: {
      systemInstruction:
        '你是 long-novel-workflow 的人物锻造师。中途锻造的角色必须完美继承本书世界观、时代质感、叙述基调与当前剧情进展，并附带可落地的自然出场切入方案。',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          character: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              age: { type: Type.STRING },
              role: { type: Type.STRING },
              dna: { type: Type.STRING },
              want: { type: Type.STRING },
              need: { type: Type.STRING },
              flaw: { type: Type.STRING },
              arc: { type: Type.STRING },
              speechStyle: { type: Type.STRING },
              debutPlan: { type: Type.STRING },
            },
            required: [
              'name',
              'age',
              'role',
              'dna',
              'want',
              'need',
              'flaw',
              'arc',
              'speechStyle',
              'debutPlan',
            ],
          },
          knowsHints: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fact: { type: Type.STRING },
                knows: { type: Type.BOOLEAN },
                note: { type: Type.STRING },
              },
              required: ['fact', 'knows', 'note'],
            },
          },
        },
        required: ['character', 'knowsHints'],
      },
    },
  });

  const data = parseJsonSafe<any>(response.text, '人物锻造失败');
  return {
    character: {
      id: `char-${Date.now()}`,
      ...data.character,
    },
    knowsHints: data.knowsHints || [],
  };
}

export async function runPackaging(book: BookProject): Promise<PackagingInfo> {
  const response = await callGenerateContent(
    {
      contents: [
      `执行 long-novel-workflow Launch Skill 2（包装：书名 / 简介 / 封面 Brief / 关键词）。`,
      `目标平台：${book.platform}`,
      `语言：${book.language}`,
      `核心前提：${book.bible.premise}`,
      `主要角色：${book.bible.characters.map((c) => `${c.name}（${c.want}）`).join('、')}`,
      `前三章摘要：${book.state.summaries.slice(0, 3).map((s) => `第${s.chapter}章：${s.summary}`).join('\n') || '尚未提交前三章'}`,
    ].join('\n'),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          titleCandidates: { type: Type.ARRAY, items: { type: Type.STRING } },
          selectedTitle: { type: Type.STRING },
          coverBrief: { type: Type.STRING },
          blurb: { type: Type.STRING },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['titleCandidates', 'selectedTitle', 'coverBrief', 'blurb', 'keywords'],
      },
    },
  },
    true
  );

  const data = parseJsonSafe<PackagingInfo>(response.text, '包装方案生成失败');
  return {
    ...data,
    coverImageUrl: book.packaging?.coverImageUrl,
  };
}

export async function runDraftContract(
  book: BookProject,
  chapterNum: number,
  authorNote?: string,
  existingContract?: Partial<ChapterContract>
): Promise<{ contract: ChapterContract; newCharacters: Omit<CharacterProfile, 'id'>[] }> {
  const prevChapter = book.chapters.find((c) => c.chapter === chapterNum - 1);
  const roadmapItem = book.outline.roadmap.find((r) => r.chapter === chapterNum);
  const foreshadowCtx = buildForeshadowingPromptContext(book, chapterNum);
  const castRosterCtx = buildCastRosterPromptContext(book, chapterNum);
  // 剧透隔离（手册 §四）：起草合同可看一句话结局方向 + 阶段信息，绝不看完整终局蓝图；
  // 正文写作只拿合同 + 单行阶段指令。本函数不读取 plannedEnding。
  const chapterKind: 'main' | 'epilogue' | 'extra' =
    (existingContract?.chapterKind ?? 'main') as 'main' | 'epilogue' | 'extra';
  const phaseInfo =
    chapterKind === 'main'
      ? getPhaseInfo(
          chapterNum,
          1,
          book.outline.compass.targetChapters,
          book.outline.compass.tolerance
        )
      : null;
  const cadence = bigCadenceFor(book.outline.compass.targetChapters);
  // %3 强兑现：T < 10 或短篇模式（targetWords 启用）放宽（与审计引擎一致）。
  const relax3 =
    (book.outline.compass.targetChapters != null && book.outline.compass.targetChapters < 10) ||
    book.outline.compass.targetWords != null;

  const manualDesire: DesireKey | null =
    existingContract?.desire &&
    existingContract.desire !== 'auto' &&
    existingContract.desire in DESIRE_SPECS
      ? (existingContract.desire as DesireKey)
      : null;

  const manualPayoff: PayoffSize | null =
    existingContract?.payoffSize && existingContract.payoffSize !== 'auto'
      ? existingContract.payoffSize
      : null;

  const desireInstruction = manualDesire
    ? `- 作者已手动指定主导欲望为：${manualDesire}（${DESIRE_SPECS[manualDesire].labelZh}），请直接围绕该欲望设计 desirePayoff 并保持 desire="${manualDesire}"。`
    : `- desire 当前为「AI 自动判断选择 (auto)」，请结合上一章交接、大纲节奏与本章戏剧冲突，从以下 8 种核心读者欲望中自主择一最精准的类型：${ALL_DESIRE_GUIDE}。`;

  const payoffInstruction =
    chapterKind === 'main' && cadence != null && chapterNum % cadence === 0
      ? `- 第 ${chapterNum} 章是大节点章（bigCadence=${cadence}），payoffSize 必须为 "big"（阶段大高潮/大兑现，必须有重磅转折或重大破局交付）。`
      : manualPayoff
      ? `- 作者已指定兑现级别为 "${manualPayoff}"，请严格按该量级策划本章情节点。`
      : `- payoffSize 当前为「AI 自动判断并执行 (auto)」，请根据剧情蓄力曲线自主选择 "small"（稳步推进与小爽点/小反转）或 "big"（阶段高潮/重大翻盘/关键揭秘）${!relax3 && chapterNum % 3 === 0 ? '（本章为 3 的倍数节点，不可为 none）' : ''}，并在 desirePayoff 与 mustHappen 中落实对应强度的实体动作！`;

  const response = await callGenerateContent(
    {
      contents: [
        `为《${book.title}》第 ${chapterNum} 章起草《章节合同 (Chapter Contract)》。`,
        `语言：${book.language}`,
        `核心前提：${book.bible.premise}`,
        `硬约束（不可违背）：\n${book.bible.hardConstraints.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
        `当前卷目标：${book.outline.currentArc.goal}`,
        roadmapItem
          ? `大纲规划本章节拍参考：${roadmapItem.goal}（参考欲望：${roadmapItem.desire}，参考钩子：${roadmapItem.hook}）`
          : '',
        prevChapter
          ? `上一章（第 ${chapterNum - 1} 章）交接字段 transition：${prevChapter.contract.transition}`
          : '本章为第 1 章，直接开篇入戏。',
        `最近摘要：\n${book.state.summaries.slice(-3).map((s) => `Ch${s.chapter}: ${s.summary}`).join('\n') || '无'}`,
        foreshadowCtx.text,
        castRosterCtx,
        `已知/未知关键信息：\n${book.state.knows.map((k) => `- ${k.characterName} ${k.knows ? '知道' : '不知道'}：${k.fact}`).join('\n')}`,
        buildNamingConstraint(book.language),
        authorNote ? `作者额外要求：${authorNote}` : '',
        chapterKind !== 'main'
          ? `本章为${chapterKind === 'epilogue' ? '后记' : '番外'}（chapterKind=${chapterKind}）：不计入主线进度，豁免阶段/节奏/大兑现检查，收束余韵、不开新主线冲突。`
          : '',
        book.outline.compass.endingSummary
          ? `一句话核心结局（仅供合同把关方向，绝不写入正文、绝不提前泄底）：${book.outline.compass.endingSummary}`
          : '',
        phaseInfo ? `当前阶段：${phaseInfo.phaseLabelZh}。${phaseInfo.phaseMustNot}` : '',
        `规则检查：`,
        `- 章节标题 title 请自动带章号前缀（例如“第${chapterNum}章 ……”）。`,
        payoffInstruction,
        desireInstruction,
        `- 【人物丰富度与配角规则（极其重要）】严禁写成主角自言自语的独角戏！每章至少安排 2–4 名有真实姓名的人物参与对手戏、冲突或协作（第 1 章若有盟友/敌手也应尽早亮名出场）。`,
        `- 优先调度上方花名册中已登记的人物（尤其是多章未出场者）；如果本章剧情需要新的配角、对手、线人、掌柜、大夫等人物，严禁使用“黑衣人/神秘人/管家/店小二/路人”等无名代称——请在 newCharacters 中为他们起好独特姓名并建立档案，同时把他们的姓名写入 characters 数组！若无需新人，newCharacters 返回空数组 []。`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      config: {
        systemInstruction:
          '你是 long-novel-workflow 的章节合同设计师。没有合同不写正文；必须自主决策或执行主导欲望与兑现级别、锁死章末钩子、处理逾期伏笔，并主动调度丰富立体且有姓名的配角阵容，严禁只剩主角唱独角戏或使用无名路人代称。',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            desire: { type: Type.STRING },
            desirePayoff: { type: Type.STRING },
            payoffSize: { type: Type.STRING },
            hook: { type: Type.STRING },
            transition: { type: Type.STRING },
            mustHappen: { type: Type.STRING },
            mustNot: { type: Type.STRING },
            characters: { type: Type.ARRAY, items: { type: Type.STRING } },
            newCharacters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  age: { type: Type.STRING },
                  role: { type: Type.STRING },
                  dna: { type: Type.STRING },
                  want: { type: Type.STRING },
                  need: { type: Type.STRING },
                  flaw: { type: Type.STRING },
                  arc: { type: Type.STRING },
                  speechStyle: { type: Type.STRING },
                  debutPlan: { type: Type.STRING },
                },
                required: ['name', 'age', 'role', 'dna', 'want', 'flaw'],
              },
            },
            foreshadowingPlanted: { type: Type.ARRAY, items: { type: Type.STRING } },
            foreshadowingPaid: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'title',
            'desire',
            'desirePayoff',
            'payoffSize',
            'hook',
            'transition',
            'mustHappen',
            'mustNot',
            'characters',
            'newCharacters',
            'foreshadowingPlanted',
            'foreshadowingPaid',
          ],
        },
      },
    },
    true
  );

  const data = parseJsonSafe<any>(response.text, '章节合同生成失败');
  const validDesire: DesireKey =
    manualDesire ||
    (data.desire in DESIRE_SPECS
      ? (data.desire as DesireKey)
      : roadmapItem?.desire && roadmapItem.desire in DESIRE_SPECS
      ? roadmapItem.desire
      : 'curiosity');

  const enforcedSize: PayoffSize =
    chapterKind === 'main' && cadence != null && chapterNum % cadence === 0
      ? 'big'
      : manualPayoff
      ? manualPayoff
      : data.payoffSize === 'big'
      ? 'big'
      : data.payoffSize === 'none' && (!relax3 || chapterNum % 3 !== 0)
      ? 'none'
      : 'small';

  const cleanNewChars = sanitizeNewCharacters(book, data.newCharacters, chapterNum);
  const allowedNames = new Set([
    ...book.bible.characters.map((bc) => bc.name),
    ...cleanNewChars.map((nc) => nc.name),
  ]);

  const validCharacters = Array.from(
    new Set(
      (data.characters || [])
        .map((n: string) => String(n || '').trim())
        .filter((name: string) => allowedNames.has(name))
    )
  ) as string[];

  for (const nc of cleanNewChars) {
    if (!validCharacters.includes(nc.name)) {
      validCharacters.push(nc.name);
    }
  }

  const finalCharacters =
    validCharacters.length > 0
      ? validCharacters
      : book.bible.characters.slice(0, Math.min(3, book.bible.characters.length)).map((bc) => bc.name);

  const sanitizedForeshadowing = sanitizeContractForeshadowing(
    book,
    chapterNum,
    data.foreshadowingPlanted,
    data.foreshadowingPaid
  );

  return {
    contract: {
      chapter: chapterNum,
      title: formatChapterTitle(chapterNum, data.title, book.language),
      language: book.language,
      desire: validDesire,
      desirePayoff: data.desirePayoff,
      payoffSize: enforcedSize,
      hook: data.hook,
      transition: data.transition,
      mustHappen: data.mustHappen,
      mustNot: data.mustNot,
      characters: finalCharacters,
      foreshadowingPlanted: sanitizedForeshadowing.foreshadowingPlanted,
      foreshadowingPaid: sanitizedForeshadowing.foreshadowingPaid,
      isProbe: Boolean(existingContract?.isProbe),
      chapterKind,
    },
    newCharacters: cleanNewChars,
  };
}

export async function* streamWriteChapter(
  book: BookProject,
  contract: ChapterContract,
  extraGuidance?: string
): AsyncGenerator<string> {
  const ai = getAiClient();
  const langSpec = LANGUAGE_SPECS[book.language];
  const slopList = [
    ...DEFAULT_SLOP_LIST[book.language],
    ...(book.bible.voice.customBanned || []),
  ];

  // Bounded retrieval: last 1-2 chapters + rolling summaries + contract + hard facts (NEVER dump entire book)
  const recentChapters = book.chapters
    .filter((c) => c.chapter < contract.chapter && c.chapter >= contract.chapter - 2)
    .sort((a, b) => a.chapter - b.chapter);

  // 重生成中间章节时，后章已经写完定稿：新写的本章必须接到后章开头，不能只顾前章。
  const nextChapter = book.chapters.find((c) => c.chapter === contract.chapter + 1);
  const nextSummary = nextChapter
    ? book.state.summaries.find((s) => s.chapter === nextChapter.chapter)?.summary || '（无摘要）'
    : '';
  const forwardBlock = nextChapter
    ? [
        `【后章衔接】本章不是最新章，后面已有第 ${nextChapter.chapter} 章《${nextChapter.contract.title}》写完并定稿，重写本章必须与它衔接：`,
        `下一章开篇交接（它写明了如何承接本章）：${nextChapter.contract.transition}`,
        `下一章必须发生：${nextChapter.contract.mustHappen}`,
        `下一章摘要：${nextSummary}`,
        `下一章正文开头（前 600 字，已定稿，不可改动）：\n${nextChapter.prose.slice(0, 600)}`,
        `要求：本章结尾必须自然接到下一章开头——同一时间、同一地点、同一批人物、同一状态；不得改动下一章开头已经写定的人物、地点、对话与事实；不得让下一章的开篇失去前提；不得提前写掉下一章才发生的剧情。`,
      ].join('\n')
    : '';

  const presentChars = book.bible.characters.filter((c) =>
    contract.characters.includes(c.name)
  );
  const otherRegisteredChars = book.bible.characters.filter(
    (c) => !contract.characters.includes(c.name)
  );
  const relevantKnows = book.state.knows.filter((k) =>
    contract.characters.includes(k.characterName)
  );

  const targetLengthInstruction =
    book.language === 'zh'
      ? contract.isProbe
        ? '约 1000–1500 字（探针样章，紧凑有力）'
        : '2200–3500 字（4000 中文字符以内均可，充分展开动作、对白与戏剧冲突）'
      : contract.isProbe
      ? 'around 700–1000 words (probe chapter)'
      : '1600–2200 words (strictly within 1500–2500 words)';

  const paidThreadsDetails = contract.foreshadowingPaid
    .map((id) => {
      const found = book.state.foreshadowing.find((f) => f.id === id);
      return found ? `${found.id}（原伏笔：${found.thread}）` : id;
    })
    .filter(Boolean);

  const overdueThreads = book.state.foreshadowing.filter(
    (f) =>
      (f.status === 'open' || f.status === 'progressing') &&
      (f.targetChapter === contract.chapter || contract.chapter >= f.payoffDue) &&
      !contract.foreshadowingPaid.includes(f.id)
  );

  const desireSpec =
    contract.desire !== 'auto' ? DESIRE_SPECS[contract.desire] : undefined;
  const payoffExecutionHint =
    contract.payoffSize === 'big'
      ? 'big（大兑现/卷内小高潮：必须落地高烈度对抗、重大反杀、核心真相揭露或局势逆转，不可草草收尾）'
      : contract.payoffSize === 'none'
      ? 'none（过渡蓄力：聚焦悬念铺垫与人物关系推演，仍需保证冲突感与明确钩子）'
      : 'small（稳步兑现：必须有明确的具体战果、线索突破、人情推进或当场反制，让读者有实感）';
  // 盲写隔离（手册 §四）：正文只拿合同 + 单行阶段指令，绝不注入 plannedEnding /
  // endingSummary。阶段指令由合同与当前章号推导。
  const isMainChapter = (contract.chapterKind ?? 'main') === 'main';
  const phaseInfo = isMainChapter
    ? getPhaseInfo(
        contract.chapter,
        1,
        book.outline.compass.targetChapters,
        book.outline.compass.tolerance
      )
    : null;

  const prompt = [
    `请根据以下【章节合同】与【有限记忆切片】撰写《${book.title}》第 ${contract.chapter} 章：《${contract.title}》。`,
    ``,
    `【一、硬约束（绝不可打破）】`,
    ...book.bible.hardConstraints.map((r, i) => `${i + 1}. ${r}`),
    ``,
    `【二、叙事语调与文化锚点】`,
    `- 叙述者：${book.bible.voice.narrator}`,
    `- 对白区分：${book.bible.voice.dialogueDistinctness}`,
    `- 器物与环境锚点：衣着(${book.bible.cultureAnchors.clothing}) / 饮食(${book.bible.cultureAnchors.food}) / 器物(${book.bible.cultureAnchors.objects}) / 场景(${book.bible.cultureAnchors.landscape}) / 色调(${book.bible.cultureAnchors.colour})`,
    ``,
    `【三、本章合同（必须严格执行）】`,
    phaseInfo ? phaseInfo.phaseLine : '',
    `- 核心欲望：${desireSpec ? `${desireSpec.labelZh}(${desireSpec.key})` : contract.desire} —— 本章必须兑现：${contract.desirePayoff}`,
    `- 兑现级别执行要求：${payoffExecutionHint}`,
    `- 必须发生（按序）：${contract.mustHappen}`,
    `- 绝对禁止：${contract.mustNot}`,
    `- 章末钩子（必须落到这一真实结尾上，不要另外硬加悬念尾巴）：${contract.hook}`,
    `- 承接状态：${contract.transition}`,
    paidThreadsDetails.length > 0
      ? `- 本章必须兑现的已有伏笔：${paidThreadsDetails.join('；')}`
      : '',
    contract.foreshadowingPlanted.length > 0
      ? `- 本章新埋伏笔编号：${contract.foreshadowingPlanted.join('、')}（需自然植入物证或行动细节）`
      : '',
    overdueThreads.length > 0
      ? `- 台账逾期/待引入伏笔提醒（若与本场相关请顺势推进衔接）：${overdueThreads.map((f) => `${f.id}:${f.thread}`).join('；')}`
      : '',
    `- 本章核心出场人物档案：\n${presentChars.map((c) => `  * ${c.name}（${c.age}，${c.role}）| DNA: ${c.dna}${c.speechStyle ? ` | 腔调: ${c.speechStyle}` : ''} | Want: ${c.want} | 缺陷: ${c.flaw}${c.debutPlan ? ` | 切入引子: ${c.debutPlan}` : ''}`).join('\n')}`,
    otherRegisteredChars.length > 0
      ? `- 本书其他已登记人物（如需被提及、传讯、遥相呼应或择机切入互动，请直接用其本名，严格保持人设、腔调与切入时机连贯）：\n${otherRegisteredChars.map((c) => `  * ${c.name}（${c.role}）：${c.want}${c.speechStyle ? ` | 腔调: ${c.speechStyle}` : ''}${c.debutPlan ? ` | 待切入方案: ${c.debutPlan}` : ''}`).join('\n')}`
      : '',
    `- 出场人物 Knows 边界（角色只能猜疑，绝不能知道未曾被告知的事实）：\n${relevantKnows.map((k) => `  * ${k.characterName} [${k.knows ? '已知' : '未知'}]: ${k.fact}`).join('\n')}`,
    ``,
    `【四、前情摘要与最近章节切片】`,
    ...book.state.summaries
      .filter((s) => s.chapter < contract.chapter)
      .slice(-6)
      .map((s) => `- 第 ${s.chapter} 章摘要：${s.summary}`),
    ...recentChapters.map(
      (c) => `\n--- 第 ${c.chapter} 章《${c.contract.title}》参考原文 ---\n${c.prose}`
    ),
    `【防重写铁律】上面“参考原文”是已经写完的前章正文，只供你衔接剧情、保持人设与语调，绝不是让你重写的内容：本章必须从上一章结尾之后开始写（按 contract.transition 承接），只写新发生的剧情；参考原文里已经写过的场景、对话、段落，一句也不许照抄或换词重写，同一件事不许换个说法再讲一遍；只有剧情确实需要回望时，才允许用一两句话简要提及前情，不得展开复述。`,
    forwardBlock,
    ``,
    `【五、群像互动、伏笔真实性与去 AI 味铁律】`,
    `- 配角群像与无名禁用：严禁写成主角自言自语的独角戏！但凡参与交锋、对白、交易、救援或传话的配角/对手/小人物，均须赋予有姓有名的真实身份与独特说话腔调，禁止用“黑衣人”“神秘人”“管家”“店小二”“路人甲”代替有戏份的角色。`,
    `- 伏笔一致性：严禁在正文中凭空声称“前面章节埋下过某信物/旧约定/伏笔”，除非它确实存在于前情摘要、最近原文或伏笔台账中！`,
    `- 绝对禁止出现以下套话或全知剧透句式：${slopList.join(' / ')}`,
    `段落格式：${langSpec.paragraphStyle}`,
    `篇幅要求：${targetLengthInstruction}`,
    extraGuidance ? `作者补充要求：${extraGuidance}` : '',
    ``,
    `请直接输出纯正文（不要输出 YAML frontmatter，不要输出章节号标题以外的多余解释），从第一句正文开始。`,
  ]
    .filter(Boolean)
    .join('\n');

  for await (const chunkText of callGenerateContentStream({
    contents: prompt,
    config: {
      systemInstruction:
        '你是整本书唯一的执笔作家（Single-writer voice consistency）。你只写动作、对白与可验证的感官细节，不写全知旁白剧透，不使用任何 AI 陈词，不虚构前文不存在的伏笔，也绝不把配角抹成无名工具人或写成主角独角戏。',
    },
  })) {
    yield chunkText;
  }
}

export async function runAiSubReview(
  book: BookProject,
  chapterItem: ChapterItem
): Promise<{ aiSummary: string; issues: AuditIssue[] }> {
  const { contract, prose } = chapterItem;
  const openForeshadowing = book.state.foreshadowing.filter(
    (f) => f.status === 'open' || f.status === 'progressing'
  );
  const overdueList = openForeshadowing.filter(
    (f) => f.targetChapter === contract.chapter || contract.chapter >= f.payoffDue
  );

  const response = await callGenerateContent({
    contents: [
      `对《${book.title}》第 ${contract.chapter} 章执行 long-novel-workflow 8 维阻断审计（Sub-review）。`,
      `规则：每一条不合格判定，必须引用正文原文片段（citation），否则无效。中文单章 4000 字以内均属完全合格范围，禁止以字数超过 3000 为由报错或要求压缩篇幅。`,
      `伏笔审计专项要求：\n1) 检查正文是否凭空出现前面章节从未埋设过的“伪伏笔/追认线索”（前情摘要与已有伏笔台账中皆无记录，正文却当成前文早已出现过的旧线索或旧物）；\n2) 检查已逾期/指定本章引入的伏笔是否被彻底遗漏未回应。`,
      ``,
      `【硬约束】\n${book.bible.hardConstraints.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      `【叙事声音】${book.bible.voice.narrator} / ${book.bible.voice.dialogueDistinctness}`,
      `【前情摘要】\n${book.state.summaries.filter((s) => s.chapter < contract.chapter).slice(-8).map((s) => `- Ch${s.chapter}: ${s.summary}`).join('\n') || '第1章开篇，无前情'}`,
      `【已有伏笔台账】\n${book.state.foreshadowing.map((f) => `- ${f.id} [${f.status}, planted:Ch${f.planted}, due:Ch${f.payoffDue}]: ${f.thread}`).join('\n') || '暂无'}`,
      overdueList.length > 0
        ? `【当前已逾期/指定本章引入伏笔】\n${overdueList.map((f) => `- ${f.id}: ${f.thread}`).join('\n')}`
        : '',
      `【人物 Knows 边界】\n${book.state.knows.map((k) => `- ${k.characterName} [${k.knows ? '已知' : '未知'}]: ${k.fact}`).join('\n')}`,
      `【本章合同】\n- desire: ${contract.desire} -> ${contract.desirePayoff}\n- must_happen: ${contract.mustHappen}\n- must_not: ${contract.mustNot}\n- hook: ${contract.hook}\n- foreshadowingPlanted: ${contract.foreshadowingPlanted.join(', ') || '无'}\n- foreshadowingPaid: ${contract.foreshadowingPaid.join(', ') || '无'}`,
      ``,
      `【待审正文】\n${prose}`,
    ]
      .filter(Boolean)
      .join('\n'),
    config: {
      systemInstruction:
        '你是独立审稿人（Sub-reviewer）。你从不迎合写手，只对照圣经、knows 边界、合同与 8 维审计标准挑毛病。如无严重问题请如实给出通过评估。',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          aiSummary: { type: Type.STRING },
          issues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dimension: {
                  type: Type.STRING,
                  description:
                    'One of: canon, character_voice, timeline, knows, foreshadowing, hook_desire, pacing, prose_deslop',
                },
                severity: { type: Type.STRING, description: 'blocking or warning' },
                message: { type: Type.STRING },
                citation: { type: Type.STRING },
                suggestion: { type: Type.STRING },
              },
              required: ['dimension', 'severity', 'message', 'citation', 'suggestion'],
            },
          },
        },
        required: ['aiSummary', 'issues'],
      },
    },
  });

  const data = parseJsonSafe<{ aiSummary: string; issues: any[] }>(
    response.text,
    'AI 子审失败'
  );

  const validDims = new Set([
    'canon',
    'character_voice',
    'timeline',
    'knows',
    'foreshadowing',
    'hook_desire',
    'pacing',
    'prose_deslop',
  ]);

  const issues: AuditIssue[] = (data.issues || []).map((item, idx) => ({
    id: `ai-${contract.chapter}-${idx}-${Date.now()}`,
    dimension: validDims.has(item.dimension) ? item.dimension : 'canon',
    severity: item.severity === 'blocking' ? 'blocking' : 'warning',
    source: 'ai_review',
    message: item.message,
    citation: item.citation,
    suggestion: item.suggestion,
  }));

  return {
    aiSummary: data.aiSummary,
    issues,
  };
}

export async function runBoundedRevise(
  book: BookProject,
  chapterItem: ChapterItem,
  issuesToFix: string
): Promise<string> {
  const slopList = [
    ...DEFAULT_SLOP_LIST[book.language],
    ...(book.bible.voice.customBanned || []),
  ];

  const response = await callGenerateContent({
    contents: [
      `执行 long-novel-workflow Step 3.4【有界局部修订 (Bounded Revise)】。`,
      `原则：只修改与下述问题直接相关的局部句子或段落，保持其余未出错段落、人物声音、剧情细节与原本篇幅不动！禁止整章推倒重写，也严禁删减或压缩已有合理正文内容（4000 字以内均属正常合理篇幅）。`,
      `硬约束：${book.bible.hardConstraints.join('；')}`,
      `禁用 AI 套话：${slopList.join(' / ')}`,
      `本章必须保留的钩子：${chapterItem.contract.hook}`,
      ``,
      `【本次需要修复的问题】\n${issuesToFix}`,
      ``,
      `【原正文】\n${chapterItem.prose}`,
      ``,
      `请输出修订后的完整章节正文（纯正文，不要加解释）。`,
    ].join('\n'),
    config: {
      systemInstruction:
        '你是谨慎的文本外科医生。仅做最小必要局部修补以消除阻断问题，完整保留原稿的优秀句子与语调。',
    },
  });

  return stripLeadingFrontmatter(response.text || '');
}

export async function runPrepareCommit(
  book: BookProject,
  chapterItem: ChapterItem
): Promise<CommitProposal> {
  const { contract, prose } = chapterItem;
  const foreshadowCtx = buildForeshadowingPromptContext(book, contract.chapter);

  const response = await callGenerateContent(
    {
      contents: [
        `为《${book.title}》第 ${contract.chapter} 章准备 CHAPTER_COMMIT 原子提交提案。`,
        `已有人物列表：${book.bible.characters.map((c) => c.name).join('、')}`,
        foreshadowCtx.text,
        `本章合同声明埋设伏笔：${contract.foreshadowingPlanted.join(', ') || '无'}；声明兑现伏笔：${contract.foreshadowingPaid.join(', ') || '无'}`,
        ``,
        `【本章正文】\n${prose}`,
        ``,
        `请严格从本章正文中抽取真实发生了的事实（绝不可脑补正文中未写出的情节，也绝不可把前面章节不存在的设定追认为已有伏笔）：`,
        `1. summaryLine: 一句话章节摘要`,
        `2. timelineDayLabel & timelineEvent: 本章时间线推进`,
        `3. characterStateUpdates: 本章出场人物的最新状态`,
        `4. newCharacters: 本章正文中新出场且有真实姓名（不在上述已有人物列表中，且非“黑衣人/路人/店小二”等无名泛称）的关键新配角或新对手档案；无则输出空数组 []。`,
        `5. newKnowsEntries: 本章某个角色明确新得知的事实（必须在本章正文里有依据）`,
        `6. newForeshadowing: 仅限本章正文中新埋下且【台账中尚不存在】的悬念伏笔（ID 必须从 ${foreshadowCtx.nextSuggestedId} 起顺延，带 payoffDue 预期章号；为每条新伏笔标定 scope（series 全书主线 / volume 卷级 / episode 单集线）与 kind（reveal 真相揭示 / conflict 冲突 / relationship 关系 / other 其他）；新埋伏笔的 payoffDue 不得晚于本书完结窗口（${targetSummaryLine(book)}）；无则输出空数组）`,
        `7. paidForeshadowingIds: 本章正文中已经明确完结/揭晓的已有伏笔 ID 列表（必须严格来自上方【未结/逾期伏笔台账】，严禁自造 ID）`,
        `8. updatedForeshadowing: 若上方【已逾期/未结伏笔】在本章正文被引入推进但尚未彻底完结，或需顺延，在此标明 status ("progressing" | "deferred")、大于 ${contract.chapter} 的新兑现章号 newPayoffDue 及简短说明 note；无则输出空数组。`,
      ].join('\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summaryLine: { type: Type.STRING },
            timelineDayLabel: { type: Type.STRING },
            timelineEvent: { type: Type.STRING },
            characterStateUpdates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  characterName: { type: Type.STRING },
                  currentState: { type: Type.STRING },
                },
                required: ['characterName', 'currentState'],
              },
            },
            newCharacters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  age: { type: Type.STRING },
                  role: { type: Type.STRING },
                  dna: { type: Type.STRING },
                  want: { type: Type.STRING },
                  need: { type: Type.STRING },
                  flaw: { type: Type.STRING },
                  arc: { type: Type.STRING },
                },
                required: ['name', 'age', 'role', 'dna', 'want', 'flaw'],
              },
            },
            newKnowsEntries: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  characterName: { type: Type.STRING },
                  fact: { type: Type.STRING },
                  knows: { type: Type.BOOLEAN },
                  note: { type: Type.STRING },
                },
                required: ['characterName', 'fact', 'knows'],
              },
            },
            newForeshadowing: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  payoffDue: { type: Type.INTEGER },
                  thread: { type: Type.STRING },
                  scope: { type: Type.STRING },
                  kind: { type: Type.STRING },
                },
                required: ['id', 'payoffDue', 'thread'],
              },
            },
            paidForeshadowingIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            updatedForeshadowing: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  status: { type: Type.STRING },
                  newPayoffDue: { type: Type.INTEGER },
                  note: { type: Type.STRING },
                },
                required: ['id', 'status', 'newPayoffDue'],
              },
            },
          },
          required: [
            'summaryLine',
            'timelineDayLabel',
            'timelineEvent',
            'characterStateUpdates',
            'newCharacters',
            'newKnowsEntries',
            'newForeshadowing',
            'paidForeshadowingIds',
            'updatedForeshadowing',
          ],
        },
      },
    },
    true
  );

  const data = parseJsonSafe<any>(response.text, '提取原子提交提案失败');
  const sanitized = sanitizeCommitForeshadowing(
    book,
    contract.chapter,
    data.newForeshadowing,
    data.paidForeshadowingIds,
    data.updatedForeshadowing
  );
  const newCharacters = sanitizeNewCharacters(book, data.newCharacters, contract.chapter);

  return {
    chapter: contract.chapter,
    summaryLine: data.summaryLine,
    timelineDayLabel: data.timelineDayLabel || `Day ${contract.chapter}`,
    timelineEvent: data.timelineEvent,
    characterStateUpdates: data.characterStateUpdates || [],
    newCharacters,
    newKnowsEntries: (data.newKnowsEntries || []).map((k: any) => ({
      characterName: k.characterName,
      fact: k.fact,
      knows: Boolean(k.knows),
      learnedChapter: k.knows ? contract.chapter : null,
      note: k.note || `第 ${contract.chapter} 章新增`,
    })),
    newForeshadowing: sanitized.newForeshadowing,
    paidForeshadowingIds: sanitized.paidForeshadowingIds,
    updatedForeshadowing: sanitized.updatedForeshadowing,
  };
}

export async function runArcReview(book: BookProject): Promise<{
  diagnosis: string;
  staleThreadAdvice: string[];
  nextArcGoal: string;
  nextArcBeats: string[];
  nextChaptersPlan: { chapter: number; goal: string; desire: string; hook: string }[];
}> {
  const nextStart = book.state.nextChapter;

  const response = await callGenerateContent(
    {
      contents: [
      `执行 long-novel-workflow Step 4【卷末 / 阶段复盘 (Arc Review)】。`,
      `书名：《${book.title}》`,
      `全书罗盘：${book.outline.compass.endDirection} | 核心悬念：${book.outline.compass.centralQuestion}`,
      `目标：${targetSummaryLine(book)}`,
      // 阶段复盘是唯二可看完整终局蓝图的步骤（另一是圣经生成）：评估当前节奏
      // 能否按期落地终局，并据此规划下一卷。
      book.outline.compass.endingSummary
        ? `一句话核心结局：${book.outline.compass.endingSummary}`
        : '一句话核心结局：暂未设定。',
      book.outline.compass.plannedEnding
        ? `完整终局蓝图（导演专用，仅供复盘判断节奏是否来得及，不可写入正文）：${book.outline.compass.plannedEnding}`
        : '完整终局蓝图：暂未设定。',
      `已提交摘要：\n${book.state.summaries.map((s) => `Ch${s.chapter}: ${s.summary}`).join('\n')}`,
      `人物快照：\n${book.state.characterStates.map((c) => `- ${c.characterName}: ${c.currentState}`).join('\n')}`,
      `伏笔台账：\n${book.state.foreshadowing.map((f) => `${f.id} [${f.status}] due:${f.payoffDue}: ${f.thread}`).join('\n')}`,
      `请从第 ${nextStart} 章起规划接下来 5 章的新节奏（desire 从 ${ALL_DESIRE_KEYS_LIST} 中选择）、配角群像召回与伏笔回收方案，并评估当前节奏能否按期落地终局（若来不及，指出需要压缩或归档的线）。`,
    ].join('\n\n'),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          diagnosis: { type: Type.STRING },
          staleThreadAdvice: { type: Type.ARRAY, items: { type: Type.STRING } },
          nextArcGoal: { type: Type.STRING },
          nextArcBeats: { type: Type.ARRAY, items: { type: Type.STRING } },
          nextChaptersPlan: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                chapter: { type: Type.INTEGER },
                goal: { type: Type.STRING },
                desire: { type: Type.STRING },
                hook: { type: Type.STRING },
              },
              required: ['chapter', 'goal', 'desire', 'hook'],
            },
          },
        },
        required: ['diagnosis', 'staleThreadAdvice', 'nextArcGoal', 'nextArcBeats', 'nextChaptersPlan'],
      },
    },
  },
    true
  );

  return parseJsonSafe(response.text, '阶段复盘生成失败');
}

export async function runImportManuscript(params: {
  title: string;
  language: 'zh' | 'en';
  platform: string;
  rawText: string;
}): Promise<BookProject> {
  const response = await callGenerateContent({
    contents: [
      `执行 long-novel-workflow Step 5【简版旧稿导入 (Simple Manuscript Import)】。`,
      `任务：将作者提供的旧稿正文切分识别为章节，并反向推导出《故事圣经》、《人物档案》、《Knows 边界》、《伏笔台账》与《逐章摘要》。`,
      `书名：${params.title || '未命名旧稿'}`,
      `语言：${params.language}`,
      `目标平台：${params.platform}`,
      `旧稿正文：\n${params.rawText.slice(0, 45000)}`,
    ].join('\n\n'),
    config: {
      systemInstruction:
        '你是 long-novel-workflow 旧稿重建专家。严格基于文本事实反推，不得无中生有，将切分后的原章节保留在 chapters 中。',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          premise: { type: Type.STRING },
          era: { type: Type.STRING },
          setting: { type: Type.STRING },
          hardConstraints: { type: Type.ARRAY, items: { type: Type.STRING } },
          narratorVoice: { type: Type.STRING },
          dialogueDistinctness: { type: Type.STRING },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                age: { type: Type.STRING },
                role: { type: Type.STRING },
                dna: { type: Type.STRING },
                want: { type: Type.STRING },
                need: { type: Type.STRING },
                flaw: { type: Type.STRING },
                arc: { type: Type.STRING },
              },
              required: ['name', 'age', 'role', 'dna', 'want', 'need', 'flaw', 'arc'],
            },
          },
          foreshadowing: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                planted: { type: Type.INTEGER },
                payoffDue: { type: Type.INTEGER },
                thread: { type: Type.STRING },
              },
              required: ['id', 'planted', 'payoffDue', 'thread'],
            },
          },
          knows: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                characterName: { type: Type.STRING },
                fact: { type: Type.STRING },
                knows: { type: Type.BOOLEAN },
                learnedChapter: { type: Type.INTEGER },
              },
              required: ['characterName', 'fact', 'knows'],
            },
          },
          importedChapters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                chapter: { type: Type.INTEGER },
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                desire: { type: Type.STRING },
                desirePayoff: { type: Type.STRING },
                hook: { type: Type.STRING },
                transition: { type: Type.STRING },
                characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                prose: { type: Type.STRING },
              },
              required: ['chapter', 'title', 'summary', 'desire', 'desirePayoff', 'hook', 'transition', 'prose'],
            },
          },
        },
        required: [
          'title',
          'premise',
          'era',
          'setting',
          'hardConstraints',
          'narratorVoice',
          'dialogueDistinctness',
          'characters',
          'foreshadowing',
          'knows',
          'importedChapters',
        ],
      },
    },
  });

  const parsed = parseJsonSafe<any>(response.text, '旧稿反推解析失败');
  const now = new Date().toISOString();
  const characters: CharacterProfile[] = (parsed.characters || []).map((c: any, idx: number) => ({
    id: `char-imp-${idx}`,
    ...c,
  }));

  const chapters: ChapterItem[] = (parsed.importedChapters || []).map((c: any) => {
    const resolvedDesire: DesireKey =
      c.desire in DESIRE_SPECS ? (c.desire as DesireKey) : 'curiosity';
    return {
      chapter: c.chapter,
      status: 'committed' as const,
      updatedAt: now,
      contract: {
        chapter: c.chapter,
        title: formatChapterTitle(c.chapter, c.title, params.language),
        language: params.language,
        desire: resolvedDesire,
        desirePayoff: c.desirePayoff,
        payoffSize: c.chapter % 10 === 0 ? 'big' : 'small',
        hook: c.hook,
        transition: c.transition,
        mustHappen: c.summary,
        mustNot: '不可违背已重建的圣经硬约束与人物 knows 边界',
        characters: c.characters || characters.map((ch) => ch.name),
        foreshadowingPlanted: [],
        foreshadowingPaid: [],
        isProbe: true,
      },
      prose: c.prose,
    };
  });

  const committedNumbers = chapters.map((c) => c.chapter).sort((a, b) => a - b);
  const maxCh = committedNumbers.length > 0 ? committedNumbers[committedNumbers.length - 1] : 0;

  return {
    id: `book-${Date.now()}`,
    title: parsed.title || params.title || '旧稿续写工程',
    language: params.language,
    platform: params.platform,
    genreId: 'imported',
    formula: 'imported-manuscript + continuity-kernel',
    gate1Approved: true,
    gate2Approved: true,
    // 导入的旧稿默认不设目标章数（老书退化、自由连载）；建好后到台账页补填目标与结局。
    bookStatus: 'ongoing',
    outlineRevision: 1,
    bible: {
      premise: parsed.premise,
      era: parsed.era,
      setting: parsed.setting,
      worldRules: '根据导入旧稿反推重建，请在 Gate 1 确认或补充硬规则。',
      locations: [],
      hardConstraints: parsed.hardConstraints || [],
      cultureAnchors: {
        clothing: '按导入旧稿既有描写延续',
        food: '按导入旧稿既有描写延续',
        objects: '按导入旧稿既有描写延续',
        landscape: parsed.setting,
        colour: '克制写实',
      },
      voice: {
        narrator: parsed.narratorVoice,
        dialogueDistinctness: parsed.dialogueDistinctness,
        customBanned: [],
      },
      characters,
    },
    outline: {
      compass: {
        endDirection: '延续旧稿主线并收束当前未结伏笔',
        activeLongThreads: (parsed.foreshadowing || []).map((f: any) => f.id).join('、'),
        scaleEstimate: '长篇连载（从第 ' + (maxCh + 1) + ' 章续写）',
        centralQuestion: parsed.premise,
        whatBookIsNot: '不随意推翻旧稿已确立的事实与人物性格',
      },
      currentArc: {
        rangeLabel: `第 ${maxCh + 1}–${maxCh + 30} 章（续写卷）`,
        goal: '承接旧稿末端钩子继续推进',
        beats: ['确认反推圣经（Gate 1）', '起草第 ' + (maxCh + 1) + ' 章合同', '逐章审计提交'],
        payoff: '阶段性回收旧稿伏笔',
        newElementsNote: '续写前请核对人物 knows 清单',
      },
      roadmap: chapters.map((c) => ({
        chapter: c.chapter,
        goal: c.contract.mustHappen,
        desire: (c.contract.desire !== 'auto' ? c.contract.desire : 'curiosity') as DesireKey,
        hook: c.contract.hook,
        status: 'committed' as const,
      })),
    },
    state: {
      committedChapters: committedNumbers,
      nextChapter: maxCh + 1,
      summaries: (parsed.importedChapters || []).map((c: any) => ({
        chapter: c.chapter,
        summary: c.summary,
      })),
      characterStates: characters.map((c) => ({
        characterName: c.name,
        currentState: `${c.role}，当前目标：${c.want}`,
      })),
      foreshadowing: (parsed.foreshadowing || []).map((f: any) => ({
        id: f.id,
        planted: f.planted || 1,
        payoffDue: f.payoffDue || maxCh + 6,
        status: 'open' as const,
        thread: f.thread,
      })),
      knows: (parsed.knows || []).map((k: any, idx: number) => ({
        id: `k-imp-${idx}`,
        characterName: k.characterName,
        fact: k.fact,
        knows: Boolean(k.knows),
        learnedChapter: k.knows ? k.learnedChapter || 1 : null,
      })),
      timeline: (parsed.importedChapters || []).map((c: any) => ({
        chapter: c.chapter,
        dayLabel: `Ch ${c.chapter}`,
        event: c.summary,
      })),
    },
    chapters,
    createdAt: now,
    updatedAt: now,
  };
}

export async function runAutoChapterBundle(
  book: BookProject,
  chapterNum: number,
  existingContract?: ChapterContract,
  authorGuidance?: string
): Promise<{
  contract: ChapterContract;
  prose: string;
  proposal: CommitProposal;
}> {
  const langSpec = LANGUAGE_SPECS[book.language];
  const slopList = [
    ...DEFAULT_SLOP_LIST[book.language],
    ...(book.bible.voice.customBanned || []),
  ];
  const prevChapter = book.chapters.find((c) => c.chapter === chapterNum - 1);
  const roadmapItem = book.outline.roadmap.find((r) => r.chapter === chapterNum);
  const foreshadowCtx = buildForeshadowingPromptContext(book, chapterNum);
  const castRosterCtx = buildCastRosterPromptContext(book, chapterNum);
  const recentChapters = book.chapters
    .filter((c) => c.chapter < chapterNum && c.chapter >= chapterNum - 2)
    .sort((a, b) => a.chapter - b.chapter);

  // 连写循环也可能选中中间的草稿章（后章已存在）：同单章写章，后章衔接必须喂进去。
  const nextChapter = book.chapters.find((c) => c.chapter === chapterNum + 1);
  const nextSummary = nextChapter
    ? book.state.summaries.find((s) => s.chapter === nextChapter.chapter)?.summary || '（无摘要）'
    : '';
  const forwardBlock = nextChapter
    ? [
        `【后章衔接】本章不是最新章，后面已有第 ${nextChapter.chapter} 章《${nextChapter.contract.title}》写完并定稿，写本章必须与它衔接：`,
        `下一章开篇交接（它写明了如何承接本章）：${nextChapter.contract.transition}`,
        `下一章必须发生：${nextChapter.contract.mustHappen}`,
        `下一章摘要：${nextSummary}`,
        `下一章正文开头（前 600 字，已定稿，不可改动）：\n${nextChapter.prose.slice(0, 600)}`,
        `要求：本章结尾必须自然接到下一章开头——同一时间、同一地点、同一批人物、同一状态；不得改动下一章开头已经写定的人物、地点、对话与事实；不得让下一章的开篇失去前提；不得提前写掉下一章才发生的剧情。`,
      ].join('\n')
    : '';

  const manualDesire: DesireKey | null =
    existingContract?.desire &&
    existingContract.desire !== 'auto' &&
    existingContract.desire in DESIRE_SPECS
      ? (existingContract.desire as DesireKey)
      : null;

  const manualPayoff: PayoffSize | null =
    existingContract?.payoffSize && existingContract.payoffSize !== 'auto'
      ? existingContract.payoffSize
      : null;

  const lengthRule =
    book.language === 'zh'
      ? '正文 2200–3500 字（4000 中文字符以内均可，充分展开动作与对白细节）'
      : '1600–2200 words (within 1500–2500 words)';

  const desireInstruction = manualDesire
    ? `作者已指定欲望类型：${manualDesire}(${DESIRE_SPECS[manualDesire].labelZh})，请严格执行并在正文中充分兑现。`
    : `contract.desire 当前为「AI 自动判断选择 (auto)」，请从以下 8 种核心读者欲望中自主择一最精准驱动本章戏剧张力的类型并写入 contract.desire：${ALL_DESIRE_GUIDE}。`;

  const payoffInstruction =
    (existingContract?.chapterKind ?? 'main') === 'main' &&
    bigCadenceFor(book.outline.compass.targetChapters) != null &&
    chapterNum % bigCadenceFor(book.outline.compass.targetChapters)! === 0
      ? `第 ${chapterNum} 章是大节点章（bigCadence=${bigCadenceFor(book.outline.compass.targetChapters)}），contract.payoffSize 必须为 "big"，并在正文中彻底交付阶段大高潮/大反转/大破局！`
      : manualPayoff
      ? `作者已指定兑现级别 payoffSize="${manualPayoff}"，请在正文中严格匹配该烈度的戏剧兑现！`
      : `contract.payoffSize 当前为「AI 自动判断并执行 (auto)」，请自主选择 "small" 或 "big"${chapterNum % 3 === 0 ? '（本章为 3 的倍数节点，不可为 none）' : ''}，并在正文中扎实写出对应强度的实体行动兑现与节奏收束！`;

  // 单次合并路径（省配额 opt-in 才走）：合同与正文一次请求。提示词里可带一句话
  // 结局摘要供合同把关，但须明令不得外露结尾细节；完整终局蓝图绝不出现。
  // 默认两步隔离时工作台不调本函数，改走先合同后正文的两步。
  const bundleKind = (existingContract?.chapterKind ?? 'main') as 'main' | 'epilogue' | 'extra';
  const bundlePhaseInfo =
    bundleKind === 'main'
      ? getPhaseInfo(
          chapterNum,
          1,
          book.outline.compass.targetChapters,
          book.outline.compass.tolerance
        )
      : null;

  const prompt = [
    `为长篇小说《${book.title}》第 ${chapterNum} 章执行【单次全自动创作闭环】：一次性输出本章合同（contract）、完整正文（prose）与正史状态变更（commit）。`,
    `核心前提：${book.bible.premise}`,
    `硬约束（绝不可打破）：\n${book.bible.hardConstraints.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    `叙事语调：${book.bible.voice.narrator} | 对白区分：${book.bible.voice.dialogueDistinctness}`,
    `文化锚点：衣(${book.bible.cultureAnchors.clothing}) 食(${book.bible.cultureAnchors.food}) 器(${book.bible.cultureAnchors.objects}) 景(${book.bible.cultureAnchors.landscape}) 色(${book.bible.cultureAnchors.colour})`,
    castRosterCtx,
    buildNamingConstraint(book.language),
    `当前 Knows 边界（角色只能猜疑，不可提前知晓未知事实）：\n${book.state.knows.map((k) => `- ${k.characterName} [${k.knows ? '已知' : '未知'}]: ${k.fact}`).join('\n')}`,
    foreshadowCtx.text,
    prevChapter ? `上一章（第 ${chapterNum - 1} 章）交接 transition：${prevChapter.contract.transition}` : '本章为第 1 章。',
    roadmapItem ? `大纲规划参考：${roadmapItem.goal}（参考欲望：${roadmapItem.desire}，参考钩子：${roadmapItem.hook}）` : '',
    existingContract && (existingContract.desirePayoff || existingContract.mustHappen)
      ? `作者已填合同要点参考：标题=${existingContract.title}，兑现=${existingContract.desirePayoff}，必须发生=${existingContract.mustHappen}，钩子=${existingContract.hook}`
      : '',
    `前情摘要：\n${book.state.summaries.slice(-6).map((s) => `- Ch${s.chapter}: ${s.summary}`).join('\n') || '无'}`,
    bundlePhaseInfo ? bundlePhaseInfo.phaseLine : '',
    bundleKind !== 'main'
      ? `本章为${bundleKind === 'epilogue' ? '后记' : '番外'}：不计入主线进度，豁免阶段/节奏/大兑现检查。`
      : '',
    book.outline.compass.endingSummary
      ? `一句话核心结局（仅供合同把关方向；正文里绝不写出、绝不暗示、绝不提前泄底）：${book.outline.compass.endingSummary}`
      : '',
    ...recentChapters.map((c) => `--- 第 ${c.chapter} 章参考原文 ---\n${c.prose}`),
    `【防重写铁律】上面“参考原文”是已经写完的前章正文，只供你衔接剧情、保持人设与语调，绝不是让你重写的内容：本章必须从上一章结尾之后开始写（按上一章交接 transition 承接），只写新发生的剧情；参考原文里已经写过的场景、对话、段落，一句也不许照抄或换词重写，同一件事不许换个说法再讲一遍；只有剧情确实需要回望时，才允许用一两句话简要提及前情，不得展开复述。`,
    forwardBlock,
    `写作硬规矩：`,
    `1. 章节标题 contract.title 必须以“第${chapterNum}章”开头（如“第${chapterNum}章 ……”）。`,
    `2. ${desireInstruction}`,
    `3. ${payoffInstruction}`,
    `4. 【群像与人物丰富度铁律】严禁写成主角自言自语的独角戏！每章尽可能安排 2–4 名有真实姓名的人物发生对白、冲突或协作；可优先召回花名册中缺席多章的已有角色。若本章正文引入了新的配角、对手、线人、关键人物，严禁只给“黑衣人/神秘人/管家/店小二/路人”这类无名泛称，必须给他们起好不撞名的真实姓名，写入 commit.newCharacters 完整建档，并同时加入 contract.characters！`,
    `5. 绝对禁止出现以下 AI 套话：${slopList.join(' / ')}`,
    `6. 段落风格：${langSpec.paragraphStyle}`,
    `7. 篇幅要求：${lengthRule}；hook 必须不少于 15 字且真实落在正文结尾。`,
    `8. 严禁虚构前面章节从未出现过的旧伏笔；若有已逾期/指定本章引入的伏笔，必须在正文中引入推进/兑现，或通过 updatedForeshadowing 说明顺延。`,
    authorGuidance ? `作者补充要求：${authorGuidance}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await callGenerateContent({
    contents: prompt,
    config: {
      systemInstruction:
        '你是 long-novel-workflow 全自动创作引擎。你严格遵守故事圣经硬约束、Knows 边界、伏笔真实性规则与去 AI 味词表，自主判断/执行欲望与兑现级别，并始终维持有血有肉的群像角色互动（绝不让配角消失或变成无名工具人）。',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          contract: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              desire: { type: Type.STRING },
              desirePayoff: { type: Type.STRING },
              payoffSize: { type: Type.STRING },
              hook: { type: Type.STRING },
              transition: { type: Type.STRING },
              mustHappen: { type: Type.STRING },
              mustNot: { type: Type.STRING },
              characters: { type: Type.ARRAY, items: { type: Type.STRING } },
              foreshadowingPlanted: { type: Type.ARRAY, items: { type: Type.STRING } },
              foreshadowingPaid: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              'title',
              'desire',
              'desirePayoff',
              'payoffSize',
              'hook',
              'transition',
              'mustHappen',
              'mustNot',
              'characters',
              'foreshadowingPlanted',
              'foreshadowingPaid',
            ],
          },
          prose: { type: Type.STRING },
          commit: {
            type: Type.OBJECT,
            properties: {
              summaryLine: { type: Type.STRING },
              timelineDayLabel: { type: Type.STRING },
              timelineEvent: { type: Type.STRING },
              characterStateUpdates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    characterName: { type: Type.STRING },
                    currentState: { type: Type.STRING },
                  },
                  required: ['characterName', 'currentState'],
                },
              },
              newCharacters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    age: { type: Type.STRING },
                    role: { type: Type.STRING },
                    dna: { type: Type.STRING },
                    want: { type: Type.STRING },
                    need: { type: Type.STRING },
                    flaw: { type: Type.STRING },
                    arc: { type: Type.STRING },
                    speechStyle: { type: Type.STRING },
                    debutPlan: { type: Type.STRING },
                  },
                  required: ['name', 'age', 'role', 'dna', 'want', 'flaw'],
                },
              },
              newKnowsEntries: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    characterName: { type: Type.STRING },
                    fact: { type: Type.STRING },
                    knows: { type: Type.BOOLEAN },
                    note: { type: Type.STRING },
                  },
                  required: ['characterName', 'fact', 'knows'],
                },
              },
              newForeshadowing: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    payoffDue: { type: Type.INTEGER },
                    thread: { type: Type.STRING },
                  },
                  required: ['id', 'payoffDue', 'thread'],
                },
              },
              paidForeshadowingIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              updatedForeshadowing: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    status: { type: Type.STRING },
                    newPayoffDue: { type: Type.INTEGER },
                    note: { type: Type.STRING },
                  },
                  required: ['id', 'status', 'newPayoffDue'],
                },
              },
            },
            required: [
              'summaryLine',
              'timelineDayLabel',
              'timelineEvent',
              'characterStateUpdates',
              'newCharacters',
              'newKnowsEntries',
              'newForeshadowing',
              'paidForeshadowingIds',
              'updatedForeshadowing',
            ],
          },
        },
        required: ['contract', 'prose', 'commit'],
      },
    },
  });

  const parsed = parseJsonSafe<any>(response.text, '单章全自动生成失败');
  const c = parsed.contract;
  const cm = parsed.commit;

  const validDesire: DesireKey =
    manualDesire ||
    (c.desire in DESIRE_SPECS
      ? (c.desire as DesireKey)
      : roadmapItem?.desire && roadmapItem.desire in DESIRE_SPECS
      ? roadmapItem.desire
      : 'curiosity');

  const enforcedSize: PayoffSize =
    chapterNum % 10 === 0
      ? 'big'
      : manualPayoff
      ? manualPayoff
      : c.payoffSize === 'big'
      ? 'big'
      : c.payoffSize === 'none' && chapterNum % 3 !== 0
      ? 'none'
      : 'small';

  const cleanNewChars = sanitizeNewCharacters(book, cm.newCharacters, chapterNum);
  const allowedNames = new Set([
    ...book.bible.characters.map((bc) => bc.name),
    ...cleanNewChars.map((nc) => nc.name),
  ]);

  const matchedChars = Array.from(
    new Set(
      (c.characters || [])
        .map((n: string) => String(n || '').trim())
        .filter((name: string) => allowedNames.has(name))
    )
  ) as string[];
  for (const nc of cleanNewChars) {
    if (!matchedChars.includes(nc.name)) {
      matchedChars.push(nc.name);
    }
  }
  const finalBundleChars =
    matchedChars.length > 0
      ? matchedChars
      : book.bible.characters.slice(0, Math.min(3, book.bible.characters.length)).map((bc) => bc.name);

  const sanitizedContractF = sanitizeContractForeshadowing(
    book,
    chapterNum,
    c.foreshadowingPlanted,
    c.foreshadowingPaid
  );
  const sanitizedCommitF = sanitizeCommitForeshadowing(
    book,
    chapterNum,
    cm.newForeshadowing,
    cm.paidForeshadowingIds,
    cm.updatedForeshadowing
  );

  return {
    contract: {
      chapter: chapterNum,
      title: formatChapterTitle(chapterNum, c.title, book.language),
      language: book.language,
      desire: validDesire,
      desirePayoff: c.desirePayoff,
      payoffSize: enforcedSize,
      hook: c.hook,
      transition: c.transition,
      mustHappen: c.mustHappen,
      mustNot: c.mustNot,
      characters: finalBundleChars,
      foreshadowingPlanted: sanitizedContractF.foreshadowingPlanted,
      foreshadowingPaid: sanitizedContractF.foreshadowingPaid,
      isProbe: Boolean(existingContract?.isProbe),
    },
    prose: stripLeadingFrontmatter(parsed.prose || ''),
    proposal: {
      chapter: chapterNum,
      summaryLine: cm.summaryLine,
      timelineDayLabel: cm.timelineDayLabel || `Day ${chapterNum}`,
      timelineEvent: cm.timelineEvent,
      characterStateUpdates: cm.characterStateUpdates || [],
      newCharacters: cleanNewChars,
      newKnowsEntries: (cm.newKnowsEntries || []).map((k: any) => ({
        characterName: k.characterName,
        fact: k.fact,
        knows: Boolean(k.knows),
        learnedChapter: k.knows ? chapterNum : null,
        note: k.note || `第 ${chapterNum} 章新增`,
      })),
      newForeshadowing: sanitizedCommitF.newForeshadowing,
      paidForeshadowingIds: sanitizedCommitF.paidForeshadowingIds,
      updatedForeshadowing: sanitizedCommitF.updatedForeshadowing,
    },
  };
}

