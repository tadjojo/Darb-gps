import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geolocator_android/geolocator_android.dart';
import 'package:latlong2/latlong.dart';
import 'package:uuid/uuid.dart';
import 'services/darb_client.dart';
import 'services/pending_location_store.dart';
import 'services/realtime_client.dart';
import 'services/navigation_service.dart';

void main() => runApp(const DarbApp());

class DarbApp extends StatefulWidget {
  const DarbApp({super.key});
  @override
  State<DarbApp> createState() => _DarbAppState();
}

class _DarbAppState extends State<DarbApp> {
  bool arabic = true;
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'DARB GPS',
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0878E8)), scaffoldBackgroundColor: const Color(0xFFF5F7FB)),
    home: HomePage(arabic: arabic, toggleLanguage: () => setState(() => arabic = !arabic)),
  );
}

class HomePage extends StatefulWidget {
  final bool arabic;
  final VoidCallback toggleLanguage;
  const HomePage({super.key, required this.arabic, required this.toggleLanguage});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  static const _storage = FlutterSecureStorage();
  late final DarbClient api = DarbClient(_storage);
  final PendingLocationStore queue = PendingLocationStore();
  final DarbRealtimeClient realtime = DarbRealtimeClient();
  final MapController mapController = MapController();
  final NavigationService navigation = NavigationService();
  final TextEditingController _placeSearch = TextEditingController();
  List<PlaceSuggestion> placeSuggestions = [];
  List<NavigationRoute> availableRoutes = [];
  PlaceSuggestion? destination;
  int selectedRouteIndex = 0;
  bool searchingPlaces = false, calculatingRoute = false;
  int _placeSearchGeneration = 0, _routeGeneration = 0;
  final _apiUrl = TextEditingController(text: 'http://10.0.2.2:3000');
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  final _orgName = TextEditingController(text: 'مؤسستي');
  final _vehicleName = TextEditingController(text: 'مركبتي');
  final _registration = TextEditingController();
  int tab = 0;
  LatLng? position;
  StreamSubscription<Position>? gpsSub;
  bool tracking = false, sharing = false, loggedIn = false, socketConnected = false, busy = false, syncing = false;
  String message = 'جاهز';
  String? vehicleId, deviceId, organizationId;
  int pendingCount = 0;
  List<Map<String, dynamic>> registeredDevices = [];
  bool loadingDevices = false;
  List<Map<String, dynamic>> tripHistory = [];
  List<Map<String, dynamic>> stopHistory = [];
  Map<String, dynamic>? selectedStop;
  int historyDays = 7;
  bool loadingTrips = false;
  bool loadingTripRoute = false;
  List<LatLng> historicalTripRoute = [];
  LatLng? historicalTripStart, historicalTripEnd;
  Timer? syncTimer;
  Timer? tokenTimer;
  Timer? gpsRetryTimer;
  int _gpsRetryAttempt = 0;
  int _trackingGeneration = 0;
  DateTime? _lastAcceptedGpsTime;
  final Set<String> seenEvents = <String>{};

