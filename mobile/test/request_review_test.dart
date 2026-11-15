import 'package:cosign_mobile/data/workspace.dart';
import 'package:cosign_mobile/features/requests/run_detail_screen.dart';
import 'package:cosign_mobile/ui/theme.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

const _runId = 'run_test';
const _revision = 3;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final body = FontLoader('DM Sans')
      ..addFont(rootBundle.load('assets/fonts/DMSans-400.ttf'));
    final display = FontLoader('Barlow Semi Condensed')
      ..addFont(rootBundle.load('assets/fonts/BarlowSemiCondensed-Bold.ttf'));
    await Future.wait([body.load(), display.load()]);
  });

  testWidgets(
    'buyer approves a specific revision then saves a rehearsal receipt',
    (tester) async {
      final api = _ReviewApi();
      await _showReview(tester, api, enableRehearsal: true);

      await _scrollTo(tester, 'Buyer approval required');
      expect(find.text('Buyer approval required'), findsOneWidget);
      expect(
        find.text('The total exceeds the automatic spending limit of €50.00.'),
        findsOneWidget,
      );
      expect(find.text('Save rehearsal receipt'), findsNothing);

      await _tap(tester, 'Approve draft');
      expect(find.text('Approve this draft?'), findsOneWidget);
      expect(
        find.textContaining('Revision 3 · €120.00 estimated, ex VAT'),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Approve draft').last);
      await tester.pumpAndSettle();
      expect(api.approvedRevision, _revision);
      expect(find.text('Buyer approved'), findsOneWidget);
      expect(api.rehearsedRevision, isNull);

      await _tap(tester, 'Save rehearsal receipt');
      expect(find.text('Save a rehearsal receipt?'), findsOneWidget);
      await tester.tap(
        find.widgetWithText(FilledButton, 'Save rehearsal receipt').last,
      );
      await tester.pumpAndSettle();
      expect(api.rehearsedRevision, _revision);
      expect(find.text('Rehearsal receipt saved'), findsOneWidget);
      expect(
        find.text('Simulated order. The supplier receives no order.'),
        findsOneWidget,
      );
      expect(find.text('rehearsal_test'), findsOneWidget);
      expect(find.text('Save rehearsal receipt'), findsNothing);

      await _tap(tester, 'Recent request history');
      await _scrollTo(tester, 'Draft approved');
      expect(find.text('Draft approved'), findsOneWidget);
    },
  );

  testWidgets(
    'a stale decision reloads the draft and requires another review',
    (tester) async {
      final api = _ReviewApi(reviseOnDecision: true);
      await _showReview(tester, api, enableRehearsal: false);

      await _tap(tester, 'Approve draft');
      await tester.tap(find.widgetWithText(FilledButton, 'Approve draft').last);
      await tester.pumpAndSettle();

      expect(api.approvedRevision, isNull);
      expect(find.text('Revision 4'), findsOneWidget);
      await tester.fling(
        find.byType(ListView).first,
        const Offset(0, 400),
        800,
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'This request changed. Review the latest version and try again.',
        ),
        findsOneWidget,
      );
      expect(find.text('Save rehearsal receipt'), findsNothing);
    },
  );

  testWidgets('buyer reviews agent changes before approving the same draft', (
    tester,
  ) async {
    const removed = {
      'itemId': 'item_2',
      'query': 'Rice',
      'quantity': 2,
      'unit': 'kg',
    };
    final api = _ReviewApi(
      excludedItems: [removed],
      requestChanges: const [
        {
          'kind': 'item_changed',
          'before': {'query': 'Milk', 'quantity': 100, 'unit': 'L'},
          'after': {
            'query': 'Lactose-free milk',
            'productId': '464398',
            'quantity': 80,
            'unit': 'L',
          },
        },
        {
          'kind': 'items_removed',
          'items': [removed],
        },
        {
          'kind': 'constraints_relaxed',
          'budget': {
            'before': {'cents': 7500, 'mode': 'hard'},
            'after': {'cents': 10000, 'mode': 'preferred'},
          },
          'delivery': {
            'before': {'deadline': '2026-11-16T17:00:00+02:00', 'mode': 'on'},
            'after': null,
          },
        },
      ],
    );
    await _showReview(tester, api, enableRehearsal: true);

    await _scrollTo(tester, 'Changes proposed by the agent');
    expect(
      find.text('100 L Milk → 80 L Lactose-free milk (464398)'),
      findsOneWidget,
    );
    expect(find.text('Removed · 2 kg Rice'), findsOneWidget);
    expect(
      find.text('Budget cap €75.00 → Budget target €100.00'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Helsinki → No delivery target'),
      findsOneWidget,
    );
    expect(api.approvedRevision, isNull);

    await _tap(tester, 'Approve draft');
    expect(
      find.textContaining('this draft and the changes shown in this version'),
      findsOneWidget,
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Approve draft').last);
    await tester.pumpAndSettle();
    expect(api.approvedRevision, _revision);

    await _scrollTo(tester, 'Requested items');
    expect(find.text('Removed from this request'), findsNothing);
  });

  testWidgets('a workspace without rehearsal can only record the decision', (
    tester,
  ) async {
    final api = _ReviewApi();
    await _showReview(tester, api, enableRehearsal: false);

    await _tap(tester, 'Approve draft');
    await tester.tap(find.widgetWithText(FilledButton, 'Approve draft').last);
    await tester.pumpAndSettle();

    expect(api.approvedRevision, _revision);
    expect(find.text('Buyer approved'), findsOneWidget);
    expect(find.text('Save rehearsal receipt'), findsNothing);
    expect(api.rehearsedRevision, isNull);
  });
}

Future<void> _showReview(
  WidgetTester tester,
  _ReviewApi api, {
  required bool enableRehearsal,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(360, 700);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(api.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceApiProvider.overrideWithValue(api),
        sessionProvider.overrideWith(() => _ReviewSession(enableRehearsal)),
        runsProvider.overrideWith((ref) async => const RunList([])),
      ],
      child: MaterialApp(
        theme: cosignTheme(Brightness.light),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            disableAnimations: true,
            textScaler: const TextScaler.linear(1.15),
          ),
          child: child!,
        ),
        home: const RunDetailScreen(runId: _runId),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _scrollTo(WidgetTester tester, String label) async {
  final target = find.text(label);
  if (target.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      target,
      120,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String label) async {
  await _scrollTo(tester, label);
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

class _ReviewSession extends SessionController {
  _ReviewSession(this.enableRehearsal);

  final bool enableRehearsal;

  @override
  Future<Session?> build() async => Session(
    accountId: 'buyer',
    name: 'Test kitchen',
    email: 'test@example.invalid',
    policy: {},
    mcpUrl: 'https://example.invalid/mcp',
    nemotronModel: null,
    supplierCheckoutAvailable: false,
    orderRehearsalAvailable: enableRehearsal,
  );
}

class _ReviewApi extends WorkspaceApi {
  _ReviewApi({
    this.reviseOnDecision = false,
    this.requestChanges = const [],
    this.excludedItems = const [],
  }) : super(
         apiOrigin: Uri.https('example.invalid'),
         publicOrigin: Uri.https('example.invalid'),
         storage: const FlutterSecureStorage(),
       );

  final bool reviseOnDecision;
  final List<Json> requestChanges;
  final List<Json> excludedItems;
  int? approvedRevision;
  int? rehearsedRevision;
  var revision = _revision;
  var status = 'awaiting_approval';
  Json? _receipt;

  @override
  Future<Json> run(String id) async => {
    'id': id,
    'revision': revision,
    'title': 'Lactose-free milk',
    'source': 'mcp',
    'status': status,
    'requirements': {
      'query': 'milk',
      'quantity': 100,
      'unit': 'L',
      if (excludedItems.isNotEmpty) 'excludedItems': excludedItems,
    },
    if (requestChanges.isNotEmpty) 'requestChanges': requestChanges,
    'approvalEligibility': {'eligible': true, 'reasons': []},
    'draft': {
      'name': 'Lactose-free milk',
      'salesUnits': 100,
      'salesUnit': '1 L',
      'totalCents': 12000,
      'policy': {'automaticLimitCents': 5000},
    },
    'receipt': ?_receipt,
  };

  @override
  Future<Json> decide(String id, int revision, {required bool approve}) async {
    if (reviseOnDecision) {
      this.revision++;
      throw const ApiException('Draft changed', code: 'stale_revision');
    }
    approvedRevision = revision;
    status = approve ? 'approved' : 'rejected';
    return run(id);
  }

  @override
  Future<Json> rehearseOrder(String id, int revision) async {
    rehearsedRevision = revision;
    status = 'completed';
    final receipt = _receipt = {
      'kind': 'order_rehearsal',
      'receiptId': 'rehearsal_test',
      'revision': revision,
      'totalCents': 12000,
      'authorization': 'buyer_approval',
      'submittedToSupplier': false,
      'createdAt': '2026-11-15T01:30:00Z',
    };
    return {'runId': id, 'status': status, 'receipt': receipt};
  }

  @override
  Future<List<Json>> runEvents(String runId) async => [
    if (approvedRevision case final revision?)
      {
        'id': 1,
        'run_id': runId,
        'action': 'human_approval',
        'status': 'completed',
        'created_at': '2026-11-15T01:29:00Z',
        'data': {'revision': revision, 'totalCents': 12000},
      },
  ];
}
