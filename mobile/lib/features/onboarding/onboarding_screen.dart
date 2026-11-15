import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../ui/brand.dart';
import '../account/display_settings.dart';
import 'profile.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final Map<String, String> _answers = {};
  int _step = 0;
  bool _saving = false;
  bool _saveFailed = false;

  Future<void> _finish({bool skip = false}) async {
    setState(() {
      _saving = true;
      _saveFailed = false;
    });
    try {
      await ref.read(profileProvider.notifier).complete(skip ? {} : _answers);
    } catch (_) {
      if (mounted) setState(() => _saveFailed = true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _advance({bool skip = false}) {
    if (skip) _answers.remove(profileQuestions[_step].id);
    if (_step + 1 == profileQuestions.length) {
      _finish();
    } else {
      setState(() => _step++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final question = profileQuestions[_step];
    final theme = Theme.of(context);
    final lastStep = _step + 1 == profileQuestions.length;
    return Scaffold(
      appBar: AppBar(
        title: const CosignBrand(),
        actions: [
          TextButton(
            onPressed: _saving ? null : () => _finish(skip: true),
            child: Text(context.t('Skip setup', 'Ohita kysely')),
          ),
          const DisplayMenu(),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 540),
            child: ListView(
              key: ValueKey(_step),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(18),
                  child: ColoredBox(
                    color: heroColor(context),
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            context.t(
                              'Make Cosign yours',
                              'Muokkaa Cosign omaksesi',
                            ),
                            style: theme.textTheme.headlineLarge?.copyWith(
                              color: onHero,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            context.t(
                              'Share a few details to get product and order suggestions for your business.',
                              'Kerro hieman yrityksestäsi, niin saat sopivia tuote- ja tilausehdotuksia.',
                            ),
                            style: TextStyle(color: heroMuted(context)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                LinearProgressIndicator(
                  value: (_step + 1) / profileQuestions.length,
                  borderRadius: BorderRadius.circular(5),
                  semanticsLabel: context.t(
                    'Setup progress',
                    'Kyselyn edistyminen',
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  context.t(
                    'Question ${_step + 1} of ${profileQuestions.length}',
                    'Kysymys ${_step + 1}/${profileQuestions.length}',
                  ),
                  style: theme.textTheme.labelMedium,
                ),
                const SizedBox(height: 8),
                Semantics(
                  header: true,
                  liveRegion: true,
                  child: Text(
                    context.t(question.title.en, question.title.fi),
                    style: theme.textTheme.headlineMedium,
                  ),
                ),
                const SizedBox(height: 16),
                RadioGroup<String>(
                  groupValue: _answers[question.id],
                  onChanged: (value) {
                    if (!_saving && value != null) {
                      setState(() => _answers[question.id] = value);
                    }
                  },
                  child: Column(
                    children: [
                      for (final option in question.options)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Card(
                            child: RadioListTile<String>(
                              value: option.id,
                              enabled: !_saving,
                              title: Text(context.t(option.en, option.fi)),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: Material(
        color: theme.colorScheme.surface,
        child: SafeArea(
          top: false,
          child: Center(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 540),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 2),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_saveFailed)
                      Text(
                        context.t(
                          'Could not save your setup. Try again.',
                          'Asetuksia ei voitu tallentaa. Yritä uudelleen.',
                        ),
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    FilledButton(
                      onPressed: !_saving && _answers.containsKey(question.id)
                          ? _advance
                          : null,
                      child: Text(
                        lastStep
                            ? context.t('Finish setup', 'Valmis')
                            : context.t('Continue', 'Jatka'),
                      ),
                    ),
                    Wrap(
                      alignment: _step > 0
                          ? WrapAlignment.spaceBetween
                          : WrapAlignment.end,
                      children: [
                        if (_step > 0)
                          TextButton(
                            onPressed: _saving
                                ? null
                                : () => setState(() => _step--),
                            child: Text(context.t('Back', 'Takaisin')),
                          ),
                        TextButton(
                          onPressed: _saving
                              ? null
                              : () => _advance(skip: true),
                          child: Text(
                            context.t('Skip question', 'Ohita kysymys'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
