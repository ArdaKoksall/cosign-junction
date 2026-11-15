import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../ui/brand.dart';

const _profileKey = 'cosign.purchasingProfile.v1';
final profileProvider =
    AsyncNotifierProvider<ProfileController, PurchasingProfile?>(
      ProfileController.new,
    );

class ProfileController extends AsyncNotifier<PurchasingProfile?> {
  final _preferences = SharedPreferencesAsync();

  @override
  Future<PurchasingProfile?> build() async {
    final stored = await _preferences.getString(_profileKey);
    if (stored == null) return null;
    try {
      final json = jsonDecode(stored);
      if (json is Map<String, Object?>) {
        return PurchasingProfile({
          for (final question in profileQuestions)
            if (question.options.any(
              (option) => option.id == json[question.id],
            ))
              question.id: json[question.id] as String,
        });
      }
    } on FormatException {
      return null;
    }
    return null;
  }

  Future<void> complete(Map<String, String> answers) async {
    final profile = PurchasingProfile(Map.unmodifiable(answers));
    await _preferences.setString(_profileKey, jsonEncode(profile.answers));
    state = AsyncData(profile);
  }
}

class PurchasingProfile {
  const PurchasingProfile(this.answers);

  final Map<String, String> answers;

  List<({String query, String en, String fi})> get catalogSuggestions {
    final suggestions = <({String query, String en, String fi})>[
      ...switch (answers['dietaryPriority']) {
        'vegan' => [
          (query: 'vegan oat drink', en: 'Oat drinks', fi: 'Kaurajuomat'),
        ],
        'vegetarian' => [(query: 'lentil', en: 'Lentils', fi: 'Linssit')],
        'gluten-free' => [
          (
            query: 'gluten-free',
            en: 'Gluten-free options',
            fi: 'Gluteenittomat vaihtoehdot',
          ),
        ],
        'lactose-free' => [
          (
            query: 'lactose-free',
            en: 'Lactose-free options',
            fi: 'Laktoosittomat vaihtoehdot',
          ),
        ],
        _ => [],
      },
      ...switch (answers['businessType']) {
        'restaurant' => [
          (query: 'tomato', en: 'Tomatoes', fi: 'Tomaatit'),
          (query: 'stock', en: 'Cooking stocks', fi: 'Keittoliemet'),
        ],
        'cafe' => [
          (query: 'milk', en: 'Milk', fi: 'Maito'),
          (query: 'coffee', en: 'Coffee', fi: 'Kahvi'),
        ],
        'bakery' => [
          (query: 'flour', en: 'Flour', fi: 'Jauhot'),
          (query: 'butter', en: 'Butter', fi: 'Voi'),
        ],
        'catering' => [
          (query: 'rice', en: 'Rice', fi: 'Riisi'),
          (query: 'potato', en: 'Potatoes', fi: 'Perunat'),
        ],
        'store' => [
          (query: 'bread', en: 'Bread', fi: 'Leipä'),
          (query: 'juice', en: 'Juice', fi: 'Mehu'),
        ],
        _ => [],
      },
    ];
    final excluded = switch (answers['dietaryPriority']) {
      'vegan' || 'lactose-free' => const {'milk', 'butter'},
      'gluten-free' => const {'flour', 'bread'},
      _ => const <String>{},
    };
    return suggestions
        .where((product) => !excluded.contains(product.query))
        .toList();
  }

  String planningPrompt(BuildContext context) {
    final aim = switch (answers['needs']) {
      'restock' => context.t(
        'Help me plan a restock order for my kitchen.',
        'Auta suunnittelemaan keittiöni täydennystilaus.',
      ),
      'compare' => context.t(
        'Help me compare suitable products and prices for my next order.',
        'Auta vertailemaan seuraavaan tilaukseeni sopivia tuotteita ja hintoja.',
      ),
      'menu' => context.t(
        'Help me plan an ingredient order for my menu.',
        'Auta suunnittelemaan ruokalistani raaka-ainetilaus.',
      ),
      'approve' => context.t(
        'Help me prepare a purchase request for review.',
        'Auta valmistelemaan hankintapyyntö tarkistettavaksi.',
      ),
      _ => context.t(
        'Help me plan my next purchase.',
        'Auta suunnittelemaan seuraava hankintani.',
      ),
    };
    final contextLines = [
      for (final question in profileQuestions)
        if (question.id != 'needs')
          for (final option in question.options)
            if (option.id == answers[question.id])
              '${context.t(question.promptLabel.en, question.promptLabel.fi)}: '
                  '${context.t(option.en, option.fi)}.',
    ];
    return [
      aim,
      ...contextLines,
      context.t(
        'Suggest suitable catalog items and ask me for products, quantities, delivery date and per-order budget before creating a request.',
        'Ehdota sopivia valikoiman tuotteita ja kysy tuotteet, määrät, toimituspäivä sekä tilauskohtainen budjetti ennen pyynnön luomista.',
      ),
    ].join('\n');
  }
}

