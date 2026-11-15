import 'package:cosign_mobile/data/workspace.dart';
import 'package:cosign_mobile/features/account/sign_in_screen.dart';
import 'package:cosign_mobile/features/onboarding/onboarding_screen.dart';
import 'package:cosign_mobile/features/onboarding/profile.dart';
import 'package:cosign_mobile/features/overview/overview_screen.dart';
import 'package:cosign_mobile/features/requests/new_request_screen.dart';
import 'package:cosign_mobile/main.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late SharedPreferencesAsyncPlatform? originalPreferences;

  setUpAll(() async {
    await Future.wait([
      _loadFonts('DM Sans', [
        'DMSans-400.ttf',
        'DMSans-500.ttf',
        'DMSans-600.ttf',
        'DMSans-700.ttf',
        'DMSans-800.ttf',
      ]),
      _loadFonts('Barlow Semi Condensed', ['BarlowSemiCondensed-Bold.ttf']),
      _loadFonts('Caveat', ['Caveat-Cosign.ttf']),
    ]);
  });

  setUp(() {
    originalPreferences = SharedPreferencesAsyncPlatform.instance;
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.empty();
  });

  tearDown(() {
    SharedPreferencesAsyncPlatform.instance = originalPreferences;
  });

  testWidgets('skipping one question retains only the answers submitted', (
    tester,
  ) async {
    await _startApp(tester);
    expect(find.text('What kind of business do you run?'), findsOneWidget);

    await _tapLabel(tester, 'Restaurant');
    await _tapLabel(tester, 'Skip question');
    expect(
      find.text('What do you need help with?').hitTestable(),
      findsOneWidget,
    );
    await _tapLabel(tester, 'Comparing products and prices');
    await _tapLabel(tester, 'Continue');
    await _tapLabel(tester, 'Skip question');
    await _tapLabel(tester, 'Skip question');
    await _tapLabel(tester, 'Skip question');

    expect(find.byType(SignInScreen), findsOneWidget);
    expect(_profile(tester).answers, {'needs': 'compare'});
  });

  testWidgets('skipping setup opens sign-in and is remembered on reopening', (
    tester,
  ) async {
    await _startApp(tester);
    await _tapLabel(tester, 'Bakery');
    await _tapLabel(tester, 'Skip setup');

    expect(find.byType(SignInScreen), findsOneWidget);
    expect(_profile(tester).answers, isEmpty);

    await _reopenApp(tester);
    expect(find.byType(OnboardingScreen), findsNothing);
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(_profile(tester).answers, isEmpty);
  });

  testWidgets('completed setup offers tailored catalog searches on reopening', (
    tester,
  ) async {
    await _startApp(tester, session: _buyer);
    await _tapLabel(tester, 'Café');
    await _tapLabel(tester, 'Continue');
    await _tapLabel(tester, 'Restocking essentials');
    await _tapLabel(tester, 'Continue');
    await _tapLabel(tester, '€500–1,999');
    await _tapLabel(tester, 'Continue');
    await _tapLabel(tester, 'Weekly');
    await _tapLabel(tester, 'Continue');
    await _tapLabel(tester, 'Vegan');
    await _tapLabel(tester, 'Finish setup');

    expect(find.text('Purchasing overview'), findsOneWidget);
    await _reopenApp(tester, session: _buyer);

    expect(find.byType(OnboardingScreen), findsNothing);
    expect(_profile(tester).answers, {
      'businessType': 'cafe',
      'needs': 'restock',
      'monthlyBudget': '500to2000',
      'orderCadence': 'weekly',
      'dietaryPriority': 'vegan',
    });
    await _showLabel(tester, 'Oat drinks');
    expect(find.widgetWithText(ActionChip, 'Oat drinks'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, 'Coffee'), findsOneWidget);
    expect(find.text('For your next order'), findsOneWidget);
    expect(find.text('Organic oat drink'), findsOneWidget);
  });

  testWidgets('overview opens a structured purchase request directly', (
    tester,
  ) async {
    await _startApp(tester, session: _buyer);
    await _tapLabel(tester, 'Skip setup');
    await _tapLabel(tester, 'New request');

    expect(find.byType(NewRequestScreen), findsOneWidget);
    expect(find.text('What do you need?'), findsOneWidget);
  });
}

Future<void> _loadFonts(String family, List<String> files) {
  final loader = FontLoader(family);
  for (final file in files) {
    loader.addFont(rootBundle.load('assets/fonts/$file'));
  }
  return loader.load();
}

const _buyer = Session(
  accountId: 'buyer',
  name: 'Test kitchen',
  email: 'test@example.invalid',
  policy: {},
  mcpUrl: 'https://example.invalid/mcp',
  nemotronModel: 'nvidia/test-model',
  supplierCheckoutAvailable: false,
);

Future<void> _startApp(WidgetTester tester, {Session? session}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(390, 680);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  await _mountApp(tester, session: session);
}

Future<void> _reopenApp(WidgetTester tester, {Session? session}) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await _mountApp(tester, session: session);
}

Future<void> _mountApp(WidgetTester tester, {Session? session}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sessionProvider.overrideWith(() => _TestSessionController(session)),
        runsProvider.overrideWith((ref) async => const RunList([])),
        recommendedProductsProvider.overrideWith(
          (ref, query) async => [
            if (query == 'vegan oat drink')
              {
                'id': '1001',
                'name': 'Organic oat drink',
                'brand': 'Test supplier',
              },
          ],
        ),
      ],
      child: const CosignApp(),
    ),
  );
  await tester.pumpAndSettle();
}

PurchasingProfile _profile(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(CosignApp)))
        .read(profileProvider)
        .requireValue!;

Future<void> _showLabel(WidgetTester tester, String label) async {
  final target = find.text(label);
  if (target.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      target,
      150,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
}

Future<void> _tapLabel(WidgetTester tester, String label) async {
  await _showLabel(tester, label);
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

class _TestSessionController extends SessionController {
  _TestSessionController(this.session);

  final Session? session;

  @override
  Future<Session?> build() async => session;
}
