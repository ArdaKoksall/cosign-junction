import 'package:material_ui/material_ui.dart';

ThemeData cosignTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final canvas = dark ? Colors.black : const Color(0xFFF2F6FA);
  final colors =
      ColorScheme.fromSeed(
        seedColor: const Color(0xFF14618D),
        brightness: brightness,
      ).copyWith(
        primary: dark ? const Color(0xFF89CBF7) : const Color(0xFF14618D),
        onPrimary: dark ? const Color(0xFF102B41) : Colors.white,
        primaryContainer: dark
            ? const Color(0xFF262626)
            : const Color(0xFFE2EFF8),
        onPrimaryContainer: dark
            ? const Color(0xFFB7E3FF)
            : const Color(0xFF0A4973),
        secondaryContainer: dark
            ? const Color(0xFF262626)
            : const Color(0xFFE2EFF8),
        onSecondaryContainer: dark
            ? const Color(0xFFB7E3FF)
            : const Color(0xFF0A4973),
        surface: dark ? const Color(0xFF141414) : Colors.white,
        onSurface: dark ? const Color(0xFFF5F5F5) : const Color(0xFF152E43),
        onSurfaceVariant: dark
            ? const Color(0xFFBDBDBD)
            : const Color(0xFF4A6276),
        outline: dark ? const Color(0xFF777777) : const Color(0xFF788EA2),
        outlineVariant: dark
            ? const Color(0xFF303030)
            : const Color(0xFFD7E3EE),
        error: dark ? const Color(0xFFFFACAC) : const Color(0xFF962B35),
        errorContainer: dark
            ? const Color(0xFF3C2426)
            : const Color(0xFFFCE7E8),
        onErrorContainer: dark
            ? const Color(0xFFFFACAC)
            : const Color(0xFF962B35),
        surfaceTint: Colors.transparent,
      );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: colors,
    fontFamily: 'DM Sans',
    scaffoldBackgroundColor: canvas,
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.onSurface,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 68,
      backgroundColor: colors.surface,
      indicatorColor: colors.primaryContainer,
      surfaceTintColor: Colors.transparent,
      labelTextStyle: const WidgetStatePropertyAll(
        TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
      ),
    ),
    cardTheme: CardThemeData(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(14),
      ),
    ),
    dividerTheme: DividerThemeData(color: colors.outlineVariant, space: 1),
    inputDecorationTheme: InputDecorationThemeData(
      filled: true,
      fillColor: colors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(10)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(10)),
        borderSide: BorderSide(color: colors.outlineVariant),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 46),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
  );
  final display = TextStyle(
    color: colors.onSurface,
    fontFamily: 'Barlow Semi Condensed',
    fontWeight: FontWeight.w700,
    height: 1.02,
    letterSpacing: -0.6,
  );
  return base.copyWith(
    textTheme: base.textTheme.copyWith(
      displaySmall: display.copyWith(fontSize: 46),
      headlineLarge: display.copyWith(fontSize: 36),
      headlineMedium: display.copyWith(fontSize: 30),
      headlineSmall: display.copyWith(fontSize: 24),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w700,
      ),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(height: 1.45),
    ),
  );
}
