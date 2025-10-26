import { chromium } from "playwright";
import { newInjectedContext } from "fingerprint-injector";
import UserAgent from "user-agents";
import { checkTz } from "./tz_px.js";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

// Load environment variables from .env files

dotenv.config();
const JEDI = process.env.JEDI;
const config = JSON.parse(fs.readFileSync("./c.json", "utf-8"));

const CONFIG_URL = "https://ppc-data.pages.dev/data.json";
// const CONFIG_URL = "https://pastebin.com/raw/B2ZY9UZF";
let globalConfig;
let globalMatch;
let counter = 0;
export const noisifyScript = (noise) => `
  (function() {
    const noise = ${JSON.stringify(noise)};

    // —— Canvas Noisify —— 
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    function noisifyCanvas(canvas, context) {
      if (!canvas || !context) return;
      const { r, g, b, a } = noise.shift;
      const width = canvas.width;
      const height = canvas.height;
      if (!width || !height) return;
      const imageData = originalGetImageData.apply(context, [0, 0, width, height]);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i + 0] = data[i + 0] + r;
        data[i + 1] = data[i + 1] + g;
        data[i + 2] = data[i + 2] + b;
        data[i + 3] = data[i + 3] + a;
      }
      context.putImageData(imageData, 0, 0);
    }

    HTMLCanvasElement.prototype.toBlob = new Proxy(HTMLCanvasElement.prototype.toBlob, {
      apply(target, self, args) {
        noisifyCanvas(self, self.getContext('2d'));
        return Reflect.apply(target, self, args);
      }
    });

    HTMLCanvasElement.prototype.toDataURL = new Proxy(HTMLCanvasElement.prototype.toDataURL, {
      apply(target, self, args) {
        noisifyCanvas(self, self.getContext('2d'));
        return Reflect.apply(target, self, args);
      }
    });

    CanvasRenderingContext2D.prototype.getImageData = new Proxy(CanvasRenderingContext2D.prototype.getImageData, {
      apply(target, self, args) {
        noisifyCanvas(self.canvas, self);
        return Reflect.apply(target, self, args);
      }
    });

    // —— Audio Noisify ——
    const originalGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function() {
      const results = originalGetChannelData.apply(this, arguments);
      for (let i = 0; i < results.length; i++) {
        results[i] += noise.audioNoise;
      }
      return results;
    };

    const originalCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
    AudioBuffer.prototype.copyFromChannel = function(destination, ...args) {
      const channelData = originalCopyFromChannel.apply(this, [destination, ...args]);
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] += noise.audioNoise;
      }
      return channelData;
    };

    const originalCopyToChannel = AudioBuffer.prototype.copyToChannel;
    AudioBuffer.prototype.copyToChannel = function(source, ...args) {
      for (let i = 0; i < source.length; i++) {
        source[i] += noise.audioNoise;
      }
      return originalCopyToChannel.apply(this, [source, ...args]);
    };

    // —— WebGL Noisify ——
    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function() {
      const value = originalGetParameter.apply(this, arguments);
      if (typeof value === 'number') {
        return value + noise.webglNoise;
      }
      return value;
    };

    // —— ClientRects Noisify ——
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      const rect = originalGetBoundingClientRect.apply(this, arguments);
      const { deltaX, deltaY } = noise.clientRectsNoise;
      return {
        x:      rect.x + deltaX,
        y:      rect.y + deltaY,
        width:  rect.width + deltaX,
        height: rect.height + deltaY,
        top:    rect.top + deltaY,
        right:  rect.right + deltaX,
        bottom: rect.bottom + deltaY,
        left:   rect.left + deltaX,
      };
    };
  })();
`;

