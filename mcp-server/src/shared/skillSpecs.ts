import type { BookProject, GenrePackSpec, LanguageSpec, DesireKey } from './types.ts';

export const REPO_META = {
  repoUrl: 'https://github.com/zilintea/long-novel-workflow',
  name: 'long-novel-workflow',
  version: 'v2.0.0',
  license: 'MIT',
  updatedAt: '2026-11-15',
  tagline: '小说是一台状态机：文件当真相，支持全自动与导演模式双轨推进，先圣经大纲与黄金三章，再以章节合同、8大核心欲望(AI自动择优)、动态群像、阻断审计与原子提交连续推进任意章数。',
};

export function formatChapterTitle(
  chapterNum: number,
  rawTitle: string | undefined | null,
  language: 'zh' | 'en' = 'zh'
): string {
  const raw = (rawTitle || '').trim();
  const stripped = raw
    .replace(/^第\s*\d+\s*章[\s：:·\-—]*/i, '')
    .replace(/^Chapter\s*\d+[\s：:·\-—]*/i, '')
    .trim();

  if (language === 'en' && stripped && !/[\u4e00-\u9fa5]/.test(stripped)) {
    return `Chapter ${chapterNum}: ${stripped}`;
  }
  if (language === 'en' && !stripped) {
    return `第${chapterNum}章`;
  }
  return stripped ? `第${chapterNum}章 ${stripped}` : `第${chapterNum}章`;
}

export function allocateNextForeshadowingId(
  existingIds: Iterable<string>,
  extraReserved: Iterable<string> = []
): string {
  let maxNum = 0;
  const used = new Set<string>();
  for (const id of [...existingIds, ...extraReserved]) {
    const clean = (id || '').trim().toUpperCase();
    if (!clean) continue;
    used.add(clean);
    const match = clean.match(/^F0*(\d+)$/i);
    if (match) {
      maxNum = Math.max(maxNum, Number(match[1]));
    }
  }
  let next = maxNum + 1;
  while (used.has(`F${String(next).padStart(2, '0')}`)) {
    next += 1;
  }
  return `F${String(next).padStart(2, '0')}`;
}

export const DESIRE_SPECS: Record<
  DesireKey,
  { key: DesireKey; labelZh: string; labelEn: string; description: string }
> = {
  curiosity: {
    key: 'curiosity',
    labelZh: '好奇',
    labelEn: 'Curiosity',
    description: '想知道发生了什么、背后的真相或隐藏的秘密是什么。',
  },
  'identification-upgrade': {
    key: 'identification-upgrade',
    labelZh: '代入升级',
    labelEn: 'Identification Upgrade',
    description: '跟随主角变强、变富、破局或获得更自由的掌控感。',
  },
  'revenge-compensation': {
    key: 'revenge-compensation',
    labelZh: '复仇补偿',
    labelEn: 'Revenge & Compensation',
    description: '看到冤屈被洗雪、轻视被当场打脸或代价被追讨。',
  },
  'being-loved': {
    key: 'being-loved',
    labelZh: '被爱拉扯',
    labelEn: 'Being Loved',
    description: '被坚定选择、被偏爱、被保护，以及克制张力下的情感拉扯。',
  },
  'escape-comfort': {
    key: 'escape-comfort',
    labelZh: '逃逸安慰',
    labelEn: 'Escape & Comfort',
    description: '暂时脱离高压环境，进入安全、温暖、秩序井然的喘息时刻。',
  },
  'survival-breakout': {
    key: 'survival-breakout',
    labelZh: '求生破局',
    labelEn: 'Survival & Breakout',
    description: '身陷绝境、追杀或致命规则封锁下，靠胆识与细节杀出一条生路。',
  },
  'power-scheme': {
    key: 'power-scheme',
    labelZh: '博弈掌权',
    labelEn: 'Power & Scheme',
    description: '借势做局、拆招反制、多方利益周旋并争得主动权或话语席位。',
  },
  'bond-resonance': {
    key: 'bond-resonance',
    labelZh: '羁绊共鸣',
    labelEn: 'Bond & Resonance',
    description: '与盟友、师徒或宿敌在并肩/对峙中建立信任托付、守望与信念碰撞。',
  },
};

