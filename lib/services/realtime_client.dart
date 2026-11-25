import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Polling-based live-location client. This avoids requiring a Socket.IO server
/// when the API is hosted on a free Cloudflare Worker.
class DarbRealtimeClient {
  DarbRealtimeClient({http.Client? client, this.interval = const Duration(seconds: 10)})
      : _client = client ?? http.Client(),
        _ownsClient = client == null;

  final http.Client _client;
  final bool _ownsClient;
  final Duration interval;
  Timer? _timer;
  bool _polling = false;
  bool _connected = false;
  String? _baseUrl;
  String? _accessToken;
  String? _vehicleId;
  String? _lastLocationKey;
  void Function(Map<String, dynamic>)? _onLocation;
  void Function(bool)? _onConnection;

  void connect({
    required String baseUrl,
    required String accessToken,
    required String vehicleId,
    required void Function(Map<String, dynamic>) onLocation,
    required void Function(bool) onConnection,
  }) {
    disconnect();
    _baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    _accessToken = accessToken;
    _vehicleId = vehicleId;
    _onLocation = onLocation;
    _onConnection = onConnection;
    _lastLocationKey = null;
    _setConnection(false);
    unawaited(pollNow());
    _timer = Timer.periodic(interval, (_) => unawaited(pollNow()));
  }

  /// Runs one poll. Exposed to support deterministic tests and manual refresh.
  Future<void> pollNow() async {
    if (_polling) return;
    final base = _baseUrl, token = _accessToken, vehicle = _vehicleId;
    if (base == null || token == null || vehicle == null) return;
    _polling = true;
    try {
      final uri = Uri.parse('$base/api/v1/tracking/vehicles/$vehicle/latest');
      final response = await _client.get(uri, headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
      });
      if (response.statusCode != 200) {
        _setConnection(false);
        return;
      }
      _setConnection(true);
      final decoded = jsonDecode(response.body);
      final payload = decoded is Map && decoded.containsKey('data') ? decoded['data'] : decoded;
      if (payload is! Map) return;
      final location = Map<String, dynamic>.from(payload);
      final key = _locationKey(location);
      if (key == null || key == _lastLocationKey) return;
      _lastLocationKey = key;
      _onLocation?.call(location);
    } catch (_) {
      _setConnection(false);
    } finally {
      _polling = false;
    }
  }

  String? _locationKey(Map<String, dynamic> location) {
    final id = location['id'] ?? location['eventId'] ?? location['recorded_at'] ?? location['recordedAt'];
    if (id != null) return id.toString();
    final lat = location['latitude'], lng = location['longitude'];
    if (lat == null || lng == null) return null;
    return '$lat:$lng';
  }

  void _setConnection(bool value) {
    if (_connected == value) return;
    _connected = value;
    _onConnection?.call(value);
  }

  void disconnect() {
    _timer?.cancel();
    _timer = null;
    _polling = false;
    _baseUrl = null;
    _accessToken = null;
    _vehicleId = null;
    _lastLocationKey = null;
    _onLocation = null;
    _onConnection = null;
    _connected = false;
    if (_ownsClient) _client.close();
  }
}
