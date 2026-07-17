import { expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  AnalyticsConsent,
  AnalyticsConsentStore,
} from '../../application/analytics/analyticsService';
import { noopAnalytics } from '../../infrastructure/analytics/noopAnalytics';
import {
  FakeAnalyticsService,
  MemoryAnalyticsConsentStore,
} from '../../test/fakeAnalytics';
import { ServicesProvider } from '../app/services';
import {
  AnalyticsConsentProvider,
  useAnalyticsConsent,
} from './AnalyticsConsentProvider';
import { AnalyticsConsentPrompt } from './AnalyticsConsentPrompt';

function renderPrompt(
  path = '/',
  analytics = new FakeAnalyticsService(),
  store = new MemoryAnalyticsConsentStore(),
) {
  const result = render(
    <ServicesProvider value={{ analytics, analyticsConsent: store }}>
      <AnalyticsConsentProvider>
        <MemoryRouter initialEntries={[path]}>
          <button>Background action</button>
          <ExternalDecisionProbe />
          <AnalyticsConsentPrompt />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  return { ...result, analytics, store };
}

function ReadyProbe() {
  const { ready } = useAnalyticsConsent();
  return <span>{ready ? 'analytics-ready' : 'analytics-loading'}</span>;
}

function ExternalDecisionProbe() {
  const { choose } = useAnalyticsConsent();
  return (
    <button onClick={() => void choose('denied')}>
      External denial
    </button>
  );
}

it('offers equally clear accept and decline choices and persists decline', async () => {
  const { store } = renderPrompt();

  expect(await screen.findByRole('dialog', {
    name: /anonymous usage analytics/i,
  }))
    .toBeInTheDocument();
  expect(screen.getByText(/anonymous app usage leaves this device/i))
    .toBeInTheDocument();
  expect(screen.getByText(/improve the app/i)).toBeInTheDocument();
  expect(screen.getByText(
    /estimate whether future ads could be supported on non-training screens/i,
  ))
    .toBeInTheDocument();
  expect(screen.getByText(
    /exact training measurements, exact goal values, contractions, and reminder times are never collected/i,
  )).toBeInTheDocument();
  expect(screen.getByRole('dialog')).not.toHaveTextContent(
    /training measurements, goals, contractions/i,
  );
  expect(screen.getByText(
    /Google Analytics 4 uses pseudonymous client and vendor session identifiers for measurement/i,
  )).toBeInTheDocument();
  expect(screen.getByText(
    /app does not send app-defined account, training, baseline, goal, or session identifiers/i,
  )).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /privacy details/i }))
    .toHaveAttribute('href', '/privacy');

  const accept = screen.getByRole('button', {
    name: /share anonymous usage analytics/i,
  });
  const decline = screen.getByRole('button', { name: /do not share/i });
  expect(accept).toBeEnabled();
  expect(decline).toBeEnabled();

  await userEvent.click(decline);

  expect(store.read()?.status).toBe('denied');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

it('keeps focus contained when the choice buttons are disabled', async () => {
  let resolveGrant!: () => void;
  const grant = new Promise<void>((resolve) => {
    resolveGrant = resolve;
  });
  class DeferredAnalytics extends FakeAnalyticsService {
    override async setConsent(consent: AnalyticsConsent): Promise<void> {
      await super.setConsent(consent);
      if (consent === 'granted') await grant;
    }
  }
  renderPrompt('/', new DeferredAnalytics());
  const accept = await screen.findByRole('button', {
    name: /share anonymous usage analytics/i,
  });
  const privacyLink = screen.getByRole('link', {
    name: /privacy details/i,
  });

  await userEvent.click(accept);
  expect(accept).toBeDisabled();

  fireEvent.keyDown(document, { key: 'Tab' });

  expect(privacyLink).toHaveFocus();
  await act(async () => {
    resolveGrant();
    await grant;
  });
});

