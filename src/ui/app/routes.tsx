import { Navigate, Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useAppStore } from './stores';
import { HomeScreen } from '../screens/HomeScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { RunnerScreen } from '../screens/RunnerScreen';
import { BaselineScreen } from '../screens/BaselineScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ProgramScreen } from '../screens/ProgramScreen';
import { SummaryScreen } from '../screens/SummaryScreen';

function HomeOrOnboarding() {
  const state = useAppStore((s) => s.state);
  const hydrated = useAppStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (!state.settings.onboarded) return <Navigate to="/onboarding" replace />;
  return <AppShell><HomeScreen /></AppShell>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/baseline" element={<BaselineScreen />} />
      <Route path="/runner" element={<RunnerScreen />} />
      <Route path="/summary" element={<AppShell><SummaryScreen /></AppShell>} />
      <Route path="/" element={<HomeOrOnboarding />} />
      <Route path="/stats" element={<AppShell><StatsScreen /></AppShell>} />
      <Route path="/program" element={<AppShell><ProgramScreen /></AppShell>} />
      <Route path="/settings" element={<AppShell><SettingsScreen /></AppShell>} />
    </Routes>
  );
}
