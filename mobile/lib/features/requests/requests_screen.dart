import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/workspace.dart';
import 'request_ui.dart';
import 'run_detail_screen.dart';

class RequestsScreen extends ConsumerStatefulWidget {
  const RequestsScreen({
    super.key,
    this.onOpenAgentRequest,
    required this.onCreateRequest,
  });

  final ValueChanged<String>? onOpenAgentRequest;
  final VoidCallback onCreateRequest;

  @override
  ConsumerState<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends ConsumerState<RequestsScreen> {
  String _filter = 'all';

  void _open(Json run) {
    final id = nonempty(run['id']) ?? nonempty(run['runId']);
    if (id == null) return;
    final openAgent = widget.onOpenAgentRequest;
    if (openAgent != null && id.startsWith('job_')) {
      openAgent(id);
      return;
    }
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => RunDetailScreen(runId: id, snapshot: run),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final requests = ref.watch(runsProvider);
    final cached = requests.value?.isCached == true;
    final theme = Theme.of(context);
    final filters = {
      'all': copy(context, 'All requests', 'Kaikki pyynnöt'),
      'awaiting_approval': statusLabel(context, 'awaiting_approval'),
      'active': statusLabel(context, 'active'),
      'completed': statusLabel(context, 'completed'),
    };
    final rows = (requests.value?.rows ?? <Json>[])
        .where(
          (row) => switch (_filter) {
            'all' => true,
            'active' => const {
              'active',
              'queued',
              'running',
              'needs_attention',
            }.contains(row['status']),
            'completed' => const {
              'completed',
              'approved',
              'ready',
            }.contains(row['status']),
            _ => row['status'] == _filter,
          },
        )
        .where((row) => nonempty(row['id']) != null)
        .toList();
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(runsProvider);
        try {
          await ref.read(runsProvider.future);
        } catch (_) {
          /* The list shows the error. */
        }
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Text(
            copy(context, 'Your requests', 'Omat pyyntösi'),
            style: theme.textTheme.headlineLarge,
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: widget.onCreateRequest,
              icon: const Icon(Icons.add),
              label: Text(copy(context, 'New request', 'Uusi pyyntö')),
            ),
          ),
          const SizedBox(height: 18),
          SizedBox(
            height: 52,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: filters.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, index) {
                final entry = filters.entries.elementAt(index);
                return Center(
                  child: ChoiceChip(
                    label: Text(entry.value),
                    selected: _filter == entry.key,
                    onSelected: (_) => setState(() => _filter = entry.key),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          if (cached) ...[
            Panel(
              child: Row(
                children: [
                  const Icon(Icons.cloud_off_outlined, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      copy(
                        context,
                        'Showing saved requests. Connect to refresh or review a draft.',
                        'Näytetään tallennetut pyynnöt. Yhdistä verkkoon päivittääksesi tai tarkastellaksesi luonnosta.',
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (requests.isLoading && requests.value == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (requests.hasError && requests.value == null)
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    errorMessage(
                      context,
                      requests.error,
                      'Could not load your requests.',
                      'Pyyntöjäsi ei voitu ladata.',
                    ),
                  ),
                  TextButton(
                    onPressed: () => ref.invalidate(runsProvider),
                    child: Text(copy(context, 'Retry', 'Yritä uudelleen')),
                  ),
                ],
              ),
            )
          else if (rows.isEmpty)
            Panel(
              child: Text(
                copy(
                  context,
                  'No requests in this view yet.',
                  'Tässä näkymässä ei ole vielä pyyntöjä.',
                ),
              ),
            )
          else
            for (final row in rows) ...[
              _RequestTile(run: row, onTap: () => _open(row)),
              const SizedBox(height: 9),
            ],
        ],
      ),
    );
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.run, required this.onTap});

  final Json run;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = run['status'];
    final color = theme.colorScheme;
    final icon = switch (status) {
      'awaiting_approval' => Icons.shopping_basket_outlined,
      'approved' || 'ready' || 'completed' => Icons.check_circle_outline,
      _ => Icons.schedule_outlined,
    };
    return Panel(
      padding: EdgeInsets.zero,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(13),
            child: Row(
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: color.secondaryContainer,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Icon(
                      icon,
                      size: 21,
                      color: color.onSecondaryContainer,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        nonempty(run['title']) ??
                            copy(context, 'Purchase request', 'Hankintapyyntö'),
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: 5),
                      Text(
                        '${sourceLabel(context, run['source'])} · ${instant(context, run['created_at'])}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: color.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 7),
                      StatusBadge(status),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(Icons.chevron_right, color: color.onSurfaceVariant),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
