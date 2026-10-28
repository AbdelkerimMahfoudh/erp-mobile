import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorState, PageIntro, Screen, Section, SegmentedControl, SkeletonList, Text, TextField } from '../components/ui';
import { ApiError, api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { toast } from '../lib/toast';
import { POLICY_TEXT_MAX, type PolicyLanguage } from '../lib/return-policy-text';

/**
 * The branch's return policy (0108, the owner's brief of 2026-10-28).
 *
 * The window — no returns, or how long — and the shop's own written conditions,
 * in English, French and Arabic, each optional and never translated. A receipt
 * prints its own language's conditions, else the default language's, else only
 * the neutral sentence. An Owner, Store Manager or Store Employee of this branch
 * may change it (`return.policy.edit`); the server checks the branch and audits
 * the change. It applies to future sales only: every sale keeps the policy it
 * was sold under, and so does its receipt, however often it is reprinted.
 */

interface BranchPolicy {
  branchId: string;
  windowHours: number;
  textEn: string | null;
  textFr: string | null;
  textAr: string | null;
  defaultLanguage: PolicyLanguage;
  version: number | null;
  ownPolicy: boolean;
}

interface Draft {
  windowHours: number;
  textEn: string;
  textFr: string;
  textAr: string;
  defaultLanguage: PolicyLanguage;
}

const PRESETS = [0, 24, 48, 72] as const;
const draftOf = (p: BranchPolicy): Draft => ({
  windowHours: p.windowHours,
  textEn: p.textEn ?? '',
  textFr: p.textFr ?? '',
  textAr: p.textAr ?? '',
  defaultLanguage: p.defaultLanguage,
});

export default function ReturnPolicyScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  const canEdit = usePermission('return.policy.edit');
  const key = ['return-policy', branchId] as const;

  const policy = useQuery({ queryKey: key, queryFn: () => api.get<BranchPolicy>('/return-policy'), enabled: canEdit });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [customHours, setCustomHours] = useState('');
  const [custom, setCustom] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    if (!policy.data) return;
    const next = draftOf(policy.data);
    setDraft(next);
    const preset = (PRESETS as readonly number[]).includes(next.windowHours);
    setCustom(!preset);
    setCustomHours(preset ? '' : String(next.windowHours));
  }, [policy.data]);

  const saved = policy.data ? draftOf(policy.data) : null;
  const trimmed = (d: Draft) => ({ ...d, textEn: d.textEn.trim(), textFr: d.textFr.trim(), textAr: d.textAr.trim() });
  const dirty = Boolean(draft && saved && JSON.stringify(trimmed(draft)) !== JSON.stringify(trimmed(saved)));
  const tooLong = draft ? (['textEn', 'textFr', 'textAr'] as const).some((f) => draft[f].trim().length > POLICY_TEXT_MAX) : false;
  const hoursValid = !custom || (/^\d+$/.test(customHours) && Number(customHours) >= 1 && Number(customHours) <= 8760);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      api.put<BranchPolicy & { changed: boolean }>('/return-policy', {
        windowHours: d.windowHours,
        textEn: d.textEn,
        textFr: d.textFr,
        textAr: d.textAr,
        defaultLanguage: d.defaultLanguage,
        ...(policy.data?.version != null ? { expectedVersion: policy.data.version } : {}),
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(key, fresh);
      toast.success(t(fresh.changed ? 'returnPolicy.saved' : 'returnPolicy.unchanged'));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t('returnPolicy.conflict'));
        void policy.refetch();
        return;
      }
      if (e instanceof ApiError && e.status === 400) {
        const body = e.body as { code?: string; policyField?: string } | undefined;
        if (body?.code === 'policy_text_markup' || body?.code === 'policy_text_too_long') {
          setFieldError({
            field: body.policyField ?? '',
            message: t(body.code === 'policy_text_markup' ? 'returnPolicy.error.markup' : 'returnPolicy.error.tooLong', { max: POLICY_TEXT_MAX }),
          });
          return;
        }
      }
      toast.error(toFriendlyError(e).body);
    },
  });

  /** It changes what every future customer is promised: said, and confirmed, before it is saved. */
  const confirmSave = async () => {
    if (!draft || save.isPending) return;
    const ok = await dialog.confirm({
      title: t('returnPolicy.confirm.title'),
      message: t('returnPolicy.confirm.body'),
      confirmLabel: t('returnPolicy.confirm.yes'),
      cancelLabel: t('action.cancel'),
    });
    if (ok) {
      setFieldError(null);
      save.mutate(draft);
    }
  };

  const header = <Stack.Screen options={{ headerShown: true, title: t('nav.returnPolicy') }} />;

  if (!canEdit) {
    return (
      <Screen>
        {header}
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }
  if (policy.isLoading || !draft) {
    return (
      <Screen>
        {header}
        {policy.isError ? <ErrorState error={policy.error} onRetry={() => void policy.refetch()} /> : <SkeletonList count={4} />}
      </Screen>
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const segment = custom ? 'custom' : String(draft.windowHours);
  const textField = (field: 'textEn' | 'textFr' | 'textAr', lang: PolicyLanguage) => (
    <TextField
      key={field}
      containerStyle={styles.field}
      label={t(`returnPolicy.text.${lang}`)}
      hint={t('returnPolicy.count', { count: draft[field].trim().length, max: POLICY_TEXT_MAX })}
      error={fieldError?.field === field ? fieldError.message : draft[field].trim().length > POLICY_TEXT_MAX ? t('returnPolicy.error.tooLong', { max: POLICY_TEXT_MAX }) : undefined}
      value={draft[field]}
      onChangeText={(v) => {
        set(field, v);
        if (fieldError?.field === field) setFieldError(null);
      }}
      multiline
      numberOfLines={4}
      maxLength={POLICY_TEXT_MAX + 200}
      // Arabic is written right to left whatever the app's own language.
      textAlign={lang === 'ar' ? 'right' : 'left'}
      placeholder={t('returnPolicy.text.placeholder')}
    />
  );

  return (
    <Screen
      gap="xl"
      footer={
        dirty ? (
          <Button
            title={t('settings.save')}
            onPress={() => void confirmSave()}
            loading={save.isPending}
            disabled={save.isPending || tooLong || !hoursValid}
            fullWidth
          />
        ) : undefined
      }
    >
      {header}
      <PageIntro description={t('returnPolicy.intro')} />

      <Section title={t('settings.returns.label')}>
        <Card>
          <SegmentedControl
            value={segment}
            onChange={(v) => {
              if (v === 'custom') {
                setCustom(true);
                return;
              }
              setCustom(false);
              set('windowHours', Number(v));
            }}
            options={[
              { value: '0', label: t('settings.returns.none') },
              { value: '24', label: t('settings.returns.24h') },
              { value: '48', label: t('settings.returns.48h') },
              { value: '72', label: t('returnPolicy.72h') },
              { value: 'custom', label: t('settings.returns.custom') },
            ]}
          />
          {custom ? (
            <TextField
              containerStyle={styles.field}
              label={t('settings.returns.customLabel')}
              hint={t('settings.returns.customHint')}
              error={hoursValid ? undefined : t('settings.returns.invalid')}
              value={customHours}
              onChangeText={(text) => {
                const digits = text.replace(/[^0-9]/g, '');
                setCustomHours(digits);
                if (/^\d+$/.test(digits) && Number(digits) >= 1 && Number(digits) <= 8760) set('windowHours', Number(digits));
              }}
              keyboardType="number-pad"
              variant="identifier"
            />
          ) : null}
          <Text variant="caption" tone="secondary" style={styles.field}>
            {draft.windowHours > 0 ? t('settings.returns.windowExplained', { hours: draft.windowHours }) : t('settings.returns.noneExplained')}
          </Text>
        </Card>
      </Section>

      <Section title={t('returnPolicy.conditions.title')} subtitle={t('returnPolicy.conditions.hint')}>
        <Card>
          {textField('textEn', 'en')}
          {textField('textFr', 'fr')}
          {textField('textAr', 'ar')}
        </Card>
      </Section>

      <Section title={t('returnPolicy.default.title')} subtitle={t('returnPolicy.default.hint')}>
        <SegmentedControl
          value={draft.defaultLanguage}
          onChange={(v) => set('defaultLanguage', v as PolicyLanguage)}
          options={[
            { value: 'en', label: t('returnPolicy.lang.en') },
            { value: 'fr', label: t('returnPolicy.lang.fr') },
            { value: 'ar', label: t('returnPolicy.lang.ar') },
          ]}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: space.md },
});
