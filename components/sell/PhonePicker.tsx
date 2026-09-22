import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronRight, Keyboard, Package, ScanBarcode, SlidersHorizontal } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterChip,
  Identifier,
  InlineNotice,
  SearchInput,
  SkeletonList,
  StatusChip,
  Text,
  TextField,
} from '../ui';
import { BottomSheet } from '../overlay/BottomSheet';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatMoney } from '../../lib/format';
import { isRTL, useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import {
  availabilityKey,
  identifierProblem,
  lookupSelection,
  sourceKey,
  useStockPhones,
  type LookupFailure,
  type PickSource,
} from '../../lib/phone-selection';
import type { IconComponent } from '../ui';
import type { InventoryUnitRow, SaleSelection, StockSummaryRow, TrackingType } from '../../types/api';

/**
 * Finding the item to sell — three ways in, one selection out.
 *
 * Scan, type or pick; whichever it was, the result is the same existing thing,
 * looked up by the server through ONE endpoint, and the sale continues through
 * the same payment flow. None of these creates a Product, a Unit or stock.
 *
 * An item is a serialized unit (a phone by its IMEI, a device by its serial) or
 * a counted product (an accessory by its barcode). What each screen shows of an
 * identifier follows the confirmed policy: the person typing sees the complete
 * value they typed, and so does the found card they check against the thing in
 * hand; the shelf and the review before payment show only its last four digits.
 * A barcode is a product code, not a personal identifier, and is shown whole.
 */

export type PickMode = 'choose' | 'scan' | 'manual' | 'stock';

type Found = { selection: SaleSelection; identifier: string };

/** The identifier label for a tracking type — never a fake IMEI for what has none. */
function trackingLabelKey(tracking: TrackingType): 'tracking.imei' | 'tracking.serial' | 'tracking.quantity' {
  return tracking === 'imei' ? 'tracking.imei' : tracking === 'serial' ? 'tracking.serial' : 'tracking.quantity';
}

/** The three choices the sale starts with. */
export function PhoneChooser({ onChoose }: { onChoose: (mode: Exclude<PickMode, 'choose'>) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.stack}>
      <Text variant="body" tone="secondary">
        {t('pick.choose.title')}
      </Text>
      <ChoiceCard icon={ScanBarcode} title={t('pick.scan')} hint={t('pick.scan.hint')} onPress={() => onChoose('scan')} />
      <ChoiceCard icon={Keyboard} title={t('pick.manual')} hint={t('pick.manual.hint')} onPress={() => onChoose('manual')} />
      <ChoiceCard icon={Package} title={t('pick.stock')} hint={t('pick.stock.hint')} onPress={() => onChoose('stock')} />
    </View>
  );
}

/** One way in: a big target with an icon, a name and one line saying what it means. */
function ChoiceCard({ icon: Icon, title, hint, onPress }: { icon: IconComponent; title: string; hint: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <View style={styles.choiceIcon}>
        <Icon color={colors.text.accent} size={28} />
      </View>
      <View style={styles.grow}>
        <Text variant="heading">{title}</Text>
        <Text variant="body" tone="secondary">
          {hint}
        </Text>
      </View>
      <View style={isRTL() ? styles.flip : undefined}>
        <ChevronRight size={20} color={colors.text.tertiary} />
      </View>
    </Pressable>
  );
}

/**
 * Typing an identifier — an IMEI, a serial number or a product barcode.
 *
 * A fifteen-digit number is treated as an IMEI and validated as it is typed,
 * then looked up the moment it is a real one, so there is no button between the
 * fifteenth digit and seeing the item. Anything else — a serial, a barcode — is
 * looked up when the person asks, because it has no fixed length to know it is
 * finished. Finding an item only locates existing stock: nothing is ever added.
 */
