import {
  ArrowLeftRight,
  BadgeCheck,
  BadgePercent,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  Handshake,
  HandCoins,
  Landmark,
  Package,
  Receipt,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Palette,
  Smartphone,
  Tag,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react-native';
import type { IconName } from '../../lib/navigation/registry';
import type { IconComponent } from '../ui/Button';

/**
 * Icon names from the navigation registry, resolved to components.
 *
 * This exists so `lib/navigation/registry.ts` can stay free of every runtime
 * import and be loadable by a plain `node` test. The split costs one lookup and
 * buys a drift test that actually runs.
 *
 * `Record<IconName, …>` is doing real work: adding a name to the registry
 * without adding it here fails the build rather than rendering a blank square.
 */
export const HUB_ICONS: Record<IconName, IconComponent> = {
  ArrowLeftRight,
  BadgeCheck,
  BadgePercent,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  HandCoins,
  Handshake,
  Landmark,
  Package,
  Receipt,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Palette,
  Smartphone,
  Tag,
  Undo2,
  Users,
  Wallet,
};
