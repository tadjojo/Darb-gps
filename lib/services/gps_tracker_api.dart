import 'dart:convert';
import 'package:darb_gps/services/darb_client.dart';

class GpsTrackerApi {
  GpsTrackerApi(this.client);
  final DarbClient client;

  Future<Map<String, dynamic>> enroll(String vehicleId, {
    required String protocol,
    String? label,
    String? imei,
    String? model,
    int? timezoneOffsetMinutes,
  }) => _request('POST', '/api/v1/tracking/devices/gps', body: {
    'vehicleId': vehicleId,
    'protocol': protocol,
    if (label != null && label.trim().isNotEmpty) 'label': label.trim(),
    if (imei != null && imei.trim().isNotEmpty) 'imei': imei.trim(),
    if (model != null && model.trim().isNotEmpty) 'model': model.trim(),
    if (timezoneOffsetMinutes != null) 'timezoneOffsetMinutes': timezoneOffsetMinutes,
  });

  Future<Map<String, dynamic>> rotateCredential(String deviceId) =>
      _request('POST', '/api/v1/tracking/devices/gps/$deviceId/rotate-credential');

  Future<Map<String, dynamic>> revoke(String deviceId) =>
      _request('POST', '/api/v1/tracking/devices/gps/$deviceId/revoke');

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    final response = await client.authorized(method, path, body: body);
    Map<String, dynamic> payload = {};
    if (response.body.isNotEmpty) {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) payload = Map<String, dynamic>.from(decoded);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(payload['message']?.toString() ?? 'GPS tracker request failed');
    }
    return payload;
  }
}