export function ManualImeiPanel({
  onUse,
  onStockInstead,
}: {
  onUse: (selection: SaleSelection, identifier: string) => void;
  onStockInstead: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [failure, setFailure] = useState<LookupFailure | null>(null);
  /** Which lookup is the current one: an answer to an earlier value is dropped. */
  const request = useRef(0);
  const problem = identifierProblem(text);
  const typing = text.trim().length > 0;
  const ready = typing && problem === null;
  // A complete, valid IMEI looks itself up; other identifiers wait for "Find".
  const isCompleteImei = /^\d{15}$/.test(text.replace(/\D/g, '')) && problem === null;

  const lookUp = (raw: string) => {
    const mine = ++request.current;
    setBusy(true);
    setFound(null);
    setFailure(null);
    lookupSelection(raw)
      .then((result) => {
        if (mine !== request.current) return;
        setBusy(false);
        if (result.ok) setFound({ selection: result.selection, identifier: result.identifier });
        else setFailure(result.failure);
      })
      .catch(() => {
        if (mine !== request.current) return;
        setBusy(false);
        setFailure('server');
      });
  };

  const onChange = (raw: string) => {
    setText(raw);
    request.current += 1; // any prior lookup's answer is now stale
    setBusy(false);
    setFound(null);
    setFailure(null);
    if (/^\d{15}$/.test(raw.replace(/\D/g, '')) && identifierProblem(raw) === null) {
      lookUp(raw);
    }
  };

  const sellable = found?.selection.availability === 'available';

  return (
    <View style={styles.stack}>
      <TextField
        label={t('pick.manual.label')}
        value={text}
        onChangeText={onChange}
        keyboardType="default"
        placeholder={t('pick.manual.placeholder')}
        variant="identifier"
        autoFocus
        onSubmitEditing={() => ready && !isCompleteImei && lookUp(text)}
        trailing={ready && isCompleteImei ? <CheckCircle2 color={colors.intent.success.fg} size={20} /> : undefined}
      />
      {typing && problem === 'checksum' ? (
        <Text variant="caption" tone="warning">
          {t('pick.problem.checksum')}
        </Text>
      ) : (
        <Text variant="caption" tone="secondary">
          {t('pick.manual.either')}
        </Text>
      )}

      {/* A serial or barcode is looked up on request; a valid IMEI already has been. */}
      {ready && !isCompleteImei && !found ? (
        <Button title={t('pick.manual.find')} variant="secondary" fullWidth onPress={() => lookUp(text)} loading={busy} />
      ) : null}

      {busy && isCompleteImei ? <ActivityIndicator color={colors.brand[600]} /> : null}

      {failure ? (
        <InlineNotice
          tone={failure === 'network' ? 'warning' : 'danger'}
          action={
            failure === 'network' ? (
              <Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => lookUp(text)} />
            ) : undefined
          }
        >
          {t(`pick.failure.${failure}` as never)}
        </InlineNotice>
      ) : null}

      {found ? (
        <Card style={styles.stack}>
          <View style={styles.grow}>
            <Text variant="heading">{`${found.selection.product.brand} ${found.selection.product.model}`}</Text>
            {found.selection.product.variant ? (
              <Text variant="body" tone="secondary">
                {found.selection.product.variant}
              </Text>
            ) : null}
            {/* The complete value, for the person checking it against the thing in hand. */}
            <View style={styles.imeiLine}>
              <Text variant="caption" tone="secondary">
                {t(trackingLabelKey(found.selection.product.trackingType))}
              </Text>
              <Identifier tone="primary">{found.identifier}</Identifier>
            </View>
            {found.selection.kind === 'product' && found.selection.quantityAvailable !== undefined ? (
              <Text variant="caption" tone="secondary">
                {t('pick.stock.inStock', { count: String(found.selection.quantityAvailable) })}
              </Text>
            ) : null}
            <View style={styles.chipRow}>
              <AvailabilityChip selection={found.selection} />
            </View>
          </View>
          {!sellable ? <InlineNotice tone="danger">{unavailableWords(found.selection, t)}</InlineNotice> : null}
        </Card>
      ) : null}

      {found && sellable ? <Button title={t('pick.manual.use')} size="lg" fullWidth onPress={() => onUse(found.selection, found.identifier)} /> : null}
      <Button title={t('pick.manual.toStock')} variant="secondary" fullWidth onPress={onStockInstead} />

      <InlineNotice tone="info">{t('pick.manual.noStock')}</InlineNotice>
    </View>
  );
}

/** The identifier a shelf row is sold by: its first IMEI, else its serial. */
const identifierOf = (row: InventoryUnitRow) => row.imeiPrimary ?? row.serialNo ?? row.identifier;

interface StockFilter {
  brand: string | null;
  tracking: TrackingType | null;
}
const NO_FILTER: StockFilter = { brand: null, tracking: null };

/**
 * Picking the item off the shelf: this branch's serialized stock, searchable
 * and one page at a time.
 *
 * A specific unit is what you pick from a list — a phone by its IMEI, a device
 * by its serial. Counted accessories are not picked one by one from a list;
 * they are added by scanning their barcode (the Scan and Enter ways), because
 * "which cable" is a question with no answer. So this list shows serialized
 * items, each labelled by what identifies it — never a made-up IMEI for
 * something that has none.
 *
 * One search field and one Filter: the wrapping row of brand chips is gone,
 * replaced by a sheet that filters by brand and by type, with a Reset. Choosing
 * a row only selects it; the server is asked about the item when the person
 * continues, through the same lookup a scan uses.
 */
