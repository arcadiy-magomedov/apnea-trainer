import { BrowserRouter } from 'react-router-dom';
import { ServicesProvider } from './ui/app/services';
import { AppProviders } from './ui/app/stores';
import { AppRoutes } from './ui/app/routes';
import { UpdatePrompt } from './ui/pwa/UpdatePrompt';

export default function App() {
  return (
    <ServicesProvider>
      <AppProviders>
        <BrowserRouter>
          <AppRoutes />
          <UpdatePrompt />
        </BrowserRouter>
      </AppProviders>
    </ServicesProvider>
  );
}
