import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/workspace.dart';
import 'request_history.dart';
import 'request_progress.dart';
import 'request_ui.dart';

class RunDetailScreen extends ConsumerStatefulWidget {
  const RunDetailScreen({super.key, required this.runId, this.snapshot});

  final String runId;
  final Json? snapshot;

  @override
  ConsumerState<RunDetailScreen> createState() => _RunDetailScreenState();
}

class _RunDetailScreenState extends ConsumerState<RunDetailScreen> {
  Json? _run;
  String? _owner;
  Object? _error;
  bool _loading = true;
  bool _editing = false;
  final _selected = <String, _Offer>{};

  @override
  void initState() {
    super.initState();
    ref.listenManual(sessionProvider, (_, next) {
      final account = next.value?.accountId;
      if (_owner != null || account == null) return;
      _owner = account;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }, fireImmediately: true);
  }

  bool get _active =>
      mounted &&
      _owner != null &&
      ref.read(sessionProvider).value?.accountId == _owner;
  bool get _busy => _loading || _editing;

  Json _checked(Json run) {
    if (run['id'] != widget.runId) {
      throw const FormatException('Unexpected request ID');
    }
    return run;
  }

  void _apply(Json run) {
    final current = _checked(run);
    if (current['revision'] != _run?['revision']) _selected.clear();
    _run = current;
  }

