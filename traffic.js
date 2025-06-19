import { chromium } from "playwright";
import { newInjectedContext } from "fingerprint-injector";
import UserAgent from "user-agents";
import { checkTz } from "./tz_px.js";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";

// Load environment variables from .env file

dotenv.config();
const JEDI = process.env.JEDI;
const config = JSON.parse(fs.readFileSync("./c.json", "utf-8"));

const CONFIG_URL = "https://ppc-data.pages.dev/data.json";
let globalConfig;

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

const pickTreeConfig = (urlObj) => {
  const url = urlObj.url.toLowerCase();

  const country = weightedPick(urlObj.countries);
  if (!country) throw new Error("No country picked");

  const code = country.code.toLowerCase();
  const countryName = country.name.toLowerCase();

  const device = weightedPick(country.devices);
  if (!device) throw new Error("No device picked");

  const screen = weightedPick(device.screens) || { width: 1280, height: 720 };

  const os = weightedPick(device.os);
  if (!os) throw new Error("No OS picked");

  const browser = weightedPick(os.browsers);
  if (!browser) throw new Error("No browser picked");

  const rand = Math.floor(10000 + Math.random() * 900000);

  const username = config.proxyUser
    .replace("%CODE%", code)
    .replace("%RAND%", rand);

  return {
    url,
    code,
    device: device.name.toLowerCase(),
    screen: { width: screen.width, height: screen.height },
    os: os.name.toLowerCase(),
    browserdata: browser.name.toLowerCase(),
    username: username.toLowerCase(),
    countryName,
  };
};

const realisticHeaders = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "accept-encoding": "gzip, deflate, br",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
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

const realisticScroll = async (page) => {
  const scrollSteps = Math.floor(Math.random() * 5) + 3;
  for (let i = 0; i < scrollSteps; i++) {
    const scrollDistance = Math.random() * 800 + 200;
    await page.mouse.wheel(0, scrollDistance);
    await page.waitForTimeout(Math.random() * 1000 + 500);
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
    (!url || !code || !device || !screen || !os || !browserdata || !username,
    !countryName)
  ) {
    console.error("Invalid configuration for OpenBrowser:", {
      url,
      code,
      device,
      screen,
      os,
      browserdata,
      username,
      countryName,
    });
    return;
  }
  let browser = null;
  let context = null;
  let wasSuccessful = false;

  const timezone = await checkTz(username);
  if (!timezone) return;

  try {
    const noise = generateNoise();
    browser = await chromium.launch({
      headless: true,
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
        locales: [["en-US", "en-GB", "fr-FR"][Math.floor(Math.random() * 3)]],
        screen: { width: screen.width, height: screen.height },
      },
      mockWebRTC: true,
      newContextOptions: { timezoneId: timezone },
    });

    const randomReferer = getRandomReferer();
    const userAgent = new UserAgent();

    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      ...realisticHeaders,
      "user-agent": userAgent.toString(),
      referer: randomReferer,
    });

    await page.route("**/*", (route) => {
      return ["image", "stylesheet", "font", "media"].includes(
        route.request().resourceType()
      )
        ? route.abort()
        : route.continue();
    });

    await page.addInitScript(noisifyScript(noise));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000 + Math.random() * 3000);
    await realisticScroll(page);
    await humanInteraction(page);
    await page.waitForTimeout(10000 + Math.random() * 10000);

    console.log(
      `[SUCCESS] Visited ${url} (${countryName}, ${device}, ${os}, ${browserdata})`
    );
    wasSuccessful = true;
  } catch {
  } finally {
    try {
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (err) {
      console.error("Error closing browser/context:", err);
    }
  }
};

const loadConfig = async () => {
  try {
    const res = await fetch(CONFIG_URL);
    const json = await res.json();
    if (Array.isArray(json)) {
      globalConfig = json;
    }
  } catch (err) {
    console.error("[CONFIG] Failed to fetch config:", err);
  }
};

const startWorker = async (id, urlObj) => {
  while (true) {
    try {
      const session = pickTreeConfig(urlObj);
      await OpenBrowser(session);
    } catch (err) {
      console.error(`Worker ${id} (${urlObj.url}) error:`, err);
    }
  }
};

const RunTasks = async () => {
  await loadConfig();
  setInterval(loadConfig, 30000);

  const match = globalConfig.find((item) => item.workflow === config.workflow);

  if (!match || !Array.isArray(match.config)) {
    console.error("No matching workflow or invalid config format.");
    return;
  }

  for (const urlObj of match?.config) {
    const workers = urlObj.workers;
    for (let i = 0; i < workers; i++) {
      startWorker(i, urlObj); // Don't await — fire & forget
    }
  }
};

RunTasks();
