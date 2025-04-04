const puppeteer = require("puppeteer");
const { OpenAI } = require("openai"); // Correct named import
require("dotenv").config();
const OLLAMA_API = process.env.OLLAMA_API || "http://localhost:11434/api/chat" //make sure ollama is installed and up and running locally
const HEADERS = {"Content-Type": "application/json"}
const MODEL = "llama3.2"
class Website {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      timeout: options.timeout || 10000,
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      removeElements: options.removeElements || [
        "script",
        "style",
        "img",
        "input",
        "nav",
        "footer",
        "header",
      ],
      maxContentLength: options.maxContentLength || 1000000,
      headless: options.headless !== false,
      waitForRender: options.waitForRender || 2000, // Reduced default to 2s
    };

    this.title = "No title found";
    this.text = "";
    this.metadata = {};
    this.links = [];
    this.status = null;
  }

  async extractMetadata(page) {
    return page.evaluate(() => {
      const metaTags = document.getElementsByTagName("meta");
      const metadata = {};
      for (let meta of metaTags) {
        const name = meta.getAttribute("name") || meta.getAttribute("property");
        const content = meta.getAttribute("content");
        if (name && content) metadata[name] = content;
      }
      return metadata;
    });
  }

  async extractLinks(page) {
    return page.evaluate(() => {
      const anchorTags = document.getElementsByTagName("a");
      const links = new Set();
      for (let anchor of anchorTags) {
        const href = anchor.getAttribute("href");
        if (href && !href.startsWith("#")) links.add(href);
      }
      return Array.from(links);
    });
  }

  cleanText(text) {
    return text
      .replace(/\s+/g, " ")
      .replace(/[^\w\s.,!?]/g, "")
      .trim()
      .slice(0, this.options.maxContentLength);
  }

  async initialize() {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: this.options.headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();

      await page.setUserAgent(this.options.userAgent);
      await page.setViewport({ width: 1280, height: 800 });

      const response = await page.goto(this.url, {
        waitUntil: "networkidle2",
        timeout: this.options.timeout,
      });
      this.status = response ? response.status() : null; // Use Puppeteer response status

      await new Promise((resolve) =>
        setTimeout(resolve, this.options.waitForRender)
      );

      this.title = (await page.title()) || this.url;
      this.metadata = await this.extractMetadata(page);
      this.links = await this.extractLinks(page);

      await page.evaluate((elements) => {
        elements.forEach((tag) => {
          document.querySelectorAll(tag).forEach((el) => el.remove());
        });
      }, this.options.removeElements);

      this.text = this.cleanText(
        await page.evaluate(() => document.body.innerText)
      );
    } catch (error) {
      console.error(`Error scraping ${this.url}:`, error.message);
      this.text = `Error: Unable to scrape content - ${error.message}`;
    } finally {
      if (browser) await browser.close();
    }
  }

  getData() {
    return {
      url: this.url,
      title: this.title,
      text: this.text,
      metadata: this.metadata,
      links: this.links,
      status: this.status,
      timestamp: new Date().toISOString(),
    };
  }
}

async function scrapeWebsite(url) {
  const website = new Website(url, {
    timeout: 30000,
    waitForRender: 3000,
  });
  await website.initialize();
  return website.getData();
}

function userPromptFor(website) {
  let user_prompt = `You are looking at a website titled "${website.title}".\n`;
  user_prompt +=
    "The contents of this website are as follows; please provide a short summary of this website in markdown. If it includes news or announcements, then summarize these too.\n\n";
  user_prompt += website.text;
  return user_prompt;
}

function messageFor(website) {
  const system_prompt =
    "You are an assistant that analyzes the contents of a website and provides a short summary, ignoring text that might be navigation related. Respond in markdown.";
  return [
    { role: "system", content: system_prompt },
    { role: "user", content: userPromptFor(website) },
  ];
}

// Main execution
(async () => {
  try {
    const website = await scrapeWebsite("https://magicpin.in/india/new-delhi/discover/custom_1ef54661-c42e-4b08-841a-98c17ac5f805");
    const payload = {
        "model": MODEL,
        "messages": messageFor(website),
        "stream": false
    }

    const response = await fetch(OLLAMA_API, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    console.log("Summary:\n", data.message.content);
  } catch (error) {
    console.error("Error:", error);
  }
})();