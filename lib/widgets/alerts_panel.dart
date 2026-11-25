import 'dart:async';
import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import '../services/darb_client.dart';

class AlertsPanel extends StatefulWidget {
  const AlertsPanel({super.key, required this.api, required this.vehicleId, required this.active, required this.arabic, required this.position});
  final DarbClient api;
  final String? vehicleId;
  final bool active;
  final bool arabic;
  final LatLng? position;
  @override
  State<AlertsPanel> createState() => _AlertsPanelState();
}

class _AlertsPanelState extends State<AlertsPanel> {
  Timer? _timer;
  bool _loading = false;
  String _filter = 'open';
  List<Map<String, dynamic>> _alerts = [];
  List<Map<String, dynamic>> _rules = [];
  String tr(String ar, String en) => widget.arabic ? ar : en;
  @override
  void initState() { super.initState(); _syncTimer(); if (widget.active) _load(); }
  @override
  void didUpdateWidget(covariant AlertsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active || oldWidget.vehicleId != widget.vehicleId) { _syncTimer(); if (widget.active) _load(); }
  }
  void _syncTimer() { _timer?.cancel(); if (widget.active) _timer = Timer.periodic(const Duration(seconds: 30), (_) => _load()); }
  @override
  void dispose() { _timer?.cancel(); super.dispose(); }
  Future<void> _load() async {
    final vehicle = widget.vehicleId;
    if (!widget.active || vehicle == null || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await Future.wait([widget.api.listAlerts(status: _filter == 'all' ? null : _filter, vehicleId: vehicle), widget.api.listAlertRules(vehicleId: vehicle)]);
      if (mounted) setState(() { _alerts = result[0]; _rules = result[1]; });
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
    finally { if (mounted) setState(() => _loading = false); }
  }
  Future<void> _status(String id, bool resolve) async {
    try { if (resolve) { await widget.api.resolveAlert(id); } else { await widget.api.acknowledgeAlert(id); } await _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
  }
  Future<void> _newSpeedRule() async {
    final vehicle = widget.vehicleId; if (vehicle == null) return;
    final name = TextEditingController(text: tr('حد السرعة', 'Speed limit')); final limit = TextEditingController(text: '80');
    final result = await showDialog<List<String>>(context: context, builder: (context) => AlertDialog(
      title: Text(tr('قاعدة سرعة جديدة', 'New speed rule')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: name, decoration: InputDecoration(labelText: tr('اسم القاعدة', 'Rule name'))), TextField(controller: limit, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('السرعة كم/س', 'Speed km/h')))]),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))), FilledButton(onPressed: () => Navigator.pop(context, [name.text.trim(), limit.text.trim()]), child: Text(tr('إنشاء', 'Create')))],
    ));
    name.dispose(); limit.dispose(); if (result == null) return;
    final speed = double.tryParse(result[1]);
    if (result[0].isEmpty || speed == null || speed <= 0 || speed > 300) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('السرعة يجب أن تكون 1–300', 'Speed limit must be 1–300')))); return; }
    try { await widget.api.createAlertRule(vehicle, 'speed_limit', result[0], {'limitKmh': speed}); await _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
  }
  Future<void> _newFence() async {
    final vehicle = widget.vehicleId; final point = widget.position;
    if (vehicle == null || point == null) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('يلزم موقع مركبة لإنشاء النطاق', 'Vehicle location is needed for a geofence')))); return; }
    final name = TextEditingController(text: tr('نطاق جغرافي', 'Geofence')); final radius = TextEditingController(text: '200');
    final result = await showDialog<List<String>>(context: context, builder: (context) => AlertDialog(
      title: Text(tr('نطاق جغرافي جديد', 'New geofence')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: name, decoration: InputDecoration(labelText: tr('الاسم', 'Name'))), TextField(controller: radius, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('نصف القطر (م)', 'Radius (m)'))), Text('${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)}')]),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))), FilledButton(onPressed: () => Navigator.pop(context, [name.text.trim(), radius.text.trim()]), child: Text(tr('إنشاء', 'Create')))],
    ));
    name.dispose(); radius.dispose(); if (result == null) return;
    final meters = double.tryParse(result[1]);
    if (result[0].isEmpty || meters == null || meters < 25 || meters > 100000) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('نصف القطر 25–100000 متر', 'Radius must be 25–100000 m')))); return; }
    try { await widget.api.createAlertRule(vehicle, 'geofence', result[0], {'latitude': point.latitude, 'longitude': point.longitude, 'radiusMeters': meters}); await _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
  }
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(16), children: [
    Row(children: [Expanded(child: Text(tr('التنبيهات والقواعد', 'Alerts & rules'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold))), IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))]),
    if (widget.vehicleId == null) Card(child: ListTile(leading: const Icon(Icons.info_outline), title: Text(tr('أنشئ أو اختر مركبة أولاً', 'Create or select a vehicle first'))))
    else ...[
      DropdownButtonFormField<String>(value: _filter, decoration: InputDecoration(labelText: tr('تصفية التنبيهات', 'Filter alerts')), items: [DropdownMenuItem(value: 'open', child: Text(tr('مفتوحة', 'Open'))), DropdownMenuItem(value: 'acknowledged', child: Text(tr('تمت الملاحظة', 'Acknowledged'))), DropdownMenuItem(value: 'resolved', child: Text(tr('محلولة', 'Resolved'))), DropdownMenuItem(value: 'all', child: Text(tr('الكل', 'All')))], onChanged: (v) { if (v != null) { setState(() => _filter = v); _load(); } }),
      if (_loading) const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator())),
      if (!_loading && _alerts.isEmpty) Card(child: ListTile(leading: const Icon(Icons.notifications_none), title: Text(tr('لا توجد تنبيهات', 'No alerts')))),
      ..._alerts.map((a) { final status = a['status']?.toString() ?? 'open'; final severity = a['severity']?.toString() ?? ''; final color = severity == 'critical' ? Colors.red : severity == 'warning' ? Colors.orange : Colors.blue; final time = DateTime.tryParse('${a['occurred_at']}')?.toLocal();
        return Card(child: Padding(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [Icon(Icons.notifications_active, color: color), const SizedBox(width: 8), Expanded(child: Text(a['title']?.toString() ?? tr('تنبيه', 'Alert'), style: const TextStyle(fontWeight: FontWeight.bold))), Chip(label: Text(status))]), Text(a['message']?.toString() ?? ''), if (time != null) Text(time.toString(), style: Theme.of(context).textTheme.bodySmall), Wrap(spacing: 8, children: [if (status == 'open') OutlinedButton.icon(onPressed: () => _status(a['id'].toString(), false), icon: const Icon(Icons.check), label: Text(tr('ملاحظة', 'Acknowledge'))), if (status != 'resolved') OutlinedButton.icon(onPressed: () => _status(a['id'].toString(), true), icon: const Icon(Icons.done_all), label: Text(tr('حل', 'Resolve')))])])));
      }),
      const Divider(height: 24),
      Row(children: [Expanded(child: Text(tr('قواعد التنبيه', 'Alert rules'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))), IconButton(onPressed: _newSpeedRule, icon: const Icon(Icons.speed)), IconButton(onPressed: _newFence, icon: const Icon(Icons.my_location))]),
      if (_rules.isEmpty) Card(child: ListTile(leading: const Icon(Icons.rule), title: Text(tr('لا توجد قواعد', 'No rules yet')))),
      ..._rules.map((rule) { final type = rule['rule_type']?.toString() ?? ''; final config = rule['config'] is Map ? Map<String, dynamic>.from(rule['config']) : <String, dynamic>{}; final summary = type == 'speed_limit' ? '${config['limitKmh'] ?? '-'} km/h' : '${config['radiusMeters'] ?? '-'} m'; return Card(child: ListTile(leading: Icon(type == 'speed_limit' ? Icons.speed : Icons.my_location), title: Text(rule['name']?.toString() ?? ''), subtitle: Text(summary), trailing: Icon(rule['enabled'] == true ? Icons.check_circle : Icons.pause_circle_outline))); }),
    ],
  ]);
}
