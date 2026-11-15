import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../data/workspace.dart';
import '../agent/trade_activity.dart';
import 'request_ui.dart';

const _requestActions = {
  'create_request',
  'update_request_preferences',
  'compare_products',
  'amend_request',
  'remove_request_items',
  'prepare_order',
  'human_approval',
  'human_rejection',
  'order_rehearsal',
  'place_order',
  'cancel',
};

final requestHistoryProvider = FutureProvider.autoDispose
    .family<List<TradeActivity>, String>((ref, runId) async {
      final accountId = ref.watch(
        sessionProvider.select((state) => state.value?.accountId),
      );
      if (accountId == null) return const [];
      final rows = await ref.watch(workspaceApiProvider).runEvents(runId);
      return rows.reversed
          .map(TradeActivity.new)
          .where(
            (event) =>
                _requestActions.contains(event.action) &&
                event.status != 'started',
          )
          .toList();
    }, retry: (_, _) => null);

class RequestHistory extends StatelessWidget {
  const RequestHistory({super.key, required this.runId});

  final String runId;

  @override
  Widget build(BuildContext context) => Panel(
    padding: EdgeInsets.zero,
    child: ExpansionTile(
      leading: const Icon(Icons.history_rounded),
      title: Text(
        copy(context, 'Recent request history', 'Pyynnön viime tapahtumat'),
      ),
      shape: const Border(),
      collapsedShape: const Border(),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [_HistoryEntries(runId: runId)],
    ),
  );
}

class _HistoryEntries extends ConsumerWidget {
  const _HistoryEntries({required this.runId});

  final String runId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final provider = requestHistoryProvider(runId);
    final theme = Theme.of(context);
    return ref
        .watch(provider)
        .when(
          loading: () => const LinearProgressIndicator(),
          error: (error, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                errorMessage(
                  context,
                  error,
                  'Could not load request history.',
                  'Pyynnön historiaa ei voitu ladata.',
                ),
              ),
              TextButton(
                onPressed: () => ref.invalidate(provider),
                child: Text(copy(context, 'Retry', 'Yritä uudelleen')),
              ),
            ],
          ),
          data: (events) => events.isEmpty
              ? Text(
                  copy(
                    context,
                    'No actions recorded yet.',
                    'Ei vielä tapahtumia.',
                  ),
                )
              : Column(
                  children: [
                    for (final event in events.take(12))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          event.status == 'failed'
                              ? Icons.error_outline
                              : activityIcon(event.action),
                          color: event.status == 'failed'
                              ? theme.colorScheme.error
                              : theme.colorScheme.primary,
                          size: 20,
                        ),
                        title: Text(activityTitle(context, event.action)),
                        subtitle: Text(_entryDetails(context, event)),
                      ),
                  ],
                ),
        );
  }

  String _entryDetails(BuildContext context, TradeActivity event) {
    final revision = event.data['revision'];
    final total = event.data['totalCents'];
    final detail = nonempty(event.data['message']);
    return [
      if (event.createdAt case final created?)
        instant(context, created.toIso8601String(), includeTime: true),
      if (revision is int)
        copy(context, 'Revision $revision', 'Versio $revision'),
      if (total is num)
        copy(
          context,
          '${euros(context, total)} ex VAT',
          '${euros(context, total)}, alv 0 %',
        ),
      if (event.status == 'failed') tradeStatus(context, event.status),
      if (detail != null && event.status == 'failed') detail,
    ].join(' · ');
  }
}
