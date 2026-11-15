import 'package:material_ui/material_ui.dart';

import '../../data/workspace.dart';
import 'request_ui.dart';

class RequestProgress extends StatelessWidget {
  const RequestProgress({super.key, required this.run});

  final Json run;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    final steps = [
      copy(context, 'Request', 'Pyyntö'),
      copy(context, 'Lookup', 'Tarkistus'),
      copy(context, 'Draft', 'Luonnos'),
      copy(context, 'Decision', 'Päätös'),
    ];
    final status = run['status'];
    final hasDraft = run['draft'] != null;
    final decided = const {
      'approved',
      'ready',
      'rejected',
      'completed',
    }.contains(status);
    final completed = hasDraft
        ? (decided ? 4 : 3)
        : (run['comparison'] == null ? 1 : 2);
    final ended = decided || status == 'cancelled';
    return Panel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < steps.length; i++)
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedContainer(
                    duration: reducedMotion
                        ? Duration.zero
                        : const Duration(milliseconds: 240),
                    curve: Curves.easeOutCubic,
                    height: 4,
                    margin: EdgeInsetsDirectional.only(
                      end: i == steps.length - 1 ? 0 : 4,
                    ),
                    decoration: BoxDecoration(
                      color: i < completed
                          ? colors.primary
                          : !ended && i == completed
                          ? colors.tertiary
                          : colors.outlineVariant,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  const SizedBox(height: 7),
                  Semantics(
                    selected: !ended && i == completed,
                    label: i < completed
                        ? copy(
                            context,
                            '${steps[i]} complete',
                            '${steps[i]} valmis',
                          )
                        : steps[i],
                    excludeSemantics: true,
                    child: Text(
                      steps[i],
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: i <= completed
                            ? colors.onSurface
                            : colors.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class DraftDecision extends StatelessWidget {
  const DraftDecision({
    super.key,
    required this.status,
    required this.draft,
    required this.approvalReasons,
    required this.revision,
    required this.onApprove,
    required this.onDecline,
    required this.supplierCheckoutAvailable,
    required this.orderRehearsalAvailable,
    required this.onRehearse,
    required this.canRefresh,
    required this.onRefresh,
  });

  final Object? status;
  final Json draft;
  final List<String> approvalReasons;
  final int revision;
  final VoidCallback? onApprove;
  final VoidCallback? onDecline;
  final bool supplierCheckoutAvailable;
  final bool orderRehearsalAvailable;
  final VoidCallback? onRehearse;
  final bool canRefresh;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final awaiting = status == 'awaiting_approval';
    final reviewed = status == 'approved' || status == 'rejected';
    final showRehearsal =
        orderRehearsalAvailable && (status == 'approved' || status == 'ready');
    final amount = draft['totalCents'];
    final limit = object(draft['policy'])?['automaticLimitCents'];
    final aboveLimit = amount is num && limit is num && amount > limit;
    final hasCaveats = strings(draft['caveats']).isNotEmpty;
    final (IconData icon, String title) = switch (status) {
      'awaiting_approval' => (
        Icons.verified_user_outlined,
        copy(
          context,
          'Buyer approval required',
          'Ostajan hyväksyntä tarvitaan',
        ),
      ),
      'approved' => (
        Icons.check_circle_outline,
        copy(context, 'Buyer approved', 'Ostaja hyväksyi'),
      ),
      'rejected' => (
        Icons.cancel_outlined,
        copy(context, 'Buyer declined', 'Ostaja hylkäsi'),
      ),
      'ready' => (
        Icons.verified_outlined,
        copy(
          context,
          'Within automatic authority',
          'Automaattisen ostovaltuuden rajoissa',
        ),
      ),
      _ => (Icons.receipt_long_outlined, copy(context, 'Decision', 'Päätös')),
    };
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            liveRegion: true,
            child: Row(
              children: [
                Icon(icon, color: colors.primary, size: 23),
                const SizedBox(width: 10),
                Expanded(child: Text(title, style: theme.textTheme.titleLarge)),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (aboveLimit && awaiting)
            Text(
              copy(
                context,
                'The total exceeds the automatic spending limit of ${euros(context, limit)}.',
                'Summa ylittää automaattisen ${euros(context, limit)} ostorajan.',
              ),
            ),
          if (hasCaveats && awaiting)
            Text(
              copy(
                context,
                'Review the pricing and delivery notes in the draft.',
                'Tarkista luonnoksen hinta- ja toimitushuomiot.',
              ),
            ),
          if (reviewed)
            Text(copy(context, 'Revision $revision', 'Versio $revision')),
          if (status == 'ready' && limit is num)
            Text(
              copy(
                context,
                'Automatic spending limit ${euros(context, limit)}, ex VAT.',
                'Automaattinen ostoraja ${euros(context, limit)}, alv 0 %.',
              ),
            ),
          for (final reason in approvalReasons)
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(reason, style: TextStyle(color: colors.error)),
            ),
          if (awaiting) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: onApprove,
                  icon: const Icon(Icons.check, size: 18),
                  label: Text(
                    copy(context, 'Approve draft', 'Hyväksy luonnos'),
                  ),
                ),
                OutlinedButton(
                  onPressed: onDecline,
                  child: Text(copy(context, 'Decline', 'Hylkää')),
                ),
              ],
            ),
          ],
          if (showRehearsal) ...[
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: onRehearse,
              icon: const Icon(Icons.receipt_long_outlined, size: 18),
              label: Text(
                copy(
                  context,
                  'Save rehearsal receipt',
                  'Tallenna harjoituskuitti',
                ),
              ),
            ),
          ],
          if (canRefresh)
            TextButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh),
              label: Text(
                copy(
                  context,
                  'Refresh draft prices',
                  'Päivitä luonnoksen hinnat',
                ),
              ),
            ),
          if (!supplierCheckoutAvailable) ...[
            const SizedBox(height: 8),
            Text(
              copy(
                context,
                'Cosign records this decision here. Supplier checkout is unavailable.',
                'Cosign tallentaa päätöksen tähän. Tilausta ei voi lähettää toimittajalle.',
              ),
              style: theme.textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class RehearsalReceipt extends StatelessWidget {
  const RehearsalReceipt({super.key, required this.receipt});

  final Json receipt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = receipt['totalCents'];
    final id = nonempty(receipt['receiptId']);
    final revision = receipt['revision'];
    final authorizedByBuyer = receipt['authorization'] == 'buyer_approval';
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            liveRegion: true,
            child: Text(
              copy(
                context,
                'Rehearsal receipt saved',
                'Harjoituskuitti tallennettu',
              ),
              style: theme.textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            copy(
              context,
              'Simulated order. The supplier receives no order.',
              'Simuloitu tilaus. Toimittajalle ei lähetetä tilausta.',
            ),
          ),
          if (total is num)
            Text(
              copy(
                context,
                '${euros(context, total)} ex VAT',
                '${euros(context, total)}, alv 0 %',
              ),
              style: theme.textTheme.titleMedium,
            ),
          if (revision is int)
            Text(
              authorizedByBuyer
                  ? copy(
                      context,
                      'Revision $revision · Buyer approved',
                      'Versio $revision · Ostaja hyväksyi',
                    )
                  : copy(
                      context,
                      'Revision $revision · Within automatic authority',
                      'Versio $revision · Automaattinen ostovaltuus',
                    ),
            ),
          if (receipt['createdAt'] != null)
            Text(instant(context, receipt['createdAt'], includeTime: true)),
          if (id != null) SelectableText(id, style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}
