import React from 'react';

export type WorkspaceTab = 'studio' | 'bible' | 'ledger' | 'skills';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onChangeTab: (tab: WorkspaceTab) => void;
  onOpenNewBook: () => void;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'studio', label: '创作工坊' },
  { id: 'bible', label: '故事圣经' },
  { id: 'ledger', label: '台账大纲' },
  { id: 'skills', label: '技能内核' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onChangeTab,
  onOpenNewBook,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-zinc-200">
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onChangeTab('studio')}
          className="font-display text-lg font-semibold tracking-tight text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          Long Novel Studio
        </button>

        <nav className="flex items-center gap-6 overflow-x-auto" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeTab(item.id)}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded ${
                  isActive
                    ? 'text-blue-700'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[17px] h-0.5 bg-blue-700"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenNewBook}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            新建 / 导入
          </button>
        </div>
      </div>
    </header>
  );
};
