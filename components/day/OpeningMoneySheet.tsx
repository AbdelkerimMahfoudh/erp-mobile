import React, { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Choice } from '../closing/DayChoiceSheet';
import { Button, InlineNotice, MoneyField, MoneyValue, Text } from '../ui';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import {
  attemptKey,
  keepUnavailableReason,
  openingDraft,
  openingRequest,
  openingTotal,
  prefilledCash,
  type OpeningChoice,
  type OpeningMethod,
  type OpeningMoneyInput,
} from '../../lib/opening-money';
import { uuidv4 } from '../../lib/utils';

/**
 * The money a shop opens with (docs/63), the last step before the opening is
 * recorded — after the before-06:00 day choice, if there was one.
 *
 * The previous amounts first: the shop's cash, then each company account as it
 * carries forward. The Owner then chooses — nothing is selected for them — to
 * keep them, or to set the cash in the drawer now: prefilled with the amount the
 * app knew, editable to 0 or any amount, with *Set to 0* for an emptied drawer,
 * and the total that results, before anything is sent. Anybody else who may open
 * sees the cash as it carries forward and opens with it; the day then awaits the
 * Owner's review.
 *
 * **When the drawer is unknown there is nothing to keep** (the brief of
 * 2026-10-06): the choice is not offered, the sheet says why, and the Owner
 * enters the cash — 0 when the drawer is empty — before the boutique opens. The
 * server refuses a keep it cannot honour (`opening_cash_unknown`), so an older
 * phone cannot open a boutique on an unknown drawer either.
 *
 * One request saves the opening and its money together. Refused or unanswered,
 * the sheet keeps what was entered and the store stays closed; the same request
 * again keeps its key, so a retry or a second tap is answered with the first.
 */
export interface OpeningMoneySheetProps {
  intent: 'open' | 'reopen' | 'review';
  open: boolean;
  onClose: () => void;
  /** The business day being opened, YYYY-MM-DD. */
  businessDate: string;
  /** Before 06:00, for somebody who may not start the next day early: which day runs, said here rather than in a dialog before it. */
  notice?: string | null;
  /** The Owner decides; anybody else opens with the amounts as tracked. */
  mayDecide: boolean;
  methods: readonly OpeningMethod[];
  branchCount: number;
  busy: boolean;
  /** Why the last attempt was refused, said in place — the values stay. */
  error: string | null;
  onConfirm: (money: OpeningMoneyInput | undefined) => void;
}

