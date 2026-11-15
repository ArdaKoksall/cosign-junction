import 'package:material_ui/material_ui.dart';
import 'package:intl/intl.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../../data/workspace.dart';

String copy(BuildContext context, String en, String fi) =>
    Localizations.localeOf(context).languageCode == 'fi' ? fi : en;

String language(BuildContext context) => copy(context, 'en_GB', 'fi_FI');

Json? object(Object? value) => value is Json ? value : null;
List<Json> objects(Object? value) =>
    value is List ? value.whereType<Json>().toList() : [];
List<String> strings(Object? value) =>
    value is List ? value.whereType<String>().toList() : [];
String? nonempty(Object? value) =>
    value is String && value.isNotEmpty ? value : null;

String euros(BuildContext context, num cents) => NumberFormat.currency(
  locale: language(context),
  symbol: '€',
).format(cents / 100);

String number(BuildContext context, num? value) => value == null
    ? '—'
    : NumberFormat.decimalPattern(language(context)).format(value);

final helsinki = (() {
  tz_data.initializeTimeZones();
  return tz.getLocation('Europe/Helsinki');
})();

DateTime? helsinkiWallTime(DateTime day, TimeOfDay time) {
  final naive = DateTime.utc(
    day.year,
    day.month,
    day.day,
    time.hour,
    time.minute,
  );
  const oneDay = Duration(days: 1);
  final candidates = <DateTime>{};
  for (final sample in [naive.subtract(oneDay), naive.add(oneDay)]) {
    final local = tz.TZDateTime.from(sample, helsinki);
    final candidate = naive.subtract(local.timeZoneOffset);
    final resolved = tz.TZDateTime.from(candidate, helsinki);
    if (resolved.year == day.year &&
        resolved.month == day.month &&
        resolved.day == day.day &&
        resolved.hour == time.hour &&
        resolved.minute == time.minute) {
      candidates.add(candidate);
    }
  }
  return candidates.length == 1 ? candidates.single : null;
}

String instant(
  BuildContext context,
  Object? value, {
  bool includeTime = false,
}) {
  final date = DateTime.tryParse(value?.toString() ?? '');
  if (date == null) return '—';
  final local = tz.TZDateTime.from(date, helsinki);
  final format = MaterialLocalizations.of(context);
  final day = format.formatShortDate(local);
  return includeTime
      ? '$day ${format.formatTimeOfDay(TimeOfDay.fromDateTime(local), alwaysUse24HourFormat: true)} Helsinki'
      : day;
}

String calendarDate(BuildContext context, Object? value) {
  final date = DateTime.tryParse(value?.toString() ?? '');
  return date == null
      ? '—'
      : MaterialLocalizations.of(context).formatShortDate(date);
}

const requestUnits = ['kg', 'g', 'L', 'ml', 'each', 'case'];

String unitLabel(BuildContext context, String unit) => switch (unit) {
  'each' => copy(context, 'pcs', 'kpl'),
  'case' => copy(context, 'cases', 'laatikkoa'),
  'sales_unit' => copy(context, 'sales units', 'myyntiyksikköä'),
  _ => unit,
};

String itemLabel(BuildContext context, Json item) {
  final quantity = item['quantity'];
  final query = nonempty(item['query']) ?? nonempty(item['productId']) ?? '';
  final unit = item['unit'];
  return quantity is num && unit is String
      ? '${number(context, quantity)} ${unitLabel(context, unit)} $query'
      : query;
}

const dietaryOptions = {
  'lactose-free': ('Lactose-free', 'Laktoositon'),
  'gluten-free': ('Gluten-free', 'Gluteeniton'),
  'vegan': ('Vegan', 'Vegaaninen'),
  'vegetarian': ('Vegetarian', 'Kasvisruokavalioon sopiva'),
  'no-added-sugar': ('No added sugar', 'Ei lisättyä sokeria'),
  'high-protein': ('High protein', 'Runsaasti proteiinia'),
};

const allergenOptions = {
  'AW': ('Gluten-containing cereals', 'Gluteenia sisältävät viljat'),
  'AC': ('Crustaceans', 'Äyriäiset'),
  'AE': ('Eggs', 'Kananmunat'),
  'AF': ('Fish', 'Kala'),
  'AP': ('Peanuts', 'Maapähkinät'),
  'AY': ('Soybeans', 'Soijapavut'),
  'AM': ('Milk', 'Maito'),
  'AN': ('Tree nuts', 'Pähkinät'),
  'BC': ('Celery', 'Selleri'),
  'BM': ('Mustard', 'Sinappi'),
  'AS': ('Sesame', 'Seesaminsiemenet'),
  'AU': ('Sulphites', 'Sulfiitit'),
  'NL': ('Lupin', 'Lupiini'),
  'UM': ('Molluscs', 'Nilviäiset'),
};

