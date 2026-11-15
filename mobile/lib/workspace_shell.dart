import 'package:material_ui/material_ui.dart';

import 'data/workspace.dart';
import 'features/account/account_screen.dart';
import 'features/agent/activity_screen.dart';
import 'features/agent/agent_screen.dart';
import 'features/overview/overview_screen.dart';
import 'features/requests/catalog_screen.dart';
import 'features/requests/new_request_screen.dart';
import 'features/requests/requests_screen.dart';
import 'features/requests/run_detail_screen.dart';
import 'ui/brand.dart';

class SignedInWorkspace extends StatefulWidget {
  const SignedInWorkspace({super.key});

  @override
  State<SignedInWorkspace> createState() => _SignedInWorkspaceState();
}

class _SignedInWorkspaceState extends State<SignedInWorkspace> {
  final _navigatorKey = GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) => NavigatorPopHandler<Object?>(
    onPopWithResult: (result) => _navigatorKey.currentState!.pop(result),
    child: Navigator(
      key: _navigatorKey,
      onGenerateRoute: (_) =>
          MaterialPageRoute<void>(builder: (_) => const _WorkspaceHome()),
    ),
  );
}

class _WorkspaceHome extends StatefulWidget {
  const _WorkspaceHome();

  @override
  State<_WorkspaceHome> createState() => _WorkspaceHomeState();
}

class _WorkspaceHomeState extends State<_WorkspaceHome> {
  int _selected = 0;
  final _visited = {0};
  String? _catalogQuery;
  String? _initialPrompt;
  int _agentInstance = 0;

  void _select(int index) {
    if (_selected == index) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _selected = index;
      _visited.add(index);
    });
  }

  void _search(String query) {
    setState(() => _catalogQuery = query);
    _select(1);
  }

  void _assistant(String prompt) {
    if (prompt.isNotEmpty) {
      setState(() {
        _initialPrompt = prompt;
        _agentInstance++;
      });
    }
    _select(3);
  }

  void _openRequest(String id, {Json? snapshot}) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => id.startsWith('job_')
            ? Scaffold(
                appBar: AppBar(title: Text(context.t('Assistant', 'Avustaja'))),
                body: SafeArea(
                  top: false,
                  child: AgentScreen(
                    onOpenRequest: _openRequest,
                    initialJobId: id,
                  ),
                ),
              )
            : RunDetailScreen(runId: id, snapshot: snapshot),
      ),
    );
  }

  Future<void> _createRequest() async {
    final created = await Navigator.of(
      context,
    ).push<Json>(MaterialPageRoute(builder: (_) => const NewRequestScreen()));
    if ((created?['id'] ?? created?['runId']) case final String id
        when mounted && id.isNotEmpty) {
      _openRequest(id, snapshot: created);
    }
  }

  void _activity() => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (context) => Scaffold(
        appBar: AppBar(
          title: Text(context.t('Live activity', 'Reaaliaikainen toiminta')),
        ),
        body: SafeArea(
          top: false,
          child: ActivityScreen(onOpenRequest: _openRequest),
        ),
      ),
    ),
  );

  void _settings({bool connections = false}) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => AccountScreen(showConnections: connections),
    ),
  );

  @override
  Widget build(BuildContext context) {
    Widget tab(int index) => switch (index) {
      0 => OverviewScreen(
        onSearch: _search,
        onAssistant: _assistant,
        onRequest: _openRequest,
        onCreateRequest: _createRequest,
        onRequests: () => _select(2),
        onActivity: _activity,
        onSettings: () => _settings(connections: true),
      ),
      1 => CatalogScreen(
        key: ValueKey(_catalogQuery),
        initialQuery: _catalogQuery,
        onAssistant: _assistant,
      ),
      2 => RequestsScreen(
        onOpenAgentRequest: _openRequest,
        onCreateRequest: _createRequest,
      ),
      _ => AgentScreen(
        key: ValueKey(_agentInstance),
        onOpenRequest: _openRequest,
        initialPrompt: _initialPrompt,
      ),
    };
    return Scaffold(
      appBar: AppBar(
        title: const CosignBrand(),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(),
        ),
        actions: [
          IconButton(
            onPressed: _activity,
            tooltip: context.t('Live activity', 'Reaaliaikainen toiminta'),
            icon: const Icon(Icons.bolt_outlined),
          ),
          IconButton(
            onPressed: _settings,
            tooltip: context.t('Account and settings', 'Tili ja asetukset'),
            icon: const Icon(Icons.account_circle_outlined),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: IndexedStack(
              index: _selected,
              sizing: StackFit.expand,
              children: [
                for (var i = 0; i < 4; i++)
                  _visited.contains(i)
                      ? TickerMode(enabled: i == _selected, child: tab(i))
                      : const SizedBox.shrink(),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selected,
        onDestinationSelected: _select,
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.home_outlined),
            label: context.t('Overview', 'Yleiskatsaus'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.inventory_2_outlined),
            label: context.t('Products', 'Tuotteet'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.receipt_long_outlined),
            label: context.t('Requests', 'Pyynnöt'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.chat_bubble_outline),
            label: context.t('Assistant', 'Avustaja'),
          ),
        ],
      ),
    );
  }
}
