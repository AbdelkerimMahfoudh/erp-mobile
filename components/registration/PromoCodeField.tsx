import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputKeyPressEvent } from 'react-native';
import { Button, InlineNotice, Text } from '../ui';
import { api, ApiError } from '../../lib/api-client';
import {
  backspaceAt,
  isInvitation,
  mustChoose,
  noAcquisition,
  PROMO_CODE_LENGTH,
  typedInto,
  withCode,
  withLink,
  withoutCode,
  withoutInvitation,
  type AcquisitionLookup,
  type AcquisitionState,
} from '../../lib/acquisition';
import { makeStyles } from '../../lib/design/theme';
import { radius, space, type as typeScale } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';

/**
 * The registration's optional source (0103, D221), held by the registration screen so it survives every step, the
 * language and the theme: the address the person arrived with — asked about once — and the six boxes, checked at six
 * digits. The app asks its own `auth/acquisition/*` routes, never the platform's.
 */
export function useAcquisition(arrived: string | null) {
  const [state, setState] = useState<AcquisitionState>(() => (arrived ? { ...noAcquisition, token: arrived } : noAcquisition));

  // The address arrived with: what it is, or a short notice and the ordinary registration.
  useEffect(() => {
    if (!arrived) return;
    let live = true;
    api
      .post<AcquisitionLookup>('/auth/acquisition/link', { token: arrived })
      .catch((): AcquisitionLookup => ({ usable: false }))
      .then((link) => live && setState((s) => withLink(s, link)));
    return () => {
      live = false;
    };
  }, [arrived]);

  // Six digits are checked at once — never the QR card's own, already answered (`withCode` marks them checking).
  const { code, prefilled } = state;
  useEffect(() => {
    if (code.length < PROMO_CODE_LENGTH || code === prefilled) return;
    let live = true;
    api
      .post<AcquisitionLookup>('/auth/acquisition/code', { code })
      .then((a): AcquisitionState['lookup'] => (a.usable && a.source === 'promoter' ? { kind: 'usable', name: a.promoterName } : { kind: 'unavailable' }))
      .catch((e: unknown): AcquisitionState['lookup'] =>
        e instanceof ApiError && e.status === 429 && e.message ? { kind: 'limited', message: e.message } : { kind: 'unavailable' },
      )
      .then((lookup) => live && setState((s) => (s.code === code ? { ...s, lookup } : s)));
    return () => {
      live = false;
    };
  }, [code, prefilled]);

  return {
    state,
    setCode: useCallback((next: string) => setState((s) => withCode(s, next)), []),
    removeCode: useCallback(() => setState(withoutCode), []),
    removeInvitation: useCallback(() => setState(withoutInvitation), []),
    /** The server refused the source at submission: what it said, without asking again. */
    refused: useCallback(() => setState((s) => ({ ...withoutInvitation(s), lookup: s.code ? { kind: 'unavailable' } : s.lookup, token: null })), []),
  };
}

type Acquisition = ReturnType<typeof useAcquisition>;

/** Six boxes, left to right in every language: typing moves on, Backspace moves back, a pasted code fills them. */
function CodeBoxes({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const refs = useRef<(TextInputInstance | null)[]>([]);
  const boxes = Array.from({ length: PROMO_CODE_LENGTH }, (_, i) => value[i] ?? '');

  const typed = (i: number) => (text: string) => {
    // The box held one digit; whatever is new in it — a digit, or a whole pasted code — goes in from here.
    const incoming = text.startsWith(boxes[i]) && boxes[i] ? text.slice(1) : text;
    const next = typedInto(value, i, incoming);
    if (next === value) return;
    onChange(next);
    refs.current[Math.min(next.length, PROMO_CODE_LENGTH - 1)]?.focus();
  };

  const key = (i: number) => (e: TextInputKeyPressEvent) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    const [next, focus] = backspaceAt(value, i);
    onChange(next);
    refs.current[focus]?.focus();
  };

  return (
    <View style={styles.boxes}>
      {boxes.map((d, i) => (
        <TextInput
          key={i}
          ref={(n) => {
            refs.current[i] = n;
          }}
          style={styles.box}
          value={d}
          onChangeText={typed(i)}
          onKeyPress={key(i)}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="off"
          textContentType="none"
          selectTextOnFocus
          editable={!disabled}
          accessibilityLabel={t('register.promo.digit', { n: i + 1 })}
          testID={`promo-digit-${i + 1}`}
        />
      ))}
    </View>
  );
}

export function PromoCodeField({ acquisition, disabled }: { acquisition: Acquisition; disabled?: boolean }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { state, setCode, removeCode, removeInvitation } = acquisition;
  const invited = isInvitation(state);
  const choosing = mustChoose(state);

  return (
    <View style={styles.block} testID="promo-code">
      <Text variant="label">{t('register.promo.label')}</Text>
      {state.link && !state.link.usable ? <InlineNotice tone="warning">{t('register.promo.addressInvalid')}</InlineNotice> : null}
      {invited ? (
        <>
          <InlineNotice tone="success">{t('register.promo.invited')}</InlineNotice>
          {!choosing ? <Button title={t('register.promo.invited.remove')} variant="tertiary" size="sm" onPress={removeInvitation} disabled={disabled} /> : null}
        </>
      ) : null}
      <Text variant="caption" tone="secondary">
        {t('register.promo.hint')}
      </Text>
      <CodeBoxes value={state.code} onChange={setCode} disabled={disabled} />
      <View accessibilityLiveRegion="polite" style={styles.block}>
        {state.lookup.kind === 'checking' ? (
          <Text variant="caption" tone="secondary">
            {t('register.promo.checking')}
          </Text>
        ) : null}
        {state.lookup.kind === 'usable' ? <InlineNotice tone="success">{t('register.promo.from', { name: state.lookup.name })}</InlineNotice> : null}
        {state.lookup.kind === 'unavailable' ? <InlineNotice tone="warning">{t('register.promo.unavailable')}</InlineNotice> : null}
        {state.lookup.kind === 'limited' ? <InlineNotice tone="warning">{state.lookup.message}</InlineNotice> : null}
      </View>
      {state.code ? <Button title={t('register.promo.remove')} variant="tertiary" size="sm" onPress={removeCode} disabled={disabled} /> : null}
      {choosing ? (
        <View style={styles.choice} accessibilityRole="radiogroup">
          <Text variant="bodyStrong">{t('register.promo.choose.title')}</Text>
          <Text variant="caption" tone="secondary">
            {t('register.promo.choose.body')}
          </Text>
          <Button title={t('register.promo.choose.invite')} variant="secondary" size="sm" onPress={removeCode} />
          <Button title={t('register.promo.choose.code')} variant="secondary" size="sm" onPress={removeInvitation} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  block: { gap: space.sm },
  // `direction: 'ltr'`: the digits are read left to right in every language, so an Arabic layout never reverses a code.
  boxes: { flexDirection: 'row', direction: 'ltr', gap: space.sm },
  box: {
    flex: 1,
    minWidth: 0,
    maxWidth: 52,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    color: colors.text.primary,
    textAlign: 'center',
    // The title size: above the 16px below which Safari on an iPhone zooms the page into the field.
    fontSize: typeScale.title.fontSize,
    fontVariant: ['tabular-nums'],
    writingDirection: 'ltr',
  },
  choice: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface.sunken,
  },
}));
