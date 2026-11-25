import 'package:flutter/material.dart';
import '../services/darb_client.dart';
import '../services/gps_tracker_api.dart';

class GpsTrackerPanel extends StatefulWidget {
  const GpsTrackerPanel({super.key, required this.api, required this.trackerApi, required this.vehicleId, required this.active, required this.arabic});
  final DarbClient api;
  final GpsTrackerApi trackerApi;
  final String? vehicleId;
  final bool active;
  final bool arabic;

  @override
  State<GpsTrackerPanel> createState() => _GpsTrackerPanelState();
}

class _GpsTrackerPanelState extends State<GpsTrackerPanel> {
  bool _loading = false;
  List<Map<String, dynamic>> _devices = [];
  String tr(String ar, String en) => widget.arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    if (widget.active) _load();
  }

  @override
  void didUpdateWidget(covariant GpsTrackerPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && (!oldWidget.active || oldWidget.vehicleId != widget.vehicleId)) _load();
  }

  Future<void> _load() async {
    final vehicle = widget.vehicleId;
    if (!widget.active || vehicle == null || _loading) return;
    setState(() => _loading = true);
    try {
      final rows = await widget.api.listDevices(vehicle);
      if (mounted) setState(() => _devices = rows);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _showCredential(String title, String value, String hint) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [Text(hint), const SizedBox(height: 10), SelectableText(value, style: const TextStyle(fontFamily: 'monospace'))],
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إغلاق', 'Close')))],
        );
      },
    );
  }

  Future<void> _enroll() async {
    final vehicle = widget.vehicleId;
    if (vehicle == null) return;
    final label = TextEditingController();
    final imei = TextEditingController();
    final model = TextEditingController();
    String protocol = 'json';
    int timezone = 180;

    final form = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) {
          return AlertDialog(
            title: Text(tr('تسجيل GPS خارجي', 'Enroll external GPS')),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(controller: label, decoration: InputDecoration(labelText: tr('الاسم', 'Label'))),
                  DropdownButtonFormField<String>(
                    value: protocol,
                    decoration: InputDecoration(labelText: tr('البروتوكول', 'Protocol')),
                    items: const [
                      DropdownMenuItem(value: 'json', child: Text('HTTPS JSON')),
                      DropdownMenuItem(value: 'gt06', child: Text('GT06')),
                      DropdownMenuItem(value: 'nmea', child: Text('NMEA')),
                    ],
                    onChanged: (v) { if (v != null) update(() => protocol = v); },
                  ),
                  TextField(controller: imei, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr(protocol == 'json' ? 'IMEI اختياري' : 'IMEI مطلوب', protocol == 'json' ? 'IMEI optional' : 'IMEI required'))),
                  TextField(controller: model, decoration: InputDecoration(labelText: tr('الطراز', 'Model'))),
                  if (protocol == 'gt06')
                    DropdownButtonFormField<int>(
                      value: timezone,
                      decoration: InputDecoration(labelText: tr('منطقة التوقيت', 'Timezone')),
                      items: const [
                        DropdownMenuItem(value: 180, child: Text('UTC+3 Jordan')),
                        DropdownMenuItem(value: 120, child: Text('UTC+2')),
                        DropdownMenuItem(value: 0, child: Text('UTC')),
                      ],
                      onChanged: (v) { if (v != null) update(() => timezone = v); },
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))),
              FilledButton(onPressed: () => Navigator.pop(context, {'protocol': protocol, 'label': label.text.trim(), 'imei': imei.text.trim(), 'model': model.text.trim(), 'timezone': timezone}), child: Text(tr('تسجيل', 'Enroll'))),
            ],
          );
        },
      ),
    );

    label.dispose();
    imei.dispose();
    model.dispose();
    if (form == null) return;
    final number = form['imei'] as String;
    if ((form['protocol'] != 'json' && number.isEmpty) || (number.isNotEmpty && !RegExp(r'^[0-9]{8,20}$').hasMatch(number))) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('IMEI يجب أن يكون 8–20 رقمًا', 'IMEI must be 8–20 digits'))));
      return;
    }
    try {
      final data = await widget.trackerApi.enroll(
        vehicle,
        protocol: form['protocol'] as String,
        label: form['label'] as String,
        imei: number.isEmpty ? null : number,
        model: (form['model'] as String).isEmpty ? null : form['model'] as String,
        timezoneOffsetMinutes: form['protocol'] == 'gt06' ? form['timezone'] as int : null,
      );
      await _showCredential(
        tr('مفتاح الجهاز — انسخه الآن', 'Tracker credential — copy it now'),
        data['credential']?.toString() ?? '',
        tr('هذا المفتاح يظهر مرة واحدة. خزّنه في جهاز التتبع بأمان.', 'This secret is displayed once. Store it securely in the tracker.'),
      );
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _rotate(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(tr('تغيير المفتاح', 'Rotate credential')),
        content: Text(tr('سيُبطل المفتاح الحالي مباشرة.', 'The current key will be invalidated immediately.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(tr('تغيير', 'Rotate'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final data = await widget.trackerApi.rotateCredential(id);
      await _showCredential(tr('المفتاح الجديد', 'New credential'), data['credential']?.toString() ?? '', tr('احفظه الآن؛ لن يظهر ثانية.', 'Save now; it will not be shown again.'));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _revoke(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(tr('تعطيل الجهاز', 'Revoke tracker')),
        content: Text(tr('سيُمنع هذا الجهاز من إرسال بيانات جديدة.', 'This tracker will no longer be allowed to send new data.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(tr('تعطيل', 'Revoke'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.trackerApi.revoke(id);
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      Row(children: [
        Expanded(child: Text(tr('أجهزة GPS الخارجية', 'External GPS trackers'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold))),
        IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
        IconButton(onPressed: widget.vehicleId == null ? null : _enroll, icon: const Icon(Icons.add)),
      ]),
      if (widget.vehicleId == null) Card(child: ListTile(title: Text(tr('أنشئ مركبة أولاً', 'Create a vehicle first')))),
      if (_loading) const Center(child: CircularProgressIndicator()),
      if (!_loading && _devices.where((d) => d['device_type'] == 'gps_tracker').isEmpty && widget.vehicleId != null)
        Card(child: ListTile(leading: const Icon(Icons.router), title: Text(tr('لا توجد أجهزة GPS مستقلة', 'No external trackers enrolled')), subtitle: Text(tr('اضغط + لتسجيل جهاز GPS خارجي', 'Tap + to enroll an external GPS tracker')))),
      ..._devices.where((d) => d['device_type'] == 'gps_tracker').map((d) {
        final id = d['id']?.toString() ?? '';
        final status = d['connectionStatus']?.toString() ?? 'unknown';
        final last = d['last_seen_at']?.toString();
        final name = d['device_label']?.toString() ?? d['label']?.toString() ?? 'GPS Tracker';
        final proto = d['last_protocol']?.toString() ?? d['protocol']?.toString() ?? '';
        final model = d['model_name']?.toString() ?? d['model']?.toString() ?? '';
        return Card(
          child: ListTile(
            leading: Icon(Icons.router, color: status == 'online' ? Colors.green : Colors.grey),
            title: Text(name),
            subtitle: Text('${status.toUpperCase()} • $proto • $model${last == null ? '' : ' • $last'}'),
            trailing: PopupMenuButton<String>(
              onSelected: (v) { if (v == 'rotate') _rotate(id); if (v == 'revoke') _revoke(id); },
              itemBuilder: (context) => [
                PopupMenuItem(value: 'rotate', child: Text(tr('تغيير المفتاح', 'Rotate key'))),
                PopupMenuItem(value: 'revoke', child: Text(tr('تعطيل', 'Revoke'))),
              ],
            ),
          ),
        );
      }),
    ],
  );
}
