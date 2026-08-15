import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Button, Card, Screen, Section, Text, TextField } from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { supplierConflictKind, useCreateSupplier } from '../../lib/suppliers';

/**
 * Add a supplier.
 *
 * Deliberately small: a name, a phone and a note. Everything financial about a
 * supplier comes from purchases and payments, never from a form — there is no
 * opening-balance field, because a debt nobody can point at a purchase for is a
 * number that will never reconcile.
 */
export default function NewSupplierScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const create = useCreateSupplier();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [duplicate, setDuplicate] = useState(false);

  const canSubmit = name.trim().length > 0 && !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    setDuplicate(false);
    try {
      const supplier = await create.mutateAsync({
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(t('suppliers.created'));
      router.replace(`/suppliers/${supplier.id}` as never);
    } catch (e) {
      if (supplierConflictKind(e) === 'duplicate') {
        // Said in place rather than as a toast: the fix is to search, and the
        // search is on the previous screen.
        setDuplicate(true);
        return;
      }
      toast.error(toFriendlyError(e).body);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('suppliers.add') }} />

      <Section title={t('suppliers.form.section')}>
        <Card>
          <TextField
            label={t('suppliers.form.name')}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setDuplicate(false);
            }}
            autoCapitalize="words"
            placeholder={t('suppliers.form.namePlaceholder')}
          />
          {duplicate ? (
            <Text variant="caption" tone="warning" style={styles.gap}>
              {t('suppliers.duplicate')}
            </Text>
          ) : null}
          <TextField
            label={t('suppliers.form.phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder={t('suppliers.form.phonePlaceholder')}
          />
          <TextField
            label={t('suppliers.form.notes')}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('field.optional')}
          />
        </Card>
      </Section>

      <Section>
        <Card>
          <Button
            title={t('suppliers.form.save')}
            onPress={() => void submit()}
            loading={create.isPending}
            disabled={!canSubmit}
            fullWidth
          />
          <Button
            title={t('action.cancel')}
            variant="tertiary"
            onPress={() => router.back()}
            style={styles.gap}
          />
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: space.sm },
});
