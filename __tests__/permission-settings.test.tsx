/**
 * After iOS refused, the explanation offers the one approved way out: the app's own page in Settings (D225). Before a
 * refusal it is never offered; nothing else opens.
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Camera } from 'lucide-react-native';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { PermissionExplainer } from '../components/permissions/PermissionExplainer';

const props = { icon: Camera, title: 'Scan', benefits: ['Faster'], onAllow: jest.fn(), allowLabel: 'Allow camera', alternative: { label: 'Type it instead', onPress: jest.fn() }, deniedSteps: 'Settings › Camera' };

it('refused: the steps, "Open Settings" (the app’s page, no address) and the way that needs no permission', async () => {
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  const openURL = jest.spyOn(Linking, 'openURL');
  await render(
    <ThemeProvider>
      <PermissionExplainer {...props} denied />
    </ThemeProvider>,
  );
  expect(screen.getByText('Settings › Camera')).toBeTruthy();
  expect(screen.getByText('Type it instead')).toBeTruthy();
  await fireEvent.press(screen.getByText(t('permissions.openSettings')));
  expect(open).toHaveBeenCalledTimes(1);
  expect(openURL).not.toHaveBeenCalled();
});

it('not refused yet: the app’s own prompt, never Settings', async () => {
  await render(
    <ThemeProvider>
      <PermissionExplainer {...props} denied={false} />
    </ThemeProvider>,
  );
  expect(screen.getByText('Allow camera')).toBeTruthy();
  expect(screen.queryByText(t('permissions.openSettings'))).toBeNull();
});