  Future<void> _load() async {
    if (!_active || _editing) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final run = await ref.read(workspaceApiProvider).run(widget.runId);
      if (_active) {
        setState(() => _apply(run));
        ref.invalidate(requestHistoryProvider(widget.runId));
      }
    } catch (error) {
      if (_active) {
        setState(() {
          _error = error;
          _run = null;
          _selected.clear();
        });
      }
    } finally {
      if (_active) setState(() => _loading = false);
    }
  }

  Future<void> _mutate(Future<Json> Function(WorkspaceApi) action) async {
    if (!_active || _busy || _run == null) return;
    final api = ref.read(workspaceApiProvider);
    setState(() {
      _editing = true;
      _error = null;
    });
    try {
      final next = await action(api);
      if (!_active) return;
      setState(() => _apply(next));
      ref.invalidate(runsProvider);
      ref.invalidate(requestHistoryProvider(widget.runId));
    } catch (error) {
      if (!_active) return;
      setState(() {
        _error = error;
        _run = null;
        _selected.clear();
      });
      // A timeout can happen after a write commits. Re-read the current revision.
      try {
        final latest = await api.run(widget.runId);
        if (_active) {
          setState(() => _apply(latest));
          ref.invalidate(runsProvider);
          ref.invalidate(requestHistoryProvider(widget.runId));
        }
      } catch (_) {
        /* Actions stay disabled until the buyer reloads the request. */
      }
    } finally {
      if (_active) setState(() => _editing = false);
    }
  }

  Future<bool> _confirm(String title, String message, String action) async =>
      await showDialog<bool>(
        context: context,
        useRootNavigator: false,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(copy(context, 'Back', 'Takaisin')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(action),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _decide(int revision, bool approve) async {
    final total = object(_run?['draft'])?['totalCents'];
    final hasChanges = objects(_run?['requestChanges']).isNotEmpty;
    final details = [
      hasChanges
          ? copy(
              context,
              'Your approval applies to this draft and the changes shown in this version.',
              'Hyväksyntäsi koskee tätä luonnosta ja tässä versiossa näkyviä muutoksia.',
            )
          : copy(
              context,
              'Your approval applies to the prices, dates and items shown in this version.',
              'Hyväksyntäsi koskee tässä versiossa näkyviä hintoja, päivämääriä ja tuotteita.',
            ),
      if (total is num)
        copy(
          context,
          'Revision $revision · ${euros(context, total)} estimated, ex VAT',
          'Versio $revision · arvio ${euros(context, total)}, alv 0 %',
        ),
    ];
    final confirmed = await _confirm(
      approve
          ? copy(context, 'Approve this draft?', 'Hyväksytäänkö luonnos?')
          : copy(context, 'Decline this draft?', 'Hylätäänkö luonnos?'),
      approve
          ? details.join('\n\n')
          : copy(
              context,
              'Declining closes this purchase request.',
              'Hylkääminen sulkee tämän hankintapyynnön.',
            ),
      approve
          ? copy(context, 'Approve draft', 'Hyväksy luonnos')
          : copy(context, 'Decline draft', 'Hylkää luonnos'),
    );
    if (confirmed && _active && _run?['revision'] == revision) {
      await _mutate(
        (api) => api.decide(widget.runId, revision, approve: approve),
      );
    }
  }

  Future<void> _rehearse(int revision) async {
    final confirmed = await _confirm(
      copy(
        context,
        'Save a rehearsal receipt?',
        'Tallennetaanko harjoituskuitti?',
      ),
      copy(
        context,
        'Cosign saves revision $revision as a simulated order. Supplier submission is disabled in rehearsal mode.',
        'Cosign tallentaa version $revision simuloituna tilauksena. Harjoitustilassa tilausta ei lähetetä toimittajalle.',
      ),
      copy(context, 'Save rehearsal receipt', 'Tallenna harjoituskuitti'),
    );
    if (!confirmed || !_active || _run?['revision'] != revision) return;
    await _mutate((api) async {
      await api.rehearseOrder(widget.runId, revision);
      return api.run(widget.runId);
    });
  }

  Future<void> _prepareDraft(
    int revision,
    List<_Offer> offers, {
    required bool multi,
  }) => _mutate(
    (api) => multi
        ? api.prepareOrder(
            widget.runId,
            revision,
            selections: offers.map((offer) => offer.selection).toList(),
          )
        : api.prepareOrder(
            widget.runId,
            revision,
            productId: offers.single.productId,
            availableDate: offers.single.date,
          ),
  );

  Future<void> _refreshDraft(int revision) async {
    final confirmed = await _confirm(
      copy(
        context,
        'Refresh draft prices?',
        'Päivitetäänkö luonnoksen hinnat?',
      ),
      copy(
        context,
        'A new lookup clears this draft and any approval saved for it.',
        'Uusi tarkistus poistaa tämän luonnoksen ja sille tallennetun hyväksynnän.',
      ),
      copy(context, 'Refresh prices', 'Päivitä hinnat'),
    );
    if (confirmed && _active && _run?['revision'] == revision) {
      await _mutate((api) => api.compareProducts(widget.runId, revision));
    }
  }

  Future<void> _omit(int revision, List<Json> items) async {
    final confirmed = await _confirm(
      copy(
        context,
        'Remove unavailable items?',
        'Poistetaanko tuotteet, joita ei ole saatavilla?',
      ),
      items.map((item) => itemLabel(context, item)).join('\n'),
      copy(context, 'Remove and recheck', 'Poista ja tarkista uudelleen'),
    );
    if (!confirmed || !_active) return;
    await _mutate((api) async {
      final revised = await api.removeRequestItems(
        widget.runId,
        revision,
        items.map((item) => item['itemId'] as String).toList(),
      );
      return api.compareProducts(widget.runId, revised['revision'] as int);
    });
  }

  Future<void> _findAlternative(Json item, int revision, bool multi) async {
    final api = ref.read(workspaceApiProvider);
    final itemId = multi ? item['itemId'] as String : null;
    final selected = await showModalBottomSheet<Json>(
      context: context,
      useRootNavigator: false,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (_) => _AlternativeSheet(
        api: api,
        runId: widget.runId,
        itemId: itemId,
        item: item,
      ),
    );
    if (!mounted || selected == null || !_active) return;
    final confirmed = await _confirm(
      copy(context, 'Change the requested product?', 'Vaihda pyydetty tuote?'),
      '${itemLabel(context, item)}\n→ ${selected['name']}',
      copy(context, 'Change product', 'Vaihda tuote'),
    );
    if (confirmed && _active) {
      await _mutate((api) async {
        final revised = await api.amendRequest(widget.runId, revision, {
          'productId': selected['id'],
          'quantity': item['quantity'],
          'unit': item['unit'],
        }, itemId: itemId);
        return api.compareProducts(widget.runId, revised['revision'] as int);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).value;
    final signedIn = session != null && session.accountId == _owner;
    final theme = Theme.of(context);
    final display = signedIn ? _run ?? widget.snapshot : null;
    final title =
        nonempty(display?['title']) ??
        copy(context, 'Purchase request', 'Hankintapyyntö');
    return Scaffold(
      appBar: AppBar(
        title: Text(copy(context, 'Request details', 'Pyynnön tiedot')),
        actions: [
          IconButton(
            onPressed: !signedIn || _busy ? null : _load,
            tooltip: copy(context, 'Refresh request', 'Päivitä pyyntö'),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: !signedIn
            ? Center(
                child: Text(
                  copy(
                    context,
                    'Sign in to review this request.',
                    'Tarkastele pyyntöä kirjautumalla sisään.',
                  ),
                ),
              )
            : Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 740),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
                    children: [
                      if (_busy) const LinearProgressIndicator(),
                      if (_busy) const SizedBox(height: 14),
                      Text(title, style: theme.textTheme.headlineMedium),
                      if (display != null) ...[
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 10,
                          runSpacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            StatusBadge(display['status']),
                            Text(
                              sourceLabel(context, display['source']),
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 16),
                        Panel(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                errorMessage(
                                  context,
                                  _error,
                                  'Could not update this request.',
                                  'Pyyntöä ei voitu päivittää.',
                                ),
                                style: TextStyle(
                                  color: theme.colorScheme.error,
                                ),
                              ),
                              if (_run == null)
                                TextButton(
                                  onPressed: _busy ? null : _load,
                                  child: Text(
                                    copy(context, 'Retry', 'Yritä uudelleen'),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                      if (_run case final run?)
                        ..._requestBody(context, run, session),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  List<Widget> _requestBody(BuildContext context, Json run, Session session) {
    final requirements = object(run['requirements']);
    final revision = run['revision'];
    if (requirements == null ||
        revision is! int ||
        run['kind'] == 'agent_job') {
      return [];
    }
    final rawItems = requirements['items'];
    final multi = rawItems is List;
    final items = multi
        ? objects(rawItems)
        : [
            <String, dynamic>{...requirements, 'itemId': 'item_1'},
          ];
    final changes = objects(run['requestChanges']);
    final removedByAgent = changes
        .where((change) => change['kind'] == 'items_removed')
        .expand((change) => objects(change['items']))
        .map((item) => item['itemId'])
        .whereType<String>()
        .toSet();
    final excluded = objects(requirements['excludedItems'])
        .where((item) => !removedByAgent.contains(item['itemId']))
        .toList();
    final closed = const {
      'cancelled',
      'rejected',
      'completed',
    }.contains(run['status']);
    final deadline = nonempty(requirements['deadline']);
    final deliveryMode = nonempty(requirements['deliveryMode']) ?? 'by';
    final pastDeadline =
        deadline != null &&
        !deliveryMode.startsWith('preferred_') &&
        (DateTime.tryParse(deadline)?.isBefore(DateTime.now()) ?? false);
    final comparison = object(run['comparison']);
    final draft = object(run['draft']);
    final approval = object(run['approvalEligibility']);
    final hasDraft = draft != null;
    final awaitingApproval = run['status'] == 'awaiting_approval';
    final allowApproval = approval?['eligible'] == true && !pastDeadline;
    final canCompare =
        !closed &&
        !pastDeadline &&
        (!hasDraft || (awaitingApproval && !allowApproval));
    final canRefreshDraft =
        hasDraft &&
        !pastDeadline &&
        const {'ready', 'approved'}.contains(run['status']);
    final budget = requirements['budgetCents'];
    final preferredBudget = requirements['budgetMode'] == 'preferred';
    final partialPlan = object(run['partialBasketPlan']);
    final receipt = object(run['receipt']);
    final omitted = strings(partialPlan?['omittedItemIds']);
    final canEditItems = canCompare && !hasDraft;
    return [
      const SizedBox(height: 22),
      RequestProgress(run: run),
      if (draft != null) ...[
        const SizedBox(height: 16),
        _DraftPanel(draft: draft, revision: revision),
      ],
      if (changes.isNotEmpty) ...[
        const SizedBox(height: 10),
        _RequestChangesPanel(changes: changes),
      ],
      if (draft != null) ...[
        const SizedBox(height: 10),
        if (receipt?['kind'] == 'order_rehearsal')
          RehearsalReceipt(receipt: receipt!)
        else
          DraftDecision(
            status: run['status'],
            draft: draft,
            approvalReasons: strings(approval?['reasons'])
                .map((reason) => _supplierMessage(context, reason))
                .toList(),
            revision: revision,
            onApprove: _busy || !allowApproval
                ? null
                : () => _decide(revision, true),
            onDecline: _busy ? null : () => _decide(revision, false),
            supplierCheckoutAvailable: session.supplierCheckoutAvailable,
            orderRehearsalAvailable: session.orderRehearsalAvailable,
            onRehearse: _busy || pastDeadline
                ? null
                : () => _rehearse(revision),
            canRefresh: canRefreshDraft,
            onRefresh: _busy ? null : () => _refreshDraft(revision),
          ),
      ],
      const SizedBox(height: 16),
      Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              copy(context, 'Requested items', 'Pyydetyt tuotteet'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 10),
            for (final item in items) ...[
              Text(itemLabel(context, item)),
              ..._dietaryLines(context, item),
              if (canEditItems)
                TextButton.icon(
                  onPressed: _busy
                      ? null
                      : () => _findAlternative(item, revision, multi),
                  icon: const Icon(Icons.search, size: 17),
                  label: Text(
                    copy(context, 'Find alternatives', 'Etsi vaihtoehtoja'),
                  ),
                )
              else
                const SizedBox(height: 8),
            ],
            if (excluded.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                copy(
                  context,
                  'Removed from this request',
                  'Poistettu tästä pyynnöstä',
                ),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              for (final item in excluded) Text(itemLabel(context, item)),
            ],
            if (budget is num || deadline != null) const Divider(),
            if (budget is num)
              Text(
                '${preferredBudget ? copy(context, 'Budget target', 'Budjettitavoite') : copy(context, 'Budget cap', 'Budjettiraja')} · ${euros(context, budget)}',
              ),
            if (deadline != null)
              Text(
                '${deliveryModeLabel(context, deliveryMode)} · ${instant(context, deadline, includeTime: true)}',
              ),
          ],
        ),
      ),
      if (pastDeadline && !closed) ...[
        const SizedBox(height: 14),
        Text(
          copy(
            context,
            'Delivery deadline has passed. Ask the assistant to review the request.',
            'Toimituksen määräaika on umpeutunut. Pyydä avustajaa tarkistamaan pyyntö.',
          ),
        ),
      ],
      if (canCompare) ...[
        const SizedBox(height: 18),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: _busy
                ? null
                : () => _mutate(
                    (api) => api.compareProducts(widget.runId, revision),
                  ),
            icon: const Icon(Icons.sync, size: 18),
            label: Text(
              comparison == null
                  ? copy(
                      context,
                      'Check prices and availability',
                      'Tarkista hinnat ja saatavuus',
                    )
                  : copy(
                      context,
                      'Refresh prices and availability',
                      'Päivitä hinnat ja saatavuus',
                    ),
            ),
          ),
        ),
      ],
      if (!hasDraft && comparison != null) ...[
        const SizedBox(height: 18),
        ..._offers(
          context,
          run,
          comparison,
          items,
          revision,
          multi,
          closed || pastDeadline,
          budget as num?,
          preferredBudget,
        ),
      ],
      if (canEditItems && omitted.isNotEmpty) ...[
        const SizedBox(height: 18),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                copy(
                  context,
                  'Continue with available items',
                  'Jatka saatavilla olevilla tuotteilla',
                ),
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 7),
              Text(
                copy(
                  context,
                  'These items could be removed from the request.',
                  'Nämä tuotteet voi poistaa pyynnöstä.',
                ),
              ),
              for (final item in items.where(
                (item) => omitted.contains(item['itemId']),
              ))
                Text(itemLabel(context, item)),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => _omit(
                        revision,
                        items
                            .where((item) => omitted.contains(item['itemId']))
                            .toList(),
                      ),
                child: Text(
                  copy(
                    context,
                    'Remove these items and recheck',
                    'Poista nämä tuotteet ja tarkista uudelleen',
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
      const SizedBox(height: 16),
      RequestHistory(runId: widget.runId),
    ];
  }

  List<Widget> _offers(
    BuildContext context,
    Json run,
    Json comparison,
    List<Json> items,
    int revision,
    bool multi,
    bool readOnly,
    num? budget,
    bool preferredBudget,
  ) {
    final comparisons = multi
        ? objects(comparison['items'])
        : [
            <String, dynamic>{...comparison, 'itemId': 'item_1'},
          ];
    final groups = <String, List<_Offer>>{};
    for (final line in comparisons) {
      final itemId = line['itemId'] as String;
      final fits = multi
          ? object(object(run['itemDraftEligibility'])?[itemId])
          : object(run['draftEligibility']);
      final dated = objects(line['deliveryOffers']);
      final productsWithDates = dated
          .map((offer) => offer['productId'])
          .toSet();
      groups[itemId] = [
        for (final offer in dated) _Offer(itemId, offer, offer, dated: true),
        for (final observation in objects(
          line['observations'],
        ).where((value) => !productsWithDates.contains(value['productId'])))
          _Offer(
            itemId,
            observation,
            object(fits?[observation['productId']]),
            dated: false,
          ),
      ];
    }
    final suggested = object(comparison['basketPlan']);
    final suggestedTotal = suggested?['totalCents'];
    final plan = <String, _Offer>{};
    if (suggested?['status'] == 'feasible') {
      for (final choice in objects(suggested?['selections'])) {
        for (final offer in groups[choice['itemId']] ?? <_Offer>[]) {
          if (offer.eligible &&
              offer.productId == choice['productId'] &&
              offer.date == choice['availableDate']) {
            plan[offer.itemId] = offer;
            break;
          }
        }
      }
    }
    final picked = items
        .map((item) => _selected[item['itemId']])
        .whereType<_Offer>()
        .toList();
    final complete = items.isNotEmpty && picked.length == items.length;
    final total = picked.fold<num>(0, (sum, offer) => sum + (offer.total ?? 0));
    final overBudget = complete && budget != null && total > budget;
    final stock = <(String, Object?), (num, num)>{};
    for (final offer in picked) {
      final key = (offer.productId, offer.date ?? offer.raw['availableDate']);
      final (used, available) = stock[key] ?? (0, double.infinity);
      final reported = offer.raw['availableSellUnits'] as num? ?? 0;
      stock[key] = (
        used + (offer.salesUnits ?? 0),
        reported < available ? reported : available,
      );
    }
    final stockConflict = stock.values.any(
      (value) => value.$1 - value.$2 > 1e-8,
    );
    final observedAt =
        comparison['observedAt'] ??
        (comparisons.isNotEmpty ? comparisons.first['observedAt'] : null);
    return [
      Text(
        copy(context, 'Supplier comparison', 'Toimittajavertailu'),
        style: Theme.of(context).textTheme.titleLarge,
      ),
      if (observedAt != null) ...[
        const SizedBox(height: 4),
        Text(
          '${copy(context, 'Checked', 'Tarkistettu')} ${instant(context, observedAt, includeTime: true)}',
        ),
      ],
      if (!readOnly && plan.length == items.length && items.isNotEmpty)
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.tonalIcon(
            onPressed: _busy
                ? null
                : () => _prepareDraft(
                    revision,
                    plan.values.toList(),
                    multi: multi,
                  ),
            icon: const Icon(Icons.receipt_long_outlined),
            label: Text(
              copy(
                    context,
                    'Prepare suggested draft',
                    'Valmistele ehdotettu luonnos',
                  ) +
                  (suggestedTotal is num
                      ? ' (${euros(context, suggestedTotal)})'
                      : ''),
            ),
          ),
        ),
      if (suggested != null && suggested['status'] != 'feasible')
        for (final reason in strings(suggested['reasons']))
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_supplierMessage(context, reason)),
          ),
      for (final item in items) ...[
        const SizedBox(height: 14),
        Text(
          itemLabel(context, item),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        for (final reason in strings(
          object(object(run['itemAvailability'])?[item['itemId']])?['reasons'],
        ))
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(_supplierMessage(context, reason)),
          ),
        if (groups[item['itemId']]?.isNotEmpty != true)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
              copy(
                context,
                'No matching offers were returned for this item.',
                'Tälle tuotteelle ei saatu sopivia tarjouksia.',
              ),
            ),
          ),
        for (final offer in groups[item['itemId']] ?? <_Offer>[]) ...[
          const SizedBox(height: 8),
          _OfferPanel(
            offer: offer,
            selected: _selected[offer.itemId]?.matches(offer) == true,
            showAction: !readOnly,
            onSelect: _busy || !offer.eligible
                ? null
                : () => setState(() => _selected[offer.itemId] = offer),
          ),
        ],
      ],
      if (complete) ...[
        const SizedBox(height: 14),
        Text(
          '${copy(context, 'Draft estimate, ex VAT', 'Luonnoksen arvio, alv 0 %')} · ${euros(context, total)}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
      ],
      if (overBudget)
        Text(
          preferredBudget
              ? copy(
                  context,
                  'The selected products exceed the budget target.',
                  'Valitut tuotteet ylittävät budjettitavoitteen.',
                )
              : copy(
                  context,
                  'The selected products exceed the budget cap.',
                  'Valitut tuotteet ylittävät budjettirajan.',
                ),
        ),
      if (stockConflict)
        Text(
          copy(
            context,
            'Combined quantities exceed reported stock for a product on the same date.',
            'Yhdistetty määrä ylittää samalle tuotteelle ja päivälle ilmoitetun varastosaldon.',
          ),
        ),
      if (!readOnly) ...[
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed:
              _busy ||
                  !complete ||
                  stockConflict ||
                  (overBudget && !preferredBudget)
              ? null
              : () => _prepareDraft(revision, picked, multi: multi),
          icon: const Icon(Icons.receipt_long_outlined),
          label: Text(copy(context, 'Prepare draft', 'Valmistele luonnos')),
        ),
      ],
    ];
  }
}

class _Offer {
  const _Offer(this.itemId, this.raw, this.fit, {required this.dated});

  final String itemId;
  final Json raw;
  final Json? fit;
  final bool dated;

  String get productId => raw['productId'] as String;
  String? get date => dated ? nonempty(raw['availableDate']) : null;
  num? get total => object(raw['estimate'])?['totalCents'] as num?;
  num? get salesUnits => object(raw['estimate'])?['salesUnits'] as num?;
  bool get eligible =>
      fit?['eligible'] == true && total != null && salesUnits != null;
  Json get selection => {
    'itemId': itemId,
    'productId': productId,
    if (date != null) 'availableDate': date,
  };

  bool matches(_Offer other) =>
      productId == other.productId && date == other.date;
}

class _OfferPanel extends StatelessWidget {
  const _OfferPanel({
    required this.offer,
    required this.selected,
    required this.showAction,
    this.onSelect,
  });

  final _Offer offer;
  final bool selected;
  final bool showAction;
  final VoidCallback? onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final price = offer.raw['salesUnitPriceCents'];
    final stock = offer.raw['availableSellUnits'];
    final warnings = strings(offer.raw['issues']);
    final reasons = strings(offer.fit?['reasons']);
    final reliability = offer.raw['reliability'];
    final carbon = offer.raw['carbon'];
    final coverage = object(offer.raw['observedCoverage']);
    final covered = coverage?['coveredQuantity'];
    final uncovered = coverage?['uncoveredQuantity'];
    final coverageUnit = nonempty(coverage?['unit']);
    return Panel(
      selected: selected,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ProductPhoto(nonempty(offer.raw['imageUrl'])),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      nonempty(offer.raw['name']) ?? offer.productId,
                      style: theme.textTheme.titleMedium,
                    ),
                    if (nonempty(offer.raw['salesUnit']) case final unit?)
                      Text(unit),
                    Text(
                      price is num
                          ? '${euros(context, price)} ${copy(context, '/ sales unit, ex VAT', '/ myyntiyksikkö, alv 0 %')}'
                          : copy(
                              context,
                              'Price unverified',
                              'Hintaa ei ole vahvistettu',
                            ),
                    ),
                    if (offer.total case final total?)
                      Text(
                        '${copy(context, 'Line estimate', 'Rivin arvio')} · ${euros(context, total)} · ${number(context, offer.salesUnits)} ${unitLabel(context, 'sales_unit')}',
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            stock is num &&
                    stock < 9999999999 &&
                    offer.raw['stockUnknown'] != true &&
                    !warnings.contains('STOCK_UNKNOWN')
                ? '${copy(context, 'Reported stock', 'Ilmoitettu varastosaldo')} · ${number(context, stock)} ${unitLabel(context, 'sales_unit')}'
                : copy(
                    context,
                    'Stock unverified',
                    'Varastosaldoa ei ole vahvistettu',
                  ),
          ),
          _DeliveryEstimate(offer.raw),
          if (covered is num &&
              covered > 0 &&
              uncovered is num &&
              uncovered > 0 &&
              coverageUnit != null)
            Text(
              copy(
                context,
                'Partial coverage · ${number(context, covered)} ${unitLabel(context, coverageUnit)} in reported stock',
                'Osittainen saatavuus · varastosaldo kattaa ${number(context, covered)} ${unitLabel(context, coverageUnit)}',
              ),
              style: theme.textTheme.bodySmall,
            ),
          if (reliability is num && reliability >= 0 && reliability <= 1)
            Text(
              copy(
                context,
                'Historical delivery reliability · ${number(context, (reliability * 100).round())}%',
                'Toimitusvarmuus aiemmin · ${number(context, (reliability * 100).round())} %',
              ),
              style: theme.textTheme.bodySmall,
            ),
          if (carbon is num && carbon >= 0)
            Text(
              copy(
                context,
                'Product group footprint · ${number(context, carbon)} kg CO₂e/kg',
                'Tuoteryhmän hiilijalanjälki · ${number(context, carbon)} kg CO₂e/kg',
              ),
              style: theme.textTheme.bodySmall,
            ),
          for (final message in {...warnings, ...reasons})
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                _supplierMessage(context, message),
                style: theme.textTheme.bodySmall,
              ),
            ),
          if (showAction)
            TextButton.icon(
              onPressed: selected ? null : onSelect,
              icon: AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context)
                    ? Duration.zero
                    : const Duration(milliseconds: 200),
                child: Icon(
                  selected ? Icons.check_circle : Icons.add_circle_outline,
                  key: ValueKey(selected),
                  size: 18,
                ),
              ),
              label: Text(
                selected
                    ? copy(context, 'Selected', 'Valittu')
                    : copy(context, 'Choose offer', 'Valitse tarjous'),
              ),
            ),
        ],
      ),
    );
  }
}

