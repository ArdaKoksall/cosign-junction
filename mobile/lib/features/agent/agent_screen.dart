import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/workspace.dart';
import 'conversation.dart';
import 'trade_activity.dart';

class AgentScreen extends ConsumerStatefulWidget {
  const AgentScreen({
    super.key,
    required this.onOpenRequest,
    this.initialPrompt,
    this.initialJobId,
  });

  final ValueChanged<String> onOpenRequest;
  final String? initialPrompt;
  final String? initialJobId;

  @override
  ConsumerState<AgentScreen> createState() => _AgentScreenState();
}

class _AgentScreenState extends ConsumerState<AgentScreen> {
  late final TextEditingController _editor;
  final _focus = FocusNode();
  final _scroll = ScrollController();
  late final AppLifecycleListener _lifecycle;
  final _events = <TradeActivity>[];
  Timer? _poll;
  String? _jobId;
  String? _status;
  Object? _loadError;
  Object? _sendError;
  bool _sending = false;
  bool _fetching = false;
  bool _foreground = true;
  int _generation = 0;

  bool get _working => _status == 'queued' || _status == 'running';
  bool get _canReply => _status == 'completed' || _status == 'failed';

  @override
  void initState() {
    super.initState();
    _editor = TextEditingController(text: widget.initialPrompt);
    _jobId = widget.initialJobId;
    _lifecycle = AppLifecycleListener(
      onStateChange: (state) {
        _foreground = state == AppLifecycleState.resumed;
        if (_foreground) {
          unawaited(_refresh());
        } else {
          _poll?.cancel();
        }
      },
    );
    unawaited(_refresh());
  }

