import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import dotenv from "dotenv";
import fs from "fs";

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync("./c.json", "utf-8"));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TIMEZONES = {
  us: "America/New_York",
  uk: "Europe/London",
  fr: "Europe/Paris",
};

export const checkTz = async (username, retryCount = 1) => {
  dotenv.config();
  const proxyHost = config.proxyHost;
  const proxyPort = config.proxyPort;
  const proxyUsername = username;
  const proxyPassword = process.env.JEDI;

  // Extract country code from username (assuming format contains country code)
  const countryCode = username.split("-")[2]?.toLowerCase();

  // Properly formatted proxy URL
  const proxyUrl = `http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;
  const proxyAgent = new HttpsProxyAgent(proxyUrl);

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const response = await axios.get(
        "https://white-water-a7d6.mahdiidrissi2022.workers.dev/",
        {
          httpsAgent: proxyAgent,
          timeout: 5000, // Reduced timeout to 5 seconds
          validateStatus: (status) => status === 200, // Only accept 200 status
        }
      );

      const timezone = response.data.trim();
      if (timezone) {
        return timezone;
      }

      // If we got a response but no timezone, use fallback
      throw new Error("Empty timezone response");
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error.message);

      if (attempt < retryCount) {
        console.log(
          `Retrying in 1 second... (Attempt ${attempt + 2}/${retryCount + 1})`
        );
        await delay(1000); // Reduced delay to 1 second
        continue;
      }

      // If all retries failed, use fallback timezone based on country code
      if (countryCode && DEFAULT_TIMEZONES[countryCode]) {
        console.log(
          `Using fallback timezone for ${countryCode}: ${DEFAULT_TIMEZONES[countryCode]}`
        );
        return DEFAULT_TIMEZONES[countryCode];
      }

      // If we can't determine country code, use US as default
      console.log("Using default US timezone as fallback");
      return "America/New_York";
    }
  }
};
