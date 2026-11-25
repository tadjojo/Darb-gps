import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_gps/services/darb_client.dart';
import 'package:darb_gps/services/gps_tracker_api.dart';
import 'package:darb_gps/widgets/alerts_panel.dart';
import 'package:darb_gps/widgets/gps_tracker_panel.dart';

void main() {
  final api = DarbClient(const FlutterSecureStorage());

  testWidgets('alerts panel requires a vehicle before showing data', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: AlertsPanel(api: api, vehicleId: null, active: false, arabic: true, position: null),
    )));
    expect(find.text('أنشئ أو اختر مركبة أولاً'), findsOneWidget);
  });

  testWidgets('GPS tracker panel disables enrollment without a vehicle', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: GpsTrackerPanel(api: api, trackerApi: GpsTrackerApi(api), vehicleId: null, active: false, arabic: true),
    )));
    expect(find.text('أنشئ مركبة أولاً'), findsOneWidget);
    expect(find.byIcon(Icons.add), findsOneWidget);
  });
}
