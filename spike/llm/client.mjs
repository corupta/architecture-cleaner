// Minimal chat client for the recording gateway. Retries 429/5xx, honouring Retry-After.
const gatewayBase = process.env.AC_GATEWAY_URL ?? 'http://127.0.0.1:8787';

export const models = {
  super: 'nvidia/nemotron-3-super-120b-a12b',
  ultra: 'nvidia/Nemotron-3-Ultra-550b-a55b',
  lightning: 'nvidia/Nemotron-3_5-Lightning',
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function chat(runId, body, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${gatewayBase}/run/${runId}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ store: false, ...body }),
    });
    const text = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) {
      const retryAfterSeconds = Number(response.headers.get('retry-after') ?? 2 ** attempt);
      await sleep(Math.min(retryAfterSeconds, 60) * 1000);
      continue;
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // streamed or error text; caller inspects `text`
    }
    return { status: response.status, json, text, replay: response.headers.get('x-ac-replay') === '1' };
  }
}

export function reasoningOf(message) {
  return message?.reasoning_content ?? message?.reasoning ?? null;
}

export async function gatewayStatus() {
  return (await fetch(`${gatewayBase}/status`)).json();
}
