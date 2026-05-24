import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger.js";

// =====================================================================
// Xray-core integration — VMess / VLESS / Trojan / Shadowsocks / SOCKS5
//
// Flow:
//   1. User saves proxy link in Config tab → data/settings.json
//   2. decodeLink() parses it → buildXrayConfig() creates xray JSON
//   3. startXray() spawns `xray run -c ...` listening on SOCKS5 :10808
//   4. process.env.YTDLP_PROXY = socks5://127.0.0.1:10808
//   5. yt-dlp / bulk downloader picks it up automatically
// =====================================================================

const XRAY_BIN    = process.env["XRAY_BIN"]    || "/usr/local/bin/xray";
const XRAY_CONFIG = process.env["XRAY_CONFIG"] || path.resolve(process.cwd(), "data", "xray-config.json");
export const SOCKS_PORT = parseInt(process.env["XRAY_SOCKS_PORT"] || "10808", 10);
const HTTP_PORT   = parseInt(process.env["XRAY_HTTP_PORT"]  || "10809", 10);
export const LOCAL_PROXY = `socks5://127.0.0.1:${SOCKS_PORT}`;

let xrayProc: ReturnType<typeof spawn> | null = null;

export function isXrayInstalled(): boolean {
  return fs.existsSync(XRAY_BIN);
}

// অটোমেটিক এক্সরে ইন্সটলেশন ফাংশন
export async function installXray(): Promise<boolean> {
  if (isXrayInstalled()) return true;
  try {
    const url = "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip";
    execSync(`curl -L "${url}" -o /tmp/xray.zip && unzip -o /tmp/xray.zip xray -d /usr/local/bin && chmod +x /usr/local/bin/xray && rm /tmp/xray.zip`, { stdio: "inherit" });
    logger.info("xray installed successfully");
    return true;
  } catch (e) {
    logger.error(`xray install failed: ${e}`);
    return false;
  }
}

// ---------- Link decoders ----------

interface DecodedVmess {
  type: "vmess";
  address: string; port: number; uuid: string; alterId: number;
  network: string; security: string; host: string; path: string; sni: string; type_field: string; ps: string;
}
interface DecodedVless {
  type: "vless";
  address: string; port: number; uuid: string;
  network: string; security: string; host: string; path: string; sni: string; flow: string;
}
interface DecodedTrojan {
  type: "trojan";
  address: string; port: number; password: string;
  network: string; security: string; host: string; path: string; sni: string;
}
interface DecodedSS {
  type: "shadowsocks";
  address: string; port: number; method: string; password: string;
}
interface DecodedPassthrough {
  type: "passthrough";
  url: string;
}

type DecodedLink = DecodedVmess | DecodedVless | DecodedTrojan | DecodedSS | DecodedPassthrough;

function decodeVmess(link: string): DecodedVmess {
  const b64 = link.replace(/^vmess:\/\//i, "").trim();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("VMess link decode failed: invalid base64/JSON");
  }
  return {
    type: "vmess",
    address:    String(json["add"] || ""),
    port:       parseInt(String(json["port"] || "443"), 10),
    uuid:       String(json["id"] || ""),
    alterId:    parseInt(String(json["aid"] || "0"), 10),
    network:    String(json["net"] || "tcp"),
    security:   json["tls"] === "tls" ? "tls" : "none",
    host:       String(json["host"] || json["add"] || ""),
    path:       String(json["path"] || "/"),
    sni:        String(json["sni"] || json["host"] || json["add"] || ""),
    type_field: String(json["type"] || "none"),
    ps:         String(json["ps"] || "vmess-server"),
  };
}

