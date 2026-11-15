import 'package:material_ui/material_ui.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:intl/intl.dart';

import '../../data/workspace.dart';
import 'trade_activity.dart';

class AssistantMark extends StatelessWidget {
  const AssistantMark({super.key, required this.size});

  final double size;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(size * 0.26),
    child: Image.asset(
      'assets/brand/cosign.png',
      width: size,
      height: size,
      excludeFromSemantics: true,
    ),
  );
}

class _Turn {
  _Turn(this.id, this.prompt);

  final int id;
  final String? prompt;
  final events = <TradeActivity>[];
}

List<_Turn> _turns(List<TradeActivity> events) {
  final turns = <_Turn>[];
  for (final event in events) {
    final prompt = switch (event.action) {
      'agent_job' => event.data['instruction'],
      'buyer_message' => event.data['content'],
      _ => null,
    };
    if (prompt is String) {
      turns.add(_Turn(event.id, prompt));
    } else {
      if (turns.isEmpty) turns.add(_Turn(0, null));
      turns.last.events.add(event);
    }
  }
  return turns;
}

class Conversation extends StatelessWidget {
  const Conversation({
    super.key,
    required this.controller,
    required this.events,
    required this.status,
    required this.loadError,
    required this.onRefresh,
    required this.onOpenRequest,
  });

  final ScrollController controller;
  final List<TradeActivity> events;
  final String? status;
  final Object? loadError;
  final VoidCallback onRefresh;
  final ValueChanged<String> onOpenRequest;

  @override
  Widget build(BuildContext context) {
    final turns = _turns(events);
    final showFooter = status == 'awaiting_approval' || status == 'cancelled';
    return ListView.builder(
      controller: controller,
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      itemCount: turns.length + 2,
      itemBuilder: (context, index) {
        if (index == 0) {
          if (loadError case final error?) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(agentError(context, error)),
                TextButton(
                  onPressed: onRefresh,
                  child: Text(agentText(context, 'Retry', 'Yritä uudelleen')),
                ),
              ],
            );
          }
          return status == null
              ? const LinearProgressIndicator()
              : const SizedBox.shrink();
        }
        if (index <= turns.length) {
          final turn = turns[index - 1];
          return _ConversationTurn(
            key: ValueKey(turn.id),
            turn: turn,
            onOpenRequest: onOpenRequest,
          );
        }
        if (showFooter) {
          return Text(
            status == 'awaiting_approval'
                ? agentText(
                    context,
                    'Open the purchase draft to review it and make your decision.',
                    'Avaa tilausluonnos, tarkista se ja tee päätös.',
                  )
                : agentText(
                    context,
                    'This task was stopped.',
                    'Tehtävä pysäytettiin.',
                  ),
          );
        }
        return const SizedBox.shrink();
      },
    );
  }
}

class _ConversationTurn extends StatelessWidget {
  const _ConversationTurn({
    super.key,
    required this.turn,
    required this.onOpenRequest,
  });

