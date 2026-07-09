import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('design tokens', () => {
  it('defines the deep-ocean palette variables', () => {
    const css = readFileSync('src/ui/design-system/tokens.css', 'utf-8');
    for (const token of [
      '--ocean-900', '--surface', '--cyan', '--teal',
      '--success', '--warn', '--danger', '--text',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('wires the Tailwind color config so custom color utilities are generated', () => {
    // Tailwind v4 does not auto-load tailwind.config.ts; index.css must @config it,
    // otherwise utilities like bg-cyan/bg-surface/bg-danger are never emitted and
    // button backgrounds silently disappear.
    const indexCss = readFileSync('src/index.css', 'utf-8');
    expect(indexCss).toMatch(/@config\s+['"].*tailwind\.config\.ts['"]/);
  });
});
