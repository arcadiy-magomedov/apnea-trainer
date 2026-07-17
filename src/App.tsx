import { BrowserRouter } from 'react-router-dom';
import { ServicesProvider } from './ui/app/services';
import { AppProviders } from './ui/app/stores';
import { AppRoutes } from './ui/app/routes';
import { UpdatePrompt } from './ui/pwa/UpdatePrompt';
import {
  AnalyticsConsentProvider,
} from './ui/analytics/AnalyticsConsentProvider';
import { AnalyticsConsentPrompt } from './ui/analytics/AnalyticsConsentPrompt';
import { AnalyticsRouteTracker } from './ui/analytics/AnalyticsRouteTracker';

export default function App() {
  return (
    <ServicesProvider>
      <AnalyticsConsentProvider>
        <AppProviders>
          <BrowserRouter>
            <AnalyticsRouteTracker />
            <AppRoutes />
            <AnalyticsConsentPrompt />
            <UpdatePrompt />
          </BrowserRouter>
        </AppProviders>
      </AnalyticsConsentProvider>
    </ServicesProvider>
  );
}
