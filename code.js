/**
 * Export Design Tokens — Figma plugin
 * Exports local variables and optionally pushes them to GitHub.
 */

const CHUNK_SIZE = 900000;
const SETTINGS_KEY = "githubSettings";
const DEFAULT_OWNER = "hosam-hubspire";

figma.showUI(__html__, {
  width: 460,
  height: 740,
  themeColors: true,
});

const TYPE_TO_W3C = {
  COLOR: "color",
  FLOAT: "number",
  STRING: "string",
  BOOLEAN: "boolean",
};

function sendToUI(message) {
  try {
    figma.ui.postMessage(message);
  } catch (error) {
    console.error("postMessage failed", error);
    figma.notify("Failed to send data to plugin UI", { error: true });
  }
}

function sendJsonPayload({ format, fileName, json, meta }) {
  const totalChunks = Math.max(1, Math.ceil(json.length / CHUNK_SIZE));

  sendToUI({
    type: "EXPORT_START",
    format,
    fileName,
    meta,
    totalChunks,
    byteLength: json.length,
  });

  for (let i = 0; i < totalChunks; i++) {
    const chunk = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    sendToUI({
      type: "EXPORT_CHUNK",
      index: i,
      totalChunks,
      chunk,
    });
  }

  sendToUI({ type: "EXPORT_DONE" });
}

function rgbToHex(color) {
  if (!color || typeof color !== "object") {
    return String(color);
  }

  const r = Number(color.r) || 0;
  const g = Number(color.g) || 0;
  const b = Number(color.b) || 0;
  const alpha = color.a === undefined || color.a === null ? 1 : Number(color.a);

  if (alpha < 1) {
    return `rgba(${[r, g, b]
      .map((n) => Math.round(n * 255))
      .join(", ")}, ${Number(alpha.toFixed(4))})`;
  }

  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${[toHex(r), toHex(g), toHex(b)].join("")}`;
}

function isAlias(value) {
  return value && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}

function w3cValue(resolvedType, value, nameById) {
  if (isAlias(value)) {
    const name = nameById.get(value.id) || value.id;
    return `{${String(name).replace(/\//g, ".")}}`;
  }
  if (resolvedType === "COLOR") return rgbToHex(value);
  return value;
}

function setNestedToken(root, pathParts, token) {
  let obj = root;
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    const isLeaf = i === pathParts.length - 1;

    if (isLeaf) {
      obj[part] = token;
      return;
    }

    if (!obj[part] || typeof obj[part] !== "object" || obj[part].$value !== undefined) {
      obj[part] = {};
    }
    obj = obj[part];
  }
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() || "tokens";
}

/** UTF-8 → Base64 without TextEncoder (unavailable in Figma plugin sandbox). */
function utf8ToBase64(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  let i = 0;

  while (i < utf8.length) {
    const a = utf8.charCodeAt(i++);
    const b = i < utf8.length ? utf8.charCodeAt(i++) : NaN;
    const c = i < utf8.length ? utf8.charCodeAt(i++) : NaN;

    const bitmap =
      (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);

    result += chars.charAt((bitmap >> 18) & 63);
    result += chars.charAt((bitmap >> 12) & 63);
    result += isNaN(b) ? "=" : chars.charAt((bitmap >> 6) & 63);
    result += isNaN(c) ? "=" : chars.charAt(bitmap & 63);
  }

  return result;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "figma-export-design-tokens",
  };
}