export const HOOK_TYPE_SPECS = [
  { id: 'reversal', label: '反转 Reversal', desc: '你原本相信的事其实是错的' },
  { id: 'countdown', label: '倒计时 Countdown', desc: '一个迫在眉睫的死线变得真实可感' },
  { id: 'new-information', label: '新信息 New Info', desc: '一条改写前三章认知的新事实' },
  { id: 'identity', label: '身份揭露 Identity', desc: '某个人并非他自称的身份' },
  { id: 'choice', label: '两难抉择 Choice', desc: '两个珍视之物只能保住一个' },
  { id: 'threat', label: '威胁迫近 Threat', desc: '读者在乎的人或事正面临真实危险' },
  { id: 'arrival', label: '兑现降临 Arrival', desc: '一直承诺的人/事终于出现，但出乎意料' },
];

export const LANGUAGE_SPECS: Record<'zh' | 'en', LanguageSpec> = {
  zh: {
    code: 'zh',
    name: '中文 (Chinese)',
    minSize: 2000,
    maxSize: 4000,
    probeMinSize: 800,
    unit: 'chars',
    unitLabel: '字（不含空白）',
    hookFirstWindow: 500,
    paragraphStyle: '短段落（1–3 句），强对话驱动，适合切出 3 秒短视频钩子',
    tokenBudgetPerChapter: 12000,
    platforms: ['番茄小说 (Fanqie)', '七猫 (Qimao)', '起点 (Qidian)', '晋江 (Jinjiang)'],
  },
  en: {
    code: 'en',
    name: 'English',
    minSize: 1500,
    maxSize: 2500,
    probeMinSize: 600,
    unit: 'words',
    unitLabel: 'Words',
    hookFirstWindow: 300,
    paragraphStyle: 'Short paragraphs (1–3 sentences), dialogue-heavy, progression-focused',
    tokenBudgetPerChapter: 12000,
    platforms: ['Royal Road', 'Wattpad', 'Webnovel'],
  },
};

export const GENRE_PACKS: GenrePackSpec[] = [
  {
    id: 'fanqie_rebirth_revenge',
    label: '番茄·重生复仇 + 身份悬念 + 强关系',
    language: 'zh',
    platform: '番茄小说 (Fanqie)',
    formula: 'rebirth-revenge + identity-suspense + strong-relationship',
    lengthLabel: '2000–4000 字/章 · 120–180 章',
    primaryDesires: ['revenge-compensation', 'curiosity', 'being-loved'],
    hookTypes: ['reversal', 'identity', 'countdown'],
    payoffShape: '当众洗刷屈辱；在轻视主角的人面前揭露真实身份或握有底牌',
    risks: [
      '番茄 AI 洗稿泛滥赛道，仅靠“重生”前提无法形成差异化',
      '无代价的复仇会显得廉价，每一次反击都必须付出真实代价或触发新危机',
    ],
    notes: '书名和角色人名必须在完成 Step 0 扫榜后再定，不可拍脑袋预设。',
  },
  {
    id: 'fanqie_urban',
    label: '番茄·都市高武 / 脑洞规则',
    language: 'zh',
    platform: '番茄小说 (Fanqie)',
    formula: 'urban + high-martial + brain-hole',
    lengthLabel: '2000–4000 字/章 · 120–180 章',
    primaryDesires: ['identification-upgrade', 'curiosity'],
    hookTypes: ['reversal', 'new-information', 'arrival'],
    payoffShape: '隐藏能力当众显露；单场戏完成阶层逆转；巧妙利用而非硬拗脑洞规则',
    risks: [
      '战力与资源刻度必须保持前后一致',
      '每一项新能力都必须把代价写进 bible/rules.md',
    ],
    notes: '“脑洞规则”是世界硬规则，不是临时剧情借口——使用前必须先入圣经。',
  },
  {
    id: 'royalroad_litrpg',
    label: 'Royal Road · LitRPG / Progression Fantasy',
    language: 'en',
    platform: 'Royal Road',
    formula: 'progression fantasy + LitRPG system + measurable growth',
    lengthLabel: '1500–2500 words/ch · Serial',
    primaryDesires: ['identification-upgrade', 'curiosity'],
    hookTypes: ['countdown', 'new-information', 'threat'],
    payoffShape: 'A level-up or skill that tangibly changes what the hero can do in the next fight',
    risks: [
      'A level-up that changes nothing is a broken promise',
      'System notifications must serve prose, not decoration',
      'Weak openings are rated down fast; the Golden 3 gate matters most here',
    ],
    notes: 'Royal Road rewards measurable progression, no exclusivity contract required.',
  },
];

