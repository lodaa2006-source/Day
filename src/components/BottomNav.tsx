import React from 'react';
import { LayoutDashboard, ArrowUpDown, Smartphone, Scale, CalendarDays } from 'lucide-react';
import { useCash } from '../context/CashContext';
import { NavTab } from '../types';

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab, transactions } = useCash();

  const navItems: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'الرئيسية', icon: LayoutDashboard },
    { id: 'transactions', label: 'الحركات', icon: ArrowUpDown },
    { id: 'machines', label: 'الماكينات', icon: Smartphone },
    { id: 'reconciliation', label: 'المراجعة', icon: Scale },
    { id: 'history', label: 'الأيام السابقة', icon: CalendarDays },
  ];

  return (
    <nav
      id="main-bottom-navigation"
      aria-label="التنقل الرئيسي"
      className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 shadow-lg"
    >
      <div className="max-w-3xl mx-auto px-2 flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              id={`nav-tab-${item.id}`}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex-1 py-2.5 px-2 flex flex-col items-center justify-center gap-1 min-h-[56px] transition-colors relative ${
                isActive
                  ? 'text-stone-900 font-bold'
                  : 'text-stone-500 hover:text-stone-800 font-medium'
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? 'scale-110 text-emerald-700' : 'text-stone-400'
                  }`}
                />
                {item.id === 'transactions' && transactions.length > 0 && (
                  <span className="absolute -top-1.5 -end-2.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-stone-800 text-white min-w-4 text-center">
                    {transactions.length}
                  </span>
                )}
              </div>
              <span className={`text-xs ${isActive ? 'text-stone-900 font-bold' : 'text-stone-500'}`}>
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 w-8 h-1 bg-emerald-600 rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
