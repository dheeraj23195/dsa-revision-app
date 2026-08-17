import { useState } from 'react';
import { BankScreen } from './screens/BankScreen';
import { TodayScreen } from './screens/TodayScreen';

type Screen = 'today' | 'bank';

function App() {
  const [screen, setScreen] = useState<Screen>('today');

  return (
    <div>
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl gap-1 px-6">
          <NavTab label="Today" active={screen === 'today'} onClick={() => setScreen('today')} />
          <NavTab label="Bank" active={screen === 'bank'} onClick={() => setScreen('bank')} />
        </div>
      </nav>
      {screen === 'today' ? <TodayScreen /> : <BankScreen />}
    </div>
  );
}

function NavTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
        active
          ? 'border-indigo-500 text-indigo-700'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

export default App;