class _DeliveryEstimate extends StatelessWidget {
  const _DeliveryEstimate(this.line);

  final Json line;

  @override
  Widget build(BuildContext context) {
    final arrival = nonempty(line['availableDate']);
    final status = line['deliveryStatus'];
    if (arrival == null ||
        !const {
          'estimated',
          'time_unverified',
          'after_deadline',
        }.contains(status)) {
      return Text(
        copy(
          context,
          'Delivery date unverified',
          'Toimituspäivää ei ole vahvistettu',
        ),
      );
    }
    final label = status == 'after_deadline'
        ? copy(context, 'After your deadline', 'Määräajan jälkeen')
        : copy(context, 'Estimated arrival', 'Arvioitu toimituspäivä');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$label · ${calendarDate(context, arrival)}'),
        if (status == 'time_unverified')
          Text(
            copy(
              context,
              'Delivery time unverified',
              'Toimituksen kellonaikaa ei ole vahvistettu',
            ),
          ),
      ],
    );
  }
}

class _DraftPanel extends StatelessWidget {
  const _DraftPanel({required this.draft, required this.revision});

  final Json draft;
  final int revision;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lines = draft['items'] is List ? objects(draft['items']) : [draft];
    final total = draft['totalCents'];
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            copy(context, 'Purchase draft', 'Tilausluonnos'),
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 4),
          Text(
            copy(context, 'Revision $revision', 'Versio $revision'),
            style: theme.textTheme.bodySmall,
          ),
          for (final line in lines) ...[
            const Divider(height: 24),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ProductPhoto(nonempty(line['imageUrl'])),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        nonempty(line['name']) ??
                            copy(
                              context,
                              'Supplier product',
                              'Toimittajan tuote',
                            ),
                        style: theme.textTheme.titleMedium,
                      ),
                      Text(
                        '${number(context, line['salesUnits'] as num?)} ${line['salesUnit'] ?? unitLabel(context, 'sales_unit')}',
                      ),
                      _DeliveryEstimate(line),
                      if (line['totalCents'] case final num cents)
                        Text(euros(context, cents)),
                      for (final caveat in strings(line['caveats']))
                        Text(
                          _supplierMessage(context, caveat),
                          style: theme.textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ],
          if (total is num) ...[
            const Divider(height: 24),
            Text(
              '${copy(context, 'Order estimate, ex VAT', 'Tilauksen arvio, alv 0 %')} · ${euros(context, total)}',
              style: theme.textTheme.titleMedium,
            ),
          ],
          for (final caveat in strings(draft['caveats']).where(
            (value) => lines.every(
              (line) => !strings(line['caveats']).contains(value),
            ),
          ))
            Text(
              _supplierMessage(context, caveat),
              style: theme.textTheme.bodySmall,
            ),
        ],
      ),
    );
  }
}

