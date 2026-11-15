import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

typedef Json = Map<String, dynamic>;

class ApiException implements Exception {
  const ApiException(this.message, {this.status, this.code});

  final String message;
  final int? status;
  final String? code;

  bool get isTransient =>
      (status == null && code == 'connection_failed') ||
      status == 429 ||
      (status != null && status! >= 500);

  @override
  String toString() => message;
}

class Session {
  const Session({
    required this.accountId,
    required this.name,
    required this.email,
    required this.policy,
    required this.mcpUrl,
    required this.nemotronModel,
    required this.supplierCheckoutAvailable,
    this.orderRehearsalAvailable = false,
  });

  factory Session.fromJson(Json json) {
    final account = jsonObject(json['account']);
    return Session(
      accountId: requiredString(account['id']),
      name: requiredString(account['name']),
      email: requiredString(account['email']),
      policy: jsonObject(account['policy']),
      mcpUrl: requiredString(json['mcpUrl']),
      nemotronModel: json['nemotronModel'] as String?,
      supplierCheckoutAvailable: json['supplierCheckoutAvailable'] == true,
      orderRehearsalAvailable: json['orderRehearsalAvailable'] == true,
    );
  }

  final String accountId;
  final String name;
  final String email;
  final Json policy;
  final String mcpUrl;
  final String? nemotronModel;
  final bool supplierCheckoutAvailable;
  final bool orderRehearsalAvailable;
}

class WorkspaceApi {
  WorkspaceApi({
    required Uri apiOrigin,
    required Uri publicOrigin,
    required this._storage,
    Dio? dio,
  }) : _dio = dio ?? Dio(),
       _apiOrigin = apiOrigin,
       _publicOrigin = publicOrigin,
       _scope = base64Url.encode(
         utf8.encode('${apiOrigin.origin}|${publicOrigin.origin}'),
       ),
       _cookieName = publicOrigin.scheme == 'https'
           ? '__Host-trade_session'
           : 'trade_session';

  factory WorkspaceApi.configured() {
    const apiUrl = String.fromEnvironment(
      'COSIGN_API_URL',
      defaultValue: kDebugMode ? 'http://localhost:8080' : '',
    );
    if (apiUrl.isEmpty) {
      throw const ApiException('Set COSIGN_API_URL to your HTTPS workspace origin.');
    }
    const publicUrl = String.fromEnvironment('COSIGN_PUBLIC_ORIGIN');
    final apiOrigin = _configuredOrigin(apiUrl);
    final publicOrigin = publicUrl.isEmpty
        ? apiOrigin
        : _configuredOrigin(publicUrl);
    if (apiOrigin.scheme == 'http' && publicOrigin.scheme == 'https') {
      throw const ApiException('A secure workspace requires an HTTPS API URL.');
    }
    return WorkspaceApi(
      apiOrigin: apiOrigin,
      publicOrigin: publicOrigin,
      storage: const FlutterSecureStorage(
        iOptions: IOSOptions(
          accessibility: KeychainAccessibility.unlocked_this_device,
        ),
      ),
    );
  }

  final Dio _dio;
  final FlutterSecureStorage _storage;
  final Uri _apiOrigin;
  final Uri _publicOrigin;
  final String _scope;
  final String _cookieName;
  final _sessionEvents = StreamController<void>.broadcast();
  Future<void> _storageUpdates = Future<void>.value();
  String? _cookie;
  int _credentialVersion = 0;
  bool _signingIn = false;
  bool _disposed = false;

  Stream<void> get sessionExpired => _sessionEvents.stream;
  String cacheScope(String accountId) => '$_scope:$accountId';
  String get _storageKey => 'cosign.session.$_scope';

