import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react-native';
import { BottomSheet } from '../overlay';
import { PermissionExplainer } from '../permissions/PermissionExplainer';
import { useTranslation } from '../../lib/i18n';
import { createOpenGate, pushedNotificationId } from '../../lib/navigation/notification-route';
import {
  askPushPermission,
  forgetLaunchPush,
  launchedByPush,
  onPushArrived,
  onPushTapped,
  onPushTokenRotated,
  pushDeclined,
  pushPermission,
  pushSupported,
  registerThisPhone,
  rememberPushDeclined,
  type PushTap,
} from '../../lib/push';
import { usePushOffer } from '../../lib/push-offer';
import { shouldOfferPush } from '../../lib/push-policy';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../hooks/useAuth';

/** One navigation per tap, across the listener and "the last response" at a cold start (D225). */
const opened = createOpenGate();

/**
 * Push on the phone, mounted once under the signed-in app (D225):
 *  - registers this phone after sign-in, again when its token rotates or the app's language changes;
 *  - offers notifications once, right after a sign-in, in the app's own words — "Enable notifications" opens iOS's
 *    prompt, "Not now" is remembered and never asked again by the app;
 *  - opens a tapped push — app in the foreground, in the background or closed — through the opening screen, which
 *    asks the server whether the person may still open it. A tap before sign-in waits for the sign-in;
 *  - refreshes the centre when a push arrives with the app open.
 * It renders nothing but the one-time explanation.
 */
export function PushBridge() {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const justSignedIn = usePushOffer((s) => s.justSignedIn);
  const offerDone = usePushOffer((s) => s.done);
  const [offering, setOffering] = useState(false);
  const pending = useRef<string | null>(null);
  const signedIn = useRef(false);
  const userId = user?.id ?? null;

  // Register (idempotent) for this person in this language; a rotated token re-registers and revokes the old one.
  useEffect(() => {
    if (!pushSupported || !userId) return;
    void registerThisPhone(userId, language).catch(() => undefined);
    return onPushTokenRotated(() => void registerThisPhone(userId, language).catch(() => undefined));
  }, [userId, language]);

  // The one-time offer, after a sign-in only.
  useEffect(() => {
    if (!pushSupported || !userId || !justSignedIn) return;
    offerDone();
    void (async () => {
      const permission = await pushPermission();
      if (shouldOfferPush({ permission, justSignedIn: true, declined: await pushDeclined() })) setOffering(true);
    })();
  }, [userId, justSignedIn, offerDone]);

  /** Open the tapped notification once somebody is signed in; until then it waits. */
  const flush = () => {
    const id = pending.current;
    if (!id || !signedIn.current) return;
    pending.current = null;
    forgetLaunchPush();
    router.push({ pathname: '/notification-open', params: { id } });
  };

  // A tapped push: now, or as soon as somebody is signed in.
  useEffect(() => {
    if (!pushSupported) return;
    const handle = (tap: PushTap | null) => {
      if (!tap || !opened(tap.identifier)) return;
      const id = pushedNotificationId(tap.data);
      if (id) pending.current = id;
    };
    // Closed when tapped: the response that launched the app.
    handle(launchedByPush());
    const stopTaps = onPushTapped((tap) => {
      handle(tap);
      flush();
    });
    const stopArrivals = onPushArrived(() => void queryClient.invalidateQueries({ queryKey: qk.notifications }));
    return () => {
      stopTaps();
      stopArrivals();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    signedIn.current = userId !== null;
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!offering) return null;
  return (
    <BottomSheet open={offering} onClose={() => setOffering(false)} title={t('push.offer.sheetTitle')}>
      <PermissionExplainer
        icon={BellRing}
        title={t('push.offer.title')}
        benefits={[t('push.offer.benefit.approvals'), t('push.offer.benefit.choose'), t('push.offer.benefit.private')]}
        denied={false}
        allowLabel={t('push.offer.allow')}
        onAllow={() => {
          setOffering(false);
          void askPushPermission()
            .then((p) => (p === 'granted' && userId ? registerThisPhone(userId, language) : undefined))
            .catch(() => undefined);
        }}
        alternative={{
          label: t('push.offer.notNow'),
          onPress: () => {
            setOffering(false);
            void rememberPushDeclined();
          },
        }}
        deniedSteps=""
      />
    </BottomSheet>
  );
}
