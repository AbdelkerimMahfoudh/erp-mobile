/// <reference types="jest" />
/**
 * A release built without its https API says so, and goes no further (docs/48 control 19; review MO1-04, MO2-05).
 *
 * A native release whose `EXPO_PUBLIC_API_ORIGIN` is missing, clear text or a development host used to fall back to
 * http://localhost:3010 and fail every screen with "no connection" — or send a password over clear text. The root
 * layout now shows one plain screen before sign-in, and nothing behind it is mounted. Jest runs with `__DEV__`, so
 * the refusal is the configuration's as a release would compute it (`lib/release-origin.test.ts` pins that rule).
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { t } from '../lib/i18n';

jest.mock('../global.css', () => ({}));
jest.mock('../constants/config', () => ({ ...jest.requireActual('../constants/config'), API_ORIGIN_REFUSAL: 'missing' }));
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  AuthProvider: () => {
    throw new Error('nothing behind the refusal is mounted');
  },
}));

import RootLayout from '../app/_layout';

it('a release without its https API shows why, before sign-in, and mounts nothing else', async () => {
  await render(<RootLayout />);
  expect(await screen.findByText(t('release.originRefused.title'))).toBeTruthy();
  expect(screen.getByText(t('release.originRefused.body'))).toBeTruthy();
});
