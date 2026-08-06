import type { Catalogue } from './keys';

/**
 * Arabic (Modern Standard) catalogue.
 *
 * ⚠️ Needs a native-speaker review pass before the app is used in the shop.
 * The terms here are standard retail vocabulary and are structurally correct,
 * but tone and regional phrasing are best confirmed by someone who serves
 * customers in Arabic daily. The keys and RTL plumbing are final; only the
 * strings should change.
 *
 * Typed as `Catalogue`, so this file cannot drift from the English key set —
 * a missing or renamed key fails the build.
 */
export const ar: Catalogue = {
  // ── Common actions ────────────────────────────────────────────────────────
  'action.confirm': 'تأكيد',
  'action.cancel': 'إلغاء',
  'action.done': 'تم',
  'action.save': 'حفظ',
  'action.add': 'إضافة',
  'action.remove': 'إزالة',
  'action.edit': 'تعديل',
  'action.retry': 'إعادة المحاولة',
  'action.undo': 'تراجع',
  'action.close': 'إغلاق',
  'action.back': 'رجوع',
  'action.next': 'التالي',
  'action.search': 'بحث',
  'action.scan': 'مسح',
  'action.typeInstead': 'أدخله يدويًا',
  'action.change': 'تغيير',
  'action.selectAll': 'تحديد الكل',
  'action.clear': 'إفراغ',

  // ── Navigation ────────────────────────────────────────────────────────────
  'tab.home': 'الرئيسية',
  'tab.sell': 'بيع',
  'tab.inventory': 'المخزون',
  'tab.more': 'المزيد',

  // ── Generic states ────────────────────────────────────────────────────────
  'state.loading': 'جارٍ التحميل…',
  'state.empty.title': 'لا يوجد شيء بعد',
  'state.error.title': 'حدث خطأ ما',
  'state.error.body': 'تعذّر تحميل هذا. تحقّق من اتصالك وحاول مرة أخرى.',
  'state.error.offline.title': 'لا يوجد اتصال',
  'state.error.offline.body': 'يبدو أنك غير متصل. سيعمل هذا مجدّدًا عند عودة الاتصال.',
  'state.error.permission.title': 'غير متاح لك',
  'state.error.permission.body': 'صلاحيتك لا تشمل هذا. اطلب من المدير إن كنت بحاجة إليه.',
  'state.error.notFound.title': 'غير موجود',
  'state.noResults.title': 'لا توجد نتائج',
  'state.noResults.body': 'جرّب بحثًا آخر، أو امسح المنتج بدلًا من ذلك.',

  // ── Field helpers ─────────────────────────────────────────────────────────
  'field.required': 'مطلوب',
  'field.optional': 'اختياري',
  'field.password.show': 'إظهار كلمة المرور',
  'field.password.hide': 'إخفاء كلمة المرور',

  // ── Selection sheet ───────────────────────────────────────────────────────
  'select.search': 'بحث',
  'select.create': 'إنشاء «{name}»',
  'select.selected': 'تم اختيار {count}',
  'select.confirm': 'اختيار',

  // ── Dialogs ───────────────────────────────────────────────────────────────
  'dialog.discard.title': 'تجاهل التغييرات؟',
  'dialog.discard.body': 'لن يتم حفظ ما أدخلته.',
  'dialog.discard.confirm': 'تجاهل',

  // ── Toast ─────────────────────────────────────────────────────────────────
  'toast.dismiss': 'إخفاء',

  // ── Scanner ───────────────────────────────────────────────────────────────
  'scanner.title': 'مسح',
  'scanner.hint': 'وجّه الكاميرا نحو الباركود',
  'scanner.hint.continuous': 'واصل المسح — تُضاف كل قطعة تلقائيًا',
  'scanner.scanned': 'تم مسح {count}',
  'scanner.looking': 'جارٍ البحث…',
  'scanner.torch.on': 'تشغيل الإضاءة',
  'scanner.torch.off': 'إطفاء الإضاءة',
  'scanner.manual.title': 'أدخل الرقم',
  'scanner.manual.placeholder': 'IMEI أو الرقم التسلسلي أو الباركود',
  'scanner.manual.submit': 'بحث',
  'scanner.permission.title': 'نحتاج إذن الكاميرا',
  'scanner.permission.body':
    'المسح أسرع بكثير من الكتابة. اسمح باستخدام الكاميرا لمسح أرقام IMEI والأرقام التسلسلية والباركود.',
  'scanner.permission.grant': 'السماح بالكاميرا',
  'scanner.permission.denied':
    'إذن الكاميرا مغلق. فعّله من إعدادات الهاتف، أو أدخل الرقم يدويًا.',
  'scanner.unavailable.title': 'لا توجد كاميرا',
  'scanner.unavailable.body': 'لا تتوفر كاميرا على هذا الجهاز. يمكنك إدخال الرقم يدويًا.',

  // ── Sell ──────────────────────────────────────────────────────────────────
  'sell.title': 'بيع',
  'sell.scan.placeholder': 'امسح IMEI أو الرقم التسلسلي أو الباركود',
  'sell.empty.title': 'جاهز للبيع',
  'sell.empty.body': 'امسح أول قطعة لبدء عملية البيع.',
  'sell.alreadyInCart': 'مضاف بالفعل إلى هذه العملية',
  'sell.addToSale': 'إضافة إلى البيع',
  'sell.priceRequired': 'لا يوجد سعر لهذا المنتج بعد — أدخل سعرًا.',
  'sell.cart.count': '{count} قطعة',
  'sell.subtotal': 'المجموع الفرعي',
  'sell.discount': 'خصم',
  'sell.total': 'الإجمالي',
  'sell.charge': 'تحصيل {amount}',
  'sell.clear': 'إلغاء العملية',
  'sell.clear.confirm': 'إلغاء هذه العملية؟',
  'sell.clear.body': 'سيتم حذف كل ما تم مسحه.',

  // ── Payment ───────────────────────────────────────────────────────────────
  'sell.payment.title': 'استلام الدفع',
  'sell.payment.method': 'كيف سيدفع؟',
  'sell.payment.amount': 'المبلغ',
  'sell.payment.remaining': 'متبقٍ {amount}',
  'sell.payment.change': 'الباقي {amount}',
  'sell.payment.split': 'تقسيم على عدة طرق',
  'sell.payment.addMethod': 'إضافة طريقة أخرى',
  'sell.payment.complete': 'إتمام البيع',
  'sell.payment.exactOnly': 'يجب دفع المبلغ كاملًا. البيع الآجل غير متاح بعد.',

  // ── Below cost ────────────────────────────────────────────────────────────
  'sell.belowCost.title': 'البيع بأقل من التكلفة؟',
  'sell.belowCost.body': 'هذه العملية أقل بـ {amount} من تكلفة البضاعة.',
  'sell.belowCost.confirm': 'بيع على أي حال',
  'sell.belowCost.reason': 'لماذا؟',
  'sell.belowCost.reasonPlaceholder': 'علبة تالفة، بموافقة المالك…',
  'sell.belowCost.needsManager': 'هذا السعر أقل من التكلفة. يجب أن يوافق المدير.',

  // ── Sale complete ─────────────────────────────────────────────────────────
  'sell.done.title': 'تمت عملية البيع',
  'sell.done.invoice': 'فاتورة {number}',
  'sell.done.profit': 'الربح {amount}',
  'sell.done.new': 'عملية جديدة',
  'sell.done.share': 'مشاركة الفاتورة',
  'sell.done.shareFailed': 'تعذّر إنشاء الفاتورة',

  // ── Receipt ───────────────────────────────────────────────────────────────
  'receipt.title': 'فاتورة',
  'receipt.invoice': 'رقم الفاتورة',
  'receipt.date': 'التاريخ',
  'receipt.servedBy': 'البائع',
  'receipt.item': 'الصنف',
  'receipt.qty': 'الكمية',
  'receipt.price': 'السعر',
  'receipt.lineTotal': 'الإجمالي',
  'receipt.thanks': 'شكرًا لكم',

  // ── Inventory ─────────────────────────────────────────────────────────────
  'inventory.title': 'المخزون',
  'inventory.scan.placeholder': 'امسح أو أدخل IMEI أو رقمًا تسلسليًا',
  'inventory.filter.in_stock': 'متوفر',
  'inventory.filter.sold': 'مباع',
  'inventory.filter.faulty': 'تالف',
  'inventory.filter.all': 'الكل',
  'inventory.units': 'قطع مُتتبَّعة',
  'inventory.accessories': 'إكسسوارات',
  'inventory.inStock': 'متوفر',
  'inventory.empty.title': 'لا يوجد مخزون بعد',
  'inventory.empty.body': 'استلم شحنة وستظهر هنا.',
  'inventory.empty.filtered.title': 'لا توجد نتائج',
  'inventory.empty.filtered.body': 'جرّب تصفية أخرى.',
  'inventory.notFound': 'لا توجد قطعة بهذا الرمز في هذا الفرع',
  'inventory.search': 'ابحث بالاسم أو المواصفات أو الباركود',
  'inventory.count.units': '{shown} من {total} قطعة مُتتبَّعة',
  'inventory.count.stock': '{shown} من {total} إكسسوار',
  'inventory.loadingMore': 'جارٍ تحميل المزيد…',
  'inventory.loadMore': 'تحميل المزيد',
  'inventory.endOfResults': 'هذا كل شيء',
  'inventory.loadFailed': 'تعذّر تحميل المزيد',
  'inventory.empty.search.title': 'لا توجد نتائج',
  'inventory.empty.search.body': 'جرّب كلمات أقل، أو امسح القطعة بدلًا من ذلك.',

  // ── Receive ───────────────────────────────────────────────────────────────
  'receive.title': 'استلام بضاعة',
  'receive.scan.placeholder': 'امسح القطعة أو الباركود',
  'receive.supplier.choose': 'اختر المورّد',
  'receive.supplier.title': 'المورّد',
  'receive.supplier.search': 'البحث عن مورّد',
  'receive.supplier.needed': 'اختر مورّدًا لإتمام الاستلام',
  'receive.session': 'هذه الشحنة',
  'receive.empty.title': 'لم تُضف أي قطعة بعد',
  'receive.empty.body': 'امسح أول قطعة لبدء الشحنة.',
  'receive.cost': 'سعر التكلفة',
  'receive.cost.hint': 'لكل وحدة، قبل سعر البيع',
  'receive.price': 'سعر البيع',
  'receive.price.hint': 'اختياري — يحدّد السعر الذي يبيع به المتجر',
  'receive.quantity': 'الكمية',
  'receive.units': '{count} وحدة',
  'receive.addItem': 'إضافة إلى الشحنة',
  'receive.added': 'تمت إضافة {label}',
  'receive.counted': '{label} · {count}',
  'receive.finish': 'إتمام الاستلام',
  'receive.estimated': '{count} قطعة · تقديري',
  'receive.createProduct': 'أنشئ هذا المنتج أولًا',
  'receive.done.title': 'تم استلام البضاعة',
  'receive.done.summary': '{units} قطعة · {lines} سطر منتج',
  'receive.done.more': 'استلام المزيد',

  // ── Product confirmation ──────────────────────────────────────────────────
  'confirm.recognized': 'تم التعرف عليه',
  'confirm.checkThis': 'تأكّد أن هذا صحيح',
  'confirm.checkThis.body': 'طابقناه من رقم الجهاز. أكّد أو اختر المنتج الصحيح.',
  'confirm.unknown.title': 'جديد على المتجر',
  'confirm.unknown.body': 'اختر المنتج وسنتذكّر هذا الرمز في المرة القادمة.',
  'confirm.unreadable.title': 'لم يتم التعرف على الرمز',
  'confirm.unreadable.body': 'حاول المسح مرة أخرى، أو اختر المنتج يدويًا.',
  'confirm.chooseProduct': 'اختيار المنتج',
  'confirm.createProduct': 'إنشاء منتج جديد',
  'confirm.notThis': 'ليس هذا',
  'confirm.scanAgain': 'مسح مرة أخرى',
  'confirm.scannedCode': 'الرمز الممسوح',
  'confirm.willLearn': 'سنتذكّر هذا الرمز في المرة القادمة.',

  // ── Unit status ───────────────────────────────────────────────────────────
  'status.unit.in_stock': 'متوفر',
  'status.unit.reserved': 'محجوز',
  'status.unit.sold': 'مباع',
  'status.unit.returned': 'مُرجَع',
  'status.unit.faulty': 'تالف',
  'status.unit.in_transit': 'قيد النقل',
  'status.unit.transferred_out': 'تم تحويله',

  // ── Transfer status ───────────────────────────────────────────────────────
  'status.transfer.ready_to_ship': 'جاهز للإرسال',
  'status.transfer.in_transit': 'قيد النقل',
  'status.transfer.received': 'تم الاستلام',
  'status.transfer.cancelled': 'ملغى',

  // ── Sale payment status ───────────────────────────────────────────────────
  'status.sale.paid': 'مدفوع',
  'status.sale.partial': 'مدفوع جزئيًا',
  'status.sale.credit': 'آجل',

  // ── Purchase payment status ───────────────────────────────────────────────
  'status.purchase.paid': 'مدفوع',
  'status.purchase.partial': 'مدفوع جزئيًا',
  'status.purchase.unpaid': 'غير مدفوع',

  // حالة عضو الفريق
  'status.user.active': 'نشط',
  'status.user.inactive': 'موقوف',
  'status.user.pending_contact': 'بدون هاتف',

  // ── Tracking types ────────────────────────────────────────────────────────
  'tracking.imei': 'IMEI',
  'tracking.serial': 'الرقم التسلسلي',
  'tracking.quantity': 'الكمية',

  // ── Payment methods ───────────────────────────────────────────────────────
  'payment.cash': 'نقدًا',
  'payment.card': 'بطاقة',
  'payment.mobile': 'محفظة إلكترونية',
  'payment.bank': 'تحويل بنكي',
  'payment.other': 'أخرى',

  // ── Money & numbers ───────────────────────────────────────────────────────
  'money.hidden': 'مخفي',
  'money.free': 'مجاني',

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.language': 'اللغة',
  'settings.language.restartTitle': 'يلزم إعادة التشغيل',
  'settings.language.restartBody': 'أغلق التطبيق وأعد فتحه لإكمال تغيير اللغة.',

  'settings.title': 'إعدادات المتجر',
  'settings.subtitle': 'طريقة عمل متجرك. الجميع يلتزم بها.',
  'settings.save': 'حفظ التغييرات',
  'settings.saved': 'تم حفظ الإعدادات',
  'settings.unsaved.title': 'الخروج دون حفظ؟',
  'settings.unsaved.body': 'ستفقد تغييراتك.',
  'settings.unsaved.confirm': 'تجاهل التغييرات',
  'settings.conflict.title': 'تم التغيير من جهاز آخر',
  'settings.conflict.body':
    'حفظ شخص ما إعدادات مختلفة بينما كانت هذه الشاشة مفتوحة. عرضنا الإعدادات الحالية — راجعها قبل الحفظ مرة أخرى.',
  'settings.toggle.on': 'مفعّل',
  'settings.toggle.off': 'متوقف',

  // Return policy
  'settings.returns.section': 'الإرجاع',
  'settings.returns.label': 'كم من الوقت يمكن للزبون إرجاع المنتج؟',
  'settings.returns.hint': 'يسري على المبيعات الجديدة. تُحتسب المهلة من لحظة البيع.',
  'settings.returns.none': 'لا إرجاع',
  'settings.returns.24h': '٢٤ ساعة',
  'settings.returns.48h': '٤٨ ساعة',
  'settings.returns.custom': 'مدة مخصصة',
  'settings.returns.customLabel': 'عدد الساعات',
  'settings.returns.customHint': 'بين ١ و٨٧٦٠ ساعة (سنة واحدة).',
  'settings.returns.invalid': 'أدخل عدد ساعات صحيحًا بين ١ و٨٧٦٠.',
  'settings.returns.noneExplained': 'لا يمكن للزبائن إرجاع المنتجات بعد البيع.',
  'settings.returns.windowExplained': 'أمام الزبائن {hours} ساعة لإرجاع المنتج.',

  // Receiving accounts
  'settings.accounts.section': 'أين تصل الأموال',
  'settings.accounts.hint':
    'النقد متاح دائمًا ولا يحتاج إعدادًا. أضف الحسابات التي يمكن للزبائن التحويل إليها.',
  'settings.accounts.add': 'إضافة حساب',
  'settings.accounts.empty': 'لا توجد حسابات بعد',
  'settings.accounts.emptyBody': 'يمكن للزبائن الدفع نقدًا. أضف حسابًا لقبول التحويلات أيضًا.',
  'settings.accounts.label': 'الاسم الذي يراه الموظفون',
  'settings.accounts.labelHint': 'اسم يميّزه بسرعة، مثل «بنكيلي – الصندوق الرئيسي».',
  'settings.accounts.labelRequired': 'أعطِ هذا الحساب اسمًا.',
  'settings.accounts.provider': 'الخدمة',
  'settings.accounts.providerName': 'اسم الخدمة',
  'settings.accounts.providerNameRequired': 'اكتب اسم الخدمة.',
  'settings.accounts.newTitle': 'إضافة حساب',
  'settings.accounts.editTitle': 'تعديل الحساب',
  'settings.accounts.active': 'يستقبل الأموال',
  'settings.accounts.activeHint': 'أوقفه لإخفائه عن الموظفين. تبقى السجلات السابقة كما هي.',
  'settings.accounts.inactive': 'غير مستخدم',
  'settings.accounts.created': 'تمت إضافة الحساب',
  'settings.accounts.updated': 'تم تحديث الحساب',
  'settings.accounts.duplicate': 'يوجد حساب آخر بهذا الاسم.',
  'settings.provider.bankily': 'بنكيلي',
  'settings.provider.sedad': 'سداد',
  'settings.provider.bim_bank': 'بنك BIM',
  'settings.provider.other': 'أخرى',

  // WhatsApp summaries
  'settings.whatsapp.section': 'ملخّصات واتساب',
  'settings.whatsapp.hint': 'تصلك أنت وحدك. لا يستلمها الموظفون أبدًا.',
  'settings.whatsapp.language': 'لغة الرسالة',
  'settings.whatsapp.amounts': 'إظهار المبالغ',
  'settings.whatsapp.amountsHint': 'عند الإيقاف يصف الملخّص النشاط دون أي أرقام.',
  'settings.whatsapp.daily': 'ملخّص يومي',
  'settings.whatsapp.dailyHint': 'موجز قصير في نهاية كل يوم.',
  'settings.whatsapp.monthly': 'ملخّص شهري',
  'settings.whatsapp.monthlyHint': 'صورة أوضح في نهاية كل شهر.',
  'settings.whatsapp.notYet': 'يُحفظ الآن، ويُرسل عند ربط واتساب.',

  // Security
  'settings.security.section': 'الأمان',
  'settings.security.autoLock': 'قفل التطبيق بعد',
  'settings.security.autoLockHint':
    'أطول مدة مسموح بها. يمكن للموظفين اختيار مدة أقصر، لا أطول.',
  'settings.security.immediate': 'فورًا',
  'settings.security.30s': '٣٠ ثانية',
  'settings.security.1m': 'دقيقة واحدة',
  'settings.security.5m': '٥ دقائق',
  'settings.security.15m': '١٥ دقيقة',

  // ── الفريق (المرحلة ١) ───────────────────────────────────────────────────────
  'team.title': 'الفريق',
  'team.subtitle': 'الأشخاص الذين يمكنهم استخدام تطبيق المتجر.',
  'team.empty': 'لا يوجد أعضاء بعد',
  'team.emptyBody': 'سيظهر هنا كل من تتم دعوته.',
  'team.role.owner': 'المالك',
  'team.role.store_manager': 'مدير',
  'team.role.store_employee': 'موظف',
  'team.role.administrator': 'مشرف',
  'team.branchRole': '{role} · {branch}',
  'team.noBranches': 'بدون فرع بعد',
  'team.contact.none': 'لا يوجد هاتف بعد',
  'team.editTitle': 'تعديل عضو الفريق',
  'team.field.name': 'الاسم',
  'team.field.login': 'اسم المستخدم',
  'team.field.phone': 'الهاتف',
  'team.field.phoneHint': 'صيغة دولية، مثل ‎+2223XXXXXX. تُستخدم لاحقًا لرموز واتساب.',
  'team.field.email': 'البريد الإلكتروني (اختياري)',
  'team.field.emailHint': 'للاسترجاع فقط. يمكن تركه فارغًا.',
  'team.field.active': 'يمكنه استخدام التطبيق',
  'team.field.activeHint': 'أوقفه لمنع هذا الشخص من تسجيل الدخول. يُحتفظ بسجله.',
  'team.detail.lastLogin': 'آخر تسجيل دخول',
  'team.detail.never': 'أبدًا',
  'team.saved': 'تم تحديث عضو الفريق',
  'team.error.phone': 'أدخل الهاتف بصيغة دولية، مثل ‎+2223XXXXXX.',
  'team.error.email': 'هذا لا يبدو كبريد إلكتروني صحيح.',
  'team.error.phoneTaken': 'عضو آخر يستخدم هذا الرقم بالفعل.',
  'team.error.self': 'لا يمكنك إيقاف وصولك الخاص.',
  'team.error.noChanges': 'لم يتغيّر شيء.',

  // Branch price-edit delegation (F1 Stage 2)
  'team.delegation.section': 'تعديل الأسعار',
  'team.delegation.hint': 'اختر الفروع التي يمكن لهذا المدير تغيير أسعار البيع العادية فيها.',
  'team.delegation.allow': 'يمكنه تعديل الأسعار في {branch}',
  'team.delegation.allowHint': 'تغييرات الأسعار العادية فقط.',
  'team.delegation.belowCost': 'البيع بأقل من التكلفة ما زال يحتاج موافقتك — هذا لا يغيّر ذلك.',
  'team.delegation.granted': 'تم تفعيل تعديل الأسعار في {branch}',
  'team.delegation.revoked': 'تم إيقاف تعديل الأسعار في {branch}',
  'team.delegation.confirmOnTitle': 'السماح له بتعديل الأسعار؟',
  'team.delegation.confirmOnBody':
    'سيتمكّن {name} من تغيير أسعار البيع العادية في {branch}. أمّا البيع بأقل من التكلفة فسيظل بحاجة إلى موافقتك.',
  'team.delegation.confirmOffTitle': 'إيقاف تعديل الأسعار؟',
  'team.delegation.confirmOffBody': 'لن يتمكّن {name} بعد الآن من تغيير الأسعار في {branch}.',
  'team.delegation.confirmOn': 'سماح',
  'team.delegation.confirmOff': 'إيقاف',
  'team.delegation.conflict': 'لم يعد هذا ممكنًا — أعد تحميل الفريق وحاول مرة أخرى.',
  'team.delegation.notYet': 'تعديل الأسعار نفسه يأتي مع مرحلة التسعير. هذا يحدّد من سيُسمح له بذلك.',
};
