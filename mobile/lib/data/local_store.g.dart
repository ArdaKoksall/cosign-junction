// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'local_store.dart';

// ignore_for_file: type=lint
class $BasketLinesTable extends BasketLines
    with TableInfo<$BasketLinesTable, BasketLine> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $BasketLinesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _accountScopeMeta = const VerificationMeta(
    'accountScope',
  );
  @override
  late final GeneratedColumn<String> accountScope = GeneratedColumn<String>(
    'account_scope',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _productIdMeta = const VerificationMeta(
    'productId',
  );
  @override
  late final GeneratedColumn<String> productId = GeneratedColumn<String>(
    'product_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _salesUnitMeta = const VerificationMeta(
    'salesUnit',
  );
  @override
  late final GeneratedColumn<String> salesUnit = GeneratedColumn<String>(
    'sales_unit',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _brandMeta = const VerificationMeta('brand');
  @override
  late final GeneratedColumn<String> brand = GeneratedColumn<String>(
    'brand',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _imageUrlMeta = const VerificationMeta(
    'imageUrl',
  );
  @override
  late final GeneratedColumn<String> imageUrl = GeneratedColumn<String>(
    'image_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _quantityMeta = const VerificationMeta(
    'quantity',
  );
  @override
  late final GeneratedColumn<int> quantity = GeneratedColumn<int>(
    'quantity',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _addedAtMeta = const VerificationMeta(
    'addedAt',
  );
  @override
  late final GeneratedColumn<int> addedAt = GeneratedColumn<int>(
    'added_at',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    accountScope,
    productId,
    name,
    salesUnit,
    brand,
    imageUrl,
    quantity,
    addedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'basket_lines';
  @override
  VerificationContext validateIntegrity(
    Insertable<BasketLine> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('account_scope')) {
      context.handle(
        _accountScopeMeta,
        accountScope.isAcceptableOrUnknown(
          data['account_scope']!,
          _accountScopeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_accountScopeMeta);
    }
    if (data.containsKey('product_id')) {
      context.handle(
        _productIdMeta,
        productId.isAcceptableOrUnknown(data['product_id']!, _productIdMeta),
      );
    } else if (isInserting) {
      context.missing(_productIdMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('sales_unit')) {
      context.handle(
        _salesUnitMeta,
        salesUnit.isAcceptableOrUnknown(data['sales_unit']!, _salesUnitMeta),
      );
    } else if (isInserting) {
      context.missing(_salesUnitMeta);
    }
    if (data.containsKey('brand')) {
      context.handle(
        _brandMeta,
        brand.isAcceptableOrUnknown(data['brand']!, _brandMeta),
      );
    }
    if (data.containsKey('image_url')) {
      context.handle(
        _imageUrlMeta,
        imageUrl.isAcceptableOrUnknown(data['image_url']!, _imageUrlMeta),
      );
    }
    if (data.containsKey('quantity')) {
      context.handle(
        _quantityMeta,
        quantity.isAcceptableOrUnknown(data['quantity']!, _quantityMeta),
      );
    } else if (isInserting) {
      context.missing(_quantityMeta);
    }
    if (data.containsKey('added_at')) {
      context.handle(
        _addedAtMeta,
        addedAt.isAcceptableOrUnknown(data['added_at']!, _addedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_addedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {accountScope, productId};
  @override
  BasketLine map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return BasketLine(
      accountScope: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}account_scope'],
      )!,
      productId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}product_id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      salesUnit: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sales_unit'],
      )!,
      brand: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}brand'],
      ),
      imageUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}image_url'],
      ),
      quantity: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}quantity'],
      )!,
      addedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}added_at'],
      )!,
    );
  }

  @override
  $BasketLinesTable createAlias(String alias) {
    return $BasketLinesTable(attachedDatabase, alias);
  }
}

