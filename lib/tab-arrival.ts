/**
 * Has the person left this tab for another one?
 *
 * A tab that owns a period (Home, Money) opens on Today at every arrival. It
 * stays mounted while another tab shows and its own route never changes, so
 * the only sign of leaving is the tab bar's state: the tab it now shows is not
 * this one. A screen pushed from the tab (Results, a day's sales, the Daily
 * closing) sits above the tab bar and changes nothing here, so the choice made
 * on the tab survives the way there and back.
 *
 * Pure, so it can be run directly under Node.
 */
export function leftTab(state: { index: number; routes: readonly { key: string; name: string }[] }, ownKey: string): boolean {
  // An index past the routes shows no tab at all, so it is not this one either.
  return state.routes[state.index]?.key !== ownKey;
}
