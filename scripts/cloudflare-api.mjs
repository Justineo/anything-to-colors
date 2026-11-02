import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function cloudflareApi() {
  const root = pathToFileURL(
    realpathSync(new URL("../node_modules/void/package.json", import.meta.url)),
  );
  const { createCfAuth, createCfProfileStore } = await import(
    new URL("../@cloudflare/workers-auth/dist/cf/index.mjs", root)
  );
  const logger = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
  const loginRequired = async () => {
    throw new Error("Run void cloudflare login first.");
  };
  const auth = createCfAuth({
    logger,
    userAgent: "anything-to-color",
    prompt: loginRequired,
    select: loginRequired,
    isNoDefaultValueProvidedError: () => false,
  });
  auth.setProfile(
    createCfProfileStore({ logger }).resolve({
      cwd: fileURLToPath(new URL("../backend", import.meta.url)),
    }),
  );
  const token = await auth.getOAuthTokenFromLocalState();
  if (!token) throw new Error("Run void cloudflare login first.");
  return async (path, init = {}) => {
    const response = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/712272db055c8792a75c0e227ba21762" + path,
      {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(JSON.stringify(data.errors));
    return data.result;
  };
}
