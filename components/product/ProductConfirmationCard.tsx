import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CircleCheck, CircleHelp, Package, Sparkles, TriangleAlert } from 'lucide-react-native';
import { type Intent } from '../../lib/design/colors';
import { radius, space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { CONFIDENCE_HIGH } from '../scanner/useScan';
import { Button, type IconComponent } from '../ui/Button';
import { Chip, StatusChip } from '../ui/Chip';
import { Divider } from '../ui/Surface';
import { Identifier, Text } from '../ui/Text';
import type { ProductSuggestion, ScanResult } from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The one product confirmation card.
 *
 * Used by Sell, Receive, Inventory lookup, Transfers, Returns and whatever
 * comes next. There is deliberately no second version: the moment a workflow
 * gets its own variant, "what did the scanner find?" starts meaning something
 * slightly different on each screen, which is exactly the confusion this app
 * exists to remove.
 *
 * Workflows vary it in two controlled ways:
 *  - `context` swaps the primary action's wording.
 *  - `children` injects the fields that workflow needs (price, cost, quantity).
 *
 * It renders all four states the backend actually produces, not just the happy
 * one. `POST /scan` returns `suggestion: null` for every serial and for unknown
 * IMEIs — that is a normal path, not an error, and it is where the shop teaches
 * the scanner something new.
 */

export type ScanContext = 'sell' | 'receive' | 'lookup' | 'transfer' | 'return';

/** Which state the card is in — derived, never passed in. */
type CardState = 'confident' | 'uncertain' | 'unknown' | 'unreadable';

function deriveState(result: ScanResult): CardState {
  if (result.kind === 'unknown') return 'unreadable';
  if (!result.recognized || !result.suggestion) return 'unknown';
  return result.confidence >= CONFIDENCE_HIGH ? 'confident' : 'uncertain';
}

const STATE_META: Record<CardState, { tone: Intent; icon: IconComponent }> = {
  confident: { tone: 'success', icon: CircleCheck },
  uncertain: { tone: 'warning', icon: CircleHelp },
  unknown: { tone: 'info', icon: Sparkles },
  unreadable: { tone: 'danger', icon: TriangleAlert },
};

export interface ProductConfirmationCardProps {
  result: ScanResult;
  context: ScanContext;
  /** Label for the primary action. Defaults per context. */
  confirmLabel: string;
  onConfirm: (suggestion: ProductSuggestion) => void;
  /** Open a product picker — used to correct a match or resolve an unknown. */
  onChooseProduct?: () => void;
  /** Create a brand-new product template from this code. */
  onCreateProduct?: () => void;
  onScanAgain?: () => void;
  /** Workflow fields: price for Sell, cost + quantity for Receive. */
  children?: React.ReactNode;
  confirmDisabled?: boolean;
  loading?: boolean;
  /**
   * A blocking or cautionary message from the workflow — "already in cart",
   * "this unit is sold". Rendered prominently; `danger` also hides confirm.
   */
  notice?: { tone: 'warning' | 'danger'; message: string };
  style?: StyleProp<ViewStyle>;
}

export function ProductConfirmationCard({
  result,
  confirmLabel,
  onConfirm,
  onChooseProduct,
  onCreateProduct,
  onScanAgain,
  children,
  confirmDisabled = false,
  loading = false,
  notice,
  style,
}: ProductConfirmationCardProps) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const state = deriveState(result);
  const meta = STATE_META[state];
  const palette = colors.intent[meta.tone];
  const suggestion = result.suggestion;
  const StateIcon = meta.icon;

  const headline: Record<CardState, string> = {
    confident: t('confirm.recognized'),
    uncertain: t('confirm.checkThis'),
    unknown: t('confirm.unknown.title'),
    unreadable: t('confirm.unreadable.title'),
  };

  // The backend's own hint is more specific than anything we can say generically
  // ("New barcode — confirm the product to teach it"), so prefer it.
  const explanation: Record<CardState, string | undefined> = {
    confident: undefined,
    uncertain: result.hint ?? t('confirm.checkThis.body'),
    unknown: result.hint ?? t('confirm.unknown.body'),
    unreadable: result.hint ?? t('confirm.unreadable.body'),
  };

  const blocked = notice?.tone === 'danger';
  const canConfirm = Boolean(suggestion) && !blocked;

  /**
   * A blocking notice outranks the recognition state.
   *
   * When a unit cannot be sold, "we matched it from the device number" is
   * noise — the employee needs to know it is Sold, not how confident the
   * scanner was. The banner leads with the reason it is blocked, and the
   * separate notice row is dropped so the same sentence is not shown twice.
   */
  const bannerPalette = blocked ? colors.intent.danger : palette;
  const BannerIcon = blocked ? TriangleAlert : StateIcon;

  return (
    <View style={[styles.card, style]}>
      {/* State banner — the answer to "did it work?" before anything else. */}
      <View
        style={[
          styles.banner,
          { backgroundColor: bannerPalette.bg, borderColor: bannerPalette.border },
        ]}
      >
        <BannerIcon color={bannerPalette.fg} size={18} />
        <View style={styles.bannerText}>
          <Text variant="bodyStrong" style={{ color: bannerPalette.fg }}>
            {blocked ? notice.message : headline[state]}
          </Text>
          {!blocked && explanation[state] ? (
            <Text variant="caption" style={{ color: bannerPalette.fg, opacity: 0.9 }}>
              {explanation[state]}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Identity */}
      {suggestion ? (
        <View style={styles.identity}>
          <View style={styles.thumb}>
            <Package color={colors.brand[600]} size={22} />
          </View>
          <View style={styles.identityText}>
            <Text variant="heading" numberOfLines={2}>
              {[suggestion.brand, suggestion.model].filter(Boolean).join(' ')}
            </Text>
            {suggestion.variant ? (
              <Text variant="body" tone="secondary" numberOfLines={1}>
                {suggestion.variant}
              </Text>
            ) : null}
            <View style={styles.chips}>
              <StatusChip domain="tracking" value={suggestion.trackingType} size="sm" dot={false} />
              <KeySpecs specifications={suggestion.keySpecifications} />
            </View>
          </View>
        </View>
      ) : null}

      {/* The scanned code, always visible so it can be checked against the box. */}
      <View style={styles.codeRow}>
        <Text variant="caption" tone="tertiary">
          {t('confirm.scannedCode')}
        </Text>
        <Identifier tone="secondary">{result.code}</Identifier>
      </View>

      {notice && !blocked ? (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: colors.intent[notice.tone].bg,
              borderColor: colors.intent[notice.tone].border,
            },
          ]}
        >
          <TriangleAlert color={colors.intent[notice.tone].fg} size={16} />
          <Text variant="label" style={{ color: colors.intent[notice.tone].fg, flex: 1 }}>
            {notice.message}
          </Text>
        </View>
      ) : null}

      {/* Workflow fields */}
      {children ? (
        <>
          <Divider />
          <View style={styles.slot}>{children}</View>
        </>
      ) : null}

      {/* Teaching promise — only where confirming actually teaches something. */}
      {state === 'unknown' && result.recognitionKey ? (
        <Text variant="caption" tone="tertiary">
          {t('confirm.willLearn')}
        </Text>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        {canConfirm ? (
          <Button
            title={confirmLabel}
            fullWidth
            loading={loading}
            disabled={confirmDisabled}
            onPress={() => suggestion && onConfirm(suggestion)}
          />
        ) : null}

        {/* An uncertain match needs a visible way to say "no" — otherwise the
            fast path quietly becomes the wrong path. */}
        {suggestion && onChooseProduct ? (
          <Button
            title={state === 'confident' ? t('confirm.chooseProduct') : t('confirm.notThis')}
            variant="secondary"
            fullWidth
            onPress={onChooseProduct}
          />
        ) : null}

        {!suggestion && onChooseProduct ? (
          <Button
            title={t('confirm.chooseProduct')}
            variant={blocked ? 'secondary' : 'primary'}
            fullWidth
            onPress={onChooseProduct}
          />
        ) : null}

        {!suggestion && onCreateProduct ? (
          <Button
            title={t('confirm.createProduct')}
            variant="secondary"
            fullWidth
            onPress={onCreateProduct}
          />
        ) : null}

        {onScanAgain ? (
          <Button title={t('confirm.scanAgain')} variant="tertiary" fullWidth onPress={onScanAgain} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The two or three specs that actually distinguish one unit from another on a
 * shelf — storage and colour for a phone, screen size for a TV. Capped, because
 * the point is a glance, not a datasheet.
 */
function KeySpecs({ specifications }: { specifications?: Record<string, unknown> | null }) {
  if (!specifications) return null;
  const entries = Object.entries(specifications)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 3);
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map(([key, value]) => (
        <Chip key={key} label={String(value)} tone="neutral" size="sm" />
      ))}
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: space.base,
    padding: space.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: {
    flex: 1,
    gap: 1,
  },
  identity: {
    flexDirection: 'row',
    gap: space.md,
  },
  thumb: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
  },
  identityText: {
    flex: 1,
    gap: space.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xs,
    marginTop: 2,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface.sunken,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  slot: {
    gap: space.md,
  },
  actions: {
    gap: space.sm,
  },
}));
