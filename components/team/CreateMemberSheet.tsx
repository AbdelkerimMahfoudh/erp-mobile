import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Chip, InlineNotice, SegmentedControl, Text, TextField, Toggle } from '../ui';
import { BottomSheet } from '../overlay';
import { ApiError, api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import type { StaffInvitationResult, UserBranch } from '../../types/api';

/** E.164-ish, matched after stripping punctuation — mirrors the server. */
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanedPhone = (raw: string) => {
  const s = raw.trim().replace(/[\s\-().]/g, '');
  return s.startsWith('00') ? '+' + s.slice(2) : s;
};

type Role = 'store_employee' | 'store_manager';

/**
 * The Owner creates an employee account (docs/21, 2026-10-05).
 *
 * The account is created PENDING. The server sends a code to each contact the
 * Owner gives — the email, the WhatsApp number, or both — and activates the
 * account only once the person has proven every one of them and a seat is held
 * at each store. What this sheet shows afterwards is the server's own report:
 * where codes went, where nothing could be sent, and whether a seat is
 * included or still waits for the platform. It never shows a code and never
 * names a price.
 */
export function CreateMemberSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('team.create.title')}>
      {/* Mounted only while open, so every opening starts from a clean form. */}
      {open ? <CreateMemberForm onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function CreateMemberForm({ onClose }: { onClose: () => void }) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId: currentBranchId } = useBranch();

  const branches = useQuery({
    queryKey: qk.branches,
    queryFn: () => api.get<UserBranch[]>('/auth/branches'),
  });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('store_employee');
  // The current store is the obvious first assignment.
  const [stores, setStores] = useState<string[]>(() => (currentBranchId ? [currentBranchId] : []));
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; stores?: string }>({});
  const [result, setResult] = useState<StaffInvitationResult | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<StaffInvitationResult>('/users', body),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: qk.users });
      setResult(r);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ phone: phone.trim() ? t('team.create.error.contactInUse') : undefined, email: email.trim() ? t('team.create.error.contactInUse') : undefined });
        return;
      }
      if (error instanceof ApiError && error.code === 'contact_required') {
        setErrors({ phone: t('team.create.error.contact') });
        return;
      }
      setErrors({ name: toFriendlyError(error).body });
    },
  });

  const submit = () => {
    const next: typeof errors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const normalizedPhone = phone.trim() === '' ? '' : cleanedPhone(phone);
    if (!trimmedName) next.name = t('team.create.error.name');
    if (!normalizedPhone && !trimmedEmail) next.phone = t('team.create.error.contact');
    if (normalizedPhone && !E164.test(normalizedPhone)) next.phone = t('team.error.phone');
    if (trimmedEmail && !EMAIL.test(trimmedEmail)) next.email = t('team.error.email');
    if (stores.length === 0) next.stores = t('team.create.error.stores');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate({
      name: trimmedName,
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      branchIds: stores,
      role,
      language,
    });
  };

  const toggleStore = (id: string, on: boolean) => setStores((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));

  return (
    <View style={styles.sheet}>
      {result ? (
        <>
          <Outcome result={result} />
          <Button title={t('action.done')} onPress={onClose} fullWidth />
        </>
      ) : (
        <>
          <Text variant="caption" tone="secondary">
            {t('team.create.intro')}
          </Text>
          <TextField label={t('team.field.name')} value={name} error={errors.name} onChangeText={setName} maxLength={160} autoFocus />
          <TextField
            label={t('team.field.phone')}
            hint={t('team.create.contactHint')}
            value={phone}
            error={errors.phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            variant="identifier"
            maxLength={24}
          />
          <TextField label={t('team.create.field.email')} value={email} error={errors.email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={160} />
          <View style={styles.block}>
            <Text variant="label">{t('team.create.role')}</Text>
            <SegmentedControl<Role>
              options={[
                { value: 'store_employee', label: t('team.role.store_employee') },
                { value: 'store_manager', label: t('team.role.store_manager') },
              ]}
              value={role}
              onChange={setRole}
            />
          </View>
          <View style={styles.block}>
            <Text variant="label">{t('team.create.stores')}</Text>
            <Text variant="caption" tone="secondary">
              {t('team.create.storesHint')}
            </Text>
            {(branches.data ?? []).map((b) => (
              <Toggle key={b.id} flat label={b.name} value={stores.includes(b.id)} onValueChange={(on) => toggleStore(b.id, on)} />
            ))}
            {errors.stores ? (
              <Text variant="caption" tone="warning">
                {errors.stores}
              </Text>
            ) : null}
          </View>
          <Button title={t('team.create.submit')} onPress={submit} loading={create.isPending} disabled={create.isPending} fullWidth />
        </>
      )}
    </View>
  );
}

/** What the server did — said in its own terms, nothing inferred. */
function Outcome({ result }: { result: StaffInvitationResult }) {
  const { t } = useTranslation();
  const channel = (label: string, state: 'sent' | 'unavailable' | null) =>
    state === null ? null : (
      <View style={styles.line} key={label}>
        <Text variant="body">{label}</Text>
        <Chip tone={state === 'sent' ? 'success' : 'warning'} label={state === 'sent' ? t('team.pending.delivery.sent') : t('team.pending.delivery.unavailableShort')} />
      </View>
    );
  const anyUnavailable = result.verification.email === 'unavailable' || result.verification.phone === 'unavailable';
  return (
    <View style={styles.block}>
      <Text variant="body">{result.created ? t('team.create.done.body', { name: result.user.name }) : t('team.create.done.existing', { name: result.user.name })}</Text>
      {channel(result.user.phone ?? '', result.verification.phone)}
      {channel(result.user.email ?? '', result.verification.email)}
      {anyUnavailable ? (
        <InlineNotice tone="warning" title={t('team.pending.delivery.unavailableTitle')}>
          <Text variant="caption" tone="secondary">
            {t('team.pending.delivery.unavailable')}
          </Text>
        </InlineNotice>
      ) : null}
      {result.seats.map((s) => (
        <Text key={s.storeId} variant="caption" tone="secondary">
          {s.state === 'awaiting_payment'
            ? t('team.pending.seat.awaiting', { branch: s.store })
            : s.state === 'held'
              ? t('team.pending.seat.held', { branch: s.store })
              : t('team.pending.seat.included', { branch: s.store })}
        </Text>
      ))}
      <Text variant="caption" tone="tertiary">
        {t('team.pending.explain')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space.md, padding: space.base },
  block: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