  @override
  void didUpdateWidget(covariant AgentScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialJobId != oldWidget.initialJobId) {
      _openJob(widget.initialJobId);
    }
    if (widget.initialPrompt != null &&
        widget.initialPrompt != oldWidget.initialPrompt) {
      _setPrompt(widget.initialPrompt!, focus: false);
    }
  }

  void _setPrompt(String value, {bool focus = true}) {
    _editor.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    if (focus) _focus.requestFocus();
  }

  void _openJob(String? id) {
    _poll?.cancel();
    _editor.clear();
    setState(() {
      _generation++;
      _jobId = id;
      _status = null;
      _events.clear();
      _loadError = null;
      _sendError = null;
      _fetching = false;
      _sending = false;
    });
    unawaited(_refresh());
  }

  Future<void> _refresh() async {
    final jobId = _jobId;
    if (jobId == null || _fetching || !_foreground) return;
    _poll?.cancel();
    _fetching = true;
    final generation = _generation;
    Duration? nextPoll;
    try {
      final api = ref.read(workspaceApiProvider);
      final job = await api.run(jobId);
      if (!mounted || generation != _generation) return;
      final page = await nextActivityPage(
        api,
        runId: jobId,
        after: _events.isEmpty ? 0 : _events.last.id,
      );
      if (!mounted || generation != _generation) return;
      final follow = !_scroll.hasClients || _scroll.position.extentAfter < 110;
      final changed = job['status'] != _status;
      setState(() {
        _status = job['status'] as String?;
        _events.addAll(page.events);
        _loadError = null;
      });
      if (changed) ref.invalidate(runsProvider);
      if (follow && (changed || page.events.isNotEmpty)) _scrollToLatest();
      nextPoll = page.hasMore
          ? const Duration(milliseconds: 400)
          : _working
          ? const Duration(seconds: 3)
          : _status == 'awaiting_approval'
          ? const Duration(seconds: 5)
          : null;
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() => _loadError = error);
      if (error is! ApiException || error.status != 404) {
        nextPoll = const Duration(seconds: 6);
      }
    } finally {
      if (mounted && generation == _generation) {
        _fetching = false;
        if (nextPoll != null && _foreground) {
          _poll = Timer(nextPoll, _refresh);
        }
      }
    }
  }

  void _scrollToLatest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final instruction = _editor.text.trim();
    final id = _jobId;
    final continuing = id != null && _canReply;
    if (_sending || (id != null && !continuing)) return;
    if (instruction.length < (continuing ? 2 : 10)) {
      setState(() => _sendError = const _ShortPrompt());
      return;
    }
    _focus.unfocus();
    final generation = _generation;
    setState(() {
      _sending = true;
      _sendError = null;
    });
    try {
      final api = ref.read(workspaceApiProvider);
      if (continuing) {
        await api.replyToAgent(id, instruction);
      }
      final jobId = continuing ? id : await api.startAgent(instruction);
      if (!mounted || generation != _generation) return;
      _editor.clear();
      setState(() {
        _generation++;
        _fetching = false;
        _sending = false;
        _jobId = jobId;
        _status = 'queued';
      });
      ref.invalidate(runsProvider);
      unawaited(_refresh());
      _scrollToLatest();
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _sendError = error);
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _stop() async {
    final id = _jobId;
    if (id == null || _sending) return;
    final generation = _generation;
    setState(() {
      _sending = true;
      _sendError = null;
    });
    try {
      await ref.read(workspaceApiProvider).cancel(id);
      if (!mounted || generation != _generation) return;
      setState(() {
        _generation++;
        _fetching = false;
        _sending = false;
        _status = 'cancelled';
      });
      unawaited(_refresh());
      ref.invalidate(runsProvider);
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _sendError = error);
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _showHistory() async {
    final selection = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => const _AgentHistory(),
    );
    if (mounted && selection != null && _jobId != selection) {
      _openJob(selection);
    }
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _poll?.cancel();
    _focus.dispose();
    _editor.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final session = ref.watch(sessionProvider).value;
    final configured = session?.nemotronModel != null;
    final canSend = configured && (_jobId == null || _canReply) && !_sending;
    final status = _status;
    final waiting = status == 'awaiting_approval';
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 10, 12),
          child: Row(
            children: [
              const AssistantMark(size: 40),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      agentText(context, 'Cosign assistant', 'Cosign-avustaja'),
                      style: theme.textTheme.titleLarge,
                    ),
                    Text(
                      'NVIDIA Nemotron',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: _sending ? null : _showHistory,
                tooltip: agentText(
                  context,
                  'Assistant history',
                  'Avustajan historia',
                ),
                icon: const Icon(Icons.history_rounded),
              ),
              if (_jobId != null)
                IconButton(
                  onPressed: _sending ? null : () => _openJob(null),
                  tooltip: agentText(context, 'New task', 'Uusi tehtävä'),
                  icon: const Icon(Icons.add_comment_outlined),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: _jobId == null
              ? _Welcome(onPrompt: configured ? _setPrompt : null)
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: Conversation(
                    controller: _scroll,
                    events: _events,
                    status: status,
                    loadError: _loadError,
                    onRefresh: _refresh,
                    onOpenRequest: (id) {
                      if (id.startsWith('job_')) {
                        _openJob(id);
                      } else {
                        widget.onOpenRequest(id);
                      }
                    },
                  ),
                ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_sendError case final error?)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    error is _ShortPrompt
                        ? _canReply
                              ? agentText(
                                  context,
                                  'Enter at least 2 characters.',
                                  'Syötä vähintään 2 merkkiä.',
                                )
                              : agentText(
                                  context,
                                  'Enter at least 10 characters.',
                                  'Syötä vähintään 10 merkkiä.',
                                )
                        : agentError(context, error),
                    style: TextStyle(color: colors.error),
                  ),
                ),
              if (!configured)
                Text(
                  agentText(
                    context,
                    'NVIDIA Nemotron is unavailable in this workspace.',
                    'NVIDIA Nemotron ei ole käytettävissä tässä työtilassa.',
                  ),
                  style: theme.textTheme.bodyMedium,
                )
              else if (_working || waiting)
                Row(
                  children: [
                    if (_working) ...[
                      const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: Semantics(
                        liveRegion: true,
                        child: Text(tradeStatus(context, status!)),
                      ),
                    ),
                    if (_working)
                      TextButton(
                        onPressed: _sending ? null : _stop,
                        child: Text(agentText(context, 'Stop', 'Pysäytä')),
                      ),
                  ],
                )
              else if (_jobId == null || _canReply)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        autofocus: false,
                        controller: _editor,
                        focusNode: _focus,
                        enabled: canSend,
                        textCapitalization: TextCapitalization.sentences,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 8000,
                        decoration: InputDecoration(
                          hintText: agentText(
                            context,
                            'Message your assistant…',
                            'Kirjoita avustajalle…',
                          ),
                          counterText: '',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: canSend ? _send : null,
                      tooltip: agentText(
                        context,
                        'Send message',
                        'Lähetä viesti',
                      ),
                      icon: _sending
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.arrow_upward_rounded),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ShortPrompt {
  const _ShortPrompt();
}