const generateNoise = () => {
  const shift = {
    r: Math.floor(Math.random() * 5) - 2,
    g: Math.floor(Math.random() * 5) - 2,
    b: Math.floor(Math.random() * 5) - 2,
    a: Math.floor(Math.random() * 5) - 2,
  };
  const webglNoise = (Math.random() - 0.5) * 0.01;
  const clientRectsNoise = {
    deltaX: (Math.random() - 0.5) * 2,
    deltaY: (Math.random() - 0.5) * 2,
  };
  const audioNoise = (Math.random() - 0.5) * 0.000001;

  return { shift, webglNoise, clientRectsNoise, audioNoise };
};

const weightedPick = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const total = arr.reduce((sum, o) => sum + o.weight, 0);
  let r = Math.random() * total;
  for (const o of arr) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return arr[arr.length - 1];
};

const checkProxyLoop = async (code, maxAttempts = 10) => {
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rand = Math.floor(10000 + Math.random() * 900000);
    const username = config.proxyUser
      .replace("%CODE%", code)
      .replace("%RAND%", rand);
    const proxyUrl = `http://${username}:${process.env.JEDI}@${config.proxyHost}:${config.proxyPort}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    console.log(
      `[PROXY] ${attempt + 1}/${maxAttempts} code=${code} user=${username}`
    );

    try {
      const resp = await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: (s) => s === 200,
        // prevent axios from using NODE_HTTP_PROXY env or builtin proxy option
        proxy: false,
      });

      if (!resp.data || !resp.data.ip) {
        lastError = `No ip in response: ${JSON.stringify(resp.data)}`;

        await new Promise((res) => setTimeout(res, 500));
        continue;
      }

      return { username, proxyUrl, ip: resp.data.ip };
    } catch (err) {
      lastError =
        err && (err.code || err.message)
          ? `${err.code || ""} ${err.message || ""}`
          : String(err);

      // small backoff
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  throw new Error(
    `Proxy not working after ${maxAttempts} attempts: ${lastError || "unknown"}`
  );
};

const pickTreeConfig = (urlObj, presets) => {
  const url = urlObj.url.toLowerCase();

  const country = weightedPick(urlObj.countries);
  if (!country) throw new Error("No country picked");

  const code = country.code.toLowerCase();
  const countryName = country.name.toLowerCase();

  let device = weightedPick(country.devices);
  if (!device) throw new Error("No device picked");

  // resolve preset if present
  let presetName = null;
  if (device.preset && presets[device.preset]) {
    presetName = device.preset;
    device = { ...device, ...presets[device.preset] };
  }

  const screen = weightedPick(device.screens) || { width: 1280, height: 720 };
  const os = weightedPick(device.os);
  if (!os) throw new Error("No OS picked");

  const browser = weightedPick(os.browsers);
  if (!browser) throw new Error("No browser picked");

  // Ensure deviceType limited to desktop/mobile
  let deviceType = "desktop";
  if (presetName && presetName.toLowerCase().includes("mobile")) {
    deviceType = "mobile";
  } else if (device.name && device.name.toLowerCase().includes("mobile")) {
    deviceType = "mobile";
  }

  // Start proxy verification using the async helper.
  // NOTE: we DO NOT mark pickTreeConfig as `async` — it will return a Promise here.
  const proxyCheckPromise = checkProxyLoop(code, 10);

  // Return a Promise that resolves to the final session object.
  return proxyCheckPromise.then(({ username, proxyUrl, ip }) => {
    return {
      url,
      code,
      device: deviceType,
      screen: { width: screen.width, height: screen.height },
      os: os.name.toLowerCase(),
      browserdata: browser.name.toLowerCase(),
      username: username.toLowerCase(),
      countryName,
      proxyUrl,
      proxyIp: ip,
    };
  });
};

const humanMouseMovements = [
  { type: "move", x: 100, y: 200, duration: 500 },
  { type: "click", x: 300, y: 400 },
  { type: "scroll", y: 500 },
  { type: "move", x: 50, y: 300, duration: 1000 },
];

const generateGoogleReferer = () => {
  const searchTerms = encodeURIComponent(
    [
      "movie streaming",
      "watch films online",
      "latest movies",
      "free movies",
      "hd films",
      "cinema releases",
    ][Math.floor(Math.random() * 6)]
  );
  const params = new URLSearchParams({
    q: searchTerms,
    rlz: "1C1CHBF_enUS800US800",
    oq: searchTerms.substring(0, 5),
    aqs: "chrome..69i57j0i512l9",
    sourceid: "chrome",
    ie: "UTF-8",
    prmd: "imvnsb",
    ved: `0ahUKEwj${Math.random().toString(36).substr(2, 20)}`,
    pdd: "1",
  });
  return `https://www.google.com/search?${params}`;
};

