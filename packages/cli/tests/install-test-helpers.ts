import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export function sha256Hex(contents: Buffer): string {
  return new Bun.CryptoHasher('sha256').update(contents).digest('hex');
}

export async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolvePromise) =>
    server.listen(0, '127.0.0.1', () => resolvePromise())
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise()))
      ),
  };
}
