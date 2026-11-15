import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../data/workspace.dart';
import '../../ui/brand.dart';
import '../onboarding/profile.dart';

final recommendedProductsProvider = FutureProvider.autoDispose
    .family<List<Json>, String>((ref, query) async {
      final api = ref.watch(workspaceApiProvider);
      final response = await api.browseCatalog(query, limit: 3);
      return jsonRows(response['products']);
    }, retry: (_, _) => null);

class OverviewScreen extends ConsumerWidget {
  const OverviewScreen({
    super.key,
    required this.onSearch,
    required this.onAssistant,
    required this.onRequest,
    required this.onCreateRequest,
    required this.onRequests,
    required this.onActivity,
    required this.onSettings,
  });

  final ValueChanged<String> onSearch;
  final ValueChanged<String> onAssistant;
  final ValueChanged<String> onRequest;
  final VoidCallback onCreateRequest;
  final VoidCallback onRequests;
  final VoidCallback onActivity;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runs = ref.watch(runsProvider);
    final rows = runs.value?.rows ?? const <Json>[];
    final pending = rows
        .where((row) => row['status'] == 'awaiting_approval')
        .toList();
    final profile = ref.watch(profileProvider).value;
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () async {
        try {
          ref.invalidate(runsProvider);
          await ref.read(runsProvider.future);
        } catch (_) {
          // The overview renders the load error and a retry action.
        }
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          _OverviewHero(onCreateRequest: onCreateRequest),
          const SizedBox(height: 16),
          _SectionHeader(
            title: context.t('Needs your attention', 'Odottaa päätöstäsi'),
            action: rows.isEmpty ? null : onRequests,
            actionLabel: context.t('Requests', 'Pyynnöt'),
          ),
          const SizedBox(height: 10),
          if (runs.hasError && !runs.hasValue)
            WorkspacePanel(
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      context.t(
                        'Could not load requests.',
                        'Pyyntöjä ei voitu ladata.',
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => ref.invalidate(runsProvider),
                    child: Text(context.t('Retry', 'Yritä uudelleen')),
                  ),
                ],
              ),
            )
          else if (!runs.hasValue)
            const LinearProgressIndicator()
          else ...[
            if (runs.value!.isCached)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  context.t(
                    'Showing last saved requests.',
                    'Näytetään viimeksi tallennetut pyynnöt.',
                  ),
                  style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            if (pending.isEmpty)
              WorkspacePanel(
                child: Row(
                  children: [
                    _SoftIcon(icon: Icons.check_circle_outline),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            context.t(
                              'You’re all caught up',
                              'Ei odottavia pyyntöjä',
                            ),
                            style: theme.textTheme.titleMedium,
                          ),
                          Text(
                            context.t(
                              'Purchase requests that need your decision appear here.',
                              'Tässä näkyvät päätöstäsi odottavat hankintapyynnöt.',
                            ),
                            style: TextStyle(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              )
            else
              for (final row in pending.take(3))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _RunTile(row: row, onOpen: onRequest),
                ),
          ],
          const SizedBox(height: 20),
          TextField(
            key: const ValueKey('overview-catalog-search'),
            onSubmitted: (query) {
              if (query.trim().isNotEmpty) onSearch(query.trim());
            },
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: context.t(
                'Search products for your kitchen',
                'Hae tuotteita keittiöösi',
              ),
            ),
          ),
          if (profile != null && profile.answers.isNotEmpty) ...[
            const SizedBox(height: 24),
            _Recommendations(
              profile: profile,
              onSearch: onSearch,
              onAssistant: onAssistant,
            ),
          ],
          if (rows.isNotEmpty) ...[
            const SizedBox(height: 24),
            _SectionHeader(
              title: context.t('Recent requests', 'Viimeisimmät pyynnöt'),
              action: onRequests,
              actionLabel: context.t('View all', 'Näytä kaikki'),
            ),
            const SizedBox(height: 10),
            for (final row in rows.take(3))
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _RunTile(row: row, onOpen: onRequest),
              ),
          ],
          const SizedBox(height: 24),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: _SoftIcon(icon: Icons.bolt_outlined),
                  title: Text(
                    context.t('Live activity', 'Reaaliaikainen toiminta'),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: onActivity,
                ),
                const Divider(indent: 16, endIndent: 16),
                ListTile(
                  leading: _SoftIcon(icon: Icons.link_outlined),
                  title: Text(context.t('MCP connections', 'MCP-yhteydet')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: onSettings,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OverviewHero extends StatelessWidget {
  const _OverviewHero({required this.onCreateRequest});

  final VoidCallback onCreateRequest;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: ColoredBox(
        color: heroColor(context),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final copy = Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    context.t(
                      'Purchasing overview',
                      'Hankintojen yleiskatsaus',
                    ),
                    style: theme.textTheme.headlineLarge?.copyWith(
                      color: onHero,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    context.t(
                      'Compare prices and delivery for your next kitchen order.',
                      'Vertaile keittiösi seuraavan tilauksen hintoja ja toimituksia.',
                    ),
                    style: TextStyle(color: heroMuted(context)),
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: highlight,
                      foregroundColor: onHighlight,
                    ),
                    onPressed: onCreateRequest,
                    icon: const Icon(Icons.add, size: 19),
                    label: Text(context.t('New request', 'Uusi pyyntö')),
                  ),
                ],
              ),
            );
            final photo = Image.asset(
              'assets/brand/kitchen-delivery.jpg',
              fit: BoxFit.cover,
              alignment: Alignment.center,
              excludeFromSemantics: true,
            );
            if (constraints.maxWidth > 640) {
              return Row(
                children: [
                  Expanded(flex: 5, child: copy),
                  Expanded(flex: 4, child: SizedBox(height: 280, child: photo)),
                ],
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                copy,
                SizedBox(height: 106, child: photo),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.action, this.actionLabel});

  final String title;
  final VoidCallback? action;
  final String? actionLabel;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(title, style: Theme.of(context).textTheme.headlineSmall),
      ),
      if (action != null)
        TextButton(onPressed: action, child: Text(actionLabel!)),
    ],
  );
}

