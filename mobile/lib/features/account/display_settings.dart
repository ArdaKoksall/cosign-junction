import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/workspace.dart';
import '../../ui/brand.dart';

enum _DisplayChoice { english, finnish, system, light, dark }

class DisplayMenu extends ConsumerWidget {
  const DisplayMenu({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferences = ref.watch(preferencesProvider).value;
    final themeMode = preferences?.themeMode ?? ThemeMode.system;
    return PopupMenuButton<_DisplayChoice>(
      tooltip: context.t('Language and appearance', 'Kieli ja ulkoasu'),
      icon: const Icon(Icons.tune_outlined),
      position: PopupMenuPosition.under,
      onSelected: (choice) async {
        final controller = ref.read(preferencesProvider.notifier);
        try {
          switch (choice) {
            case _DisplayChoice.english:
              await controller.setLocale(const Locale('en'));
            case _DisplayChoice.finnish:
              await controller.setLocale(const Locale('fi'));
            case _DisplayChoice.system:
              await controller.setThemeMode(ThemeMode.system);
            case _DisplayChoice.light:
              await controller.setThemeMode(ThemeMode.light);
            case _DisplayChoice.dark:
              await controller.setThemeMode(ThemeMode.dark);
          }
        } catch (_) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  context.t(
                    'Could not save display settings.',
                    'Näyttöasetuksia ei voitu tallentaa.',
                  ),
                ),
              ),
            );
          }
        }
      },
      itemBuilder: (context) => [
        CheckedPopupMenuItem(
          value: _DisplayChoice.english,
          checked: !context.isFinnish,
          child: const Text('English'),
        ),
        CheckedPopupMenuItem(
          value: _DisplayChoice.finnish,
          checked: context.isFinnish,
          child: const Text('Suomi'),
        ),
        const PopupMenuDivider(),
        CheckedPopupMenuItem(
          value: _DisplayChoice.system,
          checked: themeMode == ThemeMode.system,
          child: Text(context.t('System theme', 'Järjestelmän teema')),
        ),
        CheckedPopupMenuItem(
          value: _DisplayChoice.light,
          checked: themeMode == ThemeMode.light,
          child: Text(context.t('Light theme', 'Vaalea teema')),
        ),
        CheckedPopupMenuItem(
          value: _DisplayChoice.dark,
          checked: themeMode == ThemeMode.dark,
          child: Text(context.t('Dark theme', 'Tumma teema')),
        ),
      ],
    );
  }
}
