import 'package:flutter_test/flutter_test.dart';
import 'package:darb_gps/main.dart';

void main() {
  test('DARB root application widget is constructible', () {
    const app = DarbApp();
    expect(app, isA<DarbApp>());
  });
}