it('contains focus, makes the background inert, and restores focus after a choice', async () => {
  const user = userEvent.setup();
  renderPrompt();
  const background = screen.getByRole('button', {
    name: /background action/i,
  });
  background.focus();

  await screen.findByRole('dialog', { name: /anonymous usage analytics/i });
  const privacyLink = screen.getByRole('link', {
    name: /privacy details/i,
  });
  const accept = screen.getByRole('button', {
    name: /share anonymous usage analytics/i,
  });
  const decline = screen.getByRole('button', { name: /do not share/i });

  expect(accept).toHaveFocus();
  expect(background).toHaveAttribute('inert');
  expect(background).toHaveAttribute('aria-hidden', 'true');

  privacyLink.focus();
  await user.tab({ shift: true });
  expect(decline).toHaveFocus();
  await user.tab();
  expect(privacyLink).toHaveFocus();

  await user.click(decline);

  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(background).not.toHaveAttribute('inert');
  expect(background).not.toHaveAttribute('aria-hidden');
  expect(background).toHaveFocus();
});

it('restores background accessibility and focus when unmounted while open', async () => {
  const analytics = new FakeAnalyticsService();
  const store = new MemoryAnalyticsConsentStore();
  const renderTree = (showPrompt: boolean) => (
    <ServicesProvider value={{ analytics, analyticsConsent: store }}>
      <AnalyticsConsentProvider>
        <MemoryRouter>
          <button>Background action</button>
          {showPrompt && <AnalyticsConsentPrompt />}
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>
  );
  const { rerender } = render(renderTree(true));
  const background = screen.getByRole('button', {
    name: /background action/i,
  });
  background.focus();
  await screen.findByRole('dialog', { name: /anonymous usage analytics/i });

  rerender(renderTree(false));

  expect(background).not.toHaveAttribute('inert');
  expect(background).not.toHaveAttribute('aria-hidden');
  expect(background).toHaveFocus();
});

