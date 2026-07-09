import { BrowserRouter } from 'react-router-dom';
import { ServicesProvider } from './ui/app/services';
import { AppProviders } from './ui/app/stores';
import { AppRoutes } from './ui/app/routes';

export default function App() {
  return (
    <ServicesProvider>
      <AppProviders>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
    </ServicesProvider>
  );
}
