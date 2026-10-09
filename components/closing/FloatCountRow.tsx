import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, MoneyField, MoneyValue, Text, TextField } from '../ui';
import { asksExplanation, differenceKind, floatCountCheck, floatCountState, FLOAT_TEXT_MAX } from '../../lib/agent-money';
import { useRecordFloatCount, type FloatCount } from '../../lib/closing';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toAgentError } from '../../lib/errors';
import { formatMoney, formatTime } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { toast } from '../../lib/toast';

/**
 * One provider float at the closing of an agent branch (docs/73 §4.5), beside
 * the drawer: what the app expected — or *Unknown*, with nothing fabricated to
 * compare against — what the provider's app showed, and the difference in
 * words and figures. Whoever counts the drawer (`closing.count`) counts the
 * floats: the amount the provider's app shows now, with why it differs when it
 * does; or a skip with its reason — never both. A difference opens a question
 * for the closing; the day stays open and every count can be changed until it
 * is closed.
 */
export function FloatCountRow({
  float,
  date,
  viewDate,
  editable,
  onSaved,
}: {
  float: FloatCount;
  /** The business date counted — the route's. */
  date: string;
  /** The date the screen keys its view on; undefined for the current day. */
  viewDate?: string;
  /** Counting is offered: the person counts, the day is open, the phone holds no exchange for the branch, online. */
  editable: boolean;
  onSaved?: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const record = useRecordFloatCount(viewDate);
  const state = floatCountState(float);
  const [changing, setChanging] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [amount, setAmount] = useState('');
  const [explanation, setExplanation] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const editing = editable && (state === 'not_counted' || changing);
  const name = t('agent.positions.float', { provider: float.label });
  const kind = differenceKind(float.difference);
  const check = floatCountCheck({ providerId: float.providerId, skip: skipping, amount, explanation, skipReason });

  const reset = () => {
    setChanging(false);
    setSkipping(false);
    setAmount('');
    setExplanation('');
    setSkipReason('');
  };
  const save = () => {
    if (!check.ok) return;
    record.mutate(
      { date, body: check.body },
      {
        onSuccess: () => {
          reset();
          onSaved?.();
        },
        onError: (e) => toast.error(toAgentError(e).body || t('closing.count.failed')),
      },
    );
  };

  return (
    <View style={styles.row} testID={`float-count-${float.providerId}`}>
      <View style={styles.between}>
        <Text variant="bodyStrong" style={styles.grow}>
          {name}
        </Text>
        <Chip
          label={t(`closing.float.state.${state}` as TranslationKey)}
          tone={state === 'not_counted' ? 'warning' : state === 'skipped' ? 'neutral' : kind === 'none' ? 'success' : kind === null ? 'neutral' : 'warning'}
          size="sm"
          dot
        />
      </View>
      <View style={[AMOUNT_ROW, styles.line]}>
        <View style={AMOUNT_LABEL}>
          <Text variant="body" tone="secondary">
            {t('agent.count.expected')}
          </Text>
        </View>
        {float.expected !== null ? (
          <MoneyValue value={float.expected} size="small" signed={float.expected < 0} />
        ) : (
          <Text variant="bodyStrong" tone="secondary">
            {t('moneyTab.held.unknown')}
          </Text>
        )}
      </View>
      {float.expected === null ? (
        <Text variant="caption" tone="tertiary">
          {t('closing.float.unknown')}
        </Text>
      ) : null}
      {state === 'counted' && float.counted !== null ? (
        <>
          <View style={[AMOUNT_ROW, styles.line]}>
            <View style={AMOUNT_LABEL}>
              <Text variant="body" tone="secondary">
                {t('agent.count.counted')}
              </Text>
            </View>
            <MoneyValue value={float.counted} size="small" />
          </View>
          {float.difference !== null ? (
            <View style={[AMOUNT_ROW, styles.line]}>
              <View style={AMOUNT_LABEL}>
                <Text variant="body" tone="secondary">
                  {kind === 'none' ? t('closing.float.noDifference') : t(`agent.difference.${kind}` as TranslationKey)}
                </Text>
              </View>
              <MoneyValue value={float.difference} size="small" signed tone="auto" />
            </View>
          ) : null}
          {float.explanation ? (
            <Text variant="caption" tone="secondary">
              {t('agent.count.explanationShown', { explanation: float.explanation })}
            </Text>
          ) : null}
        </>
      ) : null}
      {state === 'skipped' ? (
        <Text variant="caption" tone="secondary">
          {t('closing.float.skippedBecause', { reason: float.skipReason ?? '' })}
        </Text>
      ) : null}
      {state !== 'not_counted' && float.countedByName && float.countedAt ? (
        <Text variant="caption" tone="tertiary">
          {t('closing.float.by', { name: float.countedByName, time: isolateLtr(formatTime(float.countedAt)) })}
        </Text>
      ) : null}

      {editing ? (
        skipping ? (
          <>
            <TextField
              accessibilityLabel={`${t('closing.float.skipReason')}, ${name}`}
              placeholder={t('closing.float.skipReason')}
              value={skipReason}
              onChangeText={setSkipReason}
              maxLength={FLOAT_TEXT_MAX}
              editable={!record.isPending}
            />
            <View style={styles.actions}>
              <Button title={t('action.cancel')} variant="tertiary" size="sm" disabled={record.isPending} onPress={() => setSkipping(false)} />
              <Button title={t('closing.float.skipSave')} variant="secondary" size="sm" loading={record.isPending} disabled={record.isPending || !check.ok} onPress={save} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.countLine}>
              <MoneyField
                accessibilityLabel={`${name}, ${t('closing.float.prompt', { provider: float.label })}`}
                placeholder={t('closing.float.prompt', { provider: float.label })}
                value={amount}
                onChangeText={setAmount}
                editable={!record.isPending}
                containerStyle={styles.grow}
              />
              <Button title={t('closing.row.save')} accessibilityLabel={`${t('closing.row.save')}, ${name}`} size="sm" loading={record.isPending} disabled={record.isPending || !check.ok} onPress={save} />
            </View>
            {asksExplanation(float.expected, amount) ? (
              <TextField
                accessibilityLabel={`${t('closing.float.explanation')}, ${name}`}
                placeholder={t('closing.float.explanation')}
                value={explanation}
                onChangeText={setExplanation}
                maxLength={FLOAT_TEXT_MAX}
                editable={!record.isPending}
              />
            ) : null}
            <View style={styles.actions}>
              {changing ? <Button title={t('action.cancel')} variant="tertiary" size="sm" disabled={record.isPending} onPress={reset} /> : null}
              <Button title={t('closing.float.skip')} variant="tertiary" size="sm" disabled={record.isPending} onPress={() => setSkipping(true)} />
            </View>
          </>
        )
      ) : editable && state !== 'not_counted' ? (
        <View style={styles.actions}>
          <Button title={t('closeDay.count.change')} accessibilityLabel={`${t('closeDay.count.change')}, ${name}`} variant="tertiary" size="sm" onPress={() => setChanging(true)} />
        </View>
      ) : null}
    </View>
  );
}

/** A float's state in a word, for the close's confirmation: counted (with its difference), skipped, or not counted. */
export function floatStateWords(float: FloatCount, t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  const state = floatCountState(float);
  if (state !== 'counted') return t(`closing.float.state.${state}` as TranslationKey);
  const kind = differenceKind(float.difference);
  if (kind === null || kind === 'none') return t('closing.float.state.counted');
  return t(`closing.float.counted.${kind}` as TranslationKey, { amount: isolateLtr(formatMoney(Math.abs(float.difference ?? 0))) });
}

const useStyles = makeStyles(() => ({
  row: { gap: space.xs },
  between: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  line: { minHeight: 28 },
  countLine: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.xs },
}));