it.each([
  '/runner',
  '/runner/',
  '/RuNnEr',
  '/RuNnEr/',
  '/baseline',
  '/baseline/',
  '/BaSeLiNe',
  '/BaSeLiNe/',
  '/privacy',
  '/privacy/',
  '/PrIvAcY',
  '/PrIvAcY/',
])(
  'does not interrupt the protected route %s',
  async (path) => {
    const { analytics } = renderPrompt(path);
    await waitFor(() => {
      expect(analytics.consentChanges).toContain('unknown');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);

it('does not request consent when analytics is unavailable', async () => {
  render(
    <ServicesProvider value={{
      analytics: noopAnalytics,
      analyticsConsent: new MemoryAnalyticsConsentStore(),
    }}>
      <AnalyticsConsentProvider>
        <MemoryRouter>
          <AnalyticsConsentPrompt />
          <ReadyProbe />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );

  expect(await screen.findByText('analytics-ready')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('does not resurrect the prompt for a later non-prompt decision error', async () => {
  class LaterResetFailureAnalytics extends FakeAnalyticsService {
    failReset = false;

    override async reset(): Promise<void> {
      await super.reset();
      if (this.failReset) throw new Error('private later reset detail');
    }
  }
  const analytics = new LaterResetFailureAnalytics();
  renderPrompt('/', analytics);

  await userEvent.click(await screen.findByRole('button', {
    name: /share anonymous usage analytics/i,
  }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  analytics.failReset = true;
  await userEvent.click(screen.getByRole('button', {
    name: /external denial/i,
  }));
  await waitFor(() => {
    expect(analytics.resetCalls).toBe(1);
  });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('disables both choices while the preference is being applied', async () => {
  let resolveGrant!: () => void;
  const grant = new Promise<void>((resolve) => {
    resolveGrant = resolve;
  });
  class DeferredAnalytics extends FakeAnalyticsService {
    override async setConsent(consent: AnalyticsConsent): Promise<void> {
      await super.setConsent(consent);
      if (consent === 'granted') await grant;
    }
  }
  const analytics = new DeferredAnalytics();
  render(
    <ServicesProvider value={{
      analytics,
      analyticsConsent: new MemoryAnalyticsConsentStore(),
    }}>
      <AnalyticsConsentProvider>
        <MemoryRouter>
          <AnalyticsConsentPrompt />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  const accept = await screen.findByRole('button', {
    name: /share anonymous usage analytics/i,
  });
  const decline = screen.getByRole('button', { name: /do not share/i });

  await userEvent.click(accept);

  expect(accept).toBeDisabled();
  expect(decline).toBeDisabled();
  resolveGrant();
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

it.each([
  ['adapter application', 'granted'],
  ['analytics reset', 'denied'],
] as const)(
  'keeps a prompt-initiated %s error visible and closes after retry',
  async (_operation, choice) => {
    class FailsOnceAnalytics extends FakeAnalyticsService {
      private failed = false;

      override async setConsent(consent: AnalyticsConsent): Promise<void> {
        await super.setConsent(consent);
        if (choice === 'granted' && consent === 'granted' && !this.failed) {
          this.failed = true;
          throw new Error('private adapter detail');
        }
      }

      override async reset(): Promise<void> {
        await super.reset();
        if (choice === 'denied' && !this.failed) {
          this.failed = true;
          throw new Error('private reset detail');
        }
      }
    }

    const store = new MemoryAnalyticsConsentStore();
    renderPrompt('/', new FailsOnceAnalytics(), store);
    const choiceButton = await screen.findByRole('button', {
      name: choice === 'granted'
        ? /share anonymous usage analytics/i
        : /do not share/i,
    });

    await userEvent.click(choiceButton);

    expect(store.read()?.status).toBe(choice);
    expect(await screen.findByRole('dialog', {
      name: /anonymous usage analytics/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      choice === 'granted'
        ? /could not apply the analytics preference/i
        : /could not be fully disabled/i,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private/i);

    await userEvent.click(choiceButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  },
);

it('does not show the first-use prompt for stored consent with an initial adapter error', async () => {
  class FailingStoredConsentAnalytics extends FakeAnalyticsService {
    override async setConsent(consent: AnalyticsConsent): Promise<void> {
      await super.setConsent(consent);
      if (consent === 'granted') {
        throw new Error('private initial adapter detail');
      }
    }
  }
  const analytics = new FailingStoredConsentAnalytics();
  renderPrompt(
    '/',
    analytics,
    new MemoryAnalyticsConsentStore({
      status: 'granted',
      decidedAt: 1,
    }),
  );

  await waitFor(() => {
    expect(analytics.consentChanges).toContain('granted');
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('shows provider errors without exposing private details', async () => {
  const analytics = new FakeAnalyticsService();
  const store: AnalyticsConsentStore = {
    read: () => null,
    write: () => {
      throw new Error('private storage detail');
    },
  };
  render(
    <ServicesProvider value={{ analytics, analyticsConsent: store }}>
      <AnalyticsConsentProvider>
        <MemoryRouter>
          <AnalyticsConsentPrompt />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );

  await userEvent.click(await screen.findByRole('button', {
    name: /share anonymous usage analytics/i,
  }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /could not save the analytics preference/i,
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    /private storage detail/i,
  );
});

it('does not update local saving state after unmount', async () => {
  let resolveGrant!: () => void;
  const grant = new Promise<void>((resolve) => {
    resolveGrant = resolve;
  });
  class DeferredAnalytics extends FakeAnalyticsService {
    override async setConsent(consent: AnalyticsConsent): Promise<void> {
      await super.setConsent(consent);
      if (consent === 'granted') await grant;
    }
  }
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(
    <ServicesProvider value={{
      analytics: new DeferredAnalytics(),
      analyticsConsent: new MemoryAnalyticsConsentStore(),
    }}>
      <AnalyticsConsentProvider>
        <MemoryRouter>
          <AnalyticsConsentPrompt />
        </MemoryRouter>
      </AnalyticsConsentProvider>
    </ServicesProvider>,
  );
  await userEvent.click(await screen.findByRole('button', {
    name: /share anonymous usage analytics/i,
  }));

  unmount();
  resolveGrant();
  await grant;

  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});
