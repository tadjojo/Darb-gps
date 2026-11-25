import 'package:flutter_test/flutter_test.dart';
import 'package:darb_gps/services/darb_client.dart';

void main() {
  group('DarbClient API endpoint validation', () {
    test('accepts the HTTPS Cloudflare API origin', () {
      expect(
        DarbClient.normalizeBaseUrl(DarbClient.defaultApiBaseUrl),
        DarbClient.defaultApiBaseUrl,
      );
    });

    test('rejects public HTTP endpoints in release configuration', () {
      expect(
        () => DarbClient.normalizeBaseUrl('http://api.example.com'),
        throwsArgumentError,
      );
    });

    test('allows HTTP only for local debug endpoints', () {
      expect(
        DarbClient.normalizeBaseUrl('http://10.0.2.2:3000', allowLocalHttp: true),
        'http://10.0.2.2:3000',
      );
      expect(
        () => DarbClient.normalizeBaseUrl('http://api.example.com', allowLocalHttp: true),
        throwsArgumentError,
      );
    });

    test('rejects URLs containing credentials, query, or fragment', () {
      for (final value in [
        'https://user:password@example.com',
        'https://api.example.com?token=secret',
        'https://api.example.com#fragment',
      ]) {
        expect(() => DarbClient.normalizeBaseUrl(value), throwsArgumentError);
      }
    });

    test('rejects malformed or unsupported schemes', () {
      for (final value in ['', 'not a url', 'ftp://api.example.com']) {
        expect(() => DarbClient.normalizeBaseUrl(value), throwsArgumentError);
      }
    });
  });
}
