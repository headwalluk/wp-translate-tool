import https from 'https';

declare const __VERSION__: string;

const REPO = 'headwalluk/wp-translate-tool';

export function getVersion(): string {
  return __VERSION__;
}

function fetchLatestTag(): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'wp-translate-tool',
        'Accept': 'application/vnd.github+json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
          return;
        }
        const release = JSON.parse(data);
        resolve(release.tag_name.replace(/^v/, ''));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export async function checkForUpdate(): Promise<void> {
  const current = getVersion();
  console.log(`Installed version: ${current}`);

  try {
    const latest = await fetchLatestTag();
    if (latest === current) {
      console.log(`You are up to date.`);
    } else {
      console.log(`Update available:  ${latest}`);
      console.log(`\nTo update:\n`);
      console.log(`  sudo curl -fsSL -o /usr/local/bin/wp-translate \\`);
      console.log(`    https://github.com/${REPO}/releases/latest/download/wp-translate.mjs`);
      process.exit(2);
    }
  } catch (err) {
    console.error('Could not check for updates:', (err as Error).message);
    process.exit(1);
  }
}
