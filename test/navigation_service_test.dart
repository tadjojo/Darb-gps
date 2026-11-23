import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';
import 'package:darb_gps/services/navigation_service.dart';

void main() {
  group('NavigationService', () {
    test('search returns only valid coordinates', () async {
      final client = MockClient((request) async {
        expect(request.url.path, '/search');
        expect(request.headers['user-agent'], contains('DARB-GPS'));
        return http.Response(jsonEncode([
          {'place_id': 1, 'name': 'Amman', 'display_name': 'Amman, Jordan', 'lat': '31.95', 'lon': '35.91'},
          {'place_id': 2, 'name': 'Invalid', 'lat': '999', 'lon': '35'},
        ]), 200);
      });
      final service = NavigationService(client: client);
      final results = await service.searchPlaces('Amman');
      expect(results, hasLength(1));
      expect(results.single.name, 'Amman');
      expect(results.single.point, const LatLng(31.95, 35.91));
      service.close();
    });

    test('short search query does not make a network request', () async {
      final client = MockClient((_) async => fail('unexpected request'));
      final service = NavigationService(client: client);
      expect(await service.searchPlaces(' '), isEmpty);
      service.close();
    });

    test('route parses GeoJSON [longitude, latitude] into LatLng', () async {
      final client = MockClient((request) async {
        expect(request.url.path, contains('/route/v1/driving/'));
        return http.Response(jsonEncode({
          'code': 'Ok',
          'routes': [
            {'distance': 12500, 'duration': 900, 'geometry': {'coordinates': [[35.91, 31.95], [35.92, 31.96]]}},
          ],
        }), 200);
      });
      final service = NavigationService(client: client);
      final routes = await service.getDrivingRoutes(const LatLng(31.95, 35.91), const LatLng(31.96, 35.92));
      expect(routes, hasLength(1));
      expect(routes.single.distanceKilometers, 12.5);
      expect(routes.single.estimatedMinutes, 15);
      expect(routes.single.points.first, const LatLng(31.95, 35.91));
      service.close();
    });

    test('rejects invalid coordinates before network access', () async {
      final client = MockClient((_) async => fail('unexpected request'));
      final service = NavigationService(client: client);
      expect(
        () => service.getDrivingRoutes(const LatLng(120, 35), const LatLng(31, 35)),
        throwsA(isA<NavigationException>()),
      );
      service.close();
    });

    test('ignores malformed route coordinate pairs and invalid metrics', () async {
      final client = MockClient((_) async => http.Response(jsonEncode({
        'code': 'Ok',
        'routes': [
          {'distance': 100, 'duration': 60, 'geometry': {'coordinates': [[35.9, 31.9], ['bad', 31.91], [35.92, 31.92]]}},
          {'distance': -1, 'duration': 60, 'geometry': {'coordinates': [[35.9, 31.9], [35.92, 31.92]]}},
        ],
      }), 200));
      final service = NavigationService(client: client);
      final routes = await service.getDrivingRoutes(const LatLng(31.9, 35.9), const LatLng(31.92, 35.92));
      expect(routes, hasLength(1));
      expect(routes.single.points, hasLength(2));
      service.close();
    });

    test('converts request timeout into a navigation error', () async {
      final client = MockClient((_) async => throw TimeoutException('slow network'));
      final service = NavigationService(client: client);
      await expectLater(service.searchPlaces('Amman'), throwsA(isA<NavigationException>()));
      service.close();
    });
  });
}
