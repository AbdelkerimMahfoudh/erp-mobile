import React, { useState } from 'react';
import { DayChoiceSheet } from '../closing/DayChoiceSheet';
import { OpeningMoneySheet } from './OpeningMoneySheet';
import { useOpenDay, useReopenDay, type OpenClosing } from '../../lib/closing';
import { isolateLtr } from '../../lib/design/direction';
import { ApiError } from '../../lib/api-client';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { openingPrompt, type ReopenMode } from '../../lib/home-day';
import { useTranslation } from '../../lib/i18n';
import type { OpeningMoneyInput } from '../../lib/opening-money';
import { toast } from '../../lib/toast';

/**
 * Opening the boutique, or opening it again, with the money it opens with
 * (docs/63) — one flow for every place that opens: Home's *Open store now*, the
 * Daily closing's *Open the boutique* and *Reopen*, and the covers of Sell,
 * Receive and a refused later payment.
 *
 * Before 06:00 the day comes first — the Owner's choice sheet, or, for a staff
 * member, a notice naming the day that runs, shown in the amounts sheet
 * (docs/56). Then the amounts: the Owner keeps them or sets the cash; anybody
 * else opens with them as tracked. One request records the opening and its
 * money. Only on the server's answer do Sell and Receive open, so the button
 * cannot be pressed twice in between.
 *
 * **One modal at a time.** The amounts sheet is shown only once the day
 * sheet's modal is gone (`onDismissed`): iOS does not present a modal while
 * another is still being dismissed, and the amounts never appeared (the
 * user's phone, 01:09 on 29 Sep).
 *
 * **A failure keeps everything.** Refused or unanswered, the sheet stays with
 * what was entered and says why; closed and opened again after a failure, the
 * chosen day, the amounts and the request's key are still there, so the same
 * request is answered once. Only a success, or a fresh start after none
 * failed, begins again from nothing.
 *
 * An older server offers no amounts step (`openingMoney` absent) and is never
 * sent one it would refuse: its opening goes as it always did.
 */
