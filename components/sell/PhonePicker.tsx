import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronRight, Keyboard, Package, ScanBarcode } from 'lucide-react-native';
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
  Thumbnail,
} from '../ui';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatMoney } from '../../lib/format';
import { isRTL, useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import {
  availabilityKey,
  lookupSelection,
  manualImeiProblem,
  sourceKey,
  useStockPhones,
  type LookupFailure,
  type PickSource,
} from '../../lib/phone-selection';
import type { IconComponent } from '../ui';
import type { InventoryUnitRow, SaleSelection, StockSummaryRow } from '../../types/api';

/**
 * Finding the phone to sell — three ways in, one selection out.
 *
 * Scan, type or pick; whichever it was, the result is the same existing Unit,
 * looked up by the server through ONE endpoint, and the sale continues through
 * the same payment flow. None of these creates a Product, a Unit or stock.
 *
 * What each screen shows of the IMEI follows the confirmed policy: the person
 * typing sees the complete number they typed, and so does the found card they
 * check against the handset; the shelf and the review before payment show only
 * its last four digits.
 */

export type PickMode = 'choose' | 'scan' | 'manual' | 'stock';

type Found = { selection: SaleSelection; identifier: string };

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
 * Typing the IMEI. Validated as it is typed — fifteen digits, correct
 * checksum — and looked up on the server the moment it is a real IMEI, so
 * there is no button between the fifteenth digit and seeing the phone. Either
 * IMEI finds the same phone. Finding it only locates existing stock: nothing
 * is ever added.
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
  /** Which lookup is the current one: an answer to an earlier number is dropped. */
  const request = useRef(0);
  const problem = manualImeiProblem(text);
  const typing = text.trim().length > 0;
  const valid = typing && problem === null;

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
    if (raw.trim().length > 0 && manualImeiProblem(raw) === null) {
      lookUp(raw);
    } else {
      request.current += 1;
      setBusy(false);
      setFound(null);
      setFailure(null);
    }
  };

  const sellable = found?.selection.availability === 'available';

  return (
    <View style={styles.stack}>
      <TextField
        label={t('pick.manual.label')}
        value={text}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder="000000000000000"
        variant="identifier"
        autoFocus
        trailing={valid ? <CheckCircle2 color={colors.intent.success.fg} size={20} /> : undefined}
      />
      {typing && problem ? (
        <Text variant="caption" tone="warning">
          {t(`pick.problem.${problem}` as never)}
        </Text>
      ) : valid ? (
        <View style={styles.validLine}>
          <CheckCircle2 color={colors.intent.success.fg} size={16} />
          <Text variant="caption" tone="success">
            {t('pick.manual.valid')}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="secondary">
          {t('pick.manual.either')}
        </Text>
      )}

      {busy ? <ActivityIndicator color={colors.brand[600]} /> : null}

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
          <View style={styles.phoneHead}>
            <Thumbnail size="lg" />
            <View style={styles.grow}>
              <Text variant="heading">{`${found.selection.product.brand} ${found.selection.product.model}`}</Text>
              {found.selection.product.variant ? (
                <Text variant="body" tone="secondary">
                  {found.selection.product.variant}
                </Text>
              ) : null}
              {/* The complete number, for the person checking it against the phone in hand. */}
              <View style={styles.imeiLine}>
                <Text variant="caption" tone="secondary">
                  {t('pick.imei')}
                </Text>
                <Identifier tone="primary">{found.identifier}</Identifier>
              </View>
              <View style={styles.chipRow}>
                <AvailabilityChip selection={found.selection} />
              </View>
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

/**
 * Picking the phone off the shelf: this branch's phones in stock, searchable
 * by model, colour or either IMEI, filterable by brand, one page at a time.
 * The count and every price are the server's — the price from the same
 * summary the Stock tab lists, which is the sale's own ladder. Choosing a row
 * only selects it; the server is asked about the phone when the person
 * continues, through the same lookup a scan uses.
 */
export function StockPicker({ selected, onSelect }: { selected: string | null; onSelect: (identifier: string) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const branchId = useBranch((s) => s.branchId);
  const [typed, setTyped] = useState('');
  const [term, setTerm] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const stock = useStockPhones(term || brand || '', true);
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

  // The brands on the shelf, read from the rows. Pinned the moment one is
  // chosen, so choosing a brand does not empty the row of chips it came from.
  const derived = useMemo(() => [...new Set(stock.phones.map((p) => p.product?.brand).filter((b): b is string => Boolean(b)))].sort(), [stock.phones]);
  const [pinned, setPinned] = useState<string[] | null>(null);
  const brands = pinned ?? derived;

  const count = stock.data?.pages[0]?.totals.units;

  return (
    <View style={styles.stack}>
      <SearchInput
        value={typed}
        onChangeText={setTyped}
        onDebouncedChange={(v) => {
          setTerm(v.trim());
          if (v.trim()) setBrand(null);
        }}
        placeholder={t('pick.stock.search')}
        identifier
      />
      {brands.length > 0 ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          <FilterChip label={t('pick.stock.all')} selected={brand === null} onPress={() => setBrand(null)} />
          {brands.map((b) => (
            <FilterChip
              key={b}
              label={b}
              selected={brand === b}
              onPress={() => {
                if (!pinned) setPinned(derived);
                setBrand(b);
                setTyped('');
                setTerm('');
              }}
            />
          ))}
        </View>
      ) : null}
      {count !== undefined ? (
        <Text variant="caption" tone="secondary">
          {t('pick.stock.count', { count: String(count) })}
        </Text>
      ) : null}

      {stock.isPending ? (
        <SkeletonList count={4} />
      ) : stock.isError ? (
        <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
      ) : stock.phones.length === 0 ? (
        <EmptyState icon={Package} title={t('pick.stock.none')} />
      ) : (
        <View style={styles.stack} accessibilityRole="radiogroup">
          {stock.phones.map((row) => (
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
    </View>
  );
}

/** One phone on the shelf: what it is, its last four digits, its price, and whether it is the one picked. */
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
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected ? styles.optionSelected : null, pressed && styles.pressed]}
    >
      <Thumbnail size="lg" />
      <View style={styles.grow}>
        <Text variant="bodyStrong">{name}</Text>
        {row.product?.variant ? (
          <Text variant="caption" tone="secondary">
            {row.product.variant}
          </Text>
        ) : null}
        <View style={styles.imeiLine}>
          <Text variant="caption" tone="secondary">
            {t('pick.imei')}
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
      <View style={styles.optionEnd}>
        <Chip label={t('pick.chip.available')} tone="success" size="sm" />
        <View style={[styles.radio, selected ? styles.radioOn : null]}>
          {selected ? <Check size={14} color={colors.text.inverse} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The phone chosen, however it was found: what it is, which one by its last
 * four digits, whether it can be sold here, and how it was found. The price
 * field is the sale's own — prefilled with the server's ladder price.
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
        <Thumbnail size="lg" />
        <View style={styles.grow}>
          <Text variant="heading">{`${p.brand} ${p.model}`}</Text>
          {variant ? (
            <Text variant="body" tone="secondary">
              {variant}
            </Text>
          ) : null}
          <View style={styles.imeiLine}>
            <Text variant="caption" tone="secondary">
              {t('pick.imei')}
            </Text>
            <Identifier>{selection.identifierMasked ?? '—'}</Identifier>
          </View>
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

/** Why the phone cannot be sold here — naming another branch only when the server did. */
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
  validLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  phoneHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  imeiLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  chipRow: { flexDirection: 'row', paddingTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
  optionEnd: { alignItems: 'flex-end', justifyContent: 'space-between', gap: space.sm, alignSelf: 'stretch' },
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