export function StockPicker({ selected, onSelect }: { selected: string | null; onSelect: (identifier: string) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const branchId = useBranch((s) => s.branchId);
  const [typed, setTyped] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<StockFilter>(NO_FILTER);
  /** The filter being edited in the sheet — seeded from the applied one on open. */
  const [draft, setDraft] = useState<StockFilter>(NO_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const stock = useStockPhones(term, true);
  const summary = useQuery({
    queryKey: qk.inventorySummary(branchId),
    queryFn: () => api.get<StockSummaryRow[]>('/inventory/summary'),
    enabled: Boolean(branchId),
  });
  const priceOf = useMemo(() => {
    const byProduct = new Map<string, StockSummaryRow['price']>();
    for (const row of summary.data ?? []) byProduct.set(row.productId, row.price);
    return (productId: string) => byProduct.get(productId) ?? null;
  }, [summary.data]);

  // The brands on the shelf, read from the loaded rows.
  const brands = useMemo(
    () => [...new Set(stock.phones.map((p) => p.product?.brand).filter((b): b is string => Boolean(b)))].sort(),
    [stock.phones],
  );

  const rows = useMemo(
    () =>
      stock.phones.filter(
        (r) =>
          (filter.brand === null || r.product?.brand === filter.brand) &&
          (filter.tracking === null || r.product?.trackingType === filter.tracking),
      ),
    [stock.phones, filter],
  );

  const activeCount = (filter.brand ? 1 : 0) + (filter.tracking ? 1 : 0);
  const activeSummary = [filter.brand, filter.tracking ? t(trackingLabelKey(filter.tracking)) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.stack}>
      <SearchInput
        value={typed}
        onChangeText={setTyped}
        onDebouncedChange={(v) => setTerm(v.trim())}
        placeholder={t('pick.stock.search')}
        identifier
      />

      <View style={styles.filterBar}>
        <Button
          title={activeCount > 0 ? t('pick.filter.buttonActive', { count: String(activeCount) }) : t('pick.filter.button')}
          variant={activeCount > 0 ? 'secondary' : 'tertiary'}
          size="sm"
          icon={SlidersHorizontal}
          onPress={() => {
            setDraft(filter); // seed the sheet from the applied filter
            setFilterOpen(true);
          }}
        />
        {activeSummary ? (
          <Text variant="caption" tone="secondary" style={styles.grow} numberOfLines={1}>
            {activeSummary}
          </Text>
        ) : null}
      </View>

      {rows.length > 0 ? (
        <Text variant="caption" tone="secondary">
          {t('pick.stock.count', { count: String(rows.length) })}
        </Text>
      ) : null}

      {stock.isPending ? (
        <SkeletonList count={4} />
      ) : stock.isError ? (
        <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Package} title={t('pick.stock.none')} />
      ) : (
        <View style={styles.stack} accessibilityRole="radiogroup">
          {rows.map((row) => (
            <StockOption
              key={row.id}
              row={row}
              price={priceOf(row.productId)}
              selected={selected === identifierOf(row)}
              onPress={() => onSelect(identifierOf(row))}
            />
          ))}
        </View>
      )}
      {stock.hasNextPage ? (
        <Button title={t('pick.stock.more')} variant="tertiary" loading={stock.isFetchingNextPage} onPress={() => void stock.fetchNextPage()} />
      ) : null}

      <StockFilterSheet
        open={filterOpen}
        draft={draft}
        onChange={setDraft}
        brands={brands}
        onClose={() => setFilterOpen(false)}
        onApply={() => {
          setFilter(draft);
          setFilterOpen(false);
        }}
        onReset={() => {
          setFilter(NO_FILTER);
          setFilterOpen(false);
        }}
      />
    </View>
  );
}

