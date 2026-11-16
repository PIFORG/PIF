import { describeDevice } from './device';

describe('describeDevice', () => {
  it('résume les agents utilisateurs courants en français', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      ),
    ).toBe('Edge sous Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari sous macOS');
    expect(describeDevice(null, 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')).toBe(
      'Chrome sous Android',
    );
  });

  it('préfère l’agent utilisateur complet à une étiquette grossière', () => {
    expect(
      describeDevice('Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'),
    ).toBe('Edge sous Windows');
  });

  it('conserve les libellés humains et gère les valeurs manquantes', () => {
    expect(describeDevice('Work laptop')).toBe('Work laptop');
    expect(describeDevice(null, null)).toBe('Appareil inconnu');
  });
});