export function useOpeningFlow({
  intent,
  day,
  date,
  onOpened,
}: {
  intent: 'open' | 'reopen';
  /** The day's full view, loaded by the caller; nothing while it loads. */
  day: OpenClosing | null | undefined;
  /** The business day the caller shows, when not the current one. */
  date?: string;
  onOpened?: () => void;
}) {
  const { t } = useTranslation();
  const openDay = useOpenDay(date);
  const reopen = useReopenDay(date);
  /** `toMoney`: the day is chosen and its sheet is on its way out; the amounts follow once it is gone. */
  const [stage, setStage] = useState<'idle' | 'day' | 'toMoney' | 'money'>('idle');
  /** The day chosen before 06:00, or null when no choice was offered — then no mode is sent. */
  const [mode, setMode] = useState<ReopenMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last attempt was refused or unanswered: what was chosen and typed is kept for the next. */
  const [failed, setFailed] = useState(false);
  /** Remounts both sheets on a fresh start, so nothing chosen last time is still selected. */
  const [nonce, setNonce] = useState(0);
  const busy = openDay.isPending || reopen.isPending;
  const choices = day ? (intent === 'open' ? (day.openChoices ?? ['continue']) : day.reopenChoices) : [];

  const send = async (chosen: ReopenMode | null, openingMoney: OpeningMoneyInput | undefined) => {
    if (!day) return;
    setError(null);
    try {
      const fresh =
        intent === 'open'
          ? await openDay.mutateAsync({ ...(chosen ? { mode: chosen } : {}), ...(openingMoney ? { openingMoney } : {}) })
          : await reopen.mutateAsync({ mode: chosen ?? 'continue', ...(openingMoney ? { openingMoney } : {}) });
      setStage('idle');
      setFailed(false);
      if (chosen === 'start_new') {
        toast.success(
          intent === 'open'
            ? t('openChoice.started', { date: formatDate(fresh.businessDate), time: isolateLtr(fresh.opening?.localTime ?? fresh.localNow) })
            : t('reopen.started', { date: formatDate(day.nextDate) }),
        );
      } else {
        toast.success(
          intent === 'open'
            ? t('closingHistory.open.done', { time: isolateLtr(fresh.opening?.localTime ?? fresh.localNow) })
            : t('reopen.done', { date: formatDate(day.businessDate) }),
        );
      }
      onOpened?.();
    } catch (e) {
      // Nothing was opened: the sheet keeps what was entered and says why; without a sheet, a toast does. A keep the
      // server cannot honour — the drawer unknown (2026-10-06) — is said in the sheet's own words.
      const message = e instanceof ApiError && e.code === 'opening_cash_unknown' ? t('opening.keep.unavailable.body') : toFriendlyError(e).body || t(intent === 'open' ? 'closingHistory.open.failed' : 'reopen.failed');
      setError(message);
      setFailed(true);
      if (!day.openingMoney) toast.error(message);
    }
  };

  /**
   * After the day is settled: the amounts — once the day sheet is gone, when there was one — or, on an older server,
   * the opening as it always went.
   */
  const amounts = async (chosen: ReopenMode | null, afterDaySheet: boolean) => {
    setMode(chosen);
    if (day?.openingMoney) {
      setStage(afterDaySheet ? 'toMoney' : 'money');
      return;
    }
    setStage('idle');
    // The day sheet's own confirmation was the confirmation; a dialog after it would be a second modal behind the first.
    if (intent === 'reopen' && !afterDaySheet) {
      const ok = await dialog.confirm({
        title: t('reopen.simple.title', { date: formatDate(day?.businessDate ?? '') }),
        message: t('reopen.simple.body'),
        confirmLabel: t('reopen.confirm'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
    }
    await send(chosen, undefined);
  };

  /** Before 06:00 somebody who may not start today early is told which day runs, and that new sales count for it. */
  const notice =
    day && intent === 'open' && openingPrompt(day.openChoices, day.localNowDate, day.businessDate) === 'notice'
      ? t('openChoice.notice.body', {
          time: isolateLtr(day.localNow),
          calendarDate: formatDate(day.localNowDate),
          date: formatDate(day.businessDate),
          next: formatDate(day.nextDate),
        })
      : null;

  const start = async () => {
    if (!day) return;
    setError(null);
    if (!failed) setNonce((n) => n + 1);
    if (choices.includes('start_new')) {
      setStage('day');
      return;
    }
    // With the amounts step the notice is in its sheet; an older server asks in a dialog, and no sheet follows it.
    if (notice && !day.openingMoney) {
      const ok = await dialog.confirm({
        title: t('openChoice.notice.title', { date: formatDate(day.businessDate) }),
        message: notice,
        confirmLabel: t('closingHistory.open'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
    }
    await amounts(null, false);
  };

  const step = day?.openingMoney ?? null;
  /**
   * A sheet reports its close once its exit animation ends — after the flow may already have moved on (the day chosen,
   * the amounts sheet opening). Only a sheet still current returns the flow to idle, or the next step would close too.
   */
  const closed = (which: 'day' | 'money') => () => setStage((s) => (s === which ? 'idle' : s));
  /** The day sheet's modal is gone: now, and only now, the amounts. */
  const daySheetGone = () => setStage((s) => (s === 'toMoney' ? 'money' : s));
  const element = day ? (
    <>
      <DayChoiceSheet
        key={`day-${nonce}`}
        intent={intent}
        open={stage === 'day'}
        onClose={closed('day')}
        onDismissed={daySheetGone}
        businessDate={day.businessDate}
        nextDate={day.nextDate}
        calendarDate={day.localNowDate}
        now={day.localNow}
        choices={choices}
        busy={busy}
        confirmLabel={step ? t('action.next') : undefined}
        onConfirm={(chosen) => void amounts(chosen, true)}
      />
      {step ? (
        <OpeningMoneySheet
          key={`money-${nonce}`}
          // A day started early is opened for the first time, whichever button led here.
          intent={mode === 'start_new' ? 'open' : intent}
          open={stage === 'money'}
          onClose={closed('money')}
          businessDate={mode === 'start_new' ? day.nextDate : day.businessDate}
          notice={notice}
          mayDecide={step.mayDecide}
          methods={step.methods}
          branchCount={step.branchCount}
          busy={busy}
          error={error}
          onConfirm={(money) => void send(mode, money)}
        />
      ) : null}
    </>
  ) : null;

  return { start: () => void start(), busy, element };
}
