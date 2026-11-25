import 'package:flutter_test/flutter_test.dart';
import 'package:darb_gps/services/gps_coordinate_validator.dart';

void main() {
  group('GpsCoordinateValidator', () {
    test('accepts valid geographic boundary and ordinary coordinates', () {
      expect(GpsCoordinateValidator.isValid(31.9539, 35.9106), isTrue);
      expect(GpsCoordinateValidator.isValid(-90, -180), isTrue);
      expect(GpsCoordinateValidator.isValid(90, 180), isTrue);
    });

    test('rejects null, out-of-range and non-finite coordinates', () {
      expect(GpsCoordinateValidator.isValid(null, 0), isFalse);
      expect(GpsCoordinateValidator.isValid(0, null), isFalse);
      expect(GpsCoordinateValidator.isValid(90.0001, 0), isFalse);
      expect(GpsCoordinateValidator.isValid(0, 180.0001), isFalse);
      expect(GpsCoordinateValidator.isValid(double.nan, 0), isFalse);
      expect(GpsCoordinateValidator.isValid(0, double.infinity), isFalse);
    });
  });
}
