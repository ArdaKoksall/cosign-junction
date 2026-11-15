import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/workspace.dart';
import '../../ui/brand.dart';
import 'display_settings.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, this.connectionFailed = false});

  final bool connectionFailed;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _showPassword = false;
  String? _errorCode;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _errorCode = null;
    });
    try {
      await ref
          .read(sessionProvider.notifier)
          .signIn(_email.text.trim(), _password.text);
      TextInput.finishAutofillContext();
    } on ApiException catch (error) {
      if (mounted) setState(() => _errorCode = error.code ?? 'unavailable');
    } catch (_) {
      if (mounted) setState(() => _errorCode = 'unavailable');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final errorCode =
        _errorCode ?? (widget.connectionFailed ? 'unavailable' : null);
    return Scaffold(
      appBar: AppBar(
        title: const CosignBrand(),
        actions: const [DisplayMenu(), SizedBox(width: 4)],
      ),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 540),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: ColoredBox(
                    color: heroColor(context),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 19, 20, 24),
                          child: Text(
                            context.t(
                              'Purchasing with your approval',
                              'Hankinnat sinun päätökselläsi',
                            ),
                            style: theme.textTheme.headlineLarge?.copyWith(
                              color: onHero,
                            ),
                          ),
                        ),
                        Image.asset(
                          marketPhoto,
                          height: 128,
                          fit: BoxFit.cover,
                          excludeFromSemantics: true,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                WorkspacePanel(
                  padding: 18,
                  child: AutofillGroup(
                    onDisposeAction: AutofillContextAction.cancel,
                    child: Form(
                      key: _form,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            context.t('Sign in', 'Kirjaudu sisään'),
                            style: theme.textTheme.headlineMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            context.t(
                              'Review purchasing activity and manage your assistants.',
                              'Tarkastele hankintoja ja hallitse avustajiasi.',
                            ),
                            style: TextStyle(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 18),
                          TextFormField(
                            controller: _email,
                            enabled: !_busy,
                            autofillHints: const [
                              AutofillHints.username,
                              AutofillHints.email,
                            ],
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            decoration: InputDecoration(
                              labelText: context.t('Email', 'Sähköposti'),
                            ),
                            validator: (value) =>
                                (value?.trim().contains('@') ?? false)
                                ? null
                                : context.t(
                                    'Enter your email address.',
                                    'Anna sähköpostiosoitteesi.',
                                  ),
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _password,
                            enabled: !_busy,
                            autofillHints: const [AutofillHints.password],
                            obscureText: !_showPassword,
                            textInputAction: TextInputAction.done,
                            onFieldSubmitted: (_) => _signIn(),
                            decoration: InputDecoration(
                              labelText: context.t('Password', 'Salasana'),
                              suffixIcon: IconButton(
                                tooltip: _showPassword
                                    ? context.t(
                                        'Hide password',
                                        'Piilota salasana',
                                      )
                                    : context.t(
                                        'Show password',
                                        'Näytä salasana',
                                      ),
                                icon: Icon(
                                  _showPassword
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                ),
                                onPressed: () => setState(
                                  () => _showPassword = !_showPassword,
                                ),
                              ),
                            ),
                            validator: (value) => (value?.isNotEmpty ?? false)
                                ? null
                                : context.t(
                                    'Enter your password.',
                                    'Anna salasanasi.',
                                  ),
                          ),
                          if (errorCode != null) ...[
                            const SizedBox(height: 12),
                            Semantics(
                              liveRegion: true,
                              child: Text(
                                errorCode == 'invalid_login'
                                    ? context.t(
                                        'Email or password is incorrect.',
                                        'Sähköposti tai salasana on virheellinen.',
                                      )
                                    : context.t(
                                        'Could not connect. Try signing in again.',
                                        'Yhteyttä ei saatu. Yritä kirjautua uudelleen.',
                                      ),
                                style: TextStyle(
                                  color: theme.colorScheme.error,
                                ),
                              ),
                            ),
                          ],
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: _busy ? null : _signIn,
                            icon: _busy
                                ? const SizedBox(
                                    width: 17,
                                    height: 17,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.north_east, size: 18),
                            label: Text(
                              context.t('Sign in', 'Kirjaudu sisään'),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            context.t(
                              'Your administrator provides account access.',
                              'Järjestelmänvalvojasi myöntää käyttöoikeuden.',
                            ),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