  String tr(String ar, String en) => widget.arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    _apiUrl.text = await api.baseUrl;
    loggedIn = (await _storage.read(key: 'access_token')) != null;
    vehicleId = await _storage.read(key: 'vehicle_id');
    deviceId = await _storage.read(key: 'device_id');
    organizationId = await _storage.read(key: 'organization_id');
    pendingCount = await queue.count();
    if (mounted) setState(() {});
    if (loggedIn && vehicleId != null) await _connectRealtime();
    syncTimer = Timer.periodic(const Duration(seconds: 20), (_) => _syncQueue());
    tokenTimer = Timer.periodic(const Duration(minutes: 8), (_) async {
      if (!loggedIn) return;
      final refreshed = await api.refreshAccessToken();
      if (refreshed != null && vehicleId != null) await _connectRealtime();
    });
  }

  Future<void> _login() async {
    setState(() => busy = true);
    try {
      await api.setBaseUrl(_apiUrl.text);
      await api.login(_identifier.text, _password.text);
      if (!mounted) return;
      setState(() { loggedIn = true; message = tr('تم تسجيل الدخول بأمان', 'Signed in securely'); });
      if (vehicleId != null) await _connectRealtime();
    } catch (e) { _showError(e); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> _createOrgVehicle() async {
    setState(() => busy = true);
    try {
      final org = await api.createOrganization(_orgName.text.trim());
      final orgId = org['id']?.toString();
      if (orgId == null) throw Exception('لم يُرجع الخادم معرّف المؤسسة');
      final vehicle = await api.createVehicle(orgId, _vehicleName.text.trim(), registrationNumber: _registration.text);
      final vId = vehicle['id']?.toString();
      if (vId == null) throw Exception('لم يُرجع الخادم معرّف المركبة');
      await _storage.write(key: 'organization_id', value: orgId);
      await _storage.write(key: 'vehicle_id', value: vId);
      if (mounted) setState(() { organizationId = orgId; vehicleId = vId; deviceId = null; message = tr('تم إنشاء المؤسسة والمركبة', 'Organization and vehicle created'); });
      await _enrollDevice();
    } catch (e) { _showError(e); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> _enrollDevice() async {
    final vId = vehicleId;
    if (vId == null) throw Exception('أنشئ مركبة أو اختر مركبة أولاً');
    final result = await api.enrollMobile(vId);
    final device = result['device'];
    final id = device is Map ? device['id']?.toString() : null;
    if (id == null) throw Exception('لم يتم استلام معرّف جهاز الهاتف');
    await _storage.write(key: 'device_id', value: id);
    if (mounted) setState(() { deviceId = id; message = tr('تم اعتماد هذا الهاتف للمركبة', 'This phone is enrolled for the vehicle'); });
    await _connectRealtime();
    await _loadDevices();
  }

  Future<void> _loadDevices() async {
    final id = vehicleId;
    if (!loggedIn || id == null || loadingDevices) return;
    setState(() => loadingDevices = true);
    try {
      final devices = await api.listDevices(id);
      if (mounted) setState(() => registeredDevices = devices);
    } catch (e) { _showError(e); }
    finally { if (mounted) setState(() => loadingDevices = false); }
  }

  Future<void> _loadTrips() async {
    final id = vehicleId;
    if (!loggedIn || id == null || loadingTrips) return;
    setState(() => loadingTrips = true);
    try {
      final now = DateTime.now().toUtc();
      final from = now.subtract(Duration(days: historyDays));
      final results = await Future.wait([
        api.listTrips(id, from: from, to: now),
        api.listStops(id, from: from, to: now),
      ]);
      if (mounted) setState(() { tripHistory = results[0]; stopHistory = results[1]; selectedStop = null; });
    } catch (e) { _showError(e); }
    finally { if (mounted) setState(() => loadingTrips = false); }
  }

  Future<void> _openTripRoute(Map<String, dynamic> trip) async {
    final id = vehicleId;
    final device = trip['device_id']?.toString();
    final from = DateTime.tryParse('${trip['start_at']}');
    final to = DateTime.tryParse('${trip['end_at']}');
    if (id == null || device == null || from == null || to == null) {
      _showError(Exception(tr('بيانات الرحلة غير مكتملة', 'Trip details are incomplete')));
      return;
    }
    setState(() { loadingTripRoute = true; historicalTripRoute = []; });
    try {
      final rows = await api.getTripRoute(id, device, from: from, to: to);
      final points = <LatLng>[];
      for (final row in rows) {
        final lat = (row['latitude'] as num?)?.toDouble();
        final lng = (row['longitude'] as num?)?.toDouble();
        if (lat == null || lng == null || !lat.isFinite || !lng.isFinite || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
        points.add(LatLng(lat, lng));
      }
      if (points.length < 2) throw Exception(tr('لا توجد نقاط كافية لرسم مسار هذه الرحلة', 'Not enough GPS points to draw this trip'));
      if (!mounted) return;
      setState(() {
        historicalTripRoute = points;
        selectedStop = null;
        historicalTripStart = points.first;
        historicalTripEnd = points.last;
        availableRoutes = [];
        destination = null;
        tab = 0;
      });
      final bounds = LatLngBounds.fromPoints(points);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && tab == 0) mapController.fitCamera(CameraFit.bounds(bounds: bounds, padding: const EdgeInsets.fromLTRB(48, 130, 48, 150)));
      });
    } catch (e) { _showError(e); }
    finally { if (mounted) setState(() => loadingTripRoute = false); }
  }

  void _clearHistoricalTrip() {
    setState(() { historicalTripRoute = []; historicalTripStart = null; historicalTripEnd = null; });
  }

  void _showStopOnMap(Map<String, dynamic> stop) {
    final lat = (stop['latitude'] as num?)?.toDouble();
    final lng = (stop['longitude'] as num?)?.toDouble();
    if (lat == null || lng == null || !lat.isFinite || !lng.isFinite || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      _showError(Exception(tr('إحداثيات التوقف غير صالحة', 'Stop coordinates are invalid')));
      return;
    }
    final point = LatLng(lat, lng);
    setState(() { selectedStop = stop; historicalTripRoute = []; historicalTripStart = null; historicalTripEnd = null; availableRoutes = []; destination = null; tab = 0; });
    WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted && tab == 0) mapController.move(point, 16); });
  }

  Future<void> _connectRealtime() async {
    final vId = vehicleId;
    final token = await _storage.read(key: 'access_token');
    if (vId == null || token == null) return;
    realtime.connect(baseUrl: await api.baseUrl, accessToken: token, vehicleId: vId,
      onConnection: (value) async {
        if (!mounted) return;
        setState(() => socketConnected = value);
        if (value) await _loadLatest();
      },
      onLocation: (event) {
        final id = event['eventId']?.toString() ?? event['outboxId']?.toString();
        if (id != null && !seenEvents.add(id)) return;
        final lat = (event['latitude'] as num?)?.toDouble();
        final lng = (event['longitude'] as num?)?.toDouble();
        if (lat != null && lng != null && mounted) setState(() => position = LatLng(lat, lng));
      });
  }

  Future<void> _loadLatest() async {
    if (vehicleId == null || !loggedIn) return;
    try {
      final data = await api.latestLocation(vehicleId!);
      if (data == null) return;
      final lat = (data['latitude'] as num?)?.toDouble();
      final lng = (data['longitude'] as num?)?.toDouble();
      if (lat != null && lng != null && mounted) setState(() => position = LatLng(lat, lng));
    } catch (_) { /* REST refresh is retried on the next reconnect/manual action. */ }
  }

  Future<void> startTracking() async {
    if (tracking) return;
    if (!loggedIn) { setState(() => message = tr('سجّل الدخول أولاً من الإعدادات', 'Sign in from Settings first')); return; }
    if (vehicleId == null || deviceId == null) { setState(() => message = tr('أنشئ مركبة واعتمد الهاتف من الإعدادات', 'Create a vehicle and enroll this phone in Settings')); return; }
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) { setState(() => message = tr('يرجى تشغيل GPS', 'Enable GPS first')); return; }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      setState(() => message = tr('إذن الموقع مطلوب', 'Location permission required')); return;
    }
    // Android: start a visible, user-initiated foreground location service.
    // The persistent notification makes active sharing explicit to the device user.
    _trackingGeneration++;
    _gpsRetryAttempt = 0;
    _lastAcceptedGpsTime = null;
    gpsRetryTimer?.cancel();
    final LocationSettings locationSettings = _buildLocationSettings();

    setState(() { tracking = true; sharing = true; message = tr('بدأ التتبع بموافقتك؛ سيظهر إشعار دائم على Android', 'Tracking started with your consent; Android shows an ongoing notification'); });
    _subscribeToGps(locationSettings, _trackingGeneration);
  }

  LocationSettings _buildLocationSettings() {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
        intervalDuration: const Duration(seconds: 5),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'DARB GPS',
          notificationText: 'مشاركة الموقع نشطة بإذن منك',
          notificationChannelName: 'تتبع دَرْب',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5);
  }

  void _subscribeToGps(LocationSettings settings, int generation) {
    if (!tracking || generation != _trackingGeneration) return;
    gpsSub?.cancel();
    gpsSub = Geolocator.getPositionStream(locationSettings: settings).listen((p) async {
      if (!tracking || generation != _trackingGeneration) return;
      final now = DateTime.now();
      final fixTime = p.timestamp;
      final age = now.difference(fixTime).abs();
      if (!p.latitude.isFinite || !p.longitude.isFinite || p.latitude < -90 || p.latitude > 90 || p.longitude < -180 || p.longitude > 180 || !p.accuracy.isFinite || p.accuracy < 0 || p.accuracy > 250 || age > const Duration(minutes: 2)) {
        if (mounted) setState(() => message = tr('تم تجاهل قراءة GPS غير صالحة أو قديمة', 'Ignored invalid or stale GPS fix'));
        return;
      }
      if (_lastAcceptedGpsTime != null && !fixTime.isAfter(_lastAcceptedGpsTime!)) return;
      _lastAcceptedGpsTime = fixTime;
      _gpsRetryAttempt = 0;
      final point = LatLng(p.latitude, p.longitude);
      if (mounted) setState(() => position = point);
      await _queueAndSync(p);
    }, onError: (_) {
      _scheduleGpsRestart(generation);
    }, onDone: () {
      _scheduleGpsRestart(generation);
    }, cancelOnError: true);
  }

  void _scheduleGpsRestart(int generation) {
    if (!tracking || generation != _trackingGeneration || gpsRetryTimer?.isActive == true) return;
    _gpsRetryAttempt++;
    final seconds = (2 * (1 << (_gpsRetryAttempt - 1).clamp(0, 5))).clamp(2, 60).toInt();
    if (mounted) setState(() => message = tr('انقطع تدفق GPS؛ إعادة المحاولة خلال $seconds ثانية', 'GPS stream interrupted; retrying in $seconds seconds'));
    gpsRetryTimer = Timer(Duration(seconds: seconds), () {
      gpsRetryTimer = null;
      if (tracking && generation == _trackingGeneration) _subscribeToGps(_buildLocationSettings(), generation);
    });
  }

  Future<void> _queueAndSync(Position p) async {
    final id = const Uuid().v4();
    final payload = <String, dynamic>{
      'eventId': id, 'deviceId': deviceId, 'vehicleId': vehicleId,
      'latitude': p.latitude, 'longitude': p.longitude,
      'accuracyMeters': p.accuracy,
      'recordedAt': p.timestamp.toUtc().toIso8601String(), 'source': 'mobile',
      if (p.speed.isFinite && p.speed >= 0) 'speedKmh': p.speed * 3.6,
      if (p.heading.isFinite && p.heading >= 0) 'heading': p.heading,
    };
    await queue.put(eventId: id, deviceId: deviceId!, vehicleId: vehicleId!, payloadJson: jsonEncode(payload));
    await _syncQueue();
  }

  Future<void> _syncQueue() async {
    if (!loggedIn || syncing) return;
    syncing = true;
    try {
      final rows = await queue.pending(limit: 50);
      for (final row in rows) {
        final eventId = row['event_id']! as String;
        try {
          final payload = jsonDecode(row['payload_json']! as String) as Map<String, dynamic>;
          await api.sendLocation(payload);
          await queue.remove(eventId);
        } catch (_) {
          await queue.incrementAttempt(eventId);
          break; // Keep order and retry later; the eventId remains unchanged.
        }
      }
      pendingCount = await queue.count();
      if (mounted && pendingCount > 0) setState(() => message = tr('مواقع تنتظر الاتصال: $pendingCount', 'Locations waiting for network: $pendingCount'));
    } finally { syncing = false; }
  }

  Future<void> stopTracking() async {
    _trackingGeneration++;
    gpsRetryTimer?.cancel(); gpsRetryTimer = null;
    await gpsSub?.cancel(); gpsSub = null;
    if (mounted) setState(() { tracking = false; sharing = false; message = tr('تم إيقاف التتبع', 'Tracking stopped'); });
  }

  void _showError(Object error) {
    if (!mounted) return;
    setState(() => message = '${tr('خطأ', 'Error')}: $error');
  }

  @override
  void dispose() {
    _trackingGeneration++; _placeSearchGeneration++; _routeGeneration++; gpsRetryTimer?.cancel();
    gpsSub?.cancel(); realtime.disconnect(); queue.close(); syncTimer?.cancel(); tokenTimer?.cancel();
    _apiUrl.dispose(); _identifier.dispose(); _password.dispose(); _orgName.dispose(); _vehicleName.dispose(); _registration.dispose();
    _placeSearch.dispose(); navigation.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final center = position ?? const LatLng(31.9539, 35.9106);
    final pages = [mapScreen(center), trackingScreen(), vehiclesScreen(), tripsScreen(), settingsScreen()];
    return Directionality(textDirection: widget.arabic ? TextDirection.rtl : TextDirection.ltr, child: Scaffold(
      appBar: AppBar(backgroundColor: Colors.white,
        title: const Row(children: [Icon(Icons.navigation, color: Color(0xFF0878E8)), SizedBox(width: 8), Text('DARB GPS', style: TextStyle(fontWeight: FontWeight.bold))]),
        actions: [IconButton(onPressed: widget.toggleLanguage, icon: const Icon(Icons.language)), IconButton(onPressed: _loadLatest, icon: const Icon(Icons.refresh))]),
      body: Column(children: [Expanded(child: pages[tab]), Container(width: double.infinity, color: const Color(0xFFE8F2FF), padding: const EdgeInsets.all(9), child: Text(message, textAlign: TextAlign.center))]),
      bottomNavigationBar: NavigationBar(selectedIndex: tab, onDestinationSelected: (v) { setState(() => tab = v); if (v == 2) _loadDevices(); if (v == 3) _loadTrips(); }, destinations: [
        NavigationDestination(icon: const Icon(Icons.map_outlined), label: tr('الخريطة', 'Map')),
        NavigationDestination(icon: const Icon(Icons.share_location), label: tr('التتبع', 'Tracking')),
        NavigationDestination(icon: const Icon(Icons.directions_car), label: tr('المركبات', 'Vehicles')),
        NavigationDestination(icon: const Icon(Icons.route), label: tr('الرحلات', 'Trips')),
        NavigationDestination(icon: const Icon(Icons.settings), label: tr('الإعدادات', 'Settings')),
      ]),
    ));
  }

  Future<void> _searchPlaces(String query) async {
    final generation = ++_placeSearchGeneration;
    if (query.trim().length < 2) {
      if (mounted) setState(() { placeSuggestions = []; searchingPlaces = false; });
      return;
    }
    setState(() { searchingPlaces = true; });
    try {
      final results = await navigation.searchPlaces(query, language: widget.arabic ? 'ar,en' : 'en,ar');
      if (mounted && generation == _placeSearchGeneration) setState(() => placeSuggestions = results);
    } catch (e) { if (generation == _placeSearchGeneration) _showError(e); }
    finally { if (mounted && generation == _placeSearchGeneration) setState(() => searchingPlaces = false); }
  }

  Future<void> _routeTo(PlaceSuggestion place) async {
    final generation = ++_routeGeneration;
    setState(() { calculatingRoute = true; destination = place; placeSuggestions = []; availableRoutes = []; });
    try {
      LatLng origin;
      if (position != null) {
        origin = position!;
      } else {
        final fix = await Geolocator.getCurrentPosition();
        origin = LatLng(fix.latitude, fix.longitude);
        if (mounted) setState(() => position = origin);
      }
      final routes = await navigation.getDrivingRoutes(origin, place.point);
      if (routes.isEmpty) throw const NavigationException('لم يتم العثور على مسار');
      if (!mounted || generation != _routeGeneration) return;
      setState(() { availableRoutes = routes; selectedRouteIndex = 0; _placeSearch.text = place.name; });
      final bounds = LatLngBounds.fromPoints(routes.first.points);
      mapController.fitCamera(CameraFit.bounds(bounds: bounds, padding: const EdgeInsets.fromLTRB(48, 150, 48, 150)));
    } catch (e) { if (generation == _routeGeneration) _showError(e); }
    finally { if (mounted && generation == _routeGeneration) setState(() => calculatingRoute = false); }
  }

  Widget mapScreen(LatLng center) => Stack(children: [
    FlutterMap(mapController: mapController, options: MapOptions(initialCenter: center, initialZoom: 13), children: [
      TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.darb.gps'),
      if (historicalTripRoute.length >= 2)
        PolylineLayer(polylines: [Polyline(points: historicalTripRoute, strokeWidth: 5, color: Colors.deepPurple)]),
      if (historicalTripRoute.isEmpty && availableRoutes.isNotEmpty && selectedRouteIndex < availableRoutes.length)
        PolylineLayer(polylines: [Polyline(points: availableRoutes[selectedRouteIndex].points, strokeWidth: 5, color: Colors.blue)]),
      if (position != null || destination != null || historicalTripStart != null || historicalTripEnd != null || selectedStop != null) MarkerLayer(markers: [
        if (position != null && historicalTripRoute.isEmpty) Marker(point: position!, width: 48, height: 48, child: const Icon(Icons.my_location, color: Colors.blue, size: 34)),
        if (destination != null && historicalTripRoute.isEmpty) Marker(point: destination!.point, width: 48, height: 48, child: const Icon(Icons.location_pin, color: Colors.red, size: 42)),
        if (historicalTripStart != null) Marker(point: historicalTripStart!, width: 48, height: 48, child: const Icon(Icons.play_circle_fill, color: Colors.green, size: 38)),
        if (historicalTripEnd != null) Marker(point: historicalTripEnd!, width: 48, height: 48, child: const Icon(Icons.flag_circle, color: Colors.red, size: 38)),
        if (selectedStop != null && selectedStop!['latitude'] is num && selectedStop!['longitude'] is num) Marker(point: LatLng((selectedStop!['latitude'] as num).toDouble(), (selectedStop!['longitude'] as num).toDouble()), width: 54, height: 54, child: const Icon(Icons.pause_circle_filled, color: Colors.deepOrange, size: 46)),
      ]),
    ]),
    Positioned(top: 12, left: 12, right: 12, child: Material(elevation: 3, borderRadius: BorderRadius.circular(15), child: TextField(controller: _placeSearch, onSubmitted: _searchPlaces, decoration: InputDecoration(hintText: tr('ابحث عن مكان أو عنوان', 'Search places or address'), prefixIcon: const Icon(Icons.search), suffixIcon: searchingPlaces ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))) : IconButton(icon: const Icon(Icons.clear), onPressed: () { _placeSearch.clear(); setState(() { placeSuggestions = []; destination = null; availableRoutes = []; }); }), border: InputBorder.none)))),
    if (placeSuggestions.isNotEmpty) Positioned(top: 68, left: 12, right: 12, child: Card(child: ConstrainedBox(constraints: const BoxConstraints(maxHeight: 260), child: ListView(shrinkWrap: true, children: placeSuggestions.map((place) => ListTile(dense: true, leading: const Icon(Icons.place_outlined), title: Text(place.name, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text(place.address, maxLines: 2, overflow: TextOverflow.ellipsis), onTap: () => _routeTo(place))).toList())))),
    if (calculatingRoute) Positioned(top: 78, left: 24, right: 24, child: Card(child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)), const SizedBox(width: 10), Text(tr('جارٍ حساب المسار...', 'Calculating route...'))])))),
    if (historicalTripRoute.isNotEmpty) Positioned(bottom: 82, left: 12, right: 12, child: Card(child: ListTile(dense: true, leading: const Icon(Icons.route, color: Colors.deepPurple), title: Text(tr('المسار التاريخي', 'Historical trip route')), subtitle: Text('${historicalTripRoute.length} ${tr('نقطة GPS', 'GPS points')}'), trailing: IconButton(onPressed: _clearHistoricalTrip, icon: const Icon(Icons.close))))),
    if (selectedStop != null) Positioned(bottom: 82, left: 12, right: 12, child: Card(child: ListTile(dense: true, leading: const Icon(Icons.pause_circle_filled, color: Colors.deepOrange), title: Text(tr('موقع التوقف المحدد', 'Selected stop location')), subtitle: Text('${selectedStop!['duration_seconds'] ?? 0} ${tr('ثانية توقف', 'seconds stopped')}'), trailing: IconButton(onPressed: () => setState(() => selectedStop = null), icon: const Icon(Icons.close))))),
    if (availableRoutes.isNotEmpty && historicalTripRoute.isEmpty) Positioned(bottom: 82, left: 12, right: 12, child: Card(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), child: Row(children: [Expanded(child: Text('${tr('المسار', 'Route')} ${selectedRouteIndex + 1}/${availableRoutes.length}  •  ${availableRoutes[selectedRouteIndex].distanceKilometers.toStringAsFixed(1)} km  •  ${availableRoutes[selectedRouteIndex].estimatedMinutes} min', style: const TextStyle(fontWeight: FontWeight.w600))), if (availableRoutes.length > 1) IconButton(onPressed: () => setState(() => selectedRouteIndex = (selectedRouteIndex + 1) % availableRoutes.length), icon: const Icon(Icons.alt_route)), IconButton(onPressed: () => setState(() { availableRoutes = []; destination = null; }), icon: const Icon(Icons.close))])))),
    Positioned(bottom: 18, right: 16, child: FloatingActionButton(heroTag: 'center', onPressed: () async { if (position == null) { final p = await Geolocator.getCurrentPosition(); setState(() => position = LatLng(p.latitude, p.longitude)); } if (position != null) mapController.move(position!, 16); }, child: const Icon(Icons.my_location))),
    Positioned(bottom: 18, left: 16, child: FilledButton.icon(onPressed: tracking ? stopTracking : startTracking, icon: Icon(tracking ? Icons.stop : Icons.navigation), label: Text(tr(tracking ? 'إيقاف التتبع' : 'بدء التتبع', tracking ? 'Stop tracking' : 'Start tracking')))),
  ]);

  Widget trackingScreen() => ListView(padding: const EdgeInsets.all(16), children: [
    Text(tr('التتبع المباشر', 'Live tracking'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
    Card(child: SwitchListTile(value: sharing, onChanged: (v) => v ? startTracking() : stopTracking(), secondary: const Icon(Icons.person_pin_circle), title: Text(tr('مشاركة موقعي', 'Share my location')), subtitle: Text(tr('تبدأ المشاركة بعد موافقتك فقط', 'Sharing starts only with your consent')))),
    Card(child: ListTile(leading: Icon(socketConnected ? Icons.wifi : Icons.wifi_off), title: Text(tr('الاتصال المباشر', 'Realtime connection')), subtitle: Text(socketConnected ? tr('متصل', 'Connected') : tr('غير متصل؛ تتم المزامنة عبر REST', 'Disconnected; REST sync remains available')))),
    Card(child: ListTile(leading: const Icon(Icons.cloud_upload_outlined), title: Text(tr('مواقع بانتظار المزامنة', 'Pending locations')), trailing: Text('$pendingCount'), onTap: _syncQueue)),
    Card(child: ListTile(leading: const Icon(Icons.shield_outlined), title: Text(tr('الخصوصية والأمان', 'Privacy & security')), subtitle: Text(tr('التتبع يعمل في الواجهة الأمامية فقط ويمكن إيقافه', 'Foreground-only tracking; you can stop it anytime')))),
  ]);

  Widget vehiclesScreen() => ListView(padding: const EdgeInsets.all(16), children: [
    Text(tr('المركبات والأجهزة', 'Vehicles & devices'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
    Card(child: ListTile(leading: const Icon(Icons.directions_car), title: Text(vehicleId ?? tr('لا توجد مركبة محددة', 'No vehicle selected')), subtitle: Text(deviceId ?? tr('لم يتم اعتماد الهاتف بعد', 'Phone not enrolled')), trailing: IconButton(icon: const Icon(Icons.add_link), onPressed: loggedIn ? _enrollDevice : null))),
    Card(child: ListTile(leading: const Icon(Icons.router), title: Text(tr('أجهزة GPS المسجلة للمركبة', 'GPS devices registered to this vehicle')), subtitle: Text(loadingDevices ? tr('جارٍ تحميل الأجهزة...', 'Loading devices...') : '${registeredDevices.length} ${tr('جهاز', 'device(s)')}'), trailing: IconButton(onPressed: loadingDevices ? null : _loadDevices, icon: const Icon(Icons.refresh)))),
    if (registeredDevices.isEmpty && !loadingDevices) Card(child: ListTile(leading: const Icon(Icons.info_outline), title: Text(tr('لا توجد أجهزة مستقلة مسجلة', 'No independent trackers registered')), subtitle: Text(tr('تظهر هنا الأجهزة التي يعتمدها مسؤول النظام للمركبة', 'Trackers provisioned for this vehicle by an administrator appear here')))),
    ...registeredDevices.map((device) {
      final isTracker = device['device_type']?.toString() == 'gps_tracker';
      final status = device['connectionStatus']?.toString() ?? 'unknown';
      final online = status == 'online';
      final label = device['device_label']?.toString() ?? (isTracker ? 'GPS Tracker' : 'Mobile');
      final manufacturer = device['manufacturer']?.toString();
      final model = device['model_name']?.toString();
      final battery = device['battery_percent'];
      final protocol = device['last_protocol']?.toString();
      final details = <String>[if (manufacturer != null && manufacturer.isNotEmpty) manufacturer, if (model != null && model.isNotEmpty) model, if (protocol != null && protocol.isNotEmpty) protocol.toUpperCase(), if (battery is num) '${battery.round()}%'].join(' • ');
      return Card(child: ListTile(leading: Icon(isTracker ? Icons.router : Icons.phone_android, color: online ? Colors.green : Colors.grey), title: Text(label), subtitle: Text('${tr(online ? 'متصل' : status == 'never_connected' ? 'لم يتصل بعد' : 'غير متصل', online ? 'Online' : status == 'never_connected' ? 'Never connected' : 'Offline')}${details.isEmpty ? '' : ' • $details'}'), trailing: Icon(status == 'never_connected' ? Icons.hourglass_empty : online ? Icons.wifi : Icons.wifi_off)));
    }),
  ]);

  Widget tripsScreen() => ListView(padding: const EdgeInsets.all(16), children: [
    Row(children: [Expanded(child: Text(tr('الرحلات والسجل', 'Trips & history'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold))),
      DropdownButton<int>(value: historyDays, items: const [7, 14, 30].map((d) => DropdownMenuItem<int>(value: d, child: Text('$d ${tr('أيام', 'days')}'))).toList(), onChanged: loadingTrips ? null : (v) { if (v != null) { setState(() => historyDays = v); _loadTrips(); } }),
      IconButton(onPressed: loadingTrips ? null : _loadTrips, icon: const Icon(Icons.refresh))]),
    if (!loggedIn || vehicleId == null)
      Card(child: ListTile(leading: const Icon(Icons.info_outline), title: Text(tr('سجّل الدخول وحدد مركبة لعرض الرحلات', 'Sign in and select a vehicle to view trips'))))
    else if (loadingTrips || loadingTripRoute)
      const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
    else ...[
      Text(tr('الرحلات', 'Trips'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      if (tripHistory.isEmpty)
        Card(child: ListTile(leading: const Icon(Icons.route), title: Text(tr('لا توجد رحلات خلال الفترة المحددة', 'No trips in the selected period'))))
      else ...tripHistory.map((trip) {
        final start = DateTime.tryParse('${trip['start_at']}')?.toLocal();
        final end = DateTime.tryParse('${trip['end_at']}')?.toLocal();
        final distance = double.tryParse('${trip['distance_meters']}') ?? 0;
        final count = trip['points_count'] ?? 0;
        final duration = start != null && end != null ? end.difference(start).inMinutes : 0;
        final title = start == null ? tr('رحلة', 'Trip') : '${start.year}-${start.month.toString().padLeft(2, '0')}-${start.day.toString().padLeft(2, '0')}  ${start.hour.toString().padLeft(2, '0')}:${start.minute.toString().padLeft(2, '0')}';
        return Card(child: ListTile(leading: const Icon(Icons.route, color: Color(0xFF0878E8)), title: Text(title), subtitle: Text('${(distance / 1000).toStringAsFixed(2)} km • $duration min • $count ${tr('نقطة', 'points')}'), trailing: const Icon(Icons.chevron_right), onTap: () => _openTripRoute(trip)));
      }),
      const SizedBox(height: 16),
      Text(tr('التوقفات المكتشفة', 'Detected stops'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      if (stopHistory.isEmpty)
        Card(child: ListTile(leading: const Icon(Icons.pause_circle_outline), title: Text(tr('لا توجد توقفات مؤكدة خلال الفترة المحددة', 'No confirmed stops in the selected period'))))
      else ...stopHistory.map((stop) {
        final start = DateTime.tryParse('${stop['start_at']}')?.toLocal();
        final duration = int.tryParse('${stop['duration_seconds']}') ?? 0;
        final minutes = duration ~/ 60;
        final hours = minutes ~/ 60;
        final dwell = hours > 0 ? '$hours ${tr('س', 'h')} ${minutes % 60} ${tr('د', 'min')}' : '$minutes ${tr('دقيقة', 'min')}';
        final title = start == null ? tr('توقف', 'Stop') : '${start.year}-${start.month.toString().padLeft(2, '0')}-${start.day.toString().padLeft(2, '0')}  ${start.hour.toString().padLeft(2, '0')}:${start.minute.toString().padLeft(2, '0')}';
        return Card(child: ListTile(leading: const Icon(Icons.pause_circle_filled, color: Colors.orange), title: Text(title), subtitle: Text('${tr('مدة التوقف', 'Dwell')}: $dwell • ${stop['points_count'] ?? 0} ${tr('قراءة', 'points')}'), trailing: const Icon(Icons.map_outlined), onTap: () => _showStopOnMap(stop)));
      }),
    ],
    const SizedBox(height: 8),
    Text(tr('يمكنك اختيار 7 أو 14 أو 30 يوماً. تُستنتج الرحلات والتوقفات من قراءات GPS؛ وقد تتأثر النتائج بدقة الإشارة والفجوات الزمنية.', 'Choose 7, 14, or 30 days. Trips and stops are inferred from GPS readings and may be affected by signal accuracy and data gaps.'), style: Theme.of(context).textTheme.bodySmall),
    Card(child: ListTile(leading: const Icon(Icons.download_for_offline), title: Text(tr('الخرائط دون إنترنت ضمن مرحلة لاحقة', 'Offline map packs are planned for a later phase')))),
  ]);

  Widget settingsScreen() => ListView(padding: const EdgeInsets.all(16), children: [
    Text(tr('إعداد الاتصال والحساب', 'Connection & account'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
    TextField(controller: _apiUrl, decoration: InputDecoration(labelText: tr('عنوان الخادم API', 'API base URL'), hintText: 'https://api.example.com')),
    TextField(controller: _identifier, decoration: InputDecoration(labelText: tr('البريد الإلكتروني أو الهاتف', 'Email or phone'))),
    TextField(controller: _password, obscureText: true, decoration: InputDecoration(labelText: tr('كلمة المرور', 'Password'))),
    const SizedBox(height: 8),
    FilledButton(onPressed: busy ? null : _login, child: Text(busy ? tr('يرجى الانتظار', 'Please wait') : tr(loggedIn ? 'تحديث تسجيل الدخول' : 'تسجيل الدخول', loggedIn ? 'Refresh login' : 'Sign in'))),
    const Divider(height: 28),
    Text(tr('إنشاء مؤسسة ومركبة', 'Create organization & vehicle'), style: const TextStyle(fontWeight: FontWeight.bold)),
    TextField(controller: _orgName, decoration: InputDecoration(labelText: tr('اسم المؤسسة', 'Organization name'))),
    TextField(controller: _vehicleName, decoration: InputDecoration(labelText: tr('اسم المركبة', 'Vehicle name'))),
    TextField(controller: _registration, decoration: InputDecoration(labelText: tr('رقم التسجيل (اختياري)', 'Registration (optional)'))),
    FilledButton.tonal(onPressed: loggedIn && !busy ? _createOrgVehicle : null, child: Text(tr('إنشاء واعتماد الهاتف', 'Create & enroll phone'))),
    if (loggedIn) TextButton.icon(onPressed: () async { await api.logout(); realtime.disconnect(); if (mounted) setState(() { loggedIn = false; socketConnected = false; message = tr('تم تسجيل الخروج', 'Signed out'); }); }, icon: const Icon(Icons.logout), label: Text(tr('تسجيل الخروج', 'Sign out'))),
    const Divider(height: 28),
    ListTile(leading: const Icon(Icons.language), title: Text(tr('اللغة', 'Language')), subtitle: Text(widget.arabic ? 'العربية' : 'English'), trailing: IconButton(onPressed: widget.toggleLanguage, icon: const Icon(Icons.swap_horiz))),
    const ListTile(leading: Icon(Icons.info_outline), title: Text('DARB GPS • Mobile Alpha')),
  ]);
}
