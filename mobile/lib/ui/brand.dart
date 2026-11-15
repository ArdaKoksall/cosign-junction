import 'package:material_ui/material_ui.dart';

const marketPhoto = 'assets/brand/aimo-market.webp';
const brandMark = 'assets/brand/cosign.png';
const highlight = Color(0xFFA4D9F5);
const onHighlight = Color(0xFF102F46);
const onHero = Color(0xFFF5FAFF);

Color heroColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFF171717)
    : const Color(0xFF0C486B);

Color heroMuted(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFCCCCCC)
    : const Color(0xFFCDE3F3);

extension CosignCopy on BuildContext {
  bool get isFinnish => Localizations.localeOf(this).languageCode == 'fi';

  String t(String english, String finnish) => isFinnish ? finnish : english;
}

class CosignBrand extends StatelessWidget {
  const CosignBrand({super.key, this.inverse = false});

  final bool inverse;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: 'VALIO Cosign',
      excludeSemantics: true,
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset(brandMark, width: 34, height: 34),
            ),
            const SizedBox(width: 8),
            Text.rich(
              TextSpan(
                style: TextStyle(
                  color: inverse ? onHero : colors.onSurface,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.1,
                ),
                children: [
                  const TextSpan(text: 'VALIO:'),
                  TextSpan(
                    text: 'Cosign',
                    style: TextStyle(
                      fontFamily: 'Caveat',
                      color: inverse ? highlight : colors.primary,
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.6,
                    ),
                  ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

class WorkspacePanel extends StatelessWidget {
  const WorkspacePanel({super.key, required this.child, this.padding = 16});

  final Widget child;
  final double padding;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(14),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(padding: EdgeInsets.all(padding), child: child),
    );
  }
}
