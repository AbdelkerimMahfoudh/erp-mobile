/// <reference types="jest" />
/**
 * The app explains before iOS asks (D225). Only the primary action opens iOS's prompt; the other path never needs the
 * permission; after a refusal the screen says how to turn it on in Settings instead of asking again.
 */
import React from 'react';
import { Linking } from 'react-native';
import { Camera } from 'lucide-react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { PermissionExplainer } from '../components/permissions/PermissionExplainer';

async function mount(denied: boolean) {
  const onAllow = jest.fn();
  const onType = jest.fn();
  await render(
    <ThemeProvider>
      <PermissionExplainer
        icon={Camera}
        title={t('scanner.permission.title')}
        benefits={[t('scanner.permission.benefit.scan'), t('scanner.permission.benefit.private')]}
        denied={denied}
        deniedSteps={t('scanner.permission.denied')}
        onAllow={onAllow}
        allowLabel={t('scanner.permission.grant')}
        alternative={{ label: t('action.typeInstead'), onPress: onType }}
      />
    </ThemeProvider>,
  );
  return { onAllow, onType };
}

it('says what the camera is for, and asks iOS only when the person chooses to', async () => {
  const { onAllow, onType } = await mount(false);
  expect(screen.getByText(t('scanner.permission.benefit.scan'))).toBeTruthy();
  expect(screen.getByText(t('scanner.permission.benefit.private'))).toBeTruthy();
  expect(onAllow).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText(t('scanner.permission.grant')));
  expect(onAllow).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText(t('action.typeInstead')));
  expect(onType).toHaveBeenCalledTimes(1);
});

it('after a refusal, explains Settings and opens them — it does not ask again', async () => {
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
  const { onAllow } = await mount(true);
  expect(screen.getByText(t('scanner.permission.denied'))).toBeTruthy();
  expect(screen.queryByText(t('scanner.permission.grant'))).toBeNull();
  await fireEvent.press(screen.getByText(t('permission.openSettings')));
  expect(open).toHaveBeenCalledTimes(1);
  expect(onAllow).not.toHaveBeenCalled();
  expect(screen.getByText(t('action.typeInstead'))).toBeTruthy();
});