class _RequestChangesPanel extends StatelessWidget {
  const _RequestChangesPanel({required this.changes});

  final List<Json> changes;

  @override
  Widget build(BuildContext context) {
    final lines = changes
        .expand((change) => _summary(context, change))
        .toList();
    if (lines.isEmpty) return const SizedBox.shrink();
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            copy(
              context,
              'Changes proposed by the agent',
              'Agentin ehdottamat muutokset',
            ),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          for (final line in lines)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(line)),
        ],
      ),
    );
  }

  List<String> _summary(BuildContext context, Json change) {
    switch (change['kind']) {
      case 'item_changed':
        final before = object(change['before']);
        final after = object(change['after']);
        return [
          if (before != null && after != null)
            '${_changedItem(context, before)} → ${_changedItem(context, after)}',
        ];
      case 'items_removed':
        final removed = copy(context, 'Removed', 'Poistettu');
        return [
          for (final item in objects(change['items']))
            '$removed · ${_changedItem(context, item)}',
        ];
      case 'constraints_relaxed':
        final budget = object(change['budget']);
        final delivery = object(change['delivery']);
        return [
          if (budget != null)
            '${_budgetLabel(context, budget['before'])} → ${_budgetLabel(context, budget['after'])}',
          if (delivery != null)
            '${_deliveryLabel(context, delivery['before'])} → ${_deliveryLabel(context, delivery['after'])}',
        ];
      default:
        return [];
    }
  }

  String _changedItem(BuildContext context, Json item) {
    final label = itemLabel(context, item);
    final id = nonempty(item['productId']);
    final query = nonempty(item['query']);
    return id != null && query != null && id != query ? '$label ($id)' : label;
  }

  String _budgetLabel(BuildContext context, Object? value) {
    final budget = object(value);
    final cents = budget?['cents'];
    if (cents is! num) {
      return copy(context, 'No budget cap', 'Ei budjettikattoa');
    }
    final label = budget?['mode'] == 'preferred'
        ? copy(context, 'Budget target', 'Budjettitavoite')
        : copy(context, 'Budget cap', 'Budjettikatto');
    return '$label ${euros(context, cents)}';
  }

  String _deliveryLabel(BuildContext context, Object? value) {
    final delivery = object(value);
    if (delivery == null) {
      return copy(context, 'No delivery target', 'Ei toimitustavoitetta');
    }
    final mode = deliveryModeLabel(context, nonempty(delivery['mode']) ?? 'by');
    final deadline = instant(context, delivery['deadline'], includeTime: true);
    return '$mode $deadline';
  }
}

