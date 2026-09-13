import { Redirect } from 'expo-router';

/**
 * The old Partner stores screen.
 *
 * Everything it did — finding a store, requesting, answering and blocking — now
 * lives on the Partners tab, with cancel, remove and the connected-store detail
 * added. This route is kept so bookmarks, notifications and the More link that
 * pointed at `/stores` still land somewhere real instead of on "not found".
 */
export default function StoresRedirect() {
  return <Redirect href="/(tabs)/partners" />;
}
