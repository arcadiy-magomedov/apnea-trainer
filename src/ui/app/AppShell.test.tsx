import { expect, it, describe } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

it('renders a primary action outside the scroll area and above navigation', () => {
  render(
    <MemoryRouter>
      <AppShell bottomAction={<button>Start session</button>}>
        <div>scroll content</div>
      </AppShell>
    </MemoryRouter>,
  );

  const main = screen.getByRole('main');
  const action = screen.getByRole('region', { name: /primary action/i });
  const navigation = screen.getByRole('navigation');

  expect(main).toHaveTextContent('scroll content');
  expect(main).not.toContainElement(action);
  expect(
    action.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

describe('TabBar navigation', () => {
  it('shows Calendar tab linking to /calendar and no Program tab', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Calendar/i }))
      .toHaveAttribute('href', '/calendar');
    expect(screen.queryByRole('link', { name: /Program/i }))
      .not.toBeInTheDocument();
  });
});