class _SoftIcon extends StatelessWidget {
  const _SoftIcon({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      height: 39,
      width: 39,
      decoration: BoxDecoration(
        color: colors.primaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(icon, size: 20, color: colors.onPrimaryContainer),
    );
  }
}

class _Recommendations extends ConsumerWidget {
  const _Recommendations({
    required this.profile,
    required this.onSearch,
    required this.onAssistant,
  });

  final PurchasingProfile profile;
  final ValueChanged<String> onSearch;
  final ValueChanged<String> onAssistant;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final suggestion = profile.catalogSuggestions;
    final theme = Theme.of(context);
    final query = suggestion.firstOrNull?.query;
    final products = query == null
        ? const <Json>[]
        : ref.watch(recommendedProductsProvider(query)).value ?? const <Json>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionHeader(
          title: context.t(
            'For your next order',
            'Seuraavaa tilaustasi varten',
          ),
        ),
        const SizedBox(height: 10),
        WorkspacePanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (suggestion.isNotEmpty) ...[
                Text(
                  context.t(
                    'Suggested catalog searches',
                    'Ehdotetut tuotehaut',
                  ),
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final item in suggestion)
                      ActionChip(
                        avatar: const Icon(Icons.search, size: 16),
                        label: Text(context.t(item.en, item.fi)),
                        onPressed: () => onSearch(item.query),
                      ),
                  ],
                ),
                if (products.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  for (final product in products)
                    if (product['id'] case final String id)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const _SoftIcon(
                          icon: Icons.inventory_2_outlined,
                        ),
                        title: Text(product['name'] as String? ?? id),
                        subtitle: switch (product['brand']) {
                          final String brand when brand.isNotEmpty => Text(
                            brand,
                          ),
                          _ => null,
                        },
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => onSearch(id),
                      ),
                ],
                const Divider(height: 22),
              ],
              Text(
                context.t(
                  'Plan an order with your assistant',
                  'Suunnittele tilaus avustajan kanssa',
                ),
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                context.t(
                  'Start with your setup answers and add the details for this order.',
                  'Aloita antamistasi tiedoista ja lisää tämän tilauksen tarpeet.',
                ),
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.edit_outlined, size: 18),
                onPressed: () => onAssistant(profile.planningPrompt(context)),
                label: Text(
                  context.t('Start an order plan', 'Aloita tilaussuunnitelma'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _RunTile extends StatelessWidget {
  const _RunTile({required this.row, required this.onOpen});

  final Json row;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final id = row['id'] as String?;
    final title = row['title'] as String?;
    final status = switch (row['status']) {
      'awaiting_approval' => context.t(
        'Awaiting approval',
        'Odottaa hyväksyntää',
      ),
      'approved' => context.t('Approved', 'Hyväksytty'),
      'rejected' => context.t('Rejected', 'Hylätty'),
      'failed' => context.t('Failed', 'Epäonnistui'),
      'needs_attention' => context.t('Needs attention', 'Vaatii huomiota'),
      'completed' => context.t('Completed', 'Valmis'),
      'cancelled' => context.t('Cancelled', 'Peruttu'),
      'running' || 'queued' => context.t('In progress', 'Käsittelyssä'),
      _ => context.t('Open', 'Avoin'),
    };
    return Card(
      child: ListTile(
        leading: _SoftIcon(icon: Icons.receipt_long_outlined),
        title: Text(
          title?.isNotEmpty == true
              ? title!
              : context.t('Purchase request', 'Hankintapyyntö'),
        ),
        subtitle: Text(status),
        trailing: const Icon(Icons.chevron_right),
        onTap: id == null ? null : () => onOpen(id),
      ),
    );
  }
}