class BasketLine extends DataClass implements Insertable<BasketLine> {
  final String accountScope;
  final String productId;
  final String name;
  final String salesUnit;
  final String? brand;
  final String? imageUrl;
  final int quantity;
  final int addedAt;
  const BasketLine({
    required this.accountScope,
    required this.productId,
    required this.name,
    required this.salesUnit,
    this.brand,
    this.imageUrl,
    required this.quantity,
    required this.addedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['account_scope'] = Variable<String>(accountScope);
    map['product_id'] = Variable<String>(productId);
    map['name'] = Variable<String>(name);
    map['sales_unit'] = Variable<String>(salesUnit);
    if (!nullToAbsent || brand != null) {
      map['brand'] = Variable<String>(brand);
    }
    if (!nullToAbsent || imageUrl != null) {
      map['image_url'] = Variable<String>(imageUrl);
    }
    map['quantity'] = Variable<int>(quantity);
    map['added_at'] = Variable<int>(addedAt);
    return map;
  }

  BasketLinesCompanion toCompanion(bool nullToAbsent) {
    return BasketLinesCompanion(
      accountScope: Value(accountScope),
      productId: Value(productId),
      name: Value(name),
      salesUnit: Value(salesUnit),
      brand: brand == null && nullToAbsent
          ? const Value.absent()
          : Value(brand),
      imageUrl: imageUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(imageUrl),
      quantity: Value(quantity),
      addedAt: Value(addedAt),
    );
  }

  factory BasketLine.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return BasketLine(
      accountScope: serializer.fromJson<String>(json['accountScope']),
      productId: serializer.fromJson<String>(json['productId']),
      name: serializer.fromJson<String>(json['name']),
      salesUnit: serializer.fromJson<String>(json['salesUnit']),
      brand: serializer.fromJson<String?>(json['brand']),
      imageUrl: serializer.fromJson<String?>(json['imageUrl']),
      quantity: serializer.fromJson<int>(json['quantity']),
      addedAt: serializer.fromJson<int>(json['addedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'accountScope': serializer.toJson<String>(accountScope),
      'productId': serializer.toJson<String>(productId),
      'name': serializer.toJson<String>(name),
      'salesUnit': serializer.toJson<String>(salesUnit),
      'brand': serializer.toJson<String?>(brand),
      'imageUrl': serializer.toJson<String?>(imageUrl),
      'quantity': serializer.toJson<int>(quantity),
      'addedAt': serializer.toJson<int>(addedAt),
    };
  }

  BasketLine copyWith({
    String? accountScope,
    String? productId,
    String? name,
    String? salesUnit,
    Value<String?> brand = const Value.absent(),
    Value<String?> imageUrl = const Value.absent(),
    int? quantity,
    int? addedAt,
  }) => BasketLine(
    accountScope: accountScope ?? this.accountScope,
    productId: productId ?? this.productId,
    name: name ?? this.name,
    salesUnit: salesUnit ?? this.salesUnit,
    brand: brand.present ? brand.value : this.brand,
    imageUrl: imageUrl.present ? imageUrl.value : this.imageUrl,
    quantity: quantity ?? this.quantity,
    addedAt: addedAt ?? this.addedAt,
  );
  BasketLine copyWithCompanion(BasketLinesCompanion data) {
    return BasketLine(
      accountScope: data.accountScope.present
          ? data.accountScope.value
          : this.accountScope,
      productId: data.productId.present ? data.productId.value : this.productId,
      name: data.name.present ? data.name.value : this.name,
      salesUnit: data.salesUnit.present ? data.salesUnit.value : this.salesUnit,
      brand: data.brand.present ? data.brand.value : this.brand,
      imageUrl: data.imageUrl.present ? data.imageUrl.value : this.imageUrl,
      quantity: data.quantity.present ? data.quantity.value : this.quantity,
      addedAt: data.addedAt.present ? data.addedAt.value : this.addedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('BasketLine(')
          ..write('accountScope: $accountScope, ')
          ..write('productId: $productId, ')
          ..write('name: $name, ')
          ..write('salesUnit: $salesUnit, ')
          ..write('brand: $brand, ')
          ..write('imageUrl: $imageUrl, ')
          ..write('quantity: $quantity, ')
          ..write('addedAt: $addedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    accountScope,
    productId,
    name,
    salesUnit,
    brand,
    imageUrl,
    quantity,
    addedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is BasketLine &&
          other.accountScope == this.accountScope &&
          other.productId == this.productId &&
          other.name == this.name &&
          other.salesUnit == this.salesUnit &&
          other.brand == this.brand &&
          other.imageUrl == this.imageUrl &&
          other.quantity == this.quantity &&
          other.addedAt == this.addedAt);
}

class BasketLinesCompanion extends UpdateCompanion<BasketLine> {
  final Value<String> accountScope;
  final Value<String> productId;
  final Value<String> name;
  final Value<String> salesUnit;
  final Value<String?> brand;
  final Value<String?> imageUrl;
  final Value<int> quantity;
  final Value<int> addedAt;
  final Value<int> rowid;
  const BasketLinesCompanion({
    this.accountScope = const Value.absent(),
    this.productId = const Value.absent(),
    this.name = const Value.absent(),
    this.salesUnit = const Value.absent(),
    this.brand = const Value.absent(),
    this.imageUrl = const Value.absent(),
    this.quantity = const Value.absent(),
    this.addedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  BasketLinesCompanion.insert({
    required String accountScope,
    required String productId,
    required String name,
    required String salesUnit,
    this.brand = const Value.absent(),
    this.imageUrl = const Value.absent(),
    required int quantity,
    required int addedAt,
    this.rowid = const Value.absent(),
  }) : accountScope = Value(accountScope),
       productId = Value(productId),
       name = Value(name),
       salesUnit = Value(salesUnit),
       quantity = Value(quantity),
       addedAt = Value(addedAt);
  static Insertable<BasketLine> custom({
    Expression<String>? accountScope,
    Expression<String>? productId,
    Expression<String>? name,
    Expression<String>? salesUnit,
    Expression<String>? brand,
    Expression<String>? imageUrl,
    Expression<int>? quantity,
    Expression<int>? addedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (accountScope != null) 'account_scope': accountScope,
      if (productId != null) 'product_id': productId,
      if (name != null) 'name': name,
      if (salesUnit != null) 'sales_unit': salesUnit,
      if (brand != null) 'brand': brand,
      if (imageUrl != null) 'image_url': imageUrl,
      if (quantity != null) 'quantity': quantity,
      if (addedAt != null) 'added_at': addedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  BasketLinesCompanion copyWith({
    Value<String>? accountScope,
    Value<String>? productId,
    Value<String>? name,
    Value<String>? salesUnit,
    Value<String?>? brand,
    Value<String?>? imageUrl,
    Value<int>? quantity,
    Value<int>? addedAt,
    Value<int>? rowid,
  }) {
    return BasketLinesCompanion(
      accountScope: accountScope ?? this.accountScope,
      productId: productId ?? this.productId,
      name: name ?? this.name,
      salesUnit: salesUnit ?? this.salesUnit,
      brand: brand ?? this.brand,
      imageUrl: imageUrl ?? this.imageUrl,
      quantity: quantity ?? this.quantity,
      addedAt: addedAt ?? this.addedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (accountScope.present) {
      map['account_scope'] = Variable<String>(accountScope.value);
    }
    if (productId.present) {
      map['product_id'] = Variable<String>(productId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (salesUnit.present) {
      map['sales_unit'] = Variable<String>(salesUnit.value);
    }
    if (brand.present) {
      map['brand'] = Variable<String>(brand.value);
    }
    if (imageUrl.present) {
      map['image_url'] = Variable<String>(imageUrl.value);
    }
    if (quantity.present) {
      map['quantity'] = Variable<int>(quantity.value);
    }
    if (addedAt.present) {
      map['added_at'] = Variable<int>(addedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('BasketLinesCompanion(')
          ..write('accountScope: $accountScope, ')
          ..write('productId: $productId, ')
          ..write('name: $name, ')
          ..write('salesUnit: $salesUnit, ')
          ..write('brand: $brand, ')
          ..write('imageUrl: $imageUrl, ')
          ..write('quantity: $quantity, ')
          ..write('addedAt: $addedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $RunSnapshotsTable extends RunSnapshots
    with TableInfo<$RunSnapshotsTable, RunSnapshot> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $RunSnapshotsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _accountScopeMeta = const VerificationMeta(
    'accountScope',
  );
  @override
  late final GeneratedColumn<String> accountScope = GeneratedColumn<String>(
    'account_scope',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [accountScope, payload];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'run_snapshots';
  @override
  VerificationContext validateIntegrity(
    Insertable<RunSnapshot> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('account_scope')) {
      context.handle(
        _accountScopeMeta,
        accountScope.isAcceptableOrUnknown(
          data['account_scope']!,
          _accountScopeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_accountScopeMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {accountScope};
  @override
  RunSnapshot map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return RunSnapshot(
      accountScope: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}account_scope'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
    );
  }

  @override
  $RunSnapshotsTable createAlias(String alias) {
    return $RunSnapshotsTable(attachedDatabase, alias);
  }
}

class RunSnapshot extends DataClass implements Insertable<RunSnapshot> {
  final String accountScope;
  final String payload;
  const RunSnapshot({required this.accountScope, required this.payload});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['account_scope'] = Variable<String>(accountScope);
    map['payload'] = Variable<String>(payload);
    return map;
  }

  RunSnapshotsCompanion toCompanion(bool nullToAbsent) {
    return RunSnapshotsCompanion(
      accountScope: Value(accountScope),
      payload: Value(payload),
    );
  }

  factory RunSnapshot.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return RunSnapshot(
      accountScope: serializer.fromJson<String>(json['accountScope']),
      payload: serializer.fromJson<String>(json['payload']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'accountScope': serializer.toJson<String>(accountScope),
      'payload': serializer.toJson<String>(payload),
    };
  }

  RunSnapshot copyWith({String? accountScope, String? payload}) => RunSnapshot(
    accountScope: accountScope ?? this.accountScope,
    payload: payload ?? this.payload,
  );
  RunSnapshot copyWithCompanion(RunSnapshotsCompanion data) {
    return RunSnapshot(
      accountScope: data.accountScope.present
          ? data.accountScope.value
          : this.accountScope,
      payload: data.payload.present ? data.payload.value : this.payload,
    );
  }

  @override
  String toString() {
    return (StringBuffer('RunSnapshot(')
          ..write('accountScope: $accountScope, ')
          ..write('payload: $payload')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(accountScope, payload);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is RunSnapshot &&
          other.accountScope == this.accountScope &&
          other.payload == this.payload);
}

class RunSnapshotsCompanion extends UpdateCompanion<RunSnapshot> {
  final Value<String> accountScope;
  final Value<String> payload;
  final Value<int> rowid;
  const RunSnapshotsCompanion({
    this.accountScope = const Value.absent(),
    this.payload = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  RunSnapshotsCompanion.insert({
    required String accountScope,
    required String payload,
    this.rowid = const Value.absent(),
  }) : accountScope = Value(accountScope),
       payload = Value(payload);
  static Insertable<RunSnapshot> custom({
    Expression<String>? accountScope,
    Expression<String>? payload,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (accountScope != null) 'account_scope': accountScope,
      if (payload != null) 'payload': payload,
      if (rowid != null) 'rowid': rowid,
    });
  }

  RunSnapshotsCompanion copyWith({
    Value<String>? accountScope,
    Value<String>? payload,
    Value<int>? rowid,
  }) {
    return RunSnapshotsCompanion(
      accountScope: accountScope ?? this.accountScope,
      payload: payload ?? this.payload,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (accountScope.present) {
      map['account_scope'] = Variable<String>(accountScope.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('RunSnapshotsCompanion(')
          ..write('accountScope: $accountScope, ')
          ..write('payload: $payload, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$LocalStore extends GeneratedDatabase {
  _$LocalStore(QueryExecutor e) : super(e);
  $LocalStoreManager get managers => $LocalStoreManager(this);
  late final $BasketLinesTable basketLines = $BasketLinesTable(this);
  late final $RunSnapshotsTable runSnapshots = $RunSnapshotsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    basketLines,
    runSnapshots,
  ];
}

typedef $$BasketLinesTableCreateCompanionBuilder =
    BasketLinesCompanion Function({
      required String accountScope,
      required String productId,
      required String name,
      required String salesUnit,
      Value<String?> brand,
      Value<String?> imageUrl,
      required int quantity,
      required int addedAt,
      Value<int> rowid,
    });
typedef $$BasketLinesTableUpdateCompanionBuilder =
    BasketLinesCompanion Function({
      Value<String> accountScope,
      Value<String> productId,
      Value<String> name,
      Value<String> salesUnit,
      Value<String?> brand,
      Value<String?> imageUrl,
      Value<int> quantity,
      Value<int> addedAt,
      Value<int> rowid,
    });

class $$BasketLinesTableFilterComposer
    extends Composer<_$LocalStore, $BasketLinesTable> {
  $$BasketLinesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get accountScope => $composableBuilder(
    column: $table.accountScope,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get productId => $composableBuilder(
    column: $table.productId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get salesUnit => $composableBuilder(
    column: $table.salesUnit,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get brand => $composableBuilder(
    column: $table.brand,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get imageUrl => $composableBuilder(
    column: $table.imageUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get quantity => $composableBuilder(
    column: $table.quantity,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get addedAt => $composableBuilder(
    column: $table.addedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$BasketLinesTableOrderingComposer
    extends Composer<_$LocalStore, $BasketLinesTable> {
  $$BasketLinesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get accountScope => $composableBuilder(
    column: $table.accountScope,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get productId => $composableBuilder(
    column: $table.productId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get salesUnit => $composableBuilder(
    column: $table.salesUnit,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get brand => $composableBuilder(
    column: $table.brand,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get imageUrl => $composableBuilder(
    column: $table.imageUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get quantity => $composableBuilder(
    column: $table.quantity,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get addedAt => $composableBuilder(
    column: $table.addedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$BasketLinesTableAnnotationComposer
    extends Composer<_$LocalStore, $BasketLinesTable> {
  $$BasketLinesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get accountScope => $composableBuilder(
    column: $table.accountScope,
    builder: (column) => column,
  );

  GeneratedColumn<String> get productId =>
      $composableBuilder(column: $table.productId, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get salesUnit =>
      $composableBuilder(column: $table.salesUnit, builder: (column) => column);

  GeneratedColumn<String> get brand =>
      $composableBuilder(column: $table.brand, builder: (column) => column);

  GeneratedColumn<String> get imageUrl =>
      $composableBuilder(column: $table.imageUrl, builder: (column) => column);

  GeneratedColumn<int> get quantity =>
      $composableBuilder(column: $table.quantity, builder: (column) => column);

  GeneratedColumn<int> get addedAt =>
      $composableBuilder(column: $table.addedAt, builder: (column) => column);
}

class $$BasketLinesTableTableManager
    extends
        RootTableManager<
          _$LocalStore,
          $BasketLinesTable,
          BasketLine,
          $$BasketLinesTableFilterComposer,
          $$BasketLinesTableOrderingComposer,
          $$BasketLinesTableAnnotationComposer,
          $$BasketLinesTableCreateCompanionBuilder,
          $$BasketLinesTableUpdateCompanionBuilder,
          (
            BasketLine,
            BaseReferences<_$LocalStore, $BasketLinesTable, BasketLine>,
          ),
          BasketLine,
          PrefetchHooks Function()
        > {
  $$BasketLinesTableTableManager(_$LocalStore db, $BasketLinesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$BasketLinesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$BasketLinesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$BasketLinesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> accountScope = const Value.absent(),
                Value<String> productId = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String> salesUnit = const Value.absent(),
                Value<String?> brand = const Value.absent(),
                Value<String?> imageUrl = const Value.absent(),
                Value<int> quantity = const Value.absent(),
                Value<int> addedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => BasketLinesCompanion(
                accountScope: accountScope,
                productId: productId,
                name: name,
                salesUnit: salesUnit,
                brand: brand,
                imageUrl: imageUrl,
                quantity: quantity,
                addedAt: addedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String accountScope,
                required String productId,
                required String name,
                required String salesUnit,
                Value<String?> brand = const Value.absent(),
                Value<String?> imageUrl = const Value.absent(),
                required int quantity,
                required int addedAt,
                Value<int> rowid = const Value.absent(),
              }) => BasketLinesCompanion.insert(
                accountScope: accountScope,
                productId: productId,
                name: name,
                salesUnit: salesUnit,
                brand: brand,
                imageUrl: imageUrl,
                quantity: quantity,
                addedAt: addedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$BasketLinesTable, BasketLine>(table),
                  BaseReferences<_$LocalStore, $BasketLinesTable, BasketLine>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$BasketLinesTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalStore,
      $BasketLinesTable,
      BasketLine,
      $$BasketLinesTableFilterComposer,
      $$BasketLinesTableOrderingComposer,
      $$BasketLinesTableAnnotationComposer,
      $$BasketLinesTableCreateCompanionBuilder,
      $$BasketLinesTableUpdateCompanionBuilder,
      (BasketLine, BaseReferences<_$LocalStore, $BasketLinesTable, BasketLine>),
      BasketLine,
      PrefetchHooks Function()
    >;
typedef $$RunSnapshotsTableCreateCompanionBuilder =
    RunSnapshotsCompanion Function({
      required String accountScope,
      required String payload,
      Value<int> rowid,
    });
typedef $$RunSnapshotsTableUpdateCompanionBuilder =
    RunSnapshotsCompanion Function({
      Value<String> accountScope,
      Value<String> payload,
      Value<int> rowid,
    });

class $$RunSnapshotsTableFilterComposer
    extends Composer<_$LocalStore, $RunSnapshotsTable> {
  $$RunSnapshotsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get accountScope => $composableBuilder(
    column: $table.accountScope,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );
}

class $$RunSnapshotsTableOrderingComposer
    extends Composer<_$LocalStore, $RunSnapshotsTable> {
  $$RunSnapshotsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get accountScope => $composableBuilder(
    column: $table.accountScope,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$RunSnapshotsTableAnnotationComposer
    extends Composer<_$LocalStore, $RunSnapshotsTable> {
  $$RunSnapshotsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get accountScope => $composableBuilder(
    column: $table.accountScope,
    builder: (column) => column,
  );

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);
}

class $$RunSnapshotsTableTableManager
    extends
        RootTableManager<
          _$LocalStore,
          $RunSnapshotsTable,
          RunSnapshot,
          $$RunSnapshotsTableFilterComposer,
          $$RunSnapshotsTableOrderingComposer,
          $$RunSnapshotsTableAnnotationComposer,
          $$RunSnapshotsTableCreateCompanionBuilder,
          $$RunSnapshotsTableUpdateCompanionBuilder,
          (
            RunSnapshot,
            BaseReferences<_$LocalStore, $RunSnapshotsTable, RunSnapshot>,
          ),
          RunSnapshot,
          PrefetchHooks Function()
        > {
  $$RunSnapshotsTableTableManager(_$LocalStore db, $RunSnapshotsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$RunSnapshotsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$RunSnapshotsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$RunSnapshotsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> accountScope = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => RunSnapshotsCompanion(
                accountScope: accountScope,
                payload: payload,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String accountScope,
                required String payload,
                Value<int> rowid = const Value.absent(),
              }) => RunSnapshotsCompanion.insert(
                accountScope: accountScope,
                payload: payload,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$RunSnapshotsTable, RunSnapshot>(table),
                  BaseReferences<_$LocalStore, $RunSnapshotsTable, RunSnapshot>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$RunSnapshotsTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalStore,
      $RunSnapshotsTable,
      RunSnapshot,
      $$RunSnapshotsTableFilterComposer,
      $$RunSnapshotsTableOrderingComposer,
      $$RunSnapshotsTableAnnotationComposer,
      $$RunSnapshotsTableCreateCompanionBuilder,
      $$RunSnapshotsTableUpdateCompanionBuilder,
      (
        RunSnapshot,
        BaseReferences<_$LocalStore, $RunSnapshotsTable, RunSnapshot>,
      ),
      RunSnapshot,
      PrefetchHooks Function()
    >;

class $LocalStoreManager {
  final _$LocalStore _db;
  $LocalStoreManager(this._db);
  $$BasketLinesTableTableManager get basketLines =>
      $$BasketLinesTableTableManager(_db, _db.basketLines);
  $$RunSnapshotsTableTableManager get runSnapshots =>
      $$RunSnapshotsTableTableManager(_db, _db.runSnapshots);
}
