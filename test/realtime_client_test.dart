import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:darb_gps/services/realtime_client.dart';

void main() {
  test('REST polling emits changed latest-location records only once', () async {
    final events = <Map<String, dynamic>>[];
    final connections = <bool>[];
    final firstEvent = Completer<void>();
    final secondEvent = Completer<void>();
    var requestCount = 0;
    final client = MockClient((request) async {
      requestCount++;
      expect(request.url.path, '/api/v1/tracking/vehicles/vehicle-1/latest');
      expect(request.headers['authorization'], 'Bearer token');
      final id = requestCount <= 2 ? 1 : 2;
      return httpResponse({
        'id': id,
        'latitude': 31.9 + id / 1000,
        'longitude': 35.9,
        'recorded_at': '2026-11-25T10:0$id:00Z',
      });
    });
    final realtime = DarbRealtimeClient(client: client, interval: const Duration(days: 1));
    realtime.connect(
      baseUrl: 'https://api.example.test/',
      accessToken: 'token',
      vehicleId: 'vehicle-1',
      onConnection: connections.add,
      onLocation: (event) {
        events.add(event);
        if (events.length == 1) firstEvent.complete();
        if (events.length == 2) secondEvent.complete();
      },
    );
    await firstEvent.future.timeout(const Duration(seconds: 2));
    await realtime.pollNow(); // same record: deduplicated
    expect(events, hasLength(1));
    await realtime.pollNow(); // newer record
    await secondEvent.future.timeout(const Duration(seconds: 2));
    expect(events, hasLength(2));
    expect(events.last['id'], 2);
    expect(connections, [true]);
    realtime.disconnect();
  });

  test('REST polling reports connection failure after a successful poll', () async {
    final states = <bool>[];
    var requestCount = 0;
    final client = MockClient((_) async {
      requestCount++;
      if (requestCount == 1) {
        return httpResponse({'id': 1, 'latitude': 31.9, 'longitude': 35.9});
      }
      return httpResponse({'error': 'offline'}, statusCode: 503);
    });
    final realtime = DarbRealtimeClient(client: client, interval: const Duration(days: 1));
    final first = Completer<void>();
    realtime.connect(
      baseUrl: 'https://api.example.test',
      accessToken: 'token',
      vehicleId: 'vehicle-1',
      onConnection: (state) {
        states.add(state);
        if (state) first.complete();
      },
      onLocation: (_) {},
    );
    await first.future.timeout(const Duration(seconds: 2));
    await realtime.pollNow();
    expect(states, [true, false]);
    realtime.disconnect();
  });

  test('null latest location keeps connection healthy without emitting', () async {
    final states = <bool>[];
    var eventCount = 0;
    final client = MockClient((_) async => httpResponse(null));
    final realtime = DarbRealtimeClient(client: client, interval: const Duration(days: 1));
    realtime.connect(
      baseUrl: 'https://api.example.test',
      accessToken: 'token',
      vehicleId: 'vehicle-1',
      onConnection: states.add,
      onLocation: (_) => eventCount++,
    );
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(states, [true]);
    expect(eventCount, 0);
    realtime.disconnect();
  });
}

http.Response httpResponse(Object? data, {int statusCode = 200}) => http.Response(
      jsonEncode(data),
      statusCode,
      headers: {'content-type': 'application/json'},
    );
