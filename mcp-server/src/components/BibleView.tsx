import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Lock, Plus, Save, Sparkles, Trash2, UserPlus } from 'lucide-react';
import type { BookProject, CharacterProfile, CharacterStateEntry } from '../shared/types.ts';
import { getCharacterAppearanceMap, preserveLockedCharacters } from '../shared/characterUtils.ts';
import { forgeCharacterApi, generatePackagingApi } from '../lib/api.ts';

interface BibleViewProps {
  book: BookProject;
  onSaveBook: (updated: BookProject) => Promise<void>;
}

export const BibleView: React.FC<BibleViewProps> = ({ book, onSaveBook }) => {
  const [editingTitle, setEditingTitle] = useState(book.title);
  const [editingBible, setEditingBible] = useState(book.bible);
  const [editingCharStates, setEditingCharStates] = useState<CharacterStateEntry[]>(
    book.state.characterStates
  );
  const [isDirty, setIsDirty] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [forgeHint, setForgeHint] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualAge, setManualAge] = useState('');
  const [manualRole, setManualRole] = useState('');
  const [manualDna, setManualDna] = useState('');
  const [manualWant, setManualWant] = useState('');
  const [manualSpeechStyle, setManualSpeechStyle] = useState('');
  const [manualDebutPlan, setManualDebutPlan] = useState('');

  const [newKnowsChar, setNewKnowsChar] = useState(book.bible.characters[0]?.name || '');
  const [newKnowsFact, setNewKnowsFact] = useState('');
  const [newKnowsBool, setNewKnowsBool] = useState(true);
  const [newKnowsCh, setNewKnowsCh] = useState<number>(1);
  const [coverImgFailed, setCoverImgFailed] = useState(false);

  useEffect(() => {
    setEditingTitle(book.title);
    setEditingBible(book.bible);
    setEditingCharStates(book.state.characterStates);
    setIsDirty(false);
    setNewKnowsChar((prev) =>
      book.bible.characters.some((c) => c.name === prev)
        ? prev
        : book.bible.characters[0]?.name || ''
    );
    setCoverImgFailed(false);
    setManualOpen(false);
  }, [book.id, book.updatedAt]);

  useEffect(() => {
    setNotice(null);
    setErrorMsg(null);
  }, [book.id]);

  const appearanceMap = useMemo(() => getCharacterAppearanceMap(book), [book]);

  const buildSyncedBookPayload = (overrideBible = editingBible): BookProject | null => {
    const cleanTitle = editingTitle.trim() || book.title;
    const cleanedChars = overrideBible.characters.map((c) => ({
      ...c,
      name: c.name.trim(),
    }));

    if (cleanedChars.some((c) => !c.name)) {
      setErrorMsg('存在姓名为空的角色，请填写所有角色姓名后再保存。');
      return null;
    }

    const nameSet = new Set<string>();
    for (const c of cleanedChars) {
      if (nameSet.has(c.name)) {
        setErrorMsg(`角色姓名「${c.name}」重复，请确保每位角色名称唯一。`);
        return null;
      }
      nameSet.add(c.name);
    }

    // Cascade character renames (for unlocked characters) into state & chapter contracts
    const renameMap = new Map<string, string>();
    for (const oldChar of book.bible.characters) {
      if (appearanceMap.get(oldChar.id)?.locked) continue;
      const updatedChar = cleanedChars.find((c) => c.id === oldChar.id);
      if (updatedChar && updatedChar.name !== oldChar.name) {
        renameMap.set(oldChar.name, updatedChar.name);
      }
    }

    const mapName = (name: string) => renameMap.get(name) || name;

    const syncedKnows = book.state.knows.map((k) => ({
      ...k,
      characterName: mapName(k.characterName),
    }));

    const stateMap = new Map(
      editingCharStates.map((cs) => [mapName(cs.characterName), cs.currentState])
    );
    for (const c of cleanedChars) {
      if (!stateMap.has(c.name)) {
        stateMap.set(c.name, `${c.role || '角色'}，目标：${c.want || '待定'}`);
      }
    }
    const syncedCharStates = Array.from(stateMap.entries())
      .filter(([name]) => nameSet.has(name))
      .map(([characterName, currentState]) => ({ characterName, currentState }));

    const syncedChapters = book.chapters.map((ch) => ({
      ...ch,
      contract: {
        ...ch.contract,
        characters: Array.from(new Set(ch.contract.characters.map(mapName))).filter((n) =>
          nameSet.has(n)
        ),
      },
    }));

    const candidate: BookProject = {
      ...book,
      title: cleanTitle,
      bible: {
        ...overrideBible,
        characters: cleanedChars,
      },
      chapters: syncedChapters,
      state: {
        ...book.state,
        characterStates: syncedCharStates,
        knows: syncedKnows,
      },
    };

    return preserveLockedCharacters(book, candidate);
  };

  const handleSaveBible = async () => {
    setErrorMsg(null);
    const payload = buildSyncedBookPayload();
    if (!payload) return;
    await onSaveBook(payload);
    setEditingBible(payload.bible);
    setEditingTitle(payload.title);
    setEditingCharStates(payload.state.characterStates);
    setIsDirty(false);
    if (!payload.bible.characters.some((c) => c.name === newKnowsChar)) {
      setNewKnowsChar(payload.bible.characters[0]?.name || '');
    }
    setNotice('故事圣经、人物档案与动态状态已保存生效（已出场角色档案自动保持锁定）');
  };

  const handleApproveGate1 = async () => {
    setErrorMsg(null);
    const payload = buildSyncedBookPayload();
    if (!payload) return;
    await onSaveBook({
      ...payload,
      gate1Approved: true,
    });
    setIsDirty(false);
    setNotice('Gate 1（圣经与大纲）已确认通过');
  };

  const handleForgeCharacter = async () => {
    if (!forgeHint.trim()) {
      setErrorMsg('请先输入新角色的定位或需求提示');
      return;
    }
    setErrorMsg(null);
    setBusy('forge');
    try {
      const currentSnapshot: BookProject = {
        ...book,
        title: editingTitle.trim() || book.title,
        bible: editingBible,
        state: {
          ...book.state,
          characterStates: editingCharStates,
        },
      };
      const res = await forgeCharacterApi(currentSnapshot, forgeHint);
      const nextChars = [...editingBible.characters, res.character];
      const nextBible = { ...editingBible, characters: nextChars };
      const addedKnows = res.knowsHints.map((k, idx) => ({
        id: `k-forge-${Date.now()}-${idx}`,
        characterName: res.character.name,
        fact: k.fact,
        knows: k.knows,
        learnedChapter: k.knows ? book.state.nextChapter : null,
        note: k.note || '人物锻造生成',
      }));
      const nextStates: CharacterStateEntry[] = [
        ...editingCharStates,
        {
          characterName: res.character.name,
          currentState: `${res.character.role}（第 ${book.state.nextChapter} 章起待切入），目标：${res.character.want}`,
        },
      ];
      setEditingBible(nextBible);
      setEditingCharStates(nextStates);
      if (!newKnowsChar) setNewKnowsChar(res.character.name);
      const payloadToSave = preserveLockedCharacters(book, {
        ...currentSnapshot,
        bible: nextBible,
        state: {
          ...book.state,
          characterStates: nextStates,
          knows: [...book.state.knows, ...addedKnows],
        },
      });
      await onSaveBook(payloadToSave);
      setIsDirty(false);
      setForgeHint('');
      setNotice(
        `已锻造角色「${res.character.name}」（未出场前可随时修改各项字段并保存；创作后续章节时将按切入方案自动登场）`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAddManualCharacter = async () => {
    const cleanName = manualName.trim();
    if (!cleanName) {
      setErrorMsg('请输入新角色姓名（禁止空白）');
      return;
    }
    if (editingBible.characters.some((c) => c.name === cleanName)) {
      setErrorMsg(`角色「${cleanName}」已存在，请更换姓名`);
      return;
    }
    setErrorMsg(null);
    const created: CharacterProfile = {
      id: `char-${Date.now()}`,
      name: cleanName,
      age: manualAge.trim() || '待定',
      role: manualRole.trim() || '关键配角',
      dna: manualDna.trim() || '待补充外貌、主色调与随身信物',
      want: manualWant.trim() || '明确个人诉求',
      need: '深层转变需求',
      flaw: '核心性格弱点',
      arc: '全卷成长与命运弧线',
      ...(manualSpeechStyle.trim() ? { speechStyle: manualSpeechStyle.trim() } : {}),
      ...(manualDebutPlan.trim() ? { debutPlan: manualDebutPlan.trim() } : {}),
    };
    const nextBible = {
      ...editingBible,
      characters: [...editingBible.characters, created],
    };
    const nextStates: CharacterStateEntry[] = [
      ...editingCharStates,
      {
        characterName: created.name,
        currentState: `${created.role}，目标：${created.want}`,
      },
    ];
    setEditingBible(nextBible);
    setEditingCharStates(nextStates);
    if (!newKnowsChar) setNewKnowsChar(created.name);
    await onSaveBook(
      preserveLockedCharacters(book, {
        ...book,
        title: editingTitle.trim() || book.title,
        bible: nextBible,
        state: {
          ...book.state,
          characterStates: nextStates,
        },
      })
    );
    setIsDirty(false);
    setManualName('');
    setManualAge('');
    setManualRole('');
    setManualDna('');
    setManualWant('');
    setManualSpeechStyle('');
    setManualDebutPlan('');
    setManualOpen(false);
    setNotice(`已手动添加角色「${created.name}」并保存`);
  };

  const handleDeleteCharacter = async (charId: string) => {
    if (appearanceMap.get(charId)?.locked) {
      setErrorMsg('该角色已在故事正文中出场，基础档案已定型锁定，不可删除。');
      return;
    }
    if (editingBible.characters.length <= 1) {
      setErrorMsg('至少保留 1 位角色，如需替换请直接修改姓名。');
      return;
    }
    const target = editingBible.characters.find((c) => c.id === charId);
    const nextChars = editingBible.characters.filter((c) => c.id !== charId);
    const nextBible = { ...editingBible, characters: nextChars };
    const nextStates = target
      ? editingCharStates.filter((cs) => cs.characterName !== target.name)
      : editingCharStates;
    setEditingBible(nextBible);
    setEditingCharStates(nextStates);
    if (target && newKnowsChar === target.name) {
      setNewKnowsChar(nextChars[0]?.name || '');
    }
    await onSaveBook(
      preserveLockedCharacters(book, {
        ...book,
        title: editingTitle.trim() || book.title,
        bible: nextBible,
        state: {
          ...book.state,
          characterStates: nextStates,
        },
      })
    );
    setIsDirty(false);
    if (target) {
      setNotice(`已移除未出场角色「${target.name}」`);
    }
  };

  const handleGeneratePackaging = async () => {
    setErrorMsg(null);
    setBusy('packaging');
    try {
      const pkg = await generatePackagingApi({
        ...book,
        title: editingTitle.trim() || book.title,
        bible: editingBible,
      });
      await onSaveBook({
        ...book,
        title: editingTitle.trim() || book.title,
        bible: editingBible,
        packaging: pkg,
      });
      setNotice('已通过「包装」技能生成书名候选、简介、关键词与封面 Brief');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleApplyPackagingTitle = async (newTitle: string) => {
    setEditingTitle(newTitle);
    await onSaveBook({
      ...book,
      title: newTitle,
      bible: editingBible,
    });
    setNotice(`已将书名更新为《${newTitle}》`);
  };

  const handleAddKnowsEntry = async () => {
    if (!newKnowsChar || !newKnowsFact.trim()) return;
    const entry = {
      id: `k-manual-${Date.now()}`,
      characterName: newKnowsChar,
      fact: newKnowsFact.trim(),
      knows: newKnowsBool,
      learnedChapter: newKnowsBool ? newKnowsCh : null,
      note: '手动登记',
    };
    await onSaveBook({
      ...book,
      state: {
        ...book.state,
        knows: [...book.state.knows, entry],
      },
    });
    setNewKnowsFact('');
    setNotice('已登记角色 Knows 信息边界条目');
  };

  const handleToggleKnowsEntry = async (entryId: string) => {
    const nextKnows = book.state.knows.map((k) =>
      k.id === entryId
        ? {
            ...k,
            knows: !k.knows,
            learnedChapter: !k.knows ? k.learnedChapter || book.state.nextChapter : null,
          }
        : k
    );
    await onSaveBook({
      ...book,
      state: {
        ...book.state,
        knows: nextKnows,
      },
    });
    setNotice('已更新角色 Knows 认知状态并保存');
  };

  const handleDeleteKnowsEntry = async (entryId: string) => {
    const nextKnows = book.state.knows.filter((k) => k.id !== entryId);
    await onSaveBook({
      ...book,
      state: {
        ...book.state,
        knows: nextKnows,
      },
    });
    setNotice('已移除该 Knows 信息边界条目');
  };

  const updateCharField = (idx: number, key: keyof CharacterProfile, val: string) => {
    const target = editingBible.characters[idx];
    if (!target || appearanceMap.get(target.id)?.locked) return;
    const next = [...editingBible.characters];
    next[idx] = { ...next[idx], [key]: val };
    setEditingBible({ ...editingBible, characters: next });
    setIsDirty(true);
  };

  const getCharStateValue = (charName: string): string => {
    return (
      editingCharStates.find((cs) => cs.characterName === charName)?.currentState || ''
    );
  };

  const updateCharStateValue = (charName: string, val: string) => {
    setIsDirty(true);
    setEditingCharStates((prev) => {
      const exists = prev.some((cs) => cs.characterName === charName);
      if (exists) {
        return prev.map((cs) =>
          cs.characterName === charName ? { ...cs, currentState: val } : cs
        );
      }
      return [...prev, { characterName: charName, currentState: val }];
    });
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 flex flex-col gap-8">
      {/* Gate 1 Header Bar */}
      <div className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-zinc-500">
            Step 1 · 故事圣经 (bible/canon.md) · {book.gate1Approved ? 'Gate 1 已通过' : '等待作者确认 Gate 1'}
            {isDirty && ' · 有未保存修改'}
          </div>
          <h1 className="font-display text-2xl font-semibold text-zinc-900 mt-1">
            《{editingTitle || book.title}》设定集与人物圣经
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleSaveBible}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isDirty ? '保存圣经修改 *' : '保存圣经修改'}</span>
          </button>
          {!book.gate1Approved && (
            <button
              type="button"
              onClick={handleApproveGate1}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>批准 Gate 1</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 text-sm">
          {errorMsg}
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      {/* Two-Column Editorial Split */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
        {/* Left: Canon, Hard Constraints, Culture Anchors, Voice */}
        <div className="flex flex-col gap-6">
          <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-5">
            <h2 className="font-display text-lg font-semibold text-zinc-900">
              01. 书名、世界观与核心前提
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">书名 (title)</label>
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">时代与背景 (era)</label>
                <input
                  type="text"
                  value={editingBible.era}
                  onChange={(e) => setEditingBible({ ...editingBible, era: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                一句话核心前提 (Premise)
              </label>
              <textarea
                rows={2}
                value={editingBible.premise}
                onChange={(e) => setEditingBible({ ...editingBible, premise: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">核心舞台设定 (setting)</label>
                <input
                  type="text"
                  value={editingBible.setting}
                  onChange={(e) => setEditingBible({ ...editingBible, setting: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">世界运转规则 (worldRules)</label>
                <input
                  type="text"
                  value={editingBible.worldRules}
                  onChange={(e) => setEditingBible({ ...editingBible, worldRules: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                地理与核心地标（每行一个）
              </label>
              <textarea
                rows={3}
                value={editingBible.locations.join('\n')}
                onChange={(e) =>
                  setEditingBible({
                    ...editingBible,
                    locations: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                  })
                }
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
              />
            </div>

            <div className="pt-4 border-t border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-900 mb-2">
                硬约束铁律 (Hard Constraints — 每章写前必重申，绝不可为救戏而破)
              </h3>
              <ul className="space-y-2 mb-3">
                {editingBible.hardConstraints.map((rule, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500 w-5">{idx + 1}.</span>
                    <input
                      type="text"
                      value={rule}
                      onChange={(e) => {
                        const next = [...editingBible.hardConstraints];
                        next[idx] = e.target.value;
                        setEditingBible({ ...editingBible, hardConstraints: next });
                      }}
                      className="flex-1 px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBible({
                          ...editingBible,
                          hardConstraints: editingBible.hardConstraints.filter((_, i) => i !== idx),
                        });
                      }}
                      className="text-xs text-zinc-500 hover:text-red-700 px-2 py-1 cursor-pointer"
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  placeholder="新增一条不可违背的硬约束..."
                  className="flex-1 px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newRule.trim()) return;
                    setEditingBible({
                      ...editingBible,
                      hardConstraints: [...editingBible.hardConstraints, newRule.trim()],
                    });
                    setNewRule('');
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-lg cursor-pointer"
                >
                  添加约束
                </button>
              </div>
            </div>
          </section>

          <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-4">
            <h2 className="font-display text-lg font-semibold text-zinc-900">
              02. 文化锚点与叙事声音 (Voice & Anchors)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">衣着锚点</label>
                <input
                  type="text"
                  value={editingBible.cultureAnchors.clothing}
                  onChange={(e) =>
                    setEditingBible({
                      ...editingBible,
                      cultureAnchors: { ...editingBible.cultureAnchors, clothing: e.target.value },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">饮食锚点</label>
                <input
                  type="text"
                  value={editingBible.cultureAnchors.food}
                  onChange={(e) =>
                    setEditingBible({
                      ...editingBible,
                      cultureAnchors: { ...editingBible.cultureAnchors, food: e.target.value },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">核心器物</label>
                <input
                  type="text"
                  value={editingBible.cultureAnchors.objects}
                  onChange={(e) =>
                    setEditingBible({
                      ...editingBible,
                      cultureAnchors: { ...editingBible.cultureAnchors, objects: e.target.value },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">场景风貌</label>
                <input
                  type="text"
                  value={editingBible.cultureAnchors.landscape}
                  onChange={(e) =>
                    setEditingBible({
                      ...editingBible,
                      cultureAnchors: { ...editingBible.cultureAnchors, landscape: e.target.value },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 mb-1">主色调</label>
                <input
                  type="text"
                  value={editingBible.cultureAnchors.colour}
                  onChange={(e) =>
                    setEditingBible({
                      ...editingBible,
                      cultureAnchors: { ...editingBible.cultureAnchors, colour: e.target.value },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">叙述者语调</label>
              <input
                type="text"
                value={editingBible.voice.narrator}
                onChange={(e) =>
                  setEditingBible({
                    ...editingBible,
                    voice: { ...editingBible.voice, narrator: e.target.value },
                  })
                }
                className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">角色对白区分度</label>
              <input
                type="text"
                value={editingBible.voice.dialogueDistinctness}
                onChange={(e) =>
                  setEditingBible({
                    ...editingBible,
                    voice: { ...editingBible.voice, dialogueDistinctness: e.target.value },
                  })
                }
                className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                本书专属禁用词/口头禅黑名单（逗号分隔）
              </label>
              <input
                type="text"
                value={(editingBible.voice.customBanned || []).join('，')}
                onChange={(e) =>
                  setEditingBible({
                    ...editingBible,
                    voice: {
                      ...editingBible.voice,
                      customBanned: e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="例如：冷笑一声，嘴角勾起"
                className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
              />
            </div>
          </section>

          {/* Launch Skill 2: Packaging */}
          <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-semibold text-zinc-900">
                03. 作品包装 (包装技能：书名 / 简介 / 封面 Brief)
              </h2>
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleGeneratePackaging}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{busy === 'packaging' ? '生成中...' : 'AI 生成包装方案'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-5 items-start">
              <div className="aspect-[3/4] rounded-lg overflow-hidden border border-zinc-200 bg-zinc-100 flex items-center justify-center">
                {book.packaging?.coverImageUrl && !coverImgFailed ? (
                  <img
                    src={book.packaging.coverImageUrl}
                    alt={`《${editingTitle || book.title}》封面预览`}
                    referrerPolicy="no-referrer"
                    onError={() => setCoverImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="p-3 text-center flex flex-col items-center justify-center gap-2 text-zinc-500">
                    <BookOpen className="w-6 h-6 text-zinc-400" />
                    <span className="font-display text-sm font-semibold text-zinc-800">
                      《{editingTitle || book.title}》
                    </span>
                  </div>
                )}
              </div>

              <div className="text-sm text-zinc-700 space-y-2.5">
                {book.packaging ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-zinc-500">书名候选：</span>
                      {book.packaging.titleCandidates.map((cand) => (
                        <button
                          key={cand}
                          type="button"
                          onClick={() => handleApplyPackagingTitle(cand)}
                          className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                          title="点击设为当前书名"
                        >
                          《{cand}》
                        </button>
                      ))}
                    </div>
                    <div>
                      <span className="text-xs text-zinc-500">关键词：</span>
                      <span>{book.packaging.keywords.join(' · ')}</span>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 mb-0.5">平台简介 (Blurb)：</div>
                      <p className="whitespace-pre-line text-zinc-800 leading-relaxed text-xs bg-zinc-50 p-3 rounded-lg border border-zinc-200">
                        {book.packaging.blurb}
                      </p>
                    </div>
                    <div className="text-xs text-zinc-600">
                      封面指令：{book.packaging.coverBrief}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    尚未运行包装技能。可随时点击右上角生成面向 {book.platform} 的高点击书名候选、简介与封面视觉指令。
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Right: Characters & Knows Matrix */}
        <div className="flex flex-col gap-6">
          <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-zinc-900">
                  04. 人物档案与人物锻造（当前共 {editingBible.characters.length} 人）
                </h2>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  人物数量不设上限：前期规划 3–5 位核心角色即可，无需一次塞满全书配角；创作中途可随时通过「AI 人物锻造」补充新人，自动继承本作世界观、对白声线并生成切入故事。
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  未出场角色可随时更改全部属性并保存生效；已在正文中出场的角色，其基础设定将置灰锁定不可更改，后续变化请编辑下方「当前动态状态」或「Knows 账本」。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{manualOpen ? '收起手动表单' : '手动新增角色'}</span>
              </button>
            </div>

            {manualOpen && (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="角色姓名（必填）"
                    className="px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                  />
                  <input
                    type="text"
                    value={manualAge}
                    onChange={(e) => setManualAge(e.target.value)}
                    placeholder="年龄"
                    className="px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                  />
                  <input
                    type="text"
                    value={manualRole}
                    onChange={(e) => setManualRole(e.target.value)}
                    placeholder="角色定位（如：盟友/对手）"
                    className="px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                  />
                </div>
                <input
                  type="text"
                  value={manualDna}
                  onChange={(e) => setManualDna(e.target.value)}
                  placeholder="DNA（外貌特征 + 主色调 + 信物）"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={manualSpeechStyle}
                    onChange={(e) => setManualSpeechStyle(e.target.value)}
                    placeholder="说话腔调与用词习惯（选填）"
                    className="px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                  />
                  <input
                    type="text"
                    value={manualDebutPlan}
                    onChange={(e) => setManualDebutPlan(e.target.value)}
                    placeholder={`切入时机与出场引子（如：第 ${book.state.nextChapter} 章借案件登场）`}
                    className="px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualWant}
                    onChange={(e) => setManualWant(e.target.value)}
                    placeholder="表层诉求 (Want)"
                    className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-zinc-300 rounded"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualCharacter}
                    className="px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded cursor-pointer whitespace-nowrap shrink-0"
                  >
                    确认添加
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={forgeHint}
                onChange={(e) => setForgeHint(e.target.value)}
                placeholder={`输入角色定位由 AI 锻造（自动对齐第 ${book.state.nextChapter} 章画风与切入引子）...`}
                className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-lg"
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleForgeCharacter}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{busy === 'forge' ? '锻造中...' : 'AI 人物锻造'}</span>
              </button>
            </div>

            <div className="divide-y divide-zinc-200">
              {editingBible.characters.map((char, idx) => {
                const appearance = appearanceMap.get(char.id);
                const isLocked = Boolean(appearance?.locked);
                const fieldClass = isLocked
                  ? 'w-full mt-0.5 px-2.5 py-1 text-xs border border-zinc-200 rounded bg-zinc-100 text-zinc-500 cursor-not-allowed'
                  : 'w-full mt-0.5 px-2.5 py-1 text-xs border border-zinc-200 rounded bg-zinc-50 text-zinc-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600';

                return (
                  <div
                    key={char.id}
                    className={`py-4 first:pt-2 last:pb-2 space-y-2.5 ${
                      isLocked ? 'bg-zinc-50/70 px-3 -mx-3 rounded-lg' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {isLocked ? (
                        <div className="inline-flex items-center gap-1.5 text-zinc-500">
                          <Lock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <span>
                            已于第 {appearance!.chapters.join('、')} 章出场 · 正史已定型，档案属性已锁定不可更改
                          </span>
                        </div>
                      ) : (
                        <div className="text-zinc-500">
                          尚未在正文出场 · 可自由更改各项属性
                        </div>
                      )}
                      {(!isLocked || isDirty) && (
                        <button
                          type="button"
                          onClick={handleSaveBible}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Save className="w-3 h-3" />
                          <span>保存更改</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-[1.2fr_0.7fr_1fr_auto] gap-2 items-center">
                      <input
                        type="text"
                        value={char.name}
                        disabled={isLocked}
                        onChange={(e) => updateCharField(idx, 'name', e.target.value)}
                        placeholder="姓名"
                        aria-label="角色姓名"
                        className={
                          isLocked
                            ? 'px-2.5 py-1 text-sm font-semibold text-zinc-500 border border-zinc-200 rounded bg-zinc-100 cursor-not-allowed'
                            : 'px-2.5 py-1 text-sm font-semibold text-zinc-900 border border-zinc-200 rounded bg-zinc-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600'
                        }
                      />
                      <input
                        type="text"
                        value={char.age}
                        disabled={isLocked}
                        onChange={(e) => updateCharField(idx, 'age', e.target.value)}
                        placeholder="年龄"
                        aria-label="角色年龄"
                        className={
                          isLocked
                            ? 'px-2 py-1 text-xs text-zinc-500 border border-zinc-200 rounded bg-zinc-100 cursor-not-allowed'
                            : 'px-2 py-1 text-xs text-zinc-700 border border-zinc-200 rounded bg-zinc-50 focus:bg-white'
                        }
                      />
                      <input
                        type="text"
                        value={char.role}
                        disabled={isLocked}
                        onChange={(e) => updateCharField(idx, 'role', e.target.value)}
                        placeholder="定位"
                        aria-label="角色定位"
                        className={
                          isLocked
                            ? 'px-2 py-1 text-xs text-zinc-500 border border-zinc-200 rounded bg-zinc-100 cursor-not-allowed'
                            : 'px-2 py-1 text-xs text-zinc-700 border border-zinc-200 rounded bg-zinc-50 focus:bg-white'
                        }
                      />
                      {!isLocked && editingBible.characters.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCharacter(char.id)}
                          className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer"
                          title={`移除未出场角色 ${char.name}`}
                          aria-label={`移除 ${char.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="text-xs text-zinc-700 space-y-1.5">
                      <div>
                        <span className="text-zinc-500">DNA（外形/色/信物）：</span>
                        <input
                          type="text"
                          value={char.dna}
                          disabled={isLocked}
                          onChange={(e) => updateCharField(idx, 'dna', e.target.value)}
                          className={fieldClass}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-zinc-500">Want（欲望目标）：</span>
                          <input
                            type="text"
                            value={char.want}
                            disabled={isLocked}
                            onChange={(e) => updateCharField(idx, 'want', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <span className="text-zinc-500">Need（深层需求）：</span>
                          <input
                            type="text"
                            value={char.need}
                            disabled={isLocked}
                            onChange={(e) => updateCharField(idx, 'need', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-zinc-500">Flaw（性格缺陷）：</span>
                          <input
                            type="text"
                            value={char.flaw}
                            disabled={isLocked}
                            onChange={(e) => updateCharField(idx, 'flaw', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <span className="text-zinc-500">Arc（角色弧光）：</span>
                          <input
                            type="text"
                            value={char.arc}
                            disabled={isLocked}
                            onChange={(e) => updateCharField(idx, 'arc', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <span className="text-zinc-500">说话腔调 / 对白习惯：</span>
                          <input
                            type="text"
                            value={char.speechStyle || ''}
                            disabled={isLocked}
                            placeholder={isLocked ? '未单独登记' : '例如：说话慢半拍，喜用账目词汇比喻人事'}
                            onChange={(e) => updateCharField(idx, 'speechStyle', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <span className="text-zinc-500">切入时机与出场故事：</span>
                          <input
                            type="text"
                            value={char.debutPlan || ''}
                            disabled={isLocked}
                            placeholder={isLocked ? '已正式入戏' : `例如：第 ${book.state.nextChapter} 章以核查旧账之名切入主线`}
                            onChange={(e) => updateCharField(idx, 'debutPlan', e.target.value)}
                            className={fieldClass}
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-zinc-500">
                          当前动态状态（随剧情演变，已出场角色仍可更新 · state/character_state.md）：
                        </span>
                        <input
                          type="text"
                          value={getCharStateValue(char.name)}
                          onChange={(e) => updateCharStateValue(char.name, e.target.value)}
                          placeholder="记录该角色当前的处境、立场或目标变化..."
                          className="w-full mt-0.5 px-2.5 py-1 text-xs border border-zinc-200 rounded bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Per-character Knows List */}
          <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-zinc-900">
                05. 信息边界账本 (state/knows.md)
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                人物可以猜疑或误判，但绝不允许在未被告知前“知道”未获悉的事实；点击“已知/未知”可快速修正认知状态。
              </p>
            </div>

            <div className="max-h-[320px] overflow-y-auto divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
              {book.state.knows.map((k) => (
                <div key={k.id} className="px-3.5 py-2.5 text-xs flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-semibold text-zinc-900">{k.characterName}</span>{' '}
                    <button
                      type="button"
                      onClick={() => handleToggleKnowsEntry(k.id)}
                      className={`font-medium hover:underline cursor-pointer ${
                        k.knows ? 'text-emerald-700' : 'text-red-700'
                      }`}
                      title="点击切换已知/未知状态并保存"
                    >
                      {k.knows ? '已知' : '未知'}
                    </button>
                    <span className="text-zinc-700">：{k.fact}</span>
                    {k.note && <span className="text-zinc-400"> ({k.note})</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {k.learnedChapter && (
                      <span className="font-mono text-zinc-500 tabular-nums">
                        Ch {k.learnedChapter}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteKnowsEntry(k.id)}
                      className="text-zinc-400 hover:text-red-600 cursor-pointer"
                      title="移除此条目"
                      aria-label="移除 Knows 条目"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[110px_90px_1fr_auto] gap-2 items-center pt-1">
              <select
                value={newKnowsChar}
                onChange={(e) => setNewKnowsChar(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white"
              >
                {editingBible.characters.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={newKnowsBool ? 'yes' : 'no'}
                onChange={(e) => setNewKnowsBool(e.target.value === 'yes')}
                className="px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white"
              >
                <option value="yes">已知</option>
                <option value="no">未知</option>
              </select>
              <input
                type="text"
                value={newKnowsFact}
                onChange={(e) => setNewKnowsFact(e.target.value)}
                placeholder="事实内容..."
                className="px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg"
              />
              <button
                type="button"
                onClick={handleAddKnowsEntry}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
