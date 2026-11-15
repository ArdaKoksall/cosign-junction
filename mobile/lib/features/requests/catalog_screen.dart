import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../data/workspace.dart';
import 'new_request_screen.dart';
import 'request_ui.dart';
import 'run_detail_screen.dart';

const _pageSize = 12;
const _categories = [
  ('', 'All products', 'Kaikki tuotteet'),
  ('milk', 'Milk', 'Maito'),
  ('tomato', 'Tomatoes', 'Tomaatit'),
  ('bread', 'Bread', 'Leipä'),
  ('rice', 'Rice', 'Riisi'),
  ('juice', 'Juice', 'Mehu'),
];

class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key, this.initialQuery, this.onAssistant});

  final String? initialQuery;
  final ValueChanged<String>? onAssistant;

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  late final _searchInput = TextEditingController(text: widget.initialQuery);
  String _query = '';
  int _page = 0;
  int _lookup = 0;
  List<Json> _products = [];
  bool _loading = true;
  bool _hasMore = false;
  bool _adding = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load(query: _searchInput.text);
    });
  }

  @override
  void didUpdateWidget(covariant CatalogScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final newQuery = widget.initialQuery;
    if (newQuery != null && newQuery != oldWidget.initialQuery) {
      _searchInput.text = newQuery;
      _load(query: newQuery);
    }
  }

  @override
  void dispose() {
    _searchInput.dispose();
    super.dispose();
  }

  Future<void> _load({String? query, int page = 0}) async {
    final request = ++_lookup;
    final search = (query ?? _query).trim();
    setState(() {
      _query = search;
      _page = page;
      _error = null;
      _loading = true;
      _products = [];
    });
    try {
      final result = await ref
          .read(workspaceApiProvider)
          .browseCatalog(search, limit: _pageSize, offset: page * _pageSize);
      if (mounted && request == _lookup) {
        setState(() {
          _products = objects(result['products']);
          _hasMore = result['hasMore'] == true;
        });
      }
    } catch (error) {
      if (mounted && request == _lookup) setState(() => _error = error);
    } finally {
      if (mounted && request == _lookup) setState(() => _loading = false);
    }
  }

  void _search(String value) {
    _searchInput.text = value;
    FocusScope.of(context).unfocus();
    _load(query: value);
  }

  Future<void> _add(Json product) async {
    final basket = ref.read(basketProvider).value;
    if (_adding || basket == null) return;
    final quantity = _quantityOf(basket, product);
    if (quantity == 0 && basket.length >= 10) {
      _notice(
        copy(
          context,
          'Your basket holds up to 10 products. Remove a product to add another.',
          'Ostoskorissa voi olla enintään 10 tuotetta. Poista tuote lisätäksesi uuden.',
        ),
      );
      return;
    }
    setState(() => _adding = true);
    try {
      await ref
          .read(basketProvider.notifier)
          .setQuantity(product, quantity + 1);
      if (mounted) {
        _notice(copy(context, 'Added to your basket', 'Lisätty ostoskoriin'));
      }
    } catch (error) {
      if (mounted) {
        _notice(
          errorMessage(
            context,
            error,
            'Could not update your basket.',
            'Ostoskoria ei voitu päivittää.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  void _notice(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(content: Text(text), duration: const Duration(seconds: 2)),
    );

  @override
  Widget build(BuildContext context) {
    final basket = ref.watch(basketProvider);
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: () => _load(page: _page),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 26),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Text(
            copy(context, 'Browse products', 'Selaa tuotteita'),
            style: theme.textTheme.headlineLarge,
          ),
          const SizedBox(height: 10),
          Text(
            copy(
              context,
              'Search the Valio Aimo catalog.',
              'Hae tuotteita Valio Aimon valikoimasta.',
            ),
          ),
          const SizedBox(height: 15),
          TextField(
            controller: _searchInput,
            maxLength: 120,
            textInputAction: TextInputAction.search,
            onSubmitted: _search,
            decoration: InputDecoration(
              labelText: copy(context, 'Search products', 'Hae tuotteita'),
              counterText: '',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                onPressed: () => _search(_searchInput.text),
                icon: const Icon(Icons.arrow_forward),
                tooltip: copy(
                  context,
                  'Run catalog search',
                  'Hae valikoimasta',
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 52,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _categories.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, index) {
                final (query, en, fi) = _categories[index];
                return Center(
                  child: ChoiceChip(
                    label: Text(copy(context, en, fi)),
                    selected: _query == query,
                    onSelected: (_) => _search(query),
                  ),
                );
              },
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: _adding
                  ? null
                  : () => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) =>
                            _BasketScreen(onAssistant: widget.onAssistant),
                      ),
                    ),
              icon: const Icon(Icons.shopping_basket_outlined),
              label: Text(
                copy(context, 'Your basket', 'Ostoskorisi') +
                    (basket.value?.isNotEmpty == true
                        ? ' (${basket.value!.length})'
                        : ''),
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_error != null)
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    errorMessage(
                      context,
                      _error,
                      'Could not load the catalog.',
                      'Tuotevalikoimaa ei voitu ladata.',
                    ),
                  ),
                  TextButton(
                    onPressed: () => _load(page: _page),
                    child: Text(copy(context, 'Retry', 'Yritä uudelleen')),
                  ),
                ],
              ),
            )
          else if (_products.isEmpty)
            Panel(
              child: Text(
                copy(
                  context,
                  'No matching products. Try another search.',
                  'Sopivia tuotteita ei löytynyt. Kokeile toista hakua.',
                ),
              ),
            )
          else
            for (final product in _products) ...[
              _CatalogRow(
                product: product,
                onAdd: _adding || basket.value == null
                    ? null
                    : () => _add(product),
                onOpen: () => Navigator.of(context).push<void>(
                  MaterialPageRoute(
                    builder: (_) => _ProductScreen(product: product),
                  ),
                ),
              ),
              const SizedBox(height: 9),
            ],
          if (!_loading && (_page > 0 || (_error == null && _hasMore))) ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton.outlined(
                  onPressed: _page > 0 ? () => _load(page: _page - 1) : null,
                  icon: const Icon(Icons.chevron_left),
                  tooltip: copy(context, 'Previous page', 'Edellinen sivu'),
                ),
                Text(copy(context, 'Page ${_page + 1}', 'Sivu ${_page + 1}')),
                IconButton.outlined(
                  onPressed: _hasMore && _error == null
                      ? () => _load(page: _page + 1)
                      : null,
                  icon: const Icon(Icons.chevron_right),
                  tooltip: copy(context, 'Next page', 'Seuraava sivu'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

int _quantityOf(List<Json> basket, Json product) {
  for (final row in basket) {
    if (row['id'] == product['id']) return row['quantity'] as int;
  }
  return 0;
}

class _CatalogRow extends StatelessWidget {
  const _CatalogRow({
    required this.product,
    required this.onAdd,
    required this.onOpen,
  });

  final Json product;
  final VoidCallback? onAdd;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = nonempty(product['name']) ?? '${product['id']}';
    return Panel(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(
            child: Material(
              type: MaterialType.transparency,
              child: InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: onOpen,
                child: Row(
                  children: [
                    ProductPhoto(nonempty(product['imageUrl']), size: 65),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (nonempty(product['brand']) case final brand?)
                            Text(
                              brand,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          Text(name, style: theme.textTheme.titleSmall),
                          if (nonempty(product['salesUnit']) case final unit?)
                            Text(unit, style: theme.textTheme.bodySmall),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            onPressed: onAdd,
            icon: const Icon(Icons.add_shopping_cart_outlined, size: 20),
            color: theme.colorScheme.primary,
            tooltip: copy(context, 'Add $name to basket', 'Lisää koriin $name'),
          ),
        ],
      ),
    );
  }
}

class _BasketScreen extends ConsumerStatefulWidget {
  const _BasketScreen({this.onAssistant});

  final ValueChanged<String>? onAssistant;

  @override
  ConsumerState<_BasketScreen> createState() => _BasketScreenState();
}

class _BasketScreenState extends ConsumerState<_BasketScreen> {
  bool _saving = false;
  Object? _error;

  Future<void> _change(Json product, int quantity) async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(basketProvider.notifier).setQuantity(product, quantity);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _create(List<Json> products) async {
    final run = await Navigator.of(context).push<Json>(
      MaterialPageRoute(builder: (_) => NewRequestScreen(products: products)),
    );
    if (!mounted || run == null) return;
    final id = nonempty(run['id']) ?? nonempty(run['runId']);
    if (id != null) {
      Navigator.of(context).pushReplacement<void, void>(
        MaterialPageRoute(
          builder: (_) => RunDetailScreen(runId: id, snapshot: run),
        ),
      );
    }
  }

  void _askAssistant(List<Json> products) {
    final items = [
      for (final product in products)
        {
          'productId': product['id'],
          'quantity': product['quantity'],
          'unit': 'sales_unit',
        },
    ];
    final instruction = copy(
      context,
      'Prepare a purchase draft for review using these exact products and quantities. Check the next available offers, pack quantities, prices, and stock.',
      'Valmistele tilausluonnos tarkistettavaksi näillä tuotteilla ja määrillä. Tarkista seuraavat saatavilla olevat tarjoukset, pakkausmäärät, hinnat ja varastosaldot.',
    );
    final prompt = '$instruction\n\n${jsonEncode({'items': items})}';
    final openAssistant = widget.onAssistant;
    Navigator.of(context).pop();
    openAssistant?.call(prompt);
  }

  @override
  Widget build(BuildContext context) {
    final basket = ref.watch(basketProvider);
    final assistantAvailable =
        ref.watch(sessionProvider).value?.nemotronModel != null;
    final rows = basket.value ?? <Json>[];
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(copy(context, 'Your basket', 'Ostoskorisi'))),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
              children: [
                if (basket.isLoading)
                  const LinearProgressIndicator()
                else if (basket.hasError)
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          errorMessage(
                            context,
                            basket.error,
                            'Could not load your basket.',
                            'Ostoskoria ei voitu ladata.',
                          ),
                        ),
                        TextButton(
                          onPressed: () => ref.invalidate(basketProvider),
                          child: Text(
                            copy(context, 'Retry', 'Yritä uudelleen'),
                          ),
                        ),
                      ],
                    ),
                  )
                else if (rows.isEmpty)
                  Panel(
                    child: Text(
                      copy(
                        context,
                        'Your basket is empty. Add products from the catalog.',
                        'Ostoskorisi on tyhjä. Lisää tuotteita valikoimasta.',
                      ),
                    ),
                  )
                else ...[
                  Text(
                    copy(
                      context,
                      'Quantities are in supplier sales units.',
                      'Määrät ovat toimittajan myyntiyksikköinä.',
                    ),
                  ),
                  const SizedBox(height: 13),
                  for (final product in rows) ...[
                    Panel(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ProductPhoto(nonempty(product['imageUrl']), size: 55),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  nonempty(product['name']) ??
                                      '${product['id']}',
                                  style: theme.textTheme.titleMedium,
                                ),
                                if (nonempty(product['salesUnit'])
                                    case final unit?)
                                  Text(unit),
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      onPressed: _saving
                                          ? null
                                          : () => _change(
                                              product,
                                              (product['quantity'] as int) - 1,
                                            ),
                                      icon: const Icon(Icons.remove),
                                      tooltip: copy(
                                        context,
                                        'Remove one',
                                        'Vähennä yksi',
                                      ),
                                    ),
                                    Text(
                                      number(
                                        context,
                                        product['quantity'] as int?,
                                      ),
                                    ),
                                    IconButton(
                                      onPressed:
                                          _saving ||
                                              (product['quantity'] as int) >=
                                                  1000000
                                          ? null
                                          : () => _change(
                                              product,
                                              (product['quantity'] as int) + 1,
                                            ),
                                      icon: const Icon(Icons.add),
                                      tooltip: copy(
                                        context,
                                        'Add one',
                                        'Lisää yksi',
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 9),
                  ],
                  if (_error != null)
                    Text(
                      errorMessage(
                        context,
                        _error,
                        'Could not update your basket.',
                        'Ostoskoria ei voitu päivittää.',
                      ),
                    ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _saving ? null : () => _create(rows),
                    icon: const Icon(Icons.receipt_long_outlined),
                    label: Text(
                      copy(
                        context,
                        'Create request from basket',
                        'Luo pyyntö ostoskorista',
                      ),
                    ),
                  ),
                  if (widget.onAssistant != null && assistantAvailable) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _saving ? null : () => _askAssistant(rows),
                      icon: const Icon(Icons.chat_bubble_outline, size: 18),
                      label: Text(
                        copy(
                          context,
                          'Prepare with assistant',
                          'Valmistele avustajan kanssa',
                        ),
                      ),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

final _productDetails = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) => ref.watch(workspaceApiProvider).getProductDetails(id),
  retry: (_, _) => null,
);

