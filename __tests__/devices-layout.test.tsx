/// <reference types="jest" />
/**
 * A device row with the longest status and a long name, in EN, FR and AR, at 320 points and large text (docs/114).
 *
 * The renderer computes no layout, so this asserts the structure that decides it: the name has no line limit, and the
 * status shares no line with it. NOT DEVICE VERIFIED: it does not prove how a phone draws the row.
 */
declare const require: (id: string) => any;
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { useI18n, translateIn, type Language } from '../lib/i18n';
import type { UserDeviceView } from '../types/api';

const mockDimensions = { width: 320, height: 568, scale: 2, fontScale: 2 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions }));

import { DeviceRow } from '../components/devices/DeviceRow';

const LONG_NAME = 'iPhone de la boutique principale de Tevragh Zeina, comptoir numéro deux';
const device = (over: Partial<UserDeviceView> = {}): UserDeviceView => ({
  id: 'd1',
  label: LONG_NAME,
  platform: 'ios',
  model: 'iPhone SE',
  appVersion: '1.0.0',
  trustMethod: 'password',
  otpVerified: false,
  reverifyRequired: true,
  firstSeenAt: '2026-10-01T10:00:00.000Z',
  lastSeenAt: '2026-11-01T10:00:00.000Z',
  revokedAt: null,
  isCurrent: false,
  ...over,
});

const { readFileSync } = require('fs');
const { join } = require('path');

const show = async (d: UserDeviceView, onRevoke?: () => void) =>
  await render(
    <ThemeProvider>
      <DeviceRow device={d} onRevoke={onRevoke} />
    </ThemeProvider>,
  );

describe.each<Language>(['en', 'fr', 'ar'])('a device row in %s, 320 points, large text', (lang) => {
  beforeEach(async () => {
    await act(async () => {
      await useI18n.getState().setLanguage(lang);
    });
  });

  it('never limits the name to truncation, or caps its growth with large text', async () => {
    await show(device());
    const name = screen.getByTestId('device-name');
    expect(name.props.children).toBe(LONG_NAME);
    expect(name.props.numberOfLines).toBeUndefined();
    expect(name.props.ellipsizeMode).toBeUndefined();
    expect(name.props.maxFontSizeMultiplier).toBeUndefined();
    expect(name.props.allowFontScaling).not.toBe(false);
  });

  it('gives the name an area that cannot shrink to nothing: it shares no line with the status', async () => {
    await show(device());
    const area = StyleSheet.flatten(screen.getByTestId('device-text').props.style);
    expect(area.flexDirection).toBe('column');
    expect(area.flex).toBe(1);
    expect(area.width).toBeUndefined();
    expect(StyleSheet.flatten(screen.getByTestId('device-name').props.style)?.flexShrink).toBeUndefined();
  });

  it('uses the short status label, shorter than the sentence it replaces, with the explanation below', async () => {
    await show(device());
    const short = translateIn(lang, 'devices.status.codeRequired');
    const long = translateIn(lang, 'devices.status.reverify');
    expect(screen.getByText(short)).toBeTruthy();
    expect(screen.queryByText(long)).toBeNull();
    expect(short.length).toBeLessThan(long.length);
    expect(screen.getByTestId('device-status-detail').props.children).toBe(translateIn(lang, 'devices.status.codeRequiredDetail'));
  });

  it('tells a screen reader the name, status and explanation, and still opens removal', async () => {
    const onRevoke = jest.fn();
    await show(device(), onRevoke);
    const row = screen.getByRole('button');
    for (const part of [LONG_NAME, translateIn(lang, 'devices.status.codeRequired'), translateIn(lang, 'devices.status.codeRequiredDetail')]) {
      expect(row.props.accessibilityLabel).toContain(part);
    }
    await fireEvent.press(row);
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('keeps each status’s meaning: active and removed have no explanation, and removal wins', async () => {
    await show(device({ reverifyRequired: false }));
    expect(screen.getByText(translateIn(lang, 'devices.status.active'))).toBeTruthy();
    expect(screen.queryByTestId('device-status-detail')).toBeNull();
    await show(device({ reverifyRequired: true, revokedAt: '2026-11-02T10:00:00.000Z' }));
    expect(screen.getByText(translateIn(lang, 'devices.status.revoked'))).toBeTruthy();
    expect(screen.queryByTestId('device-status-detail')).toBeNull();
  });

  it('names a device with no label by how it was trusted', async () => {
    await show(device({ label: null }));
    expect(screen.getByTestId('device-name').props.children).toBe(translateIn(lang, 'devices.trust.password'));
  });
});

describe('right to left', () => {
  const source = readFileSync(join(process.cwd(), 'components/devices/DeviceRow.tsx'), 'utf8');

  it('the row has no physical left or right style, so it follows the language’s direction', async () => {
    expect(source).not.toMatch(/\b(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|textAlign)\s*:/);
    expect(source).not.toMatch(/row-reverse/);
  });

  it('the Arabic labels are Arabic', async () => {
    expect(translateIn('ar', 'devices.status.codeRequired')).toMatch(/[؀-ۿ]/);
    expect(translateIn('ar', 'devices.status.codeRequiredDetail')).toMatch(/[؀-ۿ]/);
  });
});

describe('the screen', () => {
  it('uses this row and keeps its diagnostics', async () => {
    const source = readFileSync(join(process.cwd(), 'app/devices.tsx'), 'utf8');
    expect(source).toMatch(/from '\.\.\/components\/devices\/DeviceRow'/);
    expect(source).not.toMatch(/ListRow/);
    expect(source).toMatch(/<IntakeTrail \/>/);
  });
});
