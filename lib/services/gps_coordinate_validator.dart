class GpsCoordinateValidator {
  const GpsCoordinateValidator._();

  static bool isValid(num? latitude, num? longitude) {
    if (latitude == null || longitude == null) return false;
    final lat = latitude.toDouble();
    final lng = longitude.toDouble();
    return lat.isFinite &&
        lng.isFinite &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
  }
}