export function OpeningMoneySheet({ intent, open, onClose, businessDate, notice, mayDecide, methods, branchCount, busy, error, onConfirm }: OpeningMoneySheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  /** Nothing to keep: the only decision is the amount, so the field is shown at once — still empty, never a made-up 0. */
  const keepUnavailable = keepUnavailableReason(methods);
  const keepPossible = !mayDecide || keepUnavailable === null;
  const [choice, setChoice] = useState<OpeningChoice | null>(keepPossible ? null : 'set');
  const [cash, setCash] = useState('');
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const draft = openingDraft(choice, cash, keepPossible);
  const total = openingTotal(methods, draft);
  const date = formatDate(businessDate);
  const shown = mayDecide ? methods : methods.filter((m) => m.channel === 'cash');

  const choose = (next: OpeningChoice) => {
    // The drawer's known amount as a starting point — never a 0 the Owner did not choose.
    if (next === 'set' && choice !== 'set') setCash(prefilledCash(methods));
    setChoice(next);
  };

  const confirm = () => {
    const payload = JSON.stringify(openingRequest(draft, '', mayDecide) ?? null);
    attempt.current = attemptKey(attempt.current, payload, uuidv4);
    onConfirm(openingRequest(draft, attempt.current.key, mayDecide));
  };

  const title =
    intent === 'review' ? t('opening.review.title') : intent === 'reopen' ? t('opening.reopen.title', { date }) : t('opening.open.title', { date });
  const confirmLabel = !mayDecide ? t(intent === 'reopen' ? 'opening.confirm.carriedReopen' : 'opening.confirm.carried') : intent === 'review' ? t('opening.confirm.review') : t('opening.confirm');
  const amountError =
    choice === 'set' && !draft.ok && draft.reason === 'amount_invalid' ? t('closeDay.count.invalid') : undefined;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      titleLines={3}
      subtitle={mayDecide ? t('opening.subtitle.owner') : t('opening.subtitle.carried')}
      // Pinned, so the confirmation stays above the keyboard while the amounts scroll beneath it.
      footer={
        <View style={styles.footer}>
          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          <Button title={confirmLabel} wrap fullWidth loading={busy} disabled={busy || (mayDecide && !draft.ok)} onPress={confirm} />
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
        {/* What each method holds now, as the app tracks it. */}
        <View style={styles.list}>
          <Text variant="labelStrong" tone="secondary">
            {t('opening.previous')}
          </Text>
          {shown.map((m) => (
            <View key={m.key} style={AMOUNT_ROW}>
              <View style={AMOUNT_LABEL}>
                <Text variant="bodyStrong">{m.channel === 'cash' ? t('opening.cash') : m.label}</Text>
                <Text variant="caption" tone="tertiary">
                  {m.channel === 'cash' ? t('opening.cash.scope') : t(branchCount > 1 ? 'opening.account.shared' : 'opening.account.carried')}
                </Text>
              </View>
              {m.previous !== null ? (
                <MoneyValue value={m.previous} size="small" signed={m.previous < 0} />
              ) : (
                <Text variant="bodyStrong" tone="secondary">
                  {t('opening.unknown')}
                </Text>
              )}
            </View>
          ))}
        </View>

        {mayDecide && keepUnavailable === 'negative' ? (
          <InlineNotice tone="warning" title={t('opening.keep.negative.title')} testID="opening-keep-negative">
            {t('opening.keep.negative.body')}
          </InlineNotice>
        ) : mayDecide && !keepPossible ? (
          <InlineNotice tone="warning" title={t('opening.keep.unavailable.title')} testID="opening-keep-unavailable">
            {t('opening.keep.unavailable.body')}
          </InlineNotice>
        ) : mayDecide ? (
          <View style={styles.list} accessibilityRole="radiogroup">
            <Choice selected={choice === 'keep'} title={t('opening.keep.title')} body={t('opening.keep.body')} onPress={() => choose('keep')} />
            <Choice selected={choice === 'set'} title={t('opening.set.title')} body={t('opening.set.body')} onPress={() => choose('set')} />
          </View>
        ) : (
          <Text variant="body" tone="secondary">
            {t('opening.carried.body')}
          </Text>
        )}

        {mayDecide && choice === 'set' ? (
          <View style={styles.list}>
            <MoneyField
              label={t('opening.cash.now')}
              value={cash}
              onChangeText={setCash}
              error={amountError}
              editable={!busy}
              required
            />
            <View style={styles.row}>
              <Button title={t('opening.setZero')} variant="tertiary" size="sm" wrap disabled={busy} onPress={() => setCash('0')} />
            </View>
            <Text variant="caption" tone="tertiary">
              {t('opening.accounts.note')}
            </Text>
          </View>
        ) : null}

        {mayDecide ? (
          <View style={[AMOUNT_ROW, styles.total]}>
            <View style={AMOUNT_LABEL}>
              <Text variant="bodyStrong">{t('opening.total')}</Text>
            </View>
            {total !== null ? (
              <MoneyValue value={total} size="default" signed={total < 0} />
            ) : (
              <Text variant="bodyStrong" tone="secondary">
                {t('opening.total.unknown')}
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { gap: space.lg, paddingBottom: space.base },
  list: { gap: space.sm },
  row: { flexDirection: 'row' },
  total: { borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: space.md },
  footer: { gap: space.sm },
}));
