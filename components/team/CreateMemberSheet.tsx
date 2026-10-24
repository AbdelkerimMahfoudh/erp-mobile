import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, SegmentedControl, Text, TextField, Toggle } from '../ui';
import { BottomSheet } from '../overlay';
import { ApiError, api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import type { StaffInvitationResult, UserBranch } from '../../types/api';
import { InvitationReference } from './InvitationReference';

/** E.164-ish, matched after stripping punctuation — mirrors the server. */
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanedPhone = (raw: string) => {
  const s = raw.trim().replace(/[\s\-().]/g, '');
  return s.startsWith('00') ? '+' + s.slice(2) : s;
};

type Role = 'store_employee' | 'store_manager';

/**
 * The Owner creates an employee account (docs/21, 2026-10-05; D214).
 *
 * The account is created PENDING, and nothing is sent to the person — no
 * WhatsApp message, no email. A WhatsApp number is required, an email address
 * optional. The server answers with an invitation reference, shown here once:
 * the Owner reads it out, copies it or shares it from their own phone, and the
 * person activates their own account with it — agreeing to WhatsApp messages
 * and confirming their number themselves. The sheet also says whether each
 * store's seat is included or still waits for the platform. It never shows a
 * code and never names a price.
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
  const { t } = useTranslation();
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
      if (error instanceof ApiError && error.code === 'whatsapp_required') {
        setErrors({ phone: t('team.create.error.phone') });
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
    if (!normalizedPhone) next.phone = t('team.create.error.phone');
    if (normalizedPhone && !E164.test(normalizedPhone)) next.phone = t('team.error.phone');
    if (trimmedEmail && !EMAIL.test(trimmedEmail)) next.email = t('team.error.email');
    if (stores.length === 0) next.stores = t('team.create.error.stores');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate({
      name: trimmedName,
      phone: normalizedPhone,
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      branchIds: stores,
      role,
    });
  };

  const toggleStore = (id: string, on: boolean) => setStores((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));

  return (
    /*
      Scrolls inside the sheet, as the other form sheets do: in French or Arabic, or with larger text, the form is taller
      than the sheet may grow, and "Add to the team" must still be reachable (owner's review, 2026-10-24).
    */
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
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
            hint={t('team.create.phoneHint')}
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
    </ScrollView>
  );
}

/** What the server did — said in its own terms, nothing inferred — and the invitation, shown this once. */
function Outcome({ result }: { result: StaffInvitationResult }) {
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <Text variant="body">{result.created ? t('team.create.done.body', { name: result.user.name }) : t('team.create.done.existing', { name: result.user.name })}</Text>
      {result.invitation ? <InvitationReference name={result.user.name} invitation={result.invitation} /> : null}
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
  // The sheet supplies the inset (`BottomSheet` padded): a second one here pushed the form in from the title.
  sheet: { gap: space.md },
  block: { gap: space.xs },
});
