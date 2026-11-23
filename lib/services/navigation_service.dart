import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Public geocoding/routing adapter for the alpha client.
/// Keep providers replaceable: production deployments should use an approved,
/// rate-limited provider or self-hosted Nominatim/OSRM/Valhalla instance.
class NavigationService {
  NavigationService({
    http.Client? client,
    this.geocodingBaseUrl = 'https://nominatim.openstreetmap.org',
    this.routingBaseUrl = 'https://router.project-osrm.org',
    this.userAgent = 'DARB-GPS/0.2 (mobile navigation)',
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final String geocodingBaseUrl;
  final String routingBaseUrl;
  final String userAgent;

  Future<List<PlaceSuggestion>> searchPlaces(
    String query, {
    String language = 'ar,en',
    int limit = 8,
  }) async {
    final normalized = query.trim();
    if (normalized.length < 2) return const [];
    final uri = Uri.parse('$geocodingBaseUrl/search').replace(
      queryParameters: {
        'q': normalized,
        'format': 'jsonv2',
        'addressdetails': '1',
        'limit': '${limit.clamp(1, 10)}',
        'accept-language': language,
      },
    );
    final response = await _get(uri, const Duration(seconds: 12), 'البحث عن المواقع');
    if (response.statusCode != 200) {
      throw NavigationException('تعذر البحث عن الموقع (${response.statusCode})');
    }
    dynamic decoded;
    try { decoded = jsonDecode(response.body); }
    on FormatException { throw const NavigationException('استجابة البحث غير صالحة'); }
    if (decoded is! List) throw const NavigationException('استجابة البحث غير صالحة');
    return decoded.whereType<Map<String, dynamic>>().map((item) {
      final lat = double.tryParse('${item['lat']}');
      final lon = double.tryParse('${item['lon']}');
      if (lat == null || lon == null || !_validCoordinate(lat, lon)) return null;
      return PlaceSuggestion(
        id: '${item['place_id'] ?? '${lat}_$lon'}',
        name: '${item['name'] ?? item['display_name'] ?? 'موقع'}',
        address: '${item['display_name'] ?? ''}',
        point: LatLng(lat, lon),
      );
    }).whereType<PlaceSuggestion>().toList(growable: false);
  }

  Future<List<NavigationRoute>> getDrivingRoutes(
    LatLng origin,
    LatLng destination, {
    bool alternatives = true,
  }) async {
    if (!_validCoordinate(origin.latitude, origin.longitude) ||
        !_validCoordinate(destination.latitude, destination.longitude)) {
      throw const NavigationException('إحداثيات نقطة البداية أو الوصول غير صحيحة');
    }
    final coordinates = '${origin.longitude},${origin.latitude};'
        '${destination.longitude},${destination.latitude}';
    final uri = Uri.parse('$routingBaseUrl/route/v1/driving/$coordinates').replace(
      queryParameters: {
        'alternatives': alternatives ? 'true' : 'false',
        'overview': 'full',
        'geometries': 'geojson',
        'steps': 'false',
      },
    );
    final response = await _get(uri, const Duration(seconds: 15), 'حساب المسار');
    if (response.statusCode != 200) {
      throw NavigationException('تعذر حساب المسار (${response.statusCode})');
    }
    dynamic decoded;
    try { decoded = jsonDecode(response.body); }
    on FormatException { throw const NavigationException('استجابة خدمة المسارات غير صالحة'); }
    if (decoded is! Map<String, dynamic> || decoded['code'] != 'Ok' || decoded['routes'] is! List) {
      throw const NavigationException('لم يتم العثور على مسار صالح');
    }
    final routes = (decoded['routes'] as List).whereType<Map<String, dynamic>>();
    return routes.map((route) {
      final geometry = route['geometry'];
      final rawCoordinates = geometry is Map ? geometry['coordinates'] : null;
      if (rawCoordinates is! List) return null;
      final points = <LatLng>[];
      for (final pair in rawCoordinates) {
        if (pair is! List || pair.length < 2) continue;
        final lon = _asFiniteDouble(pair[0]);
        final lat = _asFiniteDouble(pair[1]);
        if (lat != null && lon != null && _validCoordinate(lat, lon)) {
          points.add(LatLng(lat, lon));
        }
      }
      final distance = _asFiniteDouble(route['distance']);
      final duration = _asFiniteDouble(route['duration']);
      if (points.length < 2 || distance == null || duration == null ||
          !distance.isFinite || !duration.isFinite || distance < 0 || duration < 0) return null;
      return NavigationRoute(
        distanceMeters: distance,
        durationSeconds: duration,
        points: points,
      );
    }).whereType<NavigationRoute>().toList(growable: false);
  }

  Future<http.Response> _get(Uri uri, Duration timeout, String operation) async {
    try {
      return await _client.get(uri, headers: {'User-Agent': userAgent}).timeout(timeout);
    } on TimeoutException {
      throw NavigationException('انتهت مهلة $operation؛ تحقق من الاتصال وحاول مجدداً');
    } on http.ClientException {
      throw NavigationException('تعذر الاتصال بخدمة $operation');
    }
  }

  static double? _asFiniteDouble(Object? value) {
    final number = value is num ? value.toDouble() : double.tryParse('$value');
    return number != null && number.isFinite ? number : null;
  }

  static bool _validCoordinate(double latitude, double longitude) =>
      latitude.isFinite && longitude.isFinite &&
      latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

  void close() => _client.close();
}

class PlaceSuggestion {
  const PlaceSuggestion({required this.id, required this.name, required this.address, required this.point});
  final String id;
  final String name;
  final String address;
  final LatLng point;
}

class NavigationRoute {
  const NavigationRoute({required this.distanceMeters, required this.durationSeconds, required this.points});
  final double distanceMeters;
  final double durationSeconds;
  final List<LatLng> points;

  double get distanceKilometers => distanceMeters / 1000;
  int get estimatedMinutes => (durationSeconds / 60).round();
}

class NavigationException implements Exception {
  const NavigationException(this.message);
  final String message;
  @override
  String toString() => message;
}
