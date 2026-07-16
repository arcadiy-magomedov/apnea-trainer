import { Navigate, Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useAppStore } from './stores';
import { HomeScreen } from '../screens/HomeScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { RunnerScreen } from '../screens/RunnerScreen';
import { BaselineScreen } from '../screens/BaselineScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { SetGoalScreen } from '../screens/SetGoalScreen';
import { BreathDebugScreen } from '../screens/BreathDebugScreen';

function HomeOrOnboarding() {
  const state = useAppStore((s) => s.state);
  const hydrated = useAppStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (!state.settings.onboarded) return <Navigate to="/onboarding" replace />;
  return <HomeScreen />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/baseline" element={<BaselineScreen />} />
      <Route path="/runner" element={<RunnerScreen />} />
      <Route path="/summary" element={<AppShell><SummaryScreen /></AppShell>} />
      <Route path="/goal" element={<SetGoalScreen />} />
      <Route path="/" element={<HomeOrOnboarding />} />
      <Route path="/stats" element={<AppShell><StatsScreen /></AppShell>} />
      <Route path="/calendar" element={<AppShell><CalendarScreen /></AppShell>} />
      <Route path="/program" element={<Navigate to="/calendar" replace />} />
      <Route path="/breath-debug" element={<AppShell><BreathDebugScreen /></AppShell>} />
      <Route path="/settings" element={<AppShell><SettingsScreen /></AppShell>} />
    </Routes>
  );
}
