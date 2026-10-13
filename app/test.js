const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      throw new Error(`/health returned HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body.status !== 'ok') {
      throw new Error(`/health returned an unexpected response: ${JSON.stringify(body)}`);
    }
    console.log(`Smoke test passed: ${baseUrl}/health`);
  } catch (error) {
    console.error(`Smoke test failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