export const DEFAULT_SLOP_LIST: Record<'zh' | 'en', string[]> = {
  zh: [
    '空气仿佛凝固了',
    '不是……而是……',
    '他深吸一口气，缓缓说道',
    '一股暖流涌上心头',
    '时间仿佛在这一刻静止',
    '她的眼中闪过一丝',
    '命运的齿轮开始转动',
    '他不知道的是',
  ],
  en: [
    "It wasn't just",
    'The air shifted',
    'A chill ran down her spine',
    'Little did he know',
    'Time seemed to stand still',
    'Her eyes widened in shock',
    'The weight of the moment',
    'In that moment, everything changed',
  ],
};

export const WORKFLOW_STEPS = [
  {
    step: 'Step 0',
    title: '扫榜与拆文 (Market Scan)',
    gate: '前置证据',
    summary: '先看目标平台当下真正被读的题材、钩子与书名方向，再定书名和全新随机人名（禁止跨书硬编码角色）。',
  },
  {
    step: 'Step 1',
    title: '故事圣经与大纲 (Bible & Outline)',
    gate: 'Gate 1 确认 / 自动生成',
    summary: '确立一句话核心、硬约束（不可违背的铁律）、人物弧光、knows 边界与首卷 30 章滚动画卷。',
  },
  {
    step: 'Step 2',
    title: '黄金三章 (Golden 3 Chapters)',
    gate: 'Gate 2 读者视角诊断',
    summary: '写完 1–3 章后以真实读者视角诊断，修合同而非只修辞藻，并通过包装技能定书名简介，随后无限推进长篇连载。',
  },
  {
    step: 'Step 3',
    title: '单章闭环与原子提交 (Chapter Loop)',
    gate: 'Gate 3 阻断审计 + CHAPTER_COMMIT',
    summary: '自动/手工章节合同（含第N章标题、AI 自动欲望与兑现级别）→ 有限切片草稿（<=4000 字）→ 8维阻断子审 → 原子提交正史与新配角。',
  },
  {
    step: 'Step 4',
    title: '卷末与 30 章复盘 (Arc Review)',
    gate: '每 30 章重规划',
    summary: '从摘要、台账与人物快照中重构下一卷计划，将逾期伏笔切为 progressing/paid 或 deferred+target_chapter。',
  },
  {
    step: 'Step 5',
    title: '简版旧稿导入 (Manuscript Import)',
    gate: '反推提案确认',
    summary: '将已有手稿反推重建为圣经、人物 knows 与伏笔台账，接着直接按状态机续写后续任意章节。',
  },
];

export const LAUNCH_PLUGGABLE_SKILLS = [
  {
    id: 'market_scan',
    name: '01. 扫榜 / 拆文',
    slot: 'Step 0',
    desc: '分析目标平台（番茄/七猫/起点/晋江/Royal Road）当下的读者欲望与开篇钩子结构。',
  },
  {
    id: 'packaging',
    name: '02. 包装 (书名/简介/封面 Brief)',
    slot: 'Before Gate 2',
    desc: '生成高转化书名候选、封面视觉指令、平台简介与搜索关键词。',
  },
  {
    id: 'character_forging',
    name: '03. 人物锻造 & 动态配角扩容',
    slot: 'Step 1 & Step 3',
    desc: '锻造人物一条龙 DNA、Want/Need/Flaw/Arc 与 knows 边界，并在连载中动态登记新有名有姓配角。',
  },
  {
    id: 'bilingual_deslop',
    name: '04. 双语去 AI 味',
    slot: 'Step 3 Review',
    desc: '基于 zh/en AI 陈词词表扫描并清除“他不知道的是”等全知剧透与塑料感句式。',
  },
  {
    id: 'manuscript_import',
    name: '05. 简版旧稿导入',
    slot: 'Step 5',
    desc: '从既有章节反推出圣经硬约束、人物档案、knows 状态与伏笔台账。',
  },
];

export const WORKFLOW_PROHIBITIONS = [
  'Gate 1 圣经/大纲就绪前，禁止动笔写任何正文',
  '没有章节合同（Chapter Contract，可全自动生成），禁止写正文',
  '没有 >=10 字章末钩子（hook）或没有欲望兑现（desire_payoff）的章节，阻断审计直接不通过',
  '禁止使用无名龙套标签（黑衣人/神秘人/路人/店小二/stranger），必须锻造具体姓名与动机',
  '禁止跨书复用固定编码主角/配角名，新书角色必须依据设定重新生成',
  '任何角色不得知道他从未被告知的信息（knows 边界铁律）',
  '禁止凭空冒出伏笔台账中不存在的幽灵编号（未埋设不得兑现）；逾期伏笔必须引入下一章或顺延',
  '未经 CHAPTER_COMMIT 原子提交，不得篡改正史状态；回滚章节必须同步清理该章新增角色与伏笔',
];