class _AlternativeSheet extends StatefulWidget {
  const _AlternativeSheet({
    required this.api,
    required this.runId,
    required this.itemId,
    required this.item,
  });

  final WorkspaceApi api;
  final String runId;
  final String? itemId;
  final Json item;

  @override
  State<_AlternativeSheet> createState() => _AlternativeSheetState();
}

class _AlternativeSheetState extends State<_AlternativeSheet> {
  late final _query = TextEditingController(
    text: nonempty(widget.item['query']),
  );
  List<Json>? _products;
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
      _products = null;
    });
    try {
      final result = await widget.api.searchProducts(
        widget.runId,
        itemId: widget.itemId,
        query: nonempty(_query.text.trim()),
      );
      if (mounted) {
        setState(
          () =>
              _products = objects(result['products'])
                  .where((value) => value['id'] != widget.item['productId'])
                  .toList(),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: FractionallySizedBox(
      heightFactor: 0.88,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 30),
        children: [
          Text(
            copy(context, 'Find alternatives', 'Etsi vaihtoehtoja'),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _query,
            maxLength: 120,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _search(),
            decoration: InputDecoration(
              labelText: copy(context, 'Search catalog', 'Hae tuotteita'),
              suffixIcon: IconButton(
                onPressed: _loading ? null : _search,
                icon: const Icon(Icons.search),
                tooltip: copy(context, 'Search', 'Hae'),
              ),
            ),
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Text(
              errorMessage(
                context,
                _error,
                'Search failed.',
                'Haku epäonnistui.',
              ),
            ),
          if (_products?.isEmpty == true)
            Text(
              copy(
                context,
                'No alternative products match.',
                'Sopivia vaihtoehtoja ei löytynyt.',
              ),
            ),
          for (final product in _products ?? <Json>[])
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(nonempty(product['name']) ?? '${product['id']}'),
              subtitle: Text(nonempty(product['salesUnit']) ?? ''),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.pop(context, product),
            ),
        ],
      ),
    ),
  );
}

