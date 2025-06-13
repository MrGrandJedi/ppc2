import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import dotenv from "dotenv";
import fs from "fs";

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync("./c.json", "utf-8"));

export const checkTz = async (username) => {
  dotenv.config();
  const proxyHost = config.proxyHost;
  const proxyPort = config.proxyPort;
  const proxyUsername = username;
  const proxyPassword = process.env.JEDI;

  // Properly formatted proxy URL
  const proxyUrl = `http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;
  const proxyAgent = new HttpsProxyAgent(proxyUrl);

  try {
    const response = await axios.get(
      "https://white-water-a7d6.mahdiidrissi2022.workers.dev/",
      {
        httpsAgent: proxyAgent,
      }
    );
    const ipDetails = { timezone: response.data.trim() };
    return ipDetails.timezone || null;
  } catch (error) {
    console.error("Error fetching timezone:", error.message);
    return null;
  }
};
