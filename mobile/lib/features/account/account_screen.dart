import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/workspace.dart';
import '../../ui/brand.dart';
import 'display_settings.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key, this.showConnections = false});

  final bool showConnections;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value;
    if (session == null) return const Scaffold(body: SizedBox.shrink());
    return Scaffold(
      appBar: AppBar(
        title: Text(
          showConnections
              ? context.t('MCP connections', 'MCP-yhteydet')
              : context.t('Account and settings', 'Tili ja asetukset'),
        ),
        actions: const [DisplayMenu()],
      ),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: [
                if (showConnections)
                  _ConnectionsPanel(session: session)
                else ...[
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.account_circle_outlined),
                      title: Text(session.name),
                      subtitle: Text(session.email),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          leading: const Icon(Icons.rule_outlined),
                          title: Text(
                            context.t('Purchasing rules', 'Hankintasäännöt'),
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => _PolicyScreen(session: session),
                            ),
                          ),
                        ),
                        const Divider(indent: 16, endIndent: 16),
                        ListTile(
                          leading: const Icon(Icons.link_outlined),
                          title: Text(
                            context.t('MCP connections', 'MCP-yhteydet'),
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) =>
                                  const AccountScreen(showConnections: true),
                            ),
                          ),
                        ),
                        const Divider(indent: 16, endIndent: 16),
                        ListTile(
                          leading: const Icon(Icons.logout),
                          title: Text(context.t('Sign out', 'Kirjaudu ulos')),
                          onTap: () async {
                            final messenger = ScaffoldMessenger.of(context);
                            final message = context.t(
                              'Could not finish signing out on the server.',
                              'Uloskirjautumista ei voitu viimeistellä palvelimella.',
                            );
                            try {
                              await ref
                                  .read(sessionProvider.notifier)
                                  .signOut();
                            } catch (_) {
                              if (messenger.mounted) {
                                messenger.showSnackBar(
                                  SnackBar(content: Text(message)),
                                );
                              }
                            }
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

final _connectionsProvider = FutureProvider.autoDispose<List<Json>>((ref) {
  return ref.watch(workspaceApiProvider).connections();
}, retry: (_, _) => null);

class _ConnectionsPanel extends ConsumerStatefulWidget {
  const _ConnectionsPanel({required this.session});

  final Session session;

  @override
  ConsumerState<_ConnectionsPanel> createState() => _ConnectionsPanelState();
}

class _ConnectionsPanelState extends ConsumerState<_ConnectionsPanel> {
  bool _busy = false;

  Future<void> _revoke(String id, String name) async {
    final confirm = await showDialog<bool>(
      context: context,
      useRootNavigator: false,
      builder: (context) => AlertDialog(
        title: Text(context.t('Revoke access?', 'Perutaanko käyttöoikeus?')),
        content: Text(
          context.t(
            '$name will lose access to this account.',
            '$name menettää pääsyn tälle tilille.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.t('Cancel', 'Peruuta')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.t('Revoke access', 'Peru käyttöoikeus')),
          ),
        ],
      ),
    );
    if (!mounted || confirm != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(workspaceApiProvider).revokeConnection(id);
      if (mounted) ref.invalidate(_connectionsProvider);
    } catch (_) {
      if (mounted) {
        _notice(
          context.t(
            'Could not revoke access.',
            'Käyttöoikeutta ei voitu perua.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _notice(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _openSetup() async {
    final url = Uri.tryParse(widget.session.mcpUrl);
    if (url == null || url.scheme != 'https') return;
    final started = await launchUrl(
      url.replace(path: '/', query: 'page=connections', fragment: ''),
      mode: LaunchMode.externalApplication,
    );
    if (mounted && !started) {
      _notice(
        context.t('Could not open the browser.', 'Selainta ei voitu avata.'),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final connections = ref.watch(_connectionsProvider);
    final active = connections.value
        ?.where((row) => row['revoked_at'] == null)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        WorkspacePanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                context.t('Connect your agent', 'Yhdistä avustajasi'),
                style: theme.textTheme.headlineMedium,
              ),
              const SizedBox(height: 8),
              Text(
                context.t(
                  'Use the web workspace to connect ChatGPT, Claude, Claude Code, or Codex.',
                  'Yhdistä ChatGPT, Claude, Claude Code tai Codex verkkotyötilassa.',
                ),
              ),
              const SizedBox(height: 12),
              SelectableText(widget.session.mcpUrl),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: () async {
                      final message = context.t(
                        'Endpoint copied.',
                        'Osoite kopioitu.',
                      );
                      await Clipboard.setData(
                        ClipboardData(text: widget.session.mcpUrl),
                      );
                      if (mounted) _notice(message);
                    },
                    icon: const Icon(Icons.copy_outlined, size: 17),
                    label: Text(context.t('Copy endpoint', 'Kopioi osoite')),
                  ),
                  if (widget.session.mcpUrl.startsWith('https://'))
                    FilledButton.icon(
                      onPressed: _openSetup,
                      icon: const Icon(Icons.open_in_new, size: 17),
                      label: Text(
                        context.t('Open web workspace', 'Avaa verkkotyötila'),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        Text(
          context.t('Active connections', 'Aktiiviset yhteydet'),
          style: theme.textTheme.headlineSmall,
        ),
        const SizedBox(height: 10),
        if (connections.isLoading)
          const LinearProgressIndicator()
        else if (connections.hasError)
          WorkspacePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.t(
                    'Could not load connections.',
                    'Yhteyksiä ei voitu ladata.',
                  ),
                ),
                TextButton(
                  onPressed: () => ref.invalidate(_connectionsProvider),
                  child: Text(context.t('Retry', 'Yritä uudelleen')),
                ),
              ],
            ),
          )
        else if (active?.isNotEmpty != true)
          WorkspacePanel(
            child: Text(
              context.t('No active connections.', 'Ei aktiivisia yhteyksiä.'),
            ),
          )
        else
          for (final row in active!)
            if (row['id'] case final String id)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Card(
                  child: ListTile(
                    leading: const Icon(Icons.link_outlined),
                    title: Text(
                      row['name']?.toString() ??
                          context.t('Agent connection', 'Avustajayhteys'),
                    ),
                    trailing: IconButton(
                      tooltip: context.t('Revoke access', 'Peru käyttöoikeus'),
                      icon: const Icon(Icons.link_off_outlined),
                      onPressed: _busy
                          ? null
                          : () => _revoke(
                              id,
                              row['name']?.toString() ??
                                  context.t('This agent', 'Tämä avustaja'),
                            ),
                    ),
                  ),
                ),
              ),
      ],
    );
  }
}

class _PolicyScreen extends ConsumerStatefulWidget {
  const _PolicyScreen({required this.session});

  final Session session;

  @override
  ConsumerState<_PolicyScreen> createState() => _PolicyScreenState();
}

class _PolicyScreenState extends ConsumerState<_PolicyScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _limit;
  late final Set<String> _claims, _allergens;
  bool _saving = false;

  static const _claimLabels = {
    'lactose-free': ('Lactose-free', 'Laktoositon'),
    'gluten-free': ('Gluten-free', 'Gluteeniton'),
    'vegan': ('Vegan', 'Vegaaninen'),
    'vegetarian': ('Vegetarian', 'Kasvisruokavalioon sopiva'),
    'no-added-sugar': ('No added sugar', 'Ei lisättyä sokeria'),
    'high-protein': ('High protein', 'Runsaasti proteiinia'),
  };

  static const _allergenLabels = {
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

  @override
  void initState() {
    super.initState();
    final policy = widget.session.policy;
    final cents = policy['automaticLimitCents'] as num? ?? 0;
    _limit = TextEditingController(text: (cents / 100).toStringAsFixed(2));
    _claims = (policy['requiredClaims'] as List? ?? const [])
        .whereType<String>()
        .toSet();
    _allergens = (policy['freeFromAllergens'] as List? ?? const [])
        .whereType<String>()
        .toSet();
  }

  @override
  void dispose() {
    _limit.dispose();
    super.dispose();
  }

  double? _amount(String? value) {
    final normalized = value?.trim().replaceAll(',', '.') ?? '';
    if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(normalized)) return null;
    final amount = double.tryParse(normalized);
    return amount != null && amount <= 1000000 ? amount : null;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final succeeded = context.t(
      'Purchasing rules saved.',
      'Hankintasäännöt tallennettu.',
    );
    final failed = context.t(
      'Could not save purchasing rules.',
      'Hankintasääntöjä ei voitu tallentaa.',
    );
    try {
      await ref.read(workspaceApiProvider).updatePolicy({
        'automaticLimitCents': (_amount(_limit.text)! * 100).round(),
        'requiredClaims': _claims.toList(),
        'freeFromAllergens': _allergens.toList(),
      });
      if (!mounted) return;
      ref.invalidate(runsProvider);
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        messenger.showSnackBar(SnackBar(content: Text(failed)));
      }
      return;
    }
    try {
      await ref.read(sessionProvider.notifier).refresh();
    } on ApiException {
      // The policy was saved. The screen can close even if refresh is unavailable.
    }
    if (mounted) {
      Navigator.of(context).pop();
      messenger.showSnackBar(SnackBar(content: Text(succeeded)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(context.t('Purchasing rules', 'Hankintasäännöt')),
      ),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                children: [
                  Text(
                    context.t(
                      'These rules apply to connected agents. Saving changes invalidates existing drafts and approvals.',
                      'Säännöt koskevat yhdistettyjä avustajia. Muutosten tallentaminen mitätöi aiemmat luonnokset ja hyväksynnät.',
                    ),
                  ),
                  const SizedBox(height: 18),
                  TextFormField(
                    controller: _limit,
                    enabled: !_saving,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: context.t(
                        'Automatic limit per order',
                        'Automaattinen ostoraja per tilaus',
                      ),
                      suffixText: context.t('€ ex VAT', '€ alv 0 %'),
                    ),
                    validator: (value) => _amount(value) != null
                        ? null
                        : context.t(
                            'Enter an amount from €0 to €1,000,000.',
                            'Anna summa väliltä 0–1 000 000 €.',
                          ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    context.t(
                      'A zero limit requires your approval for paid purchases.',
                      'Nollan euron rajalla maksulliset hankinnat vaativat hyväksynnän.',
                    ),
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 22),
                  _choiceGroup(
                    context.t(
                      'Mandatory product requirements',
                      'Pakolliset tuotevaatimukset',
                    ),
                    _claimLabels,
                    _claims,
                  ),
                  const SizedBox(height: 14),
                  _choiceGroup(
                    context.t(
                      'Require verified absence of allergens',
                      'Vaadi todennettu allergeenittomuus',
                    ),
                    _allergenLabels,
                    _allergens,
                  ),
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: Text(
                      context.t(
                        'Save purchasing rules',
                        'Tallenna hankintasäännöt',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _choiceGroup(
    String title,
    Map<String, (String, String)> labels,
    Set<String> selection,
  ) => Card(
    child: ExpansionTile(
      title: Text(title),
      subtitle: Text(
        context.t(
          '${selection.length} selected',
          '${selection.length} valittu',
        ),
      ),
      children: [
        for (final row in labels.entries)
          CheckboxListTile(
            title: Text(context.t(row.value.$1, row.value.$2)),
            value: selection.contains(row.key),
            onChanged: _saving
                ? null
                : (checked) {
                    setState(() {
                      if (checked == true) {
                        selection.add(row.key);
                      } else {
                        selection.remove(row.key);
                      }
                    });
                  },
          ),
      ],
    ),
  );
}