List<Widget> _dietaryLines(BuildContext context, Json item) {
  final requirements = strings(item['requirements']);
  final allergens = strings(item['freeFromAllergen']);
  final style = Theme.of(context).textTheme.bodySmall;
  String labels(List<String> values, Map<String, (String, String)> options) =>
      values
          .map((key) {
            final label = options[key];
            return label == null ? key : copy(context, label.$1, label.$2);
          })
          .join(', ');
  return [
    if (requirements.isNotEmpty)
      Text(labels(requirements, dietaryOptions), style: style),
    if (allergens.isNotEmpty)
      Text(
        '${copy(context, 'Free from', 'Ei sisällä')} ${labels(allergens, allergenOptions)}',
        style: style,
      ),
  ];
}

const _supplierMessages = {
  'STOCK_UNKNOWN': (
    'Stock quantity is unverified',
    'Varastosaldoa ei ole vahvistettu',
  ),
  'STOCK_SHORT': (
    'No stock reported',
    'Tuotetta ei ole ilmoitettu olevan varastossa',
  ),
  'CUTOFF_PASSED': ('Ordering cutoff has passed', 'Tilausaika on päättynyt'),
  'CUTOFF_UNVERIFIED': (
    'Ordering cutoff is unverified',
    'Tilausaikaa ei ole vahvistettu',
  ),
  'SALES_BLOCK': ('Sales are blocked', 'Tuote on myyntikiellossa'),
  'PRICE_UNUSABLE': (
    'No usable price returned',
    'Käyttökelpoista hintaa ei saatu',
  ),
  'PRICE_LOOKUP_UNAVAILABLE': (
    'Supplier pricing could not be loaded',
    'Toimittajan hintatietoja ei saatu',
  ),
  'AVAILABILITY_LOOKUP_UNAVAILABLE': (
    'Supplier availability could not be loaded',
    'Toimittajan saatavuustietoja ei saatu',
  ),
  'EMPTY_SCHEDULE': (
    'No availability schedule returned',
    'Saatavuusaikataulua ei saatu',
  ),
  'PACK_UNMAPPED': (
    'Pack size or sales increment needs confirmation',
    'Pakkauskoko tai myyntierä on vahvistettava',
  ),
  'VOLUME_UNMAPPED': (
    'Sales-unit volume needs confirmation',
    'Myyntiyksikön tilavuus on vahvistettava',
  ),
  'UNIT_MISMATCH': (
    'Availability and catalog units differ',
    'Saatavuustietojen ja tuotevalikoiman yksiköt eroavat',
  ),
  'DELIVERY_CONFLICT': (
    'Availability misses the requested date',
    'Tuotetta ei ole saatavilla pyydettynä ajankohtana',
  ),
  'DELIVERY_TIME_UNVERIFIED': (
    'Delivery hour has not been confirmed',
    'Toimituksen kellonaikaa ei ole vahvistettu',
  ),
  'DEPOSIT_CHARGES_UNVERIFIED': (
    'Deposit charges need confirmation',
    'Panttimaksut on vahvistettava',
  ),
  'VARIABLE_WEIGHT': (
    'The final quantity and cost depend on the actual weight',
    'Lopullinen määrä ja hinta riippuvat todellisesta painosta',
  ),
  'OVER_BUDGET': ('Exceeds the requested budget', 'Ylittää pyydetyn budjetin'),
  'OVER_PREFERRED_BUDGET': (
    'Exceeds the budget target',
    'Ylittää budjettitavoitteen',
  ),
  'OUTSIDE_PREFERRED_DELIVERY_DATE': (
    'Outside the preferred delivery date',
    'Toivotun toimitusajankohdan ulkopuolella',
  ),
  'STOCK_INSUFFICIENT': (
    'Reported stock cannot cover the requested quantity',
    'Ilmoitettu varasto ei kata pyydettyä määrää',
  ),
};

