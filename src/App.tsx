import React from 'react';
import { AuthProvider } from './context/AuthContext';
import { CashProvider, useCash } from './context/CashContext';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { HomeView } from './components/HomeView';
import { TransactionsView } from './components/TransactionsView';
import { MachinesView } from './components/MachinesView';
import { ReconciliationView } from './components/ReconciliationView';
import { HistoryView } from './components/HistoryView';
import { AddTransactionModal } from './components/AddTransactionModal';
import { EditTransactionModal } from './components/EditTransactionModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { AddMachineModal } from './components/AddMachineModal';
import { EditOpeningBalanceModal } from './components/EditOpeningBalanceModal';
import { CloseDayModal } from './components/CloseDayModal';
import { StartDayModal } from './components/StartDayModal';

const MainContent: React.FC = () => {
  const { activeTab } = useCash();

  return (
    <main className="max-w-3xl mx-auto px-4 py-4 min-h-[calc(100vh-130px)]">
      {activeTab === 'home' && <HomeView />}
      {activeTab === 'transactions' && <TransactionsView />}
      {activeTab === 'machines' && <MachinesView />}
      {activeTab === 'reconciliation' && <ReconciliationView />}
      {activeTab === 'history' && <HistoryView />}

      {/* Global Modals */}
      <AddTransactionModal />
      <EditTransactionModal />
      <DeleteConfirmModal />
      <AddMachineModal />
      <EditOpeningBalanceModal />
      <CloseDayModal />
      <StartDayModal />
    </main>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <CashProvider>
        <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col selection:bg-emerald-100 selection:text-emerald-900 pb-8 sm:pb-12">
          <Header />
          <MainContent />
          <BottomNav />
        </div>
      </CashProvider>
    </AuthProvider>
  );
}
