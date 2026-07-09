import { Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';
import { HomeScreen } from '../screens/HomeScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { TrainScreen } from '../screens/TrainScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { RunnerScreen } from '../screens/RunnerScreen';
import { BaselineScreen } from '../screens/BaselineScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ProgramScreen } from '../screens/ProgramScreen';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/baseline" element={<BaselineScreen />} />
      <Route path="/runner" element={<RunnerScreen />} />
      <Route path="/" element={<AppShell><HomeScreen /></AppShell>} />
      <Route path="/stats" element={<AppShell><StatsScreen /></AppShell>} />
      <Route path="/train" element={<AppShell><TrainScreen /></AppShell>} />
      <Route path="/program" element={<AppShell><ProgramScreen /></AppShell>} />
      <Route path="/settings" element={<AppShell><SettingsScreen /></AppShell>} />
    </Routes>
  );
}
