import 'package:material_ui/material_ui.dart';

import '../../data/workspace.dart';

String agentText(BuildContext context, String english, String finnish) =>
    Localizations.localeOf(context).languageCode == 'fi' ? finnish : english;

class TradeActivity {
  TradeActivity(Json row)
    : id = int.tryParse('${row['id']}') ?? 0,
      runId = row['run_id'] as String?,
      action = row['action'] as String? ?? '',
      status = row['status'] as String? ?? '',
      createdAt = DateTime.tryParse('${row['created_at']}'),
      data = activityRecord(row['data']);

  final int id;
  final String? runId;
  final String action;
  final String status;
  final DateTime? createdAt;
  final Json data;
}

Json activityRecord(Object? value) => value is Json ? value : const {};

List<Json> activityRows(Object? value) =>
    value is List ? value.whereType<Json>().toList() : const [];

class ActivityPage {
  const ActivityPage(this.events, this.hasMore);

  final List<TradeActivity> events;
  final bool hasMore;
}

Future<ActivityPage> nextActivityPage(
  WorkspaceApi api, {
  String? runId,
  required int after,
}) async {
  const pageSize = 200;
  final events = <TradeActivity>[];
  for (var page = 0; page < 5; page++) {
    final rows = await api.events(runId: runId, after: after);
    final next = rows
        .map(TradeActivity.new)
        .where((event) => event.id > after)
        .toList();
    if (next.isEmpty) return ActivityPage(events, false);
    events.addAll(next);
    after = next.last.id;
    if (rows.length < pageSize) return ActivityPage(events, false);
  }
  return ActivityPage(events, true);
}

String tradeStatus(BuildContext context, String status) {
  final (en, fi) = switch (status) {
    'active' => ('Active', 'Aktiivinen'),
    'approved' => ('Approved', 'Hyväksytty'),
    'awaiting_approval' => ('Awaiting approval', 'Odottaa hyväksyntää'),
    'cancelled' => ('Cancelled', 'Peruttu'),
    'completed' => ('Completed', 'Valmis'),
    'failed' => ('Failed', 'Epäonnistunut'),
    'needs_attention' => ('Needs attention', 'Vaatii huomiota'),
    'queued' => ('Queued', 'Jonossa'),
    'ready' => ('Draft ready', 'Luonnos valmis'),
    'rejected' => ('Declined', 'Hylätty'),
    'running' || 'started' => ('In progress', 'Käsittelyssä'),
    _ => (status.replaceAll('_', ' '), status.replaceAll('_', ' ')),
  };
  return agentText(context, en, fi);
}

String activityTitle(BuildContext context, String action) {
  final (en, fi) = switch (action) {
    'agent_job' => ('Assistant task', 'Avustajan tehtävä'),
    'amend_request' => ('Item updated', 'Tuote päivitetty'),
    'human_approval' => ('Draft approved', 'Luonnos hyväksytty'),
    'browse_catalog' || 'search_products' => ('Product search', 'Tuotehaku'),
    'buyer_message' => ('Buyer message', 'Ostajan viesti'),
    'cancel' => ('Task stopped', 'Tehtävä pysäytetty'),
    'compare_products' => ('Price and availability', 'Hinta ja saatavuus'),
    'connection_revoked' => ('Connection revoked', 'Yhteys katkaistu'),
    'create_request' => ('Purchase request', 'Hankintapyyntö'),
    'get_account_context' => ('Purchase permissions', 'Ostovaltuudet'),
    'get_activity' => ('Activity lookup', 'Tapahtumahaku'),
    'get_product_details' => ('Product details', 'Tuotetiedot'),
    'get_request_status' => ('Request status', 'Pyynnön tila'),
    'list_requests' => ('Request lookup', 'Pyyntöhaku'),
    'model_request' => ('Forming a response', 'Valmistellaan vastausta'),
    'model_response' => ('Assistant response', 'Avustajan vastaus'),
    'order_rehearsal' => (
      'Rehearsal receipt saved',
      'Harjoituskuitti tallennettu',
    ),
    'place_order' => ('Order rehearsal', 'Tilausharjoitus'),
    'policy_updated' => (
      'Purchasing rules updated',
      'Hankintasäännöt päivitetty',
    ),
    'prepare_order' => ('Purchase draft', 'Tilausluonnos'),
    'human_rejection' => ('Draft declined', 'Luonnos hylätty'),
    'remove_request_items' => ('Items removed', 'Tuotteita poistettu'),
    'update_request_preferences' => (
      'Preferences updated',
      'Toiveet päivitetty',
    ),
    _ => (action.replaceAll('_', ' '), action.replaceAll('_', ' ')),
  };
  return agentText(context, en, fi);
}

IconData activityIcon(String action) => switch (action) {
  'agent_job' ||
  'buyer_message' ||
  'model_request' ||
  'model_response' => Icons.chat_bubble_outline,
  'browse_catalog' || 'search_products' => Icons.search_rounded,
  'compare_products' => Icons.compare_arrows_rounded,
  'get_account_context' || 'policy_updated' => Icons.verified_user_outlined,
  'get_product_details' => Icons.inventory_2_outlined,
  'prepare_order' || 'order_rehearsal' => Icons.receipt_long_outlined,
  'place_order' => Icons.local_shipping_outlined,
  'connection_revoked' => Icons.link_off_rounded,
  'human_approval' => Icons.check_circle_outline,
  'cancel' || 'human_rejection' => Icons.cancel_outlined,
  _ => Icons.history_rounded,
};

String agentError(BuildContext context, Object error) {
  if (error is ApiException) {
    final (en, fi) = switch (error.code) {
      'agent_unavailable' => (
        'The server has not configured NVIDIA Nemotron.',
        'Palvelimella ei ole määritetty NVIDIA Nemotronia.',
      ),
      'too_many_jobs' => (
        'Three assistant tasks are already active. Wait for a task to finish.',
        'Kolme avustajan tehtävää on jo käynnissä. Odota tehtävän valmistumista.',
      ),
      'login_required' => (
        'Your session expired. Sign in again.',
        'Istuntosi vanheni. Kirjaudu uudelleen.',
      ),
      _ => (error.message, error.message),
    };
    return agentText(context, en, fi);
  }
  return agentText(
    context,
    'Could not load data from the workspace.',
    'Työtilan tietoja ei voitu ladata.',
  );
}