String statusLabel(BuildContext context, Object? value) => switch (value) {
  'active' => copy(context, 'In progress', 'Käsittelyssä'),
  'approved' => copy(context, 'Approved', 'Hyväksytty'),
  'awaiting_approval' => copy(context, 'Needs approval', 'Odottaa hyväksyntää'),
  'cancelled' => copy(context, 'Cancelled', 'Peruttu'),
  'completed' => copy(context, 'Completed', 'Valmis'),
  'failed' => copy(context, 'Failed', 'Epäonnistui'),
  'needs_attention' => copy(context, 'Needs attention', 'Vaatii huomiota'),
  'queued' => copy(context, 'Queued', 'Jonossa'),
  'ready' => copy(context, 'Draft ready', 'Luonnos valmis'),
  'rejected' => copy(context, 'Declined', 'Hylätty'),
  'running' => copy(context, 'Running', 'Käsittelyssä'),
  _ => value?.toString().replaceAll('_', ' ') ?? '—',
};

String deliveryModeLabel(BuildContext context, String mode) => switch (mode) {
  'on' => copy(context, 'Requested for', 'Pyydetty toimituspäivä'),
  'preferred_by' => copy(context, 'Preferred by', 'Toivottu viimeistään'),
  'preferred_on' => copy(context, 'Preferred for', 'Toivottu toimituspäivä'),
  _ => copy(context, 'Needed by', 'Tarvitaan viimeistään'),
};

const deliveryModes = ['by', 'on', 'preferred_by', 'preferred_on'];

String sourceLabel(BuildContext context, Object? source) => switch (source) {
  'nemotron' => copy(context, 'Cosign assistant', 'Cosign-avustaja'),
  'web' => copy(context, 'Buyer request', 'Ostajan pyyntö'),
  _ => copy(context, 'Connected agent', 'Yhdistetty avustaja'),
};

String errorMessage(BuildContext context, Object? error, String en, String fi) {
  if (error is ApiException) {
    final message = switch (error.code) {
      'past_deadline' => copy(
        context,
        'The delivery deadline has passed.',
        'Toimituksen määräaika on umpeutunut.',
      ),
      'policy_changed' || 'stale_evidence' => copy(
        context,
        'Refresh prices and availability before continuing.',
        'Päivitä hinnat ja saatavuus ennen jatkamista.',
      ),
      'stale_revision' => copy(
        context,
        'This request changed. Review the latest version and try again.',
        'Pyyntö on muuttunut. Tarkista uusin versio ja yritä uudelleen.',
      ),
      'supplier_lookup_failed' => copy(
        context,
        'The supplier lookup failed. Try refreshing prices and availability.',
        'Toimittajan tietojen haku epäonnistui. Yritä päivittää hinnat ja saatavuus.',
      ),
      'over_budget' => copy(
        context,
        'The selected products exceed the order budget.',
        'Valitut tuotteet ylittävät tilauksen budjetin.',
      ),
      'insufficient_combined_stock' => copy(
        context,
        'Reported stock cannot cover all selected items.',
        'Ilmoitettu varasto ei kata kaikkia valittuja tuotteita.',
      ),
      'order_rehearsal_unavailable' => copy(
        context,
        'Rehearsal is disabled for this workspace.',
        'Harjoitustila ei ole käytössä tässä työtilassa.',
      ),
      _ => error.message,
    };
    return message.isEmpty ? copy(context, en, fi) : message;
  }
  return copy(context, en, fi);
}

class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.selected = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: selected ? colors.surfaceContainer : colors.surface,
      animationDuration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 220),
      shape: RoundedRectangleBorder(
        side: BorderSide(
          color: selected ? colors.primary : colors.outlineVariant,
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});

  final Object? status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final (background, foreground) = switch (status) {
      'failed' ||
      'rejected' => (colors.errorContainer, colors.onErrorContainer),
      'awaiting_approval' || 'needs_attention' => (
        colors.tertiaryContainer,
        colors.onTertiaryContainer,
      ),
      _ => (colors.secondaryContainer, colors.onSecondaryContainer),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 9),
        child: Text(
          statusLabel(context, status),
          style: theme.textTheme.labelMedium?.copyWith(color: foreground),
        ),
      ),
    );
  }
}

class ProductPhoto extends StatelessWidget {
  const ProductPhoto(this.url, {super.key, this.size = 56});

  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final fallback = Center(
      child: Icon(Icons.inventory_2_outlined, color: colors.onSurfaceVariant),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: ColoredBox(
        color: colors.surfaceContainerHighest,
        child: SizedBox(
          width: size,
          height: size,
          child: url?.startsWith('https://') == true
              ? Image.network(
                  url!,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => fallback,
                )
              : fallback,
        ),
      ),
    );
  }
}
