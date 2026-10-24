import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Store } from 'lucide-react-native';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useTranslation } from '../../lib/i18n';
import { isRTL } from '../../lib/design/direction';
import { makeStyles, useColors } from '../../lib/design/theme';
import { radius, space } from '../../lib/design/tokens';
import { LOGIN } from '../../lib/navigation/entry';

/**
 * The pages before signing in, as one product (owner's review, 2026-10-24).
 *
 * Every authentication route — sign-in, a new business, an Owner's setup code,
 * an employee's invitation, the code check — shares one compact header: the
 * Dukan ERP mark and name, the way back when there is one, and light/dark. It
 * is the stack's header (`app/(auth)/_layout.tsx`), so a screen keeps declaring
 * only its title, and no screen re-implements the bar.
 *
 * Not the public TSX-MR website's header: no navigation, no links, no company
 * menu. These pages have one job each.
 */

/** The widest an authentication page's column grows: a phone form, centred, never stretched across a desktop. */
export const AUTH_MAX_WIDTH = 480;

export interface AuthHeaderProps {
  /** The screen's title, under the bar. Sign-in has none: its brand block is the heading. */
  title?: string;
  /** Shown when the stack has somewhere to go back to. */
  canGoBack: boolean;
  onBack: () => void;
}

export function AuthHeader({ title, canGoBack, onBack }: AuthHeaderProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.column}>
        <View style={styles.bar}>
          {canGoBack ? (
            <IconButton icon={isRTL() ? ArrowRight : ArrowLeft} accessibilityLabel={t('action.back')} onPress={onBack} />
          ) : null}
          <View style={styles.identity} accessible accessibilityLabel={t('auth.title')}>
            <View style={styles.mark}>
              <Store color={colors.text.inverse} size={16} />
            </View>
            <Text variant="bodyStrong" numberOfLines={1}>
              {t('auth.title')}
            </Text>
          </View>
          <ThemeToggle />
        </View>
        {title ? (
          <Text variant="title" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The stack's header for an authentication route: `AuthHeader` given the screen's own title and back step. Without
 * history (a link opened cold) the arrow leads to sign-in rather than doing nothing.
 */
export function useAuthStackHeader() {
  const router = useRouter();
  return function renderAuthHeader({
    options,
    navigation,
  }: {
    options: { title?: string };
    navigation: { canGoBack(): boolean; goBack(): void };
  }) {
    const canGoBack = navigation.canGoBack();
    return (
      <AuthHeader
        title={options.title}
        canGoBack={canGoBack}
        onBack={() => (canGoBack ? navigation.goBack() : router.replace(LOGIN as never))}
      />
    );
  };
}

/**
 * Each authentication screen's frame: the page colour edge to edge, and a column that stops at
 * {@link AUTH_MAX_WIDTH} — the same width as the header's, so the two line up on a desktop.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.frame}>
      <View style={styles.frameColumn}>{children}</View>
    </View>
  );
}

export interface AuthPageProps {
  children: React.ReactNode;
  /** Below the main content and visibly apart from it: language, help and policies. */
  footer?: React.ReactNode;
  /** For a page that moves between steps and starts each at the top. */
  scrollRef?: React.Ref<ScrollView>;
}

/**
 * A scrolling authentication page: top-aligned on a phone, never vertically centred into a clipped top, with the
 * keyboard lifting the page on iOS. Content below the main task (`footer`) sits after a section's gap.
 */
export function AuthPage({ children, footer, scrollRef }: AuthPageProps) {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.fill} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <View style={styles.main}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  header: {
    backgroundColor: colors.surface.canvas,
    paddingHorizontal: space.base,
    paddingBottom: space.sm,
    alignItems: 'center',
  },
  column: {
    width: '100%',
    maxWidth: AUTH_MAX_WIDTH,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.intent.info.solid,
  },
  title: {
    marginTop: space.sm,
  },
  frame: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface.canvas,
  },
  frameColumn: {
    flex: 1,
    width: '100%',
    maxWidth: AUTH_MAX_WIDTH,
  },
  fill: {
    flex: 1,
    backgroundColor: colors.surface.canvas,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: space.base,
    paddingTop: space.base,
    paddingBottom: space['2xl'],
  },
  main: {
    gap: space.xl,
  },
  footer: {
    marginTop: space['2xl'],
    gap: space.xl,
  },
}));