const _translatedMessages = {
  'The delivery deadline has passed.': 'Toimituksen määräaika on umpeutunut.',
  'Your purchasing rules changed. Refresh the comparison before approving.':
      'Hankintasääntösi ovat muuttuneet. Päivitä vertailu ennen hyväksymistä.',
  'Refresh prices and availability before approving this draft.':
      'Päivitä hinnat ja saatavuus ennen luonnoksen hyväksymistä.',
  'A supplier cutoff expired or is unknown. Refresh prices and availability.': 'Toimittajan tilausaika on päättynyt tai sitä ei tunneta. Päivitä hinnat ja saatavuus.',
  'Stock is not verified sufficient':
      'Varaston riittävyyttä ei ole vahvistettu.',
  'Order cutoff expired or unknown':
      'Tilausaika on päättynyt tai sitä ei tunneta.',
  'Price or required pack quantity is unknown':
      'Hintaa tai tarvittavaa pakkausmäärää ei tunneta.',
  'No catalog product matched this line and its requirements.':
      'Tälle riville ei löytynyt vaatimukset täyttävää tuotetta valikoimasta.',
  'Refresh the supplier observations': 'Päivitä toimittajan tiedot.',
  'Refresh the supplier observations.': 'Päivitä toimittajan tiedot.',
  'Refresh the supplier observations for the recommended dates.':
      'Päivitä toimittajan tiedot suositelluille päiville.',
  'At least one item has no eligible offer on the checked dates.': 'Vähintään yhdelle tuotteelle ei löytynyt sopivaa vaihtoehtoa tarkistetuilta päiviltä.',
  'The checked offers did not yield a basket within the comparison search limit.':
      'Vertailun hakurajan puitteissa ei löytynyt sopivaa ostoskoria.',
  'No combination from the checked offers fits both the shared budget and available stock.': 'Mikään tarkistettu yhdistelmä ei mahdu kokonaisbudjettiin ja saatavilla olevaan varastoon.',
};

String _supplierMessage(BuildContext context, String message) {
  final names = _supplierMessages[message.toUpperCase().replaceAll(' ', '_')];
  return names == null
      ? copy(context, message, _translatedMessages[message] ?? message)
      : copy(context, names.$1, names.$2);
}
