import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'api.dart';

part 'local_store.g.dart';

class BasketLines extends Table {
  TextColumn get accountScope => text()();
  TextColumn get productId => text()();
  TextColumn get name => text()();
  TextColumn get salesUnit => text()();
  TextColumn get brand => text().nullable()();
  TextColumn get imageUrl => text().nullable()();
  IntColumn get quantity => integer()();
  IntColumn get addedAt => integer()();

  @override
  Set<Column<Object>> get primaryKey => {accountScope, productId};
}

class RunSnapshots extends Table {
  TextColumn get accountScope => text()();
  TextColumn get payload => text()();

  @override
  Set<Column<Object>> get primaryKey => {accountScope};
}

@DriftDatabase(tables: [BasketLines, RunSnapshots])
class LocalStore extends _$LocalStore {
  LocalStore([QueryExecutor? executor])
    : super(executor ?? driftDatabase(name: 'cosign_workspace'));

  @override
  int get schemaVersion => 1;

  Future<List<Json>> basket(String scope) async {
    final query = select(basketLines)
      ..where((row) => row.accountScope.equals(scope))
      ..orderBy([(row) => OrderingTerm.asc(row.addedAt)]);
    return (await query.get()).map(_basketJson).toList(growable: false);
  }

  Future<List<Json>> setBasketQuantity(
    String scope,
    Json product,
    int quantity,
  ) {
    final productId = requiredString(product['id']);
    if (quantity < 0 || quantity > 1000000) {
      throw const ApiException(
        'Enter a quantity between 0 and 1,000,000.',
        code: 'invalid_quantity',
      );
    }
    return transaction(() async {
      Expression<bool> matchesProduct(BasketLines row) =>
          row.accountScope.equals(scope) & row.productId.equals(productId);
      if (quantity == 0) {
        await (delete(basketLines)..where(matchesProduct)).go();
      } else {
        final existing = await (select(
          basketLines,
        )..where(matchesProduct)).getSingleOrNull();
        if (existing == null && (await basket(scope)).length >= 10) {
          throw const ApiException(
            'A request can include up to 10 different products.',
            code: 'basket_limit',
          );
        }
        await into(basketLines).insertOnConflictUpdate(
          BasketLinesCompanion.insert(
            accountScope: scope,
            productId: productId,
            name: requiredString(product['name']),
            salesUnit: requiredString(product['salesUnit']),
            brand: Value(product['brand'] as String?),
            imageUrl: Value(product['imageUrl'] as String?),
            quantity: quantity,
            addedAt: existing?.addedAt ?? DateTime.now().microsecondsSinceEpoch,
          ),
        );
      }
      return basket(scope);
    });
  }

  Future<void> clearBasket(String scope) async {
    await (delete(
      basketLines,
    )..where((row) => row.accountScope.equals(scope))).go();
  }

  Future<void> writeRuns(String scope, String payload) async {
    await into(runSnapshots).insertOnConflictUpdate(
      RunSnapshotsCompanion.insert(accountScope: scope, payload: payload),
    );
  }

  Future<String?> readRuns(String scope) async {
    final row = await (select(
      runSnapshots,
    )..where((row) => row.accountScope.equals(scope))).getSingleOrNull();
    return row?.payload;
  }

  Future<void> clearAccount(String scope) => transaction(() async {
    await clearBasket(scope);
    await (delete(
      runSnapshots,
    )..where((row) => row.accountScope.equals(scope))).go();
  });

  Json _basketJson(BasketLine line) => {
    'id': line.productId,
    'name': line.name,
    'salesUnit': line.salesUnit,
    'brand': line.brand,
    'imageUrl': line.imageUrl,
    'quantity': line.quantity,
  };
}