  static Uri _configuredOrigin(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        (uri.path.isNotEmpty && uri.path != '/') ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.scheme != 'https' && !(kDebugMode && uri.scheme == 'http'))) {
      throw const ApiException('Configure a valid HTTPS workspace origin.');
    }
    return Uri.parse(uri.origin);
  }

  Future<Session?> restoreSession() async {
    if (_cookie == null) {
      final version = _credentialVersion;
      await _storageUpdates;
      final stored = await _storage.read(key: _storageKey);
      if (version == _credentialVersion) _cookie ??= stored;
    }
    if (_cookie == null) return null;
    try {
      return await session();
    } on ApiException catch (error) {
      if (error.code == 'login_required') return null;
      rethrow;
    }
  }

  Future<Session> session() async =>
      Session.fromJson(await _object('/session'));

  Future<Session> signIn(String email, String password) async {
    if (_signingIn) {
      throw const ApiException('A sign-in is already in progress.');
    }
    _signingIn = true;
    try {
      final response = await _send(
        '/login',
        body: {'email': email.trim(), 'password': password},
        authenticated: false,
      );
      final cookie = _sessionCookie(response);
      if (cookie == null) {
        throw const ApiException('The workspace did not return a session.');
      }
      _credentialVersion++;
      _cookie = cookie;
      try {
        final signedIn = await session();
        await _storeCookie(cookie);
        if (_cookie != cookie) throw _loginRequired;
        return signedIn;
      } catch (_) {
        if (_cookie == cookie) await _forgetCookie();
        rethrow;
      }
    } finally {
      _signingIn = false;
    }
  }

  Future<void> signOut() async {
    final current = _cookie;
    await Future.wait([
      _forgetCookie(),
      if (current != null) _revokeSession(current),
    ]);
  }

  Future<void> _revokeSession(String current) async {
    try {
      await _send(
        '/logout',
        body: {},
        authenticated: false,
        credential: current,
      );
    } on ApiException catch (error) {
      if (error.status != 401 && !error.isTransient) rethrow;
    }
  }

  Future<List<Json>> runs() => _list('/runs');

  Future<Json> run(String id) => _object(_runPath(id));

  Future<Json> browseCatalog(String query, {int limit = 12, int offset = 0}) =>
      _tool('browse_catalog', {
        'query': query,
        'limit': limit,
        'offset': offset,
      });

  Future<Json> getProductDetails(String productId) =>
      _tool('get_product_details', {'productId': productId});

  Future<Json> createRequest(Json body) => _tool('create_request', body);

  Future<Json> searchProducts(String id, {String? itemId, String? query}) =>
      _tool('search_products', {
        'runId': id,
        'itemId': ?itemId,
        'query': ?query,
      });

  Future<Json> compareProducts(String id, int revision) =>
      _tool('compare_products', {'runId': id, 'revision': revision});

  Future<Json> updateRequestPreferences(Json body) =>
      _tool('update_request_preferences', body);

  Future<Json> amendRequest(
    String id,
    int revision,
    Json item, {
    String? itemId,
  }) => _tool('amend_request', {
    'runId': id,
    'revision': revision,
    'item': item,
    'itemId': ?itemId,
  });

  Future<Json> removeRequestItems(
    String id,
    int revision,
    List<String> itemIds,
  ) => _tool('remove_request_items', {
    'runId': id,
    'revision': revision,
    'itemIds': itemIds,
  });

  Future<Json> prepareOrder(
    String id,
    int revision, {
    String? productId,
    String? availableDate,
    List<Json>? selections,
  }) => _tool('prepare_order', {
    'runId': id,
    'revision': revision,
    'productId': ?productId,
    'availableDate': ?availableDate,
    'selections': ?selections,
  });

  Future<Json> decide(String id, int revision, {required bool approve}) =>
      _object(
        '${_runPath(id)}/decision',
        body: {'revision': revision, 'approve': approve},
      );

  Future<Json> rehearseOrder(String id, int revision) => _tool('place_order', {
    'runId': id,
    'revision': revision,
    'idempotencyKey': 'mobile-rehearsal:$id:$revision',
    'mode': 'rehearsal',
  });

  Future<void> cancel(String id) async {
    await _object('${_runPath(id)}/cancel', body: {});
  }

  Future<List<Json>> events({String? runId, int after = 0}) =>
      _list('/events', query: {'runId': ?runId, 'after': '$after'});

  Future<List<Json>> runEvents(String runId) async {
    final rows = <Json>[];
    var after = 0;
    while (true) {
      final page = await events(runId: runId, after: after);
      rows.addAll(page);
      if (page.length < 200) return rows;
      final next = int.tryParse('${page.last['id']}');
      if (next == null || next <= after) throw _invalidResponse;
      after = next;
    }
  }

  Future<String> startAgent(String instruction) async => requiredString(
    (await _object('/agent/jobs', body: {'instruction': instruction}))['runId'],
  );

  Future<void> replyToAgent(String id, String instruction) async {
    await _object(
      '/agent/jobs/${Uri.encodeComponent(id)}/reply',
      body: {'instruction': instruction},
    );
  }

  Future<Json> updatePolicy(Json policy) => _object('/policy', body: policy);

  Future<List<Json>> connections() => _list('/connections');

  Future<void> revokeConnection(String id) async {
    await _object('/connections/${Uri.encodeComponent(id)}/revoke', body: {});
  }

  void dispose() {
    _disposed = true;
    _dio.close(force: true);
    unawaited(_sessionEvents.close());
  }

  String _runPath(String id) => '/runs/${Uri.encodeComponent(id)}';

  Future<Json> _tool(String name, Json body) =>
      _object('/tools/$name', body: body);

  Future<Json> _object(String path, {Json? body}) async =>
      jsonObject((await _send(path, body: body)).data);

  Future<List<Json>> _list(String path, {Map<String, String>? query}) async =>
      jsonRows((await _send(path, query: query)).data);

  String? _sessionCookie(Response<dynamic> response) {
    for (final header
        in response.headers[HttpHeaders.setCookieHeader] ?? const <String>[]) {
      final cookie = Cookie.fromSetCookieValue(header);
      if (cookie.name == _cookieName &&
          (cookie.secure || _publicOrigin.scheme == 'http') &&
          cookie.value.isNotEmpty &&
          (cookie.maxAge ?? 1) > 0) {
        return cookie.value;
      }
    }
    return null;
  }

  Future<void> _storeCookie(String? value) {
    final update = _storageUpdates.then((_) async {
      if (value == null) {
        await _storage.delete(key: _storageKey);
      } else {
        await _storage.write(key: _storageKey, value: value);
      }
    });
    _storageUpdates = update.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return update;
  }

  Future<void> _forgetCookie() {
    _credentialVersion++;
    _cookie = null;
    return _storeCookie(null);
  }

  Future<Response<dynamic>> _send(
    String path, {
    Json? body,
    Map<String, String>? query,
    bool authenticated = true,
    String? credential,
  }) async {
    final cookie = authenticated ? _cookie : credential;
    if (authenticated && cookie == null) throw _loginRequired;
    try {
      final response = await _dio.requestUri<dynamic>(
        _apiOrigin.resolve('/api$path').replace(queryParameters: query),
        data: body,
        options: Options(
          method: body == null ? 'GET' : 'POST',
          followRedirects: false,
          headers: {
            HttpHeaders.acceptHeader: 'application/json',
            if (cookie != null)
              HttpHeaders.cookieHeader: '$_cookieName=$cookie',
            if (body != null) ...{
              'Origin': _publicOrigin.origin,
              'X-Requested-With': 'Cosign',
            },
            if (_apiOrigin.host.endsWith('.ngrok-free.dev'))
              'ngrok-skip-browser-warning': 'true',
          },
          contentType: body == null ? null : 'application/json',
          sendTimeout: const Duration(seconds: 20),
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 30),
        ),
      );
      if (authenticated && cookie != _cookie) throw _loginRequired;
      return response;
    } on DioException catch (error) {
      if (authenticated && cookie != _cookie) throw _loginRequired;
      final response = error.response;
      final payload = response?.data;
      final status = response?.statusCode;
      final code = payload is Json ? payload['error'] : null;
      final message = payload is Json ? payload['message'] : null;
      if (authenticated && status == 401) {
        final forgotten = _forgetCookie();
        if (!_disposed) _sessionEvents.add(null);
        // The rejected token is already unusable on the server.
        await forgotten.catchError((Object _) {});
        throw _loginRequired;
      }
      throw ApiException(
        message is String && message.isNotEmpty
            ? message
            : _httpFailureMessage(status),
        status: status,
        code: code is String
            ? code
            : status == null
            ? 'connection_failed'
            : null,
      );
    }
  }
}

const _loginRequired = ApiException(
  'Sign in to your account.',
  status: 401,
  code: 'login_required',
);
const _invalidResponse = ApiException(
  'The workspace returned an unexpected response.',
  code: 'invalid_response',
);

String _httpFailureMessage(int? status) => switch (status) {
  null =>
    'Could not reach your workspace. Check your connection and try again.',
  429 => 'Too many requests. Wait a moment and try again.',
  >= 500 => 'The workspace is unavailable. Try again in a moment.',
  _ => 'The workspace could not complete this request.',
};

Json jsonObject(Object? value) {
  if (value is Json) return value;
  throw _invalidResponse;
}

List<Json> jsonRows(Object? value) {
  if (value is List) return value.map(jsonObject).toList(growable: false);
  throw _invalidResponse;
}

String requiredString(Object? value) {
  if (value is String && value.isNotEmpty) return value;
  throw _invalidResponse;
}
