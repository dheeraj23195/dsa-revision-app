import { useEffect, useState } from 'react';
import { BankScreen } from './screens/BankScreen';
import { TodayScreen } from './screens/TodayScreen';
import { CoverageScreen } from './screens/CoverageScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { applyTheme, getInitialTheme, type Theme } from './lib/theme';

type Screen = 'today' | 'bank' | 'coverage' | 'settings';

function App() {
  const [screen, setScreen] = useState<Screen>('today');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="min-h-screen bg-white text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <nav className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6">
          <div className="flex gap-1">
            <NavTab label="Today" active={screen === 'today'} onClick={() => setScreen('today')} />
            <NavTab label="Bank" active={screen === 'bank'} onClick={() => setScreen('bank')} />
            <NavTab label="Coverage" active={screen === 'coverage'} onClick={() => setScreen('coverage')} />
            <NavTab label="Settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
          </div>
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </nav>
      {screen === 'today' && <TodayScreen />}
      {screen === 'bank' && <BankScreen />}
      {screen === 'coverage' && <CoverageScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </div>
  );
}

function NavTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
        active
          ? 'border-indigo-500 text-indigo-700 dark:text-indigo-400'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  );
}

export default App;