export function createSampleEchoesBook(): BookProject {
  const now = '2026-11-13T09:00:00.000Z';
  return {
    id: 'sample-echoes',
    title: '回声',
    language: 'zh',
    platform: '番茄小说 (Fanqie)',
    genreId: 'fanqie_rebirth_revenge',
    formula: 'rebirth-revenge + identity-suspense + strong-relationship',
    gate1Approved: true,
    gate2Approved: true,
    marketScan: {
      platform: '番茄小说 (Fanqie)',
      genreId: 'fanqie_rebirth_revenge',
      seedIdea: '沈昭回到三年前被赶出沈家的那一天，用证据复仇并查清匿名信与火灾真相。',
      trendSummary: '当代都市重生复仇赛道单纯“嘴炮打脸”同质化严重，加入“物证推演+匿名信悬念+克制型盟友”能显著拉高前三章留存。',
      hookFormula: '开篇即入冲突现场（物证消失），每章用实物线索推进一层真相（钥匙→信纸水印→旧照片）。',
      titleDirection: '短词意象型书名（如《回声》），配合强悬念简介切中都市复仇与悬疑双人群。',
      namingNotes: '沈昭（清冷果决）、陆明远（体面反派）、顾言舟（旧书店掌柜，温和克制）。',
      riskWarnings: ['不可让沈昭凭空预知未查证的信息，必须用这一世能拿到的物证说话。'],
    },
    packaging: {
      titleCandidates: ['回声', '三年后的那把钥匙', '匿名信与旧书店'],
      selectedTitle: '回声',
      coverBrief: '南方江边老街暮色，深木桌面上摆放一把黄铜旧钥匙与褪色黑白合照，墨绿与暗红点缀。',
      blurb: '二十六岁那年死在江风里的沈昭，睁眼回到了被赶出沈家的那一天。\n上一世，一封匿名信和一只上锁的书房抽屉毁了她。这一世她早回来一天，却发现钥匙已经不在原处。\n有人比她先了一步——或者，这个世界从一开始就不一样。',
      keywords: ['重生复仇', '身份悬念', '强关系', '都市悬疑'],
      coverImageUrl: '/src/assets/images/cover_echoes_novel_1794547810425.jpg',
    },
    bible: {
      premise: '沈昭回到三年前，回到被赶出沈家、被夺走一切的那一天，这一次她要拿回属于自己的东西，并且查清当年那封匿名信到底是谁写的。',
      era: '当代都市',
      setting: '城南老牌实业家族沈家与新贵陆家交锋的南方江城，围绕沈家老宅、城南码头仓库与江边旧书店展开。',
      worldRules: '现实都市逻辑：无超自然能力（除沈昭重生这一前提），任何指控必须依靠实物证据与真实时间线成立。',
      locations: [
        '沈家老宅（城南梧桐院子，书房有一只上锁的抽屉，钥匙在沈老爷子手里）',
        '城南码头仓库（沈家生意的核心，也是陆明远想要的东西）',
        '顾言舟的旧书店（江边一条老街上，三年前火灾之后重建过一次）',
      ],
      hardConstraints: [
        '沈昭重生后记得上一世的事，但她不能向任何人证明这一点——她只能用这一世能拿到手的证据说话。',
        '陆明远不知道沈昭重生了。他的每一步都按上一世的计划走。',
        '沈家老宅书房的抽屉只有一把钥匙，钥匙在沈老爷子手里，任何人不得凭空打开它。',
        '死去的人不复活，签过字的合同不作废。',
      ],
      cultureAnchors: {
        clothing: '深色旗袍、灰色西装、旧书店里的棉布围裙',
        food: '码头边的馄饨摊、老宅厨房的莲子羹',
        objects: '黄铜钥匙、匿名信、褪色的全家福照片',
        landscape: '城南江边、老宅的梧桐院子',
        colour: '墨绿、暗红、旧纸黄',
      },
      voice: {
        narrator: '冷静、克制，多写动作少写心理独白。',
        dialogueDistinctness: '沈昭说话短、直接；陆明远说话绕、留一半；顾言舟说话慢、常停顿。',
        customBanned: [],
      },
      characters: [
        {
          id: 'char-shenzhao',
          name: '沈昭',
          age: '26（重生回 23 岁）',
          role: '主角 / 破局者',
          dna: '清瘦、黑发盘起、一枚旧银戒指、深色旗袍',
          want: '拿回属于自己的东西',
          need: '查清匿名信的真相',
          flaw: '太急于证明自己，容易把底牌一次打光',
          arc: '从“报复”到“查清真相”——复仇是入口，真相才是出口',
        },
        {
          id: 'char-lumingyuan',
          name: '陆明远',
          age: '30',
          role: '核心对手',
          dna: '高大、灰色西装、左手一枚黑曜石戒指、笑起来不看人眼睛',
          want: '吞掉沈家的码头生意',
          need: '证明自己不是靠陆家才站得住',
          flaw: '太相信计划，plan 里没有“沈昭会变”这一项',
          arc: '从笃定掌控全局到被意外证据步步拆穿',
        },
        {
          id: 'char-guyan',
          name: '顾言舟',
          age: '28',
          role: '关键盟友',
          dna: '温和、旧书店的棉布围裙、手上常沾着墨水味',
          want: '守住旧书店',
          need: '知道三年前那场火灾的真相',
          flaw: '害怕欠人情，所以总是先拒绝帮助',
          arc: '从独守旧账本到与沈昭并肩追查火灾真相',
        },
      ],
    },
    outline: {
      compass: {
        endDirection: '沈昭拿回属于自己的东西，并查清匿名信的真相。',
        activeLongThreads: 'F01（上锁的书房抽屉）、F02（匿名信与水印）、F03（照片上的陌生人）',
        scaleEstimate: '样书探针 3 章，完整连载规划 120–180 章',
        centralQuestion: '当年那封匿名信到底是谁写的？',
        whatBookIsNot: '不是单纯的打脸爽文——复仇是入口，真相才是出口。',
      },
      currentArc: {
        rangeLabel: '第 1–30 章（当前样书 1–3 章）',
        goal: '沈昭回到三年前，站稳第一步，并拿到第一件上一世没有的证据。',
        beats: [
          '回到老宅，发现书房抽屉的钥匙已先一步消失',
          '天亮前在书房底层找到匿名信，循水印追查到旧书店',
          '从顾言舟处取得火灾前夕合影，发现码头火灾夜的黑包陌生人',
        ],
        payoff: '第 3 章小高潮：照片上出现沈昭上一世从未见过的人，火灾另有隐情',
        newElementsNote: '当前集中于老宅、旧书店、码头仓库三处核心地标。',
      },
      roadmap: [
        {
          chapter: 1,
          goal: '回到三年前，回到老宅',
          desire: 'curiosity',
          hook: '书房抽屉的钥匙不见了，而上一世它明明一直在那里',
          status: 'committed',
        },
        {
          chapter: 2,
          goal: '查匿名信的来路',
          desire: 'revenge-compensation',
          hook: '信纸上有顾言舟旧书店的水印，而他三年前就不用这种纸了',
          status: 'committed',
        },
        {
          chapter: 3,
          goal: '照片上的陌生人',
          desire: 'curiosity',
          hook: '照片上的陌生人，就是上一世火灾那晚站在码头仓库门口的人',
          status: 'committed',
        },
        {
          chapter: 4,
          goal: '夜探城南码头仓库，核查火灾前夕货物与进出记录',
          desire: 'curiosity',
          hook: '仓库账本缺失的那三页，签字栏竟是母亲当年的旧印章',
          status: 'planned',
        },
      ],
    },
    state: {
      committedChapters: [1, 2, 3],
      nextChapter: 4,
      summaries: [
        { chapter: 1, summary: '沈昭回到三年前，回到沈家老宅，发现书房抽屉的钥匙不见了。' },
        { chapter: 2, summary: '沈昭在书房找到一封匿名信，信纸上有顾言舟旧书店的水印。' },
        { chapter: 3, summary: '顾言舟给沈昭看一张旧照片，照片上有一个陌生人的脸。' },
      ],
      characterStates: [
        {
          characterName: '沈昭',
          currentState: '回到三年前，站稳第一步，手里多了一封匿名信和一张照片，仍不知道信是谁写的、照片上的人是谁。',
        },
        {
          characterName: '陆明远',
          currentState: '按上一世的计划推进码头生意，不知道沈昭重生了。',
        },
        {
          characterName: '顾言舟',
          currentState: '守着旧书店，愿意帮沈昭查照片，但害怕欠人情。',
        },
      ],
      foreshadowing: [
        { id: 'F01', planted: 1, payoffDue: 5, status: 'open', thread: '书房抽屉上锁，钥匙不见了' },
        { id: 'F02', planted: 2, payoffDue: 6, status: 'open', thread: '匿名信的信纸有旧书店水印' },
        { id: 'F03', planted: 3, payoffDue: 9, status: 'open', thread: '照片上有一个陌生人的脸' },
      ],
      knows: [
        { id: 'k1', characterName: '沈昭', fact: '知道自己重生回到了三年前', learnedChapter: 1, knows: true, note: '亲身经历' },
        { id: 'k2', characterName: '沈昭', fact: '知道书房抽屉上锁且钥匙不见了', learnedChapter: 1, knows: true, note: '亲自查验' },
        { id: 'k3', characterName: '沈昭', fact: '知道匿名信存在且背面有旧书店水印', learnedChapter: 2, knows: true, note: '书房抽屉找到' },
        { id: 'k4', characterName: '沈昭', fact: '不知道匿名信是谁写的（F02 待解）', learnedChapter: null, knows: false },
        { id: 'k5', characterName: '沈昭', fact: '不知道照片上提黑包的陌生人是谁（F03 待解）', learnedChapter: null, knows: false },
        { id: 'k6', characterName: '陆明远', fact: '知道码头仓库吞并计划（他自己的计划）', learnedChapter: 1, knows: true },
        { id: 'k7', characterName: '陆明远', fact: '不知道沈昭重生了（硬约束）', learnedChapter: null, knows: false },
        { id: 'k8', characterName: '陆明远', fact: '不知道旧照片的存在（第 3 章他不在场）', learnedChapter: null, knows: false },
        { id: 'k9', characterName: '顾言舟', fact: '知道旧书店信纸有专属水印，且当年沈家与陆家都买过', learnedChapter: 2, knows: true },
        { id: 'k10', characterName: '顾言舟', fact: '不知道是谁用他的纸写了匿名信，也不知道沈昭重生', learnedChapter: null, knows: false },
      ],
      timeline: [
        { chapter: 1, dayLabel: 'Day 1', event: '沈昭回到三年前，回到沈家老宅。' },
        { chapter: 2, dayLabel: 'Day 2', event: '沈昭在书房找到匿名信，前往旧书店查证水印。' },
        { chapter: 3, dayLabel: 'Day 3', event: '沈昭在旧书店看到火灾前夕合影上的陌生人。' },
      ],
    },
    chapters: [
      {
        chapter: 1,
        status: 'committed',
        updatedAt: now,
        contract: {
          chapter: 1,
          title: '回到三年前',
          language: 'zh',
          desire: 'curiosity',
          desirePayoff: '沈昭回到三年前，第一眼就发现上一世的钥匙不见了——世界已经变了',
          payoffSize: 'small',
          hook: '书房抽屉的钥匙不见了，而上一世，它明明一直在那里',
          transition: '第二章从书房开始：沈昭留在老宅过夜，天亮之前，她要在书房里找到匿名信的来路',
          mustHappen: '沈昭回到三年前，回到沈家老宅；她去书房看抽屉，发现钥匙不见了',
          mustNot: '陆明远不能知道沈昭重生了；抽屉不能被凭空打开',
          characters: ['沈昭', '陆明远'],
          foreshadowingPlanted: ['F01'],
          foreshadowingPaid: [],
          isProbe: true,
        },
        prose: `沈昭睁开眼睛的时候，天花板上的吊灯还是老样子。她躺了三秒，才想起来这是哪里。

沈家老宅，她住了二十三年的房间。窗外梧桐树的影子落在被子上，和她记忆里的一模一样。上一世，她就是在今天被赶出沈家的。

她坐起来，赤脚踩在木地板上，走到镜子前面。镜子里的人二十三岁，黑发盘起，手指上戴着那枚旧银戒指。年轻，真年轻。上一世她二十六岁死的时候，手指已经瘦得戴不住这枚戒指了。

楼下传来碗碟的声音。沈昭换上深色旗袍，下楼。

沈老爷子坐在餐桌边看报纸，头也不抬："回来了？"

"嗯。"沈昭坐下，给自己盛了一碗莲子羹，"爷爷，书房的钥匙还在你那儿吗？"

沈老爷子放下报纸，看了她一眼："问这个做什么？"

"想找一本书。"沈昭说。她说的是实话的一半。上一世，书房抽屉里锁着的东西，是她被赶出沈家的导火索。这一世，她要先看一眼那里面到底是什么。

"钥匙在书房门边的抽屉里。"沈老爷子说，"你自己去拿。"

沈昭吃完羹，起身上楼，走到书房门口。她拉开门边的抽屉——空的。

她站在原地，手指停在抽屉边上。上一世，钥匙明明一直在那里。她记得清清楚楚，因为上一世她就是拿了这把钥匙，打开了书房的抽屉，然后她的人生就翻了个面。

她又拉开旁边的几个抽屉，一个一个看过去。钢笔、旧报纸、沈老爷子的老花镜，都在，就是没有钥匙。

她走到书桌边，伸手摸了摸桌面，桌面上有一层薄薄的灰，像是很多天没有人动过这里的东西了。上一世的今天，书桌上还摆着她母亲留下的那只瓷笔筒，现在也不见了。

沈昭退后一步，靠在书架上，慢慢想。上一世她被赶出沈家，是因为有人说她偷了抽屉里的东西。她到死都没有看清抽屉里到底锁着什么。这一世，她回来得比上一世早了一天，本以为能抢在所有人前面，先看一眼抽屉里的东西，结果钥匙已经不见了。

现在钥匙不见了。有人比她先了一步。或者，这个世界从一开始就不一样。

楼下传来门铃声。沈昭走到窗边往下看，一辆黑色的车停在院子里，陆明远从车上下来，灰色西装，左手一枚黑曜石戒指。他抬头，正好对上沈昭的视线，笑了笑，像上一世每一次见面那样。

沈昭退后一步，关上书房的门。钥匙不见了，陆明远来了。这一世的第一天，就已经和上一世不一样了。`,
      },
      {
        chapter: 2,
        status: 'committed',
        updatedAt: now,
        contract: {
          chapter: 2,
          title: '匿名信',
          language: 'zh',
          desire: 'revenge-compensation',
          desirePayoff: '沈昭找到上一世害她的人留下的第一件实物证据——一封匿名信',
          payoffSize: 'small',
          hook: '信纸上有顾言舟旧书店的水印，而顾言舟说他三年前就不再用这种纸了',
          transition: '第三章从旧书店开始：沈昭带着信去找顾言舟，顾言舟给她看一张旧照片',
          mustHappen: '沈昭在书房找到一封匿名信；她发现信纸上有旧书店的水印',
          mustNot: '沈昭不能直接认定顾言舟就是写信的人；陆明远不能出现在这一章',
          characters: ['沈昭', '顾言舟'],
          foreshadowingPlanted: ['F02'],
          foreshadowingPaid: [],
          isProbe: true,
        },
        prose: `沈昭在老宅住了一晚。

天亮之前她就起来了，轻手轻脚地走到书房。书房的门没锁，窗帘拉着，屋里有一股旧纸和木头的味道。她走到书桌边，拉开最下面一层抽屉——这是上一世她没来得及翻的地方。

抽屉里有一叠旧报纸，一支断了的钢笔，还有一个牛皮纸信封。信封上没有名字，没有邮戳，只有一行字："沈小姐亲启。"

沈昭的手顿了一下。她把信封拿出来，抽出里面的信纸，只看了三行，就把信纸按在了桌子上。信上写的是上一世她被赶出沈家的原因。每一句都是真的，每一句都像是有人站在她身后，看着她上一世怎么一步步走进那个局。

她把信纸翻过来，看背面。背面右下角，有一个很淡的水印，是一间书店的标记。她认得这个标记——城南江边那间旧书店，顾言舟的书店。

沈昭把信折好，放进口袋，出了老宅。

旧书店开在江边一条老街上，门上挂着木牌，写着"今日有雨，晚开一小时"。沈昭推门进去，顾言舟正在擦柜台，抬头看见她，愣了一下。

"沈小姐？"他说，"好久不见。"

"三年。"沈昭说，"你这儿的纸，还是三年前那种吗？"

顾言舟放下抹布："你问这个做什么？"

沈昭把信拿出来，放在柜台上："这封信的纸，有你店里的水印。"

顾言舟拿起信，只看了一眼水印，就摇了摇头："这种纸我三年前就不用了。最后一批，是三年前那场火灾之前进的。"

沈昭看着他："那这封信，是谁用你三年前的纸写的？"

顾言舟没有马上回答。他走到柜台后面，打开一个旧抽屉，翻出一本发黄的进货单，一页一页地翻过去，最后停在某一页上，用手指点着那一行："你看，最后一批这种纸，是三年前三月进的，只进了二十刀。买走的人不多，我都记得——沈家买过五刀，陆家买过三刀，剩下的都是些散客。"

"沈家买过？"沈昭问。

"嗯。"顾言舟合上进货单，"是你母亲买的。她说这种纸写字不洇，适合抄经。"

沈昭沉默了一会儿。她母亲去世得早，上一世她很少想起母亲买纸这种小事。现在这件小事，忽然变成了一条线，把匿名信和沈家连在了一起。

顾言舟走到里间，翻了很久，拿出一个铁盒子，放在沈昭面前。"先别问信的事。"他说，"你先看看这个。"`,
      },
      {
        chapter: 3,
        status: 'committed',
        updatedAt: now,
        contract: {
          chapter: 3,
          title: '照片上的陌生人',
          language: 'zh',
          desire: 'curiosity',
          desirePayoff: '照片上出现了一个沈昭上一世从没见过的人——匿名信的线索第一次指向一个真人',
          payoffSize: 'small',
          hook: '照片上的陌生人，就是上一世火灾那晚站在码头仓库门口的人',
          transition: '第四章从码头仓库开始：沈昭要去仓库，查三年前火灾那晚到底发生了什么',
          mustHappen: '顾言舟给沈昭看一张旧照片；照片上有一个陌生人的脸',
          mustNot: '不能直接写出陌生人是谁；不能让顾言舟认出照片上的人',
          characters: ['沈昭', '顾言舟'],
          foreshadowingPlanted: ['F03'],
          foreshadowingPaid: [],
          isProbe: true,
        },
        prose: `铁盒子里是一张照片。照片已经褪色了，边角发黄，上面是三年前旧书店开业那天的合影。顾言舟站在中间，两边是几个老街坊。

沈昭一眼就看到了角落里的那个人。

那个人站在人群的最边上，半张脸藏在阴影里，穿一件深色外套，手里提着一个黑色的包。沈昭盯着那张脸，脑子里飞快地翻着上一世的记忆——她没有见过这个人。上一世，她在沈家、陆家、码头，见过几百张脸，没有这一张。

"这个人是谁？"沈昭问。

顾言舟摇头："不知道。开业那天来的人太多，我只记得他买了一本书，付了现金，没留名字。"

"那本书是什么？"沈昭问。

"一本旧的航运手册。"顾言舟说，"很冷门的一本书，一年也卖不出去一本。那天他偏偏就买了那一本。"

沈昭把照片翻过来，背面写着日期：三年前，火灾的前一天。

"那天店里人多吗？"沈昭问。

"多。"顾言舟说，"开业第一天，街坊都来了，门口还摆了花篮。我忙着招呼人，没顾上看他。他买完书就走了，连书签都没要。我当时还觉得奇怪——来买航运手册的人，怎么会跑到我这间旧书店来。"

沈昭又看了一眼照片。照片上的那个人站在人群的最边上，像是故意站在阴影里。她想起上一世火灾那晚，自己站在码头仓库外面，看见火光从仓库的窗户里透出来。那晚她只顾着往外跑，没有回头看过门口站着谁。

她把照片放回铁盒，盖上盖子："顾老板，这张照片借我几天。"

"拿去。"顾言舟说，"不过沈小姐，我要提醒你一件事——三年前那场火灾，烧掉的不只是书店。码头仓库那晚也着了火，火是从仓库里面烧起来的。"

沈昭抬起头："仓库里面？"

"嗯。"顾言舟说，"那晚有人看见，一个人站在仓库门口，手里提着一个黑色的包。"

沈昭没有说话。她低头看了一眼铁盒，照片上那个陌生人手里提着的，也是一个黑色的包。

她把铁盒抱在怀里，走出书店。江边的风吹过来，她把外套裹紧了一点。街上行人不多，卖馄饨的摊子还开着，热气一缕一缕地往上飘。沈昭站在摊子前面，忽然想起上一世的最后一年，自己也是这样一个人站在江边，不知道该往哪里走。

那时候她什么都没有了。这一世，她手里至少还有一张照片，和一封不知道是谁写的信。

明天，她要去码头仓库。三年前火灾那晚，到底发生了什么，她要自己去看一眼。`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
