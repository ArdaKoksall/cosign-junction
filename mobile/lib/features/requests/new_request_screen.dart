import 'dart:convert';
import 'dart:math';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../data/workspace.dart';
import 'request_ui.dart';

class NewRequestScreen extends ConsumerStatefulWidget {
  const NewRequestScreen({super.key, this.products = const []});

  final List<Json> products;

  @override
  ConsumerState<NewRequestScreen> createState() => _NewRequestScreenState();
}

class _NewRequestScreenState extends ConsumerState<NewRequestScreen> {
  final _form = GlobalKey<FormState>();
  final _budget = TextEditingController();
  final _requestKeys = <String, String>{};
  late final List<_ItemInput> _items = widget.products.isEmpty
      ? [_ItemInput()]
      : widget.products.map(_ItemInput.new).toList();
  DateTime? _day;
  TimeOfDay _time = const TimeOfDay(hour: 17, minute: 0);
  String _deliveryMode = 'by';
  bool _preferredBudget = false;
  bool _submitting = false;
  Object? _error;
  String? _deadlineError;

  @override
  void dispose() {
    _budget.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = tz.TZDateTime.now(helsinki);
    final today = DateTime(now.year, now.month, now.day);
    final day = _day;
    final date = await showDatePicker(
      context: context,
      useRootNavigator: false,
      initialDate: day == null || day.isBefore(today) ? today : day,
      firstDate: today,
      lastDate: DateTime(9999, 12, 31),
      currentDate: today,
    );
    if (mounted && date != null) {
      setState(() {
        _day = date;
        _deadlineError = null;
      });
    }
  }

  Future<void> _pickTime() async {
    final time = await showTimePicker(
      context: context,
      useRootNavigator: false,
      initialTime: _time,
    );
    if (mounted && time != null) {
      setState(() {
        _time = time;
        _deadlineError = null;
      });
    }
  }