const getRandomReferer = () => {
  const sources = [
    { weight: 70, generator: () => generateGoogleReferer() },
    {
      weight: 15,
      generator: () =>
        `https://www.facebook.com/${
          Math.random() > 0.5 ? "watch" : "groups"
        }/?ref=${Math.random().toString(36).substr(2)}`,
    },
    {
      weight: 10,
      generator: () =>
        `https://twitter.com/search?q=${encodeURIComponent(
          ["film", "movie", "stream"][Math.floor(Math.random() * 3)]
        )}&src=typed_query`,
    },
    {
      weight: 5,
      generator: () =>
        `https://www.reddit.com/r/${
          ["movies", "Streaming", "Piracy"][Math.floor(Math.random() * 3)]
        }/`,
    },
  ];
  const totalWeight = sources.reduce((acc, curr) => acc + curr.weight, 0);
  let random = Math.random() * totalWeight;
  for (const source of sources) {
    if (random < source.weight) return source.generator();
    random -= source.weight;
  }
  return sources[0].generator();
};

const humanType = async (page, text) => {
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
    if (Math.random() < 0.05) {
      await page.waitForTimeout(200 + Math.random() * 500);
    }
  }
};

const humanInteraction = async (page) => {
  for (const action of humanMouseMovements) {
    if (action.type === "move") {
      await page.mouse.move(
        action.x + Math.random() * 50,
        action.y + Math.random() * 50,
        { steps: 10, duration: action.duration }
      );
    } else if (action.type === "click") {
      await page.mouse.click(
        action.x + Math.random() * 50,
        action.y + Math.random() * 50
      );
    } else if (action.type === "scroll") {
      await realisticScroll(page);
    }
    await page.waitForTimeout(Math.random() * 1000 + 500);
  }
  if (Math.random() < 0.3) {
    await humanType(
      page,
      String.fromCharCode(65 + Math.floor(Math.random() * 26))
    );
  }
};

const realisticScroll = async (page) => {
  const scrollSteps = Math.floor(Math.random() * 5) + 3;
  for (let i = 0; i < scrollSteps; i++) {
    const scrollDistance = Math.random() * 800 + 200;
    await page.mouse.wheel(0, scrollDistance);
    await page.waitForTimeout(Math.random() * 1000 + 500);
  }
};

const OpenBrowser = async ({
  url,
  code,
  device,
  screen,
  os,
  browserdata,
  username,
  countryName,
}) => {
  if (
    !url ||
    !code ||
    !device ||
    !screen ||
    !os ||
    !browserdata ||
    !username ||
    !countryName
  ) {
    throw new Error(
      "Invalid configuration for OpenBrowser: Missing required parameters"
    );
  }

  let browser = null;
  let context = null;
  let page = null;

  try {
    const timezone = await Promise.race([
      checkTz(username),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timezone check timeout")), 30000)
      ),
    ]);

    if (!timezone) {
      throw new Error("Failed to get timezone");
    }

    const noise = generateNoise();
    browser = await chromium.launch({
      headless: true,
      timeout: 240000,
      proxy: {
        server: `${config.proxyHost}:${config.proxyPort}`,
        username,
        password: process.env.JEDI,
      },
    });

    context = await newInjectedContext(browser, {
      fingerprintOptions: {
        devices: [device],
        browsers: [browserdata],
        operatingSystems: [os],

        screen: { width: screen.width, height: screen.height },
      },
      mockWebRTC: true,
      newContextOptions: { timezoneId: timezone },
    });

    const randomReferer = getRandomReferer();
    const userAgent = new UserAgent();
    page = await context.newPage();

    await page.setExtraHTTPHeaders({
      "user-agent": userAgent.toString(),
      // referer: randomReferer,
    });

    await page.addInitScript(noisifyScript(noise));

    await Promise.race([
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Page load timeout")), 60000)
      ),
    ]);

    await page.waitForTimeout(2000 + Math.random() * 3000);

    await realisticScroll(page);

    await humanInteraction(page);

    await page.waitForTimeout(10000 + Math.random() * 20000);

    console.log(`✅ ${countryName}, ${device}, ${os}, ${browserdata}`);
  } catch (err) {
    console.error(`[ERROR] Browser session failed: ${err.message}`);
    throw err;
  } finally {
    try {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch (err) {
      console.error("Error during cleanup:", err.message);
    }
  }
};

