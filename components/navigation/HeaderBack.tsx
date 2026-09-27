import React from 'react';
import { Platform } from 'react-native';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import { IconButton } from '../ui/IconButton';
import { useTranslation } from '../../lib/i18n';
import { isRTL } from '../../lib/design/direction';
import { backTarget, NO_BACK } from '../../lib/navigation/back';

interface BackNavigation {
  canGoBack(): boolean;
  goBack(): void;
}

export interface HeaderBackProps {
  /** The route pattern, e.g. `/sales/[id]`. */
  route: string;
  params?: Readonly<Record<string, unknown>>;
  navigation: BackNavigation;
}

/**
 * The header's back arrow, for when the platform does not draw one.
 *
 * With history it goes back — the same step as the swipe and the system back.
 * Without it (a notification, a deep link, a cold start, a replaced route) it
 * replaces this screen with its logical parent (`lib/navigation/back.ts`), so
 * the arrow never does nothing, never closes the app and never reveals an
 * earlier session's screens. Left in English and French, right in Arabic; the
 * 48-point target and the colours are the app's own button.
 */
export function HeaderBack({ route, params, navigation }: HeaderBackProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const onPress = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace(backTarget(route, params) as Href);
  };
  return <IconButton icon={isRTL() ? ArrowRight : ArrowLeft} accessibilityLabel={t('action.back')} onPress={onPress} />;
}

/**
 * Leaving a screen by its own control — a flow's arrow after its steps, a Done
 * button: the same rule as the header arrow, back with history, the route's
 * logical parent without.
 */
export function useLeave(route: string, params?: Readonly<Record<string, unknown>>) {
  const navigation = useNavigation();
  const router = useRouter();
  return () => {
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace(backTarget(route, params) as Href);
  };
}

/**
 * What a stack header shows on its left.
 *
 * On a phone, with history, nothing of ours: the native back button stays,
 * and with it the platform's own swipe-back — never replaced. Without history
 * the native header has no arrow, so ours appears. The web header drops its own
 * back button whenever a left element is configured, so there ours is always shown.
 * A tab or an entry flow (`NO_BACK`) never gets one.
 */
export function headerBackFor(route: string, params: Readonly<Record<string, unknown>> | undefined, navigation: BackNavigation) {
  function HeaderLeft({ canGoBack }: { canGoBack?: boolean }) {
    return route in NO_BACK || (Platform.OS !== 'web' && canGoBack) ? null : <HeaderBack route={route} params={params} navigation={navigation} />;
  }
  return HeaderLeft;
}