  Future<void> _submit() async {
    final accountId = ref.read(sessionProvider).value?.accountId;
    if (accountId == null || _submitting) return;
    final invalid = _form.currentState!.validateGranularly();
    if (invalid.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && invalid.first.mounted) {
          Scrollable.ensureVisible(invalid.first.context);
        }
      });
      return;
    }
    final day = _day;
    final deadline = day == null ? null : helsinkiWallTime(day, _time);
    if (day != null && deadline == null) {
      setState(
        () => _deadlineError = copy(
          context,
          'This time is affected by a clock change in Helsinki. Choose another time.',
          'Kellonaika osuu Helsingissä kellojen siirtoon. Valitse toinen aika.',
        ),
      );
      return;
    }
    if (deadline != null &&
        !_deliveryMode.startsWith('preferred_') &&
        !deadline.isAfter(DateTime.now())) {
      setState(
        () => _deadlineError = copy(
          context,
          'Choose a future delivery deadline.',
          'Valitse toimituksen määräaika tulevaisuudesta.',
        ),
      );
      return;
    }
    final budget = _budgetCents(_budget.text);
    final body = <String, dynamic>{
      'items': _items.map((item) => item.toJson()).toList(),
      'budgetCents': ?budget,
      if (budget != null && _preferredBudget) 'budgetMode': 'preferred',
      if (deadline != null) 'deadline': deadline.toIso8601String(),
      if (deadline != null) 'deliveryMode': _deliveryMode,
    };
    // A retry with the same form contents must reuse the same request key.
    final key = _requestKeys.putIfAbsent(jsonEncode(body), () {
      final random = Random.secure();
      return List.generate(
        16,
        (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ).join();
    });
    final api = ref.read(workspaceApiProvider);
    setState(() {
      _submitting = true;
      _error = null;
      _deadlineError = null;
    });
    FocusScope.of(context).unfocus();
    try {
      final run = await api.createRequest({...body, 'idempotencyKey': key});
      if (!mounted || accountId != ref.read(sessionProvider).value?.accountId) {
        return;
      }
      ref.invalidate(runsProvider);
      Navigator.of(context).pop(run);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  int? _budgetCents(String input) {
    final text = input.trim().replaceAll(',', '.');
    if (!RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(text)) return null;
    final value = double.tryParse(text);
    if (value == null || !value.isFinite || value > 1000000) return null;
    return (value * 100).round();
  }

  @override
  Widget build(BuildContext context) {
    final title = copy(context, 'New request', 'Uusi pyyntö');
    final session = ref.watch(sessionProvider).value;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: session == null
          ? Center(
              child: Text(
                copy(
                  context,
                  'Sign in to create a request.',
                  'Luo pyyntö kirjautumalla sisään.',
                ),
              ),
            )
          : SafeArea(
              top: false,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 680),
                  child: Form(
                    key: _form,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            copy(
                              context,
                              'What do you need?',
                              'Mitä tarvitset?',
                            ),
                            style: theme.textTheme.headlineMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            copy(
                              context,
                              'Add up to 10 items for one supplier comparison.',
                              'Lisää enintään 10 tuotetta yhteen toimittajavertailuun.',
                            ),
                          ),
                          const SizedBox(height: 18),
                          for (final (index, item) in _items.indexed) ...[
                            _ItemFields(
                              key: ObjectKey(item),
                              item: item,
                              index: index + 1,
                              enabled: !_submitting,
                              onRemove: _items.length > 1 && !_submitting
                                  ? () {
                                      setState(() => _items.remove(item));
                                      // The old text fields detach on the next build.
                                      WidgetsBinding.instance
                                          .addPostFrameCallback(
                                            (_) => item.dispose(),
                                          );
                                    }
                                  : null,
                            ),
                            const SizedBox(height: 12),
                          ],
                          if (_items.length < 10)
                            Align(
                              alignment: Alignment.centerLeft,
                              child: OutlinedButton.icon(
                                onPressed: _submitting
                                    ? null
                                    : () => setState(
                                        () => _items.add(_ItemInput()),
                                      ),
                                icon: const Icon(Icons.add),
                                label: Text(
                                  copy(context, 'Add item', 'Lisää tuote'),
                                ),
                              ),
                            ),
                          const SizedBox(height: 24),
                          Text(
                            copy(
                              context,
                              'Budget and delivery',
                              'Budjetti ja toimitus',
                            ),
                            style: theme.textTheme.titleLarge,
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            enabled: !_submitting,
                            controller: _budget,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: InputDecoration(
                              labelText: copy(
                                context,
                                'Budget in euros (optional)',
                                'Budjetti euroina (valinnainen)',
                              ),
                              prefixText: '€ ',
                            ),
                            validator: (text) =>
                                (text?.trim().isNotEmpty ?? false) &&
                                    _budgetCents(text!) == null
                                ? copy(
                                    context,
                                    'Enter €0 to €1,000,000 with up to two decimals.',
                                    'Anna 0–1 000 000 € enintään kahdella desimaalilla.',
                                  )
                                : null,
                          ),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              copy(
                                context,
                                'Allow offers over budget',
                                'Salli budjetin ylittävät tarjoukset',
                              ),
                            ),
                            subtitle: Text(
                              copy(
                                context,
                                'Treat the budget as a target.',
                                'Käsittele budjettia tavoitteena.',
                              ),
                            ),
                            value: _preferredBudget,
                            onChanged: _submitting
                                ? null
                                : (value) =>
                                      setState(() => _preferredBudget = value),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              OutlinedButton.icon(
                                onPressed: _submitting ? null : _pickDate,
                                icon: const Icon(
                                  Icons.calendar_today_outlined,
                                  size: 17,
                                ),
                                label: Text(
                                  _day == null
                                      ? copy(
                                          context,
                                          'Add delivery date',
                                          'Lisää toimituspäivä',
                                        )
                                      : calendarDate(context, _day),
                                ),
                              ),
                              if (_day != null) ...[
                                OutlinedButton.icon(
                                  onPressed: _submitting ? null : _pickTime,
                                  icon: const Icon(Icons.schedule, size: 17),
                                  label: Text(
                                    '${_time.format(context)} Helsinki',
                                  ),
                                ),
                                IconButton(
                                  tooltip: copy(
                                    context,
                                    'Clear delivery date',
                                    'Tyhjennä toimituspäivä',
                                  ),
                                  onPressed: _submitting
                                      ? null
                                      : () => setState(() {
                                          _day = null;
                                          _deadlineError = null;
                                        }),
                                  icon: const Icon(Icons.close),
                                ),
                              ],
                            ],
                          ),
                          if (_day != null) ...[
                            const SizedBox(height: 10),
                            DropdownButtonFormField<String>(
                              initialValue: _deliveryMode,
                              isExpanded: true,
                              decoration: InputDecoration(
                                labelText: copy(
                                  context,
                                  'Delivery timing',
                                  'Toimituksen ajankohta',
                                ),
                              ),
                              items: [
                                for (final mode in deliveryModes)
                                  DropdownMenuItem(
                                    value: mode,
                                    child: Text(
                                      deliveryModeLabel(context, mode),
                                    ),
                                  ),
                              ],
                              onChanged: _submitting
                                  ? null
                                  : (value) =>
                                        setState(() => _deliveryMode = value!),
                            ),
                          ],
                          if (_deadlineError case final message?) ...[
                            const SizedBox(height: 8),
                            Text(
                              message,
                              style: TextStyle(color: theme.colorScheme.error),
                            ),
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              errorMessage(
                                context,
                                _error,
                                'Could not create the request.',
                                'Pyyntöä ei voitu luoda.',
                              ),
                              style: TextStyle(color: theme.colorScheme.error),
                            ),
                          ],
                          const SizedBox(height: 24),
                          FilledButton.icon(
                            onPressed: _submitting ? null : _submit,
                            icon: _submitting
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.add_task_outlined),
                            label: Text(
                              _submitting
                                  ? copy(context, 'Creating…', 'Luodaan…')
                                  : copy(
                                      context,
                                      'Create request',
                                      'Luo pyyntö',
                                    ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

class _ItemInput {
  _ItemInput([Json? product])
    : productId = product?['id'] as String?,
      query = TextEditingController(text: product?['name'] as String?),
      quantity = TextEditingController(text: product?['quantity']?.toString()),
      unit = product == null ? 'kg' : 'sales_unit';

  final String? productId;
  final TextEditingController query;
  final TextEditingController quantity;
  final requirements = <String>{};
  final allergens = <String>{};
  String unit;

  double? get amount =>
      double.tryParse(quantity.text.trim().replaceAll(',', '.'));

  Json toJson() => {
    if (productId == null) 'query': query.text.trim(),
    if (productId != null) 'productId': productId,
    'quantity': amount!,
    'unit': unit,
    if (requirements.isNotEmpty) 'requirements': requirements.toList()..sort(),
    if (allergens.isNotEmpty) 'freeFromAllergen': allergens.toList()..sort(),
  };

  void dispose() {
    query.dispose();
    quantity.dispose();
  }
}

class _ItemFields extends StatefulWidget {
  const _ItemFields({
    super.key,
    required this.item,
    required this.index,
    required this.enabled,
    this.onRemove,
  });

  final _ItemInput item;
  final int index;
  final bool enabled;
  final VoidCallback? onRemove;

  @override
  State<_ItemFields> createState() => _ItemFieldsState();
}

class _ItemFieldsState extends State<_ItemFields> {
  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  copy(
                    context,
                    'Item ${widget.index}',
                    'Tuote ${widget.index}',
                  ),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              if (widget.onRemove != null)
                IconButton(
                  tooltip: copy(
                    context,
                    'Remove item ${widget.index}',
                    'Poista tuote ${widget.index}',
                  ),
                  onPressed: widget.onRemove,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
            ],
          ),
          const SizedBox(height: 8),
          TextFormField(
            enabled: widget.enabled,
            readOnly: item.productId != null,
            controller: item.query,
            maxLength: item.productId == null ? 120 : null,
            decoration: InputDecoration(
              labelText: copy(context, 'Product name', 'Tuotenimi'),
            ),
            validator: (text) =>
                item.productId == null && (text?.trim().isEmpty ?? true)
                ? copy(context, 'Enter a product name.', 'Anna tuotenimi.')
                : null,
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextFormField(
                  enabled: widget.enabled,
                  controller: item.quantity,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: copy(context, 'Quantity', 'Määrä'),
                    errorMaxLines: 2,
                  ),
                  validator: (_) {
                    final amount = item.amount;
                    return amount == null ||
                            !amount.isFinite ||
                            amount <= 0 ||
                            amount > 1000000
                        ? copy(
                            context,
                            'Enter a positive quantity up to 1,000,000.',
                            'Anna positiivinen määrä, enintään 1 000 000.',
                          )
                        : null;
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: item.unit,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: copy(context, 'Unit', 'Yksikkö'),
                  ),
                  items: [
                    for (final unit in [
                      ...requestUnits,
                      if (item.productId != null) 'sales_unit',
                    ])
                      DropdownMenuItem(
                        value: unit,
                        child: Text(
                          unitLabel(context, unit),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: widget.enabled
                      ? (value) => setState(() => item.unit = value!)
                      : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(
              copy(
                context,
                'Dietary and allergen requirements',
                'Ruokavalio- ja allergeenivaatimukset',
              ),
            ),
            children: [
              _RequirementChips(
                options: dietaryOptions,
                selected: item.requirements,
                enabled: widget.enabled,
              ),
              const SizedBox(height: 10),
              Text(
                copy(
                  context,
                  'Require products free from',
                  'Vaadi tuotteita, joissa ei ole seuraavia',
                ),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 6),
              _RequirementChips(
                options: allergenOptions,
                selected: item.allergens,
                enabled: widget.enabled,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RequirementChips extends StatefulWidget {
  const _RequirementChips({
    required this.options,
    required this.selected,
    required this.enabled,
  });

  final Map<String, (String, String)> options;
  final Set<String> selected;
  final bool enabled;

  @override
  State<_RequirementChips> createState() => _RequirementChipsState();
}

class _RequirementChipsState extends State<_RequirementChips> {
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 4,
    children: [
      for (final entry in widget.options.entries)
        FilterChip(
          label: Text(copy(context, entry.value.$1, entry.value.$2)),
          selected: widget.selected.contains(entry.key),
          onSelected: widget.enabled
              ? (selected) => setState(() {
                  if (selected) {
                    widget.selected.add(entry.key);
                  } else {
                    widget.selected.remove(entry.key);
                  }
                })
              : null,
        ),
    ],
  );
}
