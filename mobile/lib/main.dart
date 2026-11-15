import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'data/workspace.dart';
import 'features/account/sign_in_screen.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/onboarding/profile.dart';
import 'ui/brand.dart';
import 'ui/theme.dart';
import 'workspace_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: CosignApp()));
}

class CosignApp extends ConsumerWidget {
  const CosignApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferences = ref.watch(preferencesProvider).value;
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'VALIO Cosign',
      theme: cosignTheme(Brightness.light),
      darkTheme: cosignTheme(Brightness.dark),
      themeMode: preferences?.themeMode ?? ThemeMode.system,
      locale: preferences?.locale,
      supportedLocales: const [Locale('en'), Locale('fi')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: const _FirstVisit(),
    );
  }
}

class _FirstVisit extends ConsumerWidget {
  const _FirstVisit();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider);
    return profile.when(
      data: (result) =>
          result == null ? const OnboardingScreen() : const _SessionGate(),
      error: (_, _) => Scaffold(
        appBar: AppBar(title: const CosignBrand()),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                context.t(
                  'Could not load setup.',
                  'Asetuksia ei voitu ladata.',
                ),
              ),
              TextButton(
                onPressed: () => ref.invalidate(profileProvider),
                child: Text(context.t('Retry', 'Yritä uudelleen')),
              ),
            ],
          ),
        ),
      ),
      loading: () => const _Opening(),
    );
  }
}

class _SessionGate extends ConsumerWidget {
  const _SessionGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(sessionProvider)
      .when(
        loading: () => const _Opening(),
        error: (_, _) => const SignInScreen(connectionFailed: true),
        data: (session) => session == null
            ? const SignInScreen()
            : SignedInWorkspace(key: ValueKey(session.accountId)),
      );
}

class _Opening extends StatelessWidget {
  const _Opening();

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CosignBrand(),
          const SizedBox(height: 22),
          CircularProgressIndicator(
            semanticsLabel: context.t(
              'Opening your workspace',
              'Avataan työtilaa',
            ),
          ),
        ],
      ),
    ),
  );
}