function decodeVless(link: string): DecodedVless {
  const m = link.match(/^vless:\/\/([^@]+)@([^:/?]+):(\d+)(\?[^#]*)?/i);
  if (!m) throw new Error("VLESS link parse failed");
  const [, uuid, host, port, qs] = m;
  const params = new URLSearchParams((qs || "").replace(/^\?/, ""));
  return {
    type: "vless",
    address:  host,
    port:     parseInt(port, 10),
    uuid,
    network:  params.get("type") || "tcp",
    security: params.get("security") || "none",
    host:     params.get("host") || host,
    path:     params.get("path") || "/",
    sni:      params.get("sni") || host,
    flow:     params.get("flow") || "",
  };
}

function decodeTrojan(link: string): DecodedTrojan {
  const m = link.match(/^trojan:\/\/([^@]+)@([^:/?]+):(\d+)(\?[^#]*)?/i);
  if (!m) throw new Error("Trojan link parse failed");
  const [, password, host, port, qs] = m;
  const params = new URLSearchParams((qs || "").replace(/^\?/, ""));
  return {
    type: "trojan",
    address:  host,
    port:     parseInt(port, 10),
    password,
    network:  params.get("type") || "tcp",
    security: "tls",
    sni:      params.get("sni") || host,
    host:     params.get("host") || host,
    path:     params.get("path") || "/",
  };
}

function decodeSS(link: string): DecodedSS {
  let s = link.replace(/^ss:\/\//i, "");
  if (!s.includes("@")) {
    s = Buffer.from(s, "base64").toString("utf8");
  } else {
    const [methodPassB64, hostPort] = s.split("@");
    try {
      const decoded = Buffer.from(methodPassB64, "base64").toString("utf8");
      if (decoded.includes(":")) s = `${decoded}@${hostPort}`;
    } catch {}
  }
  const m = s.match(/^([^:]+):([^@]+)@([^:/?]+):(\d+)/);
  if (!m) throw new Error("Shadowsocks link parse failed");
  const [, method, password, host, port] = m;
  return { type: "shadowsocks", address: host, port: parseInt(port, 10), method, password };
}

export function decodeLink(link: string): DecodedLink {
  link = String(link || "").trim();
  if (!link) throw new Error("Empty proxy link");
  if (/^vmess:\/\//i.test(link))   return decodeVmess(link);
  if (/^vless:\/\//i.test(link))   return decodeVless(link);
  if (/^trojan:\/\//i.test(link))  return decodeTrojan(link);
  if (/^ss:\/\//i.test(link))      return decodeSS(link);
  if (/^socks5?:\/\//i.test(link)) return { type: "passthrough", url: link };
  throw new Error("Unsupported scheme. Use vmess://, vless://, trojan://, ss://, or socks5://");
}

// ---------- Xray config builder ----------

function buildStreamSettings(d: { network: string; security: string; host: string; path: string; sni: string }) {
  const ss: Record<string, unknown> = { network: d.network || "tcp" };
  if (d.security === "tls") {
    ss["security"] = "tls";
    ss["tlsSettings"] = { serverName: d.sni || d.host || "", allowInsecure: false };
  }
  if (d.network === "ws") {
    ss["wsSettings"] = { path: d.path || "/", headers: { Host: d.host || "" } };
  } else if (d.network === "grpc") {
    ss["grpcSettings"] = { serviceName: d.path || "" };
  } else if (d.network === "h2") {
    ss["httpSettings"] = { host: [d.host || ""], path: d.path || "/" };
  }
  return ss;
}

function buildXrayConfig(decoded: DecodedLink): Record<string, unknown> {
  let outbound: Record<string, unknown> | undefined;

  if (decoded.type === "vmess") {
    outbound = {
      tag: "proxy", protocol: "vmess",
      settings: { vnext: [{ address: decoded.address, port: decoded.port, users: [{ id: decoded.uuid, alterId: decoded.alterId || 0, security: "auto" }] }] },
      streamSettings: buildStreamSettings(decoded),
    };
  } else if (decoded.type === "vless") {
    outbound = {
      tag: "proxy", protocol: "vless",
      settings: { vnext: [{ address: decoded.address, port: decoded.port, users: [{ id: decoded.uuid, encryption: "none", flow: decoded.flow || "" }] }] },
      streamSettings: buildStreamSettings(decoded),
    };
  } else if (decoded.type === "trojan") {
    outbound = {
      tag: "proxy", protocol: "trojan",
      settings: { servers: [{ address: decoded.address, port: decoded.port, password: decoded.password }] },
      streamSettings: buildStreamSettings({ ...decoded, security: "tls" }),
    };
  } else if (decoded.type === "shadowsocks") {
    outbound = {
      tag: "proxy", protocol: "shadowsocks",
      settings: { servers: [{ address: decoded.address, port: decoded.port, method: decoded.method, password: decoded.password }] },
    };
  }

  return {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", listen: "127.0.0.1", port: SOCKS_PORT, protocol: "socks", settings: { auth: "noauth", udp: true } },
      { tag: "http-in",  listen: "127.0.0.1", port: HTTP_PORT,  protocol: "http",  settings: { allowTransparent: false } },
    ],
    outbounds: [
      outbound,
      { tag: "direct",  protocol: "freedom",   settings: {} },
      { tag: "blocked", protocol: "blackhole",  settings: {} },
    ],
  };
}

// ---------- Process management ----------

export function stopXray(): void {
  if (xrayProc) {
    try { xrayProc.kill("SIGTERM"); } catch {}
    xrayProc = null;
    logger.info("Xray stopped");
  }
}

export async function startXray(vmessLink?: string): Promise<boolean> {
  const link = vmessLink || process.env["VMESS_LINK"] || process.env["PROXY_LINK"] || "";
  if (!link) {
    logger.info("xray: no proxy link set — running direct");
    delete process.env["YTDLP_PROXY"];
    return false;
  }

  try {
    const decoded = decodeLink(link);
    if (decoded.type === "passthrough") {
      process.env["YTDLP_PROXY"] = decoded.url;
      logger.info(`xray: passthrough proxy → ${decoded.url.replace(/:[^:@]*@/, ":***@")}`);
      return true;
    }

    // আপডেটেড চেক এবং অটো-ইন্সটলেশন লজিক
    if (!isXrayInstalled()) {
      const installed = await installXray();
      if (!installed) {
        logger.warn("xray install failed — VMess/VLESS disabled");
        return false;
      }
    }

    stopXray();

    const cfg = buildXrayConfig(decoded);
    fs.mkdirSync(path.dirname(XRAY_CONFIG), { recursive: true });
    fs.writeFileSync(XRAY_CONFIG, JSON.stringify(cfg, null, 2));

    xrayProc = spawn(XRAY_BIN, ["run", "-c", XRAY_CONFIG], { stdio: ["ignore", "pipe", "pipe"] });
    xrayProc.stdout?.on("data", (d: Buffer) => d.toString().split(/\r?\n/).forEach((l: string) => l && logger.info(`xray> ${l}`)));
    xrayProc.stderr?.on("data", (d: Buffer) => d.toString().split(/\r?\n/).forEach((l: string) => l && logger.warn(`xray> ${l}`)));
    xrayProc.on("exit", (code: number | null) => {
      logger.warn(`xray exited with code ${code}`);
      xrayProc = null;
    });

    process.env["YTDLP_PROXY"] = LOCAL_PROXY;
    process.env["FFMPEG_HTTP_PROXY"] = `http://127.0.0.1:${HTTP_PORT}`;
    logger.info(`xray started: ${decoded.type} → ${decoded.address}:${decoded.port} → SOCKS5 ${LOCAL_PROXY}`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`Xray start failed: ${msg}`);
    return false;
  }
}

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  latency_ms?: number;
  error?: string;
}

export function testProxy(): Promise<ProxyTestResult> {
  const proxy = process.env["YTDLP_PROXY"];
  if (!proxy) return Promise.resolve({ ok: false, error: "No proxy active" });

  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn("curl", [
      "-x", proxy,
      "-s", "--max-time", "20",
      "-o", "/dev/null",
      "-w", "%{http_code}",
      "https://api.ipify.org",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let out = "", err = "";
    proc.stdout.on("data", (d: Buffer) => out += d.toString());
    proc.stderr.on("data", (d: Buffer) => err += d.toString());
    proc.on("close", (code: number | null) => {
      const latency_ms = Date.now() - start;
      if (code === 0 && out.startsWith("2")) {
        try {
          const ip = execSync(`curl -x "${proxy}" -s --max-time 10 https://api.ipify.org`, { encoding: "utf8" }).trim();
          resolve({ ok: true, ip, latency_ms });
        } catch {
          resolve({ ok: true, ip: "unknown", latency_ms });
        }
      } else {
        resolve({ ok: false, error: err.trim() || `curl exit ${code}`, latency_ms });
      }
    });
    proc.on("error", (e: Error) => resolve({ ok: false, error: e.message }));
  });
}

export function getProxyStatus(): { active: boolean; proxy: string | null; type: string } {
  const proxy = process.env["YTDLP_PROXY"] || null;
  const link  = process.env["VMESS_LINK"]  || "";
  let type = "direct";
  if (/^vmess:/i.test(link))   type = "vmess";
  else if (/^vless:/i.test(link))   type = "vless";
  else if (/^trojan:/i.test(link))  type = "trojan";
  else if (/^ss:/i.test(link))      type = "shadowsocks";
  else if (/^socks5/i.test(proxy || "")) type = "socks5";
  return { active: !!proxy, proxy, type };
}