/** One Filter sheet: brand and type, with a Reset. Replaces the wrapping chips. */
function StockFilterSheet({
  open,
  draft,
  onChange,
  brands,
  onClose,
  onApply,
  onReset,
}: {
  open: boolean;
  draft: StockFilter;
  onChange: (next: StockFilter) => void;
  brands: string[];
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const trackings: TrackingType[] = ['imei', 'serial'];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('pick.filter.title')}
      footer={
        <View style={styles.stack}>
          <Button title={t('pick.filter.apply')} size="lg" fullWidth onPress={onApply} />
          <Button title={t('pick.filter.reset')} variant="tertiary" fullWidth onPress={onReset} />
        </View>
      }
    >
      <View style={styles.sheet}>
        {brands.length > 0 ? (
          <>
            <Text variant="label">{t('pick.filter.brand')}</Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              <FilterChip label={t('pick.filter.all')} selected={draft.brand === null} onPress={() => onChange({ ...draft, brand: null })} />
              {brands.map((b) => (
                <FilterChip key={b} label={b} selected={draft.brand === b} onPress={() => onChange({ ...draft, brand: b })} />
              ))}
            </View>
          </>
        ) : null}

        <Text variant="label">{t('pick.filter.type')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          <FilterChip label={t('pick.filter.all')} selected={draft.tracking === null} onPress={() => onChange({ ...draft, tracking: null })} />
          {trackings.map((tr) => (
            <FilterChip
              key={tr}
              label={t(trackingLabelKey(tr))}
              selected={draft.tracking === tr}
              onPress={() => onChange({ ...draft, tracking: tr })}
            />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

/** One item on the shelf: what it is, its last four digits labelled by type, its price, and whether it is the one picked. */
function StockOption({
  row,
  price,
  selected,
  onPress,
}: {
  row: InventoryUnitRow;
  price: StockSummaryRow['price'];
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const id = identifierOf(row);
  const name = row.product ? `${row.product.brand} ${row.product.model}` : id;
  const tracking = row.product?.trackingType ?? 'imei';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected ? styles.optionSelected : null, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text variant="bodyStrong">{name}</Text>
        {row.product?.variant ? (
          <Text variant="caption" tone="secondary">
            {row.product.variant}
          </Text>
        ) : null}
        <View style={styles.imeiLine}>
          <Text variant="caption" tone="secondary">
            {t(trackingLabelKey(tracking))}
          </Text>
          <Identifier>{`•••• ${id.slice(-4)}`}</Identifier>
        </View>
        {price ? (
          <Text variant="bodyStrong">
            {price.min === price.max
              ? formatMoney(price.min)
              : `${formatMoney(price.min, { showCurrency: false })} – ${formatMoney(price.max)}`}
          </Text>
        ) : null}
      </View>
      <View style={[styles.radio, selected ? styles.radioOn : null]}>
        {selected ? <Check size={14} color={colors.text.inverse} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * The item chosen, however it was found: what it is, which one by its last four
 * digits, whether it can be sold here, and how it was found. The price field is
 * the sale's own — prefilled with the server's ladder price.
 */
export function SelectedPhoneCard({
  selection,
  source,
  children,
}: {
  selection: SaleSelection;
  source: PickSource;
  /** The price field and anything else the sale adds beneath. */
  children?: React.ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const p = selection.product;
  const variant = p.variant ?? [p.storage, p.colour].filter(Boolean).join(' · ');
  return (
    <Card style={styles.stack}>
      <View style={styles.phoneHead}>
        <View style={styles.grow}>
          <Text variant="heading">{`${p.brand} ${p.model}`}</Text>
          {variant ? (
            <Text variant="body" tone="secondary">
              {variant}
            </Text>
          ) : null}
          <View style={styles.imeiLine}>
            <Text variant="caption" tone="secondary">
              {t(trackingLabelKey(p.trackingType))}
            </Text>
            <Identifier>{selection.identifierMasked ?? '—'}</Identifier>
          </View>
          {selection.kind === 'product' && selection.quantityAvailable !== undefined ? (
            <Text variant="caption" tone="secondary">
              {t('pick.stock.inStock', { count: String(selection.quantityAvailable) })}
            </Text>
          ) : null}
        </View>
        <AvailabilityChip selection={selection} />
      </View>
      {selection.availability !== 'available' ? <InlineNotice tone="danger">{unavailableWords(selection, t)}</InlineNotice> : null}
      <View style={styles.rule} />
      {children}
      <Detail label={t('pick.foundBy.label')} value={t(sourceKey(source))} />
    </Card>
  );
}

/** Available in green words, or the unit's own status — never colour alone. */
function AvailabilityChip({ selection }: { selection: SaleSelection }) {
  const { t } = useTranslation();
  return selection.availability === 'available' ? (
    <Chip label={t('pick.chip.available')} tone="success" size="sm" />
  ) : (
    <StatusChip domain="unit" value={selection.status} size="sm" />
  );
}

/** Why the item cannot be sold here — naming another branch only when the server did. */
function unavailableWords(selection: SaleSelection, t: ReturnType<typeof useTranslation>['t']): string {
  return selection.otherBranch
    ? t('pick.availability.other_branch_named', { branch: selection.otherBranch.name })
    : t(availabilityKey(selection.availability));
}

function Detail({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.detail}>
      <Text variant="body" tone="secondary" style={styles.grow}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  stack: { gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  flip: { transform: [{ scaleX: -1 }] },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 96,
    padding: space.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  choiceIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
  },
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  phoneHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  imeiLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  chipRow: { flexDirection: 'row', paddingTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sheet: { gap: space.md, padding: space.base },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.large,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  optionSelected: {
    backgroundColor: colors.intent.info.bg,
    borderColor: colors.intent.info.solid,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.intent.info.solid, borderColor: colors.intent.info.solid },
  rule: { height: 1, backgroundColor: colors.border.subtle },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));