class _ProductScreen extends ConsumerWidget {
  const _ProductScreen({required this.product});

  final Json product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = product['id'] as String;
    final details = ref.watch(_productDetails(id));
    final record = object(details.value?['product']);
    final more = object(record?['details']);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(copy(context, 'Product details', 'Tuotetiedot')),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 13, 20, 28),
          children: [
            Center(
              child: ProductPhoto(nonempty(product['imageUrl']), size: 178),
            ),
            const SizedBox(height: 18),
            Text(
              nonempty(product['name']) ?? id,
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: 7),
            if (nonempty(product['brand']) case final brand?) Text(brand),
            Text(copy(context, 'Product ID $id', 'Tuotetunnus $id')),
            if (nonempty(product['salesUnit']) case final unit?)
              Text('${copy(context, 'Sales unit', 'Myyntiyksikkö')} · $unit'),
            if (record?['minSellUnits'] case final num min)
              Text(
                '${copy(context, 'Minimum sales units', 'Myyntiyksiköiden vähimmäismäärä')} · ${number(context, min)}',
              ),
            if (record?['sellUnitIncrement'] case final num step)
              Text(
                '${copy(context, 'Sales unit increment', 'Myyntierän askel')} · ${number(context, step)}',
              ),
            if (nonempty(more?['countryOfOrigin']) case final origin?)
              Text('${copy(context, 'Origin', 'Alkuperä')} · $origin'),
            const SizedBox(height: 14),
            Text(
              copy(
                context,
                'Check prices and stock from a purchase request.',
                'Tarkista hinnat ja varastosaldo hankintapyynnöstä.',
              ),
            ),
            if (details.isLoading) const LinearProgressIndicator(),
            if (details.hasError) ...[
              const SizedBox(height: 14),
              Text(
                errorMessage(
                  context,
                  details.error,
                  'Could not load the product evidence.',
                  'Tuotetietoja ei voitu ladata.',
                ),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => ref.invalidate(_productDetails(id)),
                  child: Text(copy(context, 'Retry', 'Yritä uudelleen')),
                ),
              ),
            ],
            if (record != null) ...[
              const SizedBox(height: 18),
              _CatalogTextBlock(
                title: copy(context, 'Ingredients', 'Ainesosat'),
                content: _localizedText(context, more?['ingredients']),
              ),
              const SizedBox(height: 9),
              _CatalogTextBlock(
                title: copy(context, 'Storage instructions', 'Säilytysohjeet'),
                content: _localizedText(context, more?['storageInstructions']),
              ),
              const SizedBox(height: 9),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      copy(
                        context,
                        'Allergen declarations',
                        'Allergeenitiedot',
                      ),
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 7),
                    if (objects(record['allergens']).isEmpty)
                      Text(
                        copy(
                          context,
                          'No allergen declarations available.',
                          'Allergeenitietoja ei ole saatavilla.',
                        ),
                      ),
                    for (final allergen in objects(record['allergens']))
                      Text(
                        '${_allergenName(context, allergen)} · ${_evidenceLabel(context, allergen['status'])}',
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CatalogTextBlock extends StatelessWidget {
  const _CatalogTextBlock({required this.title, required this.content});

  final String title;
  final String? content;

  @override
  Widget build(BuildContext context) => Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 7),
        Text(
          content ??
              copy(context, 'No data available.', 'Tietoa ei ole saatavilla.'),
        ),
      ],
    ),
  );
}

String? _localizedText(BuildContext context, Object? value) {
  final items = objects(value);
  final locale = Localizations.localeOf(context).languageCode;
  for (final item in items) {
    if ((item['language'] as String?)?.toLowerCase().startsWith(locale) ==
        true) {
      if (nonempty(item['value']) case final text?) return text;
    }
  }
  return items.isEmpty ? null : nonempty(items.first['value']);
}

String _allergenName(BuildContext context, Json allergen) {
  final id = nonempty(allergen['id']) ?? '';
  final label = allergenOptions[id];
  return label == null ? id : copy(context, label.$1, label.$2);
}

String _evidenceLabel(BuildContext context, Object? status) => switch (status) {
  'DECLARED_PRESENT' => copy(context, 'Contains', 'Sisältää'),
  'MAY_CONTAIN' => copy(context, 'May contain', 'Saattaa sisältää'),
  'VERIFIED_ABSENT' => copy(
    context,
    'Declared free from',
    'Ilmoitettu allergeenittomaksi',
  ),
  _ => copy(context, 'Unverified', 'Vahvistamaton'),
};