const loadConfig = async () => {
  try {
    const configPromise = fetch(CONFIG_URL);
    // timeout for 3 minutes
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Config fetch timeout")), 180000)
    );

    const res = await Promise.race([configPromise, timeoutPromise]);
    const json = await res.json();

    if (!Array.isArray(json)) {
      throw new Error("Invalid config format: expected array");
    }

    // Find matching workflow
    globalMatch = json.find((item) => item.workflow === config.workflow);

    if (!globalMatch) {
      throw new Error(`No matching workflow found for: ${config.workflow}`);
    }

    if (!Array.isArray(globalMatch.config)) {
      throw new Error("Invalid workflow config format: expected array");
    }
  } catch (err) {
    console.error("[CONFIG] Failed to fetch/parse config:", err.message);
    setTimeout(loadConfig, 3000);
  }
};

const startWorker = async (id, urlObj) => {
  try {
    const workerPromise = (async () => {
      try {
        // pickTreeConfig may return a Promise (when proxy check runs) or a plain object.
        let sessionOrPromise = pickTreeConfig(
          urlObj,
          globalMatch.devicePresets || {}
        );

        // Normalize: if it's a thenable, await it
        let session;
        if (sessionOrPromise && typeof sessionOrPromise.then === "function") {
          session = await sessionOrPromise;
        } else {
          session = sessionOrPromise;
        }

        // concise log
        console.log(`[SESSION] ${session.code}, ${session.device}`);

        await OpenBrowser(session);
      } catch (err) {
        console.error(`Worker ${id} (${urlObj.url}) error:`, err.message);
        throw err;
      }
    })();

    // Use Promise.race to handle timeout cleanly
    await Promise.race([
      workerPromise,
      new Promise((_, reject) =>
        setTimeout(() => {
          console.log(`Worker ${id} (${urlObj.url}) timed out after 2min`);
          reject(new Error("Worker timeout"));
        }, 120000)
      ),
    ]);
  } catch (err) {
    if (err.message !== "Worker timeout") {
      console.error(`${id} (${urlObj.url}) failed:`, err.message);
    }
  }
};

const RunTasks = async () => {
  await loadConfig();
  setInterval(loadConfig, 1800000);

  if (!globalMatch || !Array.isArray(globalMatch.config)) {
    console.error("No matching workflow or invalid config format.");
    return;
  }
  while (true) {
    // Collect all worker promises for all urlObjs
    counter = 0;
    const allWorkerPromises = [];
    for (const urlObj of globalMatch.config) {
      const workers = urlObj.workers;
      console.log(`➤ ${workers}x ${urlObj.url}`);
      for (let i = 0; i < workers; i++) {
        allWorkerPromises.push(startWorker(i, urlObj));
      }
    }
    // Wait for all workers for all urlObjs to finish before starting next round
    await new Promise((resolve) =>
      setTimeout(resolve, 5000 + Math.random() * 5000)
    );
    await Promise.all(allWorkerPromises);
  }
};

RunTasks();
