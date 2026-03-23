import { useEffect, useState } from 'react';

interface Release {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

function Download() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchRelease = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          'https://api.github.com/repos/tktcorporation/vrchat-albums/releases/latest',
          { signal: controller.signal },
        );

        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data: unknown = await res.json();

        // APIレスポンスの構造を検証
        if (
          !data ||
          typeof data !== 'object' ||
          !('tag_name' in data) ||
          typeof (data as { tag_name: unknown }).tag_name !== 'string' ||
          !('assets' in data) ||
          !Array.isArray((data as { assets: unknown }).assets)
        ) {
          throw new Error('Invalid release data format');
        }

        setRelease(data as Release);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Failed to fetch release:', err);
        setError(
          'リリース情報の取得に失敗しました。しばらくしてから再度お試しください。',
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchRelease();

    return () => controller.abort();
  }, []);

  const getDownloadLink = (platform: string) => {
    if (!release) return '#';

    const asset = release.assets.find((a) => {
      const name = a.name.toLowerCase();
      if (platform === 'windows' && name.endsWith('.exe')) return true;
      if (platform === 'mac' && name.endsWith('.dmg')) return true;
      if (platform === 'linux' && name.endsWith('.appimage')) return true;
      return false;
    });

    return asset?.browser_download_url || '#';
  };

  return (
    <section id="download" className="py-24 bg-white dark:bg-gray-950">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            今すぐダウンロード
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            完全無料・オープンソースのアプリケーションです
          </p>
          {loading && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              バージョン情報を取得中...
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">
              {error}
            </p>
          )}
          {!loading && !error && release && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 font-mono bg-gray-100 dark:bg-gray-900 px-4 py-1 rounded-full inline-block">
              最新バージョン: {release.tag_name}
            </p>
          )}
        </div>

        <div className="flex justify-center my-12">
          <a
            href={getDownloadLink('windows')}
            className="bg-gray-50 dark:bg-gray-900 p-8 rounded-lg text-center no-underline text-gray-900 dark:text-gray-100 transition-all duration-250 border-2 border-transparent flex flex-col items-center hover:-translate-y-1 hover:shadow-lg hover:border-[#5865F2] max-w-sm"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="text-5xl mb-4">🪟</div>
            <h3 className="text-xl font-semibold mb-1">Windows</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Windows 10/11
            </p>
            <span className="inline-block bg-[#5865F2] text-white px-6 py-2 rounded-full font-medium text-sm mt-auto">
              ダウンロード (.exe)
            </span>
          </a>
        </div>

        <div className="text-center text-gray-600 dark:text-gray-400 text-sm">
          <p>
            その他のダウンロード方法や過去のバージョンは
            <a
              href="https://github.com/tktcorporation/vrchat-albums/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#5865F2] no-underline font-medium hover:underline"
            >
              GitHubのリリースページ
            </a>
            をご覧ください
          </p>
        </div>
      </div>
    </section>
  );
}

export default Download;