class _Welcome extends StatelessWidget {
  const _Welcome({this.onPrompt});

  final ValueChanged<String>? onPrompt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 32, 20, 20),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: const AssistantMark(size: 56),
        ),
        const SizedBox(height: 20),
        Text(
          agentText(
            context,
            'What does your kitchen need?',
            'Mitä keittiösi tarvitsee?',
          ),
          style: theme.textTheme.headlineMedium,
        ),
        const SizedBox(height: 8),
        Text(
          agentText(
            context,
            'Include quantities and dietary needs, plus any budget or delivery preferences.',
            'Kerro määrät ja ruokavaliovaatimukset sekä mahdolliset budjetti- ja toimitustoiveet.',
          ),
          style: theme.textTheme.bodyLarge,
        ),
        const SizedBox(height: 24),
        _starter(
          context,
          Icons.verified_user_outlined,
          agentText(context, 'Review my requests', 'Tarkista pyyntöni'),
          agentText(
            context,
            'Check my purchasing rules and summarize tasks that need my attention.',
            'Tarkista ostosääntöni ja kokoa yhteenveto tehtävistä, jotka vaativat huomiotani.',
          ),
        ),
        const SizedBox(height: 10),
        _starter(
          context,
          Icons.search_rounded,
          agentText(
            context,
            'Find products for my next order',
            'Etsi tuotteita seuraavaan tilaukseen',
          ),
          agentText(
            context,
            'Find lactose-free milk in the catalog. Do not create an order yet.',
            'Etsi valikoimasta laktoositonta maitoa. Älä vielä luo tilausta.',
          ),
        ),
      ],
    );
  }

  Widget _starter(
    BuildContext context,
    IconData icon,
    String label,
    String prompt,
  ) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        leading: Icon(icon, color: colors.primary),
        title: Text(label),
        trailing: const Icon(Icons.arrow_forward_rounded, size: 18),
        onTap: onPrompt == null ? null : () => onPrompt!(prompt),
      ),
    );
  }
}

class _AgentHistory extends ConsumerWidget {
  const _AgentHistory();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final result = ref.watch(runsProvider);
    final jobs =
        result.value?.rows
            .where((row) => row['source'] == 'nemotron' && row['id'] is String)
            .toList() ??
        [];
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.5,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 14),
              child: Text(
                agentText(context, 'Assistant history', 'Avustajan historia'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            if (result.hasError)
              Text(agentError(context, result.error!))
            else if (result.isLoading && jobs.isEmpty)
              const LinearProgressIndicator()
            else if (jobs.isEmpty)
              Text(
                agentText(
                  context,
                  'No assistant tasks yet.',
                  'Ei vielä avustajan tehtäviä.',
                ),
              ),
            for (final job in jobs)
              ListTile(
                title: Text(
                  job['title'] as String? ??
                      activityTitle(context, 'agent_job'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  tradeStatus(context, job['status'] as String? ?? ''),
                ),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => Navigator.of(context).pop(job['id'] as String),
              ),
          ],
        ),
      ),
    );
  }
}
