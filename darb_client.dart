import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class DarbClient {
  DarbClient(this.storage);
  final FlutterSecureStorage storage;
  String? _baseUrl;

  Future<String> get baseUrl async => _baseUrl ??= (await storage.read(key: 'api_base_url') ?? 'http://10.0.2.2:3000').replaceAll(RegExp(r'/+$'), '');
  Future<void> setBaseUrl(String value) async {
    final normalized = value.trim().replaceAll(RegExp(r'/+$'), '');
    if (!normalized.startsWith('https://') && !normalized.startsWith('http://')) {
      throw ArgumentError('API URL must start with http:// or https://');
    }
    _baseUrl = normalized;
    await storage.write(key: 'api_base_url', value: normalized);
  }

  Future<Map<String, dynamic>> login(String identifier, String password) async {
    final response = await http.post(Uri.parse('${await baseUrl}/api/v1/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'identifier': identifier.trim(), 'password': password}),
    ).timeout(const Duration(seconds: 15));
    final data = _decode(response);
    await _saveTokens(data);
    return data;
  }

  Future<void> _saveTokens(Map<String, dynamic> data) async {
    final access = data['accessToken'] as String?;
    final refresh = data['refreshToken'] as String?;
    if (access == null || refresh == null) throw StateError('Authentication response is missing tokens');
    await storage.write(key: 'access_token', value: access);
    await storage.write(key: 'refresh_token', value: refresh);
  }

  Future<String?> _refresh() async {
    final refreshToken = await storage.read(key: 'refresh_token');
    if (refreshToken == null) return null;
    final response = await http.post(Uri.parse('${await baseUrl}/api/v1/auth/refresh'),
      headers: {'Content-Type': 'application/json'}, body: jsonEncode({'refreshToken': refreshToken}),
    ).timeout(const Duration(seconds: 15));
    if (response.statusCode >= 400) {
      await clearTokens();
      return null;
    }
    final data = _decode(response);
    await _saveTokens(data);
    return data['accessToken'] as String?;
  }

  Future<String?> refreshAccessToken() => _refresh();

  Future<void> logout() async {
    final refreshToken = await storage.read(key: 'refresh_token');
    final accessToken = await storage.read(key: 'access_token');
    if (refreshToken != null) {
      try {
        final headers = <String, String>{'Content-Type': 'application/json'};
        if (accessToken != null) headers['Authorization'] = 'Bearer $accessToken';
        await http.post(Uri.parse('${await baseUrl}/api/v1/auth/logout'),
          headers: headers, body: jsonEncode({'refreshToken': refreshToken}),
        ).timeout(const Duration(seconds: 10));
      } catch (_) { /* Local credentials are still cleared if the server is unreachable. */ }
    }
    await clearTokens();
  }

  Future<void> clearTokens() async {
    await storage.delete(key: 'access_token');
    await storage.delete(key: 'refresh_token');
  }

  Future<http.Response> authorized(String method, String path, {Map<String, dynamic>? body}) async {
    await baseUrl;
    var token = await storage.read(key: 'access_token');
    if (token == null) throw StateError('سجّل الدخول أولاً');
    Future<http.Response> send(String t) {
      final uri = Uri.parse('${_baseUrl ?? 'http://10.0.2.2:3000'}$path');
      final headers = {'Authorization': 'Bearer $t', 'Content-Type': 'application/json'};
      final payload = body == null ? null : jsonEncode(body);
      switch (method) {
        case 'GET': return http.get(uri, headers: headers).timeout(const Duration(seconds: 12));
        case 'POST': return http.post(uri, headers: headers, body: payload).timeout(const Duration(seconds: 12));
        default: throw UnsupportedError('HTTP method not supported');
      }
    }
    var response = await send(token);
    if (response.statusCode == 401) {
      token = await _refresh();
      if (token != null) response = await send(token);
    }
    return response;
  }

  Future<Map<String, dynamic>> createOrganization(String name) async {
    final response = await authorized('POST', '/api/v1/organizations', body: {'name': name});
    return _decode(response);
  }

  Future<Map<String, dynamic>> createVehicle(String organizationId, String displayName, {String? registrationNumber}) async {
    final body = <String, dynamic>{'displayName': displayName};
    if (registrationNumber != null && registrationNumber.trim().isNotEmpty) body['registrationNumber'] = registrationNumber.trim();
    final response = await authorized('POST', '/api/v1/organizations/$organizationId/vehicles', body: body);
    return _decode(response);
  }

  Future<List<dynamic>> listVehicles(String organizationId) async {
    final response = await authorized('GET', '/api/v1/organizations/$organizationId/vehicles');
    final value = _decode(response);
    return value['data'] is List ? value['data'] as List<dynamic> : <dynamic>[];
  }

  Future<Map<String, dynamic>> enrollMobile(String vehicleId) async {
    final response = await authorized('POST', '/api/v1/tracking/devices/enroll-mobile', body: {'vehicleId': vehicleId});
    return _decode(response);
  }

  Future<Map<String, dynamic>?> latestLocation(String vehicleId) async {
    final response = await authorized('GET', '/api/v1/tracking/vehicles/$vehicleId/latest');
    if (response.statusCode == 404 || response.body.trim().isEmpty || response.body.trim() == 'null') return null;
    return _decode(response);
  }

  Future<List<Map<String, dynamic>>> listDevices(String vehicleId) async {
    final response = await authorized('GET', '/api/v1/tracking/devices/vehicle/$vehicleId');
    final value = _decode(response);
    final rows = value['data'] is List ? value['data'] as List : <dynamic>[];
    return rows.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList(growable: false);
  }

  Future<List<Map<String, dynamic>>> listTrips(String vehicleId, {required DateTime from, required DateTime to, int limit = 50}) async {
    final query = Uri(queryParameters: {
      'from': from.toUtc().toIso8601String(),
      'to': to.toUtc().toIso8601String(),
      'limit': '$limit',
    }).query;
    final response = await authorized('GET', '/api/v1/tracking/vehicles/$vehicleId/trips?$query');
    final value = _decode(response);
    final rows = value['data'] is List ? value['data'] as List : <dynamic>[];
    return rows.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList(growable: false);
  }

  Future<List<Map<String, dynamic>>> getTripRoute(String vehicleId, String deviceId, {required DateTime from, required DateTime to}) async {
    final query = Uri(queryParameters: {
      'deviceId': deviceId,
      'from': from.toUtc().toIso8601String(),
      'to': to.toUtc().toIso8601String(),
    }).query;
    final response = await authorized('GET', '/api/v1/tracking/vehicles/$vehicleId/trip-route?$query');
    final value = _decode(response);
    final rows = value['data'] is List ? value['data'] as List : <dynamic>[];
    return rows.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList(growable: false);
  }

  Future<List<Map<String, dynamic>>> listStops(String vehicleId, {required DateTime from, required DateTime to, int limit = 100}) async {
    final query = Uri(queryParameters: {
      'from': from.toUtc().toIso8601String(),
      'to': to.toUtc().toIso8601String(),
      'limit': '$limit',
    }).query;
    final response = await authorized('GET', '/api/v1/tracking/vehicles/$vehicleId/stops?$query');
    final value = _decode(response);
    final rows = value['data'] is List ? value['data'] as List : <dynamic>[];
    return rows.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList(growable: false);
  }

  Future<Map<String, dynamic>> sendLocation(Map<String, dynamic> payload) async {
    final response = await authorized('POST', '/api/v1/tracking/mobile/location', body: payload);
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    dynamic value;
    try { value = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body); }
    catch (_) { value = {'message': response.body}; }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = value is Map ? (value['message'] ?? value['error'] ?? 'HTTP ${response.statusCode}') : 'HTTP ${response.statusCode}';
      throw Exception(message.toString());
    }
    if (value is Map<String, dynamic>) return value;
    return <String, dynamic>{'data': value};
  }
}