async function githubFetch(url, token, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options && options.headers),
    },
  });

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = { message: text };
    }
  }

  if (!response.ok) {
    const detail =
      (body && (body.message || body.error)) || `HTTP ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

function parseRepoInput(input, fallbackOwner) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("Enter a repository name or GitHub URL.");
  }

  // https://github.com/owner/repo(.git)?
  const urlMatch = raw.match(
    /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/i, ""),
      fromUrl: true,
    };
  }

  // owner/repo
  if (raw.includes("/")) {
    const [owner, repo, ...rest] = raw.split("/").filter(Boolean);
    if (!owner || !repo || rest.length) {
      throw new Error("Use owner/repo, a GitHub URL, or just a repo name.");
    }
    return { owner, repo: repo.replace(/\.git$/i, ""), fromUrl: false };
  }

  // bare repo name
  const owner = String(fallbackOwner || DEFAULT_OWNER).trim();
  if (!owner) {
    throw new Error("Enter a GitHub owner/org, or use owner/repo.");
  }
  return { owner, repo: raw.replace(/\.git$/i, ""), fromUrl: false };
}

async function loadSettings() {
  const stored = (await figma.clientStorage.getAsync(SETTINGS_KEY)) || {};
  return {
    token: stored.token || "",
    owner: stored.owner || DEFAULT_OWNER,
    repoInput: stored.repoInput || "",
    filePath: stored.filePath || "tokens/design-tokens.json",
    branch: stored.branch || "main",
    createIfMissing: stored.createIfMissing !== false,
    privateRepo: stored.privateRepo !== false,
  };
}

async function saveSettings(partial) {
  const current = await loadSettings();
  const next = {
    ...current,
    ...partial,
  };

  // Keep existing token if UI sends blank (masked/unchanged).
  if (partial && partial.token === "" && current.token) {
    next.token = current.token;
  }

  await figma.clientStorage.setAsync(SETTINGS_KEY, next);
  return next;
}

function publicSettings(settings) {
  return {
    hasToken: Boolean(settings.token),
    owner: settings.owner || DEFAULT_OWNER,
    repoInput: settings.repoInput || "",
    filePath: settings.filePath || "tokens/design-tokens.json",
    branch: settings.branch || "main",
    createIfMissing: settings.createIfMissing !== false,
    privateRepo: settings.privateRepo !== false,
  };
}

async function ensureRepository(token, owner, repo, { createIfMissing, privateRepo }) {
  try {
    return await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      token,
      { method: "GET" }
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    if (!createIfMissing) {
      throw new Error(
        `Repo ${owner}/${repo} does not exist. Create it on GitHub, or enable “Create repo if missing”.`
      );
    }
  }

  sendToUI({
    type: "PROGRESS",
    message: `Creating ${owner}/${repo}…`,
  });

  const account = await githubFetch(`https://api.github.com/users/${owner}`, token, {
    method: "GET",
  });

  const payload = {
    name: repo,
    private: Boolean(privateRepo),
    description: `Design tokens exported from Figma (${figma.root.name})`,
    auto_init: true,
  };

  let created;
  if (account.type === "Organization") {
    created = await githubFetch(
      `https://api.github.com/orgs/${owner}/repos`,
      token,
      { method: "POST", body: JSON.stringify(payload) }
    );
  } else {
    const me = await githubFetch("https://api.github.com/user", token, {
      method: "GET",
    });
    if (String(me.login).toLowerCase() !== String(owner).toLowerCase()) {
      throw new Error(
        `Token user (@${me.login}) cannot create repos under @${owner}. Create the repo manually, or use a token for that account/org.`
      );
    }
    created = await githubFetch("https://api.github.com/user/repos", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // Give GitHub a moment to initialize the default branch after auto_init.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return created;
}

async function pushFileToGitHub({
  token,
  owner,
  repo,
  branch,
  filePath,
  content,
  commitMessage,
}) {
  const encodedPath = String(filePath)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  let sha;
  try {
    const existing = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(
        branch
      )}`,
      token,
      { method: "GET" }
    );
    sha = existing.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const body = {
    message: commitMessage,
    content: utf8ToBase64(content),
    branch,
  };
  if (sha) body.sha = sha;

  return githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    token,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

async function loadAllVariables() {
  if (!figma.variables) {
    throw new Error("Variables API is not available in this Figma context.");
  }

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const nameById = new Map(variables.map((v) => [v.id, v.name]));
  const byCollection = new Map();

  for (const variable of variables) {
    const list = byCollection.get(variable.variableCollectionId) || [];
    list.push(variable);
    byCollection.set(variable.variableCollectionId, list);
  }

  return { collections, variables, nameById, byCollection };
}

async function buildW3cExport({ collections, nameById, byCollection }, selectedIds) {
  const selected = selectedIds
    ? collections.filter((c) => selectedIds.includes(c.id))
    : collections;

  const files = [];

  for (const collection of selected) {
    const vars = byCollection.get(collection.id) || [];

    for (const mode of collection.modes) {
      const body = {
        $extensions: {
          "com.figma": {
            collectionName: collection.name,
            collectionId: collection.id,
            modeName: mode.name,
            modeId: mode.modeId,
            fileName: figma.root.name,
            exportedAt: new Date().toISOString(),
          },
        },
      };

      for (const variable of vars) {
        const raw = variable.valuesByMode[mode.modeId];
        if (raw === undefined) continue;

        const w3cType = TYPE_TO_W3C[variable.resolvedType];
        if (!w3cType) continue;

        const token = {
          $type: w3cType,
          $value: w3cValue(variable.resolvedType, raw, nameById),
        };

        if (variable.description) token.$description = variable.description;

        const extensions = {};
        if (variable.scopes && variable.scopes.length) {
          extensions.scopes = variable.scopes;
        }
        if (variable.codeSyntax && Object.keys(variable.codeSyntax).length) {
          extensions.codeSyntax = variable.codeSyntax;
        }
        if (Object.keys(extensions).length) {
          token.$extensions = { "com.figma": extensions };
        }

        setNestedToken(body, variable.name.split("/"), token);
      }

      files.push({
        fileName: `${sanitizeFileName(collection.name)}.${sanitizeFileName(
          mode.name
        )}.tokens.json`,
        collectionId: collection.id,
        collectionName: collection.name,
        modeId: mode.modeId,
        modeName: mode.name,
        body,
      });
    }
  }

  return files;
}

async function getSummary() {
  const { collections, variables } = await loadAllVariables();
  return {
    fileName: figma.root.name,
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      modeCount: c.modes.length,
      modes: c.modes.map((m) => m.name),
      variableCount: c.variableIds.length,
    })),
    totalVariables: variables.length,
  };
}

async function buildExportJson(msg) {
  const data = await loadAllVariables();
  const selectedIds =
    msg.collectionIds && msg.collectionIds.length ? msg.collectionIds : null;

  const files = await buildW3cExport(data, selectedIds);
  const payload = {
    $schema: "https://design-tokens.github.io/community-group/format/",
    exportedAt: new Date().toISOString(),
    fileName: figma.root.name,
    files: files.map((f) => ({
      fileName: f.fileName,
      collectionName: f.collectionName,
      modeName: f.modeName,
      tokens: f.body,
    })),
  };

  return {
    json: JSON.stringify(payload, null, 2),
    fileName: `${sanitizeFileName(figma.root.name)}.tokens.json`,
    meta: {
      fileCount: files.length,
      collectionCount: selectedIds
        ? selectedIds.length
        : data.collections.length,
    },
    format: "w3c",
  };
}

async function handleExport(msg) {
  sendToUI({ type: "PROGRESS", message: "Reading variables…" });
  figma.notify("Exporting tokens…");

  sendToUI({ type: "PROGRESS", message: "Building JSON…" });
  const result = await buildExportJson(msg);
  sendJsonPayload(result);
  figma.notify("Tokens exported — download started");
  return result;
}

async function handleGitHubPush(msg) {
  sendToUI({ type: "PROGRESS", message: "Preparing GitHub push…" });

  const settings = await loadSettings();
  const token = (msg.token && msg.token.trim()) || settings.token;
  if (!token) {
    throw new Error("Add a GitHub personal access token first.");
  }

  const ownerDefault = (msg.owner || settings.owner || DEFAULT_OWNER).trim();
  const repoInput = (msg.repoInput || settings.repoInput || "").trim();
  const parsed = parseRepoInput(repoInput, ownerDefault);
  const filePath = (msg.filePath || settings.filePath || "tokens/design-tokens.json").trim();
  const branch = (msg.branch || settings.branch || "main").trim() || "main";
  const createIfMissing =
    msg.createIfMissing != null
      ? Boolean(msg.createIfMissing)
      : settings.createIfMissing !== false;
  const privateRepo =
    msg.privateRepo != null
      ? Boolean(msg.privateRepo)
      : settings.privateRepo !== false;

  // Persist latest non-secret fields (and token if provided).
  await saveSettings({
    token,
    owner: parsed.fromUrl ? parsed.owner : ownerDefault,
    repoInput,
    filePath,
    branch,
    createIfMissing,
    privateRepo,
  });

  sendToUI({ type: "PROGRESS", message: "Exporting tokens…" });
  const exported = await buildExportJson(msg);

  sendToUI({
    type: "PROGRESS",
    message: `Checking ${parsed.owner}/${parsed.repo}…`,
  });
  const repo = await ensureRepository(token, parsed.owner, parsed.repo, {
    createIfMissing,
    privateRepo,
  });

  const targetBranch = branch || repo.default_branch || "main";
  sendToUI({ type: "PROGRESS", message: `Pushing ${filePath}…` });

  const commit = await pushFileToGitHub({
    token,
    owner: parsed.owner,
    repo: parsed.repo,
    branch: targetBranch,
    filePath,
    content: exported.json,
    commitMessage: `chore: update design tokens from Figma (${figma.root.name})`,
  });

  const htmlUrl =
    (commit && commit.content && commit.content.html_url) ||
    `https://github.com/${parsed.owner}/${parsed.repo}/blob/${targetBranch}/${filePath}`;

  // Also send export to UI so download/copy still work.
  sendJsonPayload(exported);

  sendToUI({
    type: "GITHUB_PUSH_RESULT",
    ok: true,
    htmlUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    branch: targetBranch,
    filePath,
    created: Boolean(createIfMissing && repo && repo.created_at),
  });

  figma.notify(`Pushed to ${parsed.owner}/${parsed.repo}`);
}

figma.ui.onmessage = async (msg) => {
  try {
    if (!msg || !msg.type) return;

    if (msg.type === "GET_SUMMARY") {
      const summary = await getSummary();
      sendToUI({ type: "SUMMARY", summary });
      return;
    }

    if (msg.type === "GET_SETTINGS") {
      const settings = await loadSettings();
      sendToUI({ type: "SETTINGS", settings: publicSettings(settings) });
      return;
    }

    if (msg.type === "SAVE_SETTINGS") {
      const settings = await saveSettings(msg.settings || {});
      sendToUI({ type: "SETTINGS", settings: publicSettings(settings) });
      figma.notify("GitHub settings saved");
      return;
    }

    if (msg.type === "CLEAR_TOKEN") {
      const settings = await loadSettings();
      settings.token = "";
      await figma.clientStorage.setAsync(SETTINGS_KEY, settings);
      sendToUI({ type: "SETTINGS", settings: publicSettings(settings) });
      figma.notify("GitHub token cleared");
      return;
    }

    if (msg.type === "EXPORT") {
      await handleExport(msg);
      return;
    }

    if (msg.type === "PUSH_GITHUB") {
      await handleGitHubPush(msg);
      return;
    }

    if (msg.type === "NOTIFY") {
      figma.notify(msg.message || "");
      return;
    }

    if (msg.type === "CLOSE") {
      figma.closePlugin();
    }
  } catch (error) {
    console.error(error);
    const message = error && error.message ? error.message : String(error);
    sendToUI({ type: "ERROR", message });
    figma.notify(`Failed: ${message}`, { error: true });
  }
};

Promise.all([getSummary(), loadSettings()])
  .then(([summary, settings]) => {
    sendToUI({ type: "SUMMARY", summary });
    sendToUI({ type: "SETTINGS", settings: publicSettings(settings) });
    figma.notify(
      `Found ${summary.totalVariables} variables in ${summary.collections.length} collections`
    );
  })
  .catch((error) => {
    console.error(error);
    const message = error && error.message ? error.message : String(error);
    sendToUI({ type: "ERROR", message });
    figma.notify(`Failed to start: ${message}`, { error: true });
  });