  final _Turn turn;
  final ValueChanged<String> onOpenRequest;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final replies = <Widget>[];
    final finalToolByAction = <String, int>{};
    for (final event in turn.events) {
      if (event.status == 'completed' || event.status == 'failed') {
        finalToolByAction[event.action] = event.id;
      }
    }
    for (final event in turn.events) {
      final content = event.data['content'];
      if (event.action == 'model_response' &&
          content is String &&
          content.trim().isNotEmpty) {
        replies.add(_AssistantMarkdown(content: content));
      } else if (event.status == 'failed' && event.data['message'] is String) {
        replies.add(_AssistantError(message: event.data['message'] as String));
      } else if (event.status == 'completed' &&
          finalToolByAction[event.action] == event.id) {
        final result = _toolResult(context, event, onOpenRequest);
        if (result != null) replies.add(result);
      }
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (turn.prompt case final prompt?)
            Align(
              alignment: Alignment.centerRight,
              child: Container(
                margin: const EdgeInsets.only(left: 36, bottom: 14),
                padding: const EdgeInsets.symmetric(
                  vertical: 12,
                  horizontal: 14,
                ),
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(16),
                    topRight: Radius.circular(16),
                    bottomLeft: Radius.circular(16),
                    bottomRight: Radius.circular(4),
                  ),
                ),
                child: Text(
                  prompt,
                  style: TextStyle(color: colors.onPrimaryContainer),
                ),
              ),
            ),
          if (replies.isNotEmpty)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AssistantMark(size: 26),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final reply in replies)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: reply,
                        ),
                    ],
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _AssistantMarkdown extends StatelessWidget {
  const _AssistantMarkdown({required this.content});

  final String content;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MarkdownBody(
      data: content,
      selectable: true,
      imageBuilder: (uri, title, alt) => Text(alt ?? title ?? ''),
      styleSheet: MarkdownStyleSheet(
        a: TextStyle(color: theme.colorScheme.primary),
        p: theme.textTheme.bodyMedium?.copyWith(height: 1.55),
        h1: theme.textTheme.titleLarge,
        h2: theme.textTheme.titleMedium,
        h3: theme.textTheme.titleSmall,
        code: theme.textTheme.bodySmall?.copyWith(
          backgroundColor: theme.colorScheme.surfaceContainerHighest,
          fontFamily: 'monospace',
        ),
        codeblockDecoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(6),
        ),
        tableBorder: TableBorder.all(color: theme.colorScheme.outlineVariant),
        tableCellsPadding: const EdgeInsets.all(6),
        tableBody: theme.textTheme.bodySmall,
      ),
    );
  }
}

class _AssistantError extends StatelessWidget {
  const _AssistantError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(message, style: TextStyle(color: colors.onErrorContainer)),
    );
  }
}

Widget? _toolResult(
  BuildContext context,
  TradeActivity event,
  ValueChanged<String> onOpenRequest,
) {
  final data = event.data;
  final action = event.action;
  if (action == 'get_account_context' && data['policy'] is Json) {
    final policy = activityRecord(data['policy']);
    final limit = policy['automaticLimitCents'];
    if (limit is! num) return null;
    return _ToolCard(
      action: action,
      children: [
        Text(
          _euro(context, limit),
          style: Theme.of(context).textTheme.titleLarge,
        ),
        Text(
          agentText(
            context,
            'Automatic spending limit per order',
            'Automaattinen ostoraja tilausta kohden',
          ),
        ),
      ],
    );
  }
  if (action == 'list_requests' && data['requests'] is List) {
    final rows = activityRows(data['requests']);
    return _ToolCard(
      action: action,
      children: [
        if (rows.isEmpty)
          Text(
            agentText(
              context,
              'No matching requests.',
              'Ei vastaavia pyyntöjä.',
            ),
          ),
        for (final request in rows.take(5))
          if (request['id'] case final String id)
            _RequestLink(
              title: request['title'] as String?,
              status: request['status'] as String?,
              onOpen: () => onOpenRequest(id),
            ),
      ],
    );
  }
  if (action == 'get_activity' && data['events'] is List) {
    final events = activityRows(data['events']).map(TradeActivity.new);
    return _ToolCard(
      action: action,
      children: [
        if (events.isEmpty)
          Text(
            agentText(
              context,
              'No recorded activity.',
              'Ei kirjattuja tapahtumia.',
            ),
          ),
        for (final entry in events.take(6))
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(activityTitle(context, entry.action)),
            subtitle: Text(tradeStatus(context, entry.status)),
          ),
      ],
    );
  }
  final comparison = activityRecord(data['comparison']);
  final products = [
    ...activityRows(data['products']),
    ...activityRows(comparison['observations']),
    for (final group in activityRows(comparison['items']))
      ...activityRows(group['observations']),
    if (data['product'] case final Json product) product,
  ];
  final id = data['id'];
  final request = id is String && id.startsWith('run_');
  final draft = activityRecord(data['draft']);
  if (products.isNotEmpty || request || action == 'browse_catalog') {
    return _ToolCard(
      action: action,
      children: [
        if (products.isNotEmpty) _ProductResults(products: products),
        if (data['product'] case final Json product)
          _CatalogDetails(details: activityRecord(product['details'])),
        if (products.isEmpty && action == 'browse_catalog')
          Text(
            agentText(
              context,
              'No catalog matches.',
              'Ei hakutuloksia valikoimassa.',
            ),
          ),
        if (data['pricesIncluded'] == false && products.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              agentText(
                context,
                'Price and availability still need checking.',
                'Tarkista vielä hinta ja saatavuus.',
              ),
            ),
          ),
        if (draft['totalCents'] case final num total)
          Text(
            agentText(
              context,
              '${_euro(context, total)} excl. VAT',
              '${_euro(context, total)} alv 0 %',
            ),
          ),
        if (request)
          _RequestLink(
            title: data['title'] as String?,
            status: data['status'] as String?,
            onOpen: () => onOpenRequest(id),
          ),
      ],
    );
  }
  return null;
}

