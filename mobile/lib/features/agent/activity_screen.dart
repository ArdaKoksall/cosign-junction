import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/workspace.dart';
import 'trade_activity.dart';

class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({super.key, required this.onOpenRequest});

  final ValueChanged<String> onOpenRequest;

  @override
  ConsumerState<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends ConsumerState<ActivityScreen> {
  final _events = <TradeActivity>[];
  late final AppLifecycleListener _lifecycle;
  Timer? _timer;
  Object? _error;
  bool _loading = false;
  bool _ready = false;
  bool _foreground = true;
  int _after = 0;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onStateChange: (state) {
        _foreground = state == AppLifecycleState.resumed;
        if (_foreground) {
          unawaited(_refresh());
        } else {
          _timer?.cancel();
        }
      },
    );
    unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_loading || !_foreground) return;
    _timer?.cancel();
    _loading = true;
    var delay = const Duration(seconds: 6);
    try {
      final page = await nextActivityPage(
        ref.read(workspaceApiProvider),
        after: _after,
      );
      if (!mounted) return;
      setState(() {
        if (page.events.isNotEmpty) _after = page.events.last.id;
        _events.addAll(page.events.where((event) => event.status != 'started'));
        if (_events.length > 200) {
          _events.removeRange(0, _events.length - 200);
        }
        _ready = !page.hasMore;
        _error = null;
      });
      if (page.hasMore) delay = const Duration(milliseconds: 400);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      _loading = false;
      if (mounted && _foreground) _timer = Timer(delay, _refresh);
    }
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
        itemCount: _events.length + 1,
        itemBuilder: (context, index) {
          if (index > 0) {
            final event = _events[_events.length - index];
            return _ActivityEntry(
              key: ValueKey(event.id),
              event: event,
              onOpen: event.runId == null
                  ? null
                  : () => widget.onOpenRequest(event.runId!),
            );
          }
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      _ready && _error == null
                          ? Icons.circle
                          : Icons.sync_rounded,
                      size: 12,
                      color: colors.primary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _error != null
                            ? agentText(
                                context,
                                'Updates paused',
                                'Päivitykset keskeytetty',
                              )
                            : _ready
                            ? agentText(
                                context,
                                'Live updates',
                                'Reaaliaikaiset päivitykset',
                              )
                            : agentText(
                                context,
                                'Loading activity…',
                                'Ladataan tapahtumia…',
                              ),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
                if (_error case final error?) ...[
                  const SizedBox(height: 12),
                  Text(
                    agentError(context, error),
                    style: TextStyle(color: colors.error),
                  ),
                  TextButton(
                    onPressed: _refresh,
                    child: Text(agentText(context, 'Retry', 'Yritä uudelleen')),
                  ),
                ] else if (!_ready) ...[
                  const SizedBox(height: 14),
                  const LinearProgressIndicator(),
                ] else if (_events.isEmpty) ...[
                  const SizedBox(height: 20),
                  Text(
                    agentText(
                      context,
                      'Request, approval and assistant updates will appear here.',
                      'Hankintapyynnöt, hyväksynnät ja avustajan tapahtumat näkyvät täällä.',
                    ),
                    style: theme.textTheme.bodyLarge,
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ActivityEntry extends StatelessWidget {
  const _ActivityEntry({super.key, required this.event, this.onOpen});

  final TradeActivity event;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final createdAt = event.createdAt?.toLocal();
    final localizations = MaterialLocalizations.of(context);
    final timestamp = createdAt == null
        ? ''
        : '${localizations.formatShortDate(createdAt)}  ${localizations.formatTimeOfDay(TimeOfDay.fromDateTime(createdAt), alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context))}';
    final status = tradeStatus(context, event.status);
    return Column(
      children: [
        ListTile(
          contentPadding: const EdgeInsets.symmetric(
            vertical: 4,
            horizontal: 3,
          ),
          leading: CircleAvatar(
            radius: 20,
            backgroundColor: colors.primaryContainer,
            foregroundColor: colors.onPrimaryContainer,
            child: Icon(activityIcon(event.action), size: 19),
          ),
          title: Text(activityTitle(context, event.action)),
          subtitle: Text(timestamp.isEmpty ? status : '$status · $timestamp'),
          trailing: onOpen == null
              ? null
              : const Icon(Icons.chevron_right_rounded),
          onTap: onOpen,
        ),
        const Divider(height: 1),
      ],
    );
  }
}
