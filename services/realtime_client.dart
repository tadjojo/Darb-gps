import 'package:socket_io_client/socket_io_client.dart' as io;

class DarbRealtimeClient {
  io.Socket? _socket;

  void connect({required String baseUrl, required String accessToken,
      required String vehicleId, required void Function(Map<String, dynamic>) onLocation,
      required void Function(bool) onConnection}) {
    disconnect();
    final socket = io.io('$baseUrl/tracking', <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': accessToken},
      'reconnection': true,
      'reconnectionAttempts': 20,
      'reconnectionDelay': 1000,
    });
    socket.onConnect((_) {
      onConnection(true);
      socket.emit('vehicle.join', {'vehicleId': vehicleId});
    });
    socket.onDisconnect((_) => onConnection(false));
    socket.onConnectError((_) => onConnection(false));
    socket.on('vehicle.location.updated', (dynamic value) {
      if (value is Map) onLocation(Map<String, dynamic>.from(value));
    });
    _socket = socket;
    socket.connect();
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
