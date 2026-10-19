import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react-native';
import { Button, Card, Chip, ErrorState, InlineNotice, Screen, Section, SkeletonList, Text, Toggle } from '../../components/ui';
import { WhatsAppConsentCheck } from '../../components/consent/WhatsAppConsentCheck';
import { api, ApiError } from '../../lib/api-client';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import { focusForScreenReader } from '../../lib/accessibility-focus';
import {
  consentEventKey,
  consentProblemKey,
  consentRequested,
  consentSourceKey,
  consentStateKey,
  consentStateTone,
  withdrawalNeedsAcknowledgement,
} from '../../lib/whatsapp-consent';
import type { WhatsAppConsentView } from '../../types/api';

/**
 * Communication preferences: the operational WhatsApp consent (the owner's brief of 2026-10-19; D213).
 *
 * What the person agreed to (the server's copy, its version and when), the way to agree — a new event, never an edit
 * — and the way to withdraw, explained before it happens: automatic reminders and notices stop, codes to the number
 * stop with them, nothing moves to email, and the account, the number and the business data stay. When WhatsApp is
 * the only verified contact, recovering the account then goes through support, and the person says they understood
 * before the server takes the withdrawal. Reading the business is never blocked by any of this.
 */
export default function CommunicationScreen() {
  const { t, language } = useTranslation();
  const header = <Stack.Screen options={{ headerShown: true, title: t('consent.title') }} />;
  const query = useQuery({
    queryKey: [...qk.whatsappConsent, language],
    queryFn: () => api.get<WhatsAppConsentView>(`/account/whatsapp/consent?language=${language}`),
  });

  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  return (
    <Screen gap="xl">
      {header}
      <ConsentSection view={query.data} />
    </Screen>
  );
}

function ConsentSection({ view }: { view: WhatsAppConsentView }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const boxRef = useRef<View>(null);

  const settle = async (next: WhatsAppConsentView) => {
    queryClient.setQueryData([...qk.whatsappConsent, language], next);
    await queryClient.invalidateQueries({ queryKey: qk.whatsappConsent });
  };

  const explain = (e: unknown): string => {
    const key = e instanceof ApiError ? consentProblemKey(e.code) : null;
    return key ? t(key) : toFriendlyError(e).body;
  };

  const agree = async () => {
    if (busy) return;
    if (!ticked) {
      setProblem(t('consent.problem.required'));
      focusForScreenReader(boxRef.current);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const next = await api.post<WhatsAppConsentView>(`/account/whatsapp/consent?language=${language}`, {
        version: view.copy.version,
        locale: view.copy.language,
      });
      setTicked(false);
      toast.success(t('consent.agreed'));
      await settle(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'whatsapp_consent_outdated') {
        setTicked(false);
        await queryClient.invalidateQueries({ queryKey: qk.whatsappConsent });
      }
      setProblem(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (busy) return;
    const needsAck = withdrawalNeedsAcknowledgement(view);
    if (needsAck && !acknowledged) {
      setProblem(t('consent.withdraw.needsAck'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const next = await api.post<WhatsAppConsentView>(
        `/account/whatsapp/consent/withdraw?language=${language}`,
        needsAck ? { acknowledgeSupportRecovery: true } : {},
      );
      setWithdrawing(false);
      setAcknowledged(false);
      toast.success(t('consent.withdrawn'));
      await settle(next);
    } catch (e) {
      setProblem(explain(e));
    } finally {
      setBusy(false);
    }
  };

  if (view.state === 'no_number') {
    return <InlineNotice tone="warning">{t('consent.noNumber')}</InlineNotice>;
  }

  const granted = view.state === 'active';

  return (
    <>
      <Section title={view.copy.title}>
        <Card style={styles.card}>
          <View style={styles.head}>
            <MessageCircle size={22} />
            <View style={styles.headText}>
              <Text variant="bodyStrong">{view.number ? isolateLtr(view.number) : ''}</Text>
              <Chip tone={consentStateTone(view.state)} label={t(consentStateKey(view.state))} size="sm" dot />
            </View>
          </View>
          {granted && view.grantedAt ? (
            <Text variant="caption" tone="secondary">
              {t('consent.grantedAt', { date: formatDateTime(view.grantedAt), version: isolateLtr(view.grantedVersion ?? '') })}
            </Text>
          ) : null}
          {view.state === 'withdrawn' && view.withdrawnAt ? (
            <Text variant="caption" tone="secondary">
              {t('consent.withdrawnAt', { date: formatDateTime(view.withdrawnAt) })}
            </Text>
          ) : null}
        </Card>

        {consentRequested(view) ? (
          <InlineNotice tone="warning">{t(view.state === 'outdated' ? 'consent.request.outdated' : 'consent.request.body')}</InlineNotice>
        ) : null}
        {view.state === 'withdrawn' ? <InlineNotice tone="info">{t('consent.withdrawn.body')}</InlineNotice> : null}

        {granted ? (
          <Text variant="body" tone="secondary">
            {view.copy.agreement}
          </Text>
        ) : (
          <View style={styles.stack}>
            <WhatsAppConsentCheck
              ref={boxRef}
              copy={view.copy}
              loading={false}
              failed={false}
              onRetry={() => undefined}
              checked={ticked}
              onChange={(next) => {
                setTicked(next);
                setProblem(null);
              }}
              error={problem ?? undefined}
              disabled={busy}
            />
            <Button title={t('consent.agree')} onPress={() => void agree()} loading={busy} />
          </View>
        )}

        <Text variant="caption" tone="tertiary">
          {t('consent.notMarketing')}
        </Text>
      </Section>

      {granted ? (
        <Section title={t('consent.withdraw.title')}>
          {withdrawing ? (
            <View style={styles.stack}>
              <Text variant="body">{t('consent.withdraw.explain')}</Text>
              {withdrawalNeedsAcknowledgement(view) ? (
                <>
                  <InlineNotice tone="warning">{t('consent.withdraw.onlyContact')}</InlineNotice>
                  <Toggle
                    label={t('consent.withdraw.acknowledge')}
                    value={acknowledged}
                    onValueChange={(next) => {
                      setAcknowledged(next);
                      setProblem(null);
                    }}
                    onLabel={t('consent.withdraw.acknowledged')}
                    offLabel={t('consent.withdraw.notAcknowledged')}
                  />
                </>
              ) : null}
              {problem ? (
                <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
                  {problem}
                </Text>
              ) : null}
              <Button title={t('consent.withdraw.confirm')} variant="danger" onPress={() => void withdraw()} loading={busy} />
              <Button
                title={t('action.cancel')}
                variant="tertiary"
                onPress={() => {
                  setWithdrawing(false);
                  setAcknowledged(false);
                  setProblem(null);
                }}
              />
            </View>
          ) : (
            <Button title={t('consent.withdraw')} variant="secondary" onPress={() => setWithdrawing(true)} />
          )}
        </Section>
      ) : null}

      {view.history.length > 0 ? (
        <Section title={t('consent.history')}>
          <Card style={styles.card}>
            {view.history.map((h, i) => (
              <Text key={`${h.at}-${i}`} variant="caption" tone="secondary">
                {t('consent.historyLine', {
                  event: t(consentEventKey(h.event)),
                  date: formatDateTime(h.at),
                  source: t(consentSourceKey(h.source)),
                })}
              </Text>
            ))}
          </Card>
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, gap: space.xs },
  stack: { gap: space.md },
});
