/**
 * English catalogue — the source of truth for translation keys.
 *
 * Every other locale is checked against this file's key set at compile time, so
 * a missing or misspelled Arabic key is a type error rather than a blank label
 * discovered at a shop counter.
 *
 * Voice (see docs/05): plain language, short, human. A number never appears
 * without something telling you what it means. Warnings help, they don't scold.
 */
export const en = {
  // ── Common actions ────────────────────────────────────────────────────────
  'action.confirm': 'Confirm',
  'action.cancel': 'Cancel',
  'action.done': 'Done',
  'action.save': 'Save',
  'action.add': 'Add',
  'action.remove': 'Remove',
  'action.edit': 'Edit',
  'action.retry': 'Try again',
  'action.undo': 'Undo',
  'action.close': 'Close',
  'action.back': 'Back',
  'action.next': 'Next',
  'action.search': 'Search',
  'action.scan': 'Scan',
  'action.typeInstead': 'Type it instead',
  'action.change': 'Change',
  'action.selectAll': 'Select all',
  'action.clear': 'Clear',

  // ── Navigation ────────────────────────────────────────────────────────────
  'tab.home': 'Home',
  'tab.sell': 'Sell',
  'tab.inventory': 'Inventory',
  'tab.more': 'More',

  // ── Generic states ────────────────────────────────────────────────────────
  'state.loading': 'Loading…',
  'state.empty.title': 'Nothing here yet',
  'state.error.title': 'Something went wrong',
  'state.error.body': 'We could not load this. Check your connection and try again.',
  'state.error.offline.title': 'No connection',
  'state.error.offline.body': 'You appear to be offline. This will work again once you reconnect.',
  'state.error.permission.title': 'Not available to you',
  'state.error.permission.body': 'Your role does not include this. Ask a manager if you need it.',
  'state.error.notFound.title': 'Not found',
  'state.noResults.title': 'No matches',
  'state.noResults.body': 'Try a different search, or scan the item instead.',

  // ── Field helpers ─────────────────────────────────────────────────────────
  'field.required': 'Required',
  'field.optional': 'Optional',
  'field.password.show': 'Show password',
  'field.password.hide': 'Hide password',

  // ── Selection sheet ───────────────────────────────────────────────────────
  'select.search': 'Search',
  'select.create': 'Create “{name}”',
  'select.selected': '{count} selected',
  'select.confirm': 'Choose',

  // ── Dialogs ───────────────────────────────────────────────────────────────
  'dialog.discard.title': 'Discard changes?',
  'dialog.discard.body': 'What you have entered will not be saved.',
  'dialog.discard.confirm': 'Discard',

  // ── Toast ─────────────────────────────────────────────────────────────────
  'toast.dismiss': 'Dismiss',

  // ── Scanner ───────────────────────────────────────────────────────────────
  'scanner.title': 'Scan',
  'scanner.hint': 'Point the camera at the barcode',
  'scanner.hint.continuous': 'Keep scanning — each item is added as you go',
  'scanner.scanned': '{count} scanned',
  'scanner.looking': 'Looking it up…',
  'scanner.torch.on': 'Turn on the light',
  'scanner.torch.off': 'Turn off the light',
  'scanner.manual.title': 'Type the code',
  'scanner.manual.placeholder': 'IMEI, serial or barcode',
  'scanner.manual.submit': 'Look up',
  'scanner.permission.title': 'Camera access needed',
  'scanner.permission.body':
    'Scanning is far faster than typing. Allow the camera to scan IMEIs, serials and barcodes.',
  'scanner.permission.grant': 'Allow camera',
  'scanner.permission.denied':
    'Camera access is turned off. Turn it on in your phone settings, or type the code instead.',
  'scanner.unavailable.title': 'No camera here',
  'scanner.unavailable.body': 'This device has no camera available. You can type the code instead.',

  // ── Sell ──────────────────────────────────────────────────────────────────
  'sell.title': 'Sell',
  'sell.scan.placeholder': 'Scan IMEI, serial or barcode',
  'sell.empty.title': 'Ready to sell',
  'sell.empty.body': 'Scan the first item to start a sale.',
  'sell.alreadyInCart': 'Already in this sale',
  'sell.addToSale': 'Add to sale',
  'sell.priceRequired': 'This product has no price yet — enter one.',
  'sell.cart.count': '{count} item(s)',
  'sell.subtotal': 'Subtotal',
  'sell.discount': 'Discount',
  'sell.total': 'Total',
  'sell.charge': 'Charge {amount}',
  'sell.clear': 'Clear sale',
  'sell.clear.confirm': 'Clear this sale?',
  'sell.clear.body': 'Everything scanned so far will be removed.',

  // ── Payment ───────────────────────────────────────────────────────────────
  'sell.payment.title': 'Take payment',
  'sell.payment.method': 'How are they paying?',
  'sell.payment.amount': 'Amount',
  'sell.payment.remaining': '{amount} still to pay',
  'sell.payment.change': 'Change due {amount}',
  'sell.payment.split': 'Split across methods',
  'sell.payment.addMethod': 'Add another method',
  'sell.payment.complete': 'Complete sale',
  'sell.payment.exactOnly':
    'The full amount must be paid. Credit sales are not available yet.',

  // ── Below cost ────────────────────────────────────────────────────────────
  'sell.belowCost.title': 'Sell below cost?',
  'sell.belowCost.body': 'This sale is {amount} below what the stock cost.',
  'sell.belowCost.confirm': 'Sell anyway',
  'sell.belowCost.reason': 'Why?',
  'sell.belowCost.reasonPlaceholder': 'Damaged box, agreed with the owner…',
  'sell.belowCost.needsManager':
    'This price is below cost. A manager has to approve it.',

  // ── Sale complete ─────────────────────────────────────────────────────────
  'sell.done.title': 'Sale complete',
  'sell.done.invoice': 'Invoice {number}',
  'sell.done.profit': 'Profit {amount}',
  'sell.done.new': 'New sale',
  'sell.done.share': 'Share receipt',
  'sell.done.shareFailed': 'Could not create the receipt',

  // ── Receipt ───────────────────────────────────────────────────────────────
  'receipt.title': 'Receipt',
  'receipt.invoice': 'Invoice',
  'receipt.date': 'Date',
  'receipt.servedBy': 'Served by',
  'receipt.item': 'Item',
  'receipt.qty': 'Qty',
  'receipt.price': 'Price',
  'receipt.lineTotal': 'Total',
  'receipt.thanks': 'Thank you',

  // ── Inventory ─────────────────────────────────────────────────────────────
  'inventory.title': 'Inventory',
  'inventory.scan.placeholder': 'Scan or type an IMEI or serial',
  'inventory.filter.in_stock': 'In stock',
  'inventory.filter.sold': 'Sold',
  'inventory.filter.faulty': 'Faulty',
  'inventory.filter.all': 'All',
  'inventory.units': 'Tracked items',
  'inventory.accessories': 'Accessories',
  'inventory.inStock': 'in stock',
  'inventory.empty.title': 'No stock here yet',
  'inventory.empty.body': 'Receive a delivery and it will show up here.',
  'inventory.empty.filtered.title': 'Nothing matches',
  'inventory.empty.filtered.body': 'Try a different filter.',
  'inventory.notFound': 'No item with that code at this branch',
  'inventory.search': 'Search by name, variant or barcode',
  'inventory.count.units': '{shown} of {total} tracked',
  'inventory.count.stock': '{shown} of {total} accessories',
  'inventory.loadingMore': 'Loading more…',
  'inventory.loadMore': 'Load more',
  'inventory.endOfResults': 'That is everything',
  'inventory.loadFailed': 'Could not load more',
  'inventory.empty.search.title': 'No matches',
  'inventory.empty.search.body': 'Try fewer words, or scan the item instead.',

  // ── Receive ───────────────────────────────────────────────────────────────
  'receive.title': 'Receive stock',
  'receive.scan.placeholder': 'Scan the item or its barcode',
  'receive.supplier.choose': 'Choose supplier',
  'receive.supplier.title': 'Supplier',
  'receive.supplier.search': 'Search suppliers',
  'receive.supplier.needed': 'Choose a supplier to finish',
  'receive.session': 'This delivery',
  'receive.empty.title': 'Nothing added yet',
  'receive.empty.body': 'Scan the first item to start the delivery.',
  'receive.cost': 'What it cost you',
  'receive.cost.hint': 'Per unit, before any selling price',
  'receive.price': 'Selling price',
  'receive.price.hint': 'Optional — sets the price the shop sells it at',
  'receive.quantity': 'How many',
  'receive.units': '{count} unit(s)',
  'receive.addItem': 'Add to delivery',
  'receive.added': 'Added {label}',
  'receive.counted': '{label} · {count}',
  'receive.finish': 'Finish receiving',
  'receive.estimated': '{count} item(s) · est.',
  'receive.createProduct': 'Create this product first',
  'receive.done.title': 'Stock received',
  'receive.done.summary': '{units} item(s) · {lines} product line(s)',
  'receive.done.more': 'Receive more',

  // ── Product confirmation ──────────────────────────────────────────────────
  'confirm.recognized': 'Recognized',
  'confirm.checkThis': 'Check this is right',
  'confirm.checkThis.body': 'We matched it from the device number. Confirm or pick the right one.',
  'confirm.unknown.title': 'New to this shop',
  'confirm.unknown.body': 'Choose the product and we will remember this code next time.',
  'confirm.unreadable.title': 'Code not recognized',
  'confirm.unreadable.body': 'Try scanning again, or choose the product by hand.',
  'confirm.chooseProduct': 'Choose product',
  'confirm.createProduct': 'Create new product',
  'confirm.notThis': 'Not this one',
  'confirm.scanAgain': 'Scan again',
  'confirm.scannedCode': 'Scanned code',
  'confirm.willLearn': 'We will remember this code for next time.',

  // ── Unit status ───────────────────────────────────────────────────────────
  'status.unit.in_stock': 'In stock',
  'status.unit.reserved': 'Reserved',
  'status.unit.sold': 'Sold',
  'status.unit.returned': 'Returned',
  'status.unit.faulty': 'Faulty',
  'status.unit.in_transit': 'In transit',
  'status.unit.transferred_out': 'Transferred out',

  // ── Transfer status ───────────────────────────────────────────────────────
  'status.transfer.ready_to_ship': 'Ready to ship',
  'status.transfer.in_transit': 'In transit',
  'status.transfer.received': 'Received',
  'status.transfer.cancelled': 'Cancelled',

  // ── Sale payment status ───────────────────────────────────────────────────
  'status.sale.paid': 'Paid',
  'status.sale.partial': 'Part paid',
  'status.sale.credit': 'On credit',

  // ── Purchase payment status ───────────────────────────────────────────────
  'status.purchase.paid': 'Paid',
  'status.purchase.partial': 'Part paid',
  'status.purchase.unpaid': 'Unpaid',

  // Team member status
  'status.user.active': 'Active',
  'status.user.inactive': 'Inactive',
  'status.user.pending_contact': 'No phone yet',

  // ── Tracking types ────────────────────────────────────────────────────────
  'tracking.imei': 'IMEI',
  'tracking.serial': 'Serial',
  'tracking.quantity': 'Quantity',

  // ── Payment methods ───────────────────────────────────────────────────────
  'payment.cash': 'Cash',
  'payment.card': 'Card',
  'payment.mobile': 'Mobile money',
  'payment.bank': 'Bank transfer',
  'payment.other': 'Other',

  // ── Money & numbers ───────────────────────────────────────────────────────
  'money.hidden': 'Hidden',
  'money.free': 'Free',

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.language': 'Language',
  'settings.language.restartTitle': 'Restart needed',
  'settings.language.restartBody':
    'Close and reopen the app to finish switching language.',

  'settings.title': 'Business settings',
  'settings.subtitle': 'How your shop works. Everyone follows these.',
  'settings.save': 'Save changes',
  'settings.saved': 'Settings saved',
  'settings.unsaved.title': 'Leave without saving?',
  'settings.unsaved.body': 'Your changes will be lost.',
  'settings.unsaved.confirm': 'Discard changes',
  'settings.conflict.title': 'Changed on another device',
  'settings.conflict.body':
    'Someone saved different settings while this screen was open. We have loaded the current ones — check them before saving again.',
  'settings.toggle.on': 'On',
  'settings.toggle.off': 'Off',

  // Return policy
  'settings.returns.section': 'Returns',
  'settings.returns.label': 'How long can a customer bring something back?',
  'settings.returns.hint':
    'Applies to new sales. The deadline is calculated from the moment of sale.',
  'settings.returns.none': 'No returns',
  'settings.returns.24h': '24 hours',
  'settings.returns.48h': '48 hours',
  'settings.returns.custom': 'Custom',
  'settings.returns.customLabel': 'Hours',
  'settings.returns.customHint': 'Between 1 and 8760 hours (one year).',
  'settings.returns.invalid': 'Enter a whole number of hours between 1 and 8760.',
  'settings.returns.noneExplained': 'Customers cannot return items after a sale.',
  'settings.returns.windowExplained': 'Customers have {hours} hours to bring something back.',

  // Receiving accounts
  'settings.accounts.section': 'Where money arrives',
  'settings.accounts.hint':
    'Cash is always available and needs no setup. Add the accounts customers can send money to.',
  'settings.accounts.add': 'Add account',
  'settings.accounts.empty': 'No accounts yet',
  'settings.accounts.emptyBody': 'Customers can pay cash. Add an account to accept transfers too.',
  'settings.accounts.label': 'Name staff will see',
  'settings.accounts.labelHint': 'Something they can tell apart at a glance, e.g. “Bankily – Main Counter”.',
  'settings.accounts.labelRequired': 'Give this account a name.',
  'settings.accounts.provider': 'Service',
  'settings.accounts.providerName': 'Service name',
  'settings.accounts.providerNameRequired': 'Name the service.',
  'settings.accounts.newTitle': 'Add an account',
  'settings.accounts.editTitle': 'Edit account',
  'settings.accounts.active': 'Accepting money',
  'settings.accounts.activeHint': 'Turn off to hide it from staff. Past records keep working.',
  'settings.accounts.inactive': 'Not in use',
  'settings.accounts.created': 'Account added',
  'settings.accounts.updated': 'Account updated',
  'settings.accounts.duplicate': 'Another account already has that name.',
  'settings.provider.bankily': 'Bankily',
  'settings.provider.sedad': 'Sedad',
  'settings.provider.bim_bank': 'BIM Bank',
  'settings.provider.other': 'Other',

  // WhatsApp summaries
  'settings.whatsapp.section': 'WhatsApp summaries',
  'settings.whatsapp.hint': 'Sent to you only. Staff never receive these.',
  'settings.whatsapp.language': 'Message language',
  'settings.whatsapp.amounts': 'Include amounts',
  'settings.whatsapp.amountsHint': 'Off means the summary describes activity without any figures.',
  'settings.whatsapp.daily': 'Daily summary',
  'settings.whatsapp.dailyHint': 'A short recap at the end of each day.',
  'settings.whatsapp.monthly': 'Monthly summary',
  'settings.whatsapp.monthlyHint': 'A fuller picture at the end of each month.',
  'settings.whatsapp.notYet': 'Saved now, sent once WhatsApp is connected.',

  // Security
  'settings.security.section': 'Security',
  'settings.security.autoLock': 'Lock the app after',
  'settings.security.autoLockHint':
    'The longest anyone may choose. Staff can pick a shorter time, never a longer one.',
  'settings.security.immediate': 'Immediately',
  'settings.security.30s': '30 seconds',
  'settings.security.1m': '1 minute',
  'settings.security.5m': '5 minutes',
  'settings.security.15m': '15 minutes',

  // ── Team (F1 Stage 1) ───────────────────────────────────────────────────────
  'team.title': 'Team',
  'team.subtitle': 'The people who can use this shop’s app.',
  'team.empty': 'No team members yet',
  'team.emptyBody': 'People you invite will appear here.',
  'team.role.owner': 'Owner',
  'team.role.store_manager': 'Manager',
  'team.role.store_employee': 'Employee',
  'team.role.administrator': 'Administrator',
  'team.branchRole': '{role} · {branch}',
  'team.noBranches': 'No branch yet',
  'team.contact.none': 'No phone yet',
  'team.editTitle': 'Edit team member',
  'team.field.name': 'Name',
  'team.field.login': 'Username',
  'team.field.phone': 'Phone',
  'team.field.phoneHint': 'International format, e.g. +2223XXXXXX. Used later for WhatsApp codes.',
  'team.field.email': 'Email (optional)',
  'team.field.emailHint': 'For account recovery only. Can be left empty.',
  'team.field.active': 'Can use the app',
  'team.field.activeHint': 'Turn off to stop this person signing in. Their history is kept.',
  'team.detail.lastLogin': 'Last signed in',
  'team.detail.never': 'Never',
  'team.saved': 'Team member updated',
  'team.error.phone': 'Enter the phone in international format, e.g. +2223XXXXXX.',
  'team.error.email': 'That does not look like an email address.',
  'team.error.phoneTaken': 'Another team member already uses that phone number.',
  'team.error.self': 'You cannot switch off your own access.',
  'team.error.noChanges': 'Nothing changed.',

  // Branch price-edit delegation (F1 Stage 2)
  'team.delegation.section': 'Price editing',
  'team.delegation.hint':
    'Choose the branches where this manager may change ordinary selling prices.',
  'team.delegation.allow': 'Can edit prices in {branch}',
  'team.delegation.allowHint': 'Ordinary price changes only.',
  'team.delegation.belowCost': 'Selling below cost still needs your approval — this does not change that.',
  'team.delegation.granted': 'Price editing turned on for {branch}',
  'team.delegation.revoked': 'Price editing turned off for {branch}',
  'team.delegation.confirmOnTitle': 'Let them edit prices?',
  'team.delegation.confirmOnBody':
    '{name} will be able to change ordinary selling prices in {branch}. Selling below cost will still need your approval.',
  'team.delegation.confirmOffTitle': 'Turn off price editing?',
  'team.delegation.confirmOffBody': '{name} will no longer be able to change prices in {branch}.',
  'team.delegation.confirmOn': 'Allow',
  'team.delegation.confirmOff': 'Turn off',
  'team.delegation.conflict': 'That is not possible any more — reload the team and try again.',
  'team.delegation.notYet': 'Price editing itself arrives with the Pricing work. This sets who will be allowed to do it.',
  // ── Devices (F1 Stage 3) ──────────────────────────────────────────────────
  'devices.title': 'Devices',
  'devices.subtitle': 'Phones and tablets signed in to your account.',
  'devices.current': 'This device',
  'devices.empty': 'No other devices',
  'devices.emptyBody': 'You are only signed in here.',
  'devices.lastSeen': 'Last used {when}',
  'devices.lastSeenNever': 'Not used since sign-in',
  'devices.firstSeen': 'Added {when}',
  'devices.trust.legacy': 'Signed in before device checks',
  'devices.trust.password': 'Signed in with a password',
  'devices.trust.otp': 'Confirmed by code',
  'devices.status.active': 'Active',
  'devices.status.revoked': 'Removed',
  'devices.status.reverify': 'Will need a code next time',
  'devices.revoke': 'Remove this device',
  'devices.revoke.title': 'Remove this device?',
  'devices.revoke.body': 'It will be signed out immediately and will need to sign in again.',
  'devices.revoke.bodyCurrent':
    'This is the device you are using. Removing it signs you out right now.',
  'devices.revoke.confirm': 'Remove',
  'devices.revoked': 'Device removed',
  'devices.revokedCurrent': 'Signed out on this device',
  'devices.section.other': 'Other devices',
  'devices.section.removed': 'Removed devices',
  'devices.removedHint': 'Kept so you can see what happened to your account.',
  'devices.notVerifiedYet':
    'Phone confirmation codes arrive in a later update. Nothing here claims a phone has been confirmed.',
  'devices.owner.title': 'Devices',
  'devices.owner.subtitle': "Where {name} is signed in.",
  'devices.owner.revoke.body': 'That device will be signed out immediately.',

  // ── Authentication ─────────────────────────────────────────────────────────
  'auth.title': 'Retail ERP',
  'auth.subtitle': 'Sign in to your store',
  'auth.field.storeId': 'Store ID',
  'auth.field.storeId.hint': 'Your business ID — the Owner finds it in Settings. Not a password.',
  'auth.field.login': 'Login',
  'auth.field.password': 'Password',
  'auth.action.signIn': 'Sign In',
  // Non-enumerating: never reveals which field was wrong.
  'auth.error.failed': 'We could not sign you in. Check your details and try again.',
  'auth.error.network': 'No connection. Check your network and try again.',
  'auth.error.unknown': 'Something went wrong. Please try again.',
  'auth.device.title': 'This device needs verification',
  'auth.device.body':
    'For your security, this device could not be verified. Device verification is not available yet in this version — sign in from the device you used before, or ask your administrator for help.',

  // Store Account ID (Stage 4A CP1) — the public tenant selector employees type
  'settings.storeId.section': 'Store Account ID',
  'settings.storeId.hint':
    'Your staff type this when they sign in, together with their own username and password.',
  'settings.storeId.share': 'Safe to share with your team. It is not a password and cannot be used on its own.',
  'settings.storeId.copy': 'Copy',
  'settings.storeId.copied': 'Store Account ID copied',
} as const;
