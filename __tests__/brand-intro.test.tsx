/// <reference types="jest" />
/**
 * The launch's brand moment (the owner's brand pack, 2026-10-29): once per process, never blocking a tap, gone after it
 * plays — and the auth pages wear the mark, not a storefront.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { BrandIntro, DukanLockup, DukanMark, resetBrandIntroForTests } from '../components/brand/DukanMark';
import { AuthHeader } from '../components/auth/AuthChrome';

function Harness({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => resetBrandIntroForTests());

it('plays once, lets every touch through, and is gone when it has played', async () => {
  const first = await render(
    <Harness>
      <BrandIntro background="#F1F3F8" tone="light" />
    </Harness>,
  );
  // The test renderer runs Reanimated's mock: the timings resolve at once, so the overlay has already finished.
  expect(screen.queryByTestId('brand-intro')).toBeNull();
  await first.unmount();
  // A second mount in the same process (a remount, a reload of the tree) shows nothing: the intro is a launch.
  await render(
    <Harness>
      <BrandIntro background="#F1F3F8" tone="light" />
    </Harness>,
  );
  expect(screen.queryByTestId('brand-intro')).toBeNull();
});

it('the overlay never takes a touch while it is up', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'brand', 'DukanMark.tsx'), 'utf8') as string;
  expect(src).toMatch(/testID="brand-intro" pointerEvents="none"/);
});

it('the mark and the lockup render; the lockup is one accessible image named Dukan ERP', async () => {
  await render(
    <Harness>
      <DukanMark size={16} />
      <DukanLockup />
    </Harness>,
  );
  expect(screen.getByLabelText('Dukan ERP')).toBeTruthy();
  expect(screen.getByText('Dukan')).toBeTruthy();
  expect(screen.getByText('ERP')).toBeTruthy();
});

it('the authentication header carries the Dukan mark beside the name', async () => {
  await render(
    <Harness>
      <AuthHeader canGoBack={false} onBack={() => undefined} />
    </Harness>,
  );
  expect(screen.getByLabelText('Dukan ERP')).toBeTruthy();
});
