import yargs from "yargs";
import Archive from "./archive";
import { setDownloadDelay } from "./dl";

const argv = yargs
  .option("archive", {
    describe: "The path to the archive directory",
  })
  .option("base-url", {
    describe: "The base URL underwhich the archive directory is available",
  })
  .option("feed-name", {
    describe: "The name of the feed",
  })
  .option("feed-url", {
    describe: "The URL of the RSS/XML feed",
  })
  .option("just-mp3", {
    describe: "Only update episode MP3 files",
    type: "boolean",
  })
  .option("download-delay", {
    default: 10000,
    describe: "The delay in milliseconds between requests to the same host",
    type: "number",
  })
  .command(
    "init",
    "initialize a podcast archive directory",
    (y) => y.demandOption(["archive", "base-url"]),
    init)
  .command(
    "add",
    "add a new podcast feed to be tracked",
    (y) => y.demandOption(["archive", "feed-url", "feed-name"]),
    addFeed)
  .command(
    "update",
    "update tracked podcasts and download new episodes",
    (y) => y.demandOption(["archive"]),
    updateFeeds)
  .command(
    "list",
    "list the podcasts that are currently in the archive",
    (y) => y.demandOption(["archive"]),
    listFeeds)
  .help()
  .argv;

function init(opts: any) {
  const archivePath: string = opts.archive;
  const baseUrl: string = opts["base-url"];
  Archive.create(archivePath, baseUrl, async (archive: Archive) => {
    console.log(`Initialized podcast archive under ${archivePath}`);
  });
}

function addFeed(opts: any) {
  const archivePath: string = opts.archive;
  const feedUrl: string = opts["feed-url"];
  const feedName: string = opts["feed-name"];
  Archive.load(archivePath, async (archive: Archive) => {
    try {
      await archive.newFeed(feedName, feedUrl);
      console.log(`Added podcast ${feedName} to archive.`);
    } catch (e) {
      console.log(`Unable to add podcast`, e);
    }
  });
}

function updateFeeds(opts: any) {
  const archivePath: string = opts.archive;
  const downloadDelay: number | undefined = opts["download-delay"];
  const justMp3s: boolean = !!opts["just-mp3"];
  if (downloadDelay !== undefined) {
    setDownloadDelay(downloadDelay);
  }
  Archive.load(archivePath, async (archive: Archive) => {
    try {
      const feeds = await archive.feeds();
      await Promise.all(feeds.map(async (feed) => {
        try {
          await feed.update(justMp3s);
        } catch (e) {
          console.log(`Error encountered updating ${feed.name}:`, e);
        }
      }));
    } catch (e) {
      console.log(`Error encountered updating feeds:`, e);
    }
    try {
      archive.updateHtml();
    } catch (e) {
      console.log(`Error encountered generating HTML:`, e);
    }
  });
}

function listFeeds(opts: any) {
  const archivePath: string = opts.archive;
  Archive.load(archivePath, async (archive: Archive) => {
    const feeds = await archive.feeds();
    for (const feed of feeds) {
      try {
        const channel = await feed.generatedChannel();
        console.log(`${feed.name}`);
        console.log(`\tTracked RSS: ${feed.url}`);
        console.log(`\tLocal RSS: ${feed.localUrl}`);
        console.log(`\tEpisodes: ${channel.items.length}`);
      } catch (e) {
        console.log(`Unable to list ${feed.name}:`, e);
      }
    }
  });
}
