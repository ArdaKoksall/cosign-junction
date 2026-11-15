import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'local_store.dart';

export 'api.dart';

final workspaceApiProvider = Provider<WorkspaceApi>((ref) {
  final api = WorkspaceApi.configured();
  ref.onDispose(api.dispose);
  return api;
});

final localStoreProvider = Provider<LocalStore>((ref) {
  final store = LocalStore();
  ref.onDispose(() => unawaited(store.close()));
  return store;
});

final sessionProvider = AsyncNotifierProvider<SessionController, Session?>(
  SessionController.new,
  retry: (_, _) => null,
);

class SessionController extends AsyncNotifier<Session?> {
  @override
  Future<Session?> build() {
    final api = ref.watch(workspaceApiProvider);
    final expired = api.sessionExpired.listen((_) {
      state = const AsyncData(null);
    });
    ref.onDispose(() => unawaited(expired.cancel()));
    return api.restoreSession();
  }

  Future<void> signIn(String email, String password) async {
    final session = await ref
        .read(workspaceApiProvider)
        .signIn(email, password);
    if (ref.mounted) state = AsyncData(session);
  }

  Future<void> refresh() async {
    final session = await ref.read(workspaceApiProvider).session();
    if (ref.mounted) state = AsyncData(session);
  }

  Future<void> signOut() async {
    final accountId = state.value?.accountId;
    final api = ref.read(workspaceApiProvider);
    final store = ref.read(localStoreProvider);
    state = const AsyncData(null);
    await Future.wait([
      api.signOut(),
      if (accountId != null) store.clearAccount(api.cacheScope(accountId)),
    ]);
  }
}

class RunList {
  const RunList(this.rows, {this.isCached = false});

  final List<Json> rows;
  final bool isCached;
}

final runsProvider = FutureProvider.autoDispose<RunList>((ref) async {
  final accountId = ref.watch(
    sessionProvider.select((state) => state.value?.accountId),
  );
  if (accountId == null) return const RunList([]);
  final api = ref.watch(workspaceApiProvider);
  final store = ref.watch(localStoreProvider);
  final scope = api.cacheScope(accountId);
  try {
    final rows = await api.runs();
    if (ref.mounted) {
      try {
        await store.writeRuns(scope, jsonEncode(rows));
      } on Exception {
        // A local cache failure does not invalidate a fresh response.
      }
    }
    return RunList(rows);
  } on ApiException catch (error) {
    if (!error.isTransient || !ref.mounted) rethrow;
    String? saved;
    try {
      saved = await store.readRuns(scope);
    } on Exception {
      throw error;
    }
    if (saved == null) rethrow;
    return RunList(jsonRows(jsonDecode(saved)), isCached: true);
  }
}, retry: (_, _) => null);

final basketProvider = AsyncNotifierProvider<BasketController, List<Json>>(
  BasketController.new,
  retry: (_, _) => null,
);

class BasketController extends AsyncNotifier<List<Json>> {
  @override
  Future<List<Json>> build() async {
    final accountId = ref.watch(
      sessionProvider.select((state) => state.value?.accountId),
    );
    if (accountId == null) return const [];
    final scope = ref.watch(workspaceApiProvider).cacheScope(accountId);
    return ref.watch(localStoreProvider).basket(scope);
  }

  Future<void> setQuantity(Json product, int quantity) async {
    final scope = _requireScope();
    final rows = await ref
        .read(localStoreProvider)
        .setBasketQuantity(scope, product, quantity);
    if (ref.mounted && _scope == scope) state = AsyncData(rows);
  }

  Future<void> clear() async {
    final scope = _requireScope();
    await ref.read(localStoreProvider).clearBasket(scope);
    if (ref.mounted && _scope == scope) state = const AsyncData([]);
  }

  String? get _scope {
    final accountId = ref.read(sessionProvider).value?.accountId;
    return accountId == null
        ? null
        : ref.read(workspaceApiProvider).cacheScope(accountId);
  }

  String _requireScope() =>
      _scope ??
      (throw const ApiException(
        'Sign in to your account.',
        status: 401,
        code: 'login_required',
      ));
}

class AppPreferences {
  const AppPreferences({
    this.locale = const Locale('en'),
    this.themeMode = ThemeMode.system,
  });

  final Locale locale;
  final ThemeMode themeMode;
}

final preferencesProvider =
    AsyncNotifierProvider<PreferencesController, AppPreferences>(
      PreferencesController.new,
      retry: (_, _) => null,
    );

class PreferencesController extends AsyncNotifier<AppPreferences> {
  final _preferences = SharedPreferencesAsync();
  static const _languageKey = 'cosign.language';
  static const _themeKey = 'cosign.theme';

  @override
  Future<AppPreferences> build() async {
    final values = await Future.wait([
      _preferences.getString(_languageKey),
      _preferences.getString(_themeKey),
    ]);
    final language = values[0] == 'fi' ? 'fi' : 'en';
    final mode = ThemeMode.values.asNameMap()[values[1]] ?? ThemeMode.system;
    return AppPreferences(locale: Locale(language), themeMode: mode);
  }

  Future<void> setLocale(Locale locale) async {
    if (!const ['en', 'fi'].contains(locale.languageCode)) return;
    await _preferences.setString(_languageKey, locale.languageCode);
    if (!ref.mounted) return;
    final previous = state.value ?? const AppPreferences();
    state = AsyncData(
      AppPreferences(locale: locale, themeMode: previous.themeMode),
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await _preferences.setString(_themeKey, mode.name);
    if (!ref.mounted) return;
    final previous = state.value ?? const AppPreferences();
    state = AsyncData(AppPreferences(locale: previous.locale, themeMode: mode));
  }
}