typedef _Copy = ({String en, String fi});
typedef ProfileOption = ({String id, String en, String fi});
typedef ProfileQuestion = ({
  String id,
  _Copy title,
  _Copy promptLabel,
  List<ProfileOption> options,
});

const profileQuestions = <ProfileQuestion>[
  (
    id: 'businessType',
    title: (
      en: 'What kind of business do you run?',
      fi: 'Millaista yritystä pyörität?',
    ),
    promptLabel: (en: 'Business type', fi: 'Yrityksen tyyppi'),
    options: [
      (id: 'restaurant', en: 'Restaurant', fi: 'Ravintola'),
      (id: 'cafe', en: 'Café', fi: 'Kahvila'),
      (id: 'bakery', en: 'Bakery', fi: 'Leipomo'),
      (id: 'catering', en: 'Catering', fi: 'Pitopalvelu'),
      (id: 'store', en: 'Grocery store', fi: 'Ruokakauppa'),
      (id: 'other', en: 'Other business', fi: 'Muu yritys'),
    ],
  ),
  (
    id: 'needs',
    title: (en: 'What do you need help with?', fi: 'Mihin tarvitset apua?'),
    promptLabel: (en: 'Purchasing needs', fi: 'Hankintatarpeet'),
    options: [
      (
        id: 'restock',
        en: 'Restocking essentials',
        fi: 'Perustuotteiden täydentäminen',
      ),
      (
        id: 'compare',
        en: 'Comparing products and prices',
        fi: 'Tuotteiden ja hintojen vertailu',
      ),
      (
        id: 'menu',
        en: 'Finding ingredients for a menu',
        fi: 'Raaka-aineiden etsiminen ruokalistalle',
      ),
      (
        id: 'approve',
        en: 'Preparing requests for approval',
        fi: 'Hankintapyyntöjen valmistelu',
      ),
    ],
  ),
  (
    id: 'monthlyBudget',
    title: (
      en: 'What is your monthly purchasing budget?',
      fi: 'Mikä on kuukausittainen hankintabudjettisi?',
    ),
    promptLabel: (
      en: 'Approximate monthly budget',
      fi: 'Kuukausibudjetti noin',
    ),
    options: [
      (id: 'under500', en: 'Under €500', fi: 'Alle 500 €'),
      (id: '500to2000', en: '€500–1,999', fi: '500–1 999 €'),
      (id: '2000to5000', en: '€2,000–4,999', fi: '2 000–4 999 €'),
      (id: 'over5000', en: '€5,000 or more', fi: '5 000 € tai enemmän'),
    ],
  ),
  (
    id: 'orderCadence',
    title: (en: 'How often do you order?', fi: 'Kuinka usein tilaat?'),
    promptLabel: (en: 'Usual order frequency', fi: 'Tavallinen tilausväli'),
    options: [
      (id: 'daily', en: 'Daily', fi: 'Päivittäin'),
      (id: 'weekly', en: 'Weekly', fi: 'Viikoittain'),
      (id: 'monthly', en: 'Monthly', fi: 'Kuukausittain'),
      (id: 'irregular', en: 'As needed', fi: 'Tarpeen mukaan'),
    ],
  ),
  (
    id: 'dietaryPriority',
    title: (
      en: 'Which dietary preference is most useful?',
      fi: 'Mikä ruokavaliotoive on tärkein?',
    ),
    promptLabel: (
      en: 'Dietary preference to consider',
      fi: 'Huomioitava ruokavaliotoive',
    ),
    options: [
      (id: 'vegetarian', en: 'Vegetarian', fi: 'Kasvisruokavalio'),
      (id: 'vegan', en: 'Vegan', fi: 'Vegaaninen'),
      (id: 'gluten-free', en: 'Gluten-free', fi: 'Gluteeniton'),
      (id: 'lactose-free', en: 'Lactose-free', fi: 'Laktoositon'),
    ],
  ),
];
