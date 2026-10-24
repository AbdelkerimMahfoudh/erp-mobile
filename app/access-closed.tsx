import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter, Stack } from 'expo-router';
import { TrialSetupCard } from '../components/access';
import { LegalPageButtons } from '../components/legal/LegalPages';
import { Button, ErrorState, Screen, SkeletonList, SkeletonText, Text } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { closedReason } from '../lib/access';
import { space } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { useTranslation } from '../lib/i18n';
import { useEntitlement, useTrialSetup } from '../lib/entitlement';
import { notStartedView } from '../lib/trial-setup';

/**
 * The business cannot use the app, and this screen says why (docs/21,
 * 2026-10-05).
 *
 * **Every word here is chosen by the SERVER's state**, never inferred from a
 * date on the device. A client that decides its own entitlement is a client
 * that can be made to decide wrongly, and a shopkeeper told the wrong reason
 * makes the wrong phone call.
 *
 * Six situations, deliberately distinct: no active access yet, not
 * started, refused, suspended, and ended (cancelled). Telling a brand-new
 * business that something ended would be both confusing and untrue — and
 * telling an Owner who redeemed a setup code that they are "waiting for
 * approval" would be untrue too (2026-10-24): their account is active the
 * moment the code is spent; what is missing is an entitlement, so `pending`
 * says exactly that. And an answer without a state this build knows is
 * `unknown` — the access could not be read — never `pending`.
 *
 * Not started (0095) is a business eligible for its one free trial. Its Owner
 * is shown what the server says about the trial's setup instructions
 * (`TrialSetupCard`, display only); anybody else — the server refuses them that
 * status — is shown the neutral words, never the Owner's instructions. The
 * trial itself is started on the website, never from here.
 *
 * What is deliberately absent: a price, a payment method, a way to buy or
 * renew, a website. Access is managed by the organisation; the app says so —
 * to everybody but the Owner reading the trial card, which names Dukan ERP
 * support — offers to check again — which is what somebody does after it is
 * approved, without reinstalling or signing out — and keeps the person's own
 * account: sign out, and delete the account. Those three are the screen's
 * only actions, whatever the state.
 */
export default function AccessClosed() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const query = useEntitlement();
  const entitlement = query.data;

  const [checking, setChecking] = useState(false);

  // One of six, from the server. If the state is something else entirely, the
  // app should not be on this screen at all.
  const reason = closedReason(entitlement?.state);
  // Asked only while not started: the Owner's card, or the server's refusal for everybody else.
  const setup = useTrialSetup(reason === 'not_started');
  // The Owner's card names whom to contact — Dukan ERP support — and a self-registered Owner IS the organisation:
  // the organisation's lines are for everybody else, and are not shown while it is still unknown who is asking.
  const notStarted = reason === 'not_started' ? notStartedView(setup) : null;
  const organisationLines = notStarted !== 'card' && notStarted !== 'loading';

  const onRecheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const next = (await query.refetch()).data;
      // Approved — or its trial started on the website — while they were looking at
      // this screen. Straight in — no reinstall, no clearing storage, no signing out
      // and back in.
      if (next?.canRead) router.replace('/');
      // Still not started: what the server now says about the instructions, too.
      else if (closedReason(next?.state) === 'not_started') await setup.refetch();
    } finally {
      setChecking(false);
    }
  };

  // Open to this business after all — a link opened later, or approval while
  // away: the app (read-only if that is what the server says), never a refusal
  // that is not true.
  if (entitlement?.canRead) return <Redirect href="/" />;

  // Opened before the server's word arrived — straight after a business account
  // is created: wait for it, rather than guess a reason that may not be true.
  if (!entitlement && query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <SkeletonList count={2} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.wrap}>
        {!entitlement ? (
          // Not read at all: say that, and leave Check again to ask once more.
          <ErrorState error={query.error} size="inline" />
        ) : reason === 'not_started' ? (
          <NotStarted setup={setup} />
        ) : (
          <>
            <Text variant="title" align="center">
              {t(`access.closed.${reason}.title`)}
            </Text>
            <Text tone="secondary" align="center" style={styles.body}>
              {t(`access.closed.${reason}.body`)}
            </Text>
          </>
        )}
        {organisationLines ? (
          <>
            <Text variant="caption" tone="tertiary" align="center">
              {t('access.managed')}
            </Text>
            <Text variant="caption" tone="tertiary" align="center">
              {t('access.mistake')}
            </Text>
          </>
        ) : null}

        <View style={styles.actions}>
          <Button title={t('access.recheck')} onPress={() => void onRecheck()} loading={checking} />
          {/* Another person's shop may be the one this phone should be signed in to. */}
          <Button title={t('action.signOut')} variant="tertiary" onPress={() => void signOut()} />
          {/*
            The way out is here too (docs/64, App Review 5.1.1(v)): a person
            whose business was refused, suspended or never approved can still
            delete their account, and the guard lets them reach that screen.
          */}
          <Button title={t('account.delete.link')} variant="tertiary" onPress={() => router.push('/account/delete' as never)} />
        </View>
        {/* Pages to read, never a way to the business's access: outside the trial card, which stays display-only. */}
        <LegalPageButtons />
      </View>
    </Screen>
  );
}

/**
 * A business that has not started: the Owner's card when the server answers
 * the Owner, the neutral words for anybody it refuses, and — while it is asked,
 * or when it could not be — the one sentence that is true for everybody.
 */
function NotStarted({ setup }: { setup: ReturnType<typeof useTrialSetup> }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (setup.data?.eligible) return <TrialSetupCard status={setup.data} />;

  const view = notStartedView(setup);
  return (
    <>
      <Text variant="title" align="center">
        {t('access.closed.not_started.title')}
      </Text>
      {view === 'neutral' ? (
        <Text tone="secondary" align="center" style={styles.body}>
          {t('access.closed.not_started.body')}
        </Text>
      ) : view === 'unreadable' ? (
        <ErrorState error={setup.error} size="inline" />
      ) : (
        <SkeletonText lines={2} />
      )}
    </>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { flex: 1, justifyContent: 'center', gap: space.md, paddingHorizontal: space.md },
  body: { marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.lg },
}));
