import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Keyboard, List, ScanLine } from 'lucide-react-native';
import { Button, Card, InlineNotice, ListRow, RowGroup, StatusChip, Text, TextField } from '../ui';
import { space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import {
  availabilityKey,
  lookupSelection,
  manualImeiProblem,
  sourceKey,
  useStockPhones,
  type LookupFailure,
  type PickSource,
} from '../../lib/phone-selection';
import type { SaleSelection } from '../../types/api';

/**
 * Finding the phone to sell — three ways in, one selection out.
 *
 * Scan, type or pick; whichever it was, the result is the same existing Unit,
 * looked up by the server through ONE endpoint, and the sale continues through
 * the same payment flow. None of these creates a Product, a Unit or stock.
 */

export type PickMode = 'choose' | 'scan' | 'manual' | 'stock';

/** The three choices the sale starts with. */
export function PhoneChooser({ onChoose }: { onChoose: (mode: Exclude<PickMode, 'choose'>) => void }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text variant="title">{t('pick.choose.title')}</Text>
      <RowGroup>
        <ListRow leading={ScanLine} title={t('pick.scan')} subtitle={t('pick.scan.hint')} onPress={() => onChoose('scan')} />
        <ListRow leading={Keyboard} title={t('pick.manual')} subtitle={t('pick.manual.hint')} onPress={() => onChoose('manual')} />
        <ListRow leading={List} title={t('pick.stock')} subtitle={t('pick.stock.hint')} onPress={() => onChoose('stock')} />
      </RowGroup>
    </View>
  );
}

/**
 * Typing the IMEI. Validated as it is typed — fifteen digits, correct checksum —
 * then looked up on the server. Either IMEI finds the same phone. Finding it
 * only locates existing stock: nothing is ever added.
 */
export function ManualImeiPanel({
  onUse,
  onStockInstead,
}: {
  onUse: (selection: SaleSelection, identifier: string) => void;
  onStockInstead: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ selection: SaleSelection; identifier: string } | null>(null);
  const [failure, setFailure] = useState<LookupFailure | null>(null);
  const problem = manualImeiProblem(text);

  const find = async () => {
    if (problem) return;
    setBusy(true);
    setFound(null);
    setFailure(null);
    const result = await lookupSelection(text);
    setBusy(false);
    if (result.ok) setFound({ selection: result.selection, identifier: result.identifier });
    else setFailure(result.failure);
  };

  return (
    <View style={styles.stack}>
      <TextField
        label={t('pick.manual.label')}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setFound(null);
          setFailure(null);
        }}
        keyboardType="number-pad"
        placeholder="000000000000000"
        hint={t('pick.manual.either')}
        autoFocus
      />
      {text.trim().length > 0 && problem ? (
        <Text variant="caption" tone="warning">
          {t(`pick.problem.${problem}` as never)}
        </Text>
      ) : null}
      <Button title={t('pick.manual.find')} fullWidth disabled={problem !== null || busy} loading={busy} onPress={() => void find()} />

      {failure ? <InlineNotice tone={failure === 'network' ? 'warning' : 'danger'}>{t(`pick.failure.${failure}` as never)}</InlineNotice> : null}

      {found ? (
        <Card style={styles.stack}>
          <Text variant="bodyStrong">{`${found.selection.product.brand} ${found.selection.product.model}`}</Text>
          {found.selection.product.variant ? (
            <Text variant="caption" tone="secondary">
              {found.selection.product.variant}
            </Text>
          ) : null}
          <Text variant="caption" tone={found.selection.availability === 'available' ? 'secondary' : 'danger'}>
            {t(availabilityKey(found.selection.availability))}
          </Text>
          {found.selection.availability === 'available' ? (
            <Button title={t('pick.manual.use')} fullWidth onPress={() => onUse(found.selection, found.identifier)} />
          ) : null}
        </Card>
      ) : null}

      <Button title={t('pick.manual.toStock')} variant="tertiary" onPress={onStockInstead} />
    </View>
  );
}

/**
 * Picking the phone off the shelf: this branch's phones in stock, searchable by
 * model or either IMEI, one page at a time. Tapping one asks the server about
 * it through the same lookup a scan uses.
 */
export function StockPicker({ onPick }: { onPick: (identifier: string) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const stock = useStockPhones(search, true);

  return (
    <View style={styles.stack}>
      <TextField label={t('pick.stock.search')} value={search} onChangeText={setSearch} />
      {stock.isPending ? (
        <ActivityIndicator color={colors.brand[600]} />
      ) : stock.phones.length === 0 ? (
        <Text variant="caption" tone="tertiary">
          {t('pick.stock.none')}
        </Text>
      ) : (
        <Card style={styles.list}>
          {stock.phones.map((row) => {
            const id = row.imeiPrimary ?? row.serialNo ?? row.identifier;
            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={row.product ? `${row.product.brand} ${row.product.model}` : id}
                onPress={() => onPick(id)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.grow}>
                  <Text variant="body">{row.product ? `${row.product.brand} ${row.product.model}` : id}</Text>
                  <Text variant="caption" tone="secondary">
                    {[row.product?.variant, `•••• ${id.slice(-4)}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
      {stock.hasNextPage ? (
        <Button title={t('pick.stock.more')} variant="tertiary" loading={stock.isFetchingNextPage} onPress={() => void stock.fetchNextPage()} />
      ) : null}
    </View>
  );
}

/**
 * The phone chosen, however it was found: what it is, which one, whether it can
 * be sold here, at what price, and how it was found. The price field is the
 * sale's own — prefilled with the server's ladder price.
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
  return (
    <Card style={styles.stack}>
      <Text variant="heading">{`${p.brand} ${p.model}`}</Text>
      {p.variant ? (
        <Text variant="body" tone="secondary">
          {p.variant}
        </Text>
      ) : null}
      <Detail label={t('pick.storage')} value={p.storage ?? '—'} />
      <Detail label={t('pick.colour')} value={p.colour ?? '—'} />
      <Detail label={t('pick.imei')} value={selection.identifierMasked ?? '—'} />
      <View style={styles.detail}>
        <Text variant="body" tone="secondary" style={styles.grow}>
          {t('pick.availability')}
        </Text>
        <StatusChip domain="unit" value={selection.status} size="sm" />
      </View>
      {selection.availability !== 'available' ? (
        <InlineNotice tone="danger">{t(availabilityKey(selection.availability))}</InlineNotice>
      ) : null}
      {selection.price !== null ? <Detail label={t('pick.price')} value={formatMoney(selection.price)} /> : null}
      <Text variant="caption" tone="tertiary">
        {t('pick.foundBy', { source: t(sourceKey(source)) })}
      </Text>
      {children}
    </Card>
  );
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
  stack: { gap: space.sm },
  list: { gap: 0, paddingVertical: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touch.min,
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  pressed: { opacity: 0.6 },
  grow: { flex: 1 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));
