import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;

class PendingLocationStore {
  Database? _db;
  Future<Database> get db async {
    if (_db != null) return _db!;
    final root = await getDatabasesPath();
    _db = await openDatabase(p.join(root, 'darb_pending_locations.db'), version: 1,
      onCreate: (database, version) async {
        await database.execute('''CREATE TABLE pending_locations (
          event_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          vehicle_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0
        )''');
        await database.execute('CREATE INDEX idx_pending_created ON pending_locations(created_at)');
      });
    return _db!;
  }

  Future<void> put({required String eventId, required String deviceId, required String vehicleId, required String payloadJson}) async {
    await (await db).insert('pending_locations', {
      'event_id': eventId, 'device_id': deviceId, 'vehicle_id': vehicleId,
      'payload_json': payloadJson, 'created_at': DateTime.now().toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<List<Map<String, Object?>>> pending({int limit = 100}) async =>
      (await db).query('pending_locations', orderBy: 'created_at ASC', limit: limit);

  Future<void> remove(String eventId) async => (await db).delete('pending_locations', where: 'event_id = ?', whereArgs: [eventId]);
  Future<void> incrementAttempt(String eventId) async => (await db).rawUpdate('UPDATE pending_locations SET attempts = attempts + 1 WHERE event_id = ?', [eventId]);
  Future<int> count() async => Sqflite.firstIntValue(await (await db).rawQuery('SELECT COUNT(*) FROM pending_locations')) ?? 0;
  Future<void> close() async { await _db?.close(); _db = null; }
}
