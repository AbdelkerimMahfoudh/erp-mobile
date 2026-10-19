/**
 * The server's operational WhatsApp consent copy (`GET messaging/whatsapp/consent`, D213), as the backend serves it
 * at `wa-operational-2026-10-19` — the app shows it as it comes and holds no copy of its own, so the tests carry one.
 */
import type { WhatsAppConsentCopy } from '../../types/api';

export const CONSENT_VERSION = 'wa-operational-2026-10-19';

export const CONSENT_COPY: Record<'en' | 'fr' | 'ar', WhatsAppConsentCopy> = {
  en: {
    version: CONSENT_VERSION,
    language: 'en',
    title: 'Operational messages on WhatsApp',
    body: 'WhatsApp is the required contact for a Dukan ERP account: we verify your number with a code and send your account’s operational messages there. You can withdraw this agreement at any time in Communication preferences.',
    agreement:
      'I agree to receive operational Dukan ERP messages on WhatsApp, including verification and security codes, account setup information, trial and subscription status, expiry reminders and important service notices. Message frequency depends on account activity. This is not consent to marketing messages.',
    purposes: ['operational_whatsapp'],
  },
  fr: {
    version: CONSENT_VERSION,
    language: 'fr',
    title: 'Messages opérationnels sur WhatsApp',
    body: 'WhatsApp est le contact obligatoire d’un compte Dukan ERP : nous vérifions votre numéro par un code et y envoyons les messages opérationnels de votre compte. Vous pouvez retirer cet accord à tout moment dans Préférences de communication.',
    agreement:
      'J’accepte de recevoir sur WhatsApp les messages opérationnels de Dukan ERP, notamment les codes de vérification et de sécurité, les informations de configuration du compte, l’état de l’essai et de l’abonnement, les rappels d’expiration et les avis de service importants. La fréquence des messages dépend de l’activité du compte. Il ne s’agit pas d’un consentement aux messages marketing.',
    purposes: ['operational_whatsapp'],
  },
  ar: {
    version: CONSENT_VERSION,
    language: 'ar',
    title: 'الرسائل التشغيلية عبر واتساب',
    body: 'واتساب هو جهة الاتصال المطلوبة لحساب Dukan ERP: نتحقق من رقمك برمز ونرسل إليه الرسائل التشغيلية الخاصة بحسابك. يمكنك سحب هذه الموافقة في أي وقت من «تفضيلات التواصل».',
    agreement:
      'أوافق على تلقي رسائل Dukan ERP التشغيلية عبر واتساب، بما في ذلك رموز التحقق والأمان، ومعلومات إعداد الحساب، وحالة الفترة التجريبية والاشتراك، وتذكيرات انتهاء الصلاحية، وإشعارات الخدمة المهمة. يعتمد عدد الرسائل على نشاط الحساب. وهذه ليست موافقة على تلقي رسائل تسويقية.',
    purposes: ['operational_whatsapp'],
  },
};

/** The copy the public endpoint answers for a path, or null for another path. */
export function consentCopyFor(path: string): WhatsAppConsentCopy | null {
  const match = /^\/messaging\/whatsapp\/consent\?language=(en|fr|ar)$/.exec(path);
  return match ? CONSENT_COPY[match[1] as 'en' | 'fr' | 'ar'] : null;
}
