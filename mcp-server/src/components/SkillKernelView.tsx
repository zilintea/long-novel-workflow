import React, { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  DEFAULT_SLOP_LIST,
  DESIRE_SPECS,
  GENRE_PACKS,
  HOOK_TYPE_SPECS,
  LAUNCH_PLUGGABLE_SKILLS,
  REPO_META,
  WORKFLOW_PROHIBITIONS,
  WORKFLOW_STEPS,
} from '../shared/skillSpecs.ts';

interface SkillKernelViewProps {
  slopZh: string[];
  slopEn: string[];
  onUpdateSlopZh: (next: string[]) => void;
  onUpdateSlopEn: (next: string[]) => void;
}

export const SkillKernelView: React.FC<SkillKernelViewProps> = ({
  slopZh,
  slopEn,
  onUpdateSlopZh,
  onUpdateSlopEn,
}) => {
  const [newPhraseZh, setNewPhraseZh] = useState('');
  const [newPhraseEn, setNewPhraseEn] = useState('');

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 flex flex-col gap-8">
      {/* Repo Header */}
      <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-zinc-500">
            已加载开源技能仓库 · {REPO_META.name} · {REPO_META.version} ({REPO_META.updatedAt}) · {REPO_META.license} License
          </div>
          <h1 className="font-display text-2xl font-semibold text-zinc-900 mt-1">
            long-novel-workflow 核心工作流与规则内核
          </h1>
          <p className="text-sm text-zinc-600 mt-1.5 max-w-3xl">{REPO_META.tagline}</p>
        </div>
        <div className="text-xs font-mono text-zinc-500 shrink-0">
          {REPO_META.repoUrl}
        </div>
      </section>

      {/* 6-Step Workflow + 5 Launch Skills */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <section className="bg-white border border-zinc-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-zinc-900 mb-4">
            01. 六步闭环工作流 (Gates & Loop)
          </h2>
          <div className="divide-y divide-zinc-100">
            {WORKFLOW_STEPS.map((s) => (
              <div key={s.step} className="py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-900">
                    {s.step} · {s.title}
                  </span>
                  <span className="text-xs font-medium text-blue-700 shrink-0">{s.gate}</span>
                </div>
                <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{s.summary}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-900 mb-3">
              02. 五项首发可插拔技能 (Launch Skills)
            </h2>
            <div className="divide-y divide-zinc-100">
              {LAUNCH_PLUGGABLE_SKILLS.map((sk) => (
                <div key={sk.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-zinc-900">{sk.name}</span>
                    <span className="font-mono text-xs text-zinc-500">{sk.slot}</span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">{sk.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-200">
            <h3 className="text-sm font-semibold text-zinc-900 mb-2">
              铁律禁令 (Prohibitions)
            </h3>
            <ul className="list-disc list-inside text-xs text-zinc-700 space-y-1.5">
              {WORKFLOW_PROHIBITIONS.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* 8 Desires & Genre Packs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <section className="bg-white border border-zinc-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-zinc-900 mb-3">
            03. 8 种核心读者欲望（支持 AI 自动判断）与 7 种钩子类型
          </h2>
          <div className="space-y-3 mb-5">
            {Object.values(DESIRE_SPECS).map((d) => (
              <div key={d.key} className="text-xs">
                <span className="font-semibold text-zinc-900">{d.labelZh}</span>{' '}
                <span className="font-mono text-zinc-500">({d.key})</span>
                <span className="text-zinc-600"> — {d.description}</span>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-zinc-200">
            <div className="text-xs font-semibold text-zinc-800 mb-2">7 种章节结尾钩子</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-600">
              {HOOK_TYPE_SPECS.map((h) => (
                <div key={h.id}>
                  <strong className="text-zinc-800">{h.label}：</strong>
                  {h.desc}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white border border-zinc-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-zinc-900 mb-3">
            04. 已加载题材数据包 (data/genres/)
          </h2>
          <div className="divide-y divide-zinc-200">
            {GENRE_PACKS.map((g) => (
              <div key={g.id} className="py-3 first:pt-0 last:pb-0 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900 text-sm">{g.label}</span>
                  <span className="text-zinc-500 font-mono">{g.platform}</span>
                </div>
                <div className="text-zinc-600">配方：{g.formula} · {g.lengthLabel}</div>
                <div className="text-zinc-700">爽点形态：{g.payoffShape}</div>
                <div className="text-amber-800">风控：{g.risks.join('；')}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Editable De-Slop Lists */}
      <section className="bg-white border border-zinc-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-zinc-900">
              05. 双语去 AI 味禁用词表 (data/slop/zh.yaml & en.yaml)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              阻断审计器会在草稿与提交前实时扫描正文是否命中下列句式。您可以随时增删自定义禁用词。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onUpdateSlopZh(DEFAULT_SLOP_LIST.zh);
              onUpdateSlopEn(DEFAULT_SLOP_LIST.en);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复仓库默认词表</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold text-zinc-800 mb-2">中文禁用句式 (zh)</h3>
            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg mb-2.5">
              {slopZh.map((phrase) => (
                <li
                  key={phrase}
                  className="px-3 py-2 text-xs flex items-center justify-between gap-2"
                >
                  <span className="text-zinc-800">{phrase}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateSlopZh(slopZh.filter((p) => p !== phrase))}
                    className="text-zinc-400 hover:text-red-600 cursor-pointer"
                    aria-label={`移除 ${phrase}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPhraseZh}
                onChange={(e) => setNewPhraseZh(e.target.value)}
                placeholder="新增中文禁用句式..."
                className="flex-1 px-3 py-1.5 text-xs border border-zinc-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newPhraseZh.trim()) return;
                  if (!slopZh.includes(newPhraseZh.trim())) {
                    onUpdateSlopZh([...slopZh, newPhraseZh.trim()]);
                  }
                  setNewPhraseZh('');
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加</span>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-zinc-800 mb-2">English Banned Phrases (en)</h3>
            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg mb-2.5">
              {slopEn.map((phrase) => (
                <li
                  key={phrase}
                  className="px-3 py-2 text-xs flex items-center justify-between gap-2"
                >
                  <span className="text-zinc-800">{phrase}</span>
                  <button
                    type="button"
                    onClick={() => onUpdateSlopEn(slopEn.filter((p) => p !== phrase))}
                    className="text-zinc-400 hover:text-red-600 cursor-pointer"
                    aria-label={`Remove ${phrase}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPhraseEn}
                onChange={(e) => setNewPhraseEn(e.target.value)}
                placeholder="Add English banned phrase..."
                className="flex-1 px-3 py-1.5 text-xs border border-zinc-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newPhraseEn.trim()) return;
                  if (!slopEn.includes(newPhraseEn.trim())) {
                    onUpdateSlopEn([...slopEn, newPhraseEn.trim()]);
                  }
                  setNewPhraseEn('');
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
