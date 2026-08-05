import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type ConfigEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const CYRILLIC_RE = /[А-Яа-яЁё]/;
const TEMPLATE_PLACEHOLDER_RE = /\$\{[^}]+\}|\{[A-Za-z_][A-Za-z0-9_]*\}/;
const NPC_INTAKE_ROUTE = "/npc-intake/";
const NPC_INTAKE_DIR = path.join(root, "gigahrush-npc-intake");

type RuntimeLocaleCatalog = [
  [string, string][],
  [string, string][],
];

function normalizeModuleId(id: string): string {
  const clean = id.split("?")[0] ?? id;
  const normalized = clean.split(path.sep).join("/");
  const rootPrefix = `${root.split(path.sep).join("/")}/`;
  return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized;
}

function buildSizeManifest(): Plugin {
  let manifest = "";

  return {
    name: "gigahrush-build-size-manifest",
    apply: "build",
    enforce: "pre",
    generateBundle(_options, bundle) {
      const chunks = [];
      const assets = [];
      const modules = [];

      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") {
          chunks.push({
            fileName: output.fileName,
            bytes: Buffer.byteLength(output.code, "utf8"),
            moduleCount: Object.keys(output.modules).length,
          });

          for (const [id, info] of Object.entries(output.modules)) {
            modules.push({
              id: normalizeModuleId(id),
              chunk: output.fileName,
              originalLength: info.originalLength,
              renderedLength: info.renderedLength,
            });
          }
        } else {
          const source = output.source;
          const bytes = typeof source === "string" ? Buffer.byteLength(source, "utf8") : source.length;
          assets.push({ fileName: output.fileName, bytes });
        }
      }

      manifest = JSON.stringify({ version: 1, chunks, assets, modules }, null, 2);
    },
    async writeBundle(options) {
      if (!manifest) return;
      const outDir = options.dir ? (path.isAbsolute(options.dir) ? options.dir : path.resolve(root, options.dir)) : path.resolve(root, "dist");
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "build-size-manifest.json"), manifest);
    },
  };
}

function npcIntakeSubproject(): Plugin {
  const intakeIndex = path.join(NPC_INTAKE_DIR, "index.html");
  const intakeSrc = path.join(NPC_INTAKE_DIR, "src");
  if (!existsSync(intakeIndex) || !existsSync(intakeSrc)) {
    throw new Error("Cloudflare NPC intake build requires gigahrush-npc-intake/index.html and gigahrush-npc-intake/src");
  }

  return {
    name: "gigahrush-npc-intake-subproject",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? "/";
        const url = new URL(rawUrl, "http://localhost");
        if (url.pathname === "/npc-intake") {
          res.statusCode = 308;
          res.setHeader("Location", NPC_INTAKE_ROUTE);
          res.end();
          return;
        }
        if (!url.pathname.startsWith(NPC_INTAKE_ROUTE)) {
          next();
          return;
        }

        const relative = decodeURIComponent(url.pathname.slice(NPC_INTAKE_ROUTE.length)) || "index.html";
        const requestedPath = path.resolve(NPC_INTAKE_DIR, relative);
        const insideIntake = requestedPath === NPC_INTAKE_DIR || requestedPath.startsWith(`${NPC_INTAKE_DIR}${path.sep}`);
        if (!insideIntake || !existsSync(requestedPath)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const filePath = statSync(requestedPath).isDirectory() ? path.join(requestedPath, "index.html") : requestedPath;
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const ext = path.extname(filePath);
        const type = ext === ".html" ? "text/html; charset=utf-8"
          : ext === ".js" ? "application/javascript; charset=utf-8"
          : ext === ".css" ? "text/css; charset=utf-8"
          : ext === ".json" ? "application/json; charset=utf-8"
          : ext === ".png" ? "image/png"
          : ext === ".webp" ? "image/webp"
          : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
          : "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.end(readFileSync(filePath));
      });
    },
    async writeBundle(options) {
      const outDir = options.dir ? (path.isAbsolute(options.dir) ? options.dir : path.resolve(root, options.dir)) : path.resolve(root, "dist");
      const target = path.join(outDir, "npc-intake");
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      await cp(intakeIndex, path.join(target, "index.html"));
      await cp(intakeSrc, path.join(target, "src"), { recursive: true });
    },
  };
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function sourceKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function runtimeEnglishLocale(): RuntimeLocaleCatalog {
  const file = path.join(root, "locales", "en.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    entries?: Record<string, { source?: unknown; translation?: unknown; status?: unknown } | string>;
  };
  const exact: [string, string][] = [];
  const templates: [string, string][] = [];
  const exactSources = new Map<string, string>();

  for (const record of Object.values(parsed.entries ?? {})) {
    if (typeof record !== "object" || !record || record.status === "todo") continue;
    if (typeof record.source !== "string" || typeof record.translation !== "string") continue;
    const source = normalizeText(record.source);
    const translation = normalizeText(record.translation);
    if (!source || !translation || !CYRILLIC_RE.test(source)) continue;
    if (TEMPLATE_PLACEHOLDER_RE.test(source)) {
      templates.push([source, translation]);
      continue;
    }

    const key = sourceKey(source);
    const previous = exactSources.get(key);
    if (previous && previous !== source) {
      throw new Error(`English locale runtime hash collision between "${previous}" and "${source}"`);
    }
    exactSources.set(key, source);
    exact.push([key, translation]);
  }

  return [exact, templates];
}

function cloudflareBuildMode(env: ConfigEnv): boolean {
  return env.mode === "cloudflare" || process.env.GIGAHRUSH_NPC_INTAKE === "1";
}

export default defineConfig((env) => {
  const includeNpcIntake = cloudflareBuildMode(env);
  return {
    plugins: [
      buildSizeManifest(),
      ...(includeNpcIntake ? [npcIntakeSubproject()] : []),
      viteSingleFile(),
    ],
    define: {
      "globalThis.__GIGAHRUSH_EN_LOCALE__": JSON.stringify(runtimeEnglishLocale()),
      "globalThis.__GIGAHRUSH_NPC_INTAKE_ENABLED__": JSON.stringify(includeNpcIntake),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