class _CatalogDetails extends StatelessWidget {
  const _CatalogDetails({required this.details});

  final Json details;

  @override
  Widget build(BuildContext context) {
    final language = Localizations.localeOf(context).languageCode;
    final fields = [
      ('ingredients', agentText(context, 'Ingredients', 'Ainesosat')),
      ('storageInstructions', agentText(context, 'Storage', 'Säilytys')),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (field, title) in fields)
          if (_catalogText(details[field], language) case final text?) ...[
            const SizedBox(height: 8),
            Text(title, style: Theme.of(context).textTheme.titleSmall),
            Text(text),
          ],
      ],
    );
  }
}

String? _catalogText(Object? raw, String language) {
  final rows = activityRows(raw);
  if (rows.isEmpty) return null;
  final localized = rows.firstWhere(
    (row) => '${row['language']}'.toLowerCase().split('-').first == language,
    orElse: () => rows.first,
  );
  return localized['value'] as String?;
}

class _ToolCard extends StatelessWidget {
  const _ToolCard({required this.action, required this.children});

  final String action;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(activityIcon(action), color: colors.primary, size: 17),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    activityTitle(context, action),
                    style: theme.textTheme.titleSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _RequestLink extends StatelessWidget {
  const _RequestLink({this.title, this.status, required this.onOpen});

  final String? title;
  final String? status;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => ListTile(
    dense: true,
    contentPadding: EdgeInsets.zero,
    title: Text(title ?? agentText(context, 'Open request', 'Avaa pyyntö')),
    subtitle: status == null ? null : Text(tradeStatus(context, status!)),
    trailing: const Icon(Icons.arrow_forward_rounded, size: 17),
    onTap: onOpen,
  );
}

class _ProductResults extends StatefulWidget {
  const _ProductResults({required this.products});

  final List<Json> products;

  @override
  State<_ProductResults> createState() => _ProductResultsState();
}

class _ProductResultsState extends State<_ProductResults> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final products = _expanded ? widget.products : widget.products.take(3);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final product in products)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.inventory_2_outlined, size: 17),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${product['name'] ?? product['displayName'] ?? agentText(context, 'Product', 'Tuote')}',
                        style: theme.textTheme.titleSmall,
                      ),
                      if (product['salesUnit'] case final String unit)
                        Text(unit, style: theme.textTheme.bodySmall),
                      if (product['salesUnitPriceCents'] case final num price)
                        Text(
                          agentText(
                            context,
                            '${_euro(context, price)} / sales unit excl. VAT',
                            '${_euro(context, price)} / myyntierä alv 0 %',
                          ),
                          style: theme.textTheme.bodySmall,
                        ),
                      if (product['stockUnknown'] == true ||
                          (product['issues'] is List &&
                              (product['issues'] as List).contains(
                                'STOCK_UNKNOWN',
                              )))
                        Text(
                          agentText(
                            context,
                            'Availability unverified',
                            'Saatavuutta ei ole vahvistettu',
                          ),
                        )
                      else if (product['availableSellUnits']
                          case final num stock)
                        Text(
                          agentText(
                            context,
                            '$stock sales units available',
                            '$stock myyntierää saatavilla',
                          ),
                          style: theme.textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        if (widget.products.length > 3)
          TextButton(
            onPressed: () => setState(() => _expanded = !_expanded),
            child: Text(
              _expanded
                  ? agentText(context, 'Show fewer', 'Näytä vähemmän')
                  : agentText(
                      context,
                      'Show all products',
                      'Näytä kaikki tuotteet',
                    ),
            ),
          ),
      ],
    );
  }
}

String _euro(BuildContext context, num cents) => NumberFormat.currency(
  locale: Localizations.localeOf(context).languageCode,
  symbol: '€',
).format(cents / 100);
