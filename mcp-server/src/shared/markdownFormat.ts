import type { BookProject } from './types.ts';

export function formatBookAsMarkdownFiles(book: BookProject): Record<string, string> {
  const files: Record<string, string> = {};

  files['bible/canon.md'] = [
    `# Canon — 《${book.title}》`,
    '',
    '## Premise',
    book.bible.premise,
    '',
    '## World',
    `- Era: ${book.bible.era}`,
    `- Setting: ${book.bible.setting}`,
    `- World rules: ${book.bible.worldRules}`,
    `- Key locations:\n${book.bible.locations.map((l) => `  - ${l}`).join('\n')}`,
    '',
    '## Hard constraints',
    ...book.bible.hardConstraints.map((r, i) => `${i + 1}. ${r}`),
    '',
    '## Culture anchors',
    `- Clothing: ${book.bible.cultureAnchors.clothing}`,
    `- Food: ${book.bible.cultureAnchors.food}`,
    `- Objects: ${book.bible.cultureAnchors.objects}`,
    `- Landscape: ${book.bible.cultureAnchors.landscape}`,
    `- Colour: ${book.bible.cultureAnchors.colour}`,
  ].join('\n');

  files['bible/characters.md'] = [
    `# Characters — 《${book.title}》`,
    '',
    ...book.bible.characters.flatMap((c) => {
      const lines = [
        `## ${c.name}`,
        `- Age: ${c.age}. Role: ${c.role}.`,
        `- DNA: ${c.dna}`,
        `- Want: ${c.want}. Need: ${c.need}.`,
        `- Flaw: ${c.flaw}`,
        `- Arc: ${c.arc}`,
      ];
      if (c.speechStyle) lines.push(`- Speech style: ${c.speechStyle}`);
      if (c.debutPlan) lines.push(`- Debut plan: ${c.debutPlan}`);
      if (c.introducedChapter) lines.push(`- Introduced chapter: ${c.introducedChapter}`);
      lines.push('');
      return lines;
    }),
  ].join('\n');

  files['bible/rules.md'] = [
    `# Rules — 《${book.title}》`,
    '',
    ...book.bible.hardConstraints.map((r, i) => `${i + 1}. ${r}`),
  ].join('\n');

  files['bible/voice.md'] = [
    `# Voice — 《${book.title}》`,
    '',
    `- Narrator: ${book.bible.voice.narrator}`,
    `- Dialogue distinctness: ${book.bible.voice.dialogueDistinctness}`,
    `- Custom banned phrases: ${(book.bible.voice.customBanned || []).join(', ') || 'None'}`,
  ].join('\n');

  files['bible/world.md'] = [
    `# World — 《${book.title}》`,
    '',
    `- Era: ${book.bible.era}`,
    `- Setting: ${book.bible.setting}`,
    `- Rules: ${book.bible.worldRules}`,
    ...book.bible.locations.map((l) => `- ${l}`),
  ].join('\n');

  files['outline/overview.md'] = [
    `# Outline — 《${book.title}》`,
    '',
    '## Compass',
    `- End direction: ${book.outline.compass.endDirection}`,
    `- Active long threads: ${book.outline.compass.activeLongThreads}`,
    `- Scale estimate: ${book.outline.compass.scaleEstimate}`,
    `- Central question: ${book.outline.compass.centralQuestion}`,
    `- What this book is NOT: ${book.outline.compass.whatBookIsNot}`,
    ...(book.outline.compass.targetChapters != null
      ? [`- Target chapters: ${book.outline.compass.targetChapters}`]
      : []),
    ...(book.outline.compass.targetWords != null
      ? [`- Target words: ${book.outline.compass.targetWords}`]
      : []),
    ...(book.outline.compass.tolerance != null
      ? [`- Tolerance: ${book.outline.compass.tolerance}`]
      : []),
    `- Book status: ${book.bookStatus ?? 'ongoing'}`,
    ...(book.outline.compass.endingSummary
      ? [`- Ending summary: ${book.outline.compass.endingSummary}`]
      : []),
    '',
    `## Current arc (${book.outline.currentArc.rangeLabel})`,
    `- Arc goal: ${book.outline.currentArc.goal}`,
    `- Arc beats:\n${book.outline.currentArc.beats.map((b) => `  - ${b}`).join('\n')}`,
    `- Arc payoff: ${book.outline.currentArc.payoff}`,
    '',
    '## Chapter list',
    '| Ch | Goal | Desire | Hook | Status |',
    '|----|------|--------|------|--------|',
    ...book.outline.roadmap.map(
      (r) => `| ${r.chapter} | ${r.goal} | ${r.desire} | ${r.hook} | ${r.status} |`
    ),
    // 隔离段落：完整终局蓝图只供导演（圣经/合同/复盘）读取，正文读取上下文时跳过本段。
    ...(book.outline.compass.plannedEnding
      ? [
          '',
          '## Planned ending (director-only)',
          book.outline.compass.plannedEnding,
        ]
      : []),
  ].join('\n');

  files['state/progress.md'] = [
    `# Progress — 《${book.title}》`,
    '',
    ...book.state.committedChapters.map((c) => `- committed: ${c}`),
    `- Next chapter to write: ${book.state.nextChapter}`,
  ].join('\n');

  files['state/summary.md'] = [
    `# Summary — 《${book.title}》`,
    '',
    ...book.state.summaries.map((s) => `- Chapter ${s.chapter}: ${s.summary}`),
  ].join('\n');

  files['state/character_state.md'] = [
    `# Character State — 《${book.title}》`,
    '',
    ...book.state.characterStates.map((cs) => `- ${cs.characterName}：${cs.currentState}`),
  ].join('\n');

  files['state/foreshadowing.md'] = [
    `# Foreshadowing Ledger — 《${book.title}》`,
    '',
    ...book.state.foreshadowing.map(
      (f) =>
        `- ${f.id} | planted: ${f.planted} | payoff_due: ${f.payoffDue} | status: ${f.status} | scope: ${f.scope ?? 'series'} | kind: ${f.kind ?? 'other'} | thread: ${f.thread}`
    ),
  ].join('\n');

  files['state/knows.md'] = [
    `# Knows Lists — 《${book.title}》`,
    '',
    ...book.state.knows.map(
      (k) =>
        `- [${k.characterName}] ${k.knows ? 'Knows' : 'Does NOT know'}: ${k.fact}${
          k.learnedChapter ? ` (chapter ${k.learnedChapter})` : ''
        }${k.note ? ` — ${k.note}` : ''}`
    ),
  ].join('\n');

  files['state/timeline.md'] = [
    `# Timeline — 《${book.title}》`,
    '',
    ...book.state.timeline.map((t) => `- ${t.dayLabel} (chapter ${t.chapter}): ${t.event}`),
  ].join('\n');

  for (const ch of book.chapters) {
    const numStr = String(ch.chapter).padStart(3, '0');
    const c = ch.contract;
    files[`chapters/${numStr}.md`] = [
      '---',
      `chapter: ${c.chapter}`,
      `title: ${c.title}`,
      `language: ${c.language}`,
      `desire: ${c.desire}`,
      `desire_payoff: ${c.desirePayoff}`,
      `payoff_size: ${c.payoffSize}`,
      `hook: ${c.hook}`,
      `transition: ${c.transition}`,
      `must_happen: ${c.mustHappen}`,
      `must_not: ${c.mustNot}`,
      `characters: ${c.characters.join(', ')}`,
      `foreshadowing_planted: ${c.foreshadowingPlanted.join(', ') || '-'}`,
      `foreshadowing_paid: ${c.foreshadowingPaid.join(', ') || '-'}`,
      `chapter_kind: ${c.chapterKind ?? 'main'}`,
      ...(c.bigCadenceSnapshot != null
        ? [`big_cadence_snapshot: ${c.bigCadenceSnapshot}`]
        : []),
      '---',
      '',
      ch.prose,
    ].join('\n');
  }

  return files;
}
